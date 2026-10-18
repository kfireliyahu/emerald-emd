import { useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'

import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'

/**
 * Where this entry sits in the window's history (M31 U9). React Router writes
 * `idx` into `history.state` on every entry it makes, counting from the entry
 * the app opened on; an entry it did not make has none.
 */
export function historyIndex(): number | undefined {
  const state: unknown = window.history.state
  const idx = typeof state === 'object' && state !== null ? (state as { idx?: unknown }).idx : undefined
  return typeof idx === 'number' ? idx : undefined
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
  useLocation() // drawn again on every move, which is when the index changes
  // An entry the router did not make carries no index; Back stays offered there.
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
        disabled={at === 0}
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
