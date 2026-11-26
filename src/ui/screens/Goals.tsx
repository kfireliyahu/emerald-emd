import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { formatMoney, fromMajorUnits, minorUnitDigits, money, type CurrencyCode } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { addMonths, compareYearMonths, monthsBetween, toYearMonthString, yearMonthOf, type YearMonth } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import { goalsAfter, goalsPlan, setGoalMonthly, type GoalRow } from '@/data/repositories/goalPlanRepository.ts'
import { pauseGoal } from '@/data/repositories/goalRhythmRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { goalFeeds, holdingPutIn } from '@/data/repositories/goalDepositRepository.ts'
import { saveGoalAnswer, whereChoices } from '@/data/repositories/goalWhereRepository.ts'
import { isMovedKind } from '@/data/repositories/movedRepository.ts'
import {
  addDeposit,
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
import type { SavingDeposit } from '@/domain/model/savings.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { shortText } from '@/ui/charts/chart.ts'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { kitMoney, wholeMoney } from '@/ui/charts/kit.ts'
import { MonthTrend } from '@/ui/charts/MonthTrend.tsx'
import { PlanAgainst } from '@/ui/charts/PlanAgainst.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { editableMoney } from '@/ui/components/moneyText.ts'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState, WaitingList, type Waiting } from '@/ui/components/WaitingList.tsx'
import { blankDeposit, DepositEditor, type DepositDraft } from '@/ui/savings/DepositEditor.tsx'
import { ClosedNote, spentQuestionFor, useGoalClose } from '@/ui/savings/GoalClose.tsx'
import { blankGoal, GoalEditor } from '@/ui/savings/GoalEditor.tsx'
import { Movements } from '@/ui/savings/Movements.tsx'
import { rowKeys } from '@/ui/screens/Funds.tsx'
import { Problem } from '@/ui/screens/Overview.tsx'
import { today } from '@/ui/today.ts'
import { AMOUNT_FIELD, Seg } from '@/ui/wealth/parts.tsx'
import { MoreButton, removeQuestion, type Menu } from '@/ui/wealth/rowMenu.tsx'
import { useWealthWords, type WealthWords } from '@/ui/wealth/words.ts'

/**
 * **Goals, answered first** (M64 U10, D-622; M28 U8 made it the page that
 * decides the month): *am I on track for what I am saving for?*
 *
 * One sentence says what the goals hold and what goes toward them each month;
 * what they hold is the one display figure; each goal against its target is a
 * meter (`PlanAgainst`). What waits — a goal late at its rate, one nothing goes
 * toward, money set aside long ago, a split that is over — is one list below
 * that, a verb each. Then this month's amounts, one row a goal, typed in place:
 * **the amount is Plan's bucket that points at the goal** (choice 3 A), so typing
 * here and typing on Plan write the same number through `setGoalMonthly`.
 *
 * **The projection is plain addition and says so**: the balance plus the amount,
 * month by month, stopping at the target. It sits one click behind the table, in
 * the side panel. A goal's own page is the drawer over this list (D-326), and
 * the flat list of movements is a view of it, as it was.
 */
type View = 'GOALS' | 'DEPOSITS'
type Horizon = 6 | 12 | 24 | 'DUE'

export function Goals() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const t = useT()
  const words = useWealthWords()

  const [view, setView] = useState<View>('GOALS')
  const [horizon, setHorizon] = useState<Horizon>(12)
  const [editingGoal, setEditingGoal] = useState<{ isNew: boolean; goal: SavingGoalDraft; fromDrawer?: boolean } | undefined>()
  const [goalProblem, setGoalProblem] = useState<string | undefined>()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const [editingDeposit, setEditingDeposit] = useState<{ isNew: boolean; deposit: SavingDeposit } | undefined>()
  const [problem, setProblem] = useState<string | undefined>()
  const [showClosed, setShowClosed] = useState(false)
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({})
  const [menu, setMenu] = useState<Menu | undefined>()
  const [projection, setProjection] = useState(false)

  const asOf = today()
  const currency: CurrencyCode = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])
  const read = useMemo(() => (db === undefined ? undefined : goalsPlan(db, asOf, currency, { includeClosed: showClosed })), [db, revision, showClosed])
  const places = useMemo(() => (db === undefined ? [] : listHoldingPlaces(db, { includeArchived: true })), [db, revision])
  const holdings = useMemo(() => (db === undefined ? [] : listHoldings(db, { includeArchived: true })), [db, revision])
  const goals = useMemo(() => (db === undefined ? [] : listGoals(db, { includeClosed: true })), [db, revision])
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
  // Closing from a row's menu, with what it did and its Undo said above the list (M64 F72).
  const closing = useGoalClose(write)

  if (db === undefined || read === undefined) {
    return <Centered>{t('wealth.goals.noDocument')}</Centered>
  }

  const goalForm =
    editingGoal === undefined
      ? undefined
      : ((): ReactNode => {
        const editing = editingGoal.goal
        const feeds = goalFeeds(db)
        const current = feeds.get(editing.id)
        const names = new Map(goals.map((goal) => [goal.id, goal.name]))
        const readers = new Map([...feeds].filter(([id, feed]) => feed.kind === 'CATEGORY' && id !== editing.id).map(([id, feed]) => [feed.id, names.get(id)]))
        // Back to the drawer it came from takes the drawer's own entry back (M31 U9):
        // its Edit replaced it with this form, so history reads as it did before.
        const close = (goalId: string | undefined): void => {
          setEditingGoal(undefined)
          setGoalProblem(undefined)
          if (goalId !== undefined) navigate(`/wealth/goals/${goalId}`, { replace: editingGoal.fromDrawer === true })
        }
        return (
          <SidePanel title={editingGoal.isNew ? t('wealth.goalForm.addTitle') : t('wealth.goalForm.editTitle')} kicker={editingGoal.isNew ? t('wealth.goals.title') : editingGoal.goal.name} onClose={() => close(editingGoal.fromDrawer === true ? editingGoal.goal.id : undefined)}>
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
          </SidePanel>
        )
      })()

  const depositForm =
    editingDeposit === undefined
      ? undefined
      : ((): ReactNode => {
        return (
          <SidePanel title={editingDeposit.isNew ? t('wealth.movementForm.addTitle') : t('wealth.movementForm.editTitle')} kicker={goals.find((one) => one.id === editingDeposit.deposit.goalId)?.name} onClose={() => setEditingDeposit(undefined)}>
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
          </SidePanel>
        )
      })()

  // A form with several fields opens beside the page (D-617, M64 F3); one at a time.
  const form = goalForm ?? depositForm

  const { rows, plan, month } = read
  const canRecord = goals.length > 0 && holdings.length > 0
  const newGoal = (): void => setEditingGoal({ isNew: true, goal: blankGoal() })
  const recordMovement = (): void => setEditingDeposit({ isNew: true, deposit: blankDeposit(goals[0], holdings, asOf, currency) })

  if (view === 'DEPOSITS') {
    return (
      <div className="flex h-full">
        <div className="h-full min-w-0 flex-1 overflow-auto">
          <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
            <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="flex flex-col gap-1">
                <button type="button" className="fc-text-action self-start" onClick={() => setView('GOALS')}>
                  {t('wealth.goals.movements.back')}
                </button>
                <h1 className="m-0 text-title leading-tight font-medium">{t('wealth.goals.movements.title')}</h1>
              </div>
              {canRecord && (
                <Button variant="primary" icon="add" onClick={recordMovement}>
                  {t('wealth.goals.movements.record')}
                </Button>
              )}
            </header>
            {problem !== undefined && <Problem text={problem} onDismiss={() => setProblem(undefined)} />}
            <Movements
              deposits={deposits}
              goals={goals}
              holdings={holdings}
              places={places}
              currency={currency}
              write={write}
              onEdit={(deposit) => setEditingDeposit({ isNew: false, deposit })}
            />
          </div>
        </div>
        {form}
      </div>
    )
  }

  // The time you pick. "Until the last date" is the latest date a goal has.
  const lastDue = rows.reduce<YearMonth | undefined>(
    (latest, row) => (row.line.due !== undefined && (latest === undefined || monthsBetween(latest, row.line.due) > 0) ? row.line.due : latest),
    undefined,
  )
  const months = horizon === 'DUE' ? Math.max(1, monthsBetween(month, lastDue ?? addMonths(month, 12))) : horizon

  /** Plan's own write, the one the tools use (D-323, M28 F10): one function for a figure typed here and one typed on Plan. */
  const setMonthly = (row: GoalRow, minor: number): void => {
    if (plan === undefined) return
    write((database, now) => {
      const result = setGoalMonthly(database, asOf, currency, row.line.goalId, minor, now)
      if (result === 'SEVERAL_BUCKETS') throw new Error(t('wealth.goals.severalBuckets', { name: row.line.name }))
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

  const menuItems = (row: GoalRow, at: Menu['at']): MenuItem[] => {
    const goal = row.progress.goal
    const held = spentQuestionFor(db, goal, currency)
    return [
      ...(canRecord
        ? [
            {
              // Named for what it opens (M64 F72): a movement, in or out, not only a deposit.
              label: t('wealth.goals.menu.movement'),
              detail: t('wealth.goals.menu.movementWhy'),
              icon: 'add',
              onChoose: () => setEditingDeposit({ isNew: true, deposit: blankDeposit(goal, holdings, asOf, currency) }),
            } satisfies MenuItem,
          ]
        : []),
      row.pausedUntil === undefined
        ? { label: t('wealth.goals.menu.pause'), detail: t('wealth.goals.menu.pauseWhy'), onChoose: () => write((database) => void pauseGoal(database, goal.id, 1, asOf)) }
        : {
            label: t('wealth.goals.menu.resume'),
            detail: t('wealth.goals.menu.pausedUntil', { month: words.dates.monthShort(row.pausedUntil) }),
            onChoose: () => write((database) => void pauseGoal(database, goal.id, 0, asOf)),
          },
      { label: t('wealth.common.edit'), icon: 'edit', onChoose: () => setEditingGoal({ isNew: false, goal }) },
      {
        label: t('wealth.goals.menu.close'),
        detail: held === undefined ? t('wealth.goals.menu.closeWhy') : t('wealth.goals.menu.closeAsks'),
        // A goal that still holds money asks, at the same point, whether it was spent (M64 F72):
        // the same menu again, never a bar at the bottom. One that holds nothing closes at once.
        onChoose: () =>
          held === undefined
            ? closing.close(goal, false, undefined)
            : setMenu({
                at,
                title: <Phrase text={t('wealth.goals.menu.spentQuestion', { amount: formatMoney(held) })} parts={{ name: <Bidi>{goal.name}</Bidi> }} />,
                sub: t('wealth.goals.menu.spentWhy'),
                items: [
                  { label: t('wealth.goals.menu.spent'), onChoose: () => closing.close(goal, true, held) },
                  { label: t('wealth.goals.menu.notSpent'), onChoose: () => closing.close(goal, false, held) },
                  { label: t('wealth.common.cancel'), separated: true, onChoose: () => undefined },
                ],
              }),
      },
      {
        label: t('wealth.common.delete'),
        icon: 'trash',
        separated: true,
        onChoose: () =>
          setMenu(
            removeQuestion(at, t('wealth.goals.menu.deleteQuestion', { name: row.line.name }), t('wealth.goals.menu.deleteCost'), words, () =>
              write((database, now) => deleteGoal(database, goal.id, now)),
            ),
          ),
      },
    ]
  }

  const noGoals = rows.length === 0 && read.closed.length === 0
  const horizons: readonly (readonly [Horizon, string])[] = [
    [6, t(countKey('wealth.goals.months', 6), { count: 6 })],
    [12, t(countKey('wealth.goals.months', 12), { count: 12 })],
    [24, t(countKey('wealth.goals.months', 24), { count: 24 })],
    ...(lastDue === undefined ? [] : ([['DUE', t('wealth.goals.until', { month: words.dates.monthShort(lastDue) })]] as const)),
  ]

  // What waits on the person, a line each, below the answer.
  const waiting: Waiting[] = rows.flatMap((row): Waiting[] => {
    const lines: Waiting[] = []
    const name = row.line.name
    if (row.pausedUntil === undefined && row.status.kind === 'LATE' && row.needed !== undefined && plan !== undefined && row.bucketIds.length <= 1) {
      const needed = row.needed
      lines.push({
        key: `${row.line.goalId}:late`,
        say: t(countKey('wealth.goals.waiting.late', row.status.monthsLate), { name, count: row.status.monthsLate }),
        why: t('wealth.goals.waiting.lateWhy', { amount: wholeMoney(needed) }),
        verb: t('wealth.goals.waiting.use', { amount: wholeMoney(needed) }),
        onDo: () => setMonthly(row, needed.minor),
      })
    } else if (row.pausedUntil === undefined && row.status.kind === 'NO_MONEY') {
      lines.push({
        key: `${row.line.goalId}:none`,
        say: t('wealth.goals.waiting.noMoney', { name }),
        why: t('wealth.goals.waiting.noMoneyWhy'),
        verb: t('wealth.goals.waiting.open'),
        onDo: () => navigate(`/wealth/goals/${row.line.goalId}`),
      })
    }
    const stale = row.stale.reduce((sum, one) => sum + one.amount.minor, 0)
    if (stale > 0) {
      lines.push({
        key: `${row.line.goalId}:stale`,
        say: t('wealth.goals.waiting.stale', { name, amount: wholeMoney(money(stale, currency)) }),
        why: t('wealth.goals.waiting.staleWhy'),
        verb: t('wealth.goals.waiting.check'),
        onDo: () => navigate(`/wealth/goals/${row.line.goalId}`),
      })
    }
    return lines
  })
  if (left !== undefined && left.minor < 0) {
    waiting.push({
      key: 'over',
      say: t('wealth.goals.waiting.over', { amount: wholeMoney(money(-left.minor, currency)) }),
      why: t('wealth.goals.waiting.overWhy'),
      verb: t('wealth.goals.waiting.plan'),
      onDo: () => navigate('/plan'),
    })
  }

  const page = (
    <div className="fc-view-enter flex flex-col gap-8 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="m-0 text-title leading-tight font-medium">{t('wealth.goals.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="primary" icon="add" onClick={newGoal}>
            {t('wealth.goals.add')}
          </Button>
          <PageMenu
            title={t('wealth.goals.title')}
            items={[
              { label: t('wealth.goals.menu.movements'), detail: t('wealth.goals.menu.movementsWhy'), onChoose: () => setView('DEPOSITS') },
              { label: showClosed ? t('wealth.goals.menu.hideClosed') : t('wealth.goals.menu.showClosed'), separated: true, onChoose: () => setShowClosed(!showClosed) },
            ]}
          />
        </div>
      </header>

      {problem !== undefined && <Problem text={problem} onDismiss={() => setProblem(undefined)} />}

      {noGoals ? (
        <EmptyState say={t('wealth.goals.empty')} verb={t('wealth.goals.add')} onDo={newGoal} />
      ) : (
        <>
          {rows.length > 0 && (
            <div className="flex flex-col gap-6">
              <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">
                {plan === undefined || read.monthly.minor === 0
                  ? t(countKey('wealth.goals.sentenceNoMonthly', rows.length), { count: rows.length, saved: wholeMoney(read.inGoals) })
                  : t(countKey('wealth.goals.sentence', rows.length), { count: rows.length, saved: wholeMoney(read.inGoals), monthly: wholeMoney(read.monthly) })}
              </p>
              <HeadlineFigure
                size="display"
                label={t('wealth.goals.figure')}
                value={read.inGoals}
                change={plan === undefined ? t('wealth.goals.figureNoPlan') : t('wealth.goals.figureHow', { amount: wholeMoney(read.monthly) })}
                empty={t('wealth.goals.empty')}
              />
              {/* One hairline between the meters and what waits under them: the last meter draws none. */}
              <div className="[&_li:last-child>*]:border-b-0">
              <PlanAgainst
                lines={rows.map((row) => {
                  const target = row.line.target
                  // A goal at or past its target is reached, never *over*: a full meter that says so.
                  const reached = target !== undefined && row.line.balance.minor >= target.minor
                  return { key: row.line.goalId, name: row.line.name, actual: row.line.balance, planned: target, ...(reached ? { note: t('wealth.goals.status.reached') } : {}) }
                })}
                empty={t('wealth.goals.empty')}
                onOpen={(key) => navigate(`/wealth/goals/${key}`)}
              />
              </div>
            </div>
          )}

          <WaitingList label={t('wealth.common.waiting')} items={waiting} />

          <ClosedNote closed={closing.closed} onUndo={closing.undo} />

          {rows.length > 0 && (
            <section className="flex flex-col gap-3" aria-labelledby="goals-month">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h2 id="goals-month" className="m-0 text-heading font-medium">
                  {t('wealth.goals.list.title')}
                </h2>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Seg options={horizons} value={horizon} onChange={setHorizon} label={t('wealth.goals.list.horizon')} />
                  <button type="button" className="fc-text-action" onClick={() => setProjection(true)}>
                    {t('wealth.goals.list.projection')}
                  </button>
                </span>
              </div>
              <p className="m-0 text-caption text-ink-secondary">
                {plan === undefined ? t('wealth.goals.list.noPlan') : t('wealth.goals.list.how')}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-hairline text-caption text-ink-secondary uppercase">
                      <th className="h-8 pe-3 text-start font-medium">{t('wealth.goals.list.goal')}</th>
                      <th className="h-8 pe-3 text-end font-medium">{t('wealth.goals.list.monthly')}</th>
                      <th className="h-8 pe-3 text-end font-medium">{t('wealth.goals.list.moved')}</th>
                      <th className="h-8 pe-3 text-end font-medium">{t(countKey('wealth.goals.list.after', months), { count: months })}</th>
                      <th className="h-8 ps-6 pe-3 text-start font-medium">{t('wealth.goals.list.rate')}</th>
                      <th className="h-8 w-9" aria-label={t('wealth.common.more')} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <GoalTableRow
                        key={row.line.goalId}
                        row={row}
                        months={months}
                        on={row.line.goalId === openId}
                        editable={plan !== undefined}
                        text={typed[row.line.goalId]}
                        words={words}
                        onOpen={() => navigate(`/wealth/goals/${row.line.goalId}`)}
                        onText={(text) => setTyped((current) => ({ ...current, [row.line.goalId]: text }))}
                        onCommit={() => commit(row)}
                        onMenu={(at) => setMenu({ at, items: menuItems(row, at), title: row.line.name })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {read.closed.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="goals-closed">
              <h2 id="goals-closed" className="m-0 text-heading font-medium">
                {t('wealth.goals.closed')}
              </h2>
              {read.closed.map((progress) => (
                <p key={progress.goal.id} className="m-0 flex flex-wrap items-baseline gap-x-4 border-b border-hairline py-2">
                  <button type="button" className="text-start hover:text-accent" onClick={() => navigate(`/wealth/goals/${progress.goal.id}`)}>
                    <Bidi>{progress.goal.name}</Bidi>
                  </button>
                  <span className="text-ink-secondary tabular-nums">{kitMoney(progress.balance)}</span>
                  <button type="button" className="fc-text-action" onClick={() => write((database, now) => setGoalClosed(database, progress.goal.id, false, now))}>
                    {t('wealth.goals.reopen')}
                  </button>
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>
      {form}
      {form === undefined && projection && rows.length > 0 && (
        <SidePanel title={t('wealth.goals.projection.title')} kicker={t(countKey('wealth.goals.projection.kicker', months), { count: months })} onClose={() => setProjection(false)}>
          <p className="m-0">{t(countKey('wealth.goals.projection.sentence', months), { count: months, amount: wholeMoney(inAfter) })}</p>
          <Projection rows={rows} months={months} from={month} currency={currency} words={words} />
          <p className="m-0 text-caption text-ink-secondary">{t('wealth.goals.projection.how')}</p>
        </SidePanel>
      )}
      {menu !== undefined && (
        <ContextMenu
          key={String(menu.title)}
          at={menu.at}
          items={menu.items}
          onClose={() => setMenu(undefined)}
          header={{ title: <Bidi>{menu.title}</Bidi>, ...(menu.sub === undefined ? {} : { sub: menu.sub }) }}
        />
      )}
    </div>
  )
}

type SavingGoalDraft = Parameters<typeof GoalEditor>[0]['initial']

/** Moved against planned, only over the months the goal was taking money (U9's first task). */
export function versusPlanWords(versus: VersusPlan, words: WealthWords): string {
  const { t } = words
  if (versus.kind === 'PAUSED') return t('wealth.goals.versus.paused')
  if (versus.kind === 'NOTHING_YET') return t('wealth.goals.versus.nothing')
  const figure = `${versus.difference.minor > 0 ? '+' : ''}${kitMoney(versus.difference)}`
  return versus.months === MOVED_MONTHS ? t('wealth.goals.versus.plan', { figure }) : t(countKey('wealth.goals.versus.planMonths', versus.months), { figure, count: versus.months })
}

/** When a goal lands at its rate, in a few words; `problem` only for what is worth acting on. */
function statusWords(status: GoalStatus, words: WealthWords): { readonly line: string; readonly problem: boolean } {
  const { t, dates } = words
  switch (status.kind) {
    case 'REACHED':
      return { line: t('wealth.goals.status.reached'), problem: false }
    case 'ON_TIME':
      return { line: t('wealth.goals.status.onTime', { month: dates.monthShort(status.at) }), problem: false }
    case 'LATE':
      return { line: t(countKey('wealth.goals.status.late', status.monthsLate), { month: dates.monthShort(status.at), count: status.monthsLate }), problem: true }
    case 'NO_DATE':
      return { line: t('wealth.goals.status.noDate', { month: dates.monthShort(status.at) }), problem: false }
    case 'NO_MONEY':
      return { line: t('wealth.goals.status.noMoney'), problem: true }
    case 'NO_TARGET':
      return { line: t('wealth.goals.status.noTarget'), problem: false }
  }
}

/** One goal this month: the row opens its drawer; the amount is typed in place. */
function GoalTableRow({
  row,
  months,
  on,
  editable,
  text,
  words,
  onOpen,
  onText,
  onCommit,
  onMenu,
}: {
  readonly row: GoalRow
  readonly months: number
  readonly on: boolean
  readonly editable: boolean
  readonly text: string | undefined
  readonly words: WealthWords
  readonly onOpen: () => void
  readonly onText: (text: string) => void
  readonly onCommit: () => void
  readonly onMenu: (at: { x: number; y: number }) => void
}) {
  const { t, dates } = words
  const { line, progress } = row
  const after = balanceAfter(line, months)
  const status = statusWords(row.status, words)
  const targetDate = progress.goal.targetDate
  const growth = line.agreedRateBasisPoints === undefined ? undefined : agreedGrowthAfter(line, months)
  const cell = `h-10 border-t border-hairline pe-3 align-middle ${on ? 'bg-surface' : 'group-hover:bg-surface'}`

  return (
    <tr
      className="group cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      tabIndex={0}
      aria-current={on ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(event) => rowKeys(event, onOpen)}
    >
      <td className={`${cell} min-w-40 py-2`}>
        <Bidi className="font-medium">{line.name}</Bidi>
        <span className="block text-caption text-ink-secondary">
          {targetDate === undefined ? t('wealth.goals.list.noDate') : t('wealth.goals.list.by', { month: dates.monthShort(yearMonthOf(targetDate)) })}
        </span>
      </td>
      <td className={`${cell} py-2 text-end tabular-nums`} onClick={(event) => event.stopPropagation()}>
        {editable && row.bucketIds.length <= 1 ? (
          <input
            inputMode="decimal"
            aria-label={t('wealth.goals.list.monthlyFor', { name: line.name })}
            value={text ?? editableMoney(line.monthly)}
            placeholder="0"
            onChange={(event) => onText(event.target.value)}
            onBlur={onCommit}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className={AMOUNT_FIELD}
          />
        ) : (
          <span>{kitMoney(line.monthly)}</span>
        )}
        <span className="block text-caption text-ink-secondary">
          {row.bucketIds.length > 1
            ? t('wealth.goals.list.severalBuckets', { count: row.bucketIds.length })
            : row.pausedUntil !== undefined
              ? t('wealth.goals.list.pausedUntil', { month: dates.monthShort(row.pausedUntil) })
              : t('wealth.goals.list.planBucket')}
        </span>
      </td>
      <td className={`${cell} py-2 text-end whitespace-nowrap tabular-nums`}>
        {kitMoney(row.moved)}
        <span className="block text-caption text-ink-secondary">{versusPlanWords(row.versusPlan, words)}</span>
      </td>
      <td className={`${cell} py-2 text-end whitespace-nowrap tabular-nums`}>
        {kitMoney(after)}
        {growth !== undefined && growth.minor > 0 && line.agreedRateBasisPoints !== undefined && (
          <span className="block text-caption text-ink-secondary">
            {t('wealth.goals.list.agreed', { amount: wholeMoney(growth), rate: formatPercent(line.agreedRateBasisPoints) })}
          </span>
        )}
      </td>
      <td className={`${cell} py-2 ps-6 text-caption ${status.problem && row.pausedUntil === undefined ? 'text-negative' : 'text-ink-secondary'}`}>
        {row.pausedUntil === undefined ? status.line : t('wealth.goals.status.paused', { month: dates.monthShort(row.pausedUntil) })}
      </td>
      <td className={`${cell} w-9 pe-0`}>
        <MoreButton label={t('wealth.common.moreFor', { name: line.name })} onMenu={onMenu} />
      </td>
    </tr>
  )
}

/**
 * What the goals will hold, month by month, by plain addition — each goal stops
 * at its target — as one line, the total: the figure at its end is the table's
 * *In N months*, added up.
 */
function Projection({
  rows,
  months,
  from,
  currency,
  words,
}: {
  readonly rows: readonly GoalRow[]
  readonly months: number
  readonly from: YearMonth
  readonly currency: CurrencyCode
  readonly words: WealthWords
}) {
  const { t, dates } = words
  const scale = 10 ** minorUnitDigits(currency)
  const points = Array.from({ length: months + 1 }, (_, index) => addMonths(from, index))
  const values = points.map((_, index) => rows.reduce((sum, row) => sum + balanceAfter(row.line, index).minor, 0) / scale)
  const now = yearMonthOf(today())
  return (
    <MonthTrend
      months={points.map((period) => ({
        key: toYearMonthString(period),
        label: dates.monthAbbrev(period),
        long: dates.yearMonth(period),
        running: compareYearMonths(period, now) === 0,
      }))}
      series={[{ key: 'goals', name: t('wealth.goals.projection.series'), values, hue: 'bar' }]}
      open={0}
      label={t('wealth.goals.projection.title')}
      empty={t('wealth.goals.projection.empty')}
      format={(value) => wholeMoney(money(Math.round(value * scale), currency))}
      tick={(value) => shortText(value, { currency })}
    />
  )
}

/** One `DepositDraft` written, whichever of the three shapes it is. */
export function applyDraft(db: import('sql.js').Database, draft: DepositDraft, now: number): void {
  if (draft.kind === 'TRANSFER') {
    recordTransfer(
      db,
      { goalId: draft.goalId, date: draft.date, amount: draft.amount, fromHoldingId: draft.fromHoldingId, toHoldingId: draft.toHoldingId, note: draft.note },
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
  updateDeposit(db, deposit.id, { goalId: deposit.goalId, date: deposit.date, amount: deposit.amount, holdingId: deposit.holdingId, note: deposit.note }, now)
}

function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
