/**
 * A default name for a mapping the user is about to save — "Cal – Visa 1234",
 * in the shape docs/f01-card-statement-import.md asks for.
 *
 * A suggestion, nothing more: it lands in an editable field, and the user is
 * the one who knows what to call their own card. What it has to be is
 * *recognisable a year later*, which "Sheet1" and "transaction-details_export"
 * are not.
 *
 * Everything here reads the file's preamble — the rows above the header, which
 * are exactly the human-facing prose the mapper otherwise ignores. Neither real
 * file names its issuer anywhere, so the tokens that actually fire are the bank
 * and the card product: `9876-Gold VISA` in the Max export, `מרכנתיל
 * דיסקונט … לכרטיס ויזה … המסתיים ב-4321` in the Cal one.
 */

import { cleanText } from '@/core/text.ts'
import type { SheetTable } from './sheetTable.ts'

/** How much of the preamble to read. The header sits on row 4 in both real files. */
const MAX_PREAMBLE_ROWS = 8

/** Beyond this a name stops being a label and starts being a paragraph. */
const MAX_NAME_LENGTH = 60

interface Token {
  readonly label: string
  readonly patterns: readonly RegExp[]
}

/**
 * Issuers, banks and card products, most specific first.
 *
 * Order is doing real work: `לאומי קארד` is Max and must be tested before
 * `לאומי` the bank, and `מרכנתיל דיסקונט` is Mercantile rather than Discount.
 * Latin tokens are anchored on word boundaries — an unanchored `cal` matches
 * "local" and would name every mapping after a merchant.
 */
const PROVIDERS: readonly Token[] = [
  { label: 'Cal', patterns: [/\bcal\b/i, /כאל/, /כרטיסי אשראי לישראל/] },
  { label: 'Max', patterns: [/\bmax\b/i, /מקס/, /לאומי קארד/, /\bleumi ?card\b/i] },
  { label: 'Isracard', patterns: [/\bisracard\b/i, /ישראכרט/] },
  { label: 'Amex', patterns: [/\bamex\b/i, /american express/i, /אמריקן אקספרס/] },
  { label: 'Mercantile', patterns: [/\bmercantile\b/i, /מרכנתיל/] },
  { label: 'Discount', patterns: [/\bdiscount\b/i, /דיסקונט/] },
  { label: 'Hapoalim', patterns: [/\bhapoalim\b/i, /הפועלים/] },
  { label: 'Leumi', patterns: [/\bleumi\b/i, /לאומי/] },
  { label: 'Mizrahi', patterns: [/\bmizrahi\b/i, /מזרחי/] },
]

const BRANDS: readonly Token[] = [
  { label: 'Visa', patterns: [/\bvisa\b/i, /ויזה/] },
  { label: 'Mastercard', patterns: [/\bmaster ?card\b/i, /מאסטרקארד/, /מסטרקארד/] },
  { label: 'Diners', patterns: [/\bdiners\b/i, /דיינרס/] },
]

/**
 * Four digits that are a card number rather than a year, an ID or a branch.
 *
 * The trailing pattern wants a card word in front of it, which is what
 * separates `המסתיים ב-4321` from the `100-00000000` account number two words
 * earlier. The leading one catches Max's `9876-Gold VISA`, where the
 * digits come first.
 */
const LAST4_AFTER_CARD_WORD =
  /(?:ויזה|visa|כרטיס|card|מסתיים ב|ending(?: in)?|ends? with)\s*[-‑–]?\s*(\d{4})(?!\d)/i

const LAST4_LEADING = /(?<!\d)(\d{4})\s*[-‑–]\s*[A-Za-z֐-׿]/

/**
 * Whether the text is talking about a card at all.
 *
 * The leading pattern is shape alone — four digits, a dash, a letter — which
 * `2026 - יוני` also is. Requiring a card word somewhere keeps a filename that
 * merely starts with a year from being read as a card number. It costs nothing
 * on the files that matter: `9876-Gold VISA` says VISA.
 */
const CARD_WORD = /ויזה|visa|מאסטרקארד|מסטרקארד|כרטיס|card|מסתיים ב/i

export interface MappingNameInput {
  readonly fileName: string
  readonly table: SheetTable
  readonly headerRowIndex: number
  /** From a mapped card-last-4 column, when the format has one. Trusted over the preamble. */
  readonly cardLast4?: string | undefined
}

export function defaultMappingName(input: MappingNameInput): string {
  const text = scannableText(input)

  // The footer too, for the provider only: one bank's report names itself
  // nowhere above its header and only in the address line under its rows. The
  // card number is never looked for there (M28 F11).
  const provider = firstMatch(PROVIDERS, text) ?? firstMatch(PROVIDERS, footerText(input.table))
  const brand = firstMatch(BRANDS, text) ?? 'Card'
  const last4 = input.cardLast4 ?? findLast4(text)

  const left = provider ?? fileStem(input.fileName)
  const right = last4 === undefined ? undefined : `${brand} ${last4}`

  const name = right === undefined ? left : `${left} – ${right}`
  return truncate(name === '' ? input.table.name : name)
}

/** The filename, the sheet name, and the preamble prose above the header. */
function scannableText(input: Omit<MappingNameInput, 'cardLast4'>): string {
  const parts = [input.fileName, input.table.name]

  const depth = Math.min(input.headerRowIndex, MAX_PREAMBLE_ROWS)
  for (let rowIndex = 0; rowIndex < depth; rowIndex++) {
    for (const cell of input.table.rows[rowIndex] ?? []) {
      if (cell.kind !== 'empty') parts.push(cell.text)
    }
  }

  return cleanText(parts.join(' '))
}

function firstMatch(tokens: readonly Token[], text: string): string | undefined {
  for (const token of tokens) {
    if (token.patterns.some((pattern) => pattern.test(text))) return token.label
  }
  return undefined
}

function findLast4(text: string): string | undefined {
  const stated = LAST4_AFTER_CARD_WORD.exec(text)?.[1]
  if (stated !== undefined) return stated
  if (!CARD_WORD.test(text)) return undefined
  return LAST4_LEADING.exec(text)?.[1]
}

/**
 * The card's last four digits as the file itself states them — in its name, its
 * sheet name, or the preamble above the header.
 *
 * Split out of the naming because it answers a second, heavier question: which
 * card these rows belong to. The mapper only ever knew a card number that
 * arrived in a mapped *column*, and neither real file has one — both state it
 * in prose. Without this the account falls back to being identified by file
 * name, and `…4321 - 08.08.26.xlsx` and `…4321 - 08.08.26 (1).xlsx` are two
 * different names for one card. See D-033.
 */
export function statedCardLast4(input: Omit<MappingNameInput, 'cardLast4'>): string | undefined {
  return findLast4(scannableText(input))
}

/**
 * The file's name without what changes every month — its dates, a date range,
 * an export's running number (M28 F11). A reader named
 * `דוח תנועות בחשבון 01.01.26-01.03.26` named the bank account after one export,
 * and the next export's account after another.
 */
function fileStem(fileName: string): string {
  const stem = cleanText(fileName.replace(/\.[^.]+$/, ''))
  const steady = cleanText(
    stem
      .replace(/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/g, ' ')
      .replace(/\d{6,}/g, ' ')
      .replace(/(?:\s*[-–_]\s*)+$/g, '')
      .replace(/[_\s]+$/g, ''),
  )
  return steady === '' ? stem : steady
}

/**
 * The prose under the last row: a run of trailing rows with one cell each,
 * which is what an address line or a disclaimer is and a transaction never is.
 */
function footerText(table: SheetTable): string {
  const parts: string[] = []
  for (let index = table.rows.length - 1; index >= 0 && parts.length < 3; index--) {
    const filled = (table.rows[index] ?? []).filter((cell) => cell.kind !== 'empty' && cell.text.trim() !== '')
    if (filled.length === 0) continue
    if (filled.length > 1) break
    parts.push(filled[0]?.text ?? '')
  }
  return cleanText(parts.join(' '))
}

function truncate(name: string): string {
  return name.length <= MAX_NAME_LENGTH ? name : `${name.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`
}
