/**
 * **What a typed cell will be kept as, shown while it is typed** — M29 F3,
 * D-344.
 *
 * From M29's review: *"percentage should autocomplete to percentage
 * e.g 100% and accept 0.87 … time should also autocomplete and accept 24 hours
 * clock or am pm."* A field that takes `0.87`, `230pm` or `1430` is a field
 * whose reading a person cannot see until they leave it — so the reading is
 * drawn beside what they type, faint, and the field becomes it when they leave.
 *
 * **It is the engine's own reading, not a second one.** `readPercent` and
 * `parseTime` are what `coerceValue` runs for the sheet, the entry page and
 * `record_format_rows` alike; this only says what they said, before the write.
 * A field whose hint and whose write disagreed would be D-138 drawn on screen.
 *
 * Imports nothing but the readings, so a screen can ask it without asking
 * anything else.
 */

import { clockRange, parseClockWords } from './clock.ts'
import type { ColumnType } from './declaration.ts'
import { formatStoredPercent, readPercent } from './percent.ts'
import { parseTime } from './span.ts'

/**
 * What a field shows beside its text: the rest of it (`%` after `87`), or the
 * whole reading when the text is not its start (`87%` for `0.87`).
 */
export interface Completion {
  /** The text that is kept: `87%`, `14:30`. */
  readonly kept: string
  /** Only what is missing from the end of the typed text, when that is all: `%`. */
  readonly rest: string | undefined
}

/**
 * What `typed` will be kept as in a column of this type, when that is not
 * already what it says — or nothing: a type with no reading to show, an empty
 * field, a text that will be refused (the refusal is the sentence's, on write),
 * or a text that is already the kept form.
 */
export function completionOf(type: ColumnType, typed: string, today?: string): Completion | undefined {
  const text = typed.trim()
  if (text === '') return undefined
  const kept = keptAs(type, text, today)
  if (kept === undefined || kept === text) return undefined
  return { kept, rest: kept.startsWith(text) ? kept.slice(text.length) : undefined }
}

/**
 * The field's text once a person leaves it: the kept form when the text reads,
 * and the text as it was when it does not — a refused figure is left for its
 * sentence to name, never cleared or guessed at.
 */
export function settledText(type: ColumnType, typed: string, today?: string): string {
  return completionOf(type, typed, today)?.kept ?? typed
}

/**
 * **A date typed as a word that names one day** — M55 U5, D-545: `today`,
 * `yesterday` or `tomorrow`, worked out against `today` (`YYYY-MM-DD`), the
 * words a date's default may already be (D-536). Nothing for any other text:
 * a date is otherwise typed as `YYYY-MM-DD`, and anything else is refused by
 * its sentence on write.
 */
export function dayOfWord(text: string, today: string): string | undefined {
  const window = parseClockWords(text.trim())
  if (window === undefined || !ONE_DAY.has(window.kind)) return undefined
  return clockRange(window, today)?.from
}

const ONE_DAY: ReadonlySet<string> = new Set(['TODAY', 'YESTERDAY', 'TOMORROW'])

function keptAs(type: ColumnType, text: string, today: string | undefined): string | undefined {
  if (type === 'date') return today === undefined ? undefined : dayOfWord(text, today)
  if (type === 'percent') {
    const read = readPercent(text)
    return read.ok ? formatStoredPercent(read.value) : undefined
  }
  if (type === 'time') {
    const read = parseTime(text)
    return read.ok ? read.value : undefined
  }
  return undefined
}
