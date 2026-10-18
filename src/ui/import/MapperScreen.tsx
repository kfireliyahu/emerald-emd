import { useEffect, useMemo, useRef, useState } from 'react'
import { roleRejection, type ColumnRoleId } from '@/domain/model/columnRoles.ts'
import type { Database } from 'sql.js'

import type { CurrencyCode } from '@/core/money.ts'
import { allParsed, applyMapping, firstParsed, summarize, type ParsedRow } from '@/data/importer/apply.ts'
import { applyColumnProposal, statementContext } from '@/data/importer/columnProposal.ts'
import { guessMapping, missingRequiredRoles, withColumnRole } from '@/data/importer/guess.ts'
import { defaultMappingName, statedCardLast4 } from '@/data/importer/mappingName.ts'
import type { SheetTable, SheetWorkbook } from '@/data/importer/sheetTable.ts'
import { accountNameFor, type StatementSheet } from '@/data/importer/statementBatch.ts'
import { computeHeaderSignature, matchSavedMapping } from '@/data/importer/signature.ts'
import { listMappings, saveMapping } from '@/data/repositories/importMappingRepository.ts'
import {
  addColumnRole,
  columnRoleIds,
  listColumnRoles,
} from '@/data/repositories/columnRoleRepository.ts'
import { deriveStatementColumns } from '@/data/runtime/derive.ts'
import { readChosenProvider } from '@/data/runtime/provider.ts'
import type { DraftMapping } from '@/domain/model/importing.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'
import { MappingBar, type SavedMappingRef } from './MappingBar.tsx'
import { PreviewStrip, totalOf } from './PreviewStrip.tsx'
import { SheetGrid } from './SheetGrid.tsx'
import { StageBar } from './StageBar.tsx'

/**
 * Guess or recall a mapping, let the user correct it, and show what it
 * produces while they do — pipeline steps 3 to 6 of
 * docs/f01-card-statement-import.md.
 *
 * A file that matches a saved mapping exactly skips this screen's grid
 * entirely and lands on the parsed result. A file that *nearly* matches opens
 * the grid with the columns that moved marked, which is how a format change is
 * caught rather than silently mis-parsed.
 */

/** How much of the parse to show. Three lines under the grid; the lot when the grid is gone. */
const PREVIEW_ROWS_EDITING = 3
const PREVIEW_ROWS_COLLAPSED = 500

const NO_COLUMNS: ReadonlySet<number> = new Set<number>()

interface SheetMapping {
  readonly mapping: DraftMapping | undefined
  /** The saved mapping this came from, if any. */
  readonly saved: SavedMappingRef | undefined
  /** Current columns that differ from the saved header. Empty unless this was a close match. */
  readonly changedColumns: ReadonlySet<number>
  /** The user has changed something since this was matched or last saved. */
  readonly dirty: boolean
  /** Whether the grid is on screen. Off for an exact match until the user asks for it. */
  readonly editing: boolean
  /** What the user typed into the name field, if they typed anything. */
  readonly nameOverride: string | undefined
}

export function MapperScreen({
  workbook,
  fileHash,
  onDone,
  onRead,
}: {
  workbook: SheetWorkbook
  fileHash: string | undefined
  onDone: () => void
  /** The parse is in the database now, and the review screen takes it from here. */
  onRead: (sheet: StatementSheet) => void
}) {
  const [activeSheet, setActiveSheet] = useState(0)
  /**
   * The cell-type overlay, a debugging aid for a file that will not map. It
   * used to be a checkbox in the app header, which put a control for one screen
   * in the chrome of every screen; the header is gone (D-130) and it belongs on
   * the toolbar of the screen it belongs to.
   */
  const [showTypes, setShowTypes] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [proposeProblem, setProposeProblem] = useState<string | undefined>()
  // Read once: the choice is a machine preference and changing it is a trip to
  // the settings screen, which unmounts this one anyway (D-134).
  const provider = useMemo(() => readChosenProvider(), [])
  const db = useDocumentStore((state) => state.db)
  const mutate = useDocumentStore((state) => state.mutate)

  /**
   * This document's statement vocabulary, and the way to extend it (D-213).
   *
   * Held in state rather than read per render because adding one writes to the
   * document, and the picker has to show the new role the instant it lands —
   * a stale list is the one failure that would make the affordance look broken.
   */
  const [roles, setRoles] = useState<readonly ColumnRoleId[]>([])
  useEffect(() => {
    setRoles(db === undefined ? [] : columnRoleIds(db, 'STATEMENT'))
  }, [db])

  /**
   * **Validated before the write, not inside it.** `mutate` marks the document
   * dirty, and a rejected name changes nothing — a dirty dot for a typo would
   * be the app lying about unsaved work.
   */
  const addRole = (role: string): string | undefined => {
    if (db === undefined) return 'Open a document first.'
    const rejection = roleRejection(role, listColumnRoles(db, 'STATEMENT'))
    if (rejection !== undefined) return rejection

    mutate((database) => {
      addColumnRole(database, 'STATEMENT', role, Date.now())
    })
    setRoles(columnRoleIds(db, 'STATEMENT'))
    return undefined
  }

  // One mapping per sheet: Max ships two sheets that are two separate imports,
  // so this cannot be a single mapping for the file — even though, their
  // headers being identical, one *saved* mapping covers both.
  const [sheets, setSheets] = useState<ReadonlyMap<number, SheetMapping>>(() =>
    matchAll(workbook, db),
  )

  // The document can arrive after the file does — drop a statement on an empty
  // app, then create a document — and until it does there are no saved mappings
  // to match against. Re-match when a different document opens, but never over
  // the user's own work. `mutate` keeps the same `Database`, so saving a mapping
  // does not trip this.
  const matchedAgainst = useRef(db)
  useEffect(() => {
    if (db === undefined || db === matchedAgainst.current) return
    matchedAgainst.current = db

    setSheets((current) => {
      const matched = matchAll(workbook, db)
      const next = new Map(current)
      let changed = false
      for (const [index, state] of current) {
        if (state.dirty || state.saved !== undefined) continue
        const replacement = matched.get(index)
        if (replacement === undefined) continue
        next.set(index, replacement)
        changed = true
      }
      return changed ? next : current
    })
  }, [db, workbook])

  const table = workbook.sheets[activeSheet]
  const state = sheets.get(activeSheet)

  const update = (change: Partial<SheetMapping>): void => {
    setSheets((current) => {
      const existing = current.get(activeSheet)
      if (existing === undefined) return current
      return new Map(current).set(activeSheet, { ...existing, ...change })
    })
  }

  if (table === undefined || state === undefined) {
    return <Centered>This file has no sheets.</Centered>
  }

  /**
   * Ask the local model where this sheet's columns are — F17's rung 2 for the
   * tabular half (D-150).
   *
   * Deliberately not automatic. The guesser is right most of the time and free;
   * this costs a model call and is worth it exactly when the guess is wrong,
   * which is a thing the person looking at the preview can see and the app
   * cannot. Pressing it marks the sheet dirty, because what is on screen is no
   * longer the mapping that was saved.
   */
  const propose = (): void => {
    const mapping = state.mapping
    if (provider === undefined || mapping === undefined || table === undefined) return
    // No document, no vocabulary, and no vocabulary means no closed list to ask
    // the model with (D-212).
    if (db === undefined) return

    setProposing(true)
    setProposeProblem(undefined)

    deriveStatementColumns(provider, statementContext(table, mapping, columnRoleIds(db, 'STATEMENT')))
      .then((result) => {
        if (result.kind === 'failed') {
          setProposeProblem(result.reason)
          return
        }
        update({ mapping: applyColumnProposal(mapping, result.lines), dirty: true, editing: true })
      })
      .catch((error: unknown) => setProposeProblem(String(error)))
      .finally(() => setProposing(false))
  }

  /**
   * **Read it keeps the reader** (M31 U2). There was a Save button beside it,
   * and a file read without pressing that one was a new layout again the next
   * month. Now reading is saving: a new reader is made, an edited or moved one
   * is repaired in place (D-031), and an exact match untouched is left alone.
   * The id goes into the sheet, so Write teaches that reader its account.
   */
  const keep = (name: string): string | undefined => {
    const mapping = state.mapping
    if (db === undefined || mapping === undefined) return undefined
    if (state.saved !== undefined && !state.dirty && state.changedColumns.size === 0) return state.saved.id

    const signature = computeHeaderSignature(table, mapping.headerRowIndex)
    let id = state.saved?.id
    mutate((database) => {
      // Re-saving under the id it came from repairs the mapping in place rather
      // than leaving two rows for one format (D-031). The account is deliberately
      // not passed: `saveMapping` keeps the binding the mapping already has, and
      // re-saving columns is not a statement about which card they belong to.
      id = saveMapping(
        database,
        { id: state.saved?.id, name, headerSignature: signature, mapping },
        Date.now(),
      ).id
    })

    update({
      saved: { id: id ?? '', name, accountId: state.saved?.accountId },
      dirty: false,
      changedColumns: NO_COLUMNS,
    })
    return id
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        workbook={workbook}
        activeSheet={activeSheet}
        onPickSheet={setActiveSheet}
        table={table}
        mapping={state.mapping}
        onSetCurrency={(defaultCurrency) =>
          update({
            mapping: state.mapping === undefined ? undefined : { ...state.mapping, defaultCurrency },
            dirty: true,
          })
        }
        showTypes={showTypes}
        onToggleTypes={setShowTypes}
        onDone={onDone}
      />

      <SheetBody
        // Remounted per sheet, so switching to Max's second sheet offers a fresh
        // import rather than the first sheet's result.
        key={table.name}
        table={table}
        state={state}
        fileName={workbook.fileName}
        fileHash={fileHash}
        showTypes={showTypes}
        onPropose={provider === undefined ? undefined : propose}
        proposing={proposing}
        proposeProblem={proposeProblem}
        onDismissProposeProblem={() => setProposeProblem(undefined)}
        onKeep={keep}
        onNameChange={(nameOverride) => update({ nameOverride })}
        onRead={onRead}
        onEdit={() => update({ editing: true })}
        onSetHeaderRow={(headerRowIndex) =>
          update({ mapping: guessMapping(table, { headerRowIndex }), dirty: true })
        }
        onSetColumnRole={(column, role) =>
          update({
            mapping:
              state.mapping === undefined ? undefined : withColumnRole(state.mapping, column, role),
            dirty: true,
          })
        }
        roles={roles}
        onAddRole={addRole}
      />
    </div>
  )
}

/**
 * Every sheet, matched against the saved mappings and otherwise guessed.
 *
 * An exact match arrives collapsed — that is what "the second import of a known
 * format skips the mapper entirely" means. A close match arrives open, with the
 * columns that moved carried through so the grid can mark them.
 */
function matchAll(workbook: SheetWorkbook, db: Database | undefined): Map<number, SheetMapping> {
  const candidates = db === undefined ? [] : listMappings(db)
  const sheets = new Map<number, SheetMapping>()

  workbook.sheets.forEach((table, index) => {
    const match = candidates.length === 0 ? undefined : matchSavedMapping(table, candidates)

    if (match === undefined) {
      sheets.set(index, {
        mapping: guessMapping(table),
        saved: undefined,
        changedColumns: NO_COLUMNS,
        dirty: false,
        editing: true,
        nameOverride: undefined,
      })
      return
    }

    const exact = match.comparison.kind === 'exact'
    sheets.set(index, {
      mapping: match.mapping,
      saved: {
        id: match.candidate.id,
        name: match.candidate.name,
        accountId: match.candidate.accountId,
      },
      changedColumns: exact ? NO_COLUMNS : match.comparison.changedColumns,
      dirty: false,
      editing: !exact,
      nameOverride: undefined,
    })
  })

  return sheets
}

function SheetBody({
  table,
  state,
  fileName,
  fileHash,
  showTypes,
  onPropose,
  proposing,
  proposeProblem,
  onDismissProposeProblem,
  onKeep,
  onNameChange,
  onRead,
  onEdit,
  onSetHeaderRow,
  onSetColumnRole,
  roles,
  onAddRole,
}: {
  table: SheetTable
  state: SheetMapping
  fileName: string
  fileHash: string | undefined
  showTypes: boolean
  onPropose: (() => void) | undefined
  proposing: boolean
  proposeProblem: string | undefined
  onDismissProposeProblem: () => void
  onKeep: (name: string) => string | undefined
  onNameChange: (name: string) => void
  onRead: (sheet: StatementSheet) => void
  onEdit: () => void
  onSetHeaderRow: (rowIndex: number) => void
  onSetColumnRole: (column: number, role: ColumnRoleId | undefined) => void
  roles: readonly ColumnRoleId[]
  onAddRole: (role: string) => string | undefined
}) {
  const { mapping } = state

  // Re-parsing the whole sheet on every mapping change is what makes the
  // preview live. These files are hundreds of rows, not hundreds of thousands.
  const parse = useMemo(() => {
    if (mapping === undefined) return undefined

    const missing = missingRequiredRoles(mapping)
    const rows = missing.length > 0 ? [] : applyMapping(table, mapping)
    const byRowIndex = new Map<number, ParsedRow>(rows.map((row) => [row.rowIndex, row]))

    return {
      missing,
      rows,
      byRowIndex,
      summary: summarize(rows),
      parsed: allParsed(rows),
      // Over every parsed row, not just the previewed few — this is the figure
      // the user compares against the total the statement prints.
      total: totalOf(allParsed(rows), mapping.defaultCurrency),
      firstError: rows.find((row) => row.outcome.kind === 'error'),
    }
  }, [table, mapping])

  if (mapping === undefined) {
    return (
      <>
        <div className="min-h-0 flex-1">
          <SheetGrid
            table={table}
            mapping={undefined}
            parsedRows={new Map()}
            changedColumns={NO_COLUMNS}
            showTypes={showTypes}
            onSetHeaderRow={onSetHeaderRow}
            onSetColumnRole={onSetColumnRole}
            roles={roles}
            onAddRole={onAddRole}
          />
        </div>
        <div className="shrink-0 border-t border-hairline px-6 py-3 text-ink-secondary">
          No row in this sheet looks like a header. Click a row number to say which one it is.
        </div>
      </>
    )
  }

  // Which card this file is for. A mapped column wins — it is a per-row fact —
  // but neither real file has one, so the fallback is the number the file
  // states about itself in its name or preamble. This is account identity, not
  // decoration: see D-033.
  const cardLast4 =
    parse?.parsed[0]?.cardLast4 ??
    statedCardLast4({ fileName, table, headerRowIndex: mapping.headerRowIndex })

  const suggestedName = defaultMappingName({
    fileName,
    table,
    headerRowIndex: mapping.headerRowIndex,
    cardLast4,
  })
  const name = state.nameOverride ?? state.saved?.name ?? suggestedName

  const preview = (
    <PreviewStrip
      transactions={firstParsed(
        parse?.rows ?? [],
        state.editing ? PREVIEW_ROWS_EDITING : PREVIEW_ROWS_COLLAPSED,
      )}
      summary={parse?.summary ?? { parsed: 0, errors: 0, skipped: 0 }}
      total={parse?.total ?? totalOf([], mapping.defaultCurrency)}
      missingRoles={parse?.missing ?? []}
      firstError={parse?.firstError}
    />
  )

  return (
    <>
      <MappingBar
        saved={state.saved}
        dirty={state.dirty}
        editing={state.editing}
        changedCount={state.changedColumns.size}
        name={name}
        onNameChange={onNameChange}
        onEdit={onEdit}
        onPropose={onPropose}
        proposing={proposing}
      />

      {proposeProblem !== undefined && (
        <div className="fc-pop-enter flex shrink-0 items-center gap-4 border-b border-hairline bg-surface px-6 py-2">
          <span className="text-negative">{proposeProblem}</span>
          <span className="text-caption text-ink-tertiary">
            Nothing changed. The columns below are still yours to set.
          </span>
          <button
            type="button"
            className="ml-auto text-caption text-ink-secondary hover:text-ink"
            onClick={onDismissProposeProblem}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* The grid is the mapper. Without it — an exact match, nothing to map —
          the parsed result takes the whole screen instead, which is the review
          the user actually came for. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {state.editing ? (
          <SheetGrid
            table={table}
            mapping={mapping}
            parsedRows={parse?.byRowIndex ?? new Map()}
            changedColumns={state.changedColumns}
            showTypes={showTypes}
            onSetHeaderRow={onSetHeaderRow}
            onSetColumnRole={onSetColumnRole}
            roles={roles}
            onAddRole={onAddRole}
          />
        ) : (
          preview
        )}
      </div>

      {state.editing && preview}

      <StageBar
        fileName={fileName}
        fileHash={fileHash}
        sheetName={table.name}
        // Only when the mapping on screen is the one in the database — which,
        // since Read it keeps the reader (M31 U2), it is by the time the sheet
        // leaves: `onRead` below puts the kept id in.
        mappingId={state.dirty ? undefined : state.saved?.id}
        // Where the user has said which card this format's files are for. Second
        // in line behind the number the file states about itself, and the answer
        // when it states none — see `resolveAccountForImport`.
        boundAccountId={state.saved?.accountId}
        // Named from the card's last-4 where the file supplies one, so two cards
        // in one file do not collapse into a single account.
        accountName={accountNameFor(cardLast4, name, fileName)}
        cardLast4={cardLast4}
        mappingName={name}
        table={table}
        mapping={mapping}
        rows={parse?.rows ?? []}
        transactions={parse?.parsed ?? []}
        onRead={(sheet) => {
          const kept = onKeep(name.trim() === '' ? suggestedName : name.trim())
          onRead({ ...sheet, mappingId: kept ?? sheet.mappingId })
        }}
      />
    </>
  )
}

function Toolbar({
  workbook,
  activeSheet,
  onPickSheet,
  table,
  mapping,
  onSetCurrency,
  showTypes,
  onToggleTypes,
  onDone,
}: {
  workbook: SheetWorkbook
  activeSheet: number
  onPickSheet: (index: number) => void
  table: SheetTable
  mapping: DraftMapping | undefined
  onSetCurrency: (currency: CurrencyCode) => void
  showTypes: boolean
  onToggleTypes: (show: boolean) => void
  onDone: () => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-hairline px-6 py-2 text-ink-secondary">
      {workbook.sheets.length > 1 && (
        <div className="flex gap-1">
          {workbook.sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              type="button"
              onClick={() => onPickSheet(index)}
              className={
                index === activeSheet
                  ? 'rounded border border-hairline bg-surface px-2 py-0.5 text-ink'
                  : 'rounded border border-transparent px-2 py-0.5 hover:border-hairline'
              }
            >
              <Bidi>{sheet.name}</Bidi>
            </button>
          ))}
        </div>
      )}

      <span className="tabular-nums">
        {table.rows.length} rows × {table.columnCount} columns
      </span>

      {mapping !== undefined && (
        <>
          <span className="tabular-nums">header row {mapping.headerRowIndex + 1}</span>
          <span>
            {mapping.amountConvention === 'POSITIVE_IS_CHARGE'
              ? 'positive means a charge'
              : 'amounts already signed'}
          </span>
          <CurrencyPicker value={mapping.defaultCurrency} onChange={onSetCurrency} />
        </>
      )}

      <label className="ml-auto flex items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={showTypes}
          onChange={(event) => onToggleTypes(event.target.checked)}
        />
        Show cell types
      </label>

      <button
        type="button"
        onClick={onDone}
        className="rounded border border-hairline px-2 py-0.5 hover:border-ink-tertiary"
      >
        Close
      </button>
    </div>
  )
}

/**
 * The currencies offered, beyond whatever the mapping already says.
 *
 * A short list rather than all of ISO 4217: these are what an Israeli card
 * statement is denominated in, and a select of 180 codes is a worse way to pick
 * one of five. A saved mapping carrying anything else keeps it — it is added to
 * the list below rather than being silently rewritten to the nearest offer.
 */
const CURRENCY_CHOICES: readonly CurrencyCode[] = ['ILS', 'USD', 'EUR', 'GBP', 'CHF', 'JPY']

/**
 * What the amounts are read as, where the file does not say per row.
 *
 * Guessed from the file (`guessDefaultCurrency`) and sat next to the amount
 * convention, because the two are one question — how to read the amount column
 * — and the guess for both is stated rather than hidden. Changing it marks the
 * mapping dirty, so it is saved with the columns and comes back with them.
 */
function CurrencyPicker({
  value,
  onChange,
}: {
  value: CurrencyCode
  onChange: (currency: CurrencyCode) => void
}) {
  const choices = CURRENCY_CHOICES.includes(value) ? CURRENCY_CHOICES : [value, ...CURRENCY_CHOICES]

  return (
    <label className="flex items-center gap-2" title="What amounts are in, unless a column says otherwise">
      currency
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${SELECT} text-ink`}
      >
        {choices.map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </select>
    </label>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p>{children}</p>
    </div>
  )
}
