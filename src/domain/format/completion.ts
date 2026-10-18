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
export function completionOf(type: ColumnType, typed: string): Completion | undefined {
  const text = typed.trim()
  if (text === '') return undefined
  const kept = keptAs(type, text)
  if (kept === undefined || kept === text) return undefined
  return { kept, rest: kept.startsWith(text) ? kept.slice(text.length) : undefined }
}

/**
 * The field's text once a person leaves it: the kept form when the text reads,
 * and the text as it was when it does not — a refused figure is left for its
 * sentence to name, never cleared or guessed at.
 */
export function settledText(type: ColumnType, typed: string): string {
  return completionOf(type, typed)?.kept ?? typed
}

function keptAs(type: ColumnType, text: string): string | undefined {
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
