/**
 * **One reader for a stored JSON list of strings** (M45 F1, S-043).
 *
 * Four places keep a list of strings as JSON text — a staged row's raw cells, a
 * format intake's header cells, a text document's `links` line and a `links`
 * field's draft — and each used to read it back its own way. They agreed on
 * good input and disagreed on damaged input: one turned every item into text
 * with `String()`, so `[1, null]` came back as `["1", "null"]`, cells nobody
 * wrote. Now there is one rule, and it is the strict one: **a list of strings,
 * or nothing.** Damaged input is refused, never coerced, and each caller keeps
 * what it already did with nothing — an empty list, or a field left as typed.
 */
export function stringListOf(stored: unknown): readonly string[] | undefined {
  if (typeof stored !== 'string') return undefined
  try {
    const value: unknown = JSON.parse(stored)
    return Array.isArray(value) && value.every((each) => typeof each === 'string')
      ? (value as string[])
      : undefined
  } catch {
    return undefined
  }
}
