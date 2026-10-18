import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { formatMoney, fromMajorUnits, money, type Money } from '@/core/money.ts'
import {
  formatMonthShort,
  formatYearMonth,
  monthRange,
  parseYearMonth,
  toISODate,
  type LocalDate,
} from '@/core/time.ts'
import { downloadCsv, exportFileName } from '@/data/export/download.ts'
import { transactionsCsv } from '@/data/export/csv.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import {
  listAccounts,
  setExcludeSettlementsFromStats,
} from '@/data/repositories/accountRepository.ts'
import { rescanSettlements } from '@/data/importer/settlementScan.ts'
import {
  decideForCard,
  listSettlementLinks,
  listSettlementSummaries,
  setSettlementDecision,
} from '@/data/repositories/cardSettlementRepository.ts'
import {
  clearSettlementAlias,
  setSettlementAlias,
  settlementAliasMap,
} from '@/data/repositories/settlementAliasRepository.ts'
import {
  correctCategories,
  correctCategory,
  type Correction,
} from '@/data/repositories/categoryOverrideRepository.ts'
import {
  categoryTotals,
  countUncategorized,
  listCategories,
  usualCategories,
  type Category,
} from '@/data/repositories/categoryRepository.ts'
import { createRule } from '@/data/repositories/categoryRuleRepository.ts'
import { readSkipped } from '@/data/repositories/labelingQueueRepository.ts'
import { listMerchantGroups } from '@/data/repositories/merchantGroupRepository.ts'
import { loadRules } from '@/data/repositories/ruleSetRepository.ts'
import {
  commitReapply,
  listReapplyCandidates,
  undoReapply,
} from '@/data/repositories/reapplyRepository.ts'
import {
  DEFAULT_SORT,
  findTransactionById,
  listTransactionIds,
  listTransactions,
  monthlyTotals,
  setExcludedFromStats,
  setTransactionNote,
  summarizeTransactions,
  type SortColumn,
  type StoredTransaction,
  type TransactionFilter,
  type TransactionSort,
} from '@/data/repositories/transactionRepository.ts'
import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import { offerForCorrection, offerForDraft, pastRows, type LearningOffer as Offer } from '@/domain/learning.ts'
import { planReapply } from '@/domain/reapply.ts'
import {
  asRule,
  draftFromMerchant,
  draftFromProviderCategory,
  draftFromSelection,
  type RuleDraft,
} from '@/domain/ruleEditing.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Amount } from '@/ui/components/Amount.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { DetailPanel } from '@/ui/transactions/DetailPanel.tsx'
import {
  holdingQuantity,
  holdingsForRow,
  setTransactionHolding,
  transactionHoldingProblem,
  type HoldingQuantity,
} from '@/data/repositories/savingsRepository.ts'
import { LearningOffer } from '@/ui/transactions/LearningOffer.tsx'
import { setTransferDecisions, transferPairFor } from '@/data/repositories/transferPairRepository.ts'
import {
  FilterBar,
  isFiltered,
  NO_FILTERS,
  UNCATEGORIZED_OPTION,
  type FilterFields,
} from '@/ui/transactions/FilterBar.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { CategoryMark, useCategoryPalette } from '@/ui/components/CategoryMark.tsx'
import { ContextMenu, isMenuKey, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { Figure, Pager } from '@/ui/home/parts.tsx'
import { ViewSwitch } from '@/ui/transactions/ViewSwitch.tsx'
import { useRowCursor } from '@/ui/useRowCursor.ts'
import { Flip } from '@/ui/motion/Flip.tsx'
import { Reveal } from '@/ui/motion/Reveal.tsx'

/**
 * The ledger: what is actually in the document, where you narrow it down, and
 * where you categorize it.
 *
 * Read fresh on every revision rather than cached in the store — the database
 * is the source of truth, and at this data size a re-query is cheaper than
 * keeping a second copy correct. The filtering happens in SQL for the same
 * reason plus one more: the number at the top has to be the total of the whole
 * filter, and the list is capped.
 */
export function Transactions() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const location = useLocation()
  const [fields, setFields] = useState<FilterFields>(() => arrivedFilter(location.state))
  const [sort, setSort] = useState<TransactionSort>(DEFAULT_SORT)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  /**
   * The row menu: where it was asked for, which row, and what was selected at
   * the moment it was asked for (D-173).
   *
   * **The selection is captured here rather than read when an item is chosen**,
   * because opening the menu moves focus into it and a browser drops the
   * selection the moment it does. By the time somebody has read four items and
   * picked one, the words they highlighted are gone.
   */
  const [menu, setMenu] = useState<
    | {
        readonly row: StoredTransaction
        readonly at: { readonly x: number; readonly y: number }
        readonly selection: string
      }
    | undefined
  >()
  // Rows ticked for a bulk action, and the row a shift-click extends from.
  // Ids rather than indices: the list re-queries on every revision, and an
  // index into a list that has just changed is a selection of the wrong rows.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | undefined>()
  // The rule being offered after a correction, if any. The merchant travels
  // with it because the offer is about a row that may have scrolled away, and
  // the raw name is what the user read when they corrected it.
  const [offered, setOffered] = useState<
    { readonly offer: Offer; readonly merchantRaw: string } | undefined
  >()
  // What the offer's "also file the rows already here" did, and the run that can take it back.
  const [applied, setApplied] = useState<
    { readonly runId: string; readonly count: number } | undefined
  >()
  /** The row whose note is being typed, inline under it (M28 U6). */
  const [noteFor, setNoteFor] = useState<string | undefined>()
  /** Whether the first-time hint about highlighting is still to be shown (S5). */
  const [hintShown, setHintShown] = useState(false)
  const navigate = useNavigate()
  /** Opened on the newest month unless something arrived with a filter of its own. */
  const [settled, setSettled] = useState(() => location.state !== null && location.state !== undefined)

  // Consumed once, like the rules screen's arriving draft. Without this the
  // filter comes back when the user navigates away and presses Back, re-applying
  // a search they have already cleared.
  useEffect(() => {
    if (location.state !== null && location.state !== undefined) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate])

  const data = useMemo(() => {
    if (db === undefined) return undefined

    // The unfiltered ledger first: it decides which currency the amount boxes
    // are read in, and gives the header something to compare the filter to.
    const ledger = summarizeTransactions(db, {})
    const currency = ledger.totals[0]?.currency ?? 'ILS'
    const filter = toFilter(fields, currency)

    return {
      currency,
      total: ledger.count,
      // Carried out of the memo because the export has to leave with exactly
      // the filter the screen is showing, not one rebuilt beside it.
      filter,
      months: distinctPeriods(monthlyTotals(db)),
      accounts: listAccounts(db),
      categories: listCategories(db),
      // Which merchants the user has said pay a card (D-069). One small map for
      // the whole ledger rather than a lookup per opened row.
      settlementAliases: settlementAliasMap(db),
      // For the detail panel's provenance: which rule categorized the row, and
      // what that rule beat. Loaded whole, as everywhere — a rule set is tens
      // of rows and the ordering is the engine's, not an `ORDER BY`'s. The
      // built-ins come with it, so a row categorized by one is named rather
      // than reported as categorized by a rule that no longer exists.
      rules: loadRules(db),
      uncategorized: countUncategorized(db),
      // What is waiting in the view, and the names it is waiting under (the
      // switch's count): the rows filed fastest by merchant.
      uncategorizedInView: summarizeTransactions(db, { ...filter, uncategorized: true }).count,
      waitingNames: waitingNames(db),
      // Which bank rows are the same money as a card's rows (D-062), so a row
      // left out for that reason says so, and the card bills nobody has been
      // asked about yet (S2).
      settlementRows: new Set(listSettlementLinks(db).map((link) => link.bankTransactionId)),
      pendingBills: listSettlementSummaries(db, { decision: 'PENDING' }),
      usual: usualCategories(db, 6),
      rows: listTransactions(db, filter, 500, sort),
      summary: summarizeTransactions(db, filter),
      // Only for a single month: the strip is a breakdown of a period, and
      // "every category, all time" is a report rather than a strip (F10).
      byCategory: fields.period === undefined ? [] : categoryTotals(db, fields.period),
      selected: selectedId === undefined ? undefined : findTransactionById(db, selectedId),
      // What the selected row could have bought, and what that holds now (M30 U2).
      rowHoldings: selectedId === undefined ? [] : holdingsForRow(db, selectedId),
      heldNow: heldNowOf(db, selectedId),
      // The transfer the selected row is an end of, answered or not (M30 U3).
      transfer: selectedId === undefined ? undefined : transferPairFor(db, selectedId),
    }
  }, [db, revision, fields, selectedId, sort])

  // The rows nobody chose by hand, read once an offer is open: what the offer's
  // "also file the rows already here" is counted over (D-373).
  const candidates = useMemo(
    () => (db === undefined || offered === undefined ? [] : listReapplyCandidates(db)),
    [db, revision, offered],
  )

  /**
   * The keyboard's place in the ledger (D-130).
   *
   * `Enter` opens the detail panel, which is what clicking the merchant does,
   * and `x` ticks the row, which is what clicking its checkbox does. Nothing
   * here is a second implementation — the cursor only says *which* row the
   * existing handlers are about.
   */
  // **Above the early returns, because a hook has to be.** It was below them,
  // and going from an empty ledger to one with rows in it — opening a document
  // while standing here, or importing a first statement — changed the number of
  // hooks between two renders and threw the screen into `ScreenBoundary`.
  // Found by driving rather than by a test (D-173).
  const cursor = useRowCursor(data?.rows.length ?? 0, {
    onActivate: (index) => setSelectedId(data?.rows[index]?.id),
    keys: {
      // **X leaves the row out of the totals, or counts it again** (M28 U6), the
      // menu's own shortcut; the tick moved to Space, where a checkbox has always
      // kept it.
      x: (index) => {
        const row = data?.rows[index]
        if (row !== undefined) leaveOut([row.id], !row.isExcludedFromStats)
      },
      ' ': (index) => {
        const id = data?.rows[index]?.id
        if (id !== undefined) pick(id, false)
      },
      n: (index) => setNoteFor(data?.rows[index]?.id),
      c: () => {
        const trigger = cursor.element()?.querySelector('[aria-haspopup="listbox"]')
        if (trigger instanceof HTMLElement) trigger.click()
      },
    },
  })

  const palette = useCategoryPalette(data?.categories ?? [])

  // A month is what this screen shows (the design: *the month's rows,
  // paged like Home*), so it opens on the newest one that has rows; All months
  // stays one press away.
  const newest = data?.months[0]
  useEffect(() => {
    if (settled || newest === undefined) return
    setSettled(true)
    setFields((current) => (current.period === undefined ? { ...current, period: newest } : current))
  }, [settled, newest])

  if (data === undefined) {
    return <Centered>Open a document, or create one, to see what is in it.</Centered>
  }

  if (data.total === 0) {
    return (
      <Centered>
        Nothing imported yet. Drop a statement file on this window, check its columns, and read
        it.
      </Centered>
    )
  }

  /**
   * Categorize a row by hand — the only way a category is ever chosen here, and
   * the moment F03 learns from.
   *
   * The assignment is still `MANUAL` and still permanent (D-009); what is new is
   * that the override is recorded, and that the app asks whether it should have
   * seen this one coming. Whether there is anything worth asking is decided by
   * `offerForCorrection`, which is pure and knows nothing about this screen.
   */
  const assign = (transactionId: string, categoryId: string | undefined): void => {
    let correction: Correction | undefined
    mutate((database) => {
      correction = correctCategory(database, transactionId, categoryId, Date.now())
    })
    if (correction === undefined) {
      setOffered(undefined)
      return
    }

    const offer = offerForCorrection({
      subject: correction.subject,
      categoryId: correction.newCategoryId,
      corrections: correction.corrections ?? 0,
      // The rule set as it was a moment ago, which a correction cannot have
      // changed — the offer's question is whether a rule already says this.
      rules: data.rules,
    })
    setOffered(
      offer === undefined ? undefined : { offer, merchantRaw: correction.merchantRaw },
    )
  }

  /**
   * Accept the offer: one `LEARNED_FROM_CORRECTION` rule, at the end of its own
   * tier, below everything the user wrote themselves.
   *
   * The same shaping the rules screen does on save, because it is the same
   * object being saved — `asRule` is the one place a draft becomes a rule.
   *
   * `alsoPast` is the offer's "also file the rows already here" — ticked by
   * default when there are any (D-373), and counted by `pastRows` from the same
   * plan this makes. It is a re-apply **restricted to the rule just written**: the whole
   * ledger is scanned, because that is how the engine decides anything, and only
   * the rows this new rule actually wins are changed. A row where an existing
   * rule outranks it is left alone, which is correct rather than cautious — a
   * learned rule sits below every rule the user wrote by hand, and applying it
   * to the past should not quietly promote it.
   */
  const learn = (draft: RuleDraft, alsoPast: boolean): void => {
    const shaped = asRule(draft)
    const now = Date.now()
    let outcome: { readonly runId: string; readonly count: number } | undefined

    mutate((database) => {
      const created = createRule(
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
      )
      if (!alsoPast) return

      // Rules re-read after the insert, so the plan is made against the set the
      // user will actually be living with rather than the one from a moment ago.
      const whole = planReapply(loadRules(database), listReapplyCandidates(database))
      const mine = {
        scanned: whole.scanned,
        changes: whole.changes.filter((change) => change.ruleId === created.id),
      }
      const run = commitReapply(database, mine, `${created.name} — from a correction`, now)
      if (run !== undefined) outcome = { runId: run.id, count: run.changedCount }
    })

    setOffered(undefined)
    setApplied(alsoPast ? (outcome ?? { runId: '', count: 0 }) : undefined)
  }

  /**
   * Ask for a rule from a row — the menu's and the detail panel's — which is the
   * same offer a correction makes, not a trip to the editor (D-373).
   */
  const offerRule = (row: { readonly merchantNormalized: string; readonly merchantRaw: string }, draft: RuleDraft): void => {
    setApplied(undefined)
    setOffered({ offer: offerForDraft(row.merchantNormalized, draft), merchantRaw: row.merchantRaw })
  }

  /** Take back the rows the offer filed. The rule itself stays. */
  const undoPast = (): void => {
    if (applied === undefined || applied.runId === '') return
    mutate((database) => undoReapply(database, applied.runId, Date.now()))
    setApplied(undefined)
  }

  /**
   * Give one category to every ticked row.
   *
   * The same writer bulk categorize uses, so a selection and a merchant group
   * are audited and assigned identically — every row `MANUAL`, every row its own
   * `category_override`, the whole batch in one transaction.
   *
   * The rule offer follows only when the selection turned out to be one
   * merchant, which `correctCategories` reports rather than this screen
   * guessing: "always categorize these as Groceries?" is not a question that can
   * be asked about forty rows of forty shops.
   */
  const assignPicked = (categoryId: string | undefined): void => {
    const ids = [...picked]
    if (ids.length === 0) return

    let result: ReturnType<typeof correctCategories> | undefined
    mutate((database) => {
      result = correctCategories(database, ids, categoryId, Date.now())
    })

    setPicked(new Set())
    setAnchor(undefined)

    if (result?.subject === undefined) {
      setOffered(undefined)
      return
    }
    const offer = offerForCorrection({
      subject: result.subject,
      categoryId,
      corrections: result.corrections ?? 0,
      rules: data.rules,
    })
    setOffered(
      offer === undefined
        ? undefined
        : { offer, merchantRaw: result.merchantRaw ?? offer.merchantNormalized },
    )
  }


  /**
   * Leave rows out of every total, or count them again (M28 U6).
   *
   * The same `setExcludedFromStats` the detail panel's checkbox calls, now one
   * gesture from the row: the menu, X, and the selection bar. A row left out
   * stays in the list, struck through — a number that vanished is a number nobody
   * can check.
   */
  const leaveOut = (ids: readonly string[], excluded: boolean): void => {
    mutate((database) => {
      const now = Date.now()
      for (const id of ids) setExcludedFromStats(database, id, excluded, now)
    })
  }

  /**
   * *This pays a card*, from a bank row's menu (D-069, moved off the detail
   * panel): every row of that merchant is read as paying the card, the links are
   * re-derived before anything reads them (D-062), and — both halves, as the
   * accounts screen learned to do (D-064) — the card's answer is that its
   * settlements are not spent twice.
   */
  const setPayer = (row: StoredTransaction, cardAccountId: string | undefined): void => {
    mutate((database) => {
      const now = Date.now()
      if (cardAccountId === undefined) {
        clearSettlementAlias(database, row.merchantNormalized, now)
        rescanSettlements(database, now)
        return
      }
      setSettlementAlias(database, row.merchantNormalized, cardAccountId, now)
      rescanSettlements(database, now)
      setExcludeSettlementsFromStats(database, cardAccountId, true, now)
      decideForCard(database, cardAccountId, 'EXCLUDED', now)
    })
  }

  /** S2: the bank rows that look like a card's bill, left out in one click. */
  const leavePendingBillsOut = (linkIds: readonly string[]): void => {
    mutate((database) => {
      const now = Date.now()
      for (const id of linkIds) setSettlementDecision(database, id, 'EXCLUDED', now)
    })
  }

  const saveNote = (rowId: string, note: string): void => {
    mutate((database) => setTransactionNote(database, rowId, note, Date.now()))
    setNoteFor(undefined)
  }

  /**
   * Tick a row, or extend from the last one ticked.
   *
   * Extending walks the rows as they are currently *sorted*, which is the only
   * reading of "everything between these two" that matches what the user can
   * see — sort by amount, shift-click, and the range is the amounts in between.
   */
  /**
   * The row menu, opened — and the selection frozen at that instant (D-173).
   *
   * `getSelection` is read *now*: the menu takes focus, which clears the
   * selection, so reading it when an item is chosen would find nothing every
   * time.
   */
  const openMenu = (row: StoredTransaction, at: { readonly x: number; readonly y: number }): void => {
    setMenu({ row, at, selection: window.getSelection()?.toString().trim() ?? '' })
    // The first time, a line at the foot of the menu says what highlighting is
    // for (S5); after that it is the person's to know.
    if (!hintSeen()) {
      setHintShown(true)
      markHintSeen()
    } else setHintShown(false)
  }

  /**
   * What the menu offers — every action the row has, in one place (M28 U6): the
   * category, leaving it out of the totals, the card it pays, a note, the rules,
   * and the ways to look at it. Each is a call the screen already made from the
   * detail panel or the selection bar; the menu adds no write of its own.
   *
   * **A rule from a menu is a rule pre-filled and the editor opened**, never a
   * rule written (B9's reservation, unchanged), and `draftFromSelection` returns
   * nothing when the highlighted words would not match the row they were
   * highlighted on — so that item is disabled with the reason, not an offer that
   * fails on its own example.
   */
  const menuItems = (entry: NonNullable<typeof menu>): readonly MenuItem[] => {
    const row = entry.row
    const toEditor = (draft: unknown): void => {
      navigate('/categories/rules', { state: { draft } })
    }
    const usual = (data.usual)
      .map((id) => data.categories.find((one) => one.id === id))
      .filter((one): one is Category => one !== undefined)
    const account = data.accounts.find((one) => one.id === row.accountId)
    const cards = data.accounts.filter((one) => one.kind === 'CREDIT_CARD')
    const alias = data.settlementAliases.get(row.merchantNormalized)
    const picker = (): void => {
      window.setTimeout(() => {
        document
          .querySelector(`tr[data-row="${row.id}"] [aria-haspopup="listbox"]`)
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }, 0)
    }

    const items: MenuItem[] = [
      {
        icon: 'cat',
        label: 'Category',
        submenu: [
          ...usual.map((one, slot) => ({
            label: (
              <CategoryMark color={palette.colorOf(one.id)}>
                {one.path}
              </CategoryMark>
            ),
            shortcut: String(slot + 1),
            onChoose: () => assign(row.id, one.id),
          })),
          { label: 'All categories…', shortcut: 'C', separated: usual.length > 0, onChoose: picker },
        ],
      },
      row.isExcludedFromStats
        ? {
            icon: 'eye',
            label: 'Count it in the totals again',
            shortcut: 'X',
            separated: true,
            onChoose: () => leaveOut([row.id], false),
          }
        : {
            icon: 'eyeoff',
            label: 'Leave out of totals',
            detail: 'It stays in the list, struck through, and leaves every sum on Home',
            shortcut: 'X',
            separated: true,
            onChoose: () => leaveOut([row.id], true),
          },
    ]

    // Only a bank row that took money out can be paying a card.
    if (account?.kind === 'BANK' && row.amount.minor < 0 && cards.length > 0) {
      items.push({
        icon: 'card',
        label: 'This pays a card',
        detail: (
          <>
            Every <Bidi>{row.merchantRaw}</Bidi> row, before and after today
          </>
        ),
        submenu: [
          ...cards.map((card) => ({
            label: `${card.name}${card.id === alias ? ' · now' : ''}`,
            onChoose: () => setPayer(row, card.id),
          })),
          ...(alias === undefined
            ? []
            : [{ label: 'Not a card payment', separated: true, onChoose: () => setPayer(row, undefined) }]),
        ],
      })
    }

    items.push({
      icon: 'note',
      label: row.note === undefined ? 'Add a note' : 'Edit the note',
      shortcut: 'N',
      onChoose: () => setNoteFor(row.id),
    })

    const fromSelection =
      entry.selection === '' || entry.selection === row.merchantRaw
        ? undefined
        : draftFromSelection(entry.selection, row.merchantNormalized, row.categoryId)
    items.push(
      fromSelection === undefined
        ? {
            icon: 'rule',
            label: 'Rule from the words you highlight',
            detail: 'Highlight part of the name, then right-click',
            disabled: true,
            separated: true,
          }
        : {
            icon: 'rule',
            label: (
              <>
                Rule from “<Bidi>{entry.selection}</Bidi>”
              </>
            ),
            separated: true,
            onChoose: () => offerRule(row, fromSelection),
          },
      {
        icon: 'rule',
        label: (
          <>
            Rule from <Bidi>{row.merchantRaw}</Bidi>
          </>
        ),
        onChoose: () => offerRule(row, draftFromMerchant(row.merchantNormalized, row.categoryId)),
      },
    )
    // The broad one, and it is last for that reason: one rule from a provider
    // category can claim hundreds of rows the user has never seen (B9).
    if (row.providerCategory !== undefined) {
      items.push({
        icon: 'rule',
        label: (
          <>
            Rule from “<Bidi>{row.providerCategory}</Bidi>”
          </>
        ),
        detail: 'What the provider called it; reaches the most rows',
        onChoose: () => toEditor(draftFromProviderCategory(row.providerCategory ?? '', row.categoryId)),
      })
    }

    items.push(
      {
        icon: 'filter',
        label: (
          <>
            Show every <Bidi>{row.merchantRaw}</Bidi> row
          </>
        ),
        separated: true,
        onChoose: () => filterBy({ ...NO_FILTERS, search: row.merchantRaw }),
      },
      { icon: 'open', label: 'Open it beside the list', shortcut: 'Enter', onChoose: () => setSelectedId(row.id) },
      {
        icon: 'copy',
        label: 'Copy the row',
        onChoose: () =>
          void navigator.clipboard?.writeText(
            [toISODate(row.transactionDate), row.merchantRaw, row.categoryPath ?? '', account?.name ?? '', formatMoney(row.amount)].join('\t'),
          ),
      },
    )
    return items
  }

  const pick = (rowId: string, extend: boolean): void => {
    setPicked((current) => {
      const next = new Set(current)
      const from = anchor === undefined ? -1 : data.rows.findIndex((row) => row.id === anchor)
      const to = data.rows.findIndex((row) => row.id === rowId)

      if (extend && from !== -1 && to !== -1) {
        const [start, end] = from <= to ? [from, to] : [to, from]
        for (let i = start; i <= end; i++) {
          const id = data.rows[i]?.id
          if (id !== undefined) next.add(id)
        }
        return next
      }

      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
    setAnchor(rowId)
  }

  const clearPicked = (): void => {
    setPicked(new Set())
    setAnchor(undefined)
  }

  /**
   * Tick everything the filter matches, not everything the list loaded.
   *
   * The list stops at 500 rows; the count above it does not. A "select all" that
   * quietly meant the first 500 would be the same lie the hero number exists to
   * avoid (D-032), so the ids come from their own uncapped query.
   */
  const selectAllMatching = (): void => {
    if (db === undefined) return
    setPicked(new Set(listTransactionIds(db, toFilter(fields, data.currency))))
    setAnchor(undefined)
  }

  /**
   * Sort by a column, or turn it round.
   *
   * Each column starts in the direction that answers the question people ask of
   * it: dates newest first, names A to Z, and **amount ascending**, because
   * charges are negative by the importer's convention (D-004) so the largest
   * spend is the smallest number. A second click reverses whichever it was.
   */
  const sortBy = (column: SortColumn): void => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === 'ASC' ? 'DESC' : 'ASC' }
        : { column, direction: FIRST_DIRECTION[column] },
    )
  }

  // An offer is about the row it came from. Re-filtering usually scrolls that
  // row out of the list, and a question about something no longer on screen is
  // a question about nothing. A selection made under the old filter is gone for
  // the same reason: the rows it named are not the rows on screen any more.
  const filterBy = (next: FilterFields): void => {
    setOffered(undefined)
    clearPicked()
    setFields(next)
  }

  const primary = data.summary.totals[0]
  const alsoIn = data.summary.totals.slice(1)
  const filtered = isFiltered(fields)
  const allShownPicked = data.rows.length > 0 && data.rows.every((row) => picked.has(row.id))
  // Rows the filter matches but the list stopped short of. Offering them is the
  // difference between "select all" meaning the filter and meaning the page.
  const beyondTheCap = data.summary.count - data.rows.length
  // Bound out of `data` so the checks below narrow it for the panel's callbacks.
  const selected = data.selected

  const period = fields.period
  const shownMonth = period === undefined ? undefined : parseYearMonth(period)
  const at = period === undefined ? -1 : data.months.indexOf(period)
  const older = at >= 0 ? data.months[at + 1] : undefined
  const newer = at > 0 ? data.months[at - 1] : undefined
  const short = (month: string | undefined): string | undefined => {
    const parsed = month === undefined ? undefined : parseYearMonth(month)
    return parsed === undefined ? undefined : formatMonthShort(parsed)
  }
  const pageTo = (month: string | undefined): void => {
    if (month !== undefined) filterBy({ ...fields, period: month })
  }
  const pendingHere = data.pendingBills
    .map((bill) => ({
      ...bill,
      rows: bill.rows.filter((row) => period === undefined || row.date.startsWith(period)),
    }))
    .filter((bill) => bill.rows.length > 0)
  const cur = primary?.currency ?? data.currency

  return (
    <div className="flex h-full">
      <div className="@container flex min-w-0 flex-1 flex-col">
        {/* The page header (M28 U6, D-315): where you are, the switch between
            the two views of this place, and the way between months. */}
        <header className="flex shrink-0 flex-wrap items-end justify-between gap-6 border-b border-hairline px-6 pt-6 pb-4">
          <div className="flex flex-col gap-1.5">
            <span className="fc-label text-ink-secondary uppercase tabular-nums">
              Transactions · every row{shownMonth === undefined ? ', all months' : `, ${formatYearMonth(shownMonth)}`}
            </span>
            <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">Transactions</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ViewSwitch view="rows" waiting={data.waitingNames} />
            <Button variant="ghost" size="sm" icon="rule" onClick={() => navigate('/categories/rules')}>
              Rules
            </Button>
            {shownMonth !== undefined ? (
              <Pager
                label="Month"
                prev={short(older)}
                next={short(newer)}
                onPrev={() => pageTo(older)}
                onNext={() => pageTo(newer)}
              />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => pageTo(data.months[0])}>
                Back to the newest month
              </Button>
            )}
            {shownMonth !== undefined && (
              <Button variant="ghost" size="sm" onClick={() => filterBy({ ...fields, period: undefined })}>
                All months
              </Button>
            )}
          </div>
        </header>

        {/* The four figures of what is on screen. Went out and came in carry the
            flow colours Home gave them (D-313) — they are the sums of the view,
            and a single row below stays ink. */}
        <div className="grid shrink-0 grid-cols-2 divide-x divide-hairline border-b border-hairline px-6 @[48rem]:grid-cols-4">
          <Figure label="Went out" flow="out" value={money(primary?.outflowMinor ?? 0, cur)}>
            {data.summary.count - data.summary.excluded} {data.summary.count - data.summary.excluded === 1 ? 'row' : 'rows'} counted
          </Figure>
          <Figure label="Came in" flow="in" value={money(primary?.inflowMinor ?? 0, cur)}>
            {alsoIn.length > 0 ? `and ${alsoIn.map((total) => total.currency).join(', ')}, not added` : 'in this view'}
          </Figure>
          <Figure label="Left out of totals" flow={undefined} value={money(data.summary.leftOut.find((one) => one.currency === cur)?.outflowMinor ?? 0, cur)}>
            {data.summary.excluded} {data.summary.excluded === 1 ? 'row' : 'rows'}
            {data.summary.excluded > 0 &&
              (data.rows.some((row) => row.countedOnCard)
                ? ' · a card payment is already in the card’s own rows'
                : ' · left out by hand')}
          </Figure>
          <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5">
            <span className="fc-label text-ink-secondary uppercase">No category</span>
            <span className="text-[24px] leading-tight font-medium tracking-[-0.01em] tabular-nums">
              {data.uncategorizedInView}
            </span>
            <small className="text-caption text-ink-secondary">
              {data.uncategorizedInView === 0 ? (
                'all categorized'
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/transactions/merchants')}
                  className="text-accent underline underline-offset-4 hover:text-accent-hover"
                >
                  categorized fastest by merchant
                </button>
              )}
            </small>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-6 py-1.5 text-caption text-ink-secondary tabular-nums">
          <span>
            {filtered
              ? `${data.summary.count} of ${data.total} transactions`
              : `${data.total} transactions`}
          </span>
          {data.summary.moved > 0 && (
            <span className="text-ink-tertiary">{data.summary.moved} moved to what you own, not spent</span>
          )}
          {data.summary.held > 0 && (
            <span className="text-ink-tertiary">{data.summary.held} bought, sold or arrived by transfer inside an account with holdings, neither in nor out</span>
          )}
          {/* Says what it will take, because the screen caps at 500 and the
              file does not — someone exporting a filtered ledger should not
              have to wonder which of the two numbers above they are getting. */}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            title="Open this ledger in a spreadsheet"
            onClick={() => {
              if (db === undefined) return
              downloadCsv(exportFileName('transactions'), transactionsCsv(db, data.filter, sort))
            }}
          >
            Export {filtered ? `these ${data.summary.count}` : 'all'} to CSV
          </Button>
        </div>

        <FilterBar
          fields={fields}
          onChange={filterBy}
          accounts={data.accounts}
          categories={data.categories}
          currency={data.currency}
          unparseable={{
            min: isUnparseable(fields.min),
            max: isUnparseable(fields.max),
          }}
        />

        {/* **S2: card payments nobody has said anything about** (M28 U6). A bank row
            the settlement scan matched to a card statement's total, still
            unanswered — counting both would double the month. One click leaves
            them out, with the same `setSettlementDecision` the import prompt
            uses. */}
        {pendingHere.length > 0 && (
          <section
            aria-label="Card payments"
            className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-surface px-6 py-2.5"
          >
            {pendingHere.map((bill) => (
              <div key={`${bill.cardAccountId}|${bill.billingPeriod ?? ''}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                <span className="min-w-0 flex-1">
                  {bill.rows.length} bank {bill.rows.length === 1 ? 'row looks' : 'rows look'} like{' '}
                  {bill.rows.length === 1 ? 'a card payment' : 'card payments'} (<Bidi>{bill.cardAccountName}</Bidi>,{' '}
                  {formatMoney(money(bill.rows.reduce((sum, row) => sum + Math.abs(row.amount.minor), 0), bill.chargedTotal.currency))}). Leave {bill.rows.length === 1 ? 'it' : 'them'} out, so the month
                  is not counted twice?
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="check"
                  onClick={() => leavePendingBillsOut(bill.rows.map((row) => row.linkId))}
                >
                  Leave {bill.rows.length === 1 ? 'it' : 'them'} out
                </Button>
              </div>
            ))}
          </section>
        )}

        {data.byCategory.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-hairline px-6 py-2 text-caption text-ink-secondary">
            {data.byCategory.map((entry) => (
              <span key={`${entry.categoryId ?? 'none'}-${entry.currency}`} className="tabular-nums">
                <Bidi>{entry.name}</Bidi>{' '}
                <span className="text-ink">
                  <Amount value={money(-entry.outflowMinor, entry.currency)} />
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Above the rows rather than under them: the correction that prompted
            this is a row or two below, and a question parked at the bottom of a
            tall screen is a question nobody answers (D-043). Still non-modal —
            the ledger stays visible and usable behind it. */}
        {/* What filing the rows already here did, and the way back out of it. Same
            place as the offer it replaces, because it is the answer to it. */}
        {applied !== undefined && (
          <section
            aria-label="Rule applied"
            aria-live="polite"
            className="fc-pop-enter flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-surface px-6 py-3"
          >
            <p>
              Rule saved.{' '}
              {applied.count === 0 ? (
                <span className="text-ink-secondary">
                  Nothing already in the ledger changed — every row it covers either has this
                  category or was categorized by hand.
                </span>
              ) : (
                <>
                  <span className="tabular-nums font-medium">{applied.count}</span>
                  {applied.count === 1 ? ' earlier transaction' : ' earlier transactions'} moved to
                  it.
                </>
              )}
            </p>
            {applied.count > 0 && (
              <Button variant="secondary" size="sm" onClick={undoPast}>
                Undo those
              </Button>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setApplied(undefined)}>
              Dismiss
            </Button>
            {applied.count > 0 && (
              <p className="w-full text-caption text-ink-tertiary">
                Undoing puts those rows back; the rule stays, and the rules screen is where to
                remove it.
              </p>
            )}
          </section>
        )}

        {/* Only while something is ticked, and it takes the place of nothing:
            the ledger reads exactly as it did until there is a selection to act
            on. Above the rows, like every other question this screen asks
            (D-043). */}
        {picked.size > 0 && (
          <section
            aria-label="Selected transactions"
            className="fc-pop-enter flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-surface px-6 py-3"
          >
            <span className="tabular-nums">
              {picked.size === 1 ? '1 transaction selected' : `${picked.size} transactions selected`}
            </span>

            <span className="flex items-center gap-2 text-caption text-ink-secondary">
              Categorize as
              <CategoryPicker
                categories={data.categories}
                value={undefined}
                onChange={assignPicked}
                label={`Category for the ${picked.size} selected transactions`}
              />
            </span>

            <Button
              variant="secondary"
              size="sm"
              icon="eyeoff"
              onClick={() => {
                leaveOut([...picked], true)
                clearPicked()
              }}
            >
              Leave out of totals
            </Button>

            {allShownPicked && beyondTheCap > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={selectAllMatching}
                title="Everything this filter matches, including rows below the list"
              >
                Select all {data.summary.count}
              </Button>
            )}

            {/* A bulk assignment is `MANUAL` like any other choice by hand, and
                permanent in the same way (D-009). Saying so beside the picker
                is cheaper than explaining it afterwards. */}
            <span className="text-caption text-ink-tertiary">
              Chosen by hand, so no rule or re-import will change them back.
            </span>

            <Button variant="ghost" size="sm" className="ml-auto" onClick={clearPicked}>
              Clear selection
            </Button>
          </section>
        )}

        {/* The offer makes its room above the list (M39, src/ui/motion/). */}
        <Reveal>
        {offered !== undefined && (
          <LearningOffer
            key={`${offered.offer.merchantNormalized}|${offered.offer.categoryId}|${offered.offer.draft.pattern}`}
            offer={offered.offer}
            merchantRaw={offered.merchantRaw}
            categories={data.categories}
            accounts={data.accounts}
            pastFor={(draft) => pastRows(draft, data.rules, candidates)}
            onDismiss={() => setOffered(undefined)}
            onCreate={learn}
          />
        )}
        </Reveal>

        <div className="min-h-0 flex-1 overflow-auto" {...cursor.container}>
          {data.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-ink-secondary">
              <p>Nothing in the ledger matches these filters.</p>
              <Button variant="secondary" size="sm" onClick={() => filterBy(NO_FILTERS)}>
                Clear filters
              </Button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-ink-tertiary">
                  <Th className="w-0 text-left">
                    {/* Tick every row on screen — "on screen" being the cap, so
                        the bar underneath says how many that leaves out and
                        offers the rest. */}
                    <input
                      type="checkbox"
                      aria-label="Select every row shown"
                      checked={allShownPicked}
                      onChange={() =>
                        allShownPicked ? clearPicked() : setPicked(new Set(data.rows.map((row) => row.id)))
                      }
                    />
                  </Th>
                  {/*
                    Two date columns, because docs/05 is emphatic that these are
                    not interchangeable — and a card statement proves it: every
                    row of a Max file is charged on the same day, so a list
                    showing only the charge date shows the same date eleven
                    times. "When did I buy this" is the one that varies and the
                    one you scan by.
                  */}
                  <SortableTh column="DATE" sort={sort} onSort={sortBy} className="text-left">
                    Date
                  </SortableTh>
                  <SortableTh column="CHARGED" sort={sort} onSort={sortBy} className="text-left">
                    Charged
                  </SortableTh>
                  <SortableTh column="MERCHANT" sort={sort} onSort={sortBy} className="text-left">
                    Merchant
                  </SortableTh>
                  <SortableTh column="CATEGORY" sort={sort} onSort={sortBy} className="text-left">
                    Category
                  </SortableTh>
                  <Th className="text-left">Provider said</Th>
                  <SortableTh column="AMOUNT" sort={sort} onSort={sortBy} className="text-right">
                    Amount
                  </SortableTh>
                  <Th className="w-0 text-left">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <Flip
                as="tbody"
                // A row filed out of a filtered view, or a note opened under one:
                // the rows below make or give back its room (M39, src/ui/motion/).
                // A new sort is the list replaced, and snaps.
                flipKey={`${data.rows.map((row) => row.id).join(',')}|${noteFor ?? ''}`}
                resetKey={JSON.stringify(sort)}
              >
                {data.rows.map((row, index) => (
                  <Row
                    key={row.id}
                    row={row}
                    categories={data.categories}
                    selected={row.id === selectedId}
                    picked={picked.has(row.id)}
                    cursor={cursor.row(index)}
                    onPick={(extend) => pick(row.id, extend)}
                    onOpen={() => {
                      cursor.set(index)
                      setSelectedId(row.id)
                    }}
                    onAssign={(categoryId) => assign(row.id, categoryId)}
                    onMenu={(at) => openMenu(row, at)}
                    cardBill={data.settlementRows.has(row.id)}
                    noteOpen={noteFor === row.id}
                    onNote={(note) => saveNote(row.id, note)}
                    onNoteCancel={() => setNoteFor(undefined)}
                  />
                ))}
              </Flip>
            </table>
          )}

          {beyondTheCap > 0 && (
            <p className="px-6 py-3 text-caption text-ink-tertiary tabular-nums">
              Showing the first {data.rows.length} of {data.summary.count}, by{' '}
              {COLUMN_NAME[sort.column]}. Narrow the filters to see the rest — the total above
              already counts them all.
            </p>
          )}
        </div>

      </div>

      {menu !== undefined && (
        <ContextMenu
          at={menu.at}
          items={menuItems(menu)}
          onClose={() => setMenu(undefined)}
          header={{
            title: <Bidi>{menu.row.merchantRaw}</Bidi>,
            sub: (
              <>
                {toISODate(menu.row.transactionDate)} ·{' '}
                <Bidi>{data.accounts.find((one) => one.id === menu.row.accountId)?.name ?? ''}</Bidi> ·{' '}
                {formatMoney(menu.row.amount)}
              </>
            ),
          }}
          hint={
            hintShown
              ? 'Highlight part of the name before you right-click, and the menu offers a rule from just those words.'
              : undefined
          }
        />
      )}

      {selected !== undefined && (
        <DetailPanel
          key={selected.id}
          transaction={selected}
          categories={data.categories}
          rules={data.rules}
          accounts={data.accounts}
          onClose={() => setSelectedId(undefined)}
          // The same offer a correction makes, above the rows (D-373).
          onCreateRule={() =>
            offerRule(selected, draftFromMerchant(selected.merchantNormalized, selected.categoryId))
          }
          // The broad one stays behind the editor, where the pattern, the
          // category and the conditions are all on screen before it is saved
          // (D-042). Router state, not the URL: a Hebrew name in a hash is a
          // worse address, and the draft is not worth a bookmark.
          onCreateProviderRule={() =>
            navigate('/categories/rules', {
              state: {
                draft: draftFromProviderCategory(
                  selected.providerCategory ?? '',
                  selected.categoryId,
                ),
              },
            })
          }
          onAssign={(categoryId) => assign(selected.id, categoryId)}
          onNote={(note) =>
            mutate((database) => setTransactionNote(database, selected.id, note, Date.now()))
          }
          onExclude={(excluded) =>
            mutate((database) => setExcludedFromStats(database, selected.id, excluded, Date.now()))
          }
          holdings={data.rowHoldings}
          heldNow={data.heldNow}
          transfer={data.transfer}
          onTransfer={(pairId, decision) =>
            mutate((database) => {
              setTransferDecisions(database, [{ pairId, decision }])
            })
          }
          holdingProblem={(choice) => (db == null ? undefined : transactionHoldingProblem(db, selected.id, choice))}
          onHolding={(choice) =>
            mutate((database) => setTransactionHolding(database, selected.id, choice, Date.now()))
          }
          settlementAlias={data.settlementAliases.get(selected.merchantNormalized)}
          // Setting the alias changes what the app *makes* of a row, so the
          // links have to be re-derived before anything reads them — the same
          // rescan a commit runs, for the same reason (D-062). Outside a
          // transaction because `syncSettlementLinks` opens its own.
          onSetSettlementAlias={(cardAccountId) =>
            mutate((database) => {
              const now = Date.now()
              if (cardAccountId === undefined) {
                clearSettlementAlias(database, selected.merchantNormalized, now)
              } else {
                setSettlementAlias(database, selected.merchantNormalized, cardAccountId, now)
              }
              rescanSettlements(database, now)
            })
          }
          // Both halves, as the accounts screen learned to do (D-064): the
          // memory on the card, and the charges it describes.
          onDecideCard={(cardAccountId, exclude) =>
            mutate((database) => {
              const now = Date.now()
              setExcludeSettlementsFromStats(database, cardAccountId, exclude, now)
              decideForCard(database, cardAccountId, exclude ? 'EXCLUDED' : 'KEPT', now)
            })
          }
        />
      )}
    </div>
  )
}

function Row({
  row,
  categories,
  selected,
  picked,
  cursor,
  onPick,
  onOpen,
  onAssign,
  onMenu,
  cardBill,
  noteOpen,
  onNote,
  onNoteCancel,
}: {
  row: StoredTransaction
  categories: readonly Category[]
  selected: boolean
  picked: boolean
  /** `data-cursor`, which `tokens.css` turns into the rule at the row's edge. */
  cursor: { readonly 'data-cursor': boolean }
  onPick: (extend: boolean) => void
  onOpen: () => void
  onAssign: (categoryId: string | undefined) => void
  /** Where the menu was asked for, and by which row (D-173). */
  onMenu: (at: { readonly x: number; readonly y: number }) => void
  /** Whether the bank's row is the same money as a card's rows (D-062). */
  cardBill: boolean
  noteOpen: boolean
  onNote: (note: string) => void
  onNoteCancel: () => void
}) {
  // Left out by the person, or by a card settlement's answer (M36 U04).
  const left = row.isExcludedFromStats || row.countedOnCard
  return (
    <>
      <tr
        {...cursor}
        data-row={row.id}
        data-motion-key={row.id}
        // **The gestures are on the row, not on the value** (D-173). A right-click
        // anywhere in the row asks the same question, and `Shift+F10` — what the
        // platform binds — asks it from the keyboard, which is what makes this
        // done rather than a mouse feature.
        onContextMenu={(event) => {
          event.preventDefault()
          onMenu({ x: event.clientX, y: event.clientY })
        }}
        onKeyDown={(event) => {
          if (!isMenuKey(event)) return
          event.preventDefault()
          // Under whatever has focus, since there is no pointer to ask.
          const box = (event.target as HTMLElement).getBoundingClientRect()
          onMenu({ x: box.left, y: box.bottom })
        }}
        className={`group border-t border-hairline transition-colors duration-[var(--duration-micro)] ${
          selected || picked ? 'bg-surface' : 'hover:bg-surface'
        }`}
      >
        {/* A real checkbox rather than a clickable cell: it is in the tab order,
            reads correctly to a screen reader, and Space activates it — including
            with Shift held, which is what makes range selection work without a
            mouse. */}
        <td className="py-2 pl-6">
          <input
            type="checkbox"
            checked={picked}
            onClick={(event) => onPick(event.shiftKey)}
            onChange={() => undefined}
            aria-label={`Select ${row.merchantRaw}`}
            title="Shift-click to select everything in between"
          />
        </td>
        <td className="px-6 py-2 tabular-nums whitespace-nowrap text-ink-secondary">
          {toISODate(row.transactionDate)}
        </td>
        <td className="px-6 py-2 tabular-nums whitespace-nowrap text-ink-tertiary">
          {row.chargeDate === undefined ? '' : toISODate(row.chargeDate)}
        </td>
        <td className={`w-full px-6 py-2 ${left ? 'text-ink-secondary' : ''}`}>
          {/* The merchant opens the detail rather than the whole row: the row also
              holds a category picker, and a button inside a button is neither
              clickable nor announceable. */}
          <button type="button" onClick={onOpen} className="text-left hover:underline">
            <Bidi>{row.merchantRaw}</Bidi>
          </button>
          {row.installment !== undefined && (
            <span className="ml-2 text-caption text-ink-tertiary tabular-nums">
              {row.installment.sequence}/{row.installment.total}
            </span>
          )}
          {row.note !== undefined && (
            <span title={row.note} className="ml-2 inline-flex align-middle text-ink-tertiary">
              <ActionGlyph name="note" size={12} />
              <span className="sr-only">Has a note</span>
            </span>
          )}
          {left && (
            <span className="ml-2 inline-flex items-center border border-dashed border-hairline-strong px-1.5 text-[11px] leading-[18px] font-medium tracking-[0.06em] text-ink-secondary uppercase">
              {cardBill ? 'card payment · left out' : 'left out'}
            </span>
          )}
        </td>
        <td className="px-6 py-2 whitespace-nowrap">
          {/* A cap, so a long category ellipsizes (full name on hover) rather
              than widening the column until the amount scrolls away (M28 F17). */}
          <div className="max-w-56">
            <CategoryPicker
              categories={categories}
              value={row.categoryId}
              onChange={onAssign}
              label={`Category for ${row.merchantRaw}`}
            />
          </div>
        </td>
        <td className="px-6 py-2 whitespace-nowrap text-caption text-ink-tertiary">
          {row.providerCategory !== undefined && <Bidi>{row.providerCategory}</Bidi>}
        </td>
        <td className="px-6 py-2 text-right whitespace-nowrap">
          {/* Struck through and quiet, the way a row that is listed and not
              counted should look (M28 U6). */}
          <span className={left ? 'text-ink-tertiary line-through decoration-ink-tertiary' : ''}>
            <Amount value={row.amount} />
          </span>
        </td>
        <td className="py-2 pr-4">
          <button
            type="button"
            title="Actions (right-click, or the menu key)"
            aria-label={`Actions for ${row.merchantRaw}`}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              onMenu({ x: box.right - 4, y: box.bottom + 2 })
            }}
            className="flex size-7 items-center justify-center text-ink-secondary opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 group-focus-within:opacity-100 hover:text-ink focus-visible:opacity-100"
          >
            <ActionGlyph name="more" size={15} />
          </button>
        </td>
      </tr>
      {noteOpen && (
        <tr className="bg-surface" data-motion-key={`${row.id}|note`}>
          <td />
          <td colSpan={7} className="px-6 pb-3">
            <NoteField initial={row.note ?? ''} onDone={onNote} onCancel={onNoteCancel} />
          </td>
        </tr>
      )}
    </>
  )
}

/** The note on one row, typed where the row is. Enter saves, Escape leaves it as it was. */
function NoteField({
  initial,
  onDone,
  onCancel,
}: {
  initial: string
  onDone: (note: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onDone(value)
      }}
    >
      <ActionGlyph name="note" />
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
        dir="auto"
        placeholder="Anything worth remembering about this one…"
        aria-label="Note"
        className="h-[30px] flex-1 border border-accent bg-background px-2.5 outline-none"
      />
      <Button type="submit" variant="ghost" size="sm">
        Done
      </Button>
    </form>
  )
}

/** The merchants still waiting for a category, as the switch's count: names, not rows. */
/** What the holding the selected row names adds up to, across all its rows. */
function heldNowOf(
  db: NonNullable<ReturnType<typeof useDocumentStore.getState>['db']>,
  selectedId: string | undefined,
): HoldingQuantity | undefined {
  const holdingId = selectedId === undefined ? undefined : findTransactionById(db, selectedId)?.holdingId
  return holdingId === undefined ? undefined : holdingQuantity(db, holdingId)
}

function waitingNames(db: NonNullable<ReturnType<typeof useDocumentStore.getState>['db']>): number {
  const skipped = readSkipped(db)
  return listMerchantGroups(db, {}).filter((group) => !skipped.has(group.merchantNormalized)).length
}

const HINT_KEY = 'emerald.rowMenuHint'

/** Whether the highlight hint has been shown once (S5). Storage may be absent; then it is shown each time, which is harmless. */
function hintSeen(): boolean {
  return readPreference(HINT_KEY) === '1'
}

function markHintSeen(): void {
  writePreference(HINT_KEY, '1')
}

/** What the user typed, as something the repository can answer. */
function toFilter(fields: FilterFields, currency: string): TransactionFilter {
  const bounds = monthBounds(fields.period)

  return {
    from: bounds?.from,
    to: bounds?.to,
    accountId: fields.accountId === '' ? undefined : fields.accountId,
    categoryId:
      fields.category === '' || fields.category === UNCATEGORIZED_OPTION
        ? undefined
        : fields.category,
    uncategorized: fields.category === UNCATEGORIZED_OPTION,
    includeSubcategories: fields.withSubcategories,
    search: fields.search,
    min: parseBound(fields.min, currency),
    max: parseBound(fields.max, currency),
  }
}

/**
 * An amount box read as a bound.
 *
 * Magnitude, so a typed minus changes nothing — the bounds already compare
 * against the size of a row, and "at least -200" is not a thing anyone means.
 * `parseAmountText` is the same reader the importer uses on statement cells, so
 * `1,234.56` and `₪1,234.56` work here for the same reason they work there.
 */
function parseBound(text: string, currency: string): Money | undefined {
  if (text.trim() === '') return undefined
  const value = parseAmountText(text)
  return value === undefined ? undefined : fromMajorUnits(Math.abs(value), currency)
}

function isUnparseable(text: string): boolean {
  return text.trim() !== '' && parseAmountText(text) === undefined
}

function monthBounds(
  period: string | undefined,
): { readonly from: LocalDate; readonly to: LocalDate } | undefined {
  return period === undefined ? undefined : monthRange(period)
}

/** The months the ledger actually has rows in, newest first, without repeats. */
function distinctPeriods(totals: readonly { readonly period: string }[]): readonly string[] {
  return [...new Set(totals.map((total) => total.period))]
}

function Th({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <th
      className={`sticky top-0 z-10 border-b border-hairline bg-background px-6 py-2 text-caption font-normal text-ink-tertiary ${className}`}
    >
      {children}
    </th>
  )
}

/**
 * The direction a column sorts in when it is first clicked.
 *
 * Each one answers the question people actually ask of that column. Amount is
 * the interesting case: charges are negative by the importer's convention
 * (D-004), so the largest spend is the *smallest* number and ascending is what
 * "biggest first" means here.
 */
/** The columns as the caption under a capped list names them. */
const COLUMN_NAME: Readonly<Record<SortColumn, string>> = {
  DATE: 'date',
  CHARGED: 'charge date',
  MERCHANT: 'merchant',
  CATEGORY: 'category',
  AMOUNT: 'amount',
}

const FIRST_DIRECTION: Readonly<Record<SortColumn, 'ASC' | 'DESC'>> = {
  DATE: 'DESC',
  CHARGED: 'DESC',
  MERCHANT: 'ASC',
  CATEGORY: 'ASC',
  AMOUNT: 'ASC',
}

function SortableTh({
  column,
  sort,
  onSort,
  className,
  children,
}: {
  column: SortColumn
  sort: TransactionSort
  onSort: (column: SortColumn) => void
  className: string
  children: React.ReactNode
}) {
  const active = sort.column === column
  return (
    <Th className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-sort={active ? (sort.direction === 'ASC' ? 'ascending' : 'descending') : 'none'}
        className={`transition-colors duration-[var(--duration-micro)] hover:text-ink ${
          active ? 'text-ink' : ''
        }`}
      >
        {children}
        {/* Kept out of the accessible name — `aria-sort` already says it, and an
            arrow read aloud after every heading is noise. */}
        <span aria-hidden className="ml-1 inline-block w-2 text-ink-tertiary">
          {active ? (sort.direction === 'ASC' ? '↑' : '↓') : ''}
        </span>
      </button>
    </Th>
  )
}

/**
 * A filter handed over through router state, checked rather than trusted.
 *
 * Two callers. Bulk categorize sends a merchant name so the ledger opens on the
 * rows a group is made of; the monthly summary sends a month and a category, so
 * that every figure on it can be tapped to see what it is made of — docs/f10's
 * first non-negotiable, which is that no aggregate is a dead end (D-088).
 *
 * Anything that is not the shape it claims is ignored and the ledger opens
 * unfiltered — `location.state` is whatever was in the history entry, including
 * something a previous build put there, in an app people keep tabs open in for
 * weeks. Each field is read on its own, so a state carrying one recognized key
 * and one stale one still does the half it can.
 */
function arrivedFilter(state: unknown): FilterFields {
  if (typeof state !== 'object' || state === null) return NO_FILTERS

  const { search, period, category } = state as {
    search?: unknown
    period?: unknown
    category?: unknown
  }

  return {
    ...NO_FILTERS,
    ...(typeof search === 'string' && search !== '' ? { search } : {}),
    // `YYYY-MM` and nothing else: the filter bar's own option values are these,
    // and a month that is not one would silently match no rows.
    ...(typeof period === 'string' && /^\d{4}-\d{2}$/.test(period) ? { period } : {}),
    ...(typeof category === 'string' && category !== '' ? { category } : {}),
    // Only meaningful beside a category, so it cannot arrive on its own and
    // quietly widen nothing.
    ...(typeof category === 'string' &&
    category !== '' &&
    (state as { withSubcategories?: unknown }).withSubcategories === true
      ? { withSubcategories: true }
      : {}),
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
