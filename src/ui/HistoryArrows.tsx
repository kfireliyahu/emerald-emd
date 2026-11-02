import { useEffect, useReducer, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'

import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'

/**
 * Where this entry sits in the window's history (M31 U9). React Router writes
 * `idx` into `history.state` on every entry it makes, counting from the entry
 * the app opened on; an entry it did not make has none — until `HistoryArrows`
 * counts it (M54 F5).
 */
export function historyIndex(): number | undefined {
  const state: unknown = window.history.state
  const idx = typeof state === 'object' && state !== null ? (state as { idx?: unknown }).idx : undefined
  return typeof idx === 'number' ? idx : undefined
}

/**
 * **An entry the router did not make is counted** (M54 F5). A plain `#/` link
 * (the crash screen's way home) or an address typed into a browser tab makes
 * an entry with no index, and the redirect from `/` then replaces it keeping
 * none — so Back could not tell whether there was anywhere to go, and offered
 * itself anyway. Such an entry is one past the entry before it, and is written
 * so; the router's next push counts on from it. And when it lands exactly where
 * the entry before it is — `#/` from the dashboard, redirected back to the
 * dashboard — it is stepped back over, so the redirect has replaced it and
 * Back does not walk to the same screen.
 */
function countEntry(before: { readonly at: number; readonly address: string } | undefined, address: string): 'counted' | 'stepped back' | 'known' {
  if (historyIndex() !== undefined) return 'known'
  if (before !== undefined && before.address === address) {
    window.history.back()
    return 'stepped back'
  }
  const state: unknown = window.history.state
  const kept = typeof state === 'object' && state !== null ? state : {}
  window.history.replaceState({ ...kept, idx: (before?.at ?? -1) + 1 }, '')
  return 'counted'
}

/**
 * **Back and forward, by the document's name** (M31 U9). The mouse's side
 * buttons already move through the window's history; these are the same two
 * steps for a person without them, and they go exactly where the buttons go.
 *
 * Back is possible past the first entry. Forward is possible while there are
 * entries ahead, which the History API does not tell a page: it is counted
 * here instead — a push drops everything ahead, a step back leaves it there.
 */
export function HistoryArrows() {
  const navigate = useNavigate()
  const type = useNavigationType()
  const location = useLocation() // drawn again on every move, which is when the index changes
  const before = useRef<{ at: number; address: string } | undefined>(undefined)
  const [, recount] = useReducer((count: number) => count + 1, 0)
  // Once the address has settled: a redirect replaces the entry in the same
  // pass, and an entry is counted where it lands — the window's address then,
  // which the router may not have drawn yet — not on its way there.
  useEffect(() => {
    const settled = window.setTimeout(() => {
      const address = window.location.hash.replace(/^#/, '') || '/'
      const counted = countEntry(before.current, address)
      const at = historyIndex()
      if (at !== undefined) before.current = { at, address }
      if (counted === 'counted') recount()
    }, 0)
    return () => window.clearTimeout(settled)
    // The location itself, not its key: every entry the router did not make has the key `default`.
  }, [location])

  const at = historyIndex()
  const furthest = useRef(at ?? 0)
  if (at !== undefined) furthest.current = type === 'PUSH' ? at : Math.max(furthest.current, at)

  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label="Back"
        title="Back"
        className="fc-icon-action"
        disabled={at === undefined || at === 0}
        onClick={() => navigate(-1)}
      >
        <ActionGlyph name="left" />
      </button>
      <button
        type="button"
        aria-label="Forward"
        title="Forward"
        className="fc-icon-action"
        disabled={at === undefined || at >= furthest.current}
        onClick={() => navigate(1)}
      >
        <ActionGlyph name="right" />
      </button>
    </div>
  )
}
