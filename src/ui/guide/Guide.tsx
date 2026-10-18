import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  doneCount,
  forwardLabel,
  isDone,
  move,
  resumeAt,
  stepState,
  type GuideStep,
} from '@/domain/guide.ts'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Tag } from '@/ui/wealth/parts.tsx'

import { currentGuideOpen, landOn, setGuideOpen, useGuideOpen } from './guideState.ts'
import { reopenedFrom, useGuide, type OpenGuide } from './useGuide.ts'

/**
 * **Guide me** — a small dialog that walks the real screens (M28 U9, D-330),
 * ported from `docs/mockups/m28-u9/guide.html`.
 *
 * It sits beside the place it explains, never over it, with an outline round
 * the place and no scrim (S6): the screen underneath stays live, and doing the
 * thing on it is what ticks the step (choice b, A). ← and → move, Esc puts it
 * away (S3), and none of them fires while a field has the typing.
 *
 * `enabled` is the window's own rule: nothing floats over an import or a flow
 * that has the window.
 */
export function Guide({ enabled }: { readonly enabled: boolean }) {
  const open = useGuideOpen()
  const location = useLocation()
  const offering = enabled && open === undefined && location.pathname === '/'
  const guide = useGuide(enabled && open !== undefined)
  const offer = useGuide(false)
  const [toast, setToast] = useState<string | undefined>()

  useEffect(() => {
    if (toast === undefined) return
    const timer = window.setTimeout(() => setToast(undefined), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const toastNode = toast === undefined ? null : (
    <div data-motion-close className="fc-view-enter fc-guide-toast" role="status">
      {toast}
    </div>
  )

  if (!enabled) return createPortal(toastNode, document.body)

  if (open === undefined) {
    if (!offering || offer === undefined || offer.progress.offered) return createPortal(toastNode, document.body)
    return createPortal(
      <>
        <Offer guide={offer} onToast={setToast} />
        {toastNode}
      </>,
      document.body,
    )
  }

  if (guide === undefined) return createPortal(toastNode, document.body)
  return createPortal(
    <>
      <Walk guide={guide} onToast={setToast} />
      {toastNode}
    </>,
    document.body,
  )
}

/** A new document, asked once: walk through where things go? */
function Offer({ guide, onToast }: { readonly guide: OpenGuide; readonly onToast: (text: string) => void }) {
  const dialog = useRef<HTMLDivElement>(null)
  usePlacement(dialog, undefined, 'home.title', 0)

  const notNow = (): void => {
    guide.save({ ...guide.progress, offered: true })
    onToast('Guide me is the compass at the foot of the sidebar, and on Home’s Getting started line.')
  }
  const start = (): void => {
    guide.save({ ...guide.progress, offered: true, started: true })
    setGuideOpen({ kind: 'resume' })
  }

  return (
    <div ref={dialog} className="fc-guide fc-pop-enter" role="dialog" aria-label="Guide me" style={HIDDEN}>
      <div className="flex items-center gap-2.5 border-b border-hairline py-2 pr-2 pl-3.5">
        <span className="fc-label flex flex-1 items-center gap-1.5">
          <ActionGlyph name="guide" size={14} /> Guide me
        </span>
        <CloseButton label="Not now" onClick={notNow} />
      </div>
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <h3 className="m-0 text-[15px] leading-[1.3] font-medium text-balance">A new document. Walk through where things go?</h3>
        <p className="m-0 text-[13px] text-ink-secondary">
          {guide.steps.length} places on the real screens: statements and paychecks, your categories and shops, the bills, the plan, and
          what is in the bank. Stop whenever you like; it picks up where you left it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-2 pb-3">
        <Button variant="primary" size="sm" icon="guide" onClick={start}>
          Guide me
        </Button>
        <Button variant="ghost" size="sm" onClick={notNow}>
          Not now
        </Button>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-ink-tertiary">{reopenedFrom()}, any time</span>
      </div>
    </div>
  )
}

/** The walk itself: one step at a time, on the step's own screen. */
function Walk({ guide, onToast }: { readonly guide: OpenGuide; readonly onToast: (text: string) => void }) {
  const open = useGuideOpen()
  const navigate = useNavigate()
  const location = useLocation()
  const { steps, checks, progress } = guide
  const count = steps.length

  // Resolve "where it stopped" once, into a step: from here on the guide moves by index.
  useEffect(() => {
    if (open?.kind === 'resume') setGuideOpen({ kind: 'step', index: resumeAt(steps, checks, progress) })
  }, [open, steps, checks, progress])

  const index = open?.kind === 'step' ? Math.min(Math.max(open.index, 0), count - 1) : undefined
  const step = index === undefined ? undefined : steps[index]

  // The step stands on its own route: going to a step goes to its screen.
  const route = step?.route
  useEffect(() => {
    if (index === undefined || route === undefined) return
    // Only when the step changes — a person who walks off to another screen is
    // let walk, and so is one a flow handed back somewhere else (`landOn`).
    if (landOn(index) && location.pathname !== route) navigate(route)
  }, [route, index])

  const finish = useCallback((): void => {
    const all = doneCount(steps, checks) === count
    guide.save({ ...progress, offered: true, started: true, step: undefined })
    setGuideOpen(undefined)
    navigate('/')
    onToast(
      all
        ? `All ${numberWord(count)} places done.`
        : progress.lineAway
          ? `The guide is done. What you skipped stays under ${reopenedFrom()}.`
          : 'The guide is done. What you skipped stays on Home’s Getting started line.',
    )
  }, [steps, checks, count, guide, progress, navigate, onToast])

  const go = useCallback(
    (target: number): void => {
      if (target < 0) return
      if (target >= count) {
        finish()
        return
      }
      setGuideOpen({ kind: 'step', index: target })
    },
    [count, finish],
  )

  const putAway = useCallback((): void => {
    if (step === undefined) return
    guide.save({ ...progress, offered: true, started: true, step: step.id })
    setGuideOpen(undefined)
    // **Only the guide goes** (M28 F14): it used to take you Home as well, and
    // Esc over Read files closed the files you were reading. You stay put.
    onToast(
      progress.lineAway
        ? `Put away. Continue from ${reopenedFrom()}.`
        : 'Put away. Continue from the compass at the foot of the sidebar, or Home’s Getting started line.',
    )
  }, [step, guide, progress, onToast])

  // S3: ← → move, Esc puts it away — at the window, ahead of a screen's own keys
  // (Home pages months on ← →), and never while something takes typing.
  useEffect(() => {
    if (index === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"]')) return
      if (document.querySelector('[aria-modal="true"]') !== null) return
      // The store's step, not this render's: three presses before React draws are three steps.
      const now = currentGuideOpen()
      const at = now?.kind === 'step' ? now.index : index
      if (event.key === 'Escape') {
        // Ahead of the screen's own Esc, and instead of it (M28 F14): one press
        // puts one thing away, and the guide is on top.
        event.preventDefault()
        event.stopImmediatePropagation()
        putAway()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        go(move(steps, checks, at, 1))
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        go(move(steps, checks, at, -1))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, steps, checks, go, putAway])

  const dialog = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const arrow = useRef<HTMLSpanElement>(null)
  usePlacement(dialog, ring, step?.place, index ?? -1, arrow)

  if (index === undefined || step === undefined) return null

  const previous = move(steps, checks, index, -1)
  const next = move(steps, checks, index, 1)
  const label = forwardLabel(steps, checks, index)
  const strong = isDone(checks, step.id) || next >= count

  return (
    <>
      <div key={`ring-${String(index)}`} ref={ring} className="fc-guide-ring fc-pulse" style={{ display: 'none' }} />
      <div
        key={`guide-${String(index)}`}
        ref={dialog}
        className="fc-guide fc-pop-enter"
        role="dialog"
        aria-label={`Guide, step ${String(index + 1)} of ${String(count)}`}
        data-for={step.place}
        style={HIDDEN}
      >
        <span ref={arrow} className="fc-guide-arrow" />
        <div className="flex items-center gap-2.5 border-b border-hairline py-2 pr-2 pl-3.5">
          <span className="fc-label flex-1">
            {step.where} · {index + 1} of {count}
          </span>
          <Dots steps={steps} checks={checks} index={index} onPick={go} />
          <CloseButton label="Put the guide away" title="Put the guide away (Esc)" onClick={putAway} />
        </div>
        <div className="flex flex-col gap-2 px-3.5 py-3">
          <h3 className="m-0 text-[15px] leading-[1.3] font-medium text-balance">{step.title}</h3>
          <p className="m-0 text-[13px] text-ink-secondary">{step.body}</p>
          <State step={step} checks={checks} />
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3.5 pt-2 pb-3">
          {previous >= 0 && (
            <Button variant="ghost" size="sm" onClick={() => go(previous)}>
              Back
            </Button>
          )}
          <span className="flex-1" />
          <Button
            variant={strong ? 'primary' : 'secondary'}
            size="sm"
            icon={next >= count ? 'check' : 'right'}
            onClick={() => go(next)}
          >
            {label}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 px-3.5 pb-3 text-[12px] text-ink-secondary">
          <span>
            <Key>←</Key> <Key>→</Key> move · <Key>Esc</Key> put away
          </span>
        </div>
      </div>
    </>
  )
}

/** The step strip: done in ink, this one in accent, every one a press away (choice d, B). */
function Dots({
  steps,
  checks,
  index,
  onPick,
}: {
  readonly steps: readonly GuideStep[]
  readonly checks: OpenGuide['checks']
  readonly index: number
  readonly onPick: (index: number) => void
}) {
  return (
    <div className="fc-guide-dots flex gap-[3px]" role="group" aria-label="Steps">
      {steps.map((one, at) => {
        const done = isDone(checks, one.id)
        return (
          <button
            key={one.id}
            type="button"
            data-state={at === index ? 'now' : done ? 'done' : undefined}
            title={`${String(at + 1)}. ${one.title}${done ? ' (done)' : ''}`}
            aria-label={`Step ${String(at + 1)}: ${one.title}`}
            aria-current={at === index ? 'step' : undefined}
            onClick={() => onPick(at)}
          />
        )
      })}
    </div>
  )
}

/** Done and what was found (S1), later and why (S5), or waiting on the screen. */
function State({ step, checks }: { readonly step: GuideStep; readonly checks: OpenGuide['checks'] }) {
  const state = stepState(step, checks)
  return (
    <div className="flex items-start gap-2 text-[12px] text-ink-secondary">
      <span className="flex-none">
        {state.kind === 'done' ? <Tag tone="good">Done</Tag> : state.kind === 'later' ? <Tag>Later</Tag> : <Tag tone="dash">Waiting</Tag>}
      </span>
      <span>
        {state.kind === 'done'
          ? state.says
          : state.kind === 'later'
            ? `This fills once ${state.until}. Skip it for now and it stays on the list.`
            : `Do it on the screen; this step ticks itself when ${state.test}.`}
      </span>
    </div>
  )
}

function CloseButton({ label, title, onClick }: { readonly label: string; readonly title?: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center border border-transparent text-ink-tertiary transition-colors duration-[var(--duration-micro)] hover:border-hairline-strong hover:text-ink"
    >
      <ActionGlyph name="close" />
    </button>
  )
}

/** `.kbd`, the mockup's: a key in mono, in a hairline box. */
function Key({ children }: { readonly children: React.ReactNode }) {
  return (
    <kbd className="inline-block border border-hairline-strong px-[5px] font-mono text-[10px] leading-4 text-ink-secondary">
      {children}
    </kbd>
  )
}

/**
 * Unplaced, a dialog has no `left` at all rather than an off-screen one: a
 * transition from `auto` does not run, so the first placement lands where it
 * belongs instead of sliding in from the edge. Hidden until it is placed.
 */
const HIDDEN: React.CSSProperties = { visibility: 'hidden' }

function numberWord(count: number): string {
  return ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][count] ?? String(count)
}

/**
 * **Placement: next to the place, never over it** — the mockup's `place()`.
 * Right of the place when there is room, else below, else above, else below and
 * held on screen; the arrow points at the place's middle, and the ring is drawn
 * 6px outside it. A step whose place this screen does not have (an empty Plan,
 * an Overview with no accounts yet) is centred near the top with no ring.
 *
 * Re-placed when the step changes (scrolling the place into view once), and on
 * every scroll, resize and change under `main`, without scrolling.
 */
function usePlacement(
  dialog: React.RefObject<HTMLDivElement | null>,
  ring: React.RefObject<HTMLDivElement | null> | undefined,
  place: string | undefined,
  key: number,
  arrow?: React.RefObject<HTMLSpanElement | null>,
): void {
  const scrolled = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (place === undefined) return
    scrolled.current = undefined
    const run = (): void => {
      const g = dialog.current
      if (g === null) return
      const main = document.querySelector('main')
      const frame = main?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
      const anchor = main?.querySelector<HTMLElement>(`[data-guide~="${place}"]`) ?? null
      const W = g.offsetWidth
      const H = g.offsetHeight
      const ww = window.innerWidth
      const wh = window.innerHeight
      const minX = frame.left + 8
      const minY = frame.top + 8
      const cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

      if (anchor === null) {
        g.style.left = `${String(frame.left + Math.max(8, (frame.width - W) / 2))}px`
        g.style.top = `${String(frame.top + 80)}px`
        g.style.visibility = 'visible'
        if (ring?.current) ring.current.style.display = 'none'
        if (arrow?.current) arrow.current.style.display = 'none'
        return
      }

      if (scrolled.current !== key) {
        scrolled.current = key
        const scroller = scrollParent(anchor)
        if (scroller !== undefined) {
          const sr = scroller.getBoundingClientRect()
          const ar = anchor.getBoundingClientRect()
          if (ar.top < sr.top + 8 || ar.top > sr.bottom - 160) scroller.scrollTop += ar.top - sr.top - 72
        }
      }

      const r = anchor.getBoundingClientRect()
      let side: 'right' | 'below' | 'above'
      let x: number
      let y: number
      if (ww - r.right >= W + 28) {
        side = 'right'
        x = r.right + 14
        y = cl(r.top + Math.min(r.height, 120) / 2 - 40, minY, wh - H - 8)
      } else if (wh - r.bottom >= H + 20) {
        side = 'below'
        x = cl(r.left + 24, minX, ww - W - 8)
        y = r.bottom + 14
      } else if (r.top - minY >= H + 16) {
        side = 'above'
        x = cl(r.left + 24, minX, ww - W - 8)
        y = r.top - 14 - H
      } else {
        side = 'below'
        x = cl(r.right - W, minX, ww - W - 8)
        y = cl(r.bottom + 14, minY, wh - H - 8)
      }
      g.style.left = `${String(x)}px`
      g.style.top = `${String(y)}px`
      g.style.visibility = 'visible'

      const a = arrow?.current
      if (a) {
        a.style.display = ''
        a.dataset['side'] = side
        a.style.left = ''
        a.style.top = ''
        if (side === 'right') a.style.top = `${String(cl(r.top + Math.min(r.height, 120) / 2 - y - 6, 14, H - 24))}px`
        else a.style.left = `${String(cl(r.left + Math.min(r.width, 200) / 2 - x - 6, 14, W - 24))}px`
      }

      const o = ring?.current
      if (o) {
        const top = Math.max(r.top, frame.top)
        const bottom = Math.min(r.bottom, frame.bottom)
        o.style.display = bottom > top ? '' : 'none'
        o.style.left = `${String(r.left - 6)}px`
        o.style.top = `${String(top - 6)}px`
        o.style.width = `${String(r.width + 12)}px`
        o.style.height = `${String(Math.max(0, bottom - top + 12))}px`
      }
    }

    // Now, for the first placement, and coalesced after that. A timer rather
    // than a frame: a frame never comes while the window is hidden, and the
    // dialog would be found off-screen when it is shown again.
    run()
    let timer = window.setTimeout(run, 0)
    const later = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(run, 0)
    }
    window.addEventListener('resize', later)
    document.addEventListener('scroll', later, true)
    const main = document.querySelector('main')
    const watcher = new MutationObserver(later)
    if (main !== null) watcher.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
    // The rail opening or closing moves `main` without changing anything in it.
    const sizes = new ResizeObserver(later)
    if (main !== null) sizes.observe(main)
    return () => {
      sizes.disconnect()
      window.clearTimeout(timer)
      window.removeEventListener('resize', later)
      document.removeEventListener('scroll', later, true)
      watcher.disconnect()
    }
  }, [dialog, ring, arrow, place, key])
}

function scrollParent(element: HTMLElement): HTMLElement | undefined {
  let at: HTMLElement | null = element.parentElement
  while (at !== null) {
    const style = getComputedStyle(at)
    if (/(auto|scroll)/.test(style.overflowY) && at.scrollHeight > at.clientHeight) return at
    at = at.parentElement
  }
  return undefined
}
