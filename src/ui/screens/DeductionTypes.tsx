import { useMemo, useState } from 'react'

import { Link } from 'react-router-dom'
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
import { countsAsWords, defaultFlags, flagsAsGuessed, guessDestination, KIND_LABEL, kindChange } from '@/domain/paycheckEntry.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { NewByName, SelectOrNew } from '@/ui/components/SelectOrNew.tsx'
import { today } from '@/ui/today.ts'

/**
 * The payroll vocabulary, and the two flags that decide what every paycheck
 * figure means — docs/f04's deduction-type screen, which is a **view of Paychecks**
 * rather than a setting since D-170.
 *
 * The flags are the whole reason this screen exists. `reducesNet` decides
 * whether an amount comes out of take-home pay, and `countsAsSaving` decides
 * whether it is wealth or spending; get either wrong and the reconciliation
 * delta, the savings rate and total compensation are all quietly wrong
 * together. **Since M36 U11 they are a guess to confirm rather than two
 * questions**: the kind guesses them, a row says them in words, and *Change*
 * opens the boxes; *Pays into* names the one fund or loan a line most likely
 * feeds, to link with a click.
 *
 * A built-in can be edited and reordered but never deleted (D-049): it is the
 * vocabulary the app promises to know. A type the user added can be deleted
 * only while no paycheck names it — refused rather than cascaded, exactly as
 * a category is.
 *
 * **"Pays into" is the dead spot D-052 left on purpose, now filled** (D-073).
 * `linked_holding` (a fund is a holding since D-389) is what the whole
 * of F13's deposit reconciliation turns on, and before `fund_account` existed
 * there was nothing to point at and the page said so. Picking a fund here is
 * what turns a payslip line into an expected contribution — it is the only way
 * into that link, and two F13 screens send people here to make it.
 *
 * **The column appears where the money is still yours, or where it is paying
 * something off.** Two gates rather than one: the `Saving` flag on the same row
 * decides whether a fund or a goal is offered — pension, study fund and severance
 * can feed one and income tax cannot — and the **kind** decides whether a debt
 * is, because a repayment line is the one whose money is gone from net and has
 * an owed balance on the other side of it (D-085). A saving line cannot repay a
 * loan and a repayment cannot feed a pension, so neither is offered where it
 * makes no sense. A type that is already linked keeps showing its link whatever
 * its flags say, because a link that stopped being visible would go on producing
 * contributions or payments from behind a hidden control.
 */
export function DeductionTypes() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [problem, setProblem] = useState<string | undefined>()

  const types = useMemo(() => (db === undefined ? [] : listDeductionTypes(db)), [db, revision])
  const usage = useMemo(
    () => (db === undefined ? new Map<string, number>() : deductionTypeUsageCounts(db)),
    [db, revision],
  )
  // Archived funds included: a type may already point at one, and an option
  // list that could not name the fund a row is linked to would render the link
  // as "not linked" and invite clearing it by accident.
  const funds = useMemo(
    () => (db === undefined ? [] : listFunds(db, { includeArchived: true })),
    [db, revision],
  )
  // Closed goals included, for the reason archived funds are: a type may
  // already name one, and an option list that could not would render a real
  // link as "not linked".
  const goals = useMemo(
    () => (db === undefined ? [] : listGoals(db, { includeClosed: true })),
    [db, revision],
  )
  // Closed debts included, for the reason closed goals are.
  const debts = useMemo(
    () => (db === undefined ? [] : listDebts(db, { includeClosed: true })),
    [db, revision],
  )

  if (db === undefined) {
    return <Centered>Open a document, or create one, to manage its deduction types.</Centered>
  }

  const write = (work: (database: import('sql.js').Database, now: number) => void): void => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
    } catch (error) {
      // A refusal is information: it is how the user finds out that a type is
      // holding up a year of payslips.
      setProblem(error instanceof Error ? error.message : String(error))
    }
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline px-6 py-2">
        <span className="text-ink-secondary tabular-nums">
          {types.length === 1 ? '1 deduction type' : `${types.length} deduction types`}
        </span>

        <NewTypeForm
          onCreate={(name, kind) =>
            write((database, now) =>
              createDeductionType(database, { name, kind, ...defaultFlags(kind) }, now),
            )
          }
        />
      </div>

      {problem !== undefined && (
        <div className="fc-pop-enter flex shrink-0 items-center gap-4 border-b border-hairline bg-surface px-6 py-2">
          <span className="text-negative">{problem}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-hairline bg-background/90 text-label text-ink-tertiary uppercase backdrop-blur">
              <th className="px-6 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">On the paycheck</th>
              <th className="px-3 py-2 text-left font-medium">Kind</th>
              <th className="px-3 py-2 text-left font-medium">Counts as</th>
              <th className="px-3 py-2 text-left font-medium">Pays into</th>
              <th className="px-3 py-2 text-right font-medium">Used</th>
              <th className="px-6 py-2" />
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <Row
                key={type.id}
                type={type}
                usedBy={usage.get(type.id) ?? 0}
                funds={funds}
                goals={goals}
                debts={debts}
                onLink={(destination) =>
                  write((database, now) => {
                    updateDeductionType(database, type.id, destination, now)
                    // The payoff for linking a goal is the deposits it derives,
                    // and they should exist before the user goes looking. Same
                    // write, so a link and its deposits cannot get out of step —
                    // and the sync is idempotent, so doing it here costs nothing
                    // when the link was to a fund instead. And the same for a
                    // debt: linking one has to write the payments the payslips
                    // already imply, or the balance sits unchanged until the next
                    // import happens to run a scan.
                    syncPayroll(database, now)
                  })
                }
                onRename={(name, hebrewName) =>
                  write((database, now) =>
                    updateDeductionType(database, type.id, { name, hebrewName }, now),
                  )
                }
                onKind={(kind) =>
                  // The flags follow the kind while they are still its guess (M36 U11).
                  write((database, now) => updateDeductionType(database, type.id, kindChange(type, kind), now))
                }
                onFlags={(flags) =>
                  write((database, now) => updateDeductionType(database, type.id, flags, now))
                }
                onMove={(direction) => move(type.id, direction)}
                onDelete={() => write((database, now) => deleteDeductionType(database, type.id, now))}
              />
            ))}
          </tbody>
        </table>

        <div className="max-w-3xl px-6 py-4 text-caption text-ink-secondary">
          <p>
            <strong className="font-medium">Counts as</strong> is guessed from the kind, and follows
            it when the kind changes. <strong className="font-medium">Out of net</strong> means the
            money actually left your take-home pay — tax, national insurance, your side of the
            pension; the employer's side and notional items like a company car are not cash.{' '}
            <strong className="font-medium">Saving</strong> means the money is still yours: pension,
            study fund, severance. Change it only where the guess is wrong — it moves the
            reconciliation delta and the savings figures on every paycheck that uses the type.
          </p>
          <p className="mt-2 text-ink-tertiary">
            <strong className="font-medium text-ink-secondary">Pays into</strong> is what turns a
            line into money the app can follow. Point it at a fund and the app compares what these
            paychecks deducted against what the fund says it received, on the{' '}
            <Link to="/wealth/deposits" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
              deposit check
            </Link>
            . Point it at a{' '}
            <Link to="/wealth/goals" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
              goal
            </Link>{' '}
            and each paycheck becomes a deposit against it — one per paycheck, updated in place when you
            edit the paycheck rather than added again. A line goes to one or the other, never both, or
            it would be counted twice. Point a{' '}
            <Link to="/wealth/debts" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
              repayment line at a debt
            </Link>{' '}
            and each paycheck becomes a payment against it, keyed the same way. Where there is one fund
            of the line's kind, or one payroll loan, its name is offered beside the select: one click
            links it. A fund or a goal is
            offered on types marked as saving, since those are the ones whose money is still yours;
            a debt is offered on repayment lines, since those are the ones with a balance on the
            other side.
          </p>
        </div>
      </div>
    </div>
  )
}

function Row({
  type,
  usedBy,
  funds,
  goals,
  debts,
  onLink,
  onRename,
  onKind,
  onFlags,
  onMove,
  onDelete,
}: {
  type: DeductionType
  usedBy: number
  funds: readonly FundAccount[]
  goals: readonly SavingGoal[]
  debts: readonly Debt[]
  onLink: (destination: Destination) => void
  onRename: (name: string, hebrewName: string | undefined) => void
  onKind: (kind: DeductionKind) => void
  onFlags: (flags: { reducesNet?: boolean; countsAsSaving?: boolean }) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}) {
  // Text is committed on blur rather than on every keystroke: a mutation
  // snapshots the whole document (the crash cache), and doing that per letter
  // would be a copy of the database for every character typed.
  const [name, setName] = useState(type.name)
  const [hebrewName, setHebrewName] = useState(type.hebrewName ?? '')
  const [confirming, setConfirming] = useState(false)

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

  return (
    <tr className="group border-b border-hairline transition-colors duration-[var(--duration-micro)] hover:bg-surface">
      <td className="px-6 py-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setName(type.name)
          }}
          aria-label={`Name of ${type.name}`}
          dir="auto"
          className={`${FIELD} h-7 w-48`}
        />
      </td>

      <td className="px-3 py-1.5">
        <input
          value={hebrewName}
          onChange={(event) => setHebrewName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setHebrewName(type.hebrewName ?? '')
          }}
          placeholder="what the paycheck prints"
          aria-label={`What the paycheck calls ${type.name}`}
          dir="auto"
          className={`${FIELD} h-7 w-48`}
        />
      </td>

      <td className="px-3 py-1.5">
        <select
          value={type.kind}
          onChange={(event) => onKind(event.target.value as DeductionKind)}
          aria-label={`Kind of ${type.name}`}
          className={`${SELECT} h-7`}
        >
          {DEDUCTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </td>

      <td className="px-3 py-1.5">
        <CountsAs type={type} onFlags={onFlags} />
      </td>

      <td className="px-3 py-1.5">
        <DestinationLink
          type={type}
          funds={funds}
          goals={goals}
          debts={debts}
          onLink={onLink}
        />
      </td>

      <td className="px-3 py-1.5 text-right text-ink-secondary tabular-nums">
        {usedBy === 0 ? <span className="text-ink-tertiary">—</span> : usedBy}
      </td>

      <td className="px-6 py-1.5 text-right whitespace-nowrap">
        {confirming ? (
          <>
            <span className="mr-2 text-caption text-ink-secondary">
              Delete <Bidi>{type.name}</Bidi>?
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setConfirming(false)
                onDelete()
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          // Quiet until the row is hovered or something in it has focus, the way
          // the categories list does it — twenty rows of buttons is a wall.
          <span className="flex items-center justify-end gap-x-3 text-caption text-ink-secondary opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 focus-within:opacity-100">
            {type.isBuiltIn && <span className="text-ink-tertiary">built-in</span>}
            <IconButton onClick={() => onMove(-1)} label={`Move ${type.name} up`}>
              ↑
            </IconButton>
            <IconButton onClick={() => onMove(1)} label={`Move ${type.name} down`}>
              ↓
            </IconButton>
            {/* Offered even when the type is in use, and refused with a reason
                when it is: hiding the button would leave the user wondering
                which of the two rules stopped them. A built-in is the one that
                genuinely has no delete, and it says "built-in" instead. */}
            {!type.isBuiltIn && (
              <button type="button" onClick={() => setConfirming(true)} className="hover:text-negative">
                Delete
              </button>
            )}
          </span>
        )}
      </td>
    </tr>
  )
}

/**
 * **The two flags are a guess to confirm, not two questions** (M36 U11). The kind
 * guesses them (`defaultFlags`) and a kind change carries them along while they
 * are still the guess, so a row says what it counts as in words; *Change* opens
 * the two boxes, and a row whose flags somebody set says so.
 */
function CountsAs({
  type,
  onFlags,
}: {
  type: DeductionType
  onFlags: (flags: { reducesNet?: boolean; countsAsSaving?: boolean }) => void
}) {
  const [changing, setChanging] = useState(false)
  if (changing) {
    return (
      <span className="flex items-center gap-3 text-caption whitespace-nowrap">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={type.reducesNet}
            onChange={(event) => onFlags({ reducesNet: event.target.checked })}
            aria-label={`${type.name} comes out of take-home pay`}
          />
          Out of net
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={type.countsAsSaving}
            onChange={(event) => onFlags({ countsAsSaving: event.target.checked })}
            aria-label={`${type.name} is saving rather than spending`}
          />
          Saving
        </label>
        <button type="button" className="text-accent hover:underline" onClick={() => setChanging(false)}>
          Done
        </button>
      </span>
    )
  }
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap">
      <span>{countsAsWords(type)}</span>
      {!flagsAsGuessed(type) && <span className="text-caption text-ink-tertiary">set by hand</span>}
      <button
        type="button"
        className="text-caption text-accent hover:underline"
        aria-label={`Change what ${type.name} counts as`}
        onClick={() => setChanging(true)}
      >
        Change
      </button>
    </span>
  )
}

/**
 * Where this type's money goes — a fund or a saving goal, in one select.
 *
 * **One question, not two columns**, and that is the shape worth stating: the
 * schema keeps `linked_holding` and `linked_saving_goal` apart
 * because they point at different tables, but "where does this money end up" has
 * one answer per line. Two selects would let a user pick both, and a line that
 * fed a fund *and* a goal would be counted twice by everything downstream —
 * expected contributions on one side and a saving deposit on the other. So
 * picking either clears the other, in the same write.
 *
 * **Offered where the money is still the user's**, which is the `Saving` flag
 * beside it: pension, study fund and severance can reach a destination and
 * income tax cannot, and a select on every row would invite a link that produces
 * contributions nobody ever expected.
 *
 * **An existing link always shows**, whatever the flags now say. A link that
 * disappeared from the screen would keep producing contributions from a place
 * the user could no longer see, which is the same failure as a category rule
 * with no row on the rules screen.
 */
function DestinationLink({
  type,
  funds,
  goals,
  debts,
  onLink,
}: {
  type: DeductionType
  funds: readonly FundAccount[]
  goals: readonly SavingGoal[]
  debts: readonly Debt[]
  onLink: (destination: Destination) => void
}) {
  const linkedFund = funds.find((fund) => fund.id === type.linkedFundId)
  const linkedGoal = goals.find((goal) => goal.id === type.linkedSavingGoalId)
  const linkedDebt = debts.find((debt) => debt.id === type.linkedDebtId)
  const isLinked =
    linkedFund !== undefined || linkedGoal !== undefined || linkedDebt !== undefined

  // Two gates, because they are two different questions. Saving decides whether
  // the money is still the user's — a fund or a goal. The kind decides whether
  // it is paying something off — a debt. A line is one or the other, and
  // offering both on every row would invite a pension linked to a car loan.
  const canSave = type.countsAsSaving
  const canRepay = type.kind === 'LOAN_REPAYMENT'

  if (!canSave && !canRepay && !isLinked) {
    return <span className="text-caption text-ink-tertiary">—</span>
  }

  // An unlinked line names what it most likely pays into, to confirm (M36 U11).
  const guess = isLinked ? undefined : guessDestination(type, funds, debts)
  const guessName =
    guess === undefined
      ? undefined
      : guess.kind === 'fund'
        ? funds.find((one) => one.id === guess.id)?.name
        : debts.find((one) => one.id === guess.id)?.name

  const offeredFunds = canSave || linkedFund !== undefined ? funds : []
  const offeredGoals = canSave || linkedGoal !== undefined ? goals : []
  const offeredDebts = canRepay || linkedDebt !== undefined ? debts : []

  const value =
    linkedFund !== undefined
      ? `fund:${linkedFund.id}`
      : linkedGoal !== undefined
        ? `goal:${linkedGoal.id}`
        : linkedDebt !== undefined
          ? `debt:${linkedDebt.id}`
          : ''

  return (
    <div className="flex items-start gap-2">
      {/* **+ New… makes what the line pays into, here** (M36 U10, M31 U6's SelectOrNew): a
          fund or a goal for a saving, a debt for a repayment — chosen as soon as it is made. */}
      <SelectOrNew
        value={value}
        onChange={(chosen) => onLink(parseDestination(chosen))}
        newForm={(done) =>
          canRepay ? (
            <NewDebt done={done} />
          ) : (
            <NewByName<'fund' | 'goal'>
              noun="fund or goal"
              kinds={[
                ['fund', 'A fund'],
                ['goal', 'A goal'],
              ]}
              make={(db, name, kind, now) => makeDestination(db, type, name, kind ?? 'fund', now)}
              done={(id) => done(id)}
            />
          )
        }
        aria-label={`Where ${type.name} pays into`}
        dir="auto"
        className={`${SELECT} h-7 max-w-48`}
      >
        <option value="">Not linked</option>
        {offeredFunds.length > 0 && (
          <optgroup label="Funds">
            {offeredFunds.map((fund) => (
              <option key={fund.id} value={`fund:${fund.id}`}>
                {fund.name}
                {fund.isArchived ? ' (archived)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {offeredGoals.length > 0 && (
          <optgroup label="Goals">
            {offeredGoals.map((goal) => (
              <option key={goal.id} value={`goal:${goal.id}`}>
                {goal.name}
                {goal.isClosed ? ' (closed)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {offeredDebts.length > 0 && (
          <optgroup label="Debts">
            {offeredDebts.map((debt) => (
              <option key={debt.id} value={`debt:${debt.id}`}>
                {debt.name}
                {debt.isClosed ? ' (closed)' : ''}
              </option>
            ))}
          </optgroup>
        )}
      </SelectOrNew>
      {guess !== undefined && guessName !== undefined && (
        <button
          type="button"
          className="h-7 text-caption whitespace-nowrap text-accent hover:underline"
          title={`Link ${type.name} to ${guessName}`}
          onClick={() => onLink(parseDestination(`${guess.kind}:${guess.id}`))}
        >
          <Bidi>{guessName}</Bidi>?
        </button>
      )}
      {/* A link is worth checking, and the place to check it is where the money
          is supposed to have landed. Only once there is one — a "go and look"
          that lands on nothing is worse than no link at all. */}
      {isLinked && (
        <Link
          to={
            linkedFund !== undefined
              ? `/wealth/funds/${linkedFund.id}`
              : linkedGoal !== undefined
                ? `/wealth/goals/${linkedGoal.id}`
                : `/wealth/debts/${linkedDebt?.id ?? ''}`
          }
          className="text-caption text-ink-tertiary underline-offset-4 hover:text-ink hover:underline"
          title={`Open ${linkedFund?.name ?? linkedGoal?.name ?? linkedDebt?.name ?? ''}`}
        >
          open
        </Link>
      )}
    </div>
  )
}

/**
 * What one select value means, as the three columns it writes.
 *
 * All three are always written and two of them are always `undefined`: that is
 * what makes "one destination per line" a property of the control rather than a
 * rule someone has to remember. A line feeding a fund *and* a debt would be
 * counted twice by everything downstream — an expected contribution on one side
 * and a repayment on the other (D-077's argument, at its third destination).
 */
export interface Destination {
  readonly linkedFundId: string | undefined
  readonly linkedSavingGoalId: string | undefined
  readonly linkedDebtId: string | undefined
}

/**
 * Make what a saving line pays into, named, and answer with the select's value
 * for it. The kind of fund follows the line's: a study fund line makes a study fund.
 */
function makeDestination(db: Database, type: DeductionType, name: string, kind: 'fund' | 'goal', now: number): string {
  if (kind === 'goal') return `goal:${createGoal(db, { name, kind: 'LONG_TERM' }, now).id}`
  const fundType = type.kind === 'STUDY_FUND' ? 'STUDY_FUND' : type.kind === 'PENSION' || type.kind === 'SEVERANCE' ? 'PENSION' : 'PROVIDENT'
  return `fund:${createFund(db, { name, fundType }, now).id}`
}

/**
 * A repayment line's debt, made in place: its name and what was borrowed, because
 * a debt with no amount reads as paid off. An employer loan, opened today; its own
 * screen says the rest.
 */
function NewDebt({ done }: { done: (id: string | undefined) => void }) {
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
    <div role="group" aria-label="A new debt" className="fc-pop-enter flex flex-col gap-2.5 border border-hairline bg-surface p-3">
      <input className={FIELD} autoFocus aria-label="New debt name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={keys} />
      <input
        className={`${FIELD} text-right tabular-nums`}
        aria-label="What was borrowed"
        placeholder="Borrowed"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        onKeyDown={keys}
      />
      {problem !== undefined && <p className="m-0 text-caption text-negative">{problem}</p>}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!ready} onClick={create}>
          Create
        </Button>
        <Button variant="ghost" size="sm" onClick={() => done(undefined)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function parseDestination(value: string): Destination {
  const none: Destination = {
    linkedFundId: undefined,
    linkedSavingGoalId: undefined,
    linkedDebtId: undefined,
  }
  if (value.startsWith('fund:')) return { ...none, linkedFundId: value.slice(5) }
  if (value.startsWith('goal:')) return { ...none, linkedSavingGoalId: value.slice(5) }
  if (value.startsWith('debt:')) return { ...none, linkedDebtId: value.slice(5) }
  return none
}

function NewTypeForm({ onCreate }: { onCreate: (name: string, kind: DeductionKind) => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<DeductionKind>('OTHER_DEDUCTION')

  return (
    <form
      className="ml-auto flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (trimmed === '') return
        onCreate(trimmed, kind)
        setName('')
      }}
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New deduction type"
        aria-label="New deduction type name"
        dir="auto"
        className={`${FIELD} w-52`}
      />
      <select
        value={kind}
        onChange={(event) => setKind(event.target.value as DeductionKind)}
        aria-label="Kind of the new deduction type"
        className={SELECT}
      >
        {DEDUCTION_KINDS.map((option) => (
          <option key={option} value={option}>
            {KIND_LABEL[option]}
          </option>
        ))}
      </select>
      {/* The flags follow the kind, and the two checkboxes are right there in
          the row it lands in — asking for them twice would be a form nobody
          needs to fill in. */}
      <Button variant="secondary" size="sm" type="submit" disabled={name.trim() === ''}>
        Add
      </Button>
    </form>
  )
}

function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded px-1 hover:text-ink"
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
