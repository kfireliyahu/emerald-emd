/**
 * Hebrew and RTL text normalization.
 *
 * Produces `merchantNormalized` — the string used for matching, dedupe and
 * rules. `merchantRaw` is always kept untouched alongside it, so normalization
 * can be improved and re-run later. See docs/packs/ledger/05-domain-rules-and-calculations.md,
 * "Text normalization".
 */

/**
 * Unicode formatting characters that carry no meaning but break every string
 * comparison. Israeli statement exports are full of them: a merchant name is
 * frequently wrapped in RLM or an isolate so it renders correctly inside an
 * otherwise-LTR cell.
 */
const INVISIBLE_MARKS = /[‎‏‪-‮⁦-⁩؜​-‍﻿]/g

/** NBSP, narrow NBSP, and the rest of the Unicode space zoo. */
const EXOTIC_SPACES = /[   -   　]/g

/**
 * Trailing branch or terminal numbers, and the noise tokens that come with
 * them. Kept as data so the list can grow without touching the algorithm —
 * docs/05 calls for a maintained token list, and this is its first entry.
 */
const TRAILING_NOISE = [
  /\s+(?:סניף|ס')\s*\d+$/u,
  /\s+\d{1,5}$/u,
]

/** Strip the marks and normalize the spaces, but keep the words. Safe on any string. */
export function cleanText(value: string): string {
  return value
    .replace(INVISIBLE_MARKS, '')
    .replace(EXOTIC_SPACES, ' ')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Header cells get the same cleanup plus newline flattening.
 *
 * Cal writes its header cells with an embedded line break — `תאריך\r\nעסקה`,
 * not `תאריך עסקה`. Without this, every alias lookup for a Cal file misses.
 */
export function normalizeHeader(value: string): string {
  return cleanText(value.replace(/[\r\n]+/g, ' ')).toLocaleLowerCase('he')
}

/**
 * The matching form of a merchant name.
 *
 * Latin text is uppercased so `Paypal` and `PAYPAL` agree; Hebrew has no case
 * and is unaffected. Trailing branch numbers are stripped last, because they
 * are the part most likely to differ between two records of the same shop.
 */
export function normalizeMerchant(value: string): string {
  let result = foldText(value)
  for (const pattern of TRAILING_NOISE) {
    result = result.replace(pattern, '')
  }
  return result.trim()
}

/** Does this string contain Hebrew letters? Used by value-shape inference. */
export function containsHebrew(value: string): boolean {
  return /[֐-׿]/.test(value)
}

/** Does this string contain any letter, in any script? */
export function containsLetter(value: string): boolean {
  return /\p{L}/u.test(value)
}

/**
 * The first grapheme of a string, or `''`.
 *
 * A grapheme is not a character: a flag is two code points, a family is five
 * with joiners between them, and a skin-tone emoji is two — so `value[0]` or a
 * `slice(0, 1)` hands back half of one and renders as a box. `Intl.Segmenter`
 * does it properly. Where it is missing the whole string stands rather than
 * being cut through the middle of a surrogate pair: too long is a cosmetic
 * problem and mojibake is not.
 *
 * Written for the category icon field, which stores exactly one emoji.
 */
export function firstGrapheme(value: string): string {
  if (value === '') return ''
  const segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (segmenter === undefined) return value
  const [first] = new segmenter(undefined, { granularity: 'grapheme' }).segment(value)
  return first?.segment ?? value
}

/**
 * Text as it is compared: collapsed, cleaned and case-folded.
 *
 * Latin text is uppercased so `Paypal` and `PAYPAL` agree; Hebrew has no case
 * and is unaffected. Not `normalizeMerchant`, which goes on to strip trailing
 * digits as branch numbers — right for `שופרסל דיל 344`, wrong for a category
 * or a rule's text that ends in one.
 */
export function foldText(value: string): string {
  return cleanText(value).toLocaleUpperCase('en')
}

/** The first letter made a capital, for a phrase that begins a sentence. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Words as a sentence lists them: `a`, `a and b`, `a, b and c`.
 *
 * `empty` is what an empty list says, `''` unless the caller has a word for
 * nothing.
 */
export function listed(words: readonly string[], empty = ''): string {
  if (words.length === 0) return empty
  if (words.length === 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}

/** A run of digits with a comma every three from the right: `1234567` → `1,234,567`. */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * A count with its noun, agreeing in number: `1 row`, `3 rows`, `2 categories`.
 *
 * `many` is the plural when it is not the noun plus `s`. The count is printed
 * as `String` prints it; `digits` is for a caller that groups thousands, which
 * the plugin's answers do and the screens' short labels do not.
 */
export function plural(
  count: number,
  noun: string,
  many?: string,
  digits: (count: number) => string = String,
): string {
  return `${digits(count)} ${count === 1 ? noun : (many ?? `${noun}s`)}`
}

/**
 * **A figure as a document writes one** — the one reader of written amounts
 * the importer and the engine share (M45 F1, S-055).
 *
 * Thousands separators, accounting parentheses, and the leading or trailing
 * minus several exports here use. The caller passes what to strip first,
 * because that is the only thing the two disagreed on: the importer strips its
 * currency symbols and words (`₪`, `ש"ח`, `usd`…), and the engine strips the
 * symbols and `%`. They used to be twins kept apart on purpose, on the grounds
 * that the importer's has a card issuer's habits in it and the engine may not
 * reach into the pack. The habits were all in the strip set; the rest was the
 * same twenty lines, and `@/core/` is the place both may reach.
 *
 * `undefined` rather than a guess when it does not parse.
 */
export function parseFigureText(text: string, strip: RegExp): number | undefined {
  let value = cleanText(text).replace(strip, '').trim()
  if (value === '') return undefined

  let negative = false
  if (/^\(.*\)$/.test(value)) {
    negative = true
    value = value.slice(1, -1).trim()
  }
  if (value.endsWith('-')) {
    negative = true
    value = value.slice(0, -1).trim()
  } else if (value.startsWith('-')) {
    negative = true
    value = value.slice(1).trim()
  }

  value = value.replace(/[\s,]/g, '')
  if (!/^\d*\.?\d+$/.test(value)) return undefined

  const magnitude = Number(value)
  if (!Number.isFinite(magnitude)) return undefined
  return negative ? -magnitude : magnitude
}
