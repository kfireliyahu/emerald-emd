/**
 * A stored value read defensively — JSON text in a column, or a number that
 * should be whole.
 *
 * The document is a real SQLite database a person can edit in any tool, so a
 * value may be anything. Every reader here answers with the empty shape — no
 * list, no object, no number — rather than throwing: a template, a mapping or a
 * setting that no longer decodes falls back to its default, and the parse error
 * itself says nothing a person could act on.
 */

/** JSON text holding a list, as its strings; anything else, or a list with no strings, is `[]`. */
export function stringListOf(value: unknown): readonly string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

/** JSON text holding an object, as that object; an array, `null` or text that does not parse is `undefined`. */
export function objectOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** A whole number, or `undefined` for anything that is not one. */
export function integerOf(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}
