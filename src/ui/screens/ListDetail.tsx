import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate, useOutlet, useOutletContext, useResolvedPath } from 'react-router-dom'

import { historyIndex } from '@/ui/HistoryArrows.tsx'
import { EASING, MOTION_MS, motionOn } from '@/ui/motion/motion.ts'
import { LAYOUT_MOTION } from '@/ui/motion/settle.ts'
import { useWindowTaken } from '@/ui/useFullWindow.ts'

/**
 * A list, and the thing it names, in one window (D-130).
 *
 * Every detail screen in this app was a *navigation* away from the list that
 * named it — open a fund, lose the other eleven; go back, find your place
 * again. That is a browser habit rather than a decision, and it is the habit
 * this milestone had the width to drop: the window sets its own minimum size
 * now, so there is room for both.
 *
 * **The routes did not change** (D-031's rule, for the fourth time in this
 * milestone). `#/wealth/funds/3` is the same hash it was; what changed is that
 * it is a child route rather than a sibling, so the list stays mounted beside
 * it. A bookmark still opens the fund, and now it opens the fund *in* its list.
 *
 * When there is no child route the list simply has the whole width, which is
 * why this is a layout and not a two-pane component: the second pane does not
 * exist until a URL asks for it.
 *
 * **And the reverse, when the detail starts a flow** (D-163). A fund reading is
 * a dozen figures copied off paper, and the pane gave them 372px to be copied
 * into — three columns of about 100px for fields holding ₪1,234,567, because
 * Tailwind's breakpoints are the *viewport's* and did not know they were inside
 * a 30rem pane — with eleven other funds beside them competing for the eye.
 * While a `FlowFrame` is mounted the pane is the whole window and the list is
 * not rendered at all: unmounted rather than hidden, because a list that keeps
 * re-reading the document behind a form is work nobody asked for.
 *
 * **The pane keeps its place in the tree, which is the whole trick.** Returning
 * a different shape for the taken case would put the detail at a different
 * position, React would unmount and remount it, and the flow's state — the
 * half-typed reading — would go with it. Since the flow is what claims the
 * window, losing it releases the claim, which brings the list back, which
 * remounts the detail again: a loop, and one that would have looked like a
 * flicker rather than like a bug. So the list is what disappears, the `<aside>`
 * stays exactly where it was, and only its width changes.
 */
/**
 * **The lists that open a pane beside them**, by path — what `App.tsx`'s
 * routes nest a detail under with `ListDetail`. A route added there is added
 * here, or opening its pane remounts the whole screen.
 */
const LISTS = ['/wealth/funds', '/wealth/goals', '/wealth/debts'] as const

/**
 * **The screen an address is on** (M39 U3): a list's own path for its detail
 * (`/wealth/funds/3` is the funds screen with its pane open), and the address
 * itself for everything else. The routed views are keyed by it, so opening or
 * closing a pane is the pane arriving or going — never the screen remounting
 * and fading in again under the reader.
 */
export function screenOf(pathname: string): string {
  // **An entry is a pane beside its format's list** (M37 U2b): paging from one
  // entry to the next is the entry arriving, never the list remounting under
  // the reader with its scroll and its search box's focus lost.
  const entry = /^(\/formats\/[^/]+\/entry)\/[^/]+$/.exec(pathname)
  if (entry?.[1] !== undefined) return entry[1]
  return LISTS.find((list) => pathname.startsWith(`${list}/`)) ?? pathname
}

/**
 * The history entry a list was last showing on, by the list's path. Outside the
 * component, so a list mounted afresh — a tab switched away and back — still
 * knows it.
 */
let listEntry: { readonly path: string; readonly at: number } | undefined

export function ListDetail({ children, overlay = false }: { children: ReactNode; overlay?: boolean }) {
  const taken = useWindowTaken()
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * **Putting the pane away goes back to the list's own entry** (M31 U9). It
   * used to navigate *to* the list, which pushed a second list entry after the
   * pane's — so Back, pressed to leave the screen, opened the pane again. Now
   * it steps back to the entry the list was on, and the history reads list,
   * then whatever came before it. A pane that opened with no list entry behind
   * it (a link from Home) is replaced by the list instead. The list's entry is
   * the earliest it has been on since the window came to it — the goal drawer's
   * Edit swaps the pane's own entry for the list's form and back, which is not
   * a new list entry — and is forgotten when the window leaves the list.
   * (`useNavigationType` cannot say which: inside the app's `<Routes>`, which
   * are handed a location, every change reads as a pop.)
   */
  const list = useResolvedPath('.').pathname
  const close = (): void => {
    const here = historyIndex()
    if (listEntry?.path === list && here !== undefined && here > listEntry.at) navigate(listEntry.at - here)
    else navigate('.', { replace: true })
  }
  const detail = useOutlet({ closePane: close } satisfies Pane)
  const showing = detail !== null

  /**
   * **The pane makes its room** (M39 U3): beside the list, opening, its width
   * grows from nothing and the list narrows as it does rather than at once —
   * motion (2), the layout reshaping. Closing is `closing.ts`'s (`data-motion-close`):
   * the pane fades out of its room while the list takes the width back. The
   * drawer over the list pops in and fades out (`fc-pop-enter`), and a flow that
   * has the whole window does neither.
   */
  const pane = useRef<HTMLElement>(null)
  const beside = !overlay && !taken
  const was = useRef(showing)
  useLayoutEffect(() => {
    // Opened here, not arrived with: a screen opened on a fund fades in whole.
    const opened = showing && !was.current
    was.current = showing
    const element = pane.current
    if (!opened || !beside || element === null || !motionOn()) return
    const width = element.offsetWidth
    const opening = element.animate(
      [
        { width: '0px', minWidth: '0px', opacity: 0 },
        { width: `${String(width)}px`, minWidth: `${String(width)}px`, opacity: 1 },
      ],
      { duration: MOTION_MS, easing: EASING, id: LAYOUT_MOTION },
    )
    return () => opening.cancel()
    // Only when the pane appears: switching from one fund to the next keeps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing])
  useEffect(() => {
    const at = historyIndex()
    if (showing || at === undefined) return
    if (listEntry?.path === list && listEntry.at < at) return
    listEntry = { path: list, at }
  }, [showing, list, location.key])
  // Forgotten once the window has left this list for somewhere else.
  useEffect(
    () => () => {
      if (!window.location.hash.startsWith(`#${list}`)) listEntry = undefined
    },
    [list],
  )

  // An overlay is dismissed with Escape, as the mockup's drawer is (M28 U8).
  const open = overlay && showing
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  return (
    <div className="relative flex h-full min-w-0">
      {!taken && <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>}

      {open && !taken && (
        // A scrim under the drawer, so what is behind it reads as behind (M28 F10: the drawer was
        // see-through, `bg-bg` being no token at all). A click on it puts the drawer away.
        <div
          aria-hidden
          data-motion-close
          onClick={close}
          className="absolute inset-0 z-[14] bg-[rgb(0_0_0/0.32)]"
        />
      )}
      {detail !== null && (
        <aside
          ref={pane}
          data-motion-close={beside ? '' : undefined}
          // Wide enough for a figure row and a table of readings, capped as a
          // share so it can never crush the list it belongs to — at the
          // window's minimum width the list still gets more than half. And the
          // whole window, with no rule down its side, while a flow has it.
          className={
            taken
              ? 'flex min-h-0 min-w-0 flex-1 flex-col'
              : overlay
                ? // Over the list rather than beside it: the list keeps its whole width, which a table of
                  // seven columns needs, and the drawer is something you look at and put away.
                  'fc-pop-enter absolute top-0 right-0 bottom-0 z-[15] flex min-h-0 w-[30rem] max-w-full flex-col border-l border-hairline-strong bg-background shadow-pop'
                : 'fc-view-enter flex min-h-0 w-[30rem] max-w-[45%] min-w-[20rem] shrink-0 flex-col border-l border-hairline'
          }
          aria-label={overlay ? 'Details' : undefined}
        >
          {/* Keyed by its address: another fund is another detail, arriving with
              its own fade and none of the last one's half-typed state — which is
              what remounting the whole screen used to give it for free. */}
          <Fragment key={location.pathname}>{detail}</Fragment>
        </aside>
      )}
    </div>
  )
}

interface Pane {
  readonly closePane: () => void
}

/** The pane's way out, for a detail drawn inside `ListDetail` — see `close` there. */
export function useClosePane(): () => void {
  return useOutletContext<Pane>().closePane
}

/**
 * The detail pane's way out, and the one verb for it.
 *
 * The three details each had their own: a `← Savings` back-link, a `← Debts`
 * back-link, and a `Funds /` breadcrumb beside a Close button. A back-link is
 * what you write when the list is somewhere else; the list is *beside* this
 * now, so the only thing the control does is shut the pane, and all three say
 * so the same way. It steps back to the list's entry rather than adding one
 * (M31 U9), so the browser's own Back leaves the screen afterwards.
 */
export function ClosePane() {
  const close = useClosePane()
  return (
    <button
      type="button"
      onClick={close}
      title="Close this pane"
      className="ml-auto shrink-0 rounded px-2 py-0.5 text-caption text-ink-tertiary transition-colors duration-[var(--duration-micro)] hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      Close
    </button>
  )
}
