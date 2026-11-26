import { useMemo, useRef, useState } from 'react'

import { formatMoney, fromMajorUnits, money, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  addMonths,
  monthRange,
  parseISODate,
  toISODate,
  toYearMonthString,
  yearMonthOf,
  type YearMonth,
} from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import { createCategory, listCategories } from '@/data/repositories/categoryRepository.ts'
import { isMovedKind } from '@/data/repositories/movedRepository.ts'
import { createDebt, listDebts } from '@/data/repositories/debtRepository.ts'
import { listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import {
  actualsByCategory,
  actualsByMerchant,
  clearDismissal,
  confirmCandidate,
  createFixedExpense,
  deleteFixedExpense,
  dismissMerchant,
  billCandidates,
  dismissedMerchants,
  endFixedExpense,
  listExpenseObservations,
  updateFixedExpense,
} from '@/data/repositories/fixedExpenseRepository.ts'
import { createAccount, listAccounts, type AccountKind } from '@/data/repositories/accountRepository.ts'
import { cushionReading } from '@/data/repositories/cushionRepository.ts'
import { createFund, listFunds } from '@/data/repositories/fundRepository.ts'
import { FUND_TYPES, type FundType } from '@/domain/model/funds.ts'
import { listPaychecks } from '@/data/repositories/paycheckRepository.ts'
import { applySuggestions, planAgainstActual, planMonth, removePlanBuckets, type PlanActual } from '@/data/repositories/planMonthRepository.ts'
import { setRoles } from '@/data/repositories/planFixedRepository.ts'
import { listGoals } from '@/data/repositories/savingsRepository.ts'
import { saveGoalAnswer, whereChoices } from '@/data/repositories/goalWhereRepository.ts'
import { editableMoney } from '@/ui/components/moneyText.ts'
import { CushionLine } from '@/ui/savings/Cushion.tsx'
import { SuggestionPanel } from '@/ui/savings/GoalPanels.tsx'
import { applyGoalSplit, suggestGoalSplit } from '@/data/repositories/goalPlanRepository.ts'
import type { Suggestion as GoalSuggestion } from '@/domain/goalRhythm.ts'
import {
  createSplitBucket,
  createSplitPlan,
  deleteSplitPlan,
  duplicateSplitPlan,
  listPlanMonths,
  listSplitPlans,
  reorderSplitBuckets,
  setDefaultPlan,
  setPlanMonths,
  updateSplitBucket,
  updateSplitPlan,
  type NewAllocation,
} from '@/data/repositories/splitPlanRepository.ts'
import { DEFAULT_WINDOW_MONTHS } from '@/domain/fixedExpenses.ts'
import { makeStarterPlan, starterPlanProposal } from '@/data/repositories/categoryBudgetRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { starterPlacement, type StarterAnswer, type StarterHeading } from '@/domain/starterPlan.ts'
import type { FixedExpense, FixedRole } from '@/domain/model/fixed.ts'
import {
  BASIS_KINDS,
  type Allocation,
  type AllocationMode,
  type BasisKind,
  type SplitBucket,
  type TargetKind,
} from '@/domain/model/plan.ts'
import {
  changedTo,
  splitAllocation,
  splitPlan as computeSplit,
  tradedAt,
  type Suggestion,
} from '@/domain/splitter.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { type Translate, useDates, useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { wholeMoney } from '@/ui/charts/kit.ts'
import { PlanAgainst } from '@/ui/charts/PlanAgainst.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState as OneSentence, WaitingList, type Waiting } from '@/ui/components/WaitingList.tsx'
import { FixedExpenseEditor } from '@/ui/fixed/FixedExpenseEditor.tsx'
import { Pager } from '@/ui/home/parts.tsx'
import { useCategoryPalette } from '@/ui/components/CategoryMark.tsx'
import { BucketEditor } from '@/ui/plan/BucketEditor.tsx'
import { columnsOf, sectionBuckets } from '@/ui/plan/bucketGroups.ts'
import { eligibleParents } from '@/ui/categories/parentFilter.ts'
import { BillActions, Candidates, EndedBills, FixedSection } from '@/ui/plan/FixedSection.tsx'
import { MonthRow } from '@/ui/plan/MonthRow.tsx'
import { PlanBar, type Trade } from '@/ui/plan/PlanBar.tsx'
import { usePlanView } from '@/ui/plan/usePlanView.ts'
import { PointsAt, type NewPointable, type Pointable } from '@/ui/plan/PointsAt.tsx'
import { StarterProposal } from '@/ui/plan/StarterProposal.tsx'
import { bucketColour } from '@/ui/plan/planLook.ts'
import { BASIS_LABEL } from '@/ui/split/labels.ts'
import { today } from '@/ui/today.ts'

/** The bar snaps a size to this much, in minor units — ₪50. A divider is a gesture, not a typed figure. */
const SNAP = 5000

/** What Plan's side panel holds: one place for each thing that moved one click behind what it explains (M64 U9). */
type Panel =
  | { readonly kind: 'months' | 'basis' | 'cushion' | 'candidates' | 'newBill' | 'ended' | 'newBucket' | 'suggest' }
  | { readonly kind: 'bill'; readonly id: string }
  | { readonly kind: 'bucket'; readonly id: string }

/**
 * **Plan** — where next month's money goes (M28 U7, D-319; the report since
 * M64 U9, D-621).
 *
 * **It answers first, in words**: net pay, what the bills take first and what
 * is left to split, said as one sentence with whether every shekel has a job,
 * then *to split* as the screen's one display figure. What waits on the person
 * — a deposit the plan puts in this month, charges that look like bills, money
 * with no job, no net pay at all — is one quiet strip below the answer. Then
 * net pay, the bills out of net and the cushion as tiles; the split, its bar
 * and each bucket against the month it is held against; and the bills, one
 * row each with the one choice that says what it does to the plan.
 *
 * **Detail opens beside the page** (`SidePanel`): a bucket's line its editor, a
 * bill's name its form, net pay its basis, the cushion its months and
 * accounts, the plan's name the months it is for. A choice is a popover at its
 * line, and a removal asks at the button that asked.
 *
 * **Every edit is written as it is made**, as the splitter always did: a plan is
 * something you fiddle with. A divider drag is previewed and written once, when
 * the pointer comes up. **The screen never normalizes**: shares summing to 130%
 * stay at 130% and the answer says what that means (docs/f05). A conversation
 * does all of it too (`set_plan`, `set_fixed_expense_roles`, `plan_month`).
 */
export function Plan() {
  const t = useT()
  const dates = useDates()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [planId, setPlanId] = useState<string | undefined>()
  const [planView, choosePlanView] = usePlanView()
  const [month, setMonth] = useState<YearMonth>(() => yearMonthOf(today()))
  const [panel, setPanel] = useState<Panel | undefined>()
  /** The month under *Against* once one is chosen; until then the last whole month (M31 U4). */
  const [againstPick, setVersus] = useState<YearMonth | undefined>()
  const [windowMonths, setWindowMonths] = useState<number>(DEFAULT_WINDOW_MONTHS)
  const [problem, setProblem] = useState<string | undefined>()
  const [hot, setHot] = useState<string | undefined>()
  const [dragging, setDragging] = useState<{ readonly trade: Trade; readonly at: number } | undefined>()
  const [pointing, setPointing] = useState<
    { readonly bucket: SplitBucket; readonly at: { readonly x: number; readonly y: number } } | undefined
  >()
  const [planMenu, setPlanMenu] = useState<{ readonly x: number; readonly y: number } | undefined>()
  /** Where the plan's menu opened, so its delete asks at the same button (M64 U9). */
  const menuAt = useRef<{ readonly x: number; readonly y: number }>({ x: 0, y: 0 })
  const [deletingPlan, setDeletingPlan] = useState(false)
  const [renamingPlan, setRenamingPlan] = useState<string | undefined>()
  const [compareId, setCompareId] = useState<string | undefined>()
  const [customText, setCustomText] = useState<string | undefined>()
  const [newBucket, setNewBucket] = useState('')
  /** The 50 / 30 / 20 starter's answers while its proposal is open; undefined while it is not (M59 U4). */
  const [starterAnswers, setStarterAnswers] = useState<ReadonlyMap<string, StarterAnswer> | undefined>()

  const asOf = useMemo(() => today(), [])
  const plans = useMemo(() => (db === undefined ? [] : listSplitPlans(db)), [db, revision])
  const categories = useMemo(() => (db === undefined ? [] : listCategories(db)), [db, revision])
  const palette = useCategoryPalette(categories)
  const paychecks = useMemo(() => (db === undefined ? [] : listPaychecks(db)), [db, revision])
  const pm = useMemo(
    () => (db === undefined ? undefined : planMonth(db, { planId, month, asOf })),
    [db, revision, planId, month, asOf],
  )
  /** The 50 / 30 / 20 starter, shown before it is made (M59 U4, D-580): read only while it is open and there is no plan. */
  const proposal = useMemo(
    () =>
      db === undefined || pm !== undefined || starterAnswers === undefined
        ? undefined
        : starterPlanProposal(db, asOf, paychecks[0]?.net.currency ?? documentCurrency(db), starterAnswers),
    [db, revision, pm, asOf, paychecks, starterAnswers],
  )
  const compare = useMemo(
    () =>
      db === undefined || compareId === undefined || compareId === pm?.plan.id
        ? undefined
        : planMonth(db, { planId: compareId, month, asOf, readings: false }),
    [db, revision, compareId, month, asOf, pm?.plan.id],
  )
  const goals = useMemo(() => (db === undefined ? [] : listGoals(db)), [db, revision])
  const debts = useMemo(() => (db === undefined ? [] : listDebts(db)), [db, revision])
  const funds = useMemo(() => (db === undefined ? [] : listFunds(db)), [db, revision])
  const accounts = useMemo(() => (db === undefined ? [] : listAccounts(db)), [db, revision])
  const deductionTypes = useMemo(() => (db === undefined ? [] : listDeductionTypes(db)), [db, revision])
  const cushion = useMemo(
    () => (db === undefined ? undefined : cushionReading(db, asOf, pm?.plan.currency ?? documentCurrency(db))),
    [db, revision, asOf, pm?.plan.currency],
  )

  const lastComplete = useMemo(() => addMonths(month, -1), [month])
  const versus = againstPick ?? lastComplete
  const given = useMemo(() => (db === undefined ? new Map<string, string>() : listPlanMonths(db)), [db, revision])
  const candidates = useMemo(
    () => (db === undefined ? [] : billCandidates(db, lastComplete, windowMonths)),
    [db, revision, windowMonths, lastComplete],
  )
  const dismissed = useMemo(() => (db === undefined ? [] : dismissedMerchants(db)), [db, revision])
  const actuals = useMemo(() => {
    const empty = new Map<string, Money>()
    if (db === undefined) return { byMerchant: empty, byCategory: empty }
    const range = monthRange(toYearMonthString(versus))
    if (range === undefined) return { byMerchant: empty, byCategory: empty }
    return {
      byMerchant: actualsByMerchant(db, range.from, range.to),
      byCategory: actualsByCategory(db, range.from, range.to),
    }
  }, [db, revision, versus])

  // The comparison is always on the screen (M31 U4): the bar's fills and each bucket's line.
  const against = useMemo(
    () => (db === undefined || pm === undefined ? undefined : planAgainstActual(db, pm, versus, asOf)),
    [db, revision, versus, pm, asOf],
  )

  if (db === undefined) {
    return <Centered>{t('plan.screen.noDocument')}</Centered>
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

  const currency: CurrencyCode = pm?.plan.currency ?? paychecks[0]?.net.currency ?? documentCurrency(db)

  if (pm === undefined) {
    if (proposal !== undefined && starterAnswers !== undefined) {
      const answers = starterAnswers
      return (
        <StarterProposal
          proposal={proposal}
          onChoose={(heading: StarterHeading, answer: StarterAnswer) => {
            // Choosing what the starter would have chosen by itself takes the person's say back out.
            const next = new Map(answers)
            if (starterPlacement(heading, new Map()).answer === answer) next.delete(heading.id)
            else next.set(heading.id, answer)
            setStarterAnswers(next)
          }}
          onMake={() =>
            write((database, now) => {
              setPlanId(makeStarterPlan(database, asOf, currency, answers, now))
              setStarterAnswers(undefined)
            })
          }
          onCancel={() => {
            setProblem(undefined)
            setStarterAnswers(undefined)
          }}
          problem={problem}
        />
      )
    }
    return (
      <EmptyState
        onStart={() => setStarterAnswers(new Map())}
        onEmpty={() =>
          write((database, now) => {
            setPlanId(createSplitPlan(database, { name: t('plan.screen.defaultName'), currency, isDefault: true }, now).id)
          })
        }
      />
    )
  }

  const { plan, allocations, buckets, basis, parts, known } = pm
  const taken = { netOff: parts.netOff, inSplit: parts.inSplit }

  /**
   * The plan as it is, and — while a divider is held — as the drag would leave
   * it. Computed twice on purpose: the first answer supplies the amount a
   * dragged size is measured against, and the second is what is drawn.
   */
  const settled = pm.result
  const order = settled.allocations.map((entry) => entry.allocation.id)
  const room = Math.max(0, settled.balance.minor)
  const shownAllocations =
    dragging === undefined
      ? allocations
      : tradedAt(allocations, dragging.trade.leftId, dragging.trade.leftMinor, settled.splittable, { snap: SNAP, room, order })
  const result = dragging === undefined ? settled : computeSplit(plan, buckets, shownAllocations, basis.amount, taken)

  const orphaned = (bucket: SplitBucket): boolean =>
    bucket.targetKind !== 'FREE' && (bucket.targetId === undefined || !known.has(bucket.targetId))
  const colours = new Map(
    result.allocations.map((entry) => [
      entry.bucket.id,
      bucketColour(orphaned(entry.bucket) ? { targetKind: 'FREE', targetId: undefined } : entry.bucket, palette),
    ]),
  )
  // What each bucket got in the month under Against, and what the bills in the split were charged.
  const lines = new Map((against?.versus.lines ?? []).map((line) => [line.bucket.id, line]))
  const got = new Map(
    [...lines].flatMap(([id, line]) => (line.actual === undefined ? [] : [[id, line.actual] as const])),
  )
  const splitBills = (against?.fixed ?? []).filter((line) => line.role === 'SPLIT' && line.planned !== undefined)
  const billsGot =
    against === undefined || !against.ledgerHasMonth || splitBills.length === 0
      ? undefined
      : money(splitBills.reduce((total, line) => total + (line.actual?.minor ?? 0), 0), currency)
  const measured = against?.ledgerHasMonth ?? false
  const nameOf = (bucket: SplitBucket): string | undefined => {
    const id = bucket.targetId
    if (id === undefined) return undefined
    switch (bucket.targetKind) {
      case 'CATEGORY':
        return categories.find((one) => one.id === id)?.path
      case 'SAVING_GOAL':
        return goals.find((one) => one.id === id)?.name
      case 'DEBT':
        return debts.find((one) => one.id === id)?.name
      case 'FUND':
        return funds.find((one) => one.id === id)?.name
      case 'ACCOUNT':
        return accounts.find((one) => one.id === id)?.name
      case 'FREE':
        return undefined
    }
  }

  const saveAllocations = (next: readonly Allocation[]): void => {
    write((database, now) => updateSplitPlan(database, plan.id, { allocations: next.map(toNewAllocation) }, now))
  }
  const setOne = (id: string, change: Partial<Allocation>): void =>
    saveAllocations(allocations.map((allocation) => (allocation.id === id ? { ...allocation, ...change } : allocation)))
  const sizeTo = (id: string, value: number): void =>
    saveAllocations(changedTo(allocations, id, value, settled.splittable, { overflow: true, order }))

  const commitTrade = (trade: Trade): void => {
    const next = tradedAt(allocations, trade.leftId, trade.leftMinor, settled.splittable, { snap: SNAP, room, order })
    if (next !== allocations) saveAllocations(next)
  }

  const locked = new Set(allocations.filter((one) => one.isLocked).map((one) => one.id))
  const dragTip =
    dragging === undefined
      ? undefined
      : (() => {
          const left = result.allocations.find((one) => one.allocation.id === dragging.trade.leftId)
          return left === undefined ? undefined : { text: `${left.bucket.name} ${formatMoney(left.amount)}`, at: dragging.at }
        })()

  // Under Needs, Wants and Saving, in the bar's order (M31 U4).
  const sections = sectionBuckets(result.allocations, (entry) => entry.bucket)
  const shares = sections.some((section) => section.share !== undefined)

  const pointable: Pointable = {
    SAVING_GOAL: goals.map((one) => ({ id: one.id, name: one.name })),
    DEBT: debts.map((one) => ({ id: one.id, name: one.name })),
    CATEGORY: categories.filter((one) => !one.isArchived).map((one) => ({ id: one.id, name: one.path })),
    FUND: funds.map((one) => ({ id: one.id, name: one.name })),
    ACCOUNT: accounts.map((one) => ({ id: one.id, name: one.name })),
    // The goal form's one question, in its words (M30 F3): each holding by one name, and none
    // another goal already follows.
    holdings: whereChoices(db, currency)
      .filter((one) => one.followedBy === undefined)
      .map((one) => ({ id: one.holdingId, name: one.detail === undefined ? one.name : `${one.name} ${one.detail}` })),
    parents: eligibleParents(categories)
      .filter((one) => one.kind !== 'INCOME')
      .map((one) => ({ id: one.id, name: one.path, moved: isMovedKind(one.kind) })),
  }

  /**
   * Make a goal, debt, category, fund or account right here and point the bucket at
   * it, in one write so one undo takes both back (M28 U8). Through the same
   * repository functions the Goals, Debts, Categories and Funds screens call; a
   * name taken or an amount that is not one is refused where it would be there.
   */
  const makeAndPoint = (bucket: SplitBucket, kind: Exclude<TargetKind, 'FREE'>, draft: NewPointable): string | undefined => {
    try {
      mutate((database) => {
        const now = Date.now()
        let id: string
        switch (kind) {
          case 'SAVING_GOAL': {
            // Name, target, date and where it is kept, as the mockup's form asks (M28 F10).
            const parsed = draft.target === undefined ? undefined : parseAmountText(draft.target)
            if (draft.target !== undefined && parsed === undefined) throw new Error(t('plan.screen.targetNotAmount'))
            const by = draft.by === undefined ? undefined : parseISODate(`${draft.by}-01`)
            // The goal form's one write (M30 F3), so a holding a broker's rows buy is followed here too.
            id = saveGoalAnswer(
              database,
              {
                name: draft.name,
                kind: 'SHORT_TERM',
                targetAmount: parsed === undefined ? undefined : fromMajorUnits(Math.abs(parsed), currency),
                targetDate: by,
                where: draft.holdingId === undefined ? undefined : { kind: 'HOLDING', holdingId: draft.holdingId },
              },
              now,
            ).id
            break
          }
          case 'DEBT': {
            const parsed = parseAmountText(draft.detail)
            if (parsed === undefined) throw new Error(t('plan.screen.leftNotAmount'))
            id = createDebt(
              database,
              { name: draft.name, kind: 'OTHER', principalAmount: fromMajorUnits(Math.abs(parsed), currency), openedDate: today() },
              now,
            ).id
            break
          }
          case 'CATEGORY':
            id = createCategory(
              database,
              { name: draft.name, kind: draft.detail === 'MOVED' ? 'SAVING' : 'EXPENSE', parentId: draft.parentId },
              now,
            )
            break
          case 'FUND':
            id = createFund(
              database,
              { name: draft.name, fundType: (FUND_TYPES as readonly string[]).includes(draft.detail) ? (draft.detail as FundType) : 'PENSION' },
              now,
            ).id
            break
          case 'ACCOUNT':
            id = createAccount(
              database,
              { name: draft.name, kind: draft.detail as AccountKind, ...(draft.last4 === undefined ? {} : { last4: draft.last4 }) },
              now,
            ).id
            break
        }
        updateSplitBucket(database, bucket.id, { targetKind: kind, targetId: id }, now)
      })
      setPointing(undefined)
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  // Against offers the last thirteen months, and the month on screen's own when it is later.
  const offered = Array.from({ length: 13 }, (_, index) => addMonths(yearMonthOf(asOf), -index))
  if (!offered.some((one) => toYearMonthString(one) === toYearMonthString(versus))) offered.push(versus)

  const unusedBuckets = buckets.filter((bucket) => !allocations.some((one) => one.bucketId === bucket.id))
  const lastEntry = result.allocations.at(-1)

  const others = plans.filter((one) => one.id !== plan.id)
  const planItems: MenuItem[] = [
    ...(others.length === 0
      ? []
      : [
          {
            label: t('plan.screen.menu.openOther'),
            submenu: others.map((one) => ({ label: <Bidi>{one.name}</Bidi>, onChoose: () => setPlanId(one.id) })),
          } satisfies MenuItem,
          {
            label: t('plan.screen.menu.compare'),
            submenu: [
              { label: t('plan.screen.menu.noCompare'), disabled: compare === undefined, onChoose: () => setCompareId(undefined) },
              ...others.map((one) => ({
                label: <Bidi>{one.name}</Bidi>,
                disabled: compare?.plan.id === one.id,
                onChoose: () => setCompareId(one.id),
              })),
            ],
          } satisfies MenuItem,
        ]),
    ...(compare === undefined
      ? [
          {
            label: planView === 'bar' ? t('plan.screen.menu.asRing') : t('plan.screen.menu.asBar'),
            onChoose: () => choosePlanView(planView === 'bar' ? 'ring' : 'bar'),
          } satisfies MenuItem,
        ]
      : []),
    {
      label: t('plan.screen.menu.copy'),
      icon: 'copy',
      separated: true,
      onChoose: () =>
        write((database, now) => {
          const copy = duplicateSplitPlan(database, plan.id, `${plan.name} copy`, now)
          if (copy !== undefined) setPlanId(copy.id)
        }),
    },
    ...(plan.isDefault
      ? []
      : [{ label: t('plan.screen.menu.makeDefault'), onChoose: () => write((database, now) => setDefaultPlan(database, plan.id, now)) } satisfies MenuItem]),
    { label: t('plan.screen.menu.renamePlan'), icon: 'edit', onChoose: () => setRenamingPlan(plan.name) },
    {
      label: t('plan.screen.menu.deletePlan'),
      icon: 'trash',
      detail: t('plan.screen.menu.deletePlanDetail'),
      separated: true,
      onChoose: () => setDeletingPlan(true),
    },
  ]

  const free = result.balance.minor
  const noPay = basis.unavailable

  // What waits on the person, below the answer: one line each, one verb each.
  const waiting: Waiting[] = []
  const onThisPlan = (given.get(toYearMonthString(month)) ?? plans[0]?.id) === plan.id
  const changes = pm.applied.changes
  if (onThisPlan && changes.length > 0) {
    const nameOfSuggestion = (one: Suggestion): string =>
      (one.kind === 'SAVING_DEPOSIT' ? goals : debts).find((each) => each.id === one.targetId)?.name ?? one.bucket.name
    const said = (one: Suggestion): string =>
      t(one.kind === 'SAVING_DEPOSIT' ? 'plan.record.into' : 'plan.record.off', { amount: formatMoney(one.amount), name: nameOfSuggestion(one) })
    const moved = changes.filter((one) => one.current !== undefined)
    const deposits = changes.some((one) => one.kind === 'SAVING_DEPOSIT')
    const payments = changes.some((one) => one.kind === 'DEBT_PAYMENT')
    waiting.push({
      key: 'record',
      say:
        moved.length === changes.length
          ? t('plan.record.moved', {
              items: listedIn(
                t,
                moved.map((one) =>
                  t(one.kind === 'SAVING_DEPOSIT' ? 'plan.record.recordedInto' : 'plan.record.recordedOff', {
                    amount: formatMoney(one.current ?? one.amount),
                    name: nameOfSuggestion(one),
                  }),
                ),
              ),
              month: dates.yearMonth(month),
              amounts: listedIn(t, moved.map((one) => formatMoney(one.amount))),
            })
          : t('plan.record.puts', { month: dates.yearMonth(month), plan: plan.name, list: listedIn(t, changes.map(said)) }),
      why:
        (deposits && payments ? t('plan.record.both') : deposits ? t('plan.record.deposit') : t('plan.record.payment')) +
        (changes.some((one) => one.alsoDiscovered) ? t('plan.record.alsoDiscovered') : ''),
      verb:
        moved.length === changes.length && changes.length === 1
          ? t('plan.record.instead', { amount: formatMoney(changes[0]?.amount ?? zero(currency)) })
          : changes.length === 1
            ? t('plan.record.it')
            : changes.length === 2
              ? t('plan.record.both2')
              : t('plan.record.all', { n: changes.length }),
      onDo: () => write((database, now) => applySuggestions(database, plan.id, month, changes, now)),
    })
  }
  if (noPay) {
    waiting.push({ key: 'basis', say: t('plan.screen.basis.unavailable'), verb: t('plan.waiting.choose'), onDo: () => setPanel({ kind: 'basis' }) })
  }
  if (!noPay && free > 0 && lastEntry !== undefined && lastEntry.allocation.mode !== 'REMAINDER') {
    waiting.push({
      key: 'free',
      say: t('plan.waiting.noJob', { amount: formatMoney(result.balance), name: lastEntry.bucket.name }),
      verb: t('plan.waiting.giveIt'),
      onDo: () => setOne(lastEntry.allocation.id, { mode: 'REMAINDER', basisPoints: undefined, amount: undefined }),
    })
  }
  if (candidates.length > 0) {
    waiting.push({
      key: 'candidates',
      say: candidates.length === 1 ? t('plan.fixed.candidatesOne') : t('plan.fixed.candidatesMany', { n: candidates.length }),
      why: t('plan.waiting.candidatesWhy'),
      verb: t('plan.waiting.look'),
      onDo: () => setPanel({ kind: 'candidates' }),
    })
  }

  const answer = noPay ? (
    t('plan.page.noPay')
  ) : (
    <>
      <Phrase
        text={parts.netOff.minor > 0 ? t('plan.page.answerBills') : t('plan.page.answerAll')}
        parts={{ net: <SaidAmount value={basis.amount} />, bills: <SaidAmount value={parts.netOff} /> }}
      />{' '}
      {free === 0 ? (
        t('plan.page.everyJob')
      ) : free > 0 ? (
        <Phrase text={t('plan.page.noJob')} parts={{ amount: <SaidAmount value={result.balance} /> }} />
      ) : (
        <span className="text-negative">
          <Phrase text={t('plan.page.tooMuch')} parts={{ amount: <SaidAmount value={money(-free, currency)} /> }} />
        </span>
      )}
    </>
  )

  const page = (
    <div className="fc-view-enter @container flex flex-col gap-8 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {renamingPlan === undefined ? (
            <h1 className="m-0 text-title leading-tight font-medium">
              <Bidi>{plan.name}</Bidi>
            </h1>
          ) : (
            <input
              autoFocus
              value={renamingPlan}
              onChange={(event) => setRenamingPlan(event.target.value)}
              onBlur={() => {
                const name = renamingPlan.trim()
                if (name !== '' && name !== plan.name) write((database, now) => updateSplitPlan(database, plan.id, { name }, now))
                setRenamingPlan(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setRenamingPlan(undefined)
                }
              }}
              aria-label={t('plan.screen.planName')}
              className={`${FIELD} w-64`}
            />
          )}
          {plan.isDefault && <span className="text-ink-secondary">{t('plan.page.isDefault')}</span>}
          <button type="button" className="fc-text-action" onClick={() => setPanel({ kind: 'months' })}>
            {t('plan.page.chooseMonths')}
          </button>
          <button
            type="button"
            aria-label={t('plan.screen.more')}
            title={t('plan.screen.moreTitle')}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              menuAt.current = { x: box.left, y: box.bottom }
              setPlanMenu(menuAt.current)
            }}
            className="fc-icon-action"
          >
            <ActionGlyph name="more" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-medium tabular-nums">{dates.yearMonth(month)}</span>
          <Pager
            label={t('plan.screen.month')}
            prev={dates.monthShort(addMonths(month, -1))}
            next={dates.monthShort(addMonths(month, 1))}
            onPrev={() => setMonth((current) => addMonths(current, -1))}
            onNext={() => setMonth((current) => addMonths(current, 1))}
          />
        </div>
      </header>

      {problem !== undefined && (
        <div role="alert" className="fc-pop-enter flex items-center gap-4 border-y border-hairline py-2">
          <span className="text-negative">{problem}</span>
          <button type="button" className="fc-text-action ms-auto" onClick={() => setProblem(undefined)}>
            {t('plan.screen.dismiss')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-6">
        <p className="m-0 max-w-[34ch] text-lede [text-wrap:balance]">{answer}</p>
        <HeadlineFigure
          size="display"
          tone="sign"
          label={t('plan.bar.toSplit')}
          value={noPay ? undefined : result.splittable}
          change={result.allocations.length === 1 ? t('plan.page.bucketsOne') : t('plan.page.bucketsMany', { n: result.allocations.length })}
          empty={t('plan.page.noPay')}
        />
      </div>

      <WaitingList label={t('plan.waiting.title')} items={waiting} />

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 border-t border-hairline pt-6 @[40rem]:grid-cols-2" data-block>
        <HeadlineFigure
          label={t('plan.screen.netPay')}
          value={noPay ? undefined : basis.amount}
          change={basisLine(t, dates, plan.basisKind, basis)}
          empty={t('plan.screen.basis.unavailable')}
          onOpen={() => setPanel({ kind: 'basis' })}
        />
        {cushion !== undefined && (
          <div data-guide="plan.cushion">
            <HeadlineFigure
              label={t('plan.cushion.title')}
              value={cushion.split.check.kind === 'ADDS_UP' ? cushion.split.left : undefined}
              change={
                cushion.above === undefined
                  ? t('plan.page.cushionNoTarget')
                  : cushion.above.minor >= 0
                    ? t('plan.page.cushionAbove', { amount: wholeMoney(cushion.above) })
                    : t('plan.page.cushionBelow', { amount: wholeMoney(money(-cushion.above.minor, cushion.above.currency)) })
              }
              empty={cushion.split.check.kind === 'NO_ACCOUNTS' ? t('plan.cushion.noneTicked') : t('plan.cushion.unchecked')}
              onOpen={() => setPanel({ kind: 'cushion' })}
            />
          </div>
        )}
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="plan-split" data-guide="plan.split">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="plan-split" className="m-0 text-heading font-medium">
              {t('plan.bar.theSplit')}
            </h2>
            <AgainstLine against={against} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-ink-secondary">
              {t('plan.screen.against')}
              <ChoiceMenu
                text={dates.yearMonth(versus)}
                choices={offered.map((one) => ({ value: toYearMonthString(one), label: dates.yearMonth(one) }))}
                onPick={(choice) => {
                  const picked = offered.find((one) => toYearMonthString(one) === choice.value)
                  if (picked !== undefined) setVersus(picked)
                }}
                aria-label={t('plan.screen.againstWhich')}
              />
            </label>
            <Button variant="secondary" icon="add" onClick={() => setPanel({ kind: 'newBucket' })}>
              {t('plan.screen.addBucket')}
            </Button>
          </div>
        </div>

        {compare !== undefined && (
          <PlanBar
            basis={compare.basis.amount}
            netOff={compare.parts.netOff}
            result={compare.result}
            colours={new Map(compare.result.allocations.map((entry) => [entry.bucket.id, bucketColour(entry.bucket, palette)]))}
            locked={new Set()}
            snap={SNAP}
            readOnly
            label={t('plan.screen.compareLabel', { name: compare.plan.name, amount: formatMoney(compare.basis.amount) })}
          />
        )}

        <PlanBar
          basis={basis.amount}
          netOff={parts.netOff}
          result={result}
          colours={colours}
          got={got}
          billsGot={billsGot}
          locked={locked}
          hot={hot}
          onHot={setHot}
          view={compare === undefined ? planView : 'bar'}
          tip={dragTip}
          snap={SNAP}
          label={compare === undefined ? undefined : t('plan.screen.compareLabel', { name: plan.name, amount: formatMoney(basis.amount) })}
          onTrade={(trade, at) => setDragging({ trade, at })}
          onCommit={(trade) => {
            setDragging(undefined)
            commitTrade(trade)
          }}
          onNudge={commitTrade}
          onCancel={() => setDragging(undefined)}
        />
        <p className="m-0 text-caption text-ink-secondary">
          {t('plan.page.drag', { amount: formatMoney(money(SNAP, currency)) })}
          {got.size > 0 && ` ${t('plan.page.fill', { month: dates.monthName(versus) })}`}
        </p>

        <div className="grid grid-cols-1 gap-x-12 gap-y-6 @[52rem]:grid-cols-2">
          {columnsOf(sections).map((section, index) => (
            <div key={`${String(index)}:${section.name}`} className="flex flex-col">
              {section.name !== '' && (
                <h3 className="m-0 border-b border-hairline-strong pb-2 font-medium">
                  <Bidi>{section.name}</Bidi>
                </h3>
              )}
              <PlanAgainst
                lines={section.rows.map((entry) => {
                  const line = lines.get(entry.bucket.id)
                  const actual = line?.actual
                  const gotMore =
                    actual !== undefined && entry.bucket.targetKind !== 'CATEGORY' && actual.minor > entry.amount.minor
                  return {
                    key: entry.bucket.id,
                    name: entry.bucket.name,
                    actual: actual ?? zero(currency),
                    planned: entry.amount,
                    mark: colours.get(entry.bucket.id),
                    unknown:
                      actual === undefined
                        ? entry.bucket.targetKind === 'CATEGORY' && !measured
                          ? t('plan.page.unknown', { month: dates.monthName(versus) })
                          : t('plan.page.notMeasured')
                        : gotMore
                          ? t('plan.page.gotMore', { amount: wholeMoney(actual), month: dates.monthName(versus) })
                          : undefined,
                  }
                })}
                empty={t('plan.page.noBuckets')}
                onOpen={(id) => setPanel({ kind: 'bucket', id })}
              />
            </div>
          ))}
        </div>
        {sections.length === 0 && <OneSentence say={t('plan.page.noBuckets')} />}
      </section>

      <FixedSection
        planName={plan.name}
        expenses={pm.expenses}
        roles={pm.roles}
        parts={parts}
        categories={categories}
        actuals={actuals}
        month={month}
        lastComplete={versus}
        onRole={(expense, role: FixedRole) => write((database) => setRoles(database, [{ planId: plan.id, fixedExpenseId: expense.id, role }]))}
        onAdd={() => setPanel({ kind: 'newBill' })}
        onOpen={(expense) => setPanel({ kind: 'bill', id: expense.id })}
        onEnded={() => setPanel({ kind: 'ended' })}
      />
    </div>
  )

  const close = (): void => setPanel(undefined)
  const kicker = dates.yearMonth(month)

  const side = ((): React.ReactNode => {
    if (panel === undefined) return null
    switch (panel.kind) {
      case 'months':
        return (
          <SidePanel kicker={plan.name} title={t('plan.months.label')} onClose={close}>
            <MonthRow
              planId={plan.id}
              planName={plan.name}
              isDefault={plan.isDefault}
              defaultName={plans.find((one) => one.isDefault)?.name ?? plans[0]?.name ?? ''}
              month={month}
              given={given}
              names={new Map(plans.map((one) => [one.id, one.name]))}
              onChange={(one, on) => write((database) => setPlanMonths(database, plan.id, on ? [one] : [], on ? [] : [one]))}
            />
          </SidePanel>
        )
      case 'basis':
        return (
          <SidePanel kicker={kicker} title={t('plan.screen.netPay')} onClose={close}>
            <HeadlineFigure
              label={t('plan.screen.netPay')}
              value={noPay ? undefined : basis.amount}
              change={basisLine(t, dates, plan.basisKind, basis)}
              empty={t('plan.screen.basis.unavailable')}
            />
            <BasisFields
              plan={plan}
              currency={currency}
              paychecks={paychecks}
              customText={customText}
              onCustomText={setCustomText}
              write={write}
            />
          </SidePanel>
        )
      case 'cushion':
        return cushion === undefined ? null : (
          <SidePanel kicker={kicker} title={t('plan.cushion.title')} onClose={close}>
            <CushionLine cushion={cushion} write={write} />
          </SidePanel>
        )
      case 'candidates':
        return (
          <SidePanel
            kicker={kicker}
            title={candidates.length === 1 ? t('plan.fixed.candidatesOne') : t('plan.fixed.candidatesMany', { n: candidates.length })}
            onClose={close}
          >
            <Candidates
              candidates={candidates}
              windowMonths={windowMonths}
              dismissed={dismissed}
              onWindow={setWindowMonths}
              onTrack={(candidate, choice) => write((database, now) => confirmCandidate(database, candidate, choice, now))}
              onNotBill={(candidate) => write((database, now) => dismissMerchant(database, candidate.merchantNormalized, now))}
              onSuggestAgain={(merchant) => write((database, now) => clearDismissal(database, merchant, now))}
            />
          </SidePanel>
        )
      case 'newBill':
      case 'bill': {
        const isNew = panel.kind === 'newBill'
        const billId = panel.kind === 'bill' ? panel.id : undefined
        const expense = billId === undefined ? blank(currency) : pm.expenses.find((one) => one.id === billId)
        if (expense === undefined) return null
        return (
          <SidePanel kicker={plan.name} title={isNew ? t('plan.fixed.add') : <Bidi>{expense.name}</Bidi>} onClose={close}>
            <FixedExpenseEditor
              key={expense.id}
              initial={expense}
              isNew={isNew}
              initialRole={isNew ? 'NET' : (pm.roles.get(expense.id) ?? 'IGNORE')}
              planName={plan.name}
              currency={currency}
              categories={categories}
              deductionTypes={deductionTypes}
              matchedHistory={matchedHistory(db, expense, lastComplete)}
              onSave={(edited, role) => {
                const done = write((database, now) => {
                  // One you add by hand is one you meant: the role chosen here lands on
                  // the plan you are looking at. The bill the payslip took is outside it (D-053).
                  let id = edited.id
                  if (isNew) id = createFixedExpense(database, { ...edited, source: 'USER_DEFINED' }, now).id
                  else updateFixedExpense(database, edited.id, edited, now)
                  if (edited.matchKind !== 'PAYCHECK_DEDUCTION') setRoles(database, [{ planId: plan.id, fixedExpenseId: id, role }])
                })
                if (done) close()
              }}
              onCancel={close}
            />
            {!isNew && (
              <BillActions
                expense={expense}
                onEnd={() => write((database, now) => endFixedExpense(database, expense.id, asOf, now))}
                onStop={() => {
                  if (write((database, now) => deleteFixedExpense(database, expense.id, now))) close()
                }}
              />
            )}
          </SidePanel>
        )
      }
      case 'ended': {
        const ended = pm.expenses.filter((one) => !one.isActive)
        return (
          <SidePanel
            kicker={plan.name}
            title={ended.length === 1 ? t('plan.fixed.endedOne') : t('plan.fixed.endedMany', { n: ended.length })}
            onClose={close}
          >
            <EndedBills ended={ended} onOpen={(expense) => setPanel({ kind: 'bill', id: expense.id })} />
          </SidePanel>
        )
      }
      case 'bucket': {
        const entry = result.allocations.find((one) => one.bucket.id === panel.id)
        if (entry === undefined) return null
        const bucket = entry.bucket
        // Up and down within its heading, as the page shows it (M28 F25).
        const within =
          sections.find((section) => section.rows.some((row) => row.bucket.id === bucket.id))?.rows.map((row) => row.bucket.id) ?? []
        const position = within.indexOf(bucket.id)
        const swapWith = (other: string | undefined): void => {
          if (other === undefined) return
          const all = buckets.map((one) => one.id)
          const a = all.indexOf(bucket.id)
          const b = all.indexOf(other)
          if (a < 0 || b < 0) return
          const next = [...all]
          next[a] = other
          next[b] = bucket.id
          write((database, now) => reorderSplitBuckets(database, next, now))
        }
        const at = result.allocations.findIndex((one) => one.bucket.id === bucket.id)
        const after = result.allocations[at + 1]
        return (
          <SidePanel kicker={plan.name} title={<Bidi>{bucket.name}</Bidi>} onClose={close}>
            <BucketEditor
              key={bucket.id}
              entry={entry}
              reading={pm.readings.get(bucket.id)}
              line={lines.get(bucket.id)}
              targetName={nameOf(bucket)}
              orphaned={orphaned(bucket)}
              measured={measured}
              gotIn={dates.monthName(versus)}
              currency={currency}
              shares={shares}
              canUp={position > 0}
              canDown={position >= 0 && position < within.length - 1}
              next={after === undefined ? t('plan.screen.notGivenJob') : <Bidi>{after.bucket.name}</Bidi>}
              planName={plan.name}
              onRename={(name) => write((database, now) => updateSplitBucket(database, bucket.id, { name }, now))}
              onPointsAt={(point) => setPointing({ bucket, at: point })}
              onMode={(mode) => setOne(entry.allocation.id, modeChange(mode, currency))}
              onPercent={(basisPoints) => sizeTo(entry.allocation.id, basisPoints)}
              onAmount={(minor) => sizeTo(entry.allocation.id, minor)}
              onLock={(isLocked) => setOne(entry.allocation.id, { isLocked })}
              onShare={(share) => write((database, now) => updateSplitBucket(database, bucket.id, { share }, now))}
              onUp={() => swapWith(within[position - 1])}
              onDown={() => swapWith(within[position + 1])}
              onSplit={() =>
                write((database, now) => {
                  const created = createSplitBucket(database, { name: `${bucket.name} 2`, share: bucket.share }, now)
                  const next = splitAllocation(allocations, entry.allocation.id, { id: `new:${created.id}`, bucketId: created.id })
                  updateSplitPlan(database, plan.id, { allocations: next.map(toNewAllocation) }, now)
                })
              }
              onRemove={() => {
                if (write((database, now) => removePlanBuckets(database, plan.id, [bucket.id], month, asOf, now))) close()
              }}
            />
          </SidePanel>
        )
      }
      case 'newBucket':
        return (
          <SidePanel kicker={plan.name} title={t('plan.screen.addBucket')} onClose={close}>
            <form
              className="flex flex-wrap items-center gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                const name = newBucket.trim()
                if (name === '') return
                let made: string | undefined
                const done = write((database, now) => {
                  const created = createSplitBucket(database, { name }, now)
                  made = created.id
                  updateSplitPlan(
                    database,
                    plan.id,
                    { allocations: [...allocations.map(toNewAllocation), { bucketId: created.id, mode: 'PERCENTAGE' as const, basisPoints: 0 }] },
                    now,
                  )
                  // *What's left* stays the last word: a new bucket goes in before it (M28 F10).
                  const rest = result.allocations.find((entry) => entry.allocation.mode === 'REMAINDER')
                  if (rest !== undefined) {
                    const ids = result.allocations.map((entry) => entry.bucket.id)
                    const where = ids.indexOf(rest.bucket.id)
                    const unused = buckets.map((one) => one.id).filter((id) => !ids.includes(id))
                    reorderSplitBuckets(database, [...ids.slice(0, where), created.id, ...ids.slice(where), ...unused], now)
                  }
                })
                setNewBucket('')
                // The bucket it made opens, to be sized and pointed at something.
                if (done && made !== undefined) setPanel({ kind: 'bucket', id: made })
              }}
            >
              <input
                autoFocus
                value={newBucket}
                onChange={(event) => setNewBucket(event.target.value)}
                placeholder={t('plan.screen.newBucket')}
                aria-label={t('plan.screen.newBucketName')}
                className={`${FIELD} w-56`}
              />
              <Button type="submit" variant="secondary" size="sm" icon="add">
                {t('plan.screen.addBucket')}
              </Button>
            </form>
            {unusedBuckets.length > 0 && (
              <ChoiceMenu
                text=""
                placeholder={t('plan.screen.addExisting')}
                choices={unusedBuckets.map((bucket) => ({ value: bucket.id, label: bucket.name }))}
                onPick={(choice) =>
                  saveAllocations([
                    ...allocations,
                    { id: `new:${choice.value}`, planId: plan.id, bucketId: choice.value, mode: 'PERCENTAGE', basisPoints: 0, amount: undefined, isLocked: false },
                  ])
                }
                aria-label={t('plan.screen.addUnused')}
              />
            )}
            {plan.isDefault && result.allocations.some((entry) => entry.bucket.targetKind === 'SAVING_GOAL') && (
              <button type="button" className="fc-text-action self-start" onClick={() => setPanel({ kind: 'suggest' })}>
                {t('plan.screen.suggestGoals')}
              </button>
            )}
          </SidePanel>
        )
      case 'suggest':
        return <Suggest close={close} currency={currency} asOf={asOf} write={write} />
    }
  })()

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>
      {side}
      {planMenu !== undefined && <ContextMenu at={planMenu} items={planItems} onClose={() => setPlanMenu(undefined)} />}
      {/* A delete asks at the button that asked, naming the plan (M64 U9). */}
      {deletingPlan && (
        <ContextMenu
          at={menuAt.current}
          header={{
            title: <Phrase text={t('plan.page.deleteAsk')} parts={{ name: <Bidi>{plan.name}</Bidi> }} />,
            sub: plan.isDefault ? (plans.length > 1 ? t('plan.screen.deleteAnotherDefault') : t('plan.screen.deleteOnly')) : t('plan.screen.menu.deletePlanDetail'),
          }}
          items={[
            {
              label: t('plan.screen.deletePlan'),
              icon: 'trash',
              onChoose: () => {
                write((database, now) => deleteSplitPlan(database, plan.id, now))
                setPlanId(undefined)
                setPanel(undefined)
              },
            },
            { label: t('plan.keep'), onChoose: () => undefined },
          ]}
          onClose={() => setDeletingPlan(false)}
        />
      )}
      {pointing !== undefined && (
        <PointsAt
          bucket={pointing.bucket}
          at={pointing.at}
          options={pointable}
          onClose={() => setPointing(undefined)}
          onCreate={(kind, draft) => makeAndPoint(pointing.bucket, kind, draft)}
          onPick={(kind: TargetKind, id: string | undefined) => {
            const target = pointing.bucket
            setPointing(undefined)
            write((database, now) => updateSplitBucket(database, target.id, { targetKind: kind, targetId: id }, now))
          }}
        />
      )}
    </div>
  )
}

/** The goals' amounts Plan would be given, shown for a yes first (S3; moved here from Goals in M28 F10). */
function Suggest({
  close,
  currency,
  asOf,
  write,
}: {
  readonly close: () => void
  readonly currency: CurrencyCode
  readonly asOf: ReturnType<typeof today>
  readonly write: (work: (database: import('sql.js').Database, now: number) => void) => boolean
}) {
  const t = useT()
  const db = useDocumentStore((state) => state.db)
  const [suggestion] = useState<GoalSuggestion | undefined>(() => (db === undefined ? undefined : suggestGoalSplit(db, asOf, currency)))
  return (
    <SidePanel title={t('plan.screen.suggestGoals')} onClose={close}>
      <SuggestionPanel
        suggestion={suggestion}
        onApply={() => {
          if (suggestion === undefined) return
          const done = write((database, now) => {
            const applied = applyGoalSplit(database, asOf, currency, suggestion, now)
            if (applied.problems.length > 0) throw new Error(applied.problems.join(' '))
          })
          if (done) close()
        }}
        onClose={close}
      />
    </SidePanel>
  )
}

/** What net pay is (M36 U10): its basis, and the amount, months or paycheck the basis needs. */
function BasisFields({
  plan,
  currency,
  paychecks,
  customText,
  onCustomText,
  write,
}: {
  readonly plan: import('@/domain/model/plan.ts').SplitPlan
  readonly currency: CurrencyCode
  readonly paychecks: ReturnType<typeof listPaychecks>
  readonly customText: string | undefined
  readonly onCustomText: (text: string | undefined) => void
  readonly write: (work: (database: import('sql.js').Database, now: number) => void) => boolean
}) {
  const t = useT()
  const dates = useDates()
  const field = 'flex flex-col items-start gap-2'
  return (
    <div className="flex flex-col gap-4" data-testid="plan-basis">
      <label className={field}>
        <span className="text-caption text-ink-secondary">{t('plan.screen.netPayIs')}</span>
        <ChoiceMenu
          text={BASIS_LABEL[plan.basisKind]}
          choices={BASIS_KINDS.map((kind) => ({ value: kind, label: BASIS_LABEL[kind] }))}
          onPick={(choice) => write((database, now) => updateSplitPlan(database, plan.id, { basisKind: choice.value as BasisKind }, now))}
          aria-label={t('plan.screen.basisLabel')}
        />
      </label>
      {plan.basisKind === 'CUSTOM_AMOUNT' && (
        <label className={field}>
          <span className="text-caption text-ink-secondary">{t('plan.fixed.amount')}</span>
          <input
            value={customText ?? editableMoney(plan.customAmount === undefined ? undefined : { minor: plan.customAmount.minor, currency })}
            onChange={(event) => {
              onCustomText(event.target.value)
              const parsed = parseAmountText(event.target.value)
              if (parsed !== undefined) {
                write((database, now) => updateSplitPlan(database, plan.id, { customAmount: fromMajorUnits(Math.abs(parsed), currency) }, now))
              }
            }}
            placeholder="0.00"
            aria-label={t('plan.screen.customAmount')}
            className={`${FIELD} w-36 text-end tabular-nums`}
          />
        </label>
      )}
      {plan.basisKind === 'AVERAGE_LAST_N' && (
        <label className={field}>
          <span className="text-caption text-ink-secondary">{t('plan.screen.over')}</span>
          <ChoiceMenu
            text={t('plan.fixed.monthsMany', { n: plan.basisMonths ?? 3 })}
            choices={[3, 6, 12].map((months) => ({ value: String(months), label: t('plan.fixed.monthsMany', { n: months }) }))}
            onPick={(choice) => write((database, now) => updateSplitPlan(database, plan.id, { basisMonths: Number(choice.value) }, now))}
            aria-label={t('plan.screen.howManyMonths')}
          />
        </label>
      )}
      {plan.basisKind === 'SPECIFIC_PAYCHECK' && (
        <label className={field}>
          <span className="text-caption text-ink-secondary">{t('plan.screen.which')}</span>
          <ChoiceMenu
            text={(() => {
              const chosen = paychecks.find((paycheck) => paycheck.id === plan.basisPaycheckId)
              return chosen === undefined ? '' : t('plan.screen.paycheckChoice', { month: dates.yearMonth(chosen.period), amount: formatMoney(chosen.net) })
            })()}
            placeholder={t('plan.editor.choose')}
            choices={paychecks.map((paycheck) => ({
              value: paycheck.id,
              label: t('plan.screen.paycheckChoice', { month: dates.yearMonth(paycheck.period), amount: formatMoney(paycheck.net) }),
            }))}
            onPick={(choice) => write((database, now) => updateSplitPlan(database, plan.id, { basisPaycheckId: choice.value || undefined }, now))}
            aria-label={t('plan.screen.whichPaycheck')}
          />
        </label>
      )}
    </div>
  )
}

/** Where net pay comes from, in a line. */
function basisLine(
  t: Translate,
  dates: ReturnType<typeof useDates>,
  kind: BasisKind,
  basis: { readonly unavailable: boolean; readonly fromSalary?: { readonly months: number; readonly newest: YearMonth } | undefined; readonly sampleSize: number },
): string {
  if (basis.unavailable) return t('plan.screen.basis.unavailable')
  if (basis.fromSalary !== undefined) {
    return basis.fromSalary.months > 1
      ? t('plan.screen.basis.salaryAverage', { n: basis.fromSalary.months })
      : t('plan.screen.basis.salaryOne', { month: dates.yearMonth(basis.fromSalary.newest) })
  }
  if (basis.sampleSize > 1) return t('plan.screen.basis.average', { n: basis.sampleSize })
  return BASIS_LABEL[kind]
}

/**
 * **Against a month, in a line** (M31 U4): what went out of what the plan said, in words — or why
 * there is nothing to say.
 */
function AgainstLine({ against }: { readonly against: PlanActual | undefined }) {
  const t = useT()
  const dates = useDates()
  if (against === undefined) return null
  const { versus, ledgerHasMonth, nothing } = against
  const monthName = dates.yearMonth(against.period)
  const say = (text: string) => <p className="m-0 text-ink-secondary">{text}</p>
  if (!ledgerHasMonth) return say(t('plan.against.noStatement', { month: monthName }))
  if (nothing !== undefined || versus.comparable === 0) return say(nothing ?? t('plan.against.nothing', { month: monthName }))
  // The split's own bills count beside the buckets; the ones out of net are before the split.
  const bills = against.fixed.filter((line) => line.role === 'SPLIT' && line.planned !== undefined)
  const planned = money(versus.planned.minor + bills.reduce((total, line) => total + (line.planned?.minor ?? 0), 0), versus.planned.currency)
  const actual = money(versus.actual.minor + bills.reduce((total, line) => total + (line.actual?.minor ?? 0), 0), versus.actual.currency)
  const gap = money(Math.abs(actual.minor - planned.minor), actual.currency)
  return say(
    t(actual.minor > planned.minor ? 'plan.against.wentOutOver' : 'plan.against.wentOutUnder', {
      month: monthName,
      actual: wholeMoney(actual),
      planned: wholeMoney(planned),
      gap: wholeMoney(gap),
    }) +
      (versus.withoutBasis > 0
        ? t(versus.withoutBasis === 1 ? 'plan.against.unmeasuredOne' : 'plan.against.unmeasuredMany', { n: versus.withoutBasis })
        : ''),
  )
}

/** An amount inside the answer: whole units, medium, kept on one line. */
function SaidAmount({ value }: { readonly value: Money }) {
  return (
    <span className="font-medium whitespace-nowrap" dir="ltr">
      {wholeMoney(value)}
    </span>
  )
}

function toNewAllocation(allocation: Allocation): NewAllocation {
  return {
    bucketId: allocation.bucketId,
    mode: allocation.mode,
    basisPoints: allocation.basisPoints,
    amount: allocation.amount,
    isLocked: allocation.isLocked,
  }
}

/**
 * Switching mode clears the value the other mode was using: a percentage left
 * behind on a fixed-amount row is invisible state that comes back when the user
 * switches away and back.
 */
function modeChange(mode: AllocationMode, currency: CurrencyCode): Partial<Allocation> {
  if (mode === 'PERCENTAGE') return { mode, basisPoints: 0, amount: undefined }
  if (mode === 'FIXED_AMOUNT') return { mode, basisPoints: undefined, amount: money(0, currency) }
  return { mode, basisPoints: undefined, amount: undefined }
}

/** A blank expense to open the editor on. Monthly, so no anchor is demanded up front. */
function blank(currency: CurrencyCode): FixedExpense {
  return {
    id: 'new',
    name: '',
    categoryId: undefined,
    matchKind: 'MERCHANT_PATTERN',
    matchRef: undefined,
    expectedAmount: zero(currency),
    amountVariability: 'FIXED',
    cadence: 'MONTHLY',
    dayOfMonthHint: undefined,
    isDiscretionary: false,
    source: 'USER_DEFINED',
    isActive: true,
    startedAt: undefined,
    endedAt: undefined,
  }
}

/** The charges an expense has matched over the last year, newest first. */
function matchedHistory(
  db: import('sql.js').Database,
  expense: FixedExpense,
  period: YearMonth,
): readonly { readonly date: string; readonly amount: Money }[] {
  if (expense.matchKind !== 'MERCHANT_PATTERN' || expense.matchRef === undefined) return []
  const from = monthRange(toYearMonthString(addMonths(period, -11)))?.from
  const to = monthRange(toYearMonthString(period))?.to
  if (from === undefined || to === undefined) return []
  return listExpenseObservations(db, from, to)
    .filter((observation) => observation.merchantNormalized === expense.matchRef)
    .map((observation) => ({
      date: toISODate(observation.date),
      amount: { minor: Math.abs(observation.amount.minor), currency: observation.amount.currency },
    }))
    .reverse()
}

/**
 * The first plan, and the one decision docs/f05 left open about it: 50/30/20
 * ships as a starting point because an empty splitter is the hardest screen in
 * the app to begin. **It lands on the person's categories** (M31 U3) and **is
 * shown before it is made** (M59 U4, D-580): one sentence and the two ways in.
 */
function EmptyState({ onStart, onEmpty }: { onStart: () => void; onEmpty: () => void }) {
  const t = useT()
  return (
    // **Both of the guide's Plan places, until there is a plan** (M28 U9).
    <div
      className="fc-view-enter mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
      data-guide="plan.split plan.fixed"
    >
      <h1 className="m-0 text-title">{t('plan.screen.title')}</h1>
      <p className="m-0 text-ink-secondary">{t('plan.screen.empty')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={onStart}>
          {t('plan.starter.title')}
        </Button>
        <Button variant="ghost" onClick={onEmpty}>
          {t('plan.screen.startEmpty')}
        </Button>
      </div>
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

/** `a, b and c` in the language now: the list words of `core/text.ts`'s `listed`, translated (M60 U5, D-590). */
function listedIn(t: Translate, words: readonly string[]): string {
  if (words.length < 2) return words[0] ?? ''
  return t('plan.listed', { rest: words.slice(0, -1).join(', '), last: words.at(-1) ?? '' })
}
