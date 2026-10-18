import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { newId } from '@/core/id.ts'
import { formatMoney, money } from '@/core/money.ts'
import { monthRange } from '@/core/time.ts'
import { listAccounts, setExcludeSettlementsFromStats } from '@/data/repositories/accountRepository.ts'
import {
  correctCategories,
  undoCorrections,
  type FiledRow,
} from '@/data/repositories/categoryOverrideRepository.ts'
import {
  listCategories,
  usualCategories,
  type Category,
} from '@/data/repositories/categoryRepository.ts'
import { createRule, deleteRule } from '@/data/repositories/categoryRuleRepository.ts'
import { listDebts, syncDiscoveredPayments, updateDebt } from '@/data/repositories/debtRepository.ts'
import {
  createFixedExpense,
  listFixedExpenses,
  merchantObservations,
} from '@/data/repositories/fixedExpenseRepository.ts'
import {
  merchantQueue,
  skipAll,
  skipMerchant,
  unskipMerchant,
} from '@/data/repositories/labelingQueueRepository.ts'
import {
  bankMerchants,
  labelledMerchants,
  merchantGroupIds,
} from '@/data/repositories/merchantGroupRepository.ts'
import { rescanSettlements } from '@/data/importer/settlementScan.ts'
import { decideForCard } from '@/data/repositories/cardSettlementRepository.ts'
import {
  clearSettlementAlias,
  setSettlementAlias,
  settlementAliasMap,
} from '@/data/repositories/settlementAliasRepository.ts'
import { loadRules } from '@/data/repositories/ruleSetRepository.ts'
import {
  countTransactions,
  findTransactionById,
  monthlyTotals,
  setExcludedFromStats,
  type TransactionFilter,
} from '@/data/repositories/transactionRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { proposeFixedExpense } from '@/domain/fixedExpenses.ts'
import { offerForCorrection } from '@/domain/learning.ts'
import {
  dominantCategory,
  orderGroups,
  settledCount,
  type GroupOrder,
  type MerchantGroup,
} from '@/domain/merchantGroups.ts'
import { asRule, draftFromMerchant } from '@/domain/ruleEditing.ts'
import { suggestFromHistory, type MerchantSuggestion } from '@/domain/suggest.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Flip } from '@/ui/motion/Flip.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { PromotionPanel, type BillPromotion } from '@/ui/categorize/PromotionPanel.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryMark, useCategoryPalette } from '@/ui/components/CategoryMark.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { ContextMenu, isMenuKey, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'
import { Kbd } from '@/ui/components/Kbd.tsx'
import { accountLabel } from '@/ui/rules/ruleText.ts'
import { ViewSwitch } from '@/ui/transactions/ViewSwitch.tsx'
import { useRowCursor } from '@/ui/useRowCursor.ts'

/**
 * **By merchant** — the uncategorized backlog, one row per shop, and the place a
 * pile of fresh rows is worked through (M28 U6, D-315). It was `#/categorize`,
 * an operation reached from a count; it is now one of the two views of the one
 * Transactions page, with a switch in the header (choice 1 B).
 *
 * The ledger answers "where did it go". This answers the other question a pile
 * of freshly imported rows raises — "what *is* all this?" — and it answers it by
 * collapsing thirty charges at one supermarket into one decision. A backlog you
 * have to work through row by row is a backlog you abandon (docs/08).
 *
 * **It only ever touches rows with no category.** The scope is fixed in
 * `listMerchantGroups` rather than offered as a control: a bulk assignment that
 * could reach a category the user picked by hand is a different and much more
 * dangerous tool, and D-009 is the rule this screen is most able to break.
 *
 * **Filing a merchant makes its rule, ticked by default, and one Undo takes both
 * back** (choice 4 B). The rule is the same `LEARNED_FROM_CORRECTION` one the
 * ledger offers after a correction, written through the same shaping and only
 * when `offerForCorrection` says there is something to learn — a merchant a
 * rule already covers is not written twice. Un-ticking a row says *file it, but
 * no rule*, and the tick is remembered for the sitting.
 *
 * **Keyboard first, and the mouse has the same road**: the guess on Enter, the
 * six usual categories on 1–6 or by dragging a merchant onto one (S1), and every
 * filing of the sitting kept with its own Undo (S3).
 */
export function ByMerchant() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()

  const [scope, setScope] = useState<Scope>(EVERYTHING)
  const [order, setOrder] = useState<GroupOrder>('COUNT')
  const [filings, setFilings] = useState<readonly Filing[]>([])
  /** Merchants whose rule is un-ticked, for the sitting. */
  const [noRule, setNoRule] = useState<ReadonlySet<string>>(() => new Set())
  const [showSkipped, setShowSkipped] = useState(false)
  const [expanded, setExpanded] = useState<string | undefined>()
  const [promoting, setPromoting] = useState<string | undefined>()
  const [promoted, setPromoted] = useState<Promoted | undefined>()
  const [menu, setMenu] = useState<
    { readonly group: MerchantGroup; readonly at: { readonly x: number; readonly y: number } } | undefined
  >()
  /** The category chosen on a row but not yet confirmed, by merchant. */
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({})
  const [cardMenu, setCardMenu] = useState<
    { readonly group: MerchantGroup; readonly at: { readonly x: number; readonly y: number } } | undefined
  >()
  const [over, setOver] = useState<string | undefined>()
  const dragging = useRef<string | undefined>(undefined)
  /** What the sitting started with, so *filed this sitting* has something to be a share of. */
  const [baseline, setBaseline] = useState(0)

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const categories = listCategories(db)
    // The guide's By merchant step reads this same queue (M28 F16).
    const queue = merchantQueue(db, toFilter(scope))
    const currency = documentCurrency(db)
    const usual = usualCategories(db, 6)
      .map((id) => categories.find((one) => one.id === id))
      .filter((one): one is Category => one !== undefined)
    return {
      // Skipped names are split off by `merchantQueue`, not in SQL: a skip is a fact
      // about the *queue*, not about the rows, and the ledger must keep showing
      // them (D-065).
      groups: orderGroups(queue.waiting, order),
      skippedGroups: orderGroups(queue.skipped, order),
      categories,
      usual,
      currency,
      paths: new Map(listCategories(db, { includeArchived: true }).map((c) => [c.id, c.path])),
      accounts: listAccounts(db, { includeArchived: true }),
      months: [...new Set(monthlyTotals(db).map((total) => total.period))],
      // What this merchant probably is, learned from what the user already
      // filed (D-151): the user's own past decisions, never a guess about the
      // market. Over the visible backlog only.
      suggestions: suggestFromHistory(
        queue.waiting.map((group) => ({
          merchantNormalized: group.merchantNormalized,
          hasSettled: group.settled.length > 0,
        })),
        labelledMerchants(db),
      ),
      debts: listDebts(db),
      bills: new Map(
        listFixedExpenses(db)
          .filter((expense) => expense.isActive && expense.matchKind === 'MERCHANT_PATTERN')
          .map((expense) => [expense.matchRef ?? '', expense.name]),
      ),
      ledger: countTransactions(db),
      bank: bankMerchants(db),
      aliases: settlementAliasMap(db),
    }
  }, [db, revision, scope, order])

  const palette = useCategoryPalette(data?.categories ?? [])

  /** The primary currency's outflow still waiting, in minor units. */
  const leftMinor = useMemo(
    () =>
      data === undefined
        ? 0
        : data.groups.reduce(
            (sum, group) =>
              sum + (group.totals.find((total) => total.currency === data.currency)?.outflowMinor ?? 0),
            0,
          ),
    [data],
  )
  // New rows arriving mid-sitting raise the baseline rather than pushing the
  // share below zero.
  useEffect(() => {
    setBaseline((current) => Math.max(current, leftMinor))
  }, [leftMinor])

  /** The ledger's charges for the one merchant whose charges are shown. */
  const charges = useMemo(() => {
    if (db === undefined || expanded === undefined) return undefined
    const ids = merchantGroupIds(db, expanded, toFilter(scope))
    return {
      total: ids.length,
      rows: ids.slice(0, 6).flatMap((id) => {
        const row = findTransactionById(db, id)
        return row === undefined ? [] : [row]
      }),
    }
  }, [db, revision, expanded, scope])

  const proposal = useMemo(() => {
    if (db === undefined || promoting === undefined) return undefined
    return proposeFixedExpense(merchantObservations(db, promoting), promoting)
  }, [db, revision, promoting])

  const hintOf = (group: MerchantGroup): string | undefined =>
    dominantCategory(group)?.categoryId ??
    data?.suggestions.find((one) => one.merchantNormalized === group.merchantNormalized)?.categoryId

  /** What Confirm will file: the category picked on the row, else the guess. */
  const choiceOf = (group: MerchantGroup): string | undefined => picked[group.merchantNormalized] ?? hintOf(group)

  /**
   * *This pays a card*, from the merchant's own row (M28 F3): the same answer the
   * Transactions row menu gives — every row of the name is read as paying the
   * card, the links are re-derived, and the card's settlements are not spent twice.
   */
  const setPayer = (group: MerchantGroup, cardAccountId: string | undefined): void => {
    mutate((database) => {
      const now = Date.now()
      if (cardAccountId === undefined) {
        clearSettlementAlias(database, group.merchantNormalized, now)
        rescanSettlements(database, now)
        return
      }
      setSettlementAlias(database, group.merchantNormalized, cardAccountId, now)
      rescanSettlements(database, now)
      setExcludeSettlementsFromStats(database, cardAccountId, true, now)
      decideForCard(database, cardAccountId, 'EXCLUDED', now)
    })
  }

  /**
   * Give every uncategorized row of one merchant a category, and — unless the
   * tick was taken off — make the rule, in one step. The ids are resolved here
   * rather than carried on the group, so what lands is what the screen was
   * showing a moment ago and nothing that arrived since.
   */
  const file = (group: MerchantGroup, categoryId: string | undefined): void => {
    if (categoryId === undefined || data === undefined) return
    let result: ReturnType<typeof correctCategories> | undefined
    let ruleId: string | undefined
    mutate((database) => {
      const now = Date.now()
      const ids = merchantGroupIds(database, group.merchantNormalized, toFilter(scope))
      result = correctCategories(database, ids, categoryId, now)
      if (result.changed === 0 || result.subject === undefined) return
      if (noRule.has(group.merchantNormalized)) return
      const offer = offerForCorrection({
        subject: result.subject,
        categoryId,
        corrections: result.corrections ?? 0,
        rules: loadRules(database),
      })
      if (offer === undefined) return
      const shaped = asRule(offer.draft)
      ruleId = createRule(
        database,
        {
          name: shaped.name,
          kind: shaped.kind,
          pattern: shaped.pattern,
          targetCategoryId: shaped.targetCategoryId,
          conditions: shaped.conditions,
          origin: 'LEARNED_FROM_CORRECTION',
        },
        now,
      ).id
    })
    const done = result as ReturnType<typeof correctCategories> | undefined
    if (done === undefined || done.changed === 0) return
    setExpanded(undefined)
    setPicked((current) => {
      const { [group.merchantNormalized]: _gone, ...rest } = current
      return rest
    })
    setFilings((current) => [
      {
        key: newId(),
        merchantRaw: group.merchantRaw,
        categoryId,
        categoryPath: data.paths.get(categoryId) ?? 'a category',
        count: done.changed,
        filed: done.filed,
        ruleId,
      },
      ...current,
    ])
  }

  /** Take one filing back — the rows, and the rule if it made one. */
  const undo = (filing: Filing): void => {
    mutate((database) => {
      undoCorrections(database, filing.filed, filing.categoryId)
      if (filing.ruleId !== undefined) deleteRule(database, filing.ruleId, Date.now())
    })
    setFilings((current) => current.filter((one) => one.key !== filing.key))
  }

  const skip = (group: MerchantGroup): void => {
    mutate((database) => skipMerchant(database, group.merchantNormalized, Date.now()))
  }

  const unskip = (group: MerchantGroup): void => {
    mutate((database) => unskipMerchant(database, group.merchantNormalized, Date.now()))
  }

  /** The one accept for every confident suggestion: one transaction, no rules. */
  const acceptAll = (accepted: readonly MerchantSuggestion[]): void => {
    mutate((database) => {
      const now = Date.now()
      for (const one of accepted) {
        const ids = merchantGroupIds(database, one.merchantNormalized, toFilter(scope))
        if (ids.length > 0) correctCategories(database, ids, one.categoryId, now)
      }
    })
  }

  const leaveOut = (group: MerchantGroup): void => {
    mutate((database) => {
      const now = Date.now()
      for (const id of merchantGroupIds(database, group.merchantNormalized, toFilter(scope))) {
        setExcludedFromStats(database, id, true, now)
      }
    })
  }

  const openPromotion = (group: MerchantGroup): void => {
    setPromoted(undefined)
    setPromoting((current) => (current === group.merchantNormalized ? undefined : group.merchantNormalized))
  }

  /** A bill: a `FixedExpense` matched on this merchant. `USER_DEFINED`, because the detector never offered it. */
  const promoteToBill = (group: MerchantGroup, promotion: BillPromotion): void => {
    mutate((database) =>
      void createFixedExpense(
        database,
        {
          name: promotion.name,
          categoryId: promotion.categoryId,
          matchKind: 'MERCHANT_PATTERN',
          matchRef: group.merchantNormalized,
          expectedAmount: promotion.expectedAmount,
          amountVariability: promotion.amountVariability,
          cadence: promotion.cadence,
          dayOfMonthHint: promotion.dayOfMonthHint,
          source: 'USER_DEFINED',
          startedAt: promotion.startedAt,
        },
        Date.now(),
      ),
    )
    setPromoting(undefined)
    setPromoted({ kind: 'BILL', name: promotion.name })
    if (promotion.categoryId !== undefined) file(group, promotion.categoryId)
  }

  /** A debt payment: the debt is pointed at the name and discovery is run. No payment is written here. */
  const promoteToDebt = (group: MerchantGroup, debtId: string): void => {
    const debt = data?.debts.find((one) => one.id === debtId)
    if (debt === undefined) return
    let outcome = { created: 0, ambiguous: 0 }
    mutate((database) => {
      const now = Date.now()
      updateDebt(database, debtId, { tracking: { kind: 'MERCHANT_PATTERN', pattern: group.merchantNormalized } }, now)
      const result = syncDiscoveredPayments(database, now)
      outcome = { created: result.created, ambiguous: result.ambiguous }
    })
    setPromoting(undefined)
    setPromoted({ kind: 'DEBT', name: debt.name, ...outcome })
  }

  const showRows = (group: MerchantGroup): void => {
    navigate('/transactions', { state: { search: group.merchantRaw } })
  }

  const groups = data?.groups ?? []
  const usual = data?.usual ?? []

  const cursor = useRowCursor(groups.length, {
    onActivate: (index) => {
      const group = groups[index]
      if (group !== undefined) file(group, choiceOf(group))
    },
    keys: {
      s: (index) => {
        const group = groups[index]
        if (group !== undefined) skip(group)
      },
      // `c` reaches for the picker's own trigger by its role rather than for the
      // component's state, so there is one implementation of opening it.
      c: () => {
        const trigger = cursor.element()?.querySelector('[aria-haspopup="listbox"]')
        if (trigger instanceof HTMLElement) trigger.click()
      },
      p: (index) => {
        const group = groups[index]
        const element = cursor.element()?.querySelector('[data-pays-card]')
        if (group === undefined || !(element instanceof HTMLElement)) return
        const box = element.getBoundingClientRect()
        setCardMenu({ group, at: { x: box.left, y: box.bottom + 2 } })
      },
      t: (index) => {
        const group = groups[index]
        if (group !== undefined) openPromotion(group)
      },
      ' ': (index) => {
        const group = groups[index]
        if (group !== undefined) {
          setExpanded((current) => (current === group.merchantNormalized ? undefined : group.merchantNormalized))
        }
      },
      ...Object.fromEntries(
        [0, 1, 2, 3, 4, 5].map((slot) => [
          String(slot + 1),
          (index: number) => {
            const group = groups[index]
            const target = usual[slot]
            if (group !== undefined && target !== undefined) file(group, target.id)
          },
        ]),
      ),
    },
  })

  if (data === undefined) {
    return <Centered>Open a document, or create one, to categorize what is in it.</Centered>
  }

  const waiting = groups.reduce((total, group) => total + group.count, 0)
  const placed = baseline === 0 ? 0 : Math.round((100 * (baseline - leftMinor)) / baseline)
  const confident = data.suggestions.filter((one) => one.confident)
  const promotingGroup = groups.find((group) => group.merchantNormalized === promoting)
  const categoryPath = (id: string): string | undefined => data.paths.get(id)
  const suggestionFor = (group: MerchantGroup): MerchantSuggestion | undefined =>
    data.suggestions.find((one) => one.merchantNormalized === group.merchantNormalized)

  const openMenu = (group: MerchantGroup, at: { x: number; y: number }): void => setMenu({ group, at })

  const cards = data.accounts.filter((one) => one.kind === 'CREDIT_CARD')
  const canPayCard = (group: MerchantGroup): boolean => cards.length > 0 && data.bank.has(group.merchantNormalized)
  const cardItems = (group: MerchantGroup): readonly MenuItem[] => {
    const alias = data.aliases.get(group.merchantNormalized)
    return [
      ...cards.map((card) => ({
        label: `${card.name}${card.id === alias ? ' · now' : ''}`,
        onChoose: () => setPayer(group, card.id),
      })),
      ...(alias === undefined
        ? []
        : [{ label: 'Not a card payment', separated: true, onChoose: () => setPayer(group, undefined) }]),
    ]
  }

  const menuItems = (group: MerchantGroup): readonly MenuItem[] => {
    const hint = choiceOf(group)
    const items: MenuItem[] = []
    if (hint !== undefined) {
      items.push({
        icon: 'check',
        label: `Confirm all ${String(group.count)} as ${categoryPath(hint) ?? 'the guess'}`,
        shortcut: 'Enter',
        onChoose: () => file(group, hint),
      })
    }
    items.push({
      icon: 'cat',
      label: `Categorize all ${String(group.count)} as`,
      submenu: [
        ...usual.map((one, slot) => ({
          label: (
            <CategoryMark color={palette.colorOf(one.id)}>
              {one.path}
            </CategoryMark>
          ),
          shortcut: String(slot + 1),
          onChoose: () => file(group, one.id),
        })),
        {
          label: 'All categories…',
          shortcut: 'C',
          separated: usual.length > 0,
          onChoose: () => {
            const trigger = cursor.element()?.querySelector('[aria-haspopup="listbox"]')
            if (trigger instanceof HTMLElement) trigger.click()
          },
        },
      ],
    })
    if (canPayCard(group)) {
      items.push({
        icon: 'card',
        label: 'This pays a card…',
        detail: 'Every row of this name is a card payment, not spending',
        shortcut: 'P',
        onChoose: () => {
          const element = cursor.element()?.querySelector('[data-pays-card]')
          const box = element?.getBoundingClientRect()
          setCardMenu({ group, at: { x: box?.left ?? 200, y: (box?.bottom ?? 200) + 2 } })
        },
      })
    }
    items.push({
      icon: 'skip',
      label: 'Skip for now',
      detail: 'It waits under Skipped, and its rows stay in the ledger',
      shortcut: 'S',
      onChoose: () => skip(group),
    })
    items.push(
      {
        icon: 'eyeoff',
        label: `Leave all ${String(group.count)} out of totals`,
        detail: 'They stay in the list, struck through, and leave every sum on Home',
        separated: true,
        onChoose: () => leaveOut(group),
      },
      {
        icon: 'bill',
        label: 'It’s a bill…',
        detail: 'Watch for it each month, with the amount it usually is',
        shortcut: 'T',
        onChoose: () => openPromotion(group),
      },
      { icon: 'debt', label: 'It pays a debt…', onChoose: () => openPromotion(group) },
      {
        icon: 'rule',
        label: (
          <>
            Write a rule for <Bidi>{group.merchantRaw}</Bidi>…
          </>
        ),
        separated: true,
        onChoose: () =>
          navigate('/categories/rules', { state: { draft: draftFromMerchant(group.merchantNormalized, hint) } }),
      },
      { icon: 'filter', label: 'Show its rows in All rows', onChoose: () => showRows(group) },
      {
        icon: 'cat',
        label: 'Show its charges here',
        shortcut: 'Space',
        onChoose: () => setExpanded(group.merchantNormalized),
      },
    )
    return items
  }

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter @container flex flex-col gap-5 px-8 pt-6 pb-12">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-4">
          <div className="flex flex-col gap-1.5">
            <span className="fc-label text-ink-secondary uppercase">
              Transactions · one decision per shop, not per charge
            </span>
            <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">Transactions</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ViewSwitch view="merchants" waiting={groups.length} />
            <label className="flex items-center gap-2 text-caption text-ink-secondary">
              <span className="sr-only">Account</span>
              <select
                value={scope.accountId}
                onChange={(event) => setScope({ ...scope, accountId: event.target.value })}
                className={`${SELECT} text-body`}
              >
                <option value="">All accounts</option>
                {data.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-caption text-ink-secondary">
              <span className="sr-only">Month</span>
              <select
                value={scope.period}
                onChange={(event) => setScope({ ...scope, period: event.target.value })}
                className={`${SELECT} text-body`}
              >
                <option value="">All months</option>
                {data.months.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-caption text-ink-secondary">
              <span className="sr-only">Order</span>
              <select
                value={order}
                onChange={(event) => setOrder(event.target.value as GroupOrder)}
                className={`${SELECT} text-body`}
              >
                <option value="COUNT">Most charges first</option>
                <option value="AMOUNT">Largest amount first</option>
                <option value="NAME">Merchant name</option>
              </select>
            </label>
          </div>
        </header>

        <div className="grid grid-cols-2 divide-x divide-hairline border-y border-hairline @[48rem]:grid-cols-4">
          <Hero label="Waiting" first>
            <b className="text-[22px] leading-tight font-medium tabular-nums">
              {groups.length} {groups.length === 1 ? 'name' : 'names'}
            </b>
            <small className="text-caption text-ink-secondary">
              {waiting} {waiting === 1 ? 'charge' : 'charges'} with no category
            </small>
          </Hero>
          <Hero label="Without a category">
            <b className="text-[22px] leading-tight font-medium tabular-nums text-flow-out">
              {formatMoney(money(leftMinor, data.currency))}
            </b>
            <small className="text-caption text-ink-secondary">so Home’s categories are short by this</small>
          </Hero>
          <div className="col-span-2 flex min-w-0 flex-col gap-1 px-4 py-3.5">
            <span className="fc-label text-ink-secondary uppercase">Categorized this sitting</span>
            <b className="text-[22px] leading-tight font-medium tabular-nums">{placed}%</b>
            <div className="h-1 bg-hairline" aria-hidden>
              <i className="block h-full bg-accent transition-[width] duration-[var(--duration-base)]" style={{ width: `${placed}%` }} />
            </div>
            <small className="text-caption text-ink-secondary">
              {formatMoney(money(baseline - leftMinor, data.currency))} of{' '}
              {formatMoney(money(baseline, data.currency))} placed
            </small>
          </div>
        </div>

        {filings.length > 0 && (
          <section
            aria-label="Categorized this sitting"
            aria-live="polite"
            className="fc-pop-enter flex flex-col bg-accent-soft"
          >
            {filings.slice(0, 5).map((filing) => (
              <div key={filing.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
                <ActionGlyph name="check" />
                <span className="min-w-0 flex-1">
                  Categorized {filing.count} <Bidi>{filing.merchantRaw}</Bidi> as{' '}
                  <b className="font-medium">{filing.categoryPath}</b>
                  {filing.ruleId === undefined ? '.' : ', and made the rule, so next month’s are categorized on import.'}
                </span>
                <Button variant="ghost" size="sm" onClick={() => undo(filing)}>
                  {filing.ruleId === undefined ? 'Undo' : 'Undo both'}
                </Button>
              </div>
            ))}
            {filings.length > 5 && (
              <p className="px-3.5 pb-2 text-caption text-ink-secondary">
                and {filings.length - 5} earlier this sitting, each with its own Undo once the newer ones are gone
              </p>
            )}
          </section>
        )}

        {promoted !== undefined && (
          <section
            aria-label="Promoted"
            aria-live="polite"
            className="fc-pop-enter flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-3.5 py-2.5"
          >
            <p className="m-0">
              {promoted.kind === 'BILL' ? (
                <>
                  <span className="font-medium">{promoted.name}</span> is a bill now, and the next charge
                  under this name is the same bill.{' '}
                  <Link to="/plan" className={LINK}>
                    See it on Plan
                  </Link>
                </>
              ) : (
                <>
                  <span className="font-medium">{promoted.name}</span> watches this name now.{' '}
                  {promoted.created === 0 ? (
                    <span className="text-ink-secondary">
                      Nothing was found to answer yet — the next import will look again.
                    </span>
                  ) : (
                    <>
                      <span className="tabular-nums">{promoted.created}</span>
                      {promoted.created === 1 ? ' charge is' : ' charges are'} waiting unconfirmed in its review queue.
                    </>
                  )}
                  {promoted.ambiguous > 0 && (
                    <>
                      {' '}
                      <span className="tabular-nums">{promoted.ambiguous}</span> more{' '}
                      {promoted.ambiguous === 1 ? 'is' : 'are'} covered by two debts and wait as questions.
                    </>
                  )}{' '}
                  <Link to="/wealth/debts" className={LINK}>
                    Answer them on Debts
                  </Link>
                </>
              )}
            </p>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setPromoted(undefined)}>
              Dismiss
            </Button>
          </section>
        )}

        {promoting !== undefined && promotingGroup !== undefined && (
          <PromotionPanel
            key={promoting}
            group={promotingGroup}
            proposal={proposal}
            categories={data.categories}
            categoryPath={categoryPath}
            debts={data.debts}
            trackedByExpense={data.bills.get(promoting)}
            suggestedCategoryId={hintOf(promotingGroup)}
            onBill={(promotion) => promoteToBill(promotingGroup, promotion)}
            onDebt={(debtId) => promoteToDebt(promotingGroup, debtId)}
            onDismiss={() => setPromoting(undefined)}
          />
        )}

        {confident.length > 0 && (
          <section className="fc-pop-enter flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-3.5 py-2.5">
            <p className="m-0 min-w-0 flex-1">
              <span className="font-medium tabular-nums">{confident.length}</span>
              {confident.length === 1 ? ' merchant identified.' : ' merchants identified.'}{' '}
              <span className="text-ink-secondary">Save categorizes each under its category.</span>
            </p>
            <Button variant="secondary" size="sm" icon="check" onClick={() => acceptAll(confident)}>
              {confident.length === 1 ? 'Save' : `Save ${confident.length}`}
            </Button>
          </section>
        )}

        <div className="grid grid-cols-1 items-start gap-6 @[56rem]:grid-cols-[minmax(0,1fr)_15.5rem]">
          <div className="min-w-0" data-guide="tx.merchant">
            <div className="flex items-center justify-between border-b border-hairline pb-2 text-caption text-ink-tertiary">
              <span className="fc-label uppercase">Merchant</span>
              <span className="flex items-center gap-4">
                {groups.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      mutate((database) =>
                        void skipAll(database, groups.map((group) => group.merchantNormalized), Date.now()),
                      )
                    }
                    className="hover:text-ink"
                    title="Set every name here aside. Nothing is written to the transactions."
                  >
                    Skip all {groups.length}
                  </button>
                )}
                {data.skippedGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowSkipped((current) => !current)}
                    className={`tabular-nums ${showSkipped ? 'text-ink underline underline-offset-4' : 'hover:text-ink'}`}
                  >
                    {data.skippedGroups.length} skipped
                  </button>
                )}
              </span>
            </div>

            {showSkipped && data.skippedGroups.length > 0 && (
              <section className="fc-pop-enter border-b border-hairline bg-surface px-3 py-3">
                <p className="m-0 text-ink-secondary">
                  Set aside. These are still in the ledger and still uncategorized — they are only out of the queue.
                </p>
                <ul className="m-0 mt-1.5 list-none p-0">
                  {data.skippedGroups.map((group) => (
                    <li key={group.merchantNormalized} className="flex flex-wrap items-baseline gap-x-3 border-t border-hairline py-1">
                      <Bidi className="text-ink">{group.merchantRaw}</Bidi>
                      <span className="text-ink-tertiary tabular-nums">
                        {group.count} {group.count === 1 ? 'transaction' : 'transactions'}
                      </span>
                      <button
                        type="button"
                        onClick={() => unskip(group)}
                        className="ml-auto text-caption text-ink-secondary hover:text-ink"
                      >
                        Put it back
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div
              {...cursor.container}
              onKeyDown={(event) => {
                if (isMenuKey(event)) {
                  const element = cursor.element()
                  const group = groups[cursor.index]
                  if (element !== undefined && group !== undefined) {
                    const box = element.getBoundingClientRect()
                    openMenu(group, { x: box.left + 120, y: box.bottom })
                    event.preventDefault()
                  }
                  return
                }
                cursor.container.onKeyDown(event)
              }}
              className="outline-none"
              aria-label="Merchants waiting for a category"
            >
              {groups.length === 0 ? (
                <Empty
                  scoped={scope.accountId !== '' || scope.period !== ''}
                  imported={data.ledger > 0}
                  onClear={() => setScope(EVERYTHING)}
                />
              ) : (
                // A merchant filed or skipped leaves the queue, and the ones below
                // close up (M39, src/ui/motion/). A wrapper with no box of its own,
                // so the cursor's container and its rows are as they were.
                <Flip
                  as="div"
                  className="contents"
                  flipKey={`${groups.map((group) => group.merchantNormalized).join('|')}|${expanded ?? ''}`}
                >
                {groups.map((group, index) => {
                  const hint = dominantCategory(group)
                  const suggestion = suggestionFor(group)
                  const guess = choiceOf(group)
                  const on = cursor.index === index
                  const why =
                    hint !== undefined
                      ? `${hint.count} earlier ${hint.count === 1 ? 'charge' : 'charges'} categorized there${settledCount(group) > hint.count ? `, of ${settledCount(group)}` : ''}`
                      : suggestion !== undefined
                        ? `looks like ${suggestion.neighbour}`
                        : (group.providerCategories[0]?.value ?? 'no pattern yet')
                  const ruleTicked = !noRule.has(group.merchantNormalized)
                  return (
                    <div
                      key={group.merchantNormalized}
                      data-motion-key={group.merchantNormalized}
                      {...cursor.row(index)}
                      className={`fc-cursor-row grid min-h-[52px] grid-cols-[minmax(0,1fr)_3rem_6rem] items-center gap-x-3.5 @[46rem]:grid-cols-[minmax(4rem,1.5fr)_3rem_6rem_minmax(8rem,1.5fr)_auto] border-b border-hairline px-2 transition-colors duration-[var(--duration-micro)] hover:bg-surface ${
                        on ? 'bg-accent-soft' : ''
                      } ${over === group.merchantNormalized ? 'outline outline-2 -outline-offset-2 outline-accent' : ''}`}
                      draggable
                      onClick={() => cursor.set(index)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        cursor.set(index)
                        openMenu(group, { x: event.clientX, y: event.clientY })
                      }}
                      onDragStart={(event) => {
                        dragging.current = group.merchantNormalized
                        event.dataTransfer.setData('text/plain', group.merchantRaw)
                        event.dataTransfer.effectAllowed = 'move'
                        cursor.set(index)
                      }}
                      onDragEnd={() => {
                        dragging.current = undefined
                        setOver(undefined)
                      }}
                    >
                      <span className="flex min-w-0 flex-col py-1.5">
                        {/* The ellipsis is on the isolated span, not on the button
                            around it (M28 F20): truncated inside an LTR box, a
                            Hebrew name loses its start and shows its tail. The
                            full name is on hover. */}
                        <button
                          type="button"
                          onClick={() => showRows(group)}
                          title={`${group.merchantRaw} · see these in All rows`}
                          className="flex min-w-0 text-left hover:underline"
                        >
                          <Bidi className="min-w-0 truncate">{group.merchantRaw}</Bidi>
                        </button>
                        {/* "looks like" is ours and the neighbour is a document's:
                            the name is its own isolated span, so a Hebrew one
                            truncates from its own end and keeps its start (M28 F21). */}
                        <small title={why} className="flex min-w-0 gap-x-1 text-caption text-ink-secondary">
                          {hint === undefined && suggestion !== undefined ? (
                            <>
                              <span className="shrink-0">looks like</span>
                              <Bidi className="min-w-0 truncate">{suggestion.neighbour}</Bidi>
                            </>
                          ) : (
                            <Bidi className="min-w-0 truncate">{why}</Bidi>
                          )}
                        </small>
                      </span>
                      <span className="text-right font-mono text-caption text-ink-secondary">{group.count}×</span>
                      <span className="text-right tabular-nums whitespace-nowrap">
                        {group.totals.map((total) => (
                          <span key={total.currency} className="block">
                            {/* What went out; a name that only ever paid in shows what came in. */}
                            {total.outflowMinor > 0 || total.inflowMinor === 0
                              ? formatMoney(money(-total.outflowMinor, total.currency))
                              : `+${formatMoney(money(total.inflowMinor, total.currency))}`}
                          </span>
                        ))}
                      </span>
                      <span className="col-span-full min-w-0 pb-1.5 @[46rem]:col-span-1 @[46rem]:pb-0">
                        <CategoryPicker
                          categories={data.categories}
                          value={guess}
                          onChange={(categoryId) =>
                            setPicked((current) => {
                              const { [group.merchantNormalized]: _gone, ...rest } = current
                              return categoryId === undefined ? rest : { ...rest, [group.merchantNormalized]: categoryId }
                            })
                          }
                          label={`Category for all ${group.count} transactions at ${group.merchantRaw}`}
                          placeholder="Choose a category"
                          outlined
                          tour="merchant-category"
                        />
                      </span>
                      <span className="col-span-full flex items-center justify-end gap-1 pb-2 @[46rem]:col-span-1 @[46rem]:pb-0">
                        <label
                          className="mr-1 inline-flex cursor-pointer items-center gap-1.5 text-caption text-ink-secondary select-none"
                          title="Make a rule as you confirm, so next month’s are categorized on import"
                        >
                          <input
                            type="checkbox"
                            checked={ruleTicked}
                            onChange={() =>
                              setNoRule((current) => {
                                const next = new Set(current)
                                if (next.has(group.merchantNormalized)) next.delete(group.merchantNormalized)
                                else next.add(group.merchantNormalized)
                                return next
                              })
                            }
                            className="size-3.5 accent-[var(--color-accent)]"
                          />
                          rule
                        </label>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="check"
                          disabled={guess === undefined}
                          title={guess === undefined ? 'Choose a category first' : `Put all ${group.count} in ${categoryPath(guess) ?? ''}`}
                          onClick={() => file(group, guess)}
                          data-tour="merchant-confirm"
                        >
                          Confirm
                        </Button>
                        {canPayCard(group) && (
                          <IconButton
                            label={
                              data.aliases.has(group.merchantNormalized)
                                ? 'Pays a card (P) — change'
                                : 'This pays a card (P)'
                            }
                            dataPaysCard
                            active={data.aliases.has(group.merchantNormalized)}
                            onClick={(event) => {
                              const box = event.currentTarget.getBoundingClientRect()
                              cursor.set(index)
                              setCardMenu({ group, at: { x: box.left, y: box.bottom + 2 } })
                            }}
                          >
                            <ActionGlyph name="card" size={15} />
                          </IconButton>
                        )}
                        <IconButton label="Skip for now (S)" onClick={() => skip(group)}>
                          <ActionGlyph name="skip" size={15} />
                        </IconButton>
                        <IconButton
                          label="More (right-click)"
                          onClick={(event) => {
                            const box = event.currentTarget.getBoundingClientRect()
                            cursor.set(index)
                            openMenu(group, { x: box.right - 4, y: box.bottom + 2 })
                          }}
                        >
                          <ActionGlyph name="more" size={15} />
                        </IconButton>
                      </span>
                      {expanded === group.merchantNormalized && charges !== undefined && (
                        <div className="fc-pop-enter col-span-full flex flex-col pb-2 pl-1 text-caption text-ink-secondary">
                          {charges.rows.map((row) => (
                            <div key={row.id} className="flex max-w-md justify-between gap-6 border-t border-hairline py-1">
                              <span className="font-mono">{row.transactionDate.year}-{String(row.transactionDate.month).padStart(2, '0')}-{String(row.transactionDate.day).padStart(2, '0')}</span>
                              <b className="font-medium tabular-nums text-ink">{formatMoney(row.amount)}</b>
                            </div>
                          ))}
                          {charges.total > charges.rows.length && (
                            <span className="pt-1">and {charges.total - charges.rows.length} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                </Flip>
              )}

              {groups.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-3 text-caption text-ink-secondary">
                  <span><Kbd>J</Kbd> <Kbd>K</Kbd> move</span>
                  <span><Kbd>Enter</Kbd> confirm</span>
                  <span><Kbd>C</Kbd> change the category</span><span><Kbd>P</Kbd> pays a card</span>
                  <span><Kbd>S</Kbd> skip</span>
                  <span><Kbd>Space</Kbd> show its charges</span>
                  <span><Kbd>≡</Kbd> or right-click: everything else</span>
                  {usual.length > 0 && (
                    <span>
                      <Kbd>1</Kbd>–<Kbd>{usual.length}</Kbd> categorize into the categories on the right
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {usual.length > 0 && (
            <aside className="flex flex-col gap-0.5 @[56rem]:sticky @[56rem]:top-0" aria-label="Your usual categories">
              <span className="fc-label px-2 pb-1.5 text-ink-secondary uppercase">Your usual categories</span>
              {usual.map((category, slot) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => {
                    const group = groups[cursor.index]
                    if (group !== undefined) file(group, category.id)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setOver(`cat:${category.id}`)
                  }}
                  onDragLeave={() => setOver(undefined)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setOver(undefined)
                    const group = groups.find((one) => one.merchantNormalized === dragging.current)
                    dragging.current = undefined
                    if (group !== undefined) file(group, category.id)
                  }}
                  className={`flex h-[30px] items-center justify-between gap-2 border px-2 text-left text-[13px] transition-colors duration-[var(--duration-micro)] hover:border-accent hover:bg-accent-soft ${
                    over === `cat:${category.id}` ? 'border-accent bg-accent-soft' : 'border-transparent'
                  }`}
                >
                  <CategoryMark color={palette.colorOf(category.id)}>
                    {category.name}
                  </CategoryMark>
                  <span className="font-mono text-[10px] text-ink-tertiary">{slot + 1}</span>
                </button>
              ))}
              <p className="m-0 px-2 pt-3 text-caption text-ink-secondary">
                Drag a merchant onto one of these, or press its number. The six most used.
              </p>
            </aside>
          )}
        </div>
      </div>

      {cardMenu !== undefined && (
        <ContextMenu
          at={cardMenu.at}
          items={cardItems(cardMenu.group)}
          onClose={() => setCardMenu(undefined)}
          header={{
            title: 'This pays a card',
            sub: <Bidi>{cardMenu.group.merchantRaw}</Bidi>,
          }}
        />
      )}

      {menu !== undefined && (
        <ContextMenu
          at={menu.at}
          items={menuItems(menu.group)}
          onClose={() => setMenu(undefined)}
          header={{
            title: <Bidi>{menu.group.merchantRaw}</Bidi>,
            sub: `${menu.group.count} charges with no category`,
          }}
        />
      )}
    </div>
  )
}

interface Scope {
  readonly accountId: string
  readonly period: string
}

const EVERYTHING: Scope = { accountId: '', period: '' }

/** One filing this sitting, with what it takes to undo it. */
interface Filing {
  readonly key: string
  readonly merchantRaw: string
  readonly categoryId: string
  readonly categoryPath: string
  readonly count: number
  readonly filed: readonly FiledRow[]
  /** The rule it made, if it made one. */
  readonly ruleId: string | undefined
}

type Promoted =
  | { readonly kind: 'BILL'; readonly name: string }
  | { readonly kind: 'DEBT'; readonly name: string; readonly created: number; readonly ambiguous: number }

const LINK =
  'text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover'

function toFilter(scope: Scope): TransactionFilter {
  const bounds = scope.period === '' ? undefined : monthRange(scope.period)
  return {
    accountId: scope.accountId === '' ? undefined : scope.accountId,
    from: bounds?.from,
    to: bounds?.to,
  }
}

function Hero({
  label,
  first = false,
  children,
}: {
  readonly label: string
  readonly first?: boolean
  readonly children: React.ReactNode
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 px-4 py-3.5 ${first ? 'pl-0' : ''}`}>
      <span className="fc-label text-ink-secondary uppercase">{label}</span>
      {children}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
  dataPaysCard = false,
  active = false,
}: {
  readonly label: string
  readonly dataPaysCard?: boolean
  readonly active?: boolean
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  readonly children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      {...(dataPaysCard ? { 'data-pays-card': '' } : {})}
      className={`flex size-7 items-center justify-center ${active ? 'text-positive' : 'text-ink-secondary'} transition-colors duration-[var(--duration-micro)] hover:bg-surface hover:text-ink`}
    >
      {children}
    </button>
  )
}

function Empty({
  scoped,
  imported,
  onClear,
}: {
  readonly scoped: boolean
  readonly imported: boolean
  readonly onClear: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-2 py-10 text-ink-secondary">
      {scoped ? (
        <>
          <p className="m-0">Nothing in this account or month is waiting for a category.</p>
          <Button variant="secondary" size="sm" onClick={onClear}>
            Look at everything
          </Button>
        </>
      ) : imported ? (
        <>
          <b className="text-[16px] font-medium text-ink">Everything is categorized.</b>
          <span>The month’s totals on Home now cover every row.</span>
        </>
      ) : (
        <p className="m-0 max-w-md">
          Nothing imported yet. Read a statement on Home — whatever the rules cannot place lands here, grouped by shop.
        </p>
      )}
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
