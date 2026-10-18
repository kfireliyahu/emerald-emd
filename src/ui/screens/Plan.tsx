import { useMemo, useState } from 'react'

import { formatMoney, fromMajorUnits, money, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import { listed } from '@/core/text.ts'
import {
  addMonths,
  formatMonthShort,
  formatMonthName,
  formatYearMonth,
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
import { createFund, listFunds } from '@/data/repositories/fundRepository.ts'
import { FUND_TYPES, type FundType } from '@/domain/model/funds.ts'
import { listPaychecks } from '@/data/repositories/paycheckRepository.ts'
import { applySuggestions, planAgainstActual, planMonth, removePlanBuckets, type PlanActual } from '@/data/repositories/planMonthRepository.ts'
import { setRoles } from '@/data/repositories/planFixedRepository.ts'
import { listGoals } from '@/data/repositories/savingsRepository.ts'
import { saveGoalAnswer, whereChoices } from '@/data/repositories/goalWhereRepository.ts'
import { editableMoney } from '@/ui/components/moneyText.ts'
import { CushionPanel } from '@/ui/savings/CushionPanel.tsx'
import { SuggestionPanel } from '@/ui/savings/GoalPanels.tsx'
import { applyGoalSplit, suggestGoalSplit } from '@/data/repositories/goalPlanRepository.ts'
import type { Suggestion as GoalSuggestion } from '@/domain/goalRhythm.ts'
import {
  createSplitBucket,
  createSplitPlan,
  deleteSplitPlan,
  duplicateSplitPlan,
  listPlanMonths,
  listSplitBuckets,
  listSplitPlans,
  reorderSplitBuckets,
  setDefaultPlan,
  setPlanMonths,
  updateSplitBucket,
  updateSplitPlan,
  type NewAllocation,
} from '@/data/repositories/splitPlanRepository.ts'
import { DEFAULT_WINDOW_MONTHS } from '@/domain/fixedExpenses.ts'
import { starterHeadings } from '@/data/repositories/categoryBudgetRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { starterBuckets, unplacedHeadings, type StarterAnswer, type StarterHeading } from '@/domain/starterPlan.ts'
import type { FixedExpense, FixedRole } from '@/domain/model/fixed.ts'
import {
  BASIS_KINDS,
  type Allocation,
  type AllocationMode,
  type BasisKind,
  type BucketShare,
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
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { FixedExpenseEditor } from '@/ui/fixed/FixedExpenseEditor.tsx'
import { Pager } from '@/ui/home/parts.tsx'
import { useCategoryPalette } from '@/ui/components/CategoryMark.tsx'
import { BucketTable, type BucketRowProps } from '@/ui/plan/BucketTable.tsx'
import { SHARE_NAME, sectionBuckets } from '@/ui/plan/bucketGroups.ts'
import { eligibleParents } from '@/ui/categories/parentFilter.ts'
import { FixedSection } from '@/ui/plan/FixedSection.tsx'
import { MonthRow } from '@/ui/plan/MonthRow.tsx'
import { PlanBar, type Trade } from '@/ui/plan/PlanBar.tsx'
import { usePlanView } from '@/ui/plan/usePlanView.ts'
import { PointsAt, type NewPointable, type Pointable } from '@/ui/plan/PointsAt.tsx'
import { bucketColour } from '@/ui/plan/planLook.ts'
import { BASIS_LABEL } from '@/ui/split/labels.ts'
import { today } from '@/ui/today.ts'

/** The bar snaps a size to this much, in minor units — ₪50. A divider is a gesture, not a typed figure. */
const SNAP = 5000

/**
 * **Plan** — fixed expenses and the split, on one page (M28 U7, D-319).
 *
 * They were two screens in a sub-rail, and the second one could only say about
 * fixed expenses what two plan-wide settings said for all of them. Now each
 * expense has its own say about each plan, the total of the ones that come out
 * of net is the first thing the bar shows, and the ones that are a share of the
 * split are drawn on it. A conversation does all of it too (`set_plan`,
 * `set_fixed_expense_roles`, `plan_month`).
 *
 * **Every edit is written as it is made**, as the splitter always did: a plan is
 * something you fiddle with, and a drag lost to a tab close would be the whole
 * interaction failing. The document's own dirty mark and Ctrl+S are what save
 * means. A divider drag is previewed and written once, when the pointer comes up.
 *
 * **The screen never normalizes.** Shares summing to 130% stay at 130% and the
 * bar says what that means (docs/f05).
 */
export function Plan() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [planId, setPlanId] = useState<string | undefined>()
  const [planView, choosePlanView] = usePlanView()
  const [month, setMonth] = useState<YearMonth>(() => yearMonthOf(today()))
  /** The goals' amounts Plan would be given, shown for a yes first (S3; moved here from Goals in M28 F10). */
  const [suggestion, setSuggestion] = useState<GoalSuggestion | undefined | 'NONE'>()
  /** The month under *Against* once one is chosen; until then the last whole month (M31 U4). */
  const [againstPick, setVersus] = useState<YearMonth | undefined>()
  const [editing, setEditing] = useState<
    { readonly isNew: boolean; readonly expense: FixedExpense } | undefined
  >()
  const [windowMonths, setWindowMonths] = useState<number>(DEFAULT_WINDOW_MONTHS)
  const [problem, setProblem] = useState<string | undefined>()
  const [hot, setHot] = useState<string | undefined>()
  const [dragging, setDragging] = useState<{ readonly trade: Trade; readonly at: number } | undefined>()
  const [pointing, setPointing] = useState<
    | {
        readonly bucket: SplitBucket
        readonly at: { readonly x: number; readonly y: number }
      }
    | undefined
  >()
  const [bucketMenu, setBucketMenu] = useState<
    | {
        readonly bucket: SplitBucket
        readonly at: { readonly x: number; readonly y: number }
      }
    | undefined
  >()
  const [planMenu, setPlanMenu] = useState<{ readonly x: number; readonly y: number } | undefined>()
  const [renaming, setRenaming] = useState<string | undefined>()
  const [renamingPlan, setRenamingPlan] = useState<string | undefined>()
  const [deletingPlan, setDeletingPlan] = useState(false)
  const [removingBucket, setRemovingBucket] = useState<SplitBucket | undefined>()
  const [compareId, setCompareId] = useState<string | undefined>()
  /** The basis behind the Net pay figure, shown on *Change* (M36 U10). */
  const [basisOpen, setBasisOpen] = useState(false)
  const [amountText, setAmountText] = useState<Readonly<Record<string, string>>>({})
  const [percentText, setPercentText] = useState<Readonly<Record<string, string>>>({})
  const [customText, setCustomText] = useState<string | undefined>()
  const [newBucket, setNewBucket] = useState('')

  const asOf = useMemo(() => today(), [])
  const plans = useMemo(() => (db === undefined ? [] : listSplitPlans(db)), [db, revision])
  const categories = useMemo(() => (db === undefined ? [] : listCategories(db)), [db, revision])
  const palette = useCategoryPalette(categories)
  const paychecks = useMemo(() => (db === undefined ? [] : listPaychecks(db)), [db, revision])
  const pm = useMemo(
    () => (db === undefined ? undefined : planMonth(db, { planId, month, asOf })),
    [db, revision, planId, month, asOf],
  )
  /** The top-level categories the 50/30/20 starter shares itself over, read only while there is no plan. */
  const headings = useMemo(
    () =>
      db === undefined || pm !== undefined
        ? []
        : starterHeadings(db, asOf, paychecks[0]?.net.currency ?? documentCurrency(db)),
    [db, revision, pm, asOf, paychecks],
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

  // The comparison is always on the screen (M31 U4): the bar's fills and the table's Got column.
  const against = useMemo(
    () => (db === undefined || pm === undefined ? undefined : planAgainstActual(db, pm, versus, asOf)),
    [db, revision, versus, pm, asOf],
  )

  if (db === undefined) {
    return <Centered>Open a document, or create one, to plan where your pay goes.</Centered>
  }

  const write = (work: (database: import('sql.js').Database, now: number) => void): void => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const currency: CurrencyCode = pm?.plan.currency ?? paychecks[0]?.net.currency ?? documentCurrency(db)

  if (pm === undefined) {
    return (
      <EmptyState
        headings={headings}
        onCreate={(answers) =>
          write((database, now) => {
            const created = createSplitPlan(database, { name: 'Default', currency, isDefault: true }, now)
            // Buckets are shared across plans: one already on a category is the one used (M31 U3).
            const held = listSplitBuckets(database)
            const starter = answers === undefined ? [] : starterBuckets(headings, answers)
            const allocations: NewAllocation[] = starter.map(
              (entry) => ({
                bucketId:
                  held.find(
                    (one) =>
                      entry.categoryId !== undefined && one.targetKind === 'CATEGORY' && one.targetId === entry.categoryId,
                  )?.id ??
                  createSplitBucket(
                    database,
                    entry.categoryId === undefined
                      ? { name: entry.name, share: entry.share }
                      : { name: entry.name, targetKind: 'CATEGORY', targetId: entry.categoryId, share: entry.share },
                    now,
                  ).id,
                mode: 'PERCENTAGE',
                basisPoints: entry.basisPoints,
              }),
            )
            updateSplitPlan(database, created.id, { allocations }, now)
            // A bucket already there takes the share it is used for now, and the starter's order (M31 U4).
            for (const [index, entry] of allocations.entries()) {
              const share = starter[index]?.share
              if (share !== undefined) updateSplitBucket(database, entry.bucketId, { share }, now)
            }
            const placed = allocations.map((entry) => entry.bucketId)
            reorderSplitBuckets(database, [...placed, ...held.map((one) => one.id).filter((id) => !placed.includes(id))], now)
            setPlanId(created.id)
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
      : tradedAt(
          allocations,
          dragging.trade.leftId,
          dragging.trade.leftMinor,
          settled.splittable,
          { snap: SNAP, room, order },
        )
  const result =
    dragging === undefined ? settled : computeSplit(plan, buckets, shownAllocations, basis.amount, taken)

  const orphaned = (bucket: SplitBucket): boolean =>
    bucket.targetKind !== 'FREE' && (bucket.targetId === undefined || !known.has(bucket.targetId))
  const colours = new Map(
    result.allocations.map((entry) => [
      entry.bucket.id,
      bucketColour(
        orphaned(entry.bucket) ? { targetKind: 'FREE', targetId: undefined } : entry.bucket,
        palette,
      ),
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

  const saveAllocations = (next: readonly Allocation[]): void =>
    write((database, now) =>
      updateSplitPlan(
        database,
        plan.id,
        { allocations: next.map(toNewAllocation) },
        now,
      ),
    )
  const setOne = (id: string, change: Partial<Allocation>): void =>
    saveAllocations(
      allocations.map((allocation) => (allocation.id === id ? { ...allocation, ...change } : allocation)),
    )
  const percentTo = (id: string, basisPoints: number): void =>
    saveAllocations(changedTo(allocations, id, basisPoints, settled.splittable, { overflow: true, order }))
  // A typed amount lands when the field is left, not on every keystroke: each
  // keystroke would be a change that flows right, and the first digits of
  // 1200 are not amounts anybody meant.
  const amountTo = (id: string, minor: number): void =>
    saveAllocations(changedTo(allocations, id, minor, settled.splittable, { overflow: true, order }))

  const commitTrade = (trade: Trade): void => {
    const next = tradedAt(allocations, trade.leftId, trade.leftMinor, settled.splittable, {
      snap: SNAP,
      room,
      order,
    })
    if (next !== allocations) saveAllocations(next)
  }

  const locked = new Set(allocations.filter((one) => one.isLocked).map((one) => one.id))
  const dragTip =
    dragging === undefined
      ? undefined
      : (() => {
          const left = result.allocations.find((one) => one.allocation.id === dragging.trade.leftId)
          return left === undefined
            ? undefined
            : {
                text: `${left.bucket.name} ${formatMoney(left.amount)}`,
                at: dragging.at,
              }
        })()

  const rows: BucketRowProps[] = result.allocations.map((entry) => ({
    entry,
    colour: colours.get(entry.bucket.id) ?? 'var(--color-ink-tertiary)',
    reading: pm.readings.get(entry.bucket.id),
    line: lines.get(entry.bucket.id),
    targetName: nameOf(entry.bucket),
    orphaned: orphaned(entry.bucket),
    hot: hot === entry.bucket.id,
    currency,
    amountText: amountText[entry.bucket.id] ?? fixedAmountOf(entry.allocation.amount, currency),
    percentText: percentText[entry.bucket.id],
    renaming: renaming === entry.bucket.id,
  }))

  // Under Needs, Wants and Saving, in the bar's order (M31 U4).
  const sections = sectionBuckets(rows, (row) => row.entry.bucket)

  const pointable: Pointable = {
    SAVING_GOAL: goals.map((one) => ({ id: one.id, name: one.name })),
    DEBT: debts.map((one) => ({ id: one.id, name: one.name })),
    CATEGORY: categories.filter((one) => !one.isArchived).map((one) => ({ id: one.id, name: one.path })),
    FUND: funds.map((one) => ({ id: one.id, name: one.name })),
    ACCOUNT: accounts.map((one) => ({ id: one.id, name: one.name })),
    // The goal form's one question, in its words (M30 F3): each holding by one name, and none
    // another goal already follows.
    holdings:
      db === undefined
        ? []
        : whereChoices(db, currency)
            .filter((one) => one.followedBy === undefined)
            .map((one) => ({ id: one.holdingId, name: one.detail === undefined ? one.name : `${one.name} ${one.detail}` })),
    parents: eligibleParents(categories).filter((one) => one.kind !== 'INCOME').map((one) => ({ id: one.id, name: one.path, moved: isMovedKind(one.kind) })),
  }

  /**
   * Make a goal, debt, category, fund or account right here and point the bucket at
   * it, in one write so one undo takes both back (M28 U8). Through the same
   * repository functions the Goals, Debts, Categories and Funds screens call; a
   * name taken or an amount that is not one is refused where it would be there.
   */
  const makeAndPoint = (
    bucket: SplitBucket,
    kind: Exclude<TargetKind, 'FREE'>,
    draft: NewPointable,
  ): string | undefined => {
    try {
      mutate((database) => {
        const now = Date.now()
        let id: string
        switch (kind) {
          case 'SAVING_GOAL': {
            // Name, target, date and where it is kept, as the mockup's form asks (M28 F10): a goal
            // made with no holding could take no deposit until somebody went and edited it.
            const parsed = draft.target === undefined ? undefined : parseAmountText(draft.target)
            if (draft.target !== undefined && parsed === undefined) throw new Error('The target has to be an amount.')
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
            if (parsed === undefined) throw new Error('What is left to pay has to be an amount.')
            id = createDebt(
              database,
              {
                name: draft.name,
                kind: 'OTHER',
                principalAmount: fromMajorUnits(Math.abs(parsed), currency),
                openedDate: today(),
              },
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
  const free = Math.max(0, result.balance.minor)
  const lastEntry = result.allocations.at(-1)
  const inSplitMinor = result.fixedShare?.minor ?? 0

  const bucketItems = (bucket: SplitBucket): readonly MenuItem[] => {
    const entry = result.allocations.find((one) => one.bucket.id === bucket.id)
    if (entry === undefined) return []
    // Up and down within its heading, as the table shows it (M28 F25): a swap
    // with a bucket under another heading would change the split and not the table.
    const order =
      sections.find((section) => section.rows.some((row) => row.entry.bucket.id === bucket.id))?.rows.map((row) => row.entry.bucket.id) ?? []
    const position = order.indexOf(bucket.id)
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
    const items: MenuItem[] = [
      { label: 'Rename', icon: 'edit', onChoose: () => setRenaming(bucket.id) },
      {
        label: entry.allocation.isLocked ? 'Let it change size' : 'Keep this size',
        detail: entry.allocation.isLocked ? undefined : 'Dividers will not move it',
        onChoose: () => setOne(entry.allocation.id, { isLocked: !entry.allocation.isLocked }),
      },
      {
        label: 'Move up',
        icon: 'move',
        disabled: position <= 0,
        onChoose: () => swapWith(order[position - 1]),
      },
      {
        label: 'Move down',
        disabled: position < 0 || position >= order.length - 1,
        onChoose: () => swapWith(order[position + 1]),
      },
    ]
    if (sections.some((section) => section.share !== undefined)) {
      // Which of 50 / 30 / 20 it counts as: the heading it is under (M31 U4).
      items.push({
        label: 'Counts as',
        detail: bucket.share === undefined ? 'None of them' : SHARE_NAME[bucket.share],
        submenu: SHARE_CHOICES.map(([share, label]) => ({
          label: bucket.share === share ? `${label} ✓` : label,
          onChoose: () => write((database, now) => updateSplitBucket(database, bucket.id, { share }, now)),
        })),
      })
    }
    if (entry.allocation.mode !== 'REMAINDER') {
      items.push({
        label: 'Split in two',
        icon: 'plus',
        detail: 'Half stays, half goes to a new bucket',
        onChoose: () =>
          write((database, now) => {
            const created = createSplitBucket(database, { name: `${bucket.name} 2`, share: bucket.share }, now)
            const next = splitAllocation(allocations, entry.allocation.id, {
              id: `new:${created.id}`,
              bucketId: created.id,
            })
            updateSplitPlan(
              database,
              plan.id,
              { allocations: next.map(toNewAllocation) },
              now,
            )
          }),
      })
    }
    items.push({
      label: 'Remove this bucket',
      icon: 'trash',
      detail: 'Its share goes to the bucket on its right',
      separated: true,
      onChoose: () => setRemovingBucket(bucket),
    })
    return items
  }

  const others = plans.filter((one) => one.id !== plan.id)
  const planItems: MenuItem[] = [
    ...(others.length === 0
      ? []
      : [
          {
            label: 'Open another plan',
            submenu: others.map((one) => ({
              label: <Bidi>{one.name}</Bidi>,
              onChoose: () => setPlanId(one.id),
            })),
          } satisfies MenuItem,
          {
            label: 'Draw another plan beside this one',
            submenu: [
              { label: 'No other plan', disabled: compare === undefined, onChoose: () => setCompareId(undefined) },
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
            label: planView === 'bar' ? 'Draw the split as a ring' : 'Draw the split as a bar',
            onChoose: () => choosePlanView(planView === 'bar' ? 'ring' : 'bar'),
          } satisfies MenuItem,
        ]
      : []),
    {
      label: 'Copy this plan',
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
      : [
          {
            label: 'Use this plan by default',
            onChoose: () => write((database, now) => setDefaultPlan(database, plan.id, now)),
          } satisfies MenuItem,
        ]),
    {
      label: 'Rename this plan',
      icon: 'edit',
      onChoose: () => setRenamingPlan(plan.name),
    },
    {
      label: 'Delete this plan',
      icon: 'trash',
      detail: 'Buckets and bills stay',
      separated: true,
      onChoose: () => setDeletingPlan(true),
    },
  ]

  function acceptSuggestions(accepted: readonly Suggestion[]): void {
    write((database, now) => applySuggestions(database, plan.id, month, accepted, now))
  }

  const showBasis = basisOpen || basis.unavailable
  const basisLine = ((): string => {
    if (basis.unavailable) return 'No paycheck recorded yet — type an amount instead'
    if (basis.fromSalary !== undefined) {
      return basis.fromSalary.months > 1
        ? `No paycheck yet — the salary that came in, average of ${String(basis.fromSalary.months)} months`
        : `No paycheck yet — the salary that came in, ${formatYearMonth(basis.fromSalary.newest)}`
    }
    if (basis.sampleSize > 1) return `Average of your last ${String(basis.sampleSize)} paychecks`
    return BASIS_LABEL[plan.basisKind]
  })()

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter @container flex flex-col gap-7 px-8 pt-6 pb-12">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-4">
          <div className="flex flex-col gap-1.5">
            <span className="fc-label text-ink-secondary uppercase">Plan</span>
            {/* **One month control in the header** (M36 U10): which plan, copying it, drawing
                another beside it and Bar or Ring are this menu's; the basis is the Net pay figure's. */}
            <h1 className="m-0 flex items-center gap-2 text-[24px] leading-tight font-medium tracking-[-0.01em]">
              <Bidi>{plan.name}</Bidi>
              {plan.isDefault && <span className="text-body font-normal text-ink-secondary">· default</span>}
              <button
                type="button"
                aria-label="More for this plan"
                title="Other plans, copy, draw"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  setPlanMenu({ x: box.left, y: box.bottom })
                }}
                className="size-8 text-body text-ink-secondary hover:text-ink"
              >
                ⋯
              </button>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <b className="font-medium tabular-nums">{formatYearMonth(month)}</b>
            <Pager
              label="Month"
              prev={formatMonthShort(addMonths(month, -1))}
              next={formatMonthShort(addMonths(month, 1))}
              onPrev={() => setMonth((current) => addMonths(current, -1))}
              onNext={() => setMonth((current) => addMonths(current, 1))}
            />
          </div>
        </header>

        <MonthRow
          planId={plan.id}
          planName={plan.name}
          isDefault={plan.isDefault}
          defaultName={plans.find((one) => one.isDefault)?.name ?? plans[0]?.name ?? ''}
          month={month}
          given={given}
          names={new Map(plans.map((one) => [one.id, one.name]))}
          onChange={(one, on) =>
            write((database) => setPlanMonths(database, plan.id, on ? [one] : [], on ? [] : [one]))
          }
        />

        {renamingPlan !== undefined && (
          <form
            className="fc-pop-enter flex flex-wrap items-center gap-3 bg-surface px-4 py-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (renamingPlan.trim() !== '') {
                write((database, now) =>
                  updateSplitPlan(database, plan.id, { name: renamingPlan.trim() }, now),
                )
              }
              setRenamingPlan(undefined)
            }}
          >
            <input
              autoFocus
              value={renamingPlan}
              onChange={(event) => setRenamingPlan(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenamingPlan(undefined)
              }}
              aria-label="Plan name"
              className={`${FIELD} w-64`}
            />
            <Button type="submit" variant="secondary" size="sm">
              Rename
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRenamingPlan(undefined)}>
              Cancel
            </Button>
          </form>
        )}

        {deletingPlan && (
          <div className="fc-pop-enter flex flex-wrap items-center gap-3 bg-surface px-4 py-2">
            <span>
              Delete the plan <Bidi>{plan.name}</Bidi>? The plan and its sizes are gone; your bills stay.
              {plan.isDefault &&
                (plans.length > 1
                  ? ' Another plan becomes the default.'
                  : ' It is your only plan, so Plan will offer to start a new one.')}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                write((database, now) => deleteSplitPlan(database, plan.id, now))
                setPlanId(undefined)
                setDeletingPlan(false)
              }}
            >
              Delete plan
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeletingPlan(false)}>
              Keep
            </Button>
          </div>
        )}

        {problem !== undefined && (
          <div className="fc-pop-enter flex items-center gap-4 bg-surface px-4 py-2">
            <span className="text-negative">{problem}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
              Dismiss
            </Button>
          </div>
        )}

        {(given.get(toYearMonthString(month)) ?? plans[0]?.id) === plan.id && (
          <RecordLine
            planName={plan.name}
            month={month}
            suggestions={pm.applied.suggestions}
            changes={pm.applied.changes}
            nameOf={(suggestion) =>
              (suggestion.kind === 'SAVING_DEPOSIT' ? goals : debts).find((one) => one.id === suggestion.targetId)?.name ??
              suggestion.bucket.name
            }
            onRecord={() => acceptSuggestions(pm.applied.changes)}
          />
        )}

        <CushionPanel />

        <div className="grid grid-cols-2 divide-x divide-hairline border-y border-hairline @[48rem]:grid-cols-4">
          <Figure label="Net pay" value={basis.amount} unavailable={basis.unavailable}>
            {basisLine}{' '}
            <button
              type="button"
              aria-expanded={showBasis}
              onClick={() => setBasisOpen(!showBasis)}
              className="text-accent hover:underline"
            >
              {showBasis ? 'Done' : 'Change'}
            </button>
          </Figure>
          <Figure label="Bills, out of net" value={parts.netOff}>
            {parts.netOffList.length === 1 ? '1 bill' : `${String(parts.netOffList.length)} bills`}
          </Figure>
          <Figure label="To split" value={result.splittable}>
            {inSplitMinor > 0
              ? `${formatMoney(money(inSplitMinor, currency))} of it is bills`
              : 'before any bucket'}
          </Figure>
          <Figure label="Not given a job" value={money(free, currency)}>
            {result.balance.minor < 0
              ? `${formatMoney(money(-result.balance.minor, currency))} too much is given out`
              : free === 0
                ? 'Nothing left over'
                : 'Left on the bar'}
          </Figure>
        </div>

        {/* What Net pay is: behind its figure since M36 U10, open by itself while there is none. */}
        {showBasis && (
          <div className="fc-pop-enter -mt-4 flex flex-wrap items-end gap-x-6 gap-y-3" data-testid="plan-basis">
            <label className="flex flex-col gap-1">
              <span className="text-label text-ink-tertiary uppercase">Net pay is</span>
              <select
                value={plan.basisKind}
                onChange={(event) =>
                  write((database, now) =>
                    updateSplitPlan(database, plan.id, { basisKind: event.target.value as BasisKind }, now),
                  )
                }
                aria-label="Basis"
                className={`${SELECT} w-64`}
              >
                {BASIS_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {BASIS_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>

            {plan.basisKind === 'CUSTOM_AMOUNT' && (
              <label className="flex flex-col gap-1">
                <span className="text-label text-ink-tertiary uppercase">Amount</span>
                <input
                  value={customText ?? fixedAmountOf(plan.customAmount, currency)}
                  onChange={(event) => {
                    setCustomText(event.target.value)
                    const parsed = parseAmountText(event.target.value)
                    if (parsed !== undefined) {
                      write((database, now) =>
                        updateSplitPlan(
                          database,
                          plan.id,
                          {
                            customAmount: fromMajorUnits(Math.abs(parsed), currency),
                          },
                          now,
                        ),
                      )
                    }
                  }}
                  placeholder="0.00"
                  aria-label="Custom basis amount"
                  className={`${FIELD} w-36 text-right tabular-nums`}
                />
              </label>
            )}

            {plan.basisKind === 'AVERAGE_LAST_N' && (
              <label className="flex flex-col gap-1">
                <span className="text-label text-ink-tertiary uppercase">Over</span>
                <select
                  value={plan.basisMonths ?? 3}
                  onChange={(event) =>
                    write((database, now) =>
                      updateSplitPlan(database, plan.id, { basisMonths: Number(event.target.value) }, now),
                    )
                  }
                  aria-label="How many months to average"
                  className={`${SELECT} w-32`}
                >
                  {[3, 6, 12].map((months) => (
                    <option key={months} value={months}>
                      {months} months
                    </option>
                  ))}
                </select>
              </label>
            )}

            {plan.basisKind === 'SPECIFIC_PAYCHECK' && (
              <label className="flex flex-col gap-1">
                <span className="text-label text-ink-tertiary uppercase">Which</span>
                <select
                  value={plan.basisPaycheckId ?? ''}
                  onChange={(event) =>
                    write((database, now) =>
                      updateSplitPlan(
                        database,
                        plan.id,
                        { basisPaycheckId: event.target.value || undefined },
                        now,
                      ),
                    )
                  }
                  aria-label="Which paycheck"
                  className={`${SELECT} w-44`}
                >
                  <option value="">Choose…</option>
                  {paychecks.map((paycheck) => (
                    <option key={paycheck.id} value={paycheck.id}>
                      {formatYearMonth(paycheck.period)} — {formatMoney(paycheck.net)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        <FixedSection
          planName={plan.name}
          expenses={pm.expenses}
          roles={pm.roles}
          parts={parts}
          categories={categories}
          actuals={actuals}
          month={month}
          lastComplete={versus}
          candidates={candidates}
          windowMonths={windowMonths}
          dismissed={dismissed}
          onWindow={setWindowMonths}
          onRole={(expense, role: FixedRole) =>
            write((database) => setRoles(database, [{ planId: plan.id, fixedExpenseId: expense.id, role }]))
          }
          form={
            editing === undefined ? undefined : (
              <FixedExpenseEditor
                key={editing.expense.id}
                initial={editing.expense}
                isNew={editing.isNew}
                initialRole={editing.isNew ? 'NET' : (pm.roles.get(editing.expense.id) ?? 'IGNORE')}
                planName={plan.name}
                currency={currency}
                categories={categories}
                deductionTypes={deductionTypes}
                matchedHistory={matchedHistory(db, editing.expense, lastComplete)}
                onSave={(expense, role) => {
                  write((database, now) => {
                    // One you add by hand is one you meant: the role chosen
                    // here lands on the plan you are looking at. The bill the
                    // payslip already took is outside the choice (D-053).
                    let id = expense.id
                    if (editing.isNew) {
                      id = createFixedExpense(database, { ...expense, source: 'USER_DEFINED' }, now).id
                    } else {
                      updateFixedExpense(database, expense.id, expense, now)
                    }
                    if (expense.matchKind !== 'PAYCHECK_DEDUCTION') {
                      setRoles(database, [{ planId: plan.id, fixedExpenseId: id, role }])
                    }
                  })
                  setEditing(undefined)
                }}
                onCancel={() => setEditing(undefined)}
              />
            )
          }
          onAdd={() => setEditing({ isNew: true, expense: blank(currency) })}
          onEdit={(expense) => setEditing({ isNew: false, expense })}
          onEnd={(expense) => write((database, now) => endFixedExpense(database, expense.id, asOf, now))}
          onStop={(expense) => write((database, now) => deleteFixedExpense(database, expense.id, now))}
          onTrack={(candidate, choice) =>
            write((database, now) => confirmCandidate(database, candidate, choice, now))
          }
          onNotBill={(candidate) =>
            write((database, now) => dismissMerchant(database, candidate.merchantNormalized, now))
          }
          onSuggestAgain={(merchant) => write((database, now) => clearDismissal(database, merchant, now))}
        />

        <section className="flex flex-col gap-3" aria-label="The split" data-guide="plan.split">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="m-0 text-[16px] font-medium">The split</h2>
              <p className="m-0 mt-0.5 text-caption text-ink-secondary">
                {formatMoney(basis.amount)} net pay
                {parts.netOff.minor > 0 && (
                  <>, less {formatMoney(parts.netOff)} of bills,</>
                )} leaves {formatMoney(result.splittable)} to give a job. Drag a divider to resize.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <span className="text-label text-ink-tertiary uppercase">Against</span>
                <select
                  value={toYearMonthString(versus)}
                  onChange={(event) => {
                    const picked = offered.find((one) => toYearMonthString(one) === event.target.value)
                    if (picked !== undefined) setVersus(picked)
                  }}
                  aria-label="Against which month"
                  className={`${SELECT} h-7 w-auto min-w-40`}
                >
                  {offered.map((one) => (
                    <option key={toYearMonthString(one)} value={toYearMonthString(one)}>
                      {formatYearMonth(one)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-caption text-ink-secondary">
                Snaps to {formatMoney(money(SNAP, currency))}
              </span>
            </div>
          </div>

          {against !== undefined && <Against against={against} />}

          {compare !== undefined && (
            <PlanBar
              basis={compare.basis.amount}
              netOff={compare.parts.netOff}
              result={compare.result}
              colours={
                new Map(
                  compare.result.allocations.map((entry) => [
                    entry.bucket.id,
                    bucketColour(entry.bucket, palette),
                  ]),
                )
              }
              locked={new Set()}
              snap={SNAP}
              readOnly
              label={`${compare.plan.name} · ${formatMoney(compare.basis.amount)} net pay`}
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
            label={compare === undefined ? undefined : `${plan.name} · ${formatMoney(basis.amount)} net pay`}
            onTrade={(trade, at) => setDragging({ trade, at })}
            onCommit={(trade) => {
              setDragging(undefined)
              commitTrade(trade)
            }}
            onNudge={commitTrade}
          />

          {got.size > 0 && (
            <p className="m-0 flex items-center gap-2 text-caption text-ink-secondary">
              <i
                aria-hidden
                className="inline-block h-3 w-7 border-t-2 border-ink-secondary"
                style={{
                  background:
                    'linear-gradient(90deg, color-mix(in srgb, var(--color-ink-secondary) 45%, var(--color-background)) 0 60%, color-mix(in srgb, var(--color-ink-secondary) 12%, var(--color-background)) 60%)',
                }}
              />
              The fill is what each one got in {formatMonthName(versus)}. A bar at a
              bucket’s right end means it went over.
            </p>
          )}

          <div
            className={`flex flex-wrap items-center gap-x-4 gap-y-1 border bg-surface px-3.5 py-2.5 ${
              result.balance.minor < 0 ? 'border-negative' : 'border-hairline'
            }`}
          >
            {result.balance.minor === 0 ? (
              <>
                <b className="font-medium text-positive">Every shekel has a job</b>
                <span className="text-ink-secondary">
                  The split adds up to {formatMoney(result.splittable)}.
                </span>
              </>
            ) : result.balance.minor > 0 ? (
              <>
                <b className="font-medium tabular-nums">
                  {formatMoney(result.balance)} is not given a job yet.
                </b>
                {lastEntry !== undefined && lastEntry.allocation.mode !== 'REMAINDER' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setOne(lastEntry.allocation.id, {
                        mode: 'REMAINDER',
                        basisPoints: undefined,
                        amount: undefined,
                      })
                    }
                  >
                    Give it to <Bidi>{lastEntry.bucket.name}</Bidi>
                  </Button>
                )}
                <span className="text-ink-secondary">or drag the last divider to the right edge</span>
              </>
            ) : (
              <>
                <b className="font-medium text-negative tabular-nums">
                  {formatMoney(money(-result.balance.minor, currency))} too much is given out.
                </b>
                <span className="text-ink-secondary">
                  Shrink a bucket or take one out. Planning a drawdown from savings on purpose is allowed.
                </span>
              </>
            )}
          </div>

          <BucketTable
            sections={sections}
            gotIn={formatMonthName(versus)}
            measured={against?.ledgerHasMonth ?? false}
            onHot={setHot}
            onPointsAt={(bucket, at) => setPointing({ bucket, at })}
            onMenu={(bucket, at) => setBucketMenu({ bucket, at })}
            onMode={(allocationId, mode) => setOne(allocationId, modeChange(mode, currency))}
            onPercentage={percentTo}
            onPercentText={(bucketId, text) =>
              setPercentText((current) => {
                const next = { ...current }
                if (text === undefined) delete next[bucketId]
                else next[bucketId] = text
                return next
              })
            }
            onAmountText={(_, bucketId, text) => {
              setAmountText((current) => ({ ...current, [bucketId]: text }))
            }}
            onAmountCommit={(allocationId, bucketId) => {
              const text = amountText[bucketId]
              setAmountText((current) => {
                const next = { ...current }
                delete next[bucketId]
                return next
              })
              const parsed = text === undefined ? undefined : parseAmountText(text)
              if (parsed !== undefined) amountTo(allocationId, fromMajorUnits(Math.abs(parsed), currency).minor)
            }}
            onRename={(bucketId, name) => {
              setRenaming(undefined)
              write((database, now) => updateSplitBucket(database, bucketId, { name }, now))
            }}
            onCancelRename={() => setRenaming(undefined)}
            below={(bucketId) =>
              removingBucket === undefined || removingBucket.id !== bucketId ? null : (
          <div role="alertdialog" aria-label="Remove this bucket" className="fc-pop-enter flex flex-wrap items-center gap-3 border border-negative bg-surface px-4 py-2">
            <span>
              Remove <Bidi>{removingBucket.name}</Bidi> from <Bidi>{plan.name}</Bidi>? Its share goes to{' '}
              {(() => {
                const at = result.allocations.findIndex((one) => one.bucket.id === removingBucket.id)
                const next = result.allocations[at + 1]
                return next === undefined ? (
                  'the money not given a job'
                ) : (
                  <Bidi>{next.bucket.name}</Bidi>
                )
              })()}
              .
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                write((database, now) =>
                  removePlanBuckets(database, plan.id, [removingBucket.id], month, asOf, now),
                )
                setRemovingBucket(undefined)
              }}
            >
              Remove bucket
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRemovingBucket(undefined)}>
              Keep
            </Button>
          </div>
                      )
            }
          />

          <div className="flex flex-wrap items-center gap-3">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const name = newBucket.trim()
                if (name === '') return
                write((database, now) => {
                  const created = createSplitBucket(database, { name }, now)
                  updateSplitPlan(
                    database,
                    plan.id,
                    {
                      allocations: [
                        ...allocations.map(toNewAllocation),
                        {
                          bucketId: created.id,
                          mode: 'PERCENTAGE' as const,
                          basisPoints: 0,
                        },
                      ],
                    },
                    now,
                  )
                  // *What's left* stays the last word: a new bucket goes in before it (M28 F10).
                  const rest = result.allocations.find((entry) => entry.allocation.mode === 'REMAINDER')
                  if (rest !== undefined) {
                    const ids = result.allocations.map((entry) => entry.bucket.id)
                    const at = ids.indexOf(rest.bucket.id)
                    const others = buckets.map((one) => one.id).filter((id) => !ids.includes(id))
                    reorderSplitBuckets(database, [...ids.slice(0, at), created.id, ...ids.slice(at), ...others], now)
                  }
                })
                setNewBucket('')
              }}
            >
              <input
                value={newBucket}
                onChange={(event) => setNewBucket(event.target.value)}
                placeholder="New bucket"
                aria-label="New bucket name"
                className={`${FIELD} w-44`}
              />
              <Button type="submit" variant="secondary" size="sm" icon="add">
                Add a bucket
              </Button>
            </form>

            {plan.isDefault && result.allocations.some((entry) => entry.bucket.targetKind === 'SAVING_GOAL') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSuggestion(suggestion === undefined && db !== undefined ? (suggestGoalSplit(db, asOf, currency) ?? 'NONE') : undefined)
                }
              >
                Suggest goal amounts
              </Button>
            )}

            {unusedBuckets.length > 0 && (
              <select
                value=""
                onChange={(event) => {
                  if (event.target.value === '') return
                  saveAllocations([
                    ...allocations,
                    {
                      id: `new:${event.target.value}`,
                      planId: plan.id,
                      bucketId: event.target.value,
                      mode: 'PERCENTAGE',
                      basisPoints: 0,
                      amount: undefined,
                      isLocked: false,
                    },
                  ])
                }}
                aria-label="Add a bucket this plan does not use"
                className={`${SELECT} w-56`}
              >
                <option value="">Add one you already have…</option>
                {unusedBuckets.map((bucket) => (
                  <option key={bucket.id} value={bucket.id}>
                    {bucket.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {suggestion !== undefined && (
            <SuggestionPanel
              suggestion={suggestion === 'NONE' ? undefined : suggestion}
              onApply={() => {
                if (suggestion === 'NONE') return
                write((database, now) => {
                  const done = applyGoalSplit(database, asOf, currency, suggestion, now)
                  if (done.problems.length > 0) throw new Error(done.problems.join(' '))
                })
                setSuggestion(undefined)
              }}
              onClose={() => setSuggestion(undefined)}
            />
          )}
        </section>
      </div>

      {planMenu !== undefined && (
        <ContextMenu at={planMenu} items={planItems} onClose={() => setPlanMenu(undefined)} />
      )}
      {bucketMenu !== undefined && (
        <ContextMenu
          at={bucketMenu.at}
          header={{ title: <Bidi>{bucketMenu.bucket.name}</Bidi> }}
          items={bucketItems(bucketMenu.bucket)}
          onClose={() => setBucketMenu(undefined)}
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
            write((database, now) =>
              updateSplitBucket(database, target.id, { targetKind: kind, targetId: id }, now),
            )
          }}
        />
      )}
    </div>
  )
}

/** The 50 / 30 / 20 choices of a bucket's *Counts as*, and none of them (M31 U4). */
const SHARE_CHOICES: readonly (readonly [BucketShare | undefined, string])[] = [
  ['NEEDS', 'Needs'],
  ['WANTS', 'Wants'],
  ['SAVING', 'Saving'],
  [undefined, 'None of them'],
]

/**
 * **What the month on screen records** (M31 U4) — what *Use for the month* became once the month
 * row gives a month its plan. Shown only while the month is on this plan and there is a deposit or a
 * payment to record; a plan whose buckets point at categories records nothing and shows nothing.
 * Recorded, it says what it wrote; when the plan has moved since, it says what to record instead.
 */
function RecordLine({
  planName,
  month,
  suggestions,
  changes,
  nameOf,
  onRecord,
}: {
  planName: string
  month: YearMonth
  suggestions: readonly Suggestion[]
  changes: readonly Suggestion[]
  nameOf: (suggestion: Suggestion) => string
  onRecord: () => void
}) {
  const monthName = formatYearMonth(month)
  const said = (one: Suggestion): string =>
    `${formatMoney(one.amount)} ${one.kind === 'SAVING_DEPOSIT' ? 'into' : 'off'} ${nameOf(one)}`

  if (changes.length === 0) {
    const recorded = suggestions.filter((one) => one.fedBy === undefined && one.unchanged)
    if (recorded.length === 0) return null
    return (
      <div className="fc-pop-enter flex flex-wrap items-center gap-x-3.5 gap-y-1 bg-accent-soft px-3.5 py-2.5 text-ink-secondary">
        <span>
          Recorded for {monthName}: {listed(recorded.map(said))}.
        </span>
        <span className="text-caption">It can be changed or deleted like any other.</span>
      </div>
    )
  }

  const moved = changes.filter((one) => one.current !== undefined)
  const deposits = changes.some((one) => one.kind === 'SAVING_DEPOSIT')
  const payments = changes.some((one) => one.kind === 'DEBT_PAYMENT')
  return (
    <div className="fc-pop-enter flex flex-wrap items-center gap-x-3.5 gap-y-2 bg-surface px-3.5 py-2.5">
      <div className="min-w-0 flex-[1_1_420px]">
        {moved.length === changes.length ? (
          <span>
            {listed(moved.map((one) => `${formatMoney(one.current ?? one.amount)} was recorded ${one.kind === 'SAVING_DEPOSIT' ? 'into' : 'off'} ${nameOf(one)}`))}{' '}
            for {monthName}; the plan now says {listed(moved.map((one) => formatMoney(one.amount)))}.
          </span>
        ) : (
          <span>
            {monthName} is on <Bidi>{planName}</Bidi>, which puts {listed(changes.map(said))} this month.
          </span>
        )}
        <small className="block text-caption text-ink-secondary">
          {deposits && payments
            ? 'These are records: they move the goal’s and the debt’s balance.'
            : deposits
              ? 'A deposit is a record: it moves the goal’s balance.'
              : 'A payment is a record: it moves the debt’s balance.'}
          {changes.some((one) => one.alsoDiscovered) &&
            ' The app already finds payments on this debt by itself, so this writes a second row unless it is an extra payment.'}
        </small>
      </div>
      <Button variant="secondary" size="sm" onClick={onRecord}>
        {moved.length === changes.length && changes.length === 1
          ? `Record ${formatMoney(changes[0]?.amount ?? zero(changes[0]?.amount.currency ?? 'ILS'))} instead`
          : changes.length === 1
            ? 'Record it'
            : changes.length === 2
              ? 'Record both'
              : `Record all ${String(changes.length)}`}
      </Button>
    </div>
  )
}

/**
 * **Against a month, in a line** (M31 U4): what the plan said, what went out, and the difference
 * in words — or why there is nothing to say. What it was before was a panel behind a button.
 */
function Against({ against }: { against: PlanActual }) {
  const { versus, ledgerHasMonth, nothing } = against
  const monthName = formatYearMonth(against.period)
  if (!ledgerHasMonth) {
    return (
      <p className="m-0 border-t border-hairline pt-2.5 text-caption text-ink-secondary">
        No statement has been read for {monthName} yet, so what the buckets got is unknown, not nothing, and they
        have no fill. Deposits and debt payments are entered by hand and still count.
      </p>
    )
  }
  if (nothing !== undefined || versus.comparable === 0) {
    return <p className="m-0 border-t border-hairline pt-2.5 text-caption text-ink-secondary">{nothing ?? `Nothing here can be measured in ${monthName}.`}</p>
  }
  // The split's own bills count beside the buckets; the ones out of net are before the split.
  const bills = against.fixed.filter((line) => line.role === 'SPLIT' && line.planned !== undefined)
  const billsPlanned = bills.reduce((total, line) => total + (line.planned?.minor ?? 0), 0)
  const billsActual = bills.reduce((total, line) => total + (line.actual?.minor ?? 0), 0)
  const planned = money(versus.planned.minor + billsPlanned, versus.planned.currency)
  const actual = money(versus.actual.minor + billsActual, versus.actual.currency)
  const difference = actual.minor - planned.minor
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-hairline pt-2.5">
      <Stat label="Planned" value={planned} />
      <Stat label="Got" value={actual} />
      <Stat label={difference > 0 ? 'Over the plan' : 'Under the plan'} value={money(Math.abs(difference), planned.currency)} />
      <p className="m-0 flex-[1_1_280px] self-center text-caption text-ink-secondary">
        In {monthName} {formatMoney(actual)} of the {formatMoney(planned)} planned went out.
        {versus.withoutBasis > 0 &&
          ` ${String(versus.withoutBasis)} ${versus.withoutBasis === 1 ? 'bucket is' : 'buckets are'} not measured: nothing records what a fund, an account or nothing in particular got.`}
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: Money }) {
  return (
    <div className="flex flex-col">
      <span className="text-label text-ink-tertiary uppercase">{label}</span>
      <span className="text-[17px] font-medium tabular-nums">{formatMoney(value)}</span>
    </div>
  )
}

function Figure({
  label,
  value,
  unavailable = false,
  children,
}: {
  label: string
  value: Money
  unavailable?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5 first:pl-0">
      <span className="fc-label text-ink-secondary uppercase">{label}</span>
      <span className="text-[24px] leading-tight font-medium tracking-[-0.01em] tabular-nums">
        {unavailable ? '—' : formatMoney(value)}
      </span>
      <small className={`text-caption ${unavailable ? 'text-negative' : 'text-ink-secondary'}`}>
        {children}
      </small>
    </div>
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

/** What a fixed-amount row's text starts as. */
function fixedAmountOf(amount: Money | undefined, currency: CurrencyCode): string {
  return editableMoney(amount === undefined ? undefined : { minor: amount.minor, currency })
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
      amount: {
        minor: Math.abs(observation.amount.minor),
        currency: observation.amount.currency,
      },
    }))
    .reverse()
}

/**
 * The first plan, and the one decision docs/f05 left open about it: 50/30/20
 * ships as a starting point because an empty splitter is the hardest screen in
 * the app to begin. Every number in it is a slider the moment it lands.
 *
 * **It lands on the person's categories** (M31 U3): one bucket per top-level
 * category, each share divided by what went out under it, so the first plan is
 * already a budget Home can hold the month against. A heading the starter cannot
 * place is asked about here, all of them at once, before anything is made.
 */
function EmptyState({
  headings,
  onCreate,
}: {
  headings: readonly StarterHeading[]
  /** Undefined starts empty. */
  onCreate: (answers: ReadonlyMap<string, StarterAnswer> | undefined) => void
}) {
  const unplaced = unplacedHeadings(headings)
  const [answers, setAnswers] = useState<ReadonlyMap<string, StarterAnswer>>(new Map())
  const answered = unplaced.every((heading) => answers.has(heading.id))
  return (
    // **Both of the guide's Plan places, until there is a plan** (M28 U9): the
    // fixed expenses are tracked against a plan, so starting one comes first.
    <div
      className="fc-view-enter mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center"
      data-guide="plan.split plan.fixed"
    >
      <p className="text-title">Decide where the next one goes.</p>
      <p className="text-ink-secondary">
        A plan splits your take-home pay into buckets — percentages, fixed amounts, or whatever is left over,
        after the bills you pick. Nothing here changes your ledger; it is a plan, not a record.
      </p>
      {unplaced.length > 0 && (
        <div className="flex w-full flex-col gap-1.5 text-left">
          <span className="fc-label text-ink-secondary uppercase">Which are these?</span>
          {unplaced.map((heading) => (
            <div key={heading.id} className="flex h-[34px] items-center justify-between gap-3 border-b border-hairline">
              <span className="flex min-w-0">
                <Bidi className="min-w-0 truncate">{heading.name}</Bidi>
              </span>
              <span className="flex shrink-0 gap-0.5">
                {STARTER_CHOICES.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    aria-pressed={answers.get(heading.id) === choice.value}
                    onClick={() => setAnswers(new Map(answers).set(heading.id, choice.value))}
                    className={`rounded-md px-2 py-1 text-caption ${
                      answers.get(heading.id) === choice.value ? 'bg-elevated text-ink' : 'text-ink-tertiary hover:text-ink'
                    }`}
                  >
                    {choice.label}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" disabled={!answered} onClick={() => onCreate(answers)}>
          Start with 50 / 30 / 20
        </Button>
        <Button variant="secondary" onClick={() => onCreate(undefined)}>
          Start empty
        </Button>
      </div>
      <p className="text-caption text-ink-tertiary">
        Half to needs, a third to wants, a fifth to saving — divided among your categories by what went out under
        each, so each has its bucket from the start. A starting point, not advice; every number is a slider once it is
        there.
      </p>
    </div>
  )
}

const STARTER_CHOICES: readonly { readonly value: StarterAnswer; readonly label: string }[] = [
  { value: 'NEEDS', label: 'Needs' },
  { value: 'WANTS', label: 'Wants' },
  { value: 'SAVING', label: 'Saving' },
  { value: 'NONE', label: 'Leave out' },
]

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
