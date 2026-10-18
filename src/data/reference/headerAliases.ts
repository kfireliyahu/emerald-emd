/**
 * Header-name aliases, Hebrew and English → column role.
 *
 * This is the useful residue of what used to be a "provider profile": a hint
 * source, not a parser (D-013). Being wrong here costs nothing, because the
 * user sees the live preview and corrects the mapping before anything is
 * committed. Being right here means mapping is one tap.
 *
 * Everything is compared after `normalizeHeader`, so entries are lowercase,
 * whitespace-collapsed, and free of directional marks and line breaks.
 *
 * Order matters within a role only insofar as `SPECIFICITY` below resolves
 * collisions: `סכום חיוב` and `סכום עסקה` both look like amounts, and the one
 * that actually hit the account has to win.
 */

import { normalizeHeader } from '@/core/text.ts'
import type { ColumnRole } from '@/domain/model/importing.ts'

const ALIASES: Readonly<Record<ColumnRole, readonly string[]>> = {
  // When the purchase happened. A header that *qualifies* that —
  // `תאריך עסקה מקורי` — lands here too, by containment, which is the right
  // answer: it still names the purchase date. There is no separate "original
  // date" role to take it, because a transaction has only the two dates (D-036).
  date: [
    'תאריך עסקה',
    'תאריך העסקה',
    'תאריך רכישה',
    'תאריך',
    'date',
    'transaction date',
    'purchase date',
  ],
  amount: [
    'סכום חיוב',
    'סכום החיוב',
    'סכום לחיוב',
    'סכום בשקלים',
    'סכום',
    'amount',
    'charge amount',
    'billed amount',
  ],
  // The bank pair. `חובה` and `debit` sat under `amount` until F06, standing in
  // for a role that did not exist — which was the right stand-in for a card file
  // and exactly wrong for the file that has both: a bank statement pre-filled
  // that way reads every charge and drops every deposit. They belong here now.
  debit: ['חובה', 'סכום חובה', 'debit', 'withdrawal', 'paid out'],
  credit: ['זכות', 'סכום זכות', 'credit', 'deposit', 'paid in'],
  merchant: [
    'שם בית עסק',
    'שם בית העסק',
    'בית עסק',
    'שם העסק',
    'תיאור',
    'תיאור העסקה',
    'פירוט',
    'merchant',
    'description',
    'business name',
    'payee',
  ],
  // A bank's value date is this same field — docs/04 defines `chargeDate` as
  // "the card billing date, or bank value date". Listed exactly, because it
  // contains `תאריך` and would otherwise be read as the transaction date.
  chargeDate: [
    'תאריך חיוב',
    'תאריך החיוב',
    'מועד חיוב',
    'תאריך ערך',
    'charge date',
    'billing date',
    'value date',
  ],
  currency: ['מטבע חיוב', 'מטבע', 'סוג מטבע', 'currency', 'billing currency'],
  originalAmount: [
    'סכום עסקה מקורי',
    'סכום מקורי',
    'סכום עסקה',
    'original amount',
    'transaction amount',
  ],
  // What the original amount is denominated in — the column that tells a
  // foreign purchase apart from an installment's full price, both of which sit
  // in the same "original amount" column. Max ships it; Cal does not. See D-035.
  originalCurrency: ['מטבע עסקה מקורי', 'מטבע מקורי', 'מטבע עסקה', 'original currency'],
  exchangeRate: [
    'שער המרה',
    'שער המרה ממטבע מקור/התחשבנות לש"ח',
    'שער חליפין',
    'exchange rate',
    'rate',
  ],
  providerCategory: ['קטגוריה', 'ענף', 'סוג בית עסק', 'category', 'merchant category'],
  installmentText: ['תשלומים', 'פירוט תשלומים', 'מספר תשלום', 'installments'],
  installmentSequence: ['מספר תשלום נוכחי', 'תשלום מספר', 'installment number'],
  installmentTotal: ['סך תשלומים', 'מספר תשלומים', 'total installments'],
  cardLast4: [
    '4 ספרות אחרונות של כרטיס האשראי',
    'ארבע ספרות אחרונות',
    '4 ספרות אחרונות',
    'מספר כרטיס',
    'card last 4',
    'last 4 digits',
  ],
  reference: ['אסמכתא', 'מספר אסמכתא', 'reference', 'reference number'],
  // `יתרת זכות` is a balance, not a credit column, and contains the word that
  // would otherwise claim it. Listed exactly so the exact match settles it.
  balance: ['יתרה', 'יתרה בחשבון', 'יתרת זכות', 'balance', 'running balance'],
  note: ['הערות', 'הערה', 'notes', 'note', 'remarks'],
}

/**
 * When two roles both claim a header, the higher number wins.
 *
 * The case this exists for: a Cal file has both `סכום עסקה` and `סכום חיוב`,
 * and in a foreign-currency row they differ. `amount` is the money that left
 * the account, so an exact `סכום חיוב` must not lose to a fuzzier match.
 */
const SPECIFICITY: Readonly<Partial<Record<ColumnRole, number>>> = {
  amount: 3,
  chargeDate: 3,
  originalAmount: 2,
  date: 1,
}

interface AliasHit {
  readonly role: ColumnRole
  readonly exact: boolean
  readonly aliasLength: number
}

const INDEX: ReadonlyMap<string, readonly ColumnRole[]> = buildIndex()

function buildIndex(): Map<string, ColumnRole[]> {
  const index = new Map<string, ColumnRole[]>()
  for (const [role, aliases] of Object.entries(ALIASES) as [ColumnRole, readonly string[]][]) {
    for (const alias of aliases) {
      const key = normalizeHeader(alias)
      const existing = index.get(key)
      if (existing === undefined) index.set(key, [role])
      else existing.push(role)
    }
  }
  return index
}

/**
 * The role a header cell suggests, or undefined.
 *
 * Exact matches are tried first. Only then does it fall back to containment,
 * which is what catches Max's `שער המרה ממטבע מקור/התחשבנות לש"ח` and the
 * assorted ways a provider pads a column name.
 */
export function roleForHeader(headerText: string): ColumnRole | undefined {
  const normalized = normalizeHeader(headerText)
  if (normalized === '') return undefined

  const exact = INDEX.get(normalized)
  if (exact !== undefined) return best(exact.map((role) => ({ role, exact: true, aliasLength: normalized.length })))

  const hits: AliasHit[] = []
  for (const [alias, roles] of INDEX) {
    // Require the alias to be the longer, more specific string on at least one
    // side. `סכום` matching every amount-ish column is the failure mode here.
    if (normalized.includes(alias) && alias.length >= 4) {
      for (const role of roles) hits.push({ role, exact: false, aliasLength: alias.length })
    }
  }
  return hits.length === 0 ? undefined : best(hits)
}

function best(hits: readonly AliasHit[]): ColumnRole | undefined {
  let winner: AliasHit | undefined
  for (const hit of hits) {
    if (winner === undefined || rank(hit) > rank(winner)) winner = hit
  }
  return winner?.role
}

function rank(hit: AliasHit): number {
  return (hit.exact ? 1000 : 0) + (SPECIFICITY[hit.role] ?? 0) * 100 + hit.aliasLength
}
