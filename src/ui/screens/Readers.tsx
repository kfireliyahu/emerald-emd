import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { instantDay } from '@/core/instant.ts'
import { pairsThatReadAlike } from '@/data/importer/labelTemplate.ts'
import { headerCellsFromSignature } from '@/data/importer/signature.ts'
import { listAccounts, type Account } from '@/data/repositories/accountRepository.ts'
import { listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import { deleteTemplate, listTemplates, renameTemplate } from '@/data/repositories/documentTemplateRepository.ts'
import {
  deleteMapping,
  duplicateMapping,
  listMappings,
  renameMapping,
  setMappingAccount,
  type SavedMapping,
} from '@/data/repositories/importMappingRepository.ts'
import { deductionsOf, type DocumentTemplate } from '@/domain/model/templates.ts'
import { countKey } from '@/i18n/count.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { ConfirmAtButton } from '@/ui/components/ConfirmAtButton.tsx'
import { ContextMenu, isMenuKey, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { EmptyState } from '@/ui/components/WaitingList.tsx'
import { useFilePicker, useReadFiles } from '@/ui/home/parts.tsx'
import { labelFor, useRoleLabels } from '@/ui/import/roleLabel.ts'

/**
 * **Readers** — `#/read/readers` (M36 U10; the report since M64 U7, D-619).
 * One question: *how does Emerald know how to read each file?*
 *
 * **It answers first, in words** — how many readers, and that each reads one
 * kind of file on its own — then one list of them, a statement's, a paycheck's
 * and a fund report's alike, where four tabs and two lists used to draw them
 * apart (`Mappings.tsx` and `Formats.tsx` were this screen's halves, and are
 * folded in here). Its way back is one link, to Read files.
 *
 * **Where each thing opens (D-617)**: a name is renamed in place, on its line;
 * the account a statement's reader imports into is a popover on its line;
 * Delete asks at the button that asked, naming the reader (*Delete Everyday
 * card?*), because a deleted reader has no undo — never the bar at the foot of
 * the screen it was until M64. Nothing is created here: a reader is made by
 * reading a file of a new kind, and changed by reading one again, which is what
 * the sentence under the answer says.
 */
export function Readers() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const picker = useFilePicker(useReadFiles())
  const t = useT()
  const [editing, setEditing] = useState<string | undefined>()

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const mappings = listMappings(db)
    // Every current template, of every kind, confirmed or not: a proposal
    // nobody agreed to is still a row taking up space in the document.
    const templates = listTemplates(db)
    return {
      mappings,
      // Archived ones included: a mapping may be bound to a card that has been put away.
      accounts: listAccounts(db, { includeArchived: true }),
      // Two rows may claim one format — `duplicateMapping` makes exactly that.
      perSignature: countBySignature(mappings),
      templates,
      types: listDeductionTypes(db).length,
      alike: alikeNames(templates),
    }
  }, [db, revision])

  if (data === undefined) return <Centered>{t('reading.readers.noDocument')}</Centered>

  const count = data.mappings.length + data.templates.length
  // A row names its kind only when the list holds more than one kind.
  const kinds = new Set([...(data.mappings.length > 0 ? ['STATEMENT'] : []), ...data.templates.map((template) => template.kind)])
  const mixed = kinds.size > 1
  const rename = (id: string, was: string, name: string, write: (id: string, name: string) => void): void => {
    setEditing(undefined)
    if (name !== '' && name !== was) write(id, name)
  }

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-col gap-1">
          {/* One way back, to where readers are used (D-617's way out). */}
          <Link to="/read" className="fc-text-action inline-flex items-center gap-1 self-start">
            <ActionGlyph name="left" size={14} />
            {t('reading.readers.back')}
          </Link>
          <h1 className="m-0 text-title leading-tight font-medium">{t('reading.readers.title')}</h1>
        </header>

        {count === 0 ? (
          // *An empty state is one sentence* and one text action.
          <>
            <EmptyState say={t('reading.readers.empty')} verb={t('reading.readers.readFile')} onDo={picker.open} />
            {picker.input}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">
                {t(countKey('reading.readers.answer', count), { count })}
              </p>
              <span className="text-ink-secondary">{t('reading.readers.how')}</span>
            </div>

            <ul className="m-0 list-none border-t border-hairline p-0" data-block>
              {data.mappings.map((mapping) => (
                <ReaderRow
                  key={mapping.id}
                  t={t}
                  name={mapping.name}
                  editing={editing === mapping.id}
                  onEdit={() => setEditing(mapping.id)}
                  onRename={(name) =>
                    rename(mapping.id, mapping.name, name, (id, next) =>
                      mutate((database) => renameMapping(database, id, next, Date.now())),
                    )
                  }
                  kind={mixed ? t('reading.readers.kind.statement') : undefined}
                  marks={(data.perSignature.get(mapping.headerSignature) ?? 1) > 1 ? [t('reading.readers.shares')] : []}
                  beside={
                    <AccountBinding
                      t={t}
                      mapping={mapping}
                      accounts={data.accounts}
                      onBind={(accountId) =>
                        mutate((database) => setMappingAccount(database, mapping.id, accountId, Date.now()))
                      }
                    />
                  }
                  reads={<ColumnSummary t={t} mapping={mapping} />}
                  usage={usage(t, 'reading.readers.used', mapping.useCount, mapping.lastUsedAt)}
                  onDuplicate={() => {
                    let copyId: string | undefined
                    mutate((database) => {
                      copyId = duplicateMapping(database, mapping.id, Date.now())?.id
                    })
                    // Straight into the name field: the reason to make a copy is to call it something else.
                    setEditing(copyId)
                  }}
                  cost={t('reading.readers.confirmStatement')}
                  onDelete={() => mutate((database) => deleteMapping(database, mapping.id, Date.now()))}
                />
              ))}
              {data.templates.map((template) => {
                const alike = data.alike.get(template.id) ?? []
                return (
                  <ReaderRow
                    key={template.id}
                    t={t}
                    name={template.name}
                    editing={editing === template.id}
                    onEdit={() => setEditing(template.id)}
                    onRename={(name) =>
                      rename(template.id, template.name, name, (id, next) =>
                        mutate((database) => renameTemplate(database, id, next, Date.now())),
                      )
                    }
                    kind={mixed ? t(template.kind === 'PAYSLIP' ? 'reading.readers.kind.payslip' : 'reading.readers.kind.report') : undefined}
                    marks={[
                      ...(alike.length === 0
                        ? []
                        : [
                            alike.length === 1
                              ? t('reading.readers.readsLike', { name: alike[0] ?? '' })
                              : t('reading.readers.readsLikeMany', { count: alike.length }),
                          ]),
                    ]}
                    notes={[
                      ...(template.confirmedAt === undefined ? [t('reading.readers.proposal')] : []),
                      ...(template.version > 1 ? [t('reading.readers.version', { n: template.version })] : []),
                      t(`reading.readers.provenance.${template.derivedBy}`),
                      ...(template.kind === 'PAYSLIP' ? [deductionRows(t, template, data.types)] : []),
                    ]}
                    reads={<FieldSummary t={t} template={template} />}
                    usage={usage(t, 'reading.readers.read', template.useCount, template.lastUsedAt)}
                    cost={t(template.kind === 'PAYSLIP' ? 'reading.readers.confirmPayslip' : 'reading.readers.confirmReport')}
                    onDelete={() => mutate((database) => deleteTemplate(database, template.id, Date.now()))}
                  />
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One reader: its name (renamed in place — a click on it, or F2), its kind,
 * what it reads, when it last did, and Delete. Rename and Duplicate are also
 * its context menu (right-click, `Shift+F10`, the Menu key), as a row's are
 * everywhere; Delete stays on the row, where it asks.
 */
function ReaderRow({
  t,
  name,
  editing,
  onEdit,
  onRename,
  kind,
  marks,
  notes = [],
  beside,
  reads,
  usage,
  onDuplicate,
  cost,
  onDelete,
}: {
  t: Translate
  name: string
  editing: boolean
  onEdit: () => void
  onRename: (name: string) => void
  kind: string | undefined
  /** Problems worth acting on, the one thing on a row wearing a colour. */
  marks: readonly string[]
  notes?: readonly string[]
  beside?: ReactNode
  reads: ReactNode
  usage: string
  onDuplicate?: (() => void) | undefined
  cost: string
  onDelete: () => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | undefined>()
  const items: MenuItem[] = [
    { label: t('reading.readers.rename'), onChoose: onEdit, shortcut: 'F2' },
    ...(onDuplicate === undefined ? [] : [{ label: t('reading.readers.duplicate'), onChoose: onDuplicate }]),
  ]
  return (
    <li
      tabIndex={0}
      className="flex flex-col gap-1 border-b border-hairline py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('input') !== null) return
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('input') !== null) return
        if (event.key === 'F2') {
          event.preventDefault()
          onEdit()
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && event.target === event.currentTarget) {
          // Delete on the row asks at its own Delete button, as a click would.
          event.preventDefault()
          event.currentTarget.querySelector<HTMLButtonElement>('button[data-tone="negative"]')?.click()
        } else if (isMenuKey(event)) {
          event.preventDefault()
          const box = event.currentTarget.getBoundingClientRect()
          setMenu({ x: box.left + 24, y: box.top + 24 })
        }
      }}
    >
      {menu !== undefined && (
        <ContextMenu at={menu} items={items} onClose={() => setMenu(undefined)} header={{ title: <Bidi>{name}</Bidi> }} />
      )}
      <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
        {editing ? (
          <input
            autoFocus
            defaultValue={name}
            aria-label={t('reading.readers.renameName', { name })}
            onFocus={(event) => event.target.select()}
            onBlur={(event) => onRename(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') onRename(name)
            }}
            // A reader may well be named in Hebrew.
            dir="auto"
            className={`${FIELD} h-8 w-72`}
          />
        ) : (
          // Renamed as a file is: a double-click, F2, or Rename in its menu.
          <span onDoubleClick={onEdit} title={t('reading.readers.renameHint')} className="cursor-default">
            <Bidi className="font-medium">{name}</Bidi>
          </span>
        )}
        {kind !== undefined && <span className="fc-state">{kind}</span>}
        {marks.map((mark) => (
          <span key={mark} className="fc-state" data-tone="warn">
            <span className="fc-state-dot" />
            <Bidi>{mark}</Bidi>
          </span>
        ))}
        {beside}
        <span className="ms-auto flex items-center gap-1">
          <ConfirmAtButton
            label={t('reading.readers.deleteName', { name })}
            question={<Phrase text={t('reading.readers.confirm')} parts={{ name: <Bidi>{name}</Bidi> }} />}
            cost={cost}
            confirm={t('reading.readers.delete')}
            cancel={t('reading.readers.cancel')}
            onConfirm={onDelete}
          />
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption">
        {reads}
        <span className="ms-auto whitespace-nowrap text-ink-secondary tabular-nums">{usage}</span>
      </div>
      {notes.length > 0 && <span className="text-caption text-ink-secondary">{notes.join(' · ')}</span>}
    </li>
  )
}

/**
 * Which account a statement reader's files belong to — a fallback, never an
 * override: the card number a file states about itself still decides (D-033).
 * A popover on its line, since the whole interaction is picking one of a few.
 */
function AccountBinding({
  t,
  mapping,
  accounts,
  onBind,
}: {
  t: Translate
  mapping: SavedMapping
  accounts: readonly Account[]
  onBind: (accountId: string | undefined) => void
}) {
  // Nothing to bind to yet: say the behaviour rather than offer an empty choice.
  if (accounts.length === 0) return <span className="fc-state">{t('reading.readers.askEach')}</span>
  const choices = [
    { value: '', label: t('reading.readers.askEach') },
    // The last four once: a card named "Everyday Card 1234" is not "… 1234 ·1234" (M54 F4).
    ...accounts.map((account) => ({
      value: account.id,
      label:
        account.last4 === undefined || account.name.trimEnd().endsWith(account.last4)
          ? account.name
          : `${account.name} ·${account.last4}`,
    })),
  ]
  return (
    <span className="flex items-center gap-2 text-caption text-ink-secondary">
      {t('reading.readers.into')}
      <ChoiceMenu
      text={choices.find((each) => each.value === (mapping.accountId ?? ''))?.label ?? ''}
      choices={choices}
      onPick={(choice) => onBind(choice.value === '' ? undefined : choice.value)}
      aria-label={t('reading.readers.accountOf', { name: mapping.name })}
      dir="auto"
      className={`${SELECT} h-7 max-w-56 text-caption text-ink`}
      />
    </span>
  )
}

/**
 * What a statement reader reads, in the file's own words: the header cells come
 * back out of the signature (D-027), header → role, in sheet order. A header
 * that already says its role says it once.
 */
function ColumnSummary({ t, mapping }: { t: Translate; mapping: SavedMapping }) {
  const cells = headerCellsFromSignature(mapping.headerSignature)
  const roles = useRoleLabels()
  const columns = [...mapping.mapping.columnRoles].sort(([a], [b]) => a - b)
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {columns.map(([column, role], index) => {
        const label = labelFor(roles, role)
        const cell = cells?.[column]
        const header = cells === undefined ? t('reading.readers.column', { n: column + 1 }) : cell === '' || cell === label ? undefined : cell
        return (
          <span key={column} className="whitespace-nowrap">
            {index > 0 && <span className="me-2 text-ink-secondary">·</span>}
            {header !== undefined && (
              <>
                <Bidi className="text-ink-secondary">{header}</Bidi> <Arrow />{' '}
              </>
            )}
            <span className="text-ink">{label}</span>
          </span>
        )
      })}
    </span>
  )
}

/** The order a paycheck or a fund report prints its single fields in. */
const FIELD_ORDER = [
  'salaryMonthLine',
  'payDateLine',
  'grossLine',
  'employeeDeductionsTotalLine',
  'netLine',
  'asOfDateLine',
  'closingBalanceLine',
  'openingBalanceLine',
  'depositsLine',
  'yieldLine',
  'feesLine',
  'employeeComponentLine',
  'employerComponentLine',
  'severanceComponentLine',
] as const

type FieldName = (typeof FIELD_ORDER)[number]

/**
 * What a paycheck's or a fund report's reader reads, in the slip's own words:
 * the label each anchor carries, which is the whole of what a template stores
 * about where a field is (D-139). A field moved by hand says *yours*.
 */
function FieldSummary({ t, template }: { t: Translate; template: DocumentTemplate }) {
  const anchors = [...template.anchors.fields].sort((a, b) => order(a.field) - order(b.field))
  const pinned = new Set(template.pinnedFields)
  if (anchors.length === 0) return <span className="text-ink-secondary">{t('reading.readers.noFigure')}</span>
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {anchors.map((anchor, index) => (
        <span key={anchor.field} className="whitespace-nowrap">
          {index > 0 && <span className="me-2 text-ink-secondary">·</span>}
          <Bidi className="text-ink-secondary">{anchor.label}</Bidi> <Arrow />{' '}
          <span className="text-ink">
            {isField(anchor.field) ? t(`reading.readers.fields.${anchor.field}`) : anchor.field}
            {pinned.has(anchor.field) && <span className="text-ink-secondary"> · {t('reading.readers.yours')}</span>}
          </span>
        </span>
      ))}
    </span>
  )
}

function isField(field: string): field is FieldName {
  return (FIELD_ORDER as readonly string[]).includes(field)
}

function order(field: string): number {
  const at = (FIELD_ORDER as readonly string[]).indexOf(field)
  return at === -1 ? FIELD_ORDER.length : at
}

/** How many deduction rows a paycheck's reader finds, and how many it can already name (D-132, D-145). */
function deductionRows(t: Translate, template: DocumentTemplate, typeCount: number): string {
  const all = deductionsOf(template.anchors)
  if (all.length === 0) return t('reading.readers.deductions.none')
  const named = all.filter((row) => row.deductionTypeId !== undefined).length
  const rows = t(countKey('reading.readers.deductions.rows', all.length), { count: all.length })
  if (named === all.length) return t('reading.readers.deductions.allNamed', { rows })
  if (named === 0) {
    return typeCount === 0
      ? t('reading.readers.deductions.noneNamed', { rows })
      : t('reading.readers.deductions.noneNamedAsked', { rows })
  }
  return t('reading.readers.deductions.someNamed', { rows, named })
}

/** When it last did any work, and how much. Never used is worth saying out loud. */
function usage(
  t: Translate,
  key: 'reading.readers.used' | 'reading.readers.read',
  count: number,
  last: number | undefined,
): string {
  if (last === undefined) return t('reading.readers.neverUsed')
  return t(countKey(key, count), { count, day: instantDay(last) })
}

function countBySignature(mappings: readonly SavedMapping[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const mapping of mappings) counts.set(mapping.headerSignature, (counts.get(mapping.headerSignature) ?? 0) + 1)
  return counts
}

/**
 * For each template, the names of the ones close enough to compete with it for
 * the same slips — the matcher's own relation (`pairsThatReadAlike`). Two of
 * one name are one employer read two ways (D-148), and not that case.
 */
function alikeNames(templates: readonly DocumentTemplate[]): ReadonlyMap<string, readonly string[]> {
  const names = new Map<string, string[]>()
  for (const [one, other] of pairsThatReadAlike(templates)) {
    if (one.kind !== other.kind) continue
    if (one.name === other.name) continue
    names.set(one.id, [...(names.get(one.id) ?? []), other.name])
    names.set(other.id, [...(names.get(other.id) ?? []), one.name])
  }
  return names
}

/** Header → role: the arrow points the reading way, mirrored in Hebrew. */
function Arrow() {
  return <span className="inline-block text-ink-secondary rtl:-scale-x-100">→</span>
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
