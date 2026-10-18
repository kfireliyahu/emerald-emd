/**
 * Bank-statement import — classification, settlement matching, and the running
 * balance check. docs/f06-bank-statement-import.md.
 *
 * Pure functions over plain values: no database, no clock, no React. Written and
 * tested before a screen exists, exactly as M2 opened with the rules engine, M3
 * with the paycheck figures and M4 with the fixed-expense detector.
 *
 * Four things hold everywhere in here:
 *
 * - **The last-4 is read out of the raw description.** `normalizeMerchant`
 *   strips a trailing run of one to five digits as a branch number, so
 *   `כרטיס אשראי 1234` normalizes to `כרטיס אשראי` and the four digits the whole
 *   mechanism turns on are gone. Keywords are matched against the normalized
 *   text, because that is what case-folding and mark-stripping are for; digits
 *   are read from the raw text, because that is where they still are.
 * - **A settlement is a group.** Rows are matched per card *per month* and summed
 *   before they are compared against a card statement, so a month the bank split
 *   into two charges reconciles instead of failing twice (docs/f06).
 * - **The amount identifies the period.** Which statement a settlement settles is
 *   not guessed from the charge date; it is whichever of that card's monthly
 *   totals the charge equals. Agreement is what makes the match `HIGH`, so the
 *   same comparison does both jobs.
 * - **An undecided settlement is never spending.** `bankSpendingBasis` hands out
 *   a total, not a list to filter, and a card charge the user has not answered
 *   for is outside it. That is the direction that cannot be wrong twice: an
 *   understated total says so on the screen, and a doubled one looks like a
 *   number.
 */

import { abs, add, money, subtract, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  compareYearMonths,
  monthsBetween,
  toYearMonthString,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import type {
  BankRow,
  CardAccountRef,
  CardPeriodTotal,
  ClassifiedBankRow,
  MatchConfidence,
  RowClass,
  SettlementDecision,
  SettlementGroup,
  UnmatchedSettlement,
} from '@/domain/model/banking.ts'

// --- Reading the description ------------------------------------------------

/**
 * Every standalone four-digit group in a string, in the order it appears.
 *
 * "Standalone" is what keeps this useful: a bank row carries an asmachta as well
 * as a card number, and `העברה 0123456789` has seven overlapping four-digit
 * substrings and no card in it. A run of digits is a candidate only when the run
 * itself is four long.
 *
 * Read from `merchantRaw`. See this file's header for why not the other one.
 */
export function last4sIn(text: string): readonly string[] {
  const found: string[] = []
  for (const run of text.match(/\d+/gu) ?? []) {
    if (run.length === 4 && !found.includes(run)) found.push(run)
  }
  return found
}

/**
 * The words that name a row's kind, in the order they are tried.
 *
 * Data, not algorithm — the same posture `TRAILING_NOISE` in `@/core/text.ts`
 * takes, and for the same reason: this list is going to grow every time a real
 * statement says something in a way nobody anticipated, and growing it must not
 * mean touching the matcher.
 *
 * The order is the whole classification. `LOAN_PAYMENT` sits above
 * `DIRECT_DEBIT` because a mortgage paid by standing order is both, and which of
 * the two it is told as decides whether F08 can ever find it.
 */
const CLASS_KEYWORDS: readonly (readonly [RowClass, readonly string[]])[] = [
  [
    'CARD_SETTLEMENT',
    [
      'כרטיס אשראי',
      'כרטיסי אשראי',
      'כ. אשראי',
      'כ.אשראי',
      'חיוב כרטיס',
      'ויזה',
      'ישראכרט',
      'ישרכרט',
      'מאסטרקארד',
      'לאומי קארד',
      'אמריקן אקספרס',
      'דיינרס',
      'כאל',
      'מקס',
      'VISA',
      'MASTERCARD',
      'ISRACARD',
      'AMEX',
      'DINERS',
    ],
  ],
  ['SALARY', ['משכורת', 'משכורות', 'שכר עבודה', 'SALARY', 'PAYROLL']],
  [
    'LOAN_PAYMENT',
    ['הלוואה', 'הלוואות', 'משכנתא', 'משכנתה', 'פרעון הלוואה', 'החזר הלוואה', 'LOAN', 'MORTGAGE'],
  ],
  [
    'DIRECT_DEBIT',
    ['הוראת קבע', 'הוראות קבע', 'הו"ק', 'הרשאה לחיוב', 'חיוב על פי הרשאה', 'הרשאה'],
  ],
  ['CHEQUE', ['שיק', 'שיקים', 'המחאה', 'המחאות', 'CHEQUE', 'CHECK']],
  // `עמלת` and `דמי` are the construct forms — `עמלת ניהול חשבון` is how a bank
  // actually writes a fee, and the dictionary form `עמלה` never appears in it.
  // Hebrew inflects the first word of a phrase, so a word list that holds only
  // the dictionary form matches the statement nobody wrote.
  ['FEE', ['עמלה', 'עמלת', 'עמלות', 'דמי ניהול', 'דמי כרטיס', 'דמי טיפול', 'FEE']],
  ['INTEREST', ['ריבית', 'ריביות', 'הפרשי ריבית', 'INTEREST']],
  ['INTERNAL_TRANSFER', ['העברה עצמית', 'העברה בין חשבונות', 'העברה לחשבוני', 'משיכה מחשבון']],
]

/**
 * Does this text say this word?
 *
 * A phrase is looked for as a substring; a single word has to be a whole word.
 * The distinction is not decoration — `שיק` is a cheque and `שיקום` is
 * rehabilitation, and a substring test cannot tell them apart. Hebrew has no
 * `\b` worth using, so a word match is membership in the text's own token list.
 *
 * Anything carrying punctuation (`הו"ק`) is a phrase by this rule, because
 * tokenizing would have split it.
 */
function saysWord(tokens: ReadonlySet<string>, text: string, keyword: string): boolean {
  return /^[\p{L}\p{N}]+$/u.test(keyword) ? tokens.has(keyword) : text.includes(keyword)
}

function tokensOf(text: string): ReadonlySet<string> {
  return new Set(text.split(/[^\p{L}\p{N}]+/u).filter((token) => token !== ''))
}

/**
 * What a bank row is, from what it says and which way the money went.
 *
 * The direction is a tiebreak, not a signal on its own: `משכורת` on an outflow
 * is a salary the user *paid*, which is not F04's paycheck and must not be
 * reconciled against one. Everything the words do not name falls to the two
 * `OTHER_` classes, which is an honest answer and the one the labeling queue
 * exists to improve.
 */
export function classifyRow(descriptionNormalized: string, amount: Money): RowClass {
  const tokens = tokensOf(descriptionNormalized)

  for (const [rowClass, keywords] of CLASS_KEYWORDS) {
    if (!keywords.some((keyword) => saysWord(tokens, descriptionNormalized, keyword))) continue
    if (rowClass === 'SALARY' && amount.minor < 0) continue
    if (rowClass === 'CARD_SETTLEMENT' && amount.minor > 0) continue
    return rowClass
  }

  return amount.minor < 0 ? 'OTHER_OUTFLOW' : 'OTHER_INFLOW'
}

// --- Settlement matching ----------------------------------------------------

/**
 * A whole bank import, read.
 *
 * The settlements are a field of their own rather than a property of the rows,
 * which is the point: summing `rows` is not a thing a caller does, because the
 * only total this module hands out comes from `bankSpendingBasis`.
 */
export interface BankImportPlan {
  readonly rows: readonly ClassifiedBankRow[]
  readonly settlements: readonly SettlementGroup[]
  /** Card charges this document cannot attribute. docs/f06: the important half. */
  readonly unmatched: readonly UnmatchedSettlement[]
}

export interface BankImportInput {
  readonly rows: readonly BankRow[]
  /** Every `CREDIT_CARD` account, archived ones included — see docs/04 on `findAccountByLast4`. */
  readonly cards: readonly CardAccountRef[]
  /** What each card statement already in the ledger came to, per billing period. */
  readonly cardPeriodTotals: readonly CardPeriodTotal[]
  /**
   * Normalized merchant → the card account it pays, as the **user** told the
   * app. D-069.
   *
   * The escape hatch for the two ways detection misses: a bank whose wording is
   * in no keyword list, and a row that names no card number and matches no
   * statement total. Both leave real double-counting on screen with nothing the
   * app can do about it on its own, and the user can see the answer at a glance.
   *
   * Keyed on the **normalized** merchant, which is what makes one answer cover
   * every past and future occurrence — the same key `merchantGroups` and the
   * rules engine group on, so what the user answers about and what the answer
   * covers are the same rows by construction.
   */
  readonly settlementAliases?: ReadonlyMap<string, string> | undefined
}

/**
 * How many months after a billing period its charge may land.
 *
 * An Israeli card bills a month and charges it on the 2nd or the 10th of that
 * same month, so zero is the ordinary case and one covers a period the file
 * labels the month before. Wider than that and the amount comparison starts
 * matching last spring, which is how a corroboration becomes a coincidence.
 */
const SETTLEMENT_MONTH_WINDOW = 1

function settlesPlausibly(period: YearMonth, rowMonth: YearMonth): boolean {
  const distance = monthsBetween(period, rowMonth)
  return distance >= 0 && distance <= SETTLEMENT_MONTH_WINDOW
}

/** The remembered answer, as a decision. Null is not a third opinion; see docs/04. */
function decisionFor(card: CardAccountRef): SettlementDecision {
  if (card.excludeSettlementsFromStats === undefined) return 'PENDING'
  return card.excludeSettlementsFromStats ? 'EXCLUDED' : 'KEPT'
}

interface Attribution {
  readonly card: CardAccountRef
  readonly last4?: string | undefined
  readonly confidence: MatchConfidence
  readonly isUserStated: boolean
}

/**
 * Which card this row settles, if any.
 *
 * The last-4 is tried first and is worth far more than an amount: it is a fact
 * the bank printed about the row, while an equal amount is a fact about two
 * numbers. Only when the description states no card number at all does the
 * amount get to identify one, and then at `LOW` — docs/f06 says that path always
 * prompts.
 */
function attribute(
  row: BankRow,
  byLast4: ReadonlyMap<string, readonly CardAccountRef[]>,
  totalsByCard: ReadonlyMap<string, readonly CardPeriodTotal[]>,
  cards: readonly CardAccountRef[],
): Attribution | { readonly unattributed: string | undefined } {
  const candidates = last4sIn(row.descriptionRaw)

  for (const last4 of candidates) {
    const matching = byLast4.get(last4)
    if (matching === undefined || matching.length === 0) continue

    // "Two cards with the same last-4" is docs/f06's impossible-in-practice
    // case, and its answer is to disambiguate by amount. One card is the
    // overwhelming case and takes no work; more than one asks the totals.
    const card =
      matching.length === 1
        ? matching[0]
        : (matching.find((option) => agreeingPeriod(row, totalsByCard.get(option.id)) !== undefined) ??
          matching[0])
    if (card === undefined) continue
    return { card, last4, confidence: 'MEDIUM', isUserStated: false }
  }

  // The bank omitted the card number. Fall back to the amount, which can only
  // point at a card the app already holds a statement for.
  if (candidates.every((last4) => (byLast4.get(last4)?.length ?? 0) === 0)) {
    for (const card of cards) {
      if (agreeingPeriod(row, totalsByCard.get(card.id)) !== undefined) {
        return { card, confidence: 'LOW', isUserStated: false }
      }
    }
  }

  return { unattributed: candidates[0] }
}

/** The billing period whose statement total equals this amount, within the date window. */
function agreeingPeriod(
  row: { readonly date: BankRow['date']; readonly amount: Money },
  totals: readonly CardPeriodTotal[] | undefined,
  charged: Money = abs(row.amount),
): CardPeriodTotal | undefined {
  const rowMonth = yearMonthOf(row.date)
  return totals?.find((candidate) => {
    if (!settlesPlausibly(candidate.period, rowMonth)) return false
    const total = abs(candidate.total)
    return total.currency === charged.currency && total.minor === charged.minor
  })
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const bucket = groups.get(key(item))
    if (bucket === undefined) groups.set(key(item), [item])
    else bucket.push(item)
  }
  return groups
}

function totalOf(rows: readonly BankRow[], fallback: CurrencyCode): Money {
  const first = rows[0]
  if (first === undefined) return money(0, fallback)
  let total = money(0, first.amount.currency)
  for (const row of rows) total = add(total, abs(row.amount))
  return total
}

/**
 * Read a bank statement: what each row is, and which of them are the same money
 * as a card statement already in the ledger.
 *
 * Nothing here is written down. A class is the app's reading of a row and the
 * reading changes — a charge to a card whose statement arrives next week is
 * `OTHER_OUTFLOW` today and `CARD_SETTLEMENT` then. Re-deriving is what makes
 * docs/f06's "order of import must not matter" a property of the code rather
 * than a rescan that has to remember to run (D-060).
 */
export function planBankImport(input: BankImportInput): BankImportPlan {
  const byLast4 = new Map<string, CardAccountRef[]>()
  for (const card of input.cards) {
    if (card.last4 === undefined) continue
    const bucket = byLast4.get(card.last4)
    if (bucket === undefined) byLast4.set(card.last4, [card])
    else bucket.push(card)
  }

  const totalsByCard = groupBy(input.cardPeriodTotals, (total) => total.accountId)

  const classified: ClassifiedBankRow[] = []
  const attributed: { readonly row: BankRow; readonly to: Attribution }[] = []
  const orphans: { readonly row: BankRow; readonly last4: string | undefined }[] = []

  for (const row of input.rows) {
    // The user's own answer outranks the keywords and the last-4 both, and is
    // the only thing that can make a row a settlement the words do not name
    // (D-069). Outflows only: the same guard `classifyRow` puts on this class,
    // because a refund *from* the card company is money coming back and
    // settles nothing.
    const stated =
      row.amount.minor < 0
        ? input.settlementAliases?.get(row.descriptionNormalized)
        : undefined
    const statedCard =
      stated === undefined ? undefined : input.cards.find((card) => card.id === stated)

    const rowClass =
      statedCard === undefined
        ? classifyRow(row.descriptionNormalized, row.amount)
        : 'CARD_SETTLEMENT'
    if (rowClass !== 'CARD_SETTLEMENT') {
      classified.push({ row, rowClass })
      continue
    }

    const result: Attribution | { readonly unattributed: string | undefined } =
      statedCard === undefined
        ? attribute(row, byLast4, totalsByCard, input.cards)
        : {
            card: statedCard,
            last4: last4sIn(row.descriptionRaw)[0],
            confidence: 'MEDIUM',
            isUserStated: true,
          }
    if ('unattributed' in result) {
      orphans.push({ row, last4: result.unattributed })
      classified.push({ row, rowClass })
      continue
    }

    attributed.push({ row, to: result })
    classified.push({
      row,
      rowClass,
      settlementGroupKey: groupKey(result.card.id, yearMonthOf(row.date)),
    })
  }

  return {
    rows: classified,
    settlements: buildGroups(attributed, totalsByCard),
    unmatched: buildOrphans(orphans),
  }
}

function groupKey(cardAccountId: string, month: YearMonth): string {
  return `${cardAccountId}|${toYearMonthString(month)}`
}

/**
 * One group per card per month, corroborated as a whole.
 *
 * The sum happens before the comparison, which is the only reason docs/f06's
 * split charge reconciles: ₪2,400 and ₪1,810 each disagree with a ₪4,210
 * statement, and together they are it.
 */
function buildGroups(
  attributed: readonly { readonly row: BankRow; readonly to: Attribution }[],
  totalsByCard: ReadonlyMap<string, readonly CardPeriodTotal[]>,
): readonly SettlementGroup[] {
  const groups: SettlementGroup[] = []

  for (const [key, members] of groupBy(attributed, (item) =>
    groupKey(item.to.card.id, yearMonthOf(item.row.date)),
  )) {
    const first = members[0]
    if (first === undefined) continue

    const card = first.to.card
    const rows = members.map((member) => member.row)
    const chargedTotal = totalOf(rows, first.row.amount.currency)
    const agreed = agreeingPeriod(first.row, totalsByCard.get(card.id), chargedTotal)

    // The lowest confidence any member was attributed at, then raised by
    // agreement. A group is only as sure as its least sure row.
    const attributedAt = members.some((member) => member.to.confidence === 'LOW')
      ? 'LOW'
      : 'MEDIUM'

    groups.push({
      key,
      cardAccountId: card.id,
      cardAccountName: card.name,
      last4: first.to.last4,
      rows,
      chargedTotal,
      billingPeriod: agreed?.period,
      statementTotal: agreed?.total,
      confidence: agreed === undefined ? attributedAt : 'HIGH',
      decision: decisionFor(card),
      isUserStated: members.some((member) => member.to.isUserStated),
    })
  }

  return groups.sort(
    (a, b) =>
      a.cardAccountName.localeCompare(b.cardAccountName) ||
      compareYearMonths(a.billingPeriod ?? { year: 0, month: 1 }, b.billingPeriod ?? { year: 0, month: 1 }),
  )
}

function buildOrphans(
  orphans: readonly { readonly row: BankRow; readonly last4: string | undefined }[],
): readonly UnmatchedSettlement[] {
  const built: UnmatchedSettlement[] = []
  for (const [, members] of groupBy(orphans, (item) => item.last4 ?? '')) {
    const first = members[0]
    if (first === undefined) continue
    const rows = members.map((member) => member.row)
    built.push({
      last4: first.last4,
      rows,
      chargedTotal: totalOf(rows, first.row.amount.currency),
    })
  }
  return built
}

// --- What counts as spending ------------------------------------------------

/**
 * What a bank import adds to spending, and everything it deliberately does not.
 *
 * **One function, because there is one rule to get right.** M5's whole
 * done-when is that bank and card statements coexist without double-counting a
 * shekel, and the way to hold that is the way `fixedExpenseBasis` holds the
 * payroll-deduction rule: the caller is handed a total, not a list it has to
 * remember to filter. There is no version of this arithmetic that can forget the
 * settlement, because the settlement is not in the thing being summed.
 *
 * The four other groups come back because the screen has to show them. An amount
 * silently dropped from a total is indistinguishable from one the app lost.
 */
export interface BankSpendingBasis {
  /** Money out that is genuinely this account's own spending. Negative. */
  readonly total: Money
  readonly counted: readonly ClassifiedBankRow[]
  /**
   * Card charges the user said to ignore. Never in `total`. Each one names the
   * card and the period it settles, so the ledger keeps them drillable.
   */
  readonly excludedSettlements: readonly SettlementGroup[]
  /**
   * Card charges nobody has answered for yet. **Also not in `total`** — the
   * direction that understates rather than doubles, and the screen says so.
   *
   * **This is a claim about a review, not about the ledger.** Once a settlement
   * is committed its exclusion lives in `transaction.isExcludedFromStats`, which
   * only an answered `EXCLUDED` sets — so an unanswered settlement sitting in
   * the ledger *does* count towards every statistic until someone answers. The
   * two are not in conflict: this function previews an import beside the prompt
   * that is about to ask, and the ledger's start view on `card_settlement_link` is how the app admits to
   * the ones nobody has answered yet. Anything that quietly reconciled the two
   * would be deciding on the user's behalf, which docs/f06 forbids.
   */
  readonly undecidedSettlements: readonly SettlementGroup[]
  /**
   * Money that moved but is not this account's spending: inflows, salary, and
   * transfers between the user's own accounts. Shown, never subtracted.
   *
   * A `SALARY` row here is not yet reconciled against F04's paycheck. It is out
   * of the spending total either way — it is an inflow — and the income half of
   * the double-count needs the paycheck link that lands with the review screen.
   */
  readonly notSpending: readonly ClassifiedBankRow[]
  /** Rows denominated in something else. No rate exists in this document (D-003). */
  readonly otherCurrency: readonly BankRow[]
}

/**
 * A settlement the user chose to keep counts as spending — and then the card's
 * own transactions for that period are what must be excluded instead, which is
 * docs/f06's inversion. This function counts the charge; naming the card and
 * period so the caller can do the other half is what `SettlementGroup` is for.
 */
export function bankSpendingBasis(
  plan: BankImportPlan,
  currency: CurrencyCode,
): BankSpendingBasis {
  const excludedSettlements: SettlementGroup[] = []
  const undecidedSettlements: SettlementGroup[] = []
  const keptRefs = new Set<string>()

  for (const group of plan.settlements) {
    if (group.decision === 'EXCLUDED') excludedSettlements.push(group)
    else if (group.decision === 'PENDING') undecidedSettlements.push(group)
    else for (const row of group.rows) keptRefs.add(row.ref)
  }

  const settledRefs = new Set(
    plan.settlements.flatMap((group) => group.rows.map((row) => row.ref)),
  )

  const counted: ClassifiedBankRow[] = []
  const notSpending: ClassifiedBankRow[] = []
  const otherCurrency: BankRow[] = []
  let total = money(0, currency)

  for (const entry of plan.rows) {
    if (entry.row.amount.currency !== currency) {
      otherCurrency.push(entry.row)
      continue
    }

    // A settlement is counted only when the user said to keep it. Undecided and
    // excluded both fall out here, and an unattributed card charge — the one
    // docs/f06 warns loudest about — is not a settlement at all, so it counts.
    if (settledRefs.has(entry.row.ref) && !keptRefs.has(entry.row.ref)) continue

    if (entry.row.amount.minor >= 0 || entry.rowClass === 'INTERNAL_TRANSFER') {
      notSpending.push(entry)
      continue
    }

    counted.push(entry)
    total = add(total, entry.row.amount)
  }

  return { total, counted, excludedSettlements, undecidedSettlements, notSpending, otherCurrency }
}

// --- The running balance ----------------------------------------------------

/**
 * Which end of the file the oldest row is at.
 *
 * Not a setting and not a guess from the dates: it is whichever reading makes
 * the running balance add up, which is a stronger statement than a date column
 * that several rows may share.
 *
 * **The two readings can rescue a sign error, but only on a file with nothing in
 * it.** A parse that negated every amount reads as the reverse order exactly
 * when every consecutive pair of amounts is equal — two rows of ₪500 each, and
 * nothing longer. Any statement with two different amounts in it fails both
 * readings, which is what the check is for.
 */
export type BalanceOrder = 'OLDEST_FIRST' | 'NEWEST_FIRST'

export type BalanceCheckUnavailable =
  | 'NO_BALANCE_COLUMN'
  | 'INCOMPLETE'
  | 'TOO_FEW_ROWS'
  | 'MIXED_CURRENCY'

export interface BalanceDivergence {
  /** The first row whose stated balance is not the one the arithmetic reached. */
  readonly ref: string
  readonly expected: Money
  readonly stated: Money
  /** Stated minus expected. What the parse is out by, at this row. */
  readonly difference: Money
  /** How many rows chained correctly before it. */
  readonly verifiedBefore: number
}

export type BalanceCheck =
  | { readonly kind: 'UNAVAILABLE'; readonly reason: BalanceCheckUnavailable }
  | {
      readonly kind: 'VERIFIED'
      readonly order: BalanceOrder
      readonly openingBalance: Money
      readonly closingBalance: Money
      readonly rowCount: number
    }
  | { readonly kind: 'DIVERGED'; readonly order: BalanceOrder; readonly at: BalanceDivergence }

interface Chained {
  readonly diverged: BalanceDivergence | undefined
  readonly verified: number
}

/**
 * The only self-check an importer in this app can do.
 *
 * A card statement offers nothing like it: the app can compare its parse against
 * the one total the file prints for itself (D-026) and no further. A bank
 * statement restates its balance on every row, so a wrong column, a wrong sign
 * convention or a thousands separator read as a decimal point all show up as an
 * arithmetic failure at a **named row** rather than as a plausible number.
 *
 * docs/f06 requires a mismatch to block the commit with the first diverging row
 * named. This function finds that row; blocking is the commit's job.
 *
 * Rows must be given in the file's own order — the order is what is being
 * tested. Give it only the rows that parsed: a hole in the chain is reported as
 * `INCOMPLETE`, because a check that skipped a row is not a check.
 */
export function verifyRunningBalance(rows: readonly BankRow[]): BalanceCheck {
  const stated = rows.filter((row) => row.balance !== undefined)
  if (stated.length === 0) return { kind: 'UNAVAILABLE', reason: 'NO_BALANCE_COLUMN' }
  if (stated.length !== rows.length) return { kind: 'UNAVAILABLE', reason: 'INCOMPLETE' }
  if (rows.length < 2) return { kind: 'UNAVAILABLE', reason: 'TOO_FEW_ROWS' }

  const currency = rows[0]?.amount.currency
  if (
    currency === undefined ||
    rows.some((row) => row.amount.currency !== currency || row.balance?.currency !== currency)
  ) {
    return { kind: 'UNAVAILABLE', reason: 'MIXED_CURRENCY' }
  }

  const forward = chain(rows, 'OLDEST_FIRST')
  if (forward.diverged === undefined) return verified(rows, 'OLDEST_FIRST')

  const backward = chain(rows, 'NEWEST_FIRST')
  if (backward.diverged === undefined) return verified(rows, 'NEWEST_FIRST')

  // Neither reading works, so the file is telling the truth about neither and
  // the parse is wrong. Report the one that got further: it is the reading the
  // file is *nearly* in, and its first bad row is the one worth showing.
  const better = backward.verified > forward.verified ? backward : forward
  const order: BalanceOrder = better === backward ? 'NEWEST_FIRST' : 'OLDEST_FIRST'
  return { kind: 'DIVERGED', order, at: better.diverged as BalanceDivergence }
}

/**
 * Walk the chain in one reading.
 *
 * Oldest-first: each row's balance is the one before it plus its own amount.
 * Newest-first: each row's balance is the one *after* it plus its own amount, so
 * the row below must be this balance minus this amount. Same equation, read from
 * the other end — which is why both are one function and not two.
 */
function chain(rows: readonly BankRow[], order: BalanceOrder): Chained {
  let verified = 0

  for (let index = 0; index < rows.length - 1; index++) {
    const here = rows[index]
    const next = rows[index + 1]
    if (here?.balance === undefined || next?.balance === undefined) continue

    const [expected, actual, at] =
      order === 'OLDEST_FIRST'
        ? [add(here.balance, next.amount), next.balance, next]
        : [subtract(here.balance, here.amount), next.balance, next]

    if (expected.minor !== actual.minor) {
      return {
        verified,
        diverged: {
          ref: at.ref,
          expected,
          stated: actual,
          difference: subtract(actual, expected),
          verifiedBefore: verified,
        },
      }
    }
    verified += 1
  }

  return { verified, diverged: undefined }
}

/**
 * The opening balance is always the one before the oldest row and the closing
 * balance the one after the newest, whichever end of the file they came from —
 * "starting balance + Σ amounts = ending balance" has to mean the same sentence
 * in both readings or it means nothing.
 */
function verified(rows: readonly BankRow[], order: BalanceOrder): BalanceCheck {
  const oldest = order === 'OLDEST_FIRST' ? rows[0] : rows[rows.length - 1]
  const newest = order === 'OLDEST_FIRST' ? rows[rows.length - 1] : rows[0]

  if (oldest?.balance === undefined || newest?.balance === undefined) {
    return { kind: 'UNAVAILABLE', reason: 'INCOMPLETE' }
  }

  return {
    kind: 'VERIFIED',
    order,
    openingBalance: subtract(oldest.balance, oldest.amount),
    closingBalance: newest.balance,
    rowCount: rows.length,
  }
}

// --- Salary, against the payslip --------------------------------------------

/**
 * How far a salary deposit may lag the month it is for: one month.
 *
 * An Israeli employer pays the January salary in early February about as often
 * as on the last day of January, so a deposit landing in February is matched
 * against February's slip *and* January's. Both conventions come out right
 * without the user telling the app which one their employer uses — the same
 * "look in a window rather than guess a date" move the settlement matcher makes
 * about billing periods (D-060).
 */
export const SALARY_LAG_MONTHS = 1

/** What the app has been told to do about a month's salary deposits. */
export type SalaryDecision = 'PENDING' | 'EXCLUDED' | 'COUNTED'

export type SalaryVerdict =
  /** The deposits sum exactly to a payslip's net. */
  | 'MATCHED'
  /** A payslip covers the period and disagrees. Usually the payslip is wrong. */
  | 'DIFFERS'
  /** Nothing in the window to compare against. Not a problem, just no answer. */
  | 'NO_PAYCHECK'

/**
 * A payslip as the matcher needs it: passed in, never looked up, because this
 * file does not read a database.
 */
export interface PaycheckNet {
  readonly id: string
  readonly period: YearMonth
  readonly net: Money
  /** The day the slip says it was paid, when it says: what picks between two slips of one net. */
  readonly paidOn?: LocalDate | undefined
}

/**
 * One month's salary deposits, and what the payslips say about them.
 *
 * **Grouped by the month they landed in, and summed**, which is docs/f06's
 * "salary split across two deposits → sum-match within the period" falling out
 * of the shape rather than needing a case of its own. The same reason
 * settlements are grouped per card per month (D-060).
 */
export interface SalaryGroup {
  /** The month the deposits landed in. The key a decision is remembered by. */
  readonly period: YearMonth
  readonly rows: readonly BankRow[]
  /** Σ the deposits. Positive — these are inflows. */
  readonly total: Money
  readonly verdict: SalaryVerdict
  readonly paycheckId: string | undefined
  /** The salary month of the matched slip, which need not be `period`. */
  readonly paycheckPeriod: YearMonth | undefined
  readonly net: Money | undefined
  /** Landed minus the slip's net. **Positive means more arrived than the slip says.** */
  readonly difference: Money | undefined
  readonly decision: SalaryDecision
}

export interface SalaryMatchInput {
  readonly rows: readonly ClassifiedBankRow[]
  readonly paychecks: readonly PaycheckNet[]
  readonly currency: CurrencyCode
  /** What the user has already answered, keyed by `YYYY-MM` of the landing month. */
  readonly decisions?: ReadonlyMap<string, SalaryDecision>
  readonly lagMonths?: number
  /**
   * Rows the person filed under Salary whatever their text says (D-317). An employer
   * pays through a clearing house as often as under the word 'salary', and a deposit
   * the person already called a salary is one.
   */
  readonly filedAsSalary?: ReadonlySet<string>
}

/**
 * Match salary deposits against the payslips — docs/f06's step 12.
 *
 * **The paycheck is authoritative and the bank row is the duplicate.** A slip
 * entered in F04 already counts as income; the deposit that paid it is the same
 * money arriving, and counting both doubles a month's income. So what an answer
 * excludes is the bank row, never the paycheck.
 *
 * **A mismatch is surfaced rather than hidden**, because docs/f06 is right about
 * what it usually means: the payslip was typed wrong. The app has no business
 * quietly picking whichever figure it likes better, so both are reported with
 * the difference between them.
 *
 * A payslip matches **one** group. Two months of deposits cannot both claim
 * January's slip, so the older group takes it and the younger one reports having
 * no payslip — which is the honest answer and the one that sends the user to
 * enter the missing slip.
 */
export function matchSalaries(input: SalaryMatchInput): readonly SalaryGroup[] {
  const lagMonths = input.lagMonths ?? SALARY_LAG_MONTHS
  const decisions = input.decisions ?? new Map<string, SalaryDecision>()

  const byMonth = new Map<string, { period: YearMonth; rows: BankRow[]; minor: number }>()
  for (const entry of input.rows) {
    // Only inflows: a payroll *deduction* leaving the account is not a salary,
    // and `classifyBankRow` already refuses to call one that.
    const isSalary = entry.rowClass === 'SALARY' || input.filedAsSalary?.has(entry.row.ref) === true
    if (!isSalary || entry.row.amount.minor <= 0) continue
    if (entry.row.amount.currency !== input.currency) continue

    const period = yearMonthOf(entry.row.date)
    const key = toYearMonthString(period)
    const group = byMonth.get(key) ?? { period, rows: [], minor: 0 }
    group.rows.push(entry.row)
    group.minor += entry.row.amount.minor
    byMonth.set(key, group)
  }

  const ordered = [...byMonth.values()].sort((x, y) => compareYearMonths(x.period, y.period))
  const inWindow = (group: { period: YearMonth }, paycheck: PaycheckNet): boolean =>
    paycheck.net.currency === input.currency &&
    monthsBetween(paycheck.period, group.period) >= 0 &&
    monthsBetween(paycheck.period, group.period) <= lagMonths

  // **Exact figures claim their slips first, across every month** (D-317). Going
  // month by month and letting each take its nearest slip let a deposit with no
  // slip at all — the December pay in a document whose first slip is January's —
  // take January's, and every month after it was then one slip out: seven
  // deposits that each agreed to the agora, all reported as disagreeing.
  const claimed = new Set<string>()
  const chosen = new Map<string, PaycheckNet>()

  for (const group of ordered) {
    const exact = input.paychecks
      .filter((paycheck) => !claimed.has(paycheck.id) && inWindow(group, paycheck) && paycheck.net.minor === group.minor)
      .sort(
        (x, y) =>
          daysApart(x.paidOn, group.rows[0]?.date) - daysApart(y.paidOn, group.rows[0]?.date) ||
          compareYearMonths(y.period, x.period),
      )[0]
    if (exact === undefined) continue
    claimed.add(exact.id)
    chosen.set(toYearMonthString(group.period), exact)
  }

  // What is left pairs closest-first, so a deposit nobody's slip is near stays alone.
  const exactMonths = new Set(chosen.keys())
  for (;;) {
    let best: { key: string; paycheck: PaycheckNet; gap: number } | undefined
    for (const group of ordered) {
      const key = toYearMonthString(group.period)
      if (exactMonths.has(key) || chosen.has(key)) continue
      for (const paycheck of input.paychecks) {
        if (claimed.has(paycheck.id) || !inWindow(group, paycheck)) continue
        const gap = Math.abs(paycheck.net.minor - group.minor)
        if (best === undefined || gap < best.gap) best = { key, paycheck, gap }
      }
    }
    if (best === undefined) break
    claimed.add(best.paycheck.id)
    chosen.set(best.key, best.paycheck)
  }

  const groups: SalaryGroup[] = ordered.map((group) => {
    const key = toYearMonthString(group.period)
    const total = money(group.minor, input.currency)
    const paycheck = chosen.get(key)
    return {
      period: group.period,
      rows: group.rows,
      total,
      verdict: paycheck === undefined ? 'NO_PAYCHECK' : exactMonths.has(key) ? 'MATCHED' : 'DIFFERS',
      paycheckId: paycheck?.id,
      paycheckPeriod: paycheck?.period,
      net: paycheck?.net,
      difference: paycheck === undefined ? undefined : subtract(total, paycheck.net),
      decision: decisions.get(key) ?? 'PENDING',
    }
  })

  return groups
}

/**
 * The groups worth showing: a disagreement and a deposit no slip accounts for,
 * answered or not. An agreeing match is never one (D-317).
 *
 * A `DIFFERS` group stays on the list after it is answered because the answer is
 * about double-counting and the difference is about a figure being wrong — two
 * questions, and settling one does not settle the other.
 */
export function salaryQuestions(groups: readonly SalaryGroup[]): readonly SalaryGroup[] {
  return groups.filter((group) => group.verdict === 'DIFFERS' || group.verdict === 'NO_PAYCHECK')
}

/**
 * Whether a month's salary deposits are in the figure as well as the slip (D-317).
 *
 * **The slip is the figure and the deposit is what proves it**, so a deposit
 * matched to a slip, to the agora or not, is not counted: nobody has to answer
 * for it, because an answer nobody had given was a salary counted twice. Two
 * things count a deposit: the person saying so, and there being no slip for it,
 * when it is the only evidence the money came.
 */
export function salaryDepositCounts(group: SalaryGroup): boolean {
  if (group.decision === 'COUNTED') return true
  if (group.decision === 'EXCLUDED') return false
  return group.verdict === 'NO_PAYCHECK'
}

function daysApart(a: LocalDate | undefined, b: LocalDate | undefined): number {
  if (a === undefined || b === undefined) return 0
  return Math.abs(Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day))
}
