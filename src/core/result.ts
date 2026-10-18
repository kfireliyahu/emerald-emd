/**
 * A typed success-or-failure value.
 *
 * Domain operations that can fail return one of these rather than throwing.
 * The import path is the reason: one bad row must never abort a 400-row
 * statement, and every failure has to be displayable next to the row that
 * caused it. See docs/02-architecture.md, "Error handling".
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
