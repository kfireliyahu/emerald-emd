import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { formatMoney, fromMajorUnits, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { plural } from '@/core/text.ts'
import { addMonths, formatMonthName, formatMonthShort, monthsBetween, toISODate, toYearMonthString, yearMonthOf, type YearMonth } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import { goalsAfter, goalsPlan, setGoalMonthly, type GoalRow } from '@/data/repositories/goalPlanRepository.ts'
import { pauseGoal } from '@/data/repositories/goalRhythmRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { goalFeeds, holdingPutIn } from '@/data/repositories/goalDepositRepository.ts'
import { saveGoalAnswer, whereChoices } from '@/data/repositories/goalWhereRepository.ts'
import { isMovedKind } from '@/data/repositories/movedRepository.ts'
import {
  addDeposit,
  deleteDeposit,
  deleteGoal,
  listDeposits,
  listGoals,
  listHoldingPlaces,
  listHoldings,
  recordTransfer,
  setGoalClosed,
  updateDeposit,
} from '@/data/repositories/savingsRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { agreedGrowthAfter, balanceAfter, type GoalStatus } from '@/domain/goalPlan.ts'
import { MOVED_MONTHS, type VersusPlan } from '@/domain/goalRhythm.ts'
import { originSplit } from '@/domain/goalDeposits.ts'
import type { Holding, HoldingPlace, SavingDeposit } from '@/domain/model/savings.ts'
import { isContribution } from '@/domain/savings.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { editableMoney } from '@/ui/components/moneyText.ts'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { blankDeposit, DepositEditor, type DepositDraft } from '@/ui/savings/DepositEditor.tsx'
import { blankGoal, GoalEditor } from '@/ui/savings/GoalEditor.tsx'
import { isDefaultTransferNote, SOURCE_LABEL } from '@/ui/savings/labels.ts'
import { today } from '@/ui/today.ts'
import {
  AMOUNT_FIELD,
  GTD,
  GTD_R,
  Hero,
  HeroCell,
  Legend,
  LegendItem,
  Need,
  NeedButton,
  PageHead,
  Screen,
  Section,
  Seg,
  Src,
  SWATCH,
  Tag,
  TH,
  TH_R,
} from '@/ui/wealth/parts.tsx'

/**
 * Goals — the page that decides the month (M28 U8).
 *
 * **One row per goal: what goes toward it each month, and what that leaves you
 * with in the time you pick.** The amount is **Plan's bucket** that points at the
 * goal (choice 3 A), so typing here and typing on Plan write the same number —
 * `changedTo` is what both call, and what a typed figure does to the rest of the
 * split is therefore one rule.
 *
 * **The projection is plain addition and says so** (the three return scenarios
 * went): the balance plus the amount, month by month, stopping at the target. An
 * assumed return is a figure somebody typed that reads as a fact; a rate the bank
 * agreed to returns as its own column.
 *
 * The goal's own page is a drawer over this list (D-326), and the flat
 * list of movements is a view of it, as it was.
 */
type View = 'GOALS' | 'DEPOSITS'
type Horizon = 6 | 12 | 24 | 'DUE'

export function Goals() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [view, setView] = useState<View>('GOALS')
  const [horizon, setHorizon] = useState<Horizon>(12)
  const [editingGoal, setEditingGoal] = useState<
    { isNew: boolean; goal: SavingGoalDraft; fromDrawer?: boolean } | undefined
  >()
  const [goalProblem, setGoalProblem] = useState<string | undefined>()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const [editingDeposit, setEditingDeposit] = useState<
    { isNew: boolean; deposit: SavingDeposit } | undefined
  >()
  const [confirming, setConfirming] = useState<string | undefined>()
  const [problem, setProblem] = useState<string | undefined>()
  const [showClosed, setShowClosed] = useState(false)
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({})
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; row: GoalRow } | undefined>()

  const asOf = today()
  const currency: CurrencyCode = useMemo(
    () => (db === undefined ? 'ILS' : documentCurrency(db)),
    [db, revision],
  )

  const read = useMemo(
    () => (db === undefined ? undefined : goalsPlan(db, asOf, currency, { includeClosed: showClosed })),
    [db, revision, showClosed],
  )
  const places = useMemo(
    () => (db === undefined ? [] : listHoldingPlaces(db, { includeArchived: true })),
    [db, revision],
  )
  const holdings = useMemo(
    () => (db === undefined ? [] : listHoldings(db, { includeArchived: true })),
    [db, revision],
  )
  const goals = useMemo(
    () => (db === undefined ? [] : listGoals(db, { includeClosed: true })),
    [db, revision],
  )
  const deposits = useMemo(() => (db === undefined ? [] : listDeposits(db)), [db, revision])

  // Which goal the drawer over this list is showing, if any (D-130).
  const { goalId: openId } = useParams<{ goalId: string }>()

  // The drawer's Edit (M30 F3) opens this list's editor on its goal, and comes back to it.
  const editId = search.get('edit')
  useEffect(() => {
    if (editId === null) return
    const goal = goals.find((one) => one.id === editId)
    if (goal !== undefined) setEditingGoal({ isNew: false, goal, fromDrawer: true })
    setSearch({}, { replace: true })
  }, [editId, goals, setSearch])

  if (db === undefined || read === undefined) {
    return <Centered>Open a document, or create one, to track what you are saving.</Centered>
  }

  const write = (work: (database: import('sql.js').Database, now: number) => void): boolean => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
      return true
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  if (editingGoal !== undefined) {
    const editing = editingGoal.goal
    const feeds = goalFeeds(db)
    const current = feeds.get(editing.id)
    const names = new Map(goals.map((goal) => [goal.id, goal.name]))
    const readers = new Map(
      [...feeds].filter(([id, feed]) => feed.kind === 'CATEGORY' && id !== editing.id).map(([id, feed]) => [feed.id, names.get(id)]),
    )
    // Back to the drawer it came from takes the drawer's own entry back (M31 U9):
    // its Edit replaced it with this form, so history reads as it did before.
    const close = (goalId: string | undefined): void => {
      setEditingGoal(undefined)
      setGoalProblem(undefined)
      if (goalId !== undefined) navigate(`/wealth/goals/${goalId}`, { replace: editingGoal.fromDrawer === true })
    }
    return (
      <GoalEditor
        key={editing.id}
        initial={editing}
        isNew={editingGoal.isNew}
        choices={whereChoices(db, currency, editingGoal.isNew ? undefined : editing.id)}
        categories={listCategories(db, { includeArchived: false })
          .filter((one) => isMovedKind(one.kind))
          .map((one) => ({ id: one.id, path: one.path, takenBy: readers.get(one.id) }))}
        initialCategoryId={current?.kind === 'CATEGORY' ? current.id : undefined}
        initialTransfers={current?.kind === 'TRANSFERS'}
        putInOf={(holdingId) => holdingPutIn(db, holdingId, currency)}
        currency={currency}
        asOf={asOf}
        problem={goalProblem}
        onSave={(answer) => {
          let savedId: string | undefined
          setGoalProblem(undefined)
          try {
            mutate((database) => {
              savedId = saveGoalAnswer(database, answer, Date.now()).id
            })
          } catch (error) {
            setGoalProblem(error instanceof Error ? error.message : String(error))
            return
          }
          close(savedId)
        }}
        onCancel={() => close(editingGoal.fromDrawer === true ? editing.id : undefined)}
      />
    )
  }

  if (editingDeposit !== undefined) {
    return (
      <DepositEditor
        key={editingDeposit.deposit.id}
        initial={editingDeposit.deposit}
        isNew={editingDeposit.isNew}
        goals={goals}
        holdings={holdings.filter((holding) => !holding.isArchived)}
        places={places}
        existing={deposits.filter((one) => one.goalId === editingDeposit.deposit.goalId)}
        currency={currency}
        onSave={(draft) => {
          const saved = write((database, now) => applyDraft(database, draft, now))
          if (saved) setEditingDeposit(undefined)
        }}
        onCancel={() => setEditingDeposit(undefined)}
      />
    )
  }

  const { rows, plan, month } = read
  const canRecord = goals.length > 0 && holdings.length > 0

  // The time you pick. "Until the last date" is the latest date a goal has.
  const lastDue = rows.reduce<YearMonth | undefined>(
    (latest, row) =>
      row.line.due !== undefined && (latest === undefined || monthsBetween(latest, row.line.due) > 0)
        ? row.line.due
        : latest,
    undefined,
  )
  const months =
    horizon === 'DUE' ? Math.max(1, monthsBetween(month, lastDue ?? addMonths(month, 12))) : horizon

  /** Plan's own write: one function for a typed figure here and a typed figure there. */
  /** Plan's own write, the one the tools use (D-323, M28 F10). */
  const setMonthly = (row: GoalRow, minor: number): void => {
    if (plan === undefined) return
    write((database, now) => {
      const result = setGoalMonthly(database, asOf, currency, row.line.goalId, minor, now)
      if (result === 'SEVERAL_BUCKETS') {
        throw new Error(`Several of Plan's buckets are for ${row.line.name}. Edit them on Plan: the figure here is their sum.`)
      }
    })
  }


  const commit = (row: GoalRow): void => {
    const text = typed[row.line.goalId]
    setTyped((current) => {
      const next = { ...current }
      delete next[row.line.goalId]
      return next
    })
    if (text === undefined) return
    const parsed = parseAmountText(text)
    if (parsed === undefined) return
    const minor = fromMajorUnits(Math.abs(parsed), currency).minor
    if (minor !== row.line.monthly.minor) setMonthly(row, minor)
  }

  const inAfter = goalsAfter(rows, months, currency)
  const left = read.left

  const menuItems = (row: GoalRow): MenuItem[] => {
    const goal = row.progress.goal
    return [
      ...(canRecord
        ? [
            {
              label: 'Add a deposit',
              icon: 'add',
              onChoose: () =>
                setEditingDeposit({ isNew: true, deposit: blankDeposit(goal, holdings, asOf, currency) }),
            } satisfies MenuItem,
          ]
        : []),
      row.pausedUntil === undefined
        ? {
            label: 'Pause for a month',
            detail: 'Its amount goes back to what is left; nothing is deleted',
            onChoose: () => write((database) => void pauseGoal(database, goal.id, 1, asOf)),
          }
        : {
            label: 'Start again',
            detail: `Paused until ${formatMonthShort(row.pausedUntil)}`,
            onChoose: () => write((database) => void pauseGoal(database, goal.id, 0, asOf)),
          },
      { label: 'Edit', icon: 'edit', onChoose: () => setEditingGoal({ isNew: false, goal }) },
      {
        label: 'Close this goal',
        detail: 'History is kept; nothing more goes in',
        onChoose: () => write((database, now) => setGoalClosed(database, goal.id, true, now)),
      },
      {
        label: 'Delete',
        icon: 'trash',
        separated: true,
        onChoose: () => setConfirming(goal.id),
      },
    ]
  }

  const confirmingRow = rows.find((row) => row.progress.goal.id === confirming)
  const noGoals = rows.length === 0 && read.closed.length === 0
  const horizons: readonly (readonly [Horizon, string])[] = [
    [6, '6 months'],
    [12, '12 months'],
    [24, '24 months'],
    ...(lastDue === undefined ? [] : ([['DUE', `Until ${formatMonthShort(lastDue)}`]] as const)),
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <Screen>
          <PageHead
            title={view === 'DEPOSITS' ? 'All movements' : 'Goals'}
            under={
              view === 'GOALS' && rows.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-caption text-ink-secondary">What will I have in</span>
                  <Seg options={horizons} value={horizon} onChange={setHorizon} label="Time" />
                </div>
              ) : undefined
            }
            actions={
              view === 'DEPOSITS' ? (
                <>
                  <Button variant="ghost" onClick={() => setView('GOALS')}>
                    Back to goals
                  </Button>
                  {canRecord && (
                    <Button
                      variant="primary"
                      icon="add"
                      onClick={() =>
                        setEditingDeposit({ isNew: true, deposit: blankDeposit(goals[0], holdings, asOf, currency) })
                      }
                    >
                      Record a movement
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button variant="primary" icon="add" onClick={() => setEditingGoal({ isNew: true, goal: blankGoal() })}>
                    New goal
                  </Button>
                  <PageMenu
                    title="Goals"
                    items={[
                      {
                        label: showClosed ? 'Hide closed goals' : 'Show closed goals',
                        onChoose: () => setShowClosed(!showClosed),
                      },
                    ]}
                  />
                </>
              )
            }
          />

          {problem !== undefined && (
            <div className="fc-pop-enter flex items-center gap-4 border border-hairline bg-surface px-4 py-2">
              <span className="text-negative">{problem}</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
                Dismiss
              </Button>
            </div>
          )}

          {view === 'DEPOSITS' ? (
            <DepositList
              deposits={deposits}
              goals={goals}
              holdings={holdings}
              places={places}
              currency={currency}
              onEdit={(deposit) => setEditingDeposit({ isNew: false, deposit })}
              onDelete={(deposit) => write((database, now) => deleteDeposit(database, deposit.id, now))}
            />
          ) : noGoals ? (
            <Centered>No goals yet. New goal makes one.</Centered>
          ) : (
            <>
              <Hero>
                <HeroCell label="In goals now" small={`${String(rows.length)} ${rows.length === 1 ? 'goal' : 'goals'}`}>
                  {formatMoney(read.inGoals)}
                </HeroCell>
                <HeroCell label="Put toward them each month" small={plan === undefined ? 'No plan yet' : 'From Plan’s split'}>
                  {formatMoney(read.monthly)}
                </HeroCell>
                <HeroCell label={`In ${String(months)} months, at this rate`} small="No interest counted">
                  {formatMoney(inAfter)}
                </HeroCell>
                <HeroCell
                  label="Plan’s Everything else"
                  small={
                    left === undefined
                      ? 'Make a plan to see this'
                      : left.minor < 0
                        ? `Over by ${formatMoney(money(-left.minor, currency))}`
                        : 'What is left after these'
                  }
                  problem={left !== undefined && left.minor < 0}
                >
                  {left === undefined ? '—' : formatMoney(left)}
                </HeroCell>
              </Hero>

              <Section
                title="Decide this month"
                sub={
                  plan === undefined ? (
                    <>
                      A goal’s amount is its Plan bucket, and there is no plan yet.{' '}
                      <Link to="/plan" className="text-accent hover:underline">
                        Make one on Plan
                      </Link>
                    </>
                  ) : (
                    'Each amount is the goal’s Plan bucket. Change it here or on Plan; it is one number.'
                  )
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={TH}>Goal</th>
                        <th className={TH}>Where it stands</th>
                        <th className={TH_R}>Target</th>
                        <th className={TH_R}>Each month (Plan bucket)</th>
                        <th className={TH_R}>Moved, last 3 months</th>
                        <th className={TH_R}>
                          In {String(months)} {months === 1 ? 'month' : 'months'}
                        </th>
                        <th className={TH}>At this rate</th>
                        <th className={`${TH} w-9`} aria-label="More" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <GoalTableRow
                          key={row.line.goalId}
                          row={row}
                          deposits={deposits}
                          months={months}
                          open={row.line.goalId === openId}
                          editable={plan !== undefined}
                          text={typed[row.line.goalId]}
                          currency={currency}
                          onText={(text) => setTyped((current) => ({ ...current, [row.line.goalId]: text }))}
                          onCommit={() => commit(row)}
                          onUse={(amount) => setMonthly(row, amount.minor)}
                          onMenu={(at) => setMenu({ at, row })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <Legend>
                  <LegendItem swatch={SWATCH.derived}>Read from the bank</LegendItem>
                  <LegendItem swatch={SWATCH.setAside}>Set aside inside the bank</LegendItem>
                  <LegendItem swatch={SWATCH.already}>Was already there</LegendItem>
                </Legend>
                {confirmingRow !== undefined && (
                  <div className="fc-pop-enter flex flex-wrap items-center gap-3 border border-hairline bg-surface px-4 py-2">
                    <span>
                      Delete <Bidi>{confirmingRow.line.name}</Bidi> and its history?
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirming(undefined)
                        write((database, now) => deleteGoal(database, confirmingRow.progress.goal.id, now))
                      }}
                    >
                      Delete it
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(undefined)}>
                      Keep it
                    </Button>
                  </div>
                )}
                {left !== undefined && (
                  <div
                    className={`flex flex-wrap items-center gap-3.5 border bg-surface px-3.5 py-2.5 ${left.minor < 0 ? 'border-negative' : 'border-hairline'}`}
                  >
                    <span>The goals take</span>
                    <b className="font-medium tabular-nums">{formatMoney(read.monthly)}</b>
                    <span className="text-caption text-ink-secondary">
                      so Everything else is {formatMoney(left)}
                      {left.minor < 0 ? ', which is more than Plan has' : ''}
                    </span>
                    <Link to="/plan" className="ml-auto text-caption text-accent hover:underline">
                      Change the split on Plan
                    </Link>
                  </div>
                )}
              </Section>

              {rows.some((row) => row.line.balance.minor > 0 || row.line.monthly.minor > 0) && (
                <Section
                  title="What you will have"
                  sub="Each goal stops growing when it reaches its target. Money that would go past it is left for Everything else."
                >
                  <ProjectionChart rows={rows} months={months} from={month} currency={currency} />
                </Section>
              )}

              {read.closed.length > 0 && (
                <Section title="Closed">
                  {read.closed.map((progress) => (
                    <div key={progress.goal.id} className="flex flex-wrap items-center gap-4 border-b border-hairline py-2">
                      <Link to={`/wealth/goals/${progress.goal.id}`} className="hover:text-accent">
                        <Bidi>{progress.goal.name}</Bidi>
                      </Link>
                      <span className="text-ink-secondary tabular-nums">{formatMoney(progress.balance)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => write((database, now) => setGoalClosed(database, progress.goal.id, false, now))}
                      >
                        Reopen
                      </Button>
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}

          {view === 'GOALS' && (
            <div className="flex flex-wrap items-center gap-5 text-caption text-ink-secondary">
              <Button variant="ghost" size="sm" onClick={() => setView('DEPOSITS')}>
                All movements
              </Button>
            </div>
          )}
        </Screen>
      </div>
      {menu !== undefined && (
        <ContextMenu
          at={menu.at}
          items={menuItems(menu.row)}
          onClose={() => setMenu(undefined)}
          header={{ title: <Bidi>{menu.row.line.name}</Bidi> }}
        />
      )}
    </div>
  )
}

type SavingGoalDraft = Parameters<typeof GoalEditor>[0]['initial']

/** Moved against planned, only over the months the goal was taking money (U9's first task). */
export function versusPlanWords(versus: VersusPlan): string {
  if (versus.kind === 'PAUSED') return 'paused, not compared'
  if (versus.kind === 'NOTHING_YET') return 'nothing to compare yet'
  const figure = `${versus.difference.minor > 0 ? '+' : ''}${formatMoney(versus.difference)}`
  return versus.months === MOVED_MONTHS ? `${figure} vs plan` : `${figure} vs plan, ${plural(versus.months, 'month')}`
}

function statusWords(status: GoalStatus): {
  readonly chip: string
  readonly line: string
  readonly tone: 'good' | 'warn' | 'bad' | 'plain'
} {
  const at = (month: YearMonth): string => formatMonthShort(month)
  switch (status.kind) {
    case 'REACHED':
      return { chip: 'Reached', line: 'Already there', tone: 'good' }
    case 'ON_TIME':
      return { chip: 'On time', line: `Reached ${at(status.at)}`, tone: 'good' }
    case 'LATE':
      return {
        chip: 'Late',
        line: `Reached ${at(status.at)}, ${String(status.monthsLate)} ${status.monthsLate === 1 ? 'month' : 'months'} after the date`,
        tone: 'warn',
      }
    case 'NO_DATE':
      return { chip: 'No date', line: `Reached ${at(status.at)}`, tone: 'plain' }
    case 'NO_MONEY':
      return { chip: 'No money yet', line: 'Nothing is set aside each month', tone: 'bad' }
    case 'NO_TARGET':
      return { chip: 'Running total', line: 'No target to reach', tone: 'plain' }
  }
}

function GoalTableRow({
  row,
  deposits,
  months,
  open,
  editable,
  text,
  currency,
  onText,
  onCommit,
  onUse,
  onMenu,
}: {
  row: GoalRow
  deposits: readonly SavingDeposit[]
  months: number
  open: boolean
  editable: boolean
  text: string | undefined
  currency: CurrencyCode
  onText: (text: string) => void
  onCommit: () => void
  onUse: (amount: Money) => void
  onMenu: (at: { x: number; y: number }) => void
}) {
  const { line, progress } = row
  const after = balanceAfter(line, months)
  const percent = (value: Money): string | undefined =>
    line.target === undefined || line.target.minor <= 0
      ? undefined
      : `${String(Math.min(100, Math.round((value.minor / line.target.minor) * 100)))}% of target`
  const words = statusWords(row.status)
  const targetDate = progress.goal.targetDate
  const split = originSplit(
    deposits.filter((deposit) => deposit.goalId === line.goalId),
    currency,
  )
  const whole = Math.max(1, split.DERIVED.minor + split.SET_ASIDE.minor + split.ALREADY_THERE.minor)
  const width = (value: Money): string => `${String(Math.max(0, (value.minor / whole) * 100))}%`
  const staleTotal = row.stale.reduce((sum, one) => sum + one.amount.minor, 0)

  return (
    <tr className={open ? 'bg-accent-soft' : ''}>
      <td className={`${GTD} min-w-[170px]`}>
        <Link
          to={`/wealth/goals/${line.goalId}`}
          className="border-b border-hairline-strong font-medium text-ink hover:border-accent hover:text-accent"
        >
          <Bidi>{line.name}</Bidi>
        </Link>
        <Src>
          {targetDate === undefined ? 'no date' : `by ${formatMonthShort(yearMonthOf(targetDate))}`}
        </Src>
        {staleTotal > 0 && (
          <Src className="text-flow-tax">{formatMoney(money(staleTotal, currency))} set aside 90+ days: check it</Src>
        )}
      </td>
      <td className={GTD}>
        <div className="flex flex-col gap-[5px]">
          <span className="tabular-nums">
            <b className="font-medium">{formatMoney(line.balance)}</b>{' '}
            {percent(line.balance) !== undefined && <span className="text-caption text-ink-secondary">{percent(line.balance)}</span>}
          </span>
          {split.GROWTH.minor !== 0 && (
            <span className="text-caption text-ink-secondary tabular-nums">
              put in {formatMoney(money(line.balance.minor - split.GROWTH.minor, currency))}
            </span>
          )}
          <span
            className="flex h-2 w-[150px] bg-hairline"
            title="Read from the bank, set aside inside the bank, was already there"
          >
            {split.DERIVED.minor > 0 && <i className={`block h-full ${SWATCH.derived}`} style={{ width: width(split.DERIVED) }} />}
            {split.SET_ASIDE.minor > 0 && <i className={`block h-full ${SWATCH.setAside}`} style={{ width: width(split.SET_ASIDE) }} />}
            {split.ALREADY_THERE.minor > 0 && (
              <i className={`block h-full ${SWATCH.already}`} style={{ width: width(split.ALREADY_THERE) }} />
            )}
          </span>
        </div>
      </td>
      <td className={GTD_R}>{line.target === undefined ? '—' : formatMoney(line.target)}</td>
      <td className={GTD_R}>
        {editable && row.bucketIds.length <= 1 ? (
          <input
            inputMode="decimal"
            aria-label={`Each month toward ${line.name}`}
            value={text ?? editableMoney(line.monthly)}
            placeholder="0"
            onChange={(event) => onText(event.target.value)}
            onBlur={onCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className={AMOUNT_FIELD}
          />
        ) : (
          <span>{formatMoney(line.monthly)}</span>
        )}
        {row.bucketIds.length > 1 ? (
          <Need>{row.bucketIds.length} buckets, edit on Plan</Need>
        ) : row.pausedUntil !== undefined ? (
          <Need>paused until {formatMonthShort(row.pausedUntil)}</Need>
        ) : row.needed !== undefined && editable ? (
          <Need>
            needs {formatMoney(row.needed)} to be on time
            <NeedButton onClick={() => onUse(row.needed ?? money(0, currency))}>Use it</NeedButton>
          </Need>
        ) : (
          <Need>{line.due === undefined ? 'no date to hit' : 'on time'}</Need>
        )}
      </td>
      <td className={GTD_R}>
        {formatMoney(row.moved)}
        <Need>{versusPlanWords(row.versusPlan)}</Need>
      </td>
      <td className={GTD_R}>
        <b className="font-medium">{formatMoney(after)}</b>
        {percent(after) !== undefined && <Need>{percent(after)}</Need>}
        {line.agreedRateBasisPoints !== undefined && agreedGrowthAfter(line, months).minor > 0 && (
          <Need>
            + {formatMoney(agreedGrowthAfter(line, months))} at the agreed {formatPercent(line.agreedRateBasisPoints)}
          </Need>
        )}
      </td>
      <td className={GTD}>
        <Tag tone={row.pausedUntil !== undefined ? 'plain' : words.tone}>{row.pausedUntil === undefined ? words.chip : 'Paused'}</Tag>
        <Src className="mt-[3px] max-w-[190px] whitespace-normal">
          {row.pausedUntil === undefined ? words.line : `Takes money again ${formatMonthShort(row.pausedUntil)}`}
        </Src>
      </td>
      <td className={`${GTD} w-9 px-0`}>
        <button
          type="button"
          aria-label={`More for ${line.name}`}
          title="More"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            onMenu({ x: box.left, y: box.bottom })
          }}
          className="fc-icon-action"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
            <circle cx="3.5" cy="8" r="1.2" />
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="12.5" cy="8" r="1.2" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

/** The three greens of the mockup's chart: saved, and two steps of it toward the page. */
const GOAL_SHADES = [
  'var(--color-flow-saved)',
  'color-mix(in srgb, var(--color-flow-saved) 58%, var(--color-background))',
  'color-mix(in srgb, var(--color-flow-saved) 30%, var(--color-background))',
  'color-mix(in srgb, var(--color-flow-saved) 16%, var(--color-background))',
]

/**
 * The goals stacked, month by month, by plain addition: the mockup's chart, in
 * saved's greens (D-313), with the total at the last bar.
 */
function ProjectionChart({
  rows,
  months,
  from,
  currency,
}: {
  rows: readonly GoalRow[]
  months: number
  from: YearMonth
  currency: CurrencyCode
}) {
  const series = rows.map((row) => Array.from({ length: months + 1 }, (_, index) => balanceAfter(row.line, index).minor))
  const total = (index: number): number => series.reduce((running, one) => running + (one[index] ?? 0), 0)
  let peak = 0
  for (let index = 0; index <= months; index += 1) peak = Math.max(peak, total(index))
  const steps = [100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000]
  const step = steps.find((one) => peak / one <= 5) ?? 100_000_000
  const top = Math.max(step, Math.ceil(peak / step) * step)
  const W = 720
  const H = 240
  const L = 58
  const R = 12
  const T = 18
  const B = 30
  const iw = W - L - R
  const ih = H - T - B
  const bw = iw / (months + 1)
  const y = (value: number): number => T + ih - (value / top) * ih
  const every = months <= 9 ? 1 : months <= 12 ? 2 : months <= 24 ? 3 : 6
  const gridlines: number[] = []
  for (let value = 0; value <= top; value += step) gridlines.push(value)
  const shade = (k: number): string => GOAL_SHADES[k % GOAL_SHADES.length] ?? GOAL_SHADES[0] ?? ''
  const last = total(months)

  return (
    <>
      <div className="border border-hairline bg-surface px-3.5 py-3">
        <svg
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          role="img"
          aria-label={`Stacked balance of the goals over ${String(months)} months`}
          className="block h-auto w-full text-[11px]"
        >
          {gridlines.map((value) => (
            <g key={value}>
              <line x1={L} x2={W - R} y1={y(value)} y2={y(value)} className="stroke-hairline" strokeWidth={1} />
              <text x={L - 8} y={y(value) + 4} textAnchor="end" className="fill-ink-secondary">
                {formatMoney(money(value, currency)).replace(/\.\d+$/, '')}
              </text>
            </g>
          ))}
          {Array.from({ length: months + 1 }, (_, index) => {
            let accumulated = 0
            const bars = series.map((one, k) => {
              const value = one[index] ?? 0
              const bar = (
                <rect
                  key={rows[k]?.line.goalId}
                  x={L + index * bw + bw * 0.12}
                  y={y(accumulated + value)}
                  width={bw * 0.76}
                  height={Math.max(0, (value / top) * ih)}
                  style={{ fill: shade(k) }}
                />
              )
              accumulated += value
              return bar
            })
            const at = addMonths(from, index)
            return (
              <g key={index}>
                {bars}
                {index % every === 0 && (
                  <text x={L + index * bw + bw / 2} y={H - 10} textAnchor="middle" className="fill-ink-secondary">
                    {index === 0 ? 'Now' : `${formatMonthName(at).slice(0, 3)} ’${String(at.year).slice(2)}`}
                  </text>
                )}
              </g>
            )
          })}
          <text x={L + months * bw + bw} y={y(last) - 6} textAnchor="end" className="fill-ink font-medium">
            {formatMoney(money(last, currency)).replace(/\.\d+$/, '')}
          </text>
        </svg>
      </div>
      <Legend>
        {rows.map((row, k) => (
          <span key={row.line.goalId} className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2 w-3.5" style={{ background: shade(k) }} />
            <Bidi>{row.line.name}</Bidi>
          </span>
        ))}
      </Legend>
    </>
  )
}

/** One `DepositDraft` written, whichever of the three shapes it is. */
export function applyDraft(
  db: import('sql.js').Database,
  draft: DepositDraft,
  now: number,
): void {
  if (draft.kind === 'TRANSFER') {
    recordTransfer(
      db,
      {
        goalId: draft.goalId,
        date: draft.date,
        amount: draft.amount,
        fromHoldingId: draft.fromHoldingId,
        toHoldingId: draft.toHoldingId,
        note: draft.note,
      },
      now,
    )
    return
  }

  const deposit = draft.deposit
  if (deposit.id === 'new') {
    addDeposit(
      db,
      {
        goalId: deposit.goalId,
        date: deposit.date,
        amount: deposit.amount,
        holdingId: deposit.holdingId,
        // Which of the six kinds this is comes from the mode the user picked
        // (D-081). Left off, an opening balance would be filed as `MANUAL` and
        // counted as money saved this month by everything downstream.
        sourceKind: deposit.sourceKind,
        note: deposit.note,
      },
      now,
    )
    return
  }

  // `source_kind` is deliberately not among what an edit writes: correcting the
  // amount of a growth row must not turn it into a manual deposit.
  updateDeposit(
    db,
    deposit.id,
    {
      goalId: deposit.goalId,
      date: deposit.date,
      amount: deposit.amount,
      holdingId: deposit.holdingId,
      note: deposit.note,
    },
    now,
  )
}

/**
 * Every movement, newest first, with a subtotal per month.
 *
 * The subtotal is the month's **net**: a withdrawal shows against the deposits
 * beside it, because "what did I actually put away in June" is the question, and
 * a gross figure would answer a different one.
 */
function DepositList({
  deposits,
  goals,
  holdings,
  places,
  currency,
  onEdit,
  onDelete,
}: {
  deposits: readonly SavingDeposit[]
  goals: readonly { readonly id: string; readonly name: string }[]
  holdings: readonly Holding[]
  places: readonly HoldingPlace[]
  currency: CurrencyCode
  onEdit: (deposit: SavingDeposit) => void
  onDelete: (deposit: SavingDeposit) => void
}) {
  const [goalFilter, setGoalFilter] = useState<string>('')
  // Filters on the **place**, not the holding: "show me what is at the bank" is
  // the question people ask of a movement list, and a picker with three rows
  // called "Cash" answers a different one.
  const [placeFilter, setPlaceFilter] = useState<string>('')

  const placeOf = new Map(holdings.map((holding) => [holding.id, holding.holdingPlaceId]))
  const shown = deposits.filter(
    (deposit) =>
      (goalFilter === '' || deposit.goalId === goalFilter) &&
      (placeFilter === '' || placeOf.get(deposit.holdingId) === placeFilter),
  )

  if (deposits.length === 0) {
    return <Centered>No movements recorded yet.</Centered>
  }

  const months = new Map<string, SavingDeposit[]>()
  for (const deposit of shown) {
    const key = toYearMonthString(yearMonthOf(deposit.date))
    months.set(key, [...(months.get(key) ?? []), deposit])
  }

  return (
    <div>
      <div className="fc-view-enter flex flex-wrap items-center gap-3 border-b border-hairline px-6 py-2 text-caption">
        <select
          className="rounded border border-hairline-strong bg-elevated px-2 py-0.5"
          value={goalFilter}
          onChange={(event) => setGoalFilter(event.target.value)}
        >
          <option value="">Every goal</option>
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.name}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-hairline-strong bg-elevated px-2 py-0.5"
          value={placeFilter}
          onChange={(event) => setPlaceFilter(event.target.value)}
        >
          <option value="">Everywhere</option>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </select>
        <span className="text-ink-tertiary tabular-nums">{plural(shown.length, 'movement')}</span>
      </div>

      {[...months.entries()].map(([period, rows]) => {
        const net = rows.reduce((running, row) => running + row.amount.minor, 0)
        // The net is the sum of the rows printed underneath it and stays so —
        // a subtotal that quietly left one of them out would be a header
        // disagreeing with its own list. But once an opening balance or a
        // market gain is among them the net stops answering "what did I put
        // away", so the month says both figures rather than one under the
        // wrong name (D-081).
        const paidIn = rows
          .filter(isContribution)
          .reduce((running, row) => running + row.amount.minor, 0)
        return (
          <div key={period}>
            <h3 className="flex items-baseline justify-between border-b border-hairline bg-surface px-6 py-1 text-label text-ink-tertiary uppercase">
              <span>{period}</span>
              <span className="tabular-nums">
                {formatMoney(money(net, currency))} net
                {paidIn !== net && <> · {formatMoney(money(paidIn, currency))} paid in</>}
              </span>
            </h3>
            {rows.map((deposit) => {
              const goal = goals.find((one) => one.id === deposit.goalId)
              const holding = holdings.find((one) => one.id === deposit.holdingId)
              const place = places.find((one) => one.id === holding?.holdingPlaceId)
              const isTransfer = deposit.transferGroupKey !== undefined
              return (
                <div
                  key={deposit.id}
                  className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2"
                >
                  <span className="w-24 shrink-0 text-ink-tertiary tabular-nums">
                    {toISODate(deposit.date)}
                  </span>
                  <span className="min-w-32 flex-1">
                    <Bidi>{goal?.name ?? 'a goal that is gone'}</Bidi>
                    {deposit.note !== undefined && !isDefaultTransferNote(deposit) && (
                      <span className="ml-2 text-caption text-ink-tertiary">
                        <Bidi>{deposit.note}</Bidi>
                      </span>
                    )}
                  </span>
                  <span className="w-40 text-caption text-ink-tertiary">
                    <Bidi>{place?.name ?? 'somewhere unknown'}</Bidi>
                    {isTransfer
                      ? ' · moved'
                      : deposit.sourceKind === 'MANUAL'
                        ? ''
                        : ` · ${SOURCE_LABEL[deposit.sourceKind]}`}
                  </span>
                  <span
                    className={`w-28 text-right tabular-nums ${
                      deposit.amount.minor < 0 ? 'text-ink-secondary' : ''
                    }`}
                  >
                    {formatMoney(deposit.amount)}
                  </span>
                  <span className="flex gap-2">
                    {/* A generated deposit is not editable here: it is what a
                        payslip says, and the payslip is where it changes. */}
                    {deposit.sourceKind === 'MANUAL' && !isTransfer && (
                      <Button variant="ghost" size="sm" onClick={() => onEdit(deposit)}>
                        Edit
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => onDelete(deposit)}>
                      {isTransfer ? 'Delete both' : 'Delete'}
                    </Button>
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
