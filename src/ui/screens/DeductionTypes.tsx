import { useEffect, useMemo, useRef, useState } from 'react'

import { Link, useLocation } from 'react-router-dom'
import type { Database } from 'sql.js'

import { fromMajorUnits } from '@/core/money.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import {
  createDeductionType,
  deductionTypeUsageCounts,
  deleteDeductionType,
  listDeductionTypes,
  reorderDeductionTypes,
  updateDeductionType,
} from '@/data/repositories/deductionTypeRepository.ts'
import { createDebt, listDebts } from '@/data/repositories/debtRepository.ts'
import { syncPayroll } from '@/data/repositories/payrollSyncRepository.ts'
import { createFund, listFunds } from '@/data/repositories/fundRepository.ts'
import { createGoal, listGoals } from '@/data/repositories/savingsRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import type { Debt } from '@/domain/model/debt.ts'
import type { FundAccount } from '@/domain/model/funds.ts'
import type { SavingGoal } from '@/domain/model/savings.ts'
import { DEDUCTION_KINDS, type DeductionKind, type DeductionType } from '@/domain/model/paycheck.ts'
import { defaultFlags, flagsAsGuessed, guessDestination, kindChange } from '@/domain/paycheckEntry.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { NewByName, SelectOrNew } from '@/ui/components/SelectOrNew.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { today } from '@/ui/today.ts'

/**
 * **Deduction types** — the report (M64 U8, D-620). One question: *what does
 * each line on my payslip mean?* The payroll vocabulary, and the two flags
 * that decide what every paycheck figure means — a **view of Paychecks**
 * rather than a setting since D-170.
 *
 * `reducesNet` decides whether an amount comes out of take-home pay, and
 * `countsAsSaving` whether it is wealth or spending; get either wrong and the
 * reconciliation, the savings rate and total compensation are quietly wrong
 * together. **They are a guess to confirm** (M36 U11): the kind guesses them,
 * and a row says them in words.
 *
 * **The table reads; a row opens its form beside it** (D-617): name, what the
 * paycheck prints, kind, what it counts as, what it pays into, its order. The
 * one value changed on the line itself is the link a row most likely wants —
 * *Pension fund?* links it in one click. A built-in can be edited and
 * reordered but never deleted (D-049); a type the user added deletes at once
 * while no paycheck names it, with Undo where it happened.
 *
 * **Pays into** (D-073, D-085): a fund or a goal where the money is still
 * yours (the `Saving` flag), a debt where the kind is a repayment; one
 * destination per line, so picking one clears the others in the same write,
 * and an existing link always shows whatever the flags now say.
 */
export function DeductionTypes() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const t = useT()
  const landing = useLocation().state as { readonly open?: string } | null

  const [problem, setProblem] = useState<string | undefined>()
  const [panel, setPanel] = useState<TypePanel | undefined>(() =>
    landing?.open === undefined ? undefined : { kind: 'type', id: landing.open },
  )
  /** The type just deleted from the table, for the Undo in the row where it stood. */
  const [deleted, setDeleted] = useState<{ readonly type: DeductionType; readonly order: readonly string[] } | undefined>()
  /** A row whose Delete was refused, to say why on the row. */
  const [refused, setRefused] = useState<string | undefined>()
  // Ctrl+Z undoes the last delete, as anywhere; a ref, so the listener is set once.
  const undoRef = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && undoRef.current !== undefined) {
        event.preventDefault()
        undoRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const types = useMemo(() => (db === undefined ? [] : listDeductionTypes(db)), [db, revision])
  const usage = useMemo(() => (db === undefined ? new Map<string, number>() : deductionTypeUsageCounts(db)), [db, revision])
  // Archived funds, closed goals and closed debts included: a type may already
  // point at one, and a list that could not name it would show a real link as
  // "not linked" and invite clearing it by accident.
  const funds = useMemo(() => (db === undefined ? [] : listFunds(db, { includeArchived: true })), [db, revision])
  const goals = useMemo(() => (db === undefined ? [] : listGoals(db, { includeClosed: true })), [db, revision])
  const debts = useMemo(() => (db === undefined ? [] : listDebts(db, { includeClosed: true })), [db, revision])

  if (db === undefined) {
    return <Centered>{t('paychecks.types.noDocument')}</Centered>
  }

  const write = (work: (database: Database, now: number) => void, keepUndo = false): boolean => {
    setProblem(undefined)
    setRefused(undefined)
    // Undo is for the last thing done: any other write after a delete takes it away.
    if (!keepUndo) setDeleted(undefined)
    try {
      mutate((database) => work(database, Date.now()))
      return true
    } catch (error) {
      // A refusal is information: it is how the user finds out a name is taken.
      setProblem(error instanceof Error ? error.message : String(error))
      return false
    }
  }
  const link = (type: DeductionType, destination: Destination): void => {
    write((database, now) => {
      updateDeductionType(database, type.id, destination, now)
      // The payoff for linking a goal or a debt is the deposits and payments it
      // derives, and they should exist before anyone goes looking; idempotent.
      syncPayroll(database, now)
    })
  }
  const move = (id: string, direction: -1 | 1): void => {
    const order = types.map((type) => type.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    const reordered = [...order]
    const [moved] = reordered.splice(from, 1)
    if (moved !== undefined) reordered.splice(to, 0, moved)
    write((database, now) => reorderDeductionTypes(database, reordered, now))
  }
  /** Deletes at once, and keeps what it was and where it stood for Undo — in the panel or the row it came from. */
  const remove = (type: DeductionType, from: 'row' | 'panel'): void => {
    if (type.isBuiltIn || (usage.get(type.id) ?? 0) > 0) {
      setRefused(type.id)
      return
    }
    const order = types.map((one) => one.id)
    if (!write((database, now) => deleteDeductionType(database, type.id, now), true)) return
    if (from === 'panel') setPanel({ kind: 'deleted', type, order })
    else setDeleted({ type, order })
  }
  const undo = (gone: DeductionType, order: readonly string[], from: 'row' | 'panel'): void => {
    let id: string | undefined
    const ok = write((database, now) => {
      id = createDeductionType(
        database,
        {
          name: gone.name,
          hebrewName: gone.hebrewName,
          kind: gone.kind,
          reducesNet: gone.reducesNet,
          countsAsSaving: gone.countsAsSaving,
          linkedFundId: gone.linkedFundId,
          linkedSavingGoalId: gone.linkedSavingGoalId,
          linkedDebtId: gone.linkedDebtId,
        },
        now,
      ).id
      // Back where it stood, not at the end.
      const back = id
      reorderDeductionTypes(database, order.map((one) => (one === gone.id ? back : one)), now)
      syncPayroll(database, now)
    })
    // Back in its panel only when it was deleted from there: the table's undo stays in the table.
    if (ok && id !== undefined && from === 'panel') setPanel({ kind: 'type', id })
  }
  undoRef.current =
    panel?.kind === 'deleted'
      ? () => undo(panel.type, panel.order, 'panel')
      : deleted === undefined
        ? undefined
        : () => undo(deleted.type, deleted.order, 'row')

  const usedTypes = types.filter((type) => (usage.get(type.id) ?? 0) > 0)
  const used = usedTypes.length
  // The row a delete from the table left, in the place it stood.
  const at = deleted === undefined ? -1 : deleted.order.indexOf(deleted.type.id)
  const open = panel?.kind === 'type' ? types.find((type) => type.id === panel.id) : undefined

  const page = (
    <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="m-0 text-title leading-tight font-medium">{t('paychecks.types.title')}</h1>
        <Button variant="primary" icon="add" onClick={() => setPanel({ kind: 'new' })}>
          {t('paychecks.types.add')}
        </Button>
      </header>

      <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">
        {used === 0
          ? t('paychecks.types.sentenceNone', { count: types.length })
          : t('paychecks.types.sentence', { used, net: usedTypes.filter((type) => type.reducesNet).length, saving: usedTypes.filter((type) => type.countsAsSaving).length })}
      </p>

      {problem !== undefined && (
        <p className="fc-pop-enter m-0 flex flex-wrap items-baseline gap-x-3 text-ink-secondary">
          <span aria-hidden className="inline-block size-2 rounded-full bg-negative" />
          <span className="text-ink">{problem}</span>
          <button type="button" className="fc-text-action" onClick={() => setProblem(undefined)}>
            {t('paychecks.month.dismiss')}
          </button>
        </p>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-hairline text-caption text-ink-secondary uppercase">
            <th className="h-8 px-3 text-start font-medium">{t('paychecks.types.name')}</th>
            <th className="h-8 px-3 text-start font-medium">{t('paychecks.types.kind')}</th>
            <th className="h-8 px-3 text-start font-medium">{t('paychecks.types.countsAs')}</th>
            <th className="h-8 px-3 text-start font-medium">{t('paychecks.types.paysInto')}</th>
            <th className="h-8 px-3 text-end font-medium">{t('paychecks.types.used')}</th>
          </tr>
        </thead>
        <tbody>
          {types.map((type, index) => (
            <Row
              key={type.id}
              type={type}
              before={index === at && deleted !== undefined ? <DeletedRow name={deleted.type.name} onUndo={() => undo(deleted.type, deleted.order, 'row')} /> : undefined}
              usedBy={usage.get(type.id) ?? 0}
              on={open?.id === type.id}
              stop={(open === undefined ? index === 0 : open.id === type.id)}
              refused={refused === type.id}
              funds={funds}
              goals={goals}
              debts={debts}
              onOpen={() => setPanel({ kind: 'type', id: type.id })}
              onLink={(destination) => link(type, destination)}
              onDelete={() => remove(type, 'row')}
            />
          ))}
          {deleted !== undefined && at >= types.length && <DeletedRow name={deleted.type.name} onUndo={() => undo(deleted.type, deleted.order, 'row')} />}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>
      {panel?.kind === 'new' && (
        <SidePanel title={t('paychecks.types.newTitle')} onClose={() => setPanel(undefined)}>
          <NewTypeForm
            onCreate={(name, kind) => {
              let id: string | undefined
              const ok = write((database, now) => {
                id = createDeductionType(database, { name, kind, ...defaultFlags(kind) }, now).id
              })
              if (ok && id !== undefined) setPanel({ kind: 'type', id })
            }}
            onCancel={() => setPanel(undefined)}
          />
        </SidePanel>
      )}
      {panel?.kind === 'deleted' && (
        <SidePanel kicker={panel.type.name} title={t('paychecks.types.title')} onClose={() => setPanel(undefined)}>
          <p className="m-0 flex flex-wrap items-baseline gap-x-3">
            <Phrase text={t('paychecks.types.deleted')} parts={{ name: <Bidi>{panel.type.name}</Bidi> }} />
            <button type="button" className="fc-text-action" onClick={() => undo(panel.type, panel.order, 'panel')}>
              {t('paychecks.types.undo')}
            </button>
          </p>
        </SidePanel>
      )}
      {open !== undefined && (
        <SidePanel kicker={t('paychecks.types.title')} title={<Bidi>{open.name}</Bidi>} onClose={() => setPanel(undefined)}>
          <TypeForm
            key={open.id}
            type={open}
            usedBy={usage.get(open.id) ?? 0}
            first={types[0]?.id === open.id}
            last={types.at(-1)?.id === open.id}
            funds={funds}
            goals={goals}
            debts={debts}
            onRename={(name, hebrewName) => write((database, now) => updateDeductionType(database, open.id, { name, hebrewName }, now))}
            // The flags follow the kind while they are still its guess (M36 U11).
            onKind={(kind) => write((database, now) => updateDeductionType(database, open.id, kindChange(open, kind), now))}
            onFlags={(flags) => write((database, now) => updateDeductionType(database, open.id, flags, now))}
            onLink={(destination) => link(open, destination)}
            onMove={(direction) => move(open.id, direction)}
            onDelete={() => remove(open, 'panel')}
          />
        </SidePanel>
      )}
    </div>
  )
}

/** What the panel holds: a type's form, a new one's, or a delete to undo. */
type TypePanel =
  | { readonly kind: 'type'; readonly id: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'deleted'; readonly type: DeductionType; readonly order: readonly string[] }

/** A row reads; it opens its form, Enter too. Up and Down walk the rows, and Delete deletes one nothing uses. */
function Row({
  type,
  before,
  usedBy,
  on,
  stop,
  refused,
  funds,
  goals,
  debts,
  onOpen,
  onLink,
  onDelete,
}: {
  readonly type: DeductionType
  /** A row drawn before this one: a delete's note, where the deleted row stood. */
  readonly before?: React.ReactNode
  readonly usedBy: number
  readonly on: boolean
  /** The table's one stop in the tab order; the arrows walk the rest. */
  readonly stop: boolean
  /** Its Delete was refused: say why on the row. */
  readonly refused: boolean
  readonly funds: readonly FundAccount[]
  readonly goals: readonly SavingGoal[]
  readonly debts: readonly Debt[]
  readonly onOpen: () => void
  readonly onLink: (destination: Destination) => void
  readonly onDelete: () => void
}) {
  const t = useT()
  return (
    <>
    {before}
    <tr
      tabIndex={stop ? 0 : -1}
      aria-current={on ? 'true' : undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a') === null) onOpen()
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const next = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling
          if (next instanceof HTMLElement) {
            event.preventDefault()
            next.focus()
          }
        }
        if (event.key === 'Enter') onOpen()
        if (event.key === 'Delete') {
          event.preventDefault()
          // Focus stays in the list: on the row after, or the one before at the end.
          const after = event.currentTarget.nextElementSibling ?? event.currentTarget.previousElementSibling
          onDelete()
          if (!refused && after instanceof HTMLElement) after.focus()
        }
      }}
      className={`h-10 cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-micro)] ${on ? 'fc-row-on' : 'hover:bg-surface'}`}
    >
      <td className="px-3 py-1.5">
        <span className="flex flex-col items-start">
          <Bidi>{type.name}</Bidi>
          {type.hebrewName !== undefined && type.hebrewName !== type.name && (
            <Bidi className="text-caption text-ink-secondary">{type.hebrewName}</Bidi>
          )}
          {refused && (
            <span className="text-caption text-ink-secondary" role="status">
              {type.isBuiltIn ? t('paychecks.types.builtInKept') : t(countKey('paychecks.types.inUse', usedBy), { count: usedBy })}
            </span>
          )}
        </span>
      </td>
      <td className="px-3 text-ink-secondary">{t(`paychecks.types.kinds.${type.kind}`)}</td>
      <td className="px-3 text-ink-secondary">{countsAs(type, t)}</td>
      <td className="px-3">
        <PaysInto type={type} funds={funds} goals={goals} debts={debts} onLink={onLink} />
      </td>
      <td className="px-3 text-end text-ink-secondary tabular-nums">{usedBy === 0 ? '—' : usedBy}</td>
    </tr>
    </>
  )
}

/** Where a type deleted from the table stood: its name, that it is deleted, and Undo. */
function DeletedRow({ name, onUndo }: { readonly name: string; readonly onUndo: () => void }) {
  const t = useT()
  return (
    <tr tabIndex={-1} className="h-10 border-b border-hairline text-ink-secondary">
      <td className="px-3" colSpan={4}>
        <Phrase text={t('paychecks.types.deleted')} parts={{ name: <Bidi>{name}</Bidi> }} />
      </td>
      <td className="px-3 text-end">
        <button type="button" className="fc-text-action" onClick={onUndo} title={t('paychecks.list.undoTitle')}>
          {t('paychecks.types.undo')}
        </button>
      </td>
    </tr>
  )
}

function countsAs(type: Pick<DeductionType, 'reducesNet' | 'countsAsSaving'>, t: ReturnType<typeof useT>): string {
  if (type.reducesNet && type.countsAsSaving) return t('paychecks.types.countsAsWords.both')
  if (type.reducesNet) return t('paychecks.types.countsAsWords.net')
  if (type.countsAsSaving) return t('paychecks.types.countsAsWords.saving')
  return t('paychecks.types.countsAsWords.neither')
}

/** What a row pays into, said: the link, or the one it most likely wants as one click, or nothing it could. */
function PaysInto({
  type,
  funds,
  goals,
  debts,
  onLink,
}: {
  readonly type: DeductionType
  readonly funds: readonly FundAccount[]
  readonly goals: readonly SavingGoal[]
  readonly debts: readonly Debt[]
  readonly onLink: (destination: Destination) => void
}) {
  const t = useT()
  const linked =
    funds.find((fund) => fund.id === type.linkedFundId)?.name ??
    goals.find((goal) => goal.id === type.linkedSavingGoalId)?.name ??
    debts.find((debt) => debt.id === type.linkedDebtId)?.name
  if (linked !== undefined) return <Bidi>{linked}</Bidi>
  if (!type.countsAsSaving && type.kind !== 'LOAN_REPAYMENT') return <span className="text-ink-secondary">—</span>
  // An unlinked line names what it most likely pays into, to confirm (M36 U11).
  const guess = guessDestination(type, funds, debts)
  const guessName =
    guess === undefined ? undefined : guess.kind === 'fund' ? funds.find((one) => one.id === guess.id)?.name : debts.find((one) => one.id === guess.id)?.name
  if (guess === undefined || guessName === undefined) return <span className="text-ink-secondary">{t('paychecks.types.notLinked')}</span>
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-ink-secondary">{t('paychecks.types.notLinked')}</span>
      <button
        type="button"
        className="fc-text-action"
        title={t('paychecks.types.linkGuessTitle', { type: type.name, name: guessName })}
        onClick={() => onLink(parseDestination(`${guess.kind}:${guess.id}`))}
      >
        <Phrase text={t('paychecks.types.linkGuess')} parts={{ name: <Bidi>{guessName}</Bidi> }} />
      </button>
    </span>
  )
}

/** A type's form, beside the table: every field writes as it is left, so there is nothing to save. */
function TypeForm({
  type,
  usedBy,
  first,
  last,
  funds,
  goals,
  debts,
  onRename,
  onKind,
  onFlags,
  onLink,
  onMove,
  onDelete,
}: {
  readonly type: DeductionType
  readonly usedBy: number
  readonly first: boolean
  readonly last: boolean
  readonly funds: readonly FundAccount[]
  readonly goals: readonly SavingGoal[]
  readonly debts: readonly Debt[]
  readonly onRename: (name: string, hebrewName: string | undefined) => void
  readonly onKind: (kind: DeductionKind) => void
  readonly onFlags: (flags: { reducesNet?: boolean; countsAsSaving?: boolean }) => void
  readonly onLink: (destination: Destination) => void
  readonly onMove: (direction: -1 | 1) => void
  readonly onDelete: () => void
}) {
  const t = useT()
  // Text writes when the field is left or Enter is pressed, never per letter: a
  // write snapshots the whole document.
  const [name, setName] = useState(type.name)
  const [hebrewName, setHebrewName] = useState(type.hebrewName ?? '')
  const [kindText, setKindText] = useState(t(`paychecks.types.kinds.${type.kind}`))
  const commit = (): void => {
    const trimmed = name.trim()
    const hebrew = hebrewName.trim()
    if (trimmed === '') {
      setName(type.name)
      return
    }
    if (trimmed === type.name && hebrew === (type.hebrewName ?? '')) return
    onRename(trimmed, hebrew === '' ? undefined : hebrew)
  }
  const keys = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur()
    // Esc closes the panel, as everywhere; what was typed is kept, not lost.
    if (event.key === 'Escape') commit()
  }
  const canDelete = !type.isBuiltIn && usedBy === 0

  return (
    <>
      <Field label={t('paychecks.types.name')}>
        <input value={name} onChange={(event) => setName(event.target.value)} onBlur={commit} onKeyDown={keys} dir="auto" className={FIELD} />
      </Field>
      <Field label={t('paychecks.types.printed')} hint={t('paychecks.types.printedHint')}>
        <input value={hebrewName} onChange={(event) => setHebrewName(event.target.value)} onBlur={commit} onKeyDown={keys} dir="auto" className={FIELD} />
      </Field>
      <Field label={t('paychecks.types.kind')}>
        <ChoiceField
          text={kindText}
          filter={false}
          openOnFocus
          choices={DEDUCTION_KINDS.map((kind) => ({ value: kind, label: t(`paychecks.types.kinds.${kind}`) }))}
          onText={setKindText}
          onPick={(choice) => {
            setKindText(choice.label)
            onKind(choice.value as DeductionKind)
          }}
          aria-label={t('paychecks.types.kind')}
          className={FIELD}
        />
      </Field>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-label text-ink-secondary uppercase">{t('paychecks.types.countsAs')}</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 accent-ink" checked={type.reducesNet} onChange={(event) => onFlags({ reducesNet: event.target.checked })} />
          <span className="flex flex-col">
            {t('paychecks.types.outOfNet')}
            <span className="text-caption text-ink-secondary">{t('paychecks.types.outOfNetHint')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 accent-ink" checked={type.countsAsSaving} onChange={(event) => onFlags({ countsAsSaving: event.target.checked })} />
          <span className="flex flex-col">
            {t('paychecks.types.saving')}
            <span className="text-caption text-ink-secondary">{t('paychecks.types.savingHint')}</span>
          </span>
        </label>
        <span className="text-caption text-ink-secondary">
          {flagsAsGuessed(type) ? t('paychecks.types.guessed') : t('paychecks.types.setByHand')}
        </span>
      </fieldset>
      <Field
        label={t('paychecks.types.paysInto')}
        hint={
          type.countsAsSaving || type.kind === 'LOAN_REPAYMENT' || type.linkedFundId !== undefined || type.linkedSavingGoalId !== undefined || type.linkedDebtId !== undefined
            ? t('paychecks.types.paysIntoHint')
            : undefined
        }
      >
        <DestinationLink type={type} funds={funds} goals={goals} debts={debts} onLink={onLink} />
      </Field>
      <div className="flex flex-col gap-1">
        <span className="text-label text-ink-secondary uppercase">{t('paychecks.types.order')}</span>
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={first} onClick={() => onMove(-1)}>
            {t('paychecks.types.up')}
          </Button>
          <Button variant="secondary" size="sm" disabled={last} onClick={() => onMove(1)}>
            {t('paychecks.types.down')}
          </Button>
        </span>
      </div>
      <div className="flex flex-col gap-1 border-t border-hairline pt-4">
        {canDelete ? (
          <span>
            <Button variant="secondary" size="sm" icon="trash" onClick={onDelete} title={t('paychecks.types.deleteTitle', { name: type.name })}>
              {t('paychecks.types.delete')}
            </Button>
          </span>
        ) : (
          // Said rather than hidden: which of the two rules stopped it is the point (D-049).
          <span className="text-ink-secondary">
            {type.isBuiltIn ? t('paychecks.types.builtInKept') : t(countKey('paychecks.types.inUse', usedBy), { count: usedBy })}
          </span>
        )}
      </div>
    </>
  )
}

function Field({ label, hint, children }: { readonly label: string; readonly hint?: string | undefined; readonly children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label text-ink-secondary uppercase">{label}</span>
      {children}
      {hint !== undefined && <span className="text-caption text-ink-secondary">{hint}</span>}
    </label>
  )
}

/** A new type: its name and its kind; the flags follow the kind, and its form opens to say the rest. */
function NewTypeForm({ onCreate, onCancel }: { readonly onCreate: (name: string, kind: DeductionKind) => void; readonly onCancel: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<DeductionKind>('OTHER_DEDUCTION')
  const [kindText, setKindText] = useState(t('paychecks.types.kinds.OTHER_DEDUCTION'))
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (trimmed !== '') onCreate(trimmed, kind)
      }}
    >
      <Field label={t('paychecks.types.name')}>
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t('paychecks.types.newName')} dir="auto" className={FIELD} />
      </Field>
      <Field label={t('paychecks.types.kind')}>
        <ChoiceField
          text={kindText}
          filter={false}
          openOnFocus
          choices={DEDUCTION_KINDS.map((one) => ({ value: one, label: t(`paychecks.types.kinds.${one}`) }))}
          onText={setKindText}
          onPick={(choice) => {
            setKindText(choice.label)
            setKind(choice.value as DeductionKind)
          }}
          aria-label={t('paychecks.types.kind')}
          className={FIELD}
        />
      </Field>
      <span className="flex gap-2">
        <Button variant="secondary" size="sm" type="submit" disabled={name.trim() === ''}>
          {t('paychecks.types.create')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('paychecks.types.cancel')}
        </Button>
      </span>
    </form>
  )
}

/**
 * Where this type's money goes — a fund, a goal or a debt, in one choice.
 *
 * **One question, not three columns**: picking one clears the others in the
 * same write, so a line cannot feed a fund *and* a goal and be counted twice.
 * Offered where it makes sense — a fund or a goal on a saving line, a debt on
 * a repayment — and an existing link always shows whatever the flags now say,
 * because a hidden link would go on producing contributions from behind it.
 */
function DestinationLink({
  type,
  funds,
  goals,
  debts,
  onLink,
}: {
  readonly type: DeductionType
  readonly funds: readonly FundAccount[]
  readonly goals: readonly SavingGoal[]
  readonly debts: readonly Debt[]
  readonly onLink: (destination: Destination) => void
}) {
  const t = useT()
  const linkedFund = funds.find((fund) => fund.id === type.linkedFundId)
  const linkedGoal = goals.find((goal) => goal.id === type.linkedSavingGoalId)
  const linkedDebt = debts.find((debt) => debt.id === type.linkedDebtId)
  const isLinked = linkedFund !== undefined || linkedGoal !== undefined || linkedDebt !== undefined
  const canSave = type.countsAsSaving
  const canRepay = type.kind === 'LOAN_REPAYMENT'
  if (!canSave && !canRepay && !isLinked) return <span className="text-ink-secondary">{t('paychecks.types.paysIntoNone')}</span>

  const offeredFunds = canSave || linkedFund !== undefined ? funds : []
  const offeredGoals = canSave || linkedGoal !== undefined ? goals : []
  const offeredDebts = canRepay || linkedDebt !== undefined ? debts : []
  const value =
    linkedFund !== undefined ? `fund:${linkedFund.id}` : linkedGoal !== undefined ? `goal:${linkedGoal.id}` : linkedDebt !== undefined ? `debt:${linkedDebt.id}` : ''

  return (
    <span className="flex flex-col gap-1">
      {/* **+ New… makes what the line pays into, here** (M36 U10): a fund or a goal
          for a saving, a debt for a repayment — chosen as soon as it is made. */}
      <SelectOrNew
        value={value}
        onChange={(chosen) => onLink(parseDestination(chosen))}
        newForm={(done) =>
          canRepay ? (
            <NewDebt done={done} />
          ) : (
            <NewByName<'fund' | 'goal'>
              noun={t('paychecks.types.fundOrGoal')}
              kinds={[
                ['fund', t('paychecks.types.aFund')],
                ['goal', t('paychecks.types.aGoal')],
              ]}
              make={(db, name, kind, now) => makeDestination(db, type, name, kind ?? 'fund', now)}
              done={(id) => done(id)}
            />
          )
        }
        aria-label={t('paychecks.types.paysIntoLabel', { name: type.name })}
        dir="auto"
        className={SELECT}
        choices={[
          { value: '', label: t('paychecks.types.notLinked') },
          ...offeredFunds.map((fund) => ({
            value: `fund:${fund.id}`,
            label: fund.isArchived ? t('paychecks.types.archived', { name: fund.name }) : fund.name,
            group: t('paychecks.types.funds'),
          })),
          ...offeredGoals.map((goal) => ({
            value: `goal:${goal.id}`,
            label: goal.isClosed ? t('paychecks.types.closed', { name: goal.name }) : goal.name,
            group: t('paychecks.types.goals'),
          })),
          ...offeredDebts.map((debt) => ({
            value: `debt:${debt.id}`,
            label: debt.isClosed ? t('paychecks.types.closed', { name: debt.name }) : debt.name,
            group: t('paychecks.types.debts'),
          })),
        ]}
      />
      {/* A link is worth checking where the money is supposed to have landed. */}
      {isLinked && (
        <Link
          to={
            linkedFund !== undefined
              ? `/wealth/funds/${linkedFund.id}`
              : linkedGoal !== undefined
                ? `/wealth/goals/${linkedGoal.id}`
                : `/wealth/debts/${linkedDebt?.id ?? ''}`
          }
          className="fc-text-action self-start"
          title={t('paychecks.types.openTitle', { name: linkedFund?.name ?? linkedGoal?.name ?? linkedDebt?.name ?? '' })}
        >
          {t('paychecks.types.open')}
        </Link>
      )}
    </span>
  )
}

/**
 * What one choice means, as the three columns it writes: all three always, two
 * of them `undefined` — "one destination per line" is the control's property.
 */
export interface Destination {
  readonly linkedFundId: string | undefined
  readonly linkedSavingGoalId: string | undefined
  readonly linkedDebtId: string | undefined
}

/** Make what a saving line pays into, named; the kind of fund follows the line's. */
function makeDestination(db: Database, type: DeductionType, name: string, kind: 'fund' | 'goal', now: number): string {
  if (kind === 'goal') return `goal:${createGoal(db, { name, kind: 'LONG_TERM' }, now).id}`
  const fundType = type.kind === 'STUDY_FUND' ? 'STUDY_FUND' : type.kind === 'PENSION' || type.kind === 'SEVERANCE' ? 'PENSION' : 'PROVIDENT'
  return `fund:${createFund(db, { name, fundType }, now).id}`
}

/**
 * A repayment line's debt, made in place: its name and what was borrowed,
 * because a debt with no amount reads as paid off. An employer loan, opened
 * today; its own screen says the rest.
 */
function NewDebt({ done }: { readonly done: (id: string | undefined) => void }) {
  const t = useT()
  const mutate = useDocumentStore((state) => state.mutate)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [problem, setProblem] = useState<string | undefined>()
  const parsed = parseAmountText(amount)
  const ready = name.trim() !== '' && parsed !== undefined && parsed > 0
  const create = (): void => {
    if (!ready) return
    let id: string | undefined
    try {
      mutate((db) => {
        const principalAmount = fromMajorUnits(parsed, documentCurrency(db))
        id = `debt:${createDebt(db, { name: name.trim(), kind: 'PAYROLL_LOAN', principalAmount, openedDate: today() }, Date.now()).id}`
      })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return
    }
    done(id)
  }
  const keys = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      create()
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      done(undefined)
    }
  }
  return (
    <div role="group" aria-label={t('paychecks.types.newDebt')} className="fc-pop-enter flex flex-col gap-2.5 border border-hairline bg-surface p-3">
      <input className={FIELD} autoFocus aria-label={t('paychecks.types.debtNameLabel')} placeholder={t('paychecks.types.debtName')} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={keys} />
      <input
        className={`${FIELD} text-end tabular-nums`}
        aria-label={t('paychecks.types.borrowedLabel')}
        placeholder={t('paychecks.types.borrowed')}
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        onKeyDown={keys}
      />
      {problem !== undefined && <p className="m-0 text-caption text-negative">{problem}</p>}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!ready} onClick={create}>
          {t('paychecks.types.create')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => done(undefined)}>
          {t('paychecks.types.cancel')}
        </Button>
      </div>
    </div>
  )
}

function parseDestination(value: string): Destination {
  const none: Destination = { linkedFundId: undefined, linkedSavingGoalId: undefined, linkedDebtId: undefined }
  if (value.startsWith('fund:')) return { ...none, linkedFundId: value.slice(5) }
  if (value.startsWith('goal:')) return { ...none, linkedSavingGoalId: value.slice(5) }
  if (value.startsWith('debt:')) return { ...none, linkedDebtId: value.slice(5) }
  return none
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
