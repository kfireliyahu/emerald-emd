import type { ColumnType } from '@/domain/format/declaration.ts'

/**
 * **The type picker's two steps** — M55 U8, D-539.
 *
 * It drew every type at once — eighteen and *computed*, in the engine's words
 * (`integer`, `real`, `enum`, `enums`, `instant`). Now the common ones come
 * first, in a person's words, and the rest are one step away under four
 * headings, so no step shows them all. Which are common is the maintainer's
 * pick (draft A of three), read off how often the packs and the demo declare
 * each: text, link, enum, money and date lead, and `real` stands for a number
 * because a person typing a number means any number.
 *
 * Computed is the short list's last tile; it is drawn where the column can be
 * one, by `ColumnQuestions`, so it is not a type here. The words are
 * `TYPE_WORDS[type].shown`; the type chosen is always the declaration's word.
 */
export const COMMON_TYPES: readonly ColumnType[] = ['text', 'real', 'money', 'date', 'boolean', 'enum', 'link']

/** The rest, one step away: each heading with its types, in the order drawn. */
export const MORE_TYPES: readonly { readonly heading: string; readonly types: readonly ColumnType[] }[] = [
  { heading: 'Numbers', types: ['integer', 'decimal', 'percent', 'quantity'] },
  { heading: 'Dates and times', types: ['month', 'time', 'instant'] },
  { heading: 'Several', types: ['enums', 'links'] },
  { heading: 'Outside this document', types: ['file', 'elsewhere'] },
]

/** Whether a type is on the short list — a rare one opens the picker on the rest. */
export function isCommonType(type: ColumnType): boolean {
  return COMMON_TYPES.includes(type)
}
