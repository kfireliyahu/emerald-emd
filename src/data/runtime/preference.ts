/**
 * A preference this copy of the app remembers — the theme, the sidebar, the
 * Plan view, a hint seen once, the tour's speed, the chosen model runtime —
 * kept in `localStorage` and never in a document (D-115, D-130): machine state
 * belongs to the machine, not to the file.
 *
 * **Every touch is allowed to fail.** A private window, a `file://` origin or a
 * blocked store has no storage, and then a choice is simply not remembered: a
 * read is nothing, which each caller turns into its default, and a write still
 * applies for this session. That is the whole bargain, which is why the errors
 * are dropped here, once, rather than at each caller.
 *
 * The keys are the callers', and they stay as they were (`fc-theme`,
 * `emerald.rowMenuHint`, …) so a remembered choice survives the build.
 */

/** The stored value, or `undefined` when there is none or nowhere to keep one. */
export function readPreference(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

/** Remember a value, or forget it with `undefined`. Not remembered when there is no storage. */
export function writePreference(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Nowhere to keep it: the choice still applies for this session.
  }
}
