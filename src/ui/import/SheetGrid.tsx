import { useState } from 'react'

import type { ParsedRow } from '@/data/importer/apply.ts'
import type { SheetCell, SheetCellKind, SheetTable } from '@/data/importer/sheetTable.ts'
import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import type { DraftMapping } from '@/domain/model/importing.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { labelFor, ROLE_LABEL } from './roleLabel.ts'

/**
 * The file preview as a full-width scrollable grid, and the surface the mapping
 * is edited on: click a row number to make it the header, pick a role for each
 * column. Raw cells stay in a mono face so stray spaces and directional marks
 * remain visible.
 *
 * This is the screen docs/f01-card-statement-import.md calls the reason the app
 * is desktop-first.
 */
export function SheetGrid({
  table,
  mapping,
  parsedRows,
  changedColumns,
  showTypes,
  roles,
  onSetHeaderRow,
  onSetColumnRole,
  onAddRole,
}: {
  table: SheetTable
  mapping: DraftMapping | undefined
  parsedRows: ReadonlyMap<number, ParsedRow>
  /** Columns that differ from the saved mapping's header — the reason this screen reopened. */
  changedColumns: ReadonlySet<number>
  showTypes: boolean
  /**
   * This document's statement vocabulary, in offer order (D-213). Passed in
   * rather than imported: a picker that listed the `const` could not offer a
   * role somebody added, which is the whole of what U1b is for.
   */
  roles: readonly ColumnRoleId[]
  onSetHeaderRow: (rowIndex: number) => void
  onSetColumnRole: (column: number, role: ColumnRoleId | undefined) => void
  /**
   * Add a role to this document, or say why not. `undefined` means it landed.
   *
   * Returns the sentence rather than throwing, because this is a person
   * mid-thought with a file open — the failure is a message beside the box.
   */
  onAddRole: (role: string) => string | undefined
}) {
  if (table.rows.length === 0) {
    return <p className="p-6 text-ink-secondary">This sheet is empty.</p>
  }

  const columns = Array.from({ length: table.columnCount }, (_, index) => index)

  return (
    <div className="h-full overflow-auto" tabIndex={0}>
      <table className="border-separate border-spacing-0 font-mono text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 border-r border-b border-hairline bg-surface px-2 py-1 text-right align-bottom font-normal text-ink-tertiary">
              #
            </th>
            {columns.map((column) => {
              const changed = changedColumns.has(column)
              return (
                <th
                  key={column}
                  className={`sticky top-0 z-20 border-r border-hairline bg-surface px-2 py-1 text-left align-bottom font-normal ${
                    // A changed column is genuine signal, which is the only
                    // thing colour is spent on here (docs/11): it is the column
                    // that would have been mis-parsed silently.
                    changed ? 'border-b-2 border-b-negative' : 'border-b border-hairline'
                  }`}
                >
                  <div className={changed ? 'text-negative' : 'text-ink-tertiary'}>
                    {columnLabel(column)}
                    {changed && ' · changed'}
                  </div>
                  <RolePicker
                    role={mapping?.columnRoles.get(column)}
                    roles={roles}
                    onChange={(role) => onSetColumnRole(column, role)}
                    onAddRole={onAddRole}
                  />
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <Row
              key={rowIndex}
              row={row}
              rowIndex={rowIndex}
              mapping={mapping}
              parsed={parsedRows.get(rowIndex)}
              showTypes={showTypes}
              onSetHeaderRow={onSetHeaderRow}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({
  row,
  rowIndex,
  mapping,
  parsed,
  showTypes,
  onSetHeaderRow,
}: {
  row: readonly SheetCell[]
  rowIndex: number
  mapping: DraftMapping | undefined
  parsed: ParsedRow | undefined
  showTypes: boolean
  onSetHeaderRow: (rowIndex: number) => void
}) {
  const isHeader = mapping?.headerRowIndex === rowIndex
  const isPreamble = mapping !== undefined && rowIndex < mapping.headerRowIndex
  const failed = parsed?.outcome.kind === 'error'
  const skipped = parsed?.outcome.kind === 'skipped'

  return (
    <tr className={isHeader ? 'bg-surface' : ''}>
      <th
        scope="row"
        className="sticky left-0 z-10 border-r border-b border-hairline bg-surface p-0 text-right font-normal tabular-nums"
      >
        <button
          type="button"
          onClick={() => onSetHeaderRow(rowIndex)}
          title={isHeader ? 'This is the header row' : 'Use this row as the header'}
          className={`w-full px-2 py-1 text-right hover:bg-hairline ${
            isHeader ? 'text-ink' : 'text-ink-tertiary'
          }`}
        >
          {rowIndex + 1}
        </button>
      </th>

      {row.map((cell, columnIndex) => (
        <Cell
          key={columnIndex}
          cell={cell}
          mapped={mapping?.columnRoles.has(columnIndex) ?? true}
          dimmed={isPreamble || skipped}
          header={isHeader}
          failed={failed}
          showTypes={showTypes}
        />
      ))}
    </tr>
  )
}

/** Numbers and dates right-align, the way a spreadsheet shows them. */
const NUMERIC: ReadonlySet<SheetCellKind> = new Set<SheetCellKind>(['number', 'date'])

const KIND_TAG: Readonly<Record<SheetCellKind, string>> = {
  empty: '',
  string: 'txt',
  number: 'num',
  boolean: 'bool',
  date: 'date',
  error: 'err',
}

function Cell({
  cell,
  mapped,
  dimmed,
  header,
  failed,
  showTypes,
}: {
  cell: SheetCell
  mapped: boolean
  dimmed: boolean
  header: boolean
  failed: boolean
  showTypes: boolean
}) {
  const numeric = NUMERIC.has(cell.kind)

  // An unmapped column is greyed rather than hidden: the data is still there,
  // it just is not being read. Hiding it would make a mis-mapping invisible.
  const tone = cell.kind === 'error' || failed
    ? 'text-negative'
    : !mapped || dimmed
      ? 'text-ink-tertiary'
      : 'text-ink'

  return (
    <td
      title={cell.text === '' ? undefined : cell.text}
      className={[
        'max-w-[36ch] overflow-hidden border-r border-b border-hairline px-2 py-1 text-ellipsis whitespace-pre',
        numeric ? 'text-right tabular-nums' : 'text-left',
        header ? 'font-medium' : '',
        tone,
      ].join(' ')}
    >
      {showTypes && cell.kind !== 'empty' && (
        <span className="mr-1 align-top text-[9px] tracking-wide text-ink-tertiary select-none">
          {KIND_TAG[cell.kind]}
        </span>
      )}
      {cell.kind === 'empty' ? null : <Bidi>{cell.text}</Bidi>}
    </td>
  )
}

/**
 * A native select, deliberately. It is keyboard-navigable and screen-reader
 * correct for free, it shows the current role without a hover, and this app
 * takes no component-library dependency (docs/03).
 */
function RolePicker({
  role,
  roles,
  onChange,
  onAddRole,
}: {
  role: ColumnRoleId | undefined
  roles: readonly ColumnRoleId[]
  onChange: (role: ColumnRoleId | undefined) => void
  onAddRole: (role: string) => string | undefined
}) {
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)

  /**
   * **The affordance is where the gap is discovered** (D-213). Somebody looking
   * at a column this build has no name for is looking at this select; making
   * them leave for a settings screen is how a feature goes unused.
   */
  const add = (): void => {
    const rejection = onAddRole(draft)
    setProblem(rejection)
    if (rejection !== undefined) return
    onChange(draft.trim())
    setDraft('')
    setNaming(false)
  }

  if (naming) {
    return (
      <div className="mt-0.5 flex w-full min-w-[132px] flex-col gap-0.5">
        <input
          autoFocus
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setProblem(undefined)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
            if (event.key === 'Escape') {
              setNaming(false)
              setProblem(undefined)
            }
          }}
          placeholder="settlementDate"
          aria-label="New column role"
          className="w-full rounded border border-hairline bg-background px-1 py-0.5 font-mono text-xs text-ink"
        />
        <div className="flex gap-1">
          <button type="button" onClick={add} className="text-accent text-caption hover:underline">
            add
          </button>
          <button
            type="button"
            onClick={() => {
              setNaming(false)
              setProblem(undefined)
            }}
            className="text-caption text-ink-tertiary hover:underline"
          >
            cancel
          </button>
        </div>
        {problem !== undefined && <p className="text-caption text-negative">{problem}</p>}
      </div>
    )
  }

  return (
    <select
      value={role ?? ''}
      onChange={(event) => {
        if (event.target.value === ADD) {
          setNaming(true)
          return
        }
        onChange(event.target.value === '' ? undefined : event.target.value)
      }}
      aria-label="Column role"
      // `title` as a safety net for the one or two role names long enough to
      // clip even at the widened size.
      title={role === undefined ? 'ignore' : labelFor(ROLE_LABEL, role)}
      // The minimum lives on the select rather than the cell: a min-width on
      // the `th` is eaten by its padding, and the select then fills only what
      // is left. Widening the select is what actually forces the column open,
      // and reading the mapping off the header is this screen's whole job.
      // Sized in px, not `ch`: a select does not resolve `ch` against the font
      // it is displaying, so a ch-based minimum lands well short.
      className={`mt-0.5 w-full cursor-pointer rounded border border-hairline bg-background px-1 py-0.5 font-mono text-xs ${
        role === undefined ? 'min-w-[56px] text-ink-tertiary' : 'min-w-[132px] text-ink'
      }`}
    >
      <option value="">ignore</option>
      {roles.map((option) => (
        <option key={option} value={option}>
          {labelFor(ROLE_LABEL, option)}
        </option>
      ))}
      <option value={ADD}>— add a role —</option>
    </select>
  )
}

/**
 * The sentinel the select uses for "none of these fit".
 *
 * A value no role can have: `ROLE_PATTERN` refuses everything but a
 * lowerCamelCase identifier, so nothing a person can type collides with it.
 */
const ADD = ' add'

/** 0 → A, 25 → Z, 26 → AA. The reference a spreadsheet puts on its columns. */
function columnLabel(index: number): string {
  let label = ''
  let remaining = index
  while (remaining >= 0) {
    label = String.fromCharCode(65 + (remaining % 26)) + label
    remaining = Math.floor(remaining / 26) - 1
  }
  return label
}
