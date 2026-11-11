import type { MessageKey } from './catalogue.ts'

/**
 * **A word that counts** — M60 U4 (D-589). A count is two words in the
 * catalogue, `one` and `other`, beside each other: `rows: { one: '1 row',
 * other: '{count} rows' }`, and `rows: { one: 'שורה אחת', other: '{count} שורות' }`
 * in Hebrew. `t(countKey('transactions.rows', n), { count: n })` picks the one
 * the count wants — never `n === 1 ? 'row' : 'rows'` in a screen, which only
 * English reads.
 *
 * Hebrew has a dual (*יומיים*), but a counted thing on a screen says
 * *2 שורות* as readily as *שתי שורות*, so two words are enough.
 */
export type CountKey = { [K in MessageKey]: K extends `${infer P}.other` ? (`${P}.one` extends MessageKey ? P : never) : never }[MessageKey]

/** The key of the word a count wants: `….one` for 1, `….other` for every other count. */
export function countKey(key: CountKey, count: number): MessageKey {
  return `${key}.${count === 1 ? 'one' : 'other'}` as MessageKey
}
