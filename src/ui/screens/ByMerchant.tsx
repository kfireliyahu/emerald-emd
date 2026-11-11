import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { formatMoney, money } from '@/core/money.ts'
import { monthRange } from '@/core/time.ts'
import { listAccounts, setExcludeSettlementsFromStats } from '@/data/repositories/accountRepository.ts'
import {
  correctCategories,
  undoCorrections,
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
import { commitReapply, listReapplyCandidates, undoReapply } from '@/data/repositories/reapplyRepository.ts'
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
  sectionsByProvider,
  settledCount,
  type GroupOrder,
  type MerchantGroup,
  type ProviderSection,
} from '@/domain/merchantGroups.ts'
import { planReapply } from '@/domain/reapply.ts'
import { asRule, draftFromMerchant, draftFromProviderCategory } from '@/domain/ruleEditing.ts'
import { suggestFromHistory, type MerchantSuggestion } from '@/domain/suggest.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { countKey } from '@/i18n/count.ts'
import { useLanguage, useT, type Translate } from '@/i18n/current.ts'
import { fillNodes } from '@/i18n/nodes.tsx'
import { Flip } from '@/ui/motion/Flip.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { PromotionPanel, type BillPromotion } from '@/ui/categorize/PromotionPanel.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryMark, useCategoryPalette } from '@/ui/components/CategoryMark.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { ChoiceMenu, type Choice } from '@/ui/components/ChoiceField.tsx'
import { ContextMenu, isMenuKey, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'
import { FilterButton, FilterRow } from '@/ui/components/FilterButton.tsx'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { useFilePicker, useReadFiles } from '@/ui/home/parts.tsx'
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
  // The empty state's one action (M59 U6): Read files, as Home's band does it.
  const picker = useFilePicker(useReadFiles())
  const navigate = useNavigate()
  const { t, path: pathText, iso } = useWords()

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
  /** The list under the provider's headings rather than one list (M59 U3). */
  const [byProvider, setByProvider] = useState(false)
  /** The category chosen on a heading but not yet made a rule, by provider category. */
  const [pickedHeading, setPickedHeading] = useState<Readonly<Record<string, string>>>({})
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
    const ordered = orderGroups(queue.waiting, order)
    // Under the provider's headings the cursor walks the list as it is drawn:
    // heading by heading, each heading's merchants in the chosen order.
    const sections = byProvider ? sectionsByProvider(ordered) : undefined
    return {
      // Skipped names are split off by `merchantQueue`, not in SQL: a skip is a fact
      // about the *queue*, not about the rows, and the ledger must keep showing
      // them (D-065).
      groups: sections === undefined ? ordered : sections.flatMap((section) => section.groups),
      sections,
      /** Whether the provider named any of it — a bank statement names nothing (M59 U3). */
      providerNamed: queue.waiting.some((group) => group.providerCategories.length > 0),
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
  }, [db, revision, scope, order, byProvider])

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
    const made = ruleId
    remember({
      message: fillNodes(t(made === undefined ? 'merchants.filings.noRule' : 'merchants.filings.withRule'), {
        count: done.changed,
        merchant: <Bidi>{group.merchantRaw}</Bidi>,
        path: (
          <b className="font-medium">
            <Bidi>{pathText(data.paths.get(categoryId) ?? t('merchants.filings.aCategory'))}</Bidi>
          </b>
        ),
      }),
      undoLabel: t(made === undefined ? 'merchants.filings.undo' : 'merchants.filings.undoBoth'),
      undo: (database) => {
        undoCorrections(database, done.filed, categoryId)
        if (made !== undefined) deleteRule(database, made, Date.now())
      },
    })
  }

  /** Keep one write of the sitting, newest first, with what takes it back. */
  const remember = (filing: Omit<Filing, 'key'>): void => {
    setFilings((current) => [{ key: newId(), ...filing }, ...current])
  }

  /** Take one filing back — whatever it wrote. */
  const undo = (filing: Filing): void => {
    mutate((database) => filing.undo(database))
    setFilings((current) => current.filter((one) => one.key !== filing.key))
  }

  /**
   * **One rule for a whole heading** (M59 U3, D-579): every row the provider
   * calls this goes to the category, now and on every import. Applied at once,
   * but only to rows with no category — the backlog this screen is — through
   * the same re-apply `create_rule` commits with, so one Undo puts the rows back
   * where they were and takes the rule away.
   */
  const fileProvider = (section: ProviderSection, categoryId: string | undefined): void => {
    const provider = section.provider
    if (provider === undefined || categoryId === undefined || data === undefined) return
    let ruleId: string | undefined
    let runId: string | undefined
    let changed = 0
    mutate((database) => {
      const now = Date.now()
      const shaped = asRule(draftFromProviderCategory(provider, categoryId))
      // A second press before the heading leaves (a double click) writes no
      // second rule: the one the first press made already says this.
      const rules = loadRules(database)
      if (
        rules.some(
          (rule) =>
            rule.origin !== 'BUILT_IN' &&
            rule.kind === 'PROVIDER_CATEGORY' &&
            rule.pattern === shaped.pattern &&
            rule.targetCategoryId === categoryId,
        )
      ) {
        return
      }
      ruleId = createRule(
        database,
        {
          name: shaped.name,
          kind: shaped.kind,
          pattern: shaped.pattern,
          targetCategoryId: shaped.targetCategoryId,
          conditions: shaped.conditions,
          origin: 'USER',
        },
        now,
      ).id
      const plan = planReapply(loadRules(database), listReapplyCandidates(database, { uncategorized: true }))
      // Only what this rule decides: a row an older rule outranks it on is that
      // rule's business, and the sentence below claims these rows for this one.
      const mine = { ...plan, changes: plan.changes.filter((change) => change.ruleId === ruleId) }
      const run = commitReapply(database, mine, `By merchant: ${shaped.name}`, now)
      runId = run?.id
      changed = run?.changedCount ?? 0
    })
    const made = ruleId
    if (made === undefined) return
    const run = runId
    setPickedHeading((current) => {
      const { [provider]: _gone, ...rest } = current
      return rest
    })
    const path = (
      <b className="font-medium">
        <Bidi>{pathText(data.paths.get(categoryId) ?? t('merchants.filings.aCategory'))}</Bidi>
      </b>
    )
    remember({
      message: fillNodes(t(changed === 0 ? 'merchants.filings.headingRuleOnly' : 'merchants.filings.headingFiled'), {
        count: changed,
        provider: <Bidi>{provider}</Bidi>,
        path,
      }),
      undoLabel: t('merchants.filings.undoBoth'),
      undo: (database) => {
        const now = Date.now()
        if (run !== undefined) undoReapply(database, run, now)
        deleteRule(database, made, now)
      },
    })
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

  /** Out of every total, and so out of this queue (D-579) — with an Undo, since the row leaves. */
  const leaveOut = (group: MerchantGroup): void => {
    let ids: readonly string[] = []
    mutate((database) => {
      const now = Date.now()
      ids = merchantGroupIds(database, group.merchantNormalized, toFilter(scope))
      for (const id of ids) setExcludedFromStats(database, id, true, now)
    })
    const left = ids
    if (left.length === 0) return
    remember({
      message: fillNodes(t('merchants.filings.leftOut'), {
        count: left.length,
        merchant: <Bidi>{group.merchantRaw}</Bidi>,
      }),
      undoLabel: t('merchants.filings.undo'),
      undo: (database) => {
        const now = Date.now()
        for (const id of left) setExcludedFromStats(database, id, false, now)
      },
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

  /** What the provider called most of this merchant's rows, if the file said. */
  const providerOf = (group: MerchantGroup): string | undefined => group.providerCategories[0]?.value

  /**
   * The rule draft Transactions opens from a row's provider category — the
   * same draft, the same editor (M59 U3) — with the category this row would
   * be filed under already in it.
   */
  const ruleFromProvider = (group: MerchantGroup): void => {
    const provider = providerOf(group)
    if (provider === undefined) return
    navigate('/categories/rules', { state: { draft: draftFromProviderCategory(provider, choiceOf(group)) } })
  }

  /** What a heading's rule would file into unless one is picked: the category most of its merchants would go to. */
  const headingChoice = (section: ProviderSection): string | undefined => {
    if (section.provider !== undefined && pickedHeading[section.provider] !== undefined) {
      return pickedHeading[section.provider]
    }
    const votes = new Map<string, number>()
    for (const group of section.groups) {
      const choice = choiceOf(group)
      if (choice !== undefined) votes.set(choice, (votes.get(choice) ?? 0) + group.count)
    }
    let best: string | undefined
    for (const [id, count] of votes) {
      if (best === undefined || count > (votes.get(best) ?? 0) || (count === votes.get(best) && id < best)) best = id
    }
    return best
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
    return <Centered>{t('merchants.noDocument')}</Centered>
  }

  const waiting = groups.reduce((total, group) => total + group.count, 0)
  const placed = baseline === 0 ? 0 : Math.round((100 * (baseline - leftMinor)) / baseline)
  const confident = data.suggestions.filter((one) => one.confident)
  const promotingGroup = groups.find((group) => group.merchantNormalized === promoting)
  const categoryPath = (id: string): string | undefined => {
    const path = data.paths.get(id)
    return path === undefined ? undefined : pathText(path)
  }
  const suggestionFor = (group: MerchantGroup): MerchantSuggestion | undefined =>
    data.suggestions.find((one) => one.merchantNormalized === group.merchantNormalized)

  const openMenu = (group: MerchantGroup, at: { x: number; y: number }): void => setMenu({ group, at })
  /** Each merchant's place in the list the cursor walks, headings or not. */
  const indexOf = new Map(groups.map((group, index) => [group.merchantNormalized, index]))

  const accountChoices: readonly Choice[] = [
    { value: '', label: t('merchants.header.allAccounts') },
    ...data.accounts.map((account) => ({ value: account.id, label: accountLabel(account) })),
  ]
  const monthChoices: readonly Choice[] = [
    { value: '', label: t('merchants.header.allMonths') },
    ...data.months.map((period) => ({ value: period, label: period })),
  ]

  const cards = data.accounts.filter((one) => one.kind === 'CREDIT_CARD')
  const canPayCard = (group: MerchantGroup): boolean => cards.length > 0 && data.bank.has(group.merchantNormalized)
  const cardItems = (group: MerchantGroup): readonly MenuItem[] => {
    const alias = data.aliases.get(group.merchantNormalized)
    return [
      ...cards.map((card) => ({
        label: card.id === alias ? t('merchants.menu.cardNow', { card: iso(card.name) }) : card.name,
        onChoose: () => setPayer(group, card.id),
      })),
      ...(alias === undefined
        ? []
        : [{ label: t('merchants.menu.notCardPayment'), separated: true, onChoose: () => setPayer(group, undefined) }]),
    ]
  }

  const menuItems = (group: MerchantGroup): readonly MenuItem[] => {
    const hint = choiceOf(group)
    const items: MenuItem[] = []
    if (hint !== undefined) {
      items.push({
        icon: 'check',
        label: t('merchants.menu.confirmAllAs', {
          count: group.count,
          path: iso(categoryPath(hint) ?? t('merchants.menu.theGuess')),
        }),
        shortcut: 'Enter',
        onChoose: () => file(group, hint),
      })
    }
    items.push({
      icon: 'cat',
      label: t('merchants.menu.categorizeAllAs', { count: group.count }),
      submenu: [
        ...usual.map((one, slot) => ({
          label: (
            <CategoryMark color={palette.colorOf(one.id)}>
              {pathText(one.path)}
            </CategoryMark>
          ),
          shortcut: String(slot + 1),
          onChoose: () => file(group, one.id),
        })),
        {
          label: t('merchants.menu.allCategories'),
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
        label: t('merchants.menu.paysCard'),
        detail: t('merchants.menu.paysCardDetail'),
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
      label: t('merchants.menu.skip'),
      detail: t('merchants.menu.skipDetail'),
      shortcut: 'S',
      onChoose: () => skip(group),
    })
    items.push(
      {
        icon: 'eyeoff',
        label: t('merchants.menu.leaveOut', { count: group.count }),
        detail: t('merchants.menu.leaveOutDetail'),
        separated: true,
        onChoose: () => leaveOut(group),
      },
      {
        icon: 'bill',
        label: t('merchants.menu.bill'),
        detail: t('merchants.menu.billDetail'),
        shortcut: 'T',
        onChoose: () => openPromotion(group),
      },
      { icon: 'debt', label: t('merchants.menu.debt'), onChoose: () => openPromotion(group) },
      {
        icon: 'rule',
        label: fillNodes(t('merchants.menu.writeRule'), { merchant: <Bidi>{group.merchantRaw}</Bidi> }),
        separated: true,
        onChoose: () =>
          navigate('/categories/rules', { state: { draft: draftFromMerchant(group.merchantNormalized, hint) } }),
      },
      // The broad one, as on Transactions (M59 U3): what the provider called
      // these rows, behind the editor, where its reach is on screen before it
      // is saved (D-042).
      ...(providerOf(group) === undefined
        ? []
        : [
            {
              icon: 'rule' as const,
              label: fillNodes(t('merchants.menu.ruleFrom'), { provider: <Bidi>{providerOf(group)}</Bidi> }),
              detail: t('merchants.menu.ruleFromDetail'),
              onChoose: () => ruleFromProvider(group),
            },
          ]),
      { icon: 'filter', label: t('merchants.menu.showRows'), onChoose: () => showRows(group) },
      {
        icon: 'cat',
        label: t('merchants.menu.showCharges'),
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
            <span className="fc-label text-ink-secondary uppercase">{t('merchants.header.eyebrow')}</span>
            <h1 className="m-0 text-title font-medium">{t('merchants.header.title')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ViewSwitch view="merchants" waiting={groups.length} />
            {/* **Account and Month behind Filter** (M59 U6, D-582), as on All
                rows; the order is the list's, on its own header row. */}
            {data.ledger > 0 && (
              <FilterButton
                align="end"
                label={t('merchants.header.filter')}
                on={(scope.accountId === '' ? 0 : 1) + (scope.period === '' ? 0 : 1)}
              >
                <FilterRow label={t('merchants.header.account')}>
                  <Menu label={t('merchants.header.account')} value={scope.accountId} choices={accountChoices} onPick={(accountId) => setScope({ ...scope, accountId })} />
                </FilterRow>
                <FilterRow label={t('merchants.header.month')}>
                  <Menu label={t('merchants.header.month')} value={scope.period} choices={monthChoices} onPick={(period) => setScope({ ...scope, period })} />
                </FilterRow>
              </FilterButton>
            )}
            {(data.providerNamed || byProvider) && (
              <label
                className="flex cursor-pointer items-center gap-2 text-body text-ink-secondary select-none"
                title={t('merchants.header.byProviderHint')}
              >
                <input
                  type="checkbox"
                  checked={byProvider}
                  onChange={() => setByProvider((current) => !current)}
                  className={CHECK}
                />
                {t('merchants.header.byProvider')}
              </label>
            )}
            {/* *Skip all n* behind More (M59 U6, D-582): one press sets every
                name aside, which a new person should not meet first. */}
            {picker.input}
            {groups.length > 0 && (
              <PageMenu
                title={t('merchants.header.pageMenu')}
                items={[
                  {
                    label: t('merchants.header.skipAll', { count: groups.length }),
                    detail: t('merchants.header.skipAllDetail'),
                    onChoose: () =>
                      mutate((database) =>
                        void skipAll(database, groups.map((group) => group.merchantNormalized), Date.now()),
                      ),
                  },
                ]}
              />
            )}
          </div>
        </header>

        {/* **Two tiles** (M59 U6, D-582): what waits, and what this sitting
            placed. The red-at-nothing *Without a category* went with its tile
            (M54 U5's row); its sum is a line under Waiting. Nothing read yet,
            nothing to count. */}
        {data.ledger > 0 && (
          <div className="grid grid-cols-2 divide-x divide-hairline border-y border-hairline">
            <Hero label={t('merchants.tiles.waiting')} first>
              <b className="text-secondary-number font-medium tabular-nums">
                {t(countKey('merchants.tiles.names', groups.length), { count: groups.length })}
              </b>
              <small className="text-caption text-ink-secondary tabular-nums">
                {t(countKey('merchants.tiles.charges', waiting), {
                  count: waiting,
                  amount: formatMoney(money(leftMinor, data.currency)),
                })}
              </small>
            </Hero>
            <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5">
              <span className="fc-label text-ink-secondary uppercase">{t('merchants.tiles.sitting')}</span>
              <b className="text-secondary-number font-medium tabular-nums">{placed}%</b>
              <div className="h-1 bg-hairline" aria-hidden>
                <i className="block h-full bg-accent transition-[width] duration-[var(--duration-base)]" style={{ width: `${placed}%` }} />
              </div>
              <small className="text-caption text-ink-secondary">
                {t('merchants.tiles.placed', {
                  done: formatMoney(money(baseline - leftMinor, data.currency)),
                  total: formatMoney(money(baseline, data.currency)),
                })}
              </small>
            </div>
          </div>
        )}

        {filings.length > 0 && (
          <section
            aria-label={t('merchants.tiles.sitting')}
            aria-live="polite"
            className="fc-pop-enter flex flex-col bg-accent-soft"
          >
            {filings.slice(0, 5).map((filing) => (
              <div key={filing.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
                <ActionGlyph name="check" />
                <span className="min-w-0 flex-1">{filing.message}</span>
                <Button variant="ghost" size="sm" onClick={() => undo(filing)}>
                  {filing.undoLabel}
                </Button>
              </div>
            ))}
            {filings.length > 5 && (
              <p className="px-3.5 pb-2 text-caption text-ink-secondary">
                {t('merchants.filings.earlier', { count: filings.length - 5 })}
              </p>
            )}
          </section>
        )}

        {promoted !== undefined && (
          <section
            aria-label={t('merchants.promoted.label')}
            aria-live="polite"
            className="fc-pop-enter flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-3.5 py-2.5"
          >
            <p className="m-0">
              {promoted.kind === 'BILL' ? (
                <>
                  {fillNodes(t('merchants.promoted.bill'), {
                    name: <Bidi className="font-medium">{promoted.name}</Bidi>,
                  })}{' '}
                  <Link to="/plan" className={LINK}>
                    {t('merchants.promoted.seeOnPlan')}
                  </Link>
                </>
              ) : (
                <>
                  {fillNodes(t('merchants.promoted.watches'), {
                    name: <Bidi className="font-medium">{promoted.name}</Bidi>,
                  })}{' '}
                  {promoted.created === 0 ? (
                    <span className="text-ink-secondary">{t('merchants.promoted.nothingFound')}</span>
                  ) : (
                    fillNodes(t(countKey('merchants.promoted.waiting', promoted.created)), {
                      count: <span className="tabular-nums">{promoted.created}</span>,
                    })
                  )}
                  {promoted.ambiguous > 0 && (
                    <>
                      {' '}
                      {fillNodes(t(countKey('merchants.promoted.ambiguous', promoted.ambiguous)), {
                        count: <span className="tabular-nums">{promoted.ambiguous}</span>,
                      })}
                    </>
                  )}{' '}
                  <Link to="/wealth/debts" className={LINK}>
                    {t('merchants.promoted.answerOnDebts')}
                  </Link>
                </>
              )}
            </p>
            <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setPromoted(undefined)}>
              {t('merchants.promoted.dismiss')}
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
              {fillNodes(t(countKey('merchants.identified.found', confident.length)), {
                count: <span className="font-medium tabular-nums">{confident.length}</span>,
              })}{' '}
              <span className="text-ink-secondary">{t('merchants.identified.hint')}</span>
            </p>
            <Button variant="secondary" size="sm" icon="check" onClick={() => acceptAll(confident)}>
              {t(countKey('merchants.identified.save', confident.length), { count: confident.length })}
            </Button>
          </section>
        )}

        <div className="grid grid-cols-1 items-start gap-6 @[56rem]:grid-cols-[minmax(0,1fr)_15.5rem]">
          <div className="min-w-0" data-guide="tx.merchant">
            {data.ledger > 0 && (
            <div className="flex items-center justify-between border-b border-hairline pb-2 text-caption text-ink-secondary">
              <span className="fc-label uppercase">{t('merchants.list.merchant')}</span>
              <span className="flex items-center gap-4">
                {data.skippedGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowSkipped((current) => !current)}
                    className={`tabular-nums ${showSkipped ? 'text-ink underline underline-offset-4' : 'hover:text-ink'}`}
                  >
                    {t('merchants.list.skipped', { count: data.skippedGroups.length })}
                  </button>
                )}
                {/* The order is the list's, so it sits on the list (M59 U6, D-582). */}
                <Menu label={t('merchants.list.order')} value={order} choices={orders(t)} onPick={(value) => setOrder(value as GroupOrder)} />
              </span>
            </div>
            )}

            {showSkipped && data.skippedGroups.length > 0 && (
              <section className="fc-pop-enter border-b border-hairline bg-surface px-3 py-3">
                <p className="m-0 text-ink-secondary">{t('merchants.list.skippedNote')}</p>
                <ul className="m-0 mt-1.5 list-none p-0">
                  {data.skippedGroups.map((group) => (
                    <li key={group.merchantNormalized} className="flex flex-wrap items-baseline gap-x-3 border-t border-hairline py-1">
                      <Bidi className="text-ink">{group.merchantRaw}</Bidi>
                      <span className="text-ink-tertiary tabular-nums">
                        {t(countKey('merchants.list.transactions', group.count), { count: group.count })}
                      </span>
                      <button
                        type="button"
                        onClick={() => unskip(group)}
                        className="ms-auto text-caption text-ink-secondary hover:text-ink"
                      >
                        {t('merchants.list.putBack')}
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
              aria-label={t('merchants.list.label')}
            >
              {groups.length === 0 ? (
                <Empty
                  scoped={scope.accountId !== '' || scope.period !== ''}
                  imported={data.ledger > 0}
                  onClear={() => setScope(EVERYTHING)}
                  onRead={picker.open}
                />
              ) : (
                // A merchant filed or skipped leaves the queue, and the ones below
                // close up (M39, src/ui/motion/). A wrapper with no box of its own,
                // so the cursor's container and its rows are as they were.
                // Keyed by the grouping, so turning the headings on or off is a
                // list replaced, which snaps — never a crowd gliding (`ui` rule).
                <Flip
                  key={byProvider ? 'sections' : 'list'}
                  as="div"
                  className="contents"
                  flipKey={`${groups.map((group) => group.merchantNormalized).join('|')}|${expanded ?? ''}`}
                >
                {(data.sections ?? [undefined]).map((section) => (
                <Fragment key={section === undefined ? 'all' : `provider:${section.provider ?? ''}`}>
                {section !== undefined && (
                  <Heading
                    section={section}
                    currency={data.currency}
                    categories={data.categories}
                    choice={headingChoice(section)}
                    categoryPath={categoryPath}
                    onPick={(categoryId) => {
                      const provider = section.provider
                      if (provider === undefined) return
                      setPickedHeading((current) => {
                        const { [provider]: _gone, ...rest } = current
                        return categoryId === undefined ? rest : { ...rest, [provider]: categoryId }
                      })
                    }}
                    onFile={(categoryId) => fileProvider(section, categoryId)}
                  />
                )}
                {(section?.groups ?? groups).map((group) => {
                  const index = indexOf.get(group.merchantNormalized) ?? 0
                  const hint = dominantCategory(group)
                  const suggestion = suggestionFor(group)
                  const guess = choiceOf(group)
                  const on = cursor.index === index
                  const provider = providerOf(group)
                  const why =
                    hint !== undefined
                      ? `${t(countKey('merchants.row.earlier', hint.count), { count: hint.count })}${settledCount(group) > hint.count ? t('merchants.row.ofSettled', { count: settledCount(group) }) : ''}`
                      : suggestion !== undefined
                        ? t('merchants.row.looksLike', { name: iso(suggestion.neighbour) })
                        : provider === undefined
                          ? t('merchants.row.noPattern')
                          : undefined
                  const ruleTicked = !noRule.has(group.merchantNormalized)
                  return (
                    <div
                      key={group.merchantNormalized}
                      data-motion-key={group.merchantNormalized}
                      {...cursor.row(index)}
                      className={`fc-cursor-row grid min-h-12 ${ROW_GRID} border-b border-hairline px-2 transition-colors duration-[var(--duration-micro)] hover:bg-surface ${
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
                          title={t('merchants.row.seeInAllRows', { merchant: iso(group.merchantRaw) })}
                          className="flex min-w-0 text-start hover:underline"
                        >
                          <Bidi className="min-w-0 truncate">{group.merchantRaw}</Bidi>
                        </button>
                        {/* "looks like" is ours and the neighbour is a document's:
                            the name is its own isolated span, so a Hebrew one
                            truncates from its own end and keeps its start (M28 F21). */}
                        <small className="flex min-w-0 gap-x-1 text-caption text-ink-secondary">
                          {hint === undefined && suggestion !== undefined ? (
                            <span title={why} className="flex min-w-0 gap-x-1">
                              <span className="shrink-0">{t('merchants.row.looksLikeLead')}</span>
                              <Bidi className="min-w-0 truncate">{suggestion.neighbour}</Bidi>
                            </span>
                          ) : (
                            why !== undefined && (
                              <span title={why} className="flex min-w-0">
                                <Bidi className="min-w-0 truncate">{why}</Bidi>
                              </span>
                            )
                          )}
                          {/* What the provider called it, as the action it is
                              (M59 U3) — the rule draft Transactions opens. Under
                              the provider's headings the heading carries it. */}
                          {provider !== undefined && !byProvider && (
                            <>
                              {why !== undefined && (
                                <span aria-hidden className="shrink-0">
                                  ·
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  ruleFromProvider(group)
                                }}
                                title={t('merchants.row.ruleFromTitle', { provider: iso(provider) })}
                                className="flex min-w-0 shrink text-accent hover:underline"
                              >
                                <span className="shrink-0">{t('merchants.row.ruleFromOpen')}</span>
                                <Bidi className="min-w-0 truncate">{provider}</Bidi>
                                <span className="shrink-0">{t('merchants.row.ruleFromClose')}</span>
                              </button>
                            </>
                          )}
                        </small>
                      </span>
                      <span className="text-end font-mono text-caption text-ink-secondary">{group.count}×</span>
                      <span className="text-end tabular-nums whitespace-nowrap">
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
                          label={t('merchants.row.categoryFor', { count: group.count, merchant: iso(group.merchantRaw) })}
                          placeholder={t('merchants.row.chooseCategory')}
                          outlined
                          tour="merchant-category"
                        />
                      </span>
                      <span className="col-span-full flex items-center justify-end gap-1 pb-2 @[46rem]:col-span-1 @[46rem]:pb-0">
                        <label
                          className="me-1 inline-flex cursor-pointer items-center gap-1.5 text-caption text-ink-secondary select-none"
                          title={t('merchants.row.ruleHint')}
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
                            className={CHECK}
                          />
                          {t('merchants.row.rule')}
                        </label>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="check"
                          disabled={guess === undefined}
                          title={
                            guess === undefined
                              ? t('merchants.row.chooseFirst')
                              : t('merchants.row.putAllIn', { count: group.count, path: iso(categoryPath(guess) ?? '') })
                          }
                          onClick={() => file(group, guess)}
                          data-tour="merchant-confirm"
                        >
                          {t('merchants.row.confirm')}
                        </Button>
                        {canPayCard(group) && (
                          <IconButton
                            label={
                              data.aliases.has(group.merchantNormalized)
                                ? t('merchants.row.paysCardChange')
                                : t('merchants.row.paysCard')
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
                        <IconButton label={t('merchants.row.skip')} onClick={() => skip(group)}>
                          <ActionGlyph name="skip" size={15} />
                        </IconButton>
                        <IconButton
                          label={t('merchants.row.more')}
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
                        <div className="fc-pop-enter col-span-full flex flex-col pb-2 ps-1 text-caption text-ink-secondary">
                          {charges.rows.map((row) => (
                            <div key={row.id} className="flex max-w-md justify-between gap-6 border-t border-hairline py-1">
                              <span className="font-mono">{row.transactionDate.year}-{String(row.transactionDate.month).padStart(2, '0')}-{String(row.transactionDate.day).padStart(2, '0')}</span>
                              <b className="font-medium tabular-nums text-ink">{formatMoney(row.amount)}</b>
                            </div>
                          ))}
                          {charges.total > charges.rows.length && (
                            <span className="pt-1">{t('merchants.row.andMore', { count: charges.total - charges.rows.length })}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                </Fragment>
                ))}
                </Flip>
              )}

              {groups.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-3 text-caption text-ink-secondary">
                  <span><Kbd>{'J'}</Kbd> <Kbd>{'K'}</Kbd> {t('merchants.keys.move')}</span>
                  <span><Kbd>{'Enter'}</Kbd> {t('merchants.keys.confirm')}</span>
                  <span><Kbd>{'C'}</Kbd> {t('merchants.keys.change')}</span><span><Kbd>{'P'}</Kbd> {t('merchants.keys.paysCard')}</span>
                  <span><Kbd>{'S'}</Kbd> {t('merchants.keys.skip')}</span>
                  <span><Kbd>{'Space'}</Kbd> {t('merchants.keys.show')}</span>
                  <span><Kbd>≡</Kbd> {t('merchants.keys.menu')}</span>
                  {usual.length > 0 && (
                    <span>
                      <Kbd>1</Kbd>–<Kbd>{usual.length}</Kbd> {t('merchants.keys.usual')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {usual.length > 0 && (
            <aside className="flex flex-col gap-0.5 @[56rem]:sticky @[56rem]:top-0" aria-label={t('merchants.usual.title')}>
              <span className="fc-label px-2 pb-1.5 text-ink-secondary uppercase">{t('merchants.usual.title')}</span>
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
                  className={`flex h-8 items-center justify-between gap-2 border px-2 text-start text-body transition-colors duration-[var(--duration-micro)] hover:border-accent hover:bg-accent-soft ${
                    over === `cat:${category.id}` ? 'border-accent bg-accent-soft' : 'border-transparent'
                  }`}
                >
                  <CategoryMark color={palette.colorOf(category.id)}>
                    {category.name}
                  </CategoryMark>
                  <span className="font-mono text-label text-ink-secondary">{slot + 1}</span>
                </button>
              ))}
              <p className="m-0 px-2 pt-3 text-caption text-ink-secondary">
                {t('merchants.usual.hint')}
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
            title: t('merchants.menu.paysCardTitle'),
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
            sub: t('merchants.menu.chargesNoCategory', { count: menu.group.count }),
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

/**
 * One write of this sitting — a merchant filed, a heading made a rule, a
 * merchant left out of totals — with what it takes to undo it.
 */
interface Filing {
  readonly key: string
  /** What was done, as the sentence the notice says. */
  readonly message: React.ReactNode
  readonly undoLabel: string
  /** Puts back exactly what this write changed, and nothing written since. */
  readonly undo: (database: Database) => void
}

type Promoted =
  | { readonly kind: 'BILL'; readonly name: string }
  | { readonly kind: 'DEBT'; readonly name: string; readonly created: number; readonly ambiguous: number }

const LINK =
  'text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover'

/** A merchant's row and a heading share their columns, so a heading's figures sit over its merchants'. */
const ROW_GRID =
  'grid-cols-[minmax(0,1fr)_3rem_6rem] items-center gap-x-3.5 @[46rem]:grid-cols-[minmax(4rem,1.5fr)_3rem_6rem_minmax(8rem,1.5fr)_auto]'

/**
 * **A provider category's heading** (M59 U3, D-579): its name, its merchants'
 * charges and outflow, and one rule for all of it — the category picked here,
 * or the one most of its merchants would be filed under. The merchants the
 * provider named nothing get a heading with nothing to act on: no rule from a
 * heading can reach a row with no provider category.
 */
function Heading({
  section,
  currency,
  categories,
  choice,
  categoryPath,
  onPick,
  onFile,
}: {
  readonly section: ProviderSection
  readonly currency: string
  readonly categories: readonly Category[]
  readonly choice: string | undefined
  readonly categoryPath: (id: string) => string | undefined
  readonly onPick: (categoryId: string | undefined) => void
  readonly onFile: (categoryId: string | undefined) => void
}) {
  const names = section.groups.length
  const outflow = section.groups.reduce(
    (sum, group) => sum + (group.totals.find((total) => total.currency === currency)?.outflowMinor ?? 0),
    0,
  )
  const provider = section.provider
  const { t, iso } = useWords()
  return (
    <div
      data-motion-key={`provider:${provider ?? ''}`}
      className={`grid min-h-12 ${ROW_GRID} border-b border-hairline px-2 pt-4`}
    >
      <span className="flex min-w-0 flex-col py-1.5">
        <h2 className="m-0 flex min-w-0 text-body font-medium">
          {provider === undefined ? t('merchants.heading.noProvider') : <Bidi className="min-w-0 truncate">{provider}</Bidi>}
        </h2>
        <small className="text-caption text-ink-secondary">
          {t(countKey('merchants.tiles.names', names), { count: names })}
          {provider === undefined ? t('merchants.heading.noneGiven') : ''}
        </small>
      </span>
      <span className="text-end font-mono text-caption text-ink-secondary">{section.count}×</span>
      <span className="text-end tabular-nums whitespace-nowrap">{formatMoney(money(-outflow, currency))}</span>
      {provider !== undefined && (
        <>
          <span className="col-span-full min-w-0 pb-1.5 @[46rem]:col-span-1 @[46rem]:pb-0">
            <CategoryPicker
              categories={categories}
              value={choice}
              onChange={onPick}
              label={t('merchants.heading.categoryFor', { provider: iso(provider) })}
              placeholder={t('merchants.row.chooseCategory')}
              outlined
            />
          </span>
          <span className="col-span-full flex items-center justify-end pb-2 @[46rem]:col-span-1 @[46rem]:pb-0">
            <Button
              variant="secondary"
              size="sm"
              icon="rule"
              disabled={choice === undefined}
              title={
                choice === undefined
                  ? t('merchants.row.chooseFirst')
                  : t('merchants.heading.ruleTitle', {
                      provider: iso(provider),
                      path: iso(categoryPath(choice) ?? t('merchants.heading.it')),
                    })
              }
              onClick={() => onFile(choice)}
            >
              {t('merchants.heading.createRule')}
            </Button>
          </span>
        </>
      )}
    </div>
  )
}

/** A checkbox is the system's, tinted ink (the `ui` rule). */
const CHECK = 'size-3.5 accent-[var(--color-ink)]'

function orders(t: Translate): readonly Choice[] {
  return [
    { value: 'COUNT', label: t('merchants.orders.count') },
    { value: 'AMOUNT', label: t('merchants.orders.amount') },
    { value: 'NAME', label: t('merchants.orders.name') },
  ]
}

/**
 * The screen's words (M60 U4, D-589): `t`, a category's path with its arrows
 * the way the page reads — `Living ← Groceries` in Hebrew — and a document's
 * value isolated inside a string the app writes (a title, a menu's line), so a
 * Hebrew name in an English sentence or an English one in a Hebrew sentence
 * keeps its own order. In English both are the value as it was.
 */
function useWords(): {
  readonly t: Translate
  readonly path: (path: string) => string
  readonly iso: (text: string) => string
} {
  const t = useT()
  const language = useLanguage()
  return useMemo(
    () => ({
      t,
      path: (path: string) => (language === 'he' ? path.replaceAll(' → ', ' ← ') : path),
      iso: (text: string) => (language === 'he' ? `\u2068${text}\u2069` : text),
    }),
    [t, language],
  )
}

/** One of the header's menus — what a platform `<select>` was (M54 U5's row, M59 U3). */
function Menu({
  label,
  value,
  choices,
  onPick,
}: {
  readonly label: string
  readonly value: string
  readonly choices: readonly Choice[]
  readonly onPick: (value: string) => void
}) {
  return (
    <ChoiceMenu
      className={`${SELECT} h-8 text-body`}
      aria-label={label}
      text={choices.find((each) => each.value === value)?.label ?? ''}
      choices={choices}
      onPick={(choice) => onPick(choice.value)}
    />
  )
}

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
    <div className={`flex min-w-0 flex-col gap-1 px-4 py-3.5 ${first ? 'ps-0' : ''}`}>
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
  onRead,
}: {
  readonly scoped: boolean
  readonly imported: boolean
  readonly onClear: () => void
  /** With nothing read (M59 U6, D-582): the one text action is Read files. */
  readonly onRead: () => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col items-start gap-2 py-10 text-ink-secondary">
      {scoped ? (
        <>
          <p className="m-0">{t('merchants.empty.scoped')}</p>
          <button type="button" onClick={onClear} className={LINK}>
            {t('merchants.empty.everything')}
          </button>
        </>
      ) : imported ? (
        <p className="m-0">{t('merchants.empty.done')}</p>
      ) : (
        <>
          <p className="m-0">{t('merchants.empty.none')}</p>
          <button type="button" onClick={onRead} className={LINK}>
            {t('merchants.empty.read')}
          </button>
        </>
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
