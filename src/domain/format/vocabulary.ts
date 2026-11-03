import { COLUMN_TYPES, type ColumnType } from './declaration.ts'

/**
 * **What each of the types is, in words a person can read** — M20 U3.
 *
 * The bar for this unit was *something to help the user feel like he
 * knows what he's doing*, and a `<select>` reading `text integer real date
 * boolean enum money link quantity` is the opposite of that. Three of those
 * words are jargon (`real`, `enum`, `quantity`), one is a relation rather than
 * a value (`link`), and one compiles to two columns without saying so
 * (`money`).
 *
 * **The stored word never changes.** A screen that wrote `decimal` where a
 * conversation wrote `real` would be a second vocabulary for the same language,
 * and the half a person typed into a screen would stop matching the half a
 * conversation wrote — which is precisely the drift M20's parity rule exists to
 * stop, and precisely what D-227 caught between the editor and
 * `declare_format`. So the declaration's word is the one kept, and what this
 * file adds beside it is a sentence, an example — and, since M55 U8 (D-539),
 * the name the type picker shows a person (`shown`: *Whole number*, never
 * `integer`), one per type and never written down.
 *
 * **It lives in the domain because both surfaces read it.** The editor draws a
 * tile per type from these rows; `declare_format`'s description is generated
 * from the same rows rather than written a second time in prose. That is not
 * tidiness — the hand-written list in the plugin had gone stale, naming seven
 * of the nine and leaving `link` and `quantity` out of the enumeration, and a
 * tool description is the only documentation a model gets.
 *
 * No React, no DOM, no sql.js — it is a table of strings, and
 * `boundary.test.ts` is what keeps it that way.
 */
export interface TypeWords {
  /**
   * What a screen calls the type (M55 U8, D-539) — the maintainer's pick of
   * three drafts. Shown, never stored: the declaration keeps the word.
   */
  readonly shown: string
  /** One sentence. What a column of this type holds. */
  readonly gloss: string
  /** A column a person might actually declare with it, `snake_case`. */
  readonly like: string
  /**
   * The thing about this type that surprises somebody who picked it, or
   * nothing. Two of the nine compile to two columns and one is a relation;
   * those are the three a person finds out about afterwards otherwise.
   */
  readonly catch?: string
}

export const TYPE_WORDS: Readonly<Record<ColumnType, TypeWords>> = {
  text: {
    shown: 'Text',
    gloss: 'Words. A name, a note, a code — anything not measured.',
    like: 'brand',
  },
  integer: {
    shown: 'Whole number',
    gloss: 'A whole number, with no fractional part at all.',
    like: 'servings',
  },
  real: {
    shown: 'Number',
    gloss: 'A number that can have a fractional part.',
    like: 'weight_g',
  },
  date: {
    shown: 'Date',
    gloss: 'A day. No time of day and no timezone, ever.',
    like: 'bought_on',
  },
  boolean: {
    shown: 'Yes or no',
    gloss: 'True or false, and nothing in between.',
    like: 'opened',
  },
  enum: {
    shown: 'Choice',
    gloss: 'One of a list of words you write down here.',
    like: 'shelf',
    catch:
      'Each value is any text — spaces, emoji, any language — listed once. A row may send any case; it is stored as written, and anything else is refused.',
  },
  money: {
    shown: 'Money',
    gloss: 'An amount of money, in a currency the row names.',
    like: 'price',
    catch: 'Becomes two columns — minor units and a currency — so it is never a float.',
  },
  link: {
    shown: 'Link',
    gloss: 'A row of another format.',
    like: 'ingredient',
    catch: 'An equation here may read one column of the row it names, and no further.',
  },
  links: {
    shown: 'Several links',
    gloss: 'Several rows of another format, in order.',
    like: 'blocked_by',
    catch: 'Written as a list of row names or ids. An equation reads it only by an aggregate.',
  },
  enums: {
    shown: 'Several choices',
    gloss: 'Several of a list of words you write down here — tags, allergens.',
    like: 'tags',
    catch:
      'Written as a list — ["vegan", "quick"]. Each member is checked against the list, and one outside it is refused by name.',
  },
  quantity: {
    shown: 'Quantity',
    gloss: 'A figure and the unit that row is in — 150 g here, 200 ml there.',
    like: 'amount',
    catch: 'Two columns. If every row shares one unit, a real with a unit is simpler.',
  },
  decimal: {
    shown: 'Exact decimal',
    gloss: 'A number kept to a fixed count of places — a rate, a unit price.',
    like: 'rate',
    catch:
      'Needs a scale, the places it keeps (1 to 9). Written as a string, "3.5"; extra places are refused, never rounded.',
  },
  percent: {
    shown: 'Percentage',
    gloss: 'A share, shown as 12.5% — a VAT rate, a fee.',
    like: 'vat',
    catch: 'Typed 87, "87%" or 0.87 — each 87%; 1 is 1%, "0.5%" half of one. Four places. A claim reads 0.87.',
  },
  month: {
    shown: 'Month',
    gloss: 'A month, as YYYY-MM. A period, not a day in it.',
    like: 'billing_period',
  },
  time: {
    shown: 'Time of day',
    gloss: 'A time of day, HH:MM — a shift start.',
    like: 'start',
    catch: 'Typed "09:30", "1430" or "2:30pm". end - start of two is hours, past midnight too.',
  },
  elsewhere: {
    shown: 'Row in another document',
    gloss: 'A row in another document — its path, then the row’s name.',
    like: 'about',
    catch:
      'Written "F:/projects/site/site.emd S1 U5". Never refused for being out of reach: read back, it says what the row holds now, or that it is unresolved.',
  },
  file: {
    shown: 'File',
    gloss: 'A file on this computer, by its path.',
    like: 'scan',
    catch: 'Or a local app’s address; never http.',
  },
  instant: {
    shown: 'Date and time',
    gloss: 'A moment, kept in UTC to the millisecond.',
    like: 'committed_at',
    catch: 'Written with its offset — 2026-09-23T14:05:00Z. A time with no zone is refused.',
  },
}

/** `text · integer · real · …`, for a sentence that has to name them all. */
export function wordsForTypes(): string {
  return COLUMN_TYPES.map((type) => `\`${type}\``).join(', ')
}

/**
 * Every type, one line each, for a tool description.
 *
 * Generated rather than written, so the day a tenth type is added the model is
 * told about it by the same edit that adds it. The `catch` is included because
 * it is the half a caller gets wrong: a model that does not know `money`
 * becomes two columns writes a float into a document that has no float in it.
 */
export function typeBriefing(): string {
  return COLUMN_TYPES.map((type) => {
    const words = TYPE_WORDS[type]
    const tail = words.catch === undefined ? '' : ` ${words.catch}`
    return `\`${type}\` — ${words.gloss}${tail}`
  }).join(' ')
}
