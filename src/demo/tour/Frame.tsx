import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { reducedMotion } from '@/ui/motion/motion.ts'
import type { DemoHandle } from '../contract.ts'
import { messageBetween, resetMessage, tell } from './embed.ts'
import { CROP_SCALE, cropAt, darkPaper, layoutOf, PAPERS } from './layout.ts'
import { anchorPoint, besidePoint, contentOf, lookBox, onView, onViewport, samePlace, travelled, type Box, type Point } from './place.ts'
import { SPEEDS, speedOf, startingSpeed, travelAt, TourPlayer, type TourCheck } from './player.ts'
import { click } from './runner.ts'
import { watchSeen } from './seen.ts'
import { chatUpTo, type Tour } from './steps.ts'
import './frame.css'

/**
 * **The demo frame** (M33 U2): the real app in an iframe, a ring that walks
 * it, an outline drawn around what the eye should be on, and a strip **above**
 * it (P3 reversed on 2026-10-07) — the tour's title and line, a dot
 * per caption, Watch / Try it, one caption line, Reset, and the speed. The
 * chrome is the first mockup's (bc37f31), which was kept; what was
 * rejected was the drawing of the app under it, and there is none now.
 *
 * The app is never laid out narrower than `LAYOUT_LEAST`: a narrower frame
 * draws it scaled, filling the height the strip leaves (`layout.ts`, M33 U3).
 * Below `MOVIE_BELOW` nothing can be taken over (P6): the toggle goes, the
 * shield takes no click, and one line says where to try it — and the app is a
 * crop, a window on it at a size a phone reads, kept on the box the eye should
 * be on and panning between steps (M33 F1).
 *
 * **Embedded** (M33 U4, D-418): asked for without `autoplay` it holds the
 * tour's first frame, with one control over the app to start it (the poster
 * is later: the end of the first scene, D-419); and it tells the page around
 * it which step is up, a take-over and a Reset (`embed.ts`), and nothing else.
 *
 * **It plays while it is seen** (M42 F1, D-496): `?autoplay=1` holds the first
 * step until a third of the frame is in view, stops where it is when it leaves,
 * and goes on when it comes back (`seen.ts`) — on Emerald's page and on any
 * page that embeds it.
 */

const TRY_CAPTION = 'It is yours now. Nothing you do leaves this page, and Reset puts it back.'
/** Ruling 2 (2026-10-07): once a visitor has changed something, say what Watch does to it. */
const CHANGED_CAPTION = 'Yours now. Watch or Reset puts the document back as it was, and what you changed goes.'
const CATCHING_UP = 'Putting the document back…'
/** A dot's fast-forward, back or on (M54 F11): nothing is put back on a forward jump, so the strip says where it goes. */
const goingTo = (scene: number): string => `Going to step ${String(scene + 1)}…`
const WIDER = 'Try it yourself on a wider screen.'
/** A tour that lost its way (M54 F12): one sentence, both ways back; what it could not find stays in the console. */
const LOST_CAPTION = 'The tour lost its place. Watch picks it up again, and Reset starts it over.'

/**
 * The visitor's speed, remembered in this browser only: a convenience, so
 * every read and write is guarded — an embed in somebody else's page can have
 * no storage at all, and the tour plays at its default without it (1x, or a
 * crop's 0.75x: `startingSpeed`). `undefined` is "never picked one".
 */
const SPEED_KEY = 'emerald-tour-speed'
function rememberedSpeed(): number | undefined {
  const kept = readPreference(SPEED_KEY)
  return kept === undefined ? undefined : speedOf(kept)
}
function rememberSpeed(speed: number): void {
  writePreference(SPEED_KEY, String(speed))
}

export function Frame({
  tour,
  appUrl,
  autoplay,
  check,
}: {
  tour: Tour
  appUrl: string
  /** `?autoplay=1`: play while the frame is seen (D-496). Otherwise the first frame waits for the visitor. */
  autoplay: boolean
  /** The check's run (`scripts/check-tours.mjs`): every row at fast-forward, once, then this. */
  check?: (result: TourCheck) => void
}) {
  const steps = tour.steps
  const iframe = useRef<HTMLIFrameElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const look = useRef<SVGSVGElement>(null)
  const root = useRef<HTMLDivElement>(null)
  // The frame's width and the height the strip leaves: the app is laid out from both.
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  // The speed the visitor picked, in this visit or a remembered one; until
  // they pick, a crop plays at 0.75x and anything wider at 1x (M33 F2).
  const [remembered] = useState(rememberedSpeed)
  const chosen = useRef(remembered)

  const player = useMemo(
    () =>
      new TourPlayer(steps, stageOf(iframe), {
        // Asked at the moment a motion would start, never once at mount
        // (*Reduced motion runs none of it*): the visitor may ask the OS for
        // less motion while the tour plays (M54 U8).
        get reduced() {
          return reducedMotion()
        },
        speed: startingSpeed(chosen.current, layoutOf(size.width, size.height, false).movie),
      }),
    // The first layout's width decides the starting speed; the effect below follows it after.
    [steps],
  )
  const state = useSyncExternalStore(player.subscribe, player.snapshot)
  const scene = player.scenes[state.scene]
  const trying = state.mode === 'try'
  const beside = state.mode === 'catching-up' || state.lost !== undefined ? undefined : scene?.beside
  // A tour told as a conversation (M33 F5) keeps its panel in the paper's
  // place for the whole tour, so the app never resizes under it.
  const talks = useMemo(() => steps.some((step) => step.chat !== undefined), [steps])
  const lines = talks ? chatUpTo(steps, state.step) : []
  const layout = layoutOf(size.width, size.height, beside !== undefined || talks)
  const { movie, scale } = layout

  // Seen or not (M42 F1), before anything plays. The check plays unwatched, as it always has.
  useEffect(() => {
    const element = root.current
    if (check !== undefined || element === null) return
    return watchSeen(element, (seen) => {
      player.setSeen(seen)
    })
  }, [player, check])

  useEffect(() => {
    // A run this effect's cleanup stopped (React's strict double mount) reports nothing.
    let live = true
    if (check === undefined) {
      if (autoplay) player.start()
      else player.wait()
    } else
      void player.check((target, highlight, names) => ringOutside(root.current, iframe.current, viewport.current, target, highlight, names)).then((result) => {
        if (live) check(result)
      })
    return () => {
      live = false
      player.dispose()
    }
  }, [player, check, autoplay])

  // The frame's width decides the scale and movie or not, and the viewport's
  // height what the scaled app fills; the iframe it is embedded in can be resized.
  useLayoutEffect(() => {
    const element = root.current
    const box = viewport.current
    if (element === null || box === null) return
    const measure = (): void =>
      setSize((was) => {
        const now = { width: Math.round(element.clientWidth), height: Math.round(box.clientHeight) }
        return now.width === was.width && now.height === was.height ? was : now
      })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(box)
    measure()
    return () => observer.disconnect()
  }, [])

  // Narrowed into a crop, or widened out of one, before the visitor picked a speed: the default follows.
  useEffect(() => {
    if (chosen.current === undefined) player.setSpeed(startingSpeed(undefined, movie))
  }, [movie, player])

  // A movie is watched, never taken over: a visitor who narrowed the window mid-try is shown it again.
  useEffect(() => {
    if (movie && trying && state.lost === undefined) player.watch()
  }, [movie, trying, state.lost, player])

  // The ring travels on the app (M33 F2): where it is is worked out in the
  // app's own pixels — from where it was to its anchor, over a travel at the
  // visitor's speed on the frame's ease — and mapped through the iframe as drawn
  // that frame. A crop's pan, the scale easing as the paper comes in, or a list
  // that scrolls carries it along, and from the end of the travel it is on its
  // anchor exactly. Kept across anchors, so the next travel starts where it is.
  const ringAt = useRef<Point | undefined>(undefined)
  useEffect(() => {
    const target = state.target
    const ringElement = ring.current
    const frame = iframe.current
    const box = viewport.current
    if (ringElement === null || frame === null || box === null) return
    if (target === undefined || !target.isConnected) {
      ringElement.classList.add('gone')
      return
    }
    const names = state.names
    const travel = reducedMotion() ? 0 : travelAt(player.snapshot().speed)
    const from = ringAt.current
    const started = performance.now()
    let id = 0
    let to: Point | undefined
    let at: Point | undefined
    const place = (): void => {
      // An anchor the last click removed or hid measures 0 by 0 at the corner: hold where it was.
      const anchor = target.isConnected ? restingPoint(target, names) : undefined
      if (anchor !== undefined) to = anchor
      if (to !== undefined) {
        const now = from === undefined ? to : travelled(from, to, performance.now() - started, travel)
        ringAt.current = now
        const view = box.getBoundingClientRect()
        const point = onViewport(view, frame.getBoundingClientRect(), frame.offsetWidth, now)
        if (!samePlace(at, point)) {
          at = point
          // `translate`, not `transform`: the press is a `scale`, and CSS scales
          // whatever `transform` holds — the position too (see place.ts).
          ringElement.style.translate = `${String(point.x)}px ${String(point.y)}px`
        }
        // An anchor the app has moved off the frame — the page grew under it
        // after a save — takes the ring with it until it is back (M54 F11).
        ringElement.classList.toggle('gone', !onView(view, point))
      }
      id = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(id)
  }, [state.target, state.names, player])

  // The outline follows its box every frame, as the ring does, and draws itself
  // once per box: a new box is a new element, so the CSS draw starts again.
  useEffect(() => {
    const target = state.highlight
    const svg = look.current
    const frame = iframe.current
    const box = viewport.current
    if (svg === null || frame === null || box === null) return
    if (target === undefined) {
      svg.classList.add('gone')
      svg.classList.remove('drawn')
      return
    }
    let id = 0
    let placed = false
    const rect = svg.querySelector('rect')
    const place = (): void => {
      // A box that has left the page takes its outline with it, rather than
      // leaving it drawn where the box was (M33 F6).
      if (!target.isConnected) {
        svg.classList.add('gone')
        return
      }
      const at = lookBox(box.getBoundingClientRect(), frame.getBoundingClientRect(), frame.offsetWidth, target.getBoundingClientRect())
      if (at !== undefined && rect !== null) {
        svg.style.translate = `${String(at.left)}px ${String(at.top)}px`
        svg.setAttribute('width', String(at.width))
        svg.setAttribute('height', String(at.height))
        rect.setAttribute('width', String(Math.max(0, at.width - 2)))
        rect.setAttribute('height', String(Math.max(0, at.height - 2)))
        if (!placed) {
          placed = true
          svg.classList.remove('gone', 'drawn')
          void svg.getBoundingClientRect()
          svg.classList.add('drawn')
        }
      }
      id = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(id)
  }, [state.highlight])

  // A movie is a crop (M33 F1): the window follows the outlined box, else the
  // ring's anchor, every frame, so a sheet that scrolls carries it along, and
  // always keeps the ring in it (M33 F4); the frame's CSS eases each move, and
  // under reduced motion it jumps. Where it is outlives the effect, so a box
  // that is gone (a route changed under it) leaves the window where it was.
  const cropWas = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const frame = iframe.current
    const box = viewport.current
    if (!movie || frame === null || box === null) return
    let id = 0
    let at = { x: Number.NaN, y: Number.NaN }
    const place = (): void => {
      const next = windowOf(frame, box, scale, state.target, state.highlight, state.names, cropWas.current)
      // Two app pixels or more, so a box that shivers does not restart the ease.
      if (Number.isNaN(at.x) || Math.abs(next.x - at.x) >= 2 || Math.abs(next.y - at.y) >= 2) {
        at = next
        cropWas.current = next
        frame.style.transform = `translate(${String(-next.x * scale)}px, ${String(-next.y * scale)}px) scale(${String(scale)})`
      }
      id = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(id)
  }, [movie, state.target, state.highlight, state.names, scale])

  // A press: the ring shrinks and echoes once per click the tour makes.
  useEffect(() => {
    const ringElement = ring.current
    if (ringElement === null || state.presses === 0) return
    ringElement.classList.remove('press')
    void ringElement.offsetWidth
    ringElement.classList.add('press')
  }, [state.presses])

  // **The app is out of the keyboard's reach while it is watched** (M54 F11):
  // inert under the shield, so Tab goes from the strip to Watch the tour and
  // never walks into the app, where a key could race the runner. Set here
  // rather than as a prop, so the shield's click can lift it at once.
  useLayoutEffect(() => {
    const frame = iframe.current
    if (frame !== null) frame.inert = !trying
  }, [trying])

  // Inert keeps Tab from walking in, but not a focus the tour itself moved in
  // there — a click the ring made focuses what it clicked, as a pointer does —
  // and from there Tab walks the app. So while it is watched, a visitor's own
  // key in the app goes nowhere, and Tab comes back to the strip; the tour's
  // keystrokes are its own events, never trusted ones, and pass.
  useEffect(() => {
    const frame = iframe.current
    const strip = root.current
    if (trying || frame === null || strip === null) return
    const stays = (event: KeyboardEvent): void => {
      if (!event.isTrusted) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key !== 'Tab') return
      const stops = [...strip.querySelectorAll<HTMLElement>('button, input')].filter((each) => each.tabIndex >= 0)
      ;(event.shiftKey ? stops.at(-1) : stops[0])?.focus()
    }
    let win: Window | null = null
    const attach = (): void => {
      win?.removeEventListener('keydown', stays, true)
      win = frame.contentWindow
      win?.addEventListener('keydown', stays, true)
    }
    attach()
    frame.addEventListener('load', attach)
    return () => {
      frame.removeEventListener('load', attach)
      win?.removeEventListener('keydown', stays, true)
    }
  }, [trying])

  /**
   * **A click mid-move lands** (M54 F11, D-531; rule *Nothing is blocked by
   * motion*): the shield takes the click, hands the app to the visitor, and
   * passes the click on to what was under it in the app — so the visitor never
   * clicks twice. A click on the frame's own panel only takes over.
   */
  const takeOverAt = (event: React.MouseEvent): void => {
    const frame = iframe.current
    // The app is inert, and so out of the page's hit test: what was under the
    // click is worked out by where it fell — on the frame's own panel, or on the app.
    const onPanel = document
      .elementsFromPoint(event.clientX, event.clientY)
      .some((each) => each.closest('.tour-beside, .tour-chat-card') !== null)
    player.takeOver()
    if (frame === null || onPanel) return
    const drawn = frame.getBoundingClientRect()
    const by = frame.offsetWidth > 0 ? drawn.width / frame.offsetWidth : 1
    const point = { x: (event.clientX - drawn.left) / by, y: (event.clientY - drawn.top) / by }
    if (point.x < 0 || point.y < 0 || point.x > frame.offsetWidth || point.y > frame.offsetHeight) return
    frame.inert = false
    const doc = frame.contentDocument
    const target = doc?.elementFromPoint(point.x, point.y)
    const win = doc?.defaultView
    if (target instanceof (win?.HTMLElement ?? HTMLElement)) click(target as HTMLElement, point)
  }

  // The page around the frame hears which step is up and a take-over (M33 U4).
  const told = useRef<typeof state | undefined>(undefined)
  useEffect(() => {
    if (check !== undefined) return
    const message = messageBetween(told.current, state, player.scenes.length)
    told.current = state
    if (message !== undefined) tell(message)
  }, [state, check, player])
  const waiting = state.mode === 'ready'
  const catching = state.mode === 'catching-up'
  const catchingWords = state.going === undefined ? CATCHING_UP : goingTo(state.going)
  // Pause is for a tour that moves: not on the held first frame, and not in Try it.
  const plays = state.mode === 'watch' || state.mode === 'opening' || catching

  const caption =
    state.lost !== undefined
      ? LOST_CAPTION
      : catching
        ? catchingWords
        : trying
          ? state.changed
            ? CHANGED_CAPTION
            : TRY_CAPTION
          : (scene?.caption ?? '')
  // Every line the tour's own caption can say, laid in its cell unseen, so the
  // strip is as tall as the longest at this width and the app under it never
  // jumps while it plays. Try it's lines are left out: the app is the visitor's
  // then, and a strip one line taller costs it nothing.
  const reserve = useMemo(
    () => [...player.scenes.map((each) => each.caption), CATCHING_UP, goingTo(player.scenes.length - 1)],
    [player],
  )

  // **Watch / Try it is one radio group** (M54 F11; the APG radio group): one
  // Tab stop, on the checked radio or else the first, and the arrows move the
  // choice. On the held first frame nothing plays and nothing is yours, so
  // neither is checked.
  const seg = useRef<(HTMLButtonElement | null)[]>([])
  const chosenSide = waiting ? undefined : trying ? 1 : 0
  const choose = (side: number): void => {
    if (side === 0) player.watch()
    else player.takeOver()
  }
  const segKey = (event: React.KeyboardEvent, side: number): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = (side + step + 2) % 2
    seg.current[next]?.focus()
    choose(next)
  }

  const dots = player.scenes.length
  return (
    <div
      ref={root}
      className={`tour-frame ${movie ? 'movie' : ''} ${trying ? 'trying' : ''}`}
      data-mode={state.mode}
      style={{ '--tour-travel': `${String(travelAt(state.speed))}ms` } as React.CSSProperties}
    >
      {/* One grid, so the strip can rearrange by the frame's own width
          (frame.css): one row of controls when wide, the caption on a row of its
          own when narrow. */}
      <div className="tour-strip">
        <header className="tour-head">
          <h1 className="tour-title">
            <Crossfade text={tour.title} />
          </h1>
          <p className="tour-about">
            <Crossfade text={tour.description} />
          </p>
        </header>
        <div className="tour-dots" role="group" aria-label="Steps">
          <span className="rail" />
          <span
            className="done"
            style={{ width: dots > 1 ? `calc((100% - 2 * var(--tour-dot-pull)) * ${String(state.scene / (dots - 1))})` : '0' }}
          />
          {player.scenes.map((each, index) => (
            <button
              key={each.first}
              type="button"
              className={`tour-dot ${index < state.scene ? 'past' : ''} ${index === state.scene ? 'now' : ''}`}
              aria-current={index === state.scene ? 'step' : undefined}
              aria-label={`Step ${String(index + 1)} of ${String(dots)}: ${each.caption}`}
              title={each.caption}
              onClick={() => player.jump(index)}
            >
              <i />
            </button>
          ))}
        </div>
        <div className="tour-seg" role="radiogroup" aria-label="Watch or try">
          {(['Watch', 'Try it'] as const).map((name, side) => (
            <button
              key={name}
              ref={(button) => {
                seg.current[side] = button
              }}
              type="button"
              role="radio"
              aria-checked={chosenSide === side}
              tabIndex={chosenSide === side || (chosenSide === undefined && side === 0) ? 0 : -1}
              onClick={() => choose(side)}
              onKeyDown={(event) => segKey(event, side)}
            >
              {name}
            </button>
          ))}
        </div>
        {plays && (
          // One name, Pause, pressed while paused (D-532; the APG toggle button).
          <button
            type="button"
            className="tour-pause"
            aria-pressed={state.paused}
            aria-label="Pause"
            onClick={() => player.pause(!state.paused)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
            </svg>
            <span className="tour-pause-label">Pause</span>
          </button>
        )}
        {/* A lost tour says so in the caption's own ink (M54 F12): it is the
            tour that lost its place, not something the visitor got wrong. */}
        <p className="tour-say" aria-live="polite">
          {(state.mode === 'watch' || state.mode === 'opening' || waiting) && (
            <span className="of">
              {state.scene + 1} / {dots}
            </span>
          )}
          <Crossfade text={caption} reserve={reserve} />
        </p>
        <button
          type="button"
          className="tour-reset"
          onClick={() => {
            tell(resetMessage(player.scenes.length))
            player.start()
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Reset
        </button>
        <label className="tour-speed" title="How fast the tour plays">
          <span className="tour-speed-label">Speed</span>
          <input
            type="range"
            min={SPEEDS.least}
            max={SPEEDS.most}
            step={SPEEDS.step}
            value={state.speed}
            aria-valuetext={`${String(state.speed)} times`}
            onChange={(event) => {
              const speed = speedOf(event.target.value)
              chosen.current = speed
              player.setSpeed(speed)
              rememberSpeed(speed)
            }}
          />
          <output className="tour-speed-value">{state.speed}×</output>
        </label>
        {movie && <p className="tour-wider">{WIDER}</p>}
      </div>
      <div ref={viewport} className="tour-viewport">
        <iframe
          ref={iframe}
          src={appUrl}
          title="Emerald"
          className="tour-app"
          style={{
            width: `${String(layout.width)}px`,
            height: `${String(layout.height)}px`,
            // A crop's transform is the effect's, which follows its box.
            ...(movie ? {} : { transform: scale < 1 ? `scale(${String(scale)})` : 'none' }),
          }}
          {...(movie ? { tabIndex: -1 } : {})}
        />
        {!trying && (
          <div
            className="tour-shield"
            title={waiting ? 'Watch the tour' : movie ? undefined : 'Click to take over'}
            onClick={waiting ? () => player.start() : movie ? undefined : takeOverAt}
          />
        )}
        {catching && (
          // The app flips through every row it skips (M54 F11): drawn by the one
          // progress indicator over a veil, never as screens at full opacity.
          <div className="tour-working">
            <Working size={24} />
          </div>
        )}
        {waiting && (
          <button type="button" className="tour-play" onClick={() => player.start()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 4.5v15l12.5-7.5z" />
            </svg>
            Watch the tour
          </button>
        )}
        {beside !== undefined && (
          <aside
            className={`tour-beside ${movie ? 'card' : ''}`}
            {...(movie ? {} : { style: { width: `${String(layout.beside)}px` } })}
            aria-label="Beside the app: the paper being typed in"
          >
            <Paper name={beside} />
          </aside>
        )}
        {/* The paper takes the conversation's column while its scene plays (M54 F12): the scene is typing from it, and nothing is said. */}
        {talks && !movie && beside === undefined && <Chat lines={lines} width={layout.beside} />}
        {talks && movie && beside === undefined && lines.length > 0 && <ChatCard line={lines[lines.length - 1]} />}
        <svg ref={look} className="tour-look gone" aria-hidden>
          <rect x="1" y="1" pathLength={100} />
        </svg>
        <div ref={ring} className="tour-ring gone" aria-hidden />
      </div>
    </div>
  )
}

/** A paper, in light and in dark: the frame's theme shows one (frame.css). */
function Paper({ name }: { name: string }) {
  const known = PAPERS[name]
  const size = known === undefined ? {} : { width: known.width, height: known.height }
  return (
    <>
      <img className="paper-light" src={`./${name}`} alt={known?.alt ?? ''} {...size} />
      <img className="paper-dark" src={`./${darkPaper(name)}`} alt={known?.alt ?? ''} {...size} />
    </>
  )
}

/** What the panel says it is: the tour's, written for it, and not the app (M33 F5). */
const CHAT_HEAD = 'A conversation, written for this tour.'
const WHO = { person: 'Person', model: 'Model' } as const
type ChatLine = ReturnType<typeof chatUpTo>[number]

/**
 * **The tour's conversation** (M33 F5), in the paper's column: the frame's own
 * panel, outside the app's iframe. Earlier lines stay, dimmed; the newest
 * fades in, and the column keeps it in view.
 */
function Chat({ lines, width }: { lines: readonly ChatLine[]; width: number }) {
  const list = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    const element = list.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [lines.length])
  return (
    <aside className="tour-beside tour-chat" style={{ width: `${String(width)}px` }} aria-label={CHAT_HEAD}>
      <p className="tour-chat-head">{CHAT_HEAD}</p>
      <ol ref={list} className="tour-chat-lines" aria-live="polite">
        {lines.map((line, index) => (
          <li key={line.at} className={`tour-line ${line.from} ${index === lines.length - 1 ? 'new' : 'was'}`}>
            <span className="who">{WHO[line.from]}</span>
            <Bidi>{line.chat}</Bidi>
            {index === lines.length - 1 && <Drawn />}
          </li>
        ))}
      </ol>
    </aside>
  )
}

/**
 * In a crop, only the newest line, as a card along the window's bottom (M33
 * F5) — the receipt's card, laid flat — which the window keeps the outlined
 * row and the ring clear of (`windowOf`).
 */
function ChatCard({ line }: { line: ChatLine | undefined }) {
  if (line === undefined) return null
  return (
    <aside className="tour-chat-card" aria-label={CHAT_HEAD} aria-live="polite">
      <p key={line.at} className={`tour-line ${line.from} new`}>
        <span className="who">
          {WHO[line.from]} · written for this tour
        </span>
        <Bidi>{line.chat}</Bidi>
        <Drawn />
      </p>
    </aside>
  )
}

/**
 * The newest chat line, outlined as it arrives (M33 F6): the outline that
 * draws itself around a box on the app, drawn once around the line (square,
 * as the line is), and gone when a newer one comes. Mounted with the line, so
 * each line draws its own; under reduced motion it is there whole.
 */
function Drawn() {
  return (
    <svg className="tour-drawn" aria-hidden>
      <rect x="1" y="1" pathLength={100} />
    </svg>
  )
}

/**
 * Text that crossfades when it changes (2026-10-07): the old line
 * fades out over the new one fading in, in the same place, rather than
 * snapping. Under reduced motion the CSS plays neither and hides the old one.
 */
function Crossfade({ text, reserve }: { text: string; reserve?: readonly string[] }) {
  const [shown, setShown] = useState<{ now: string; was: string | undefined; turn: number }>({
    now: text,
    was: undefined,
    turn: 0,
  })
  // Adjusted during render, React's way for state that follows a prop.
  if (shown.now !== text) setShown({ now: text, was: shown.now, turn: shown.turn + 1 })
  // The old line goes when its fade ends, or after it at the latest: a page
  // nobody can see runs no animation, and would keep both lines otherwise.
  useEffect(() => {
    if (shown.was === undefined) return
    const turn = shown.turn
    const id = setTimeout(() => setShown((then) => (then.turn === turn ? { ...then, was: undefined } : then)), fadeGone())
    return () => clearTimeout(id)
  }, [shown.was, shown.turn])
  return (
    <span className="tour-fade">
      {reserve?.map((each) => (
        <span key={`reserve-${each}`} className="reserve" aria-hidden>
          <Bidi>{each}</Bidi>
        </span>
      ))}
      {shown.was !== undefined && (
        <span
          key={`was-${String(shown.turn)}`}
          className="out"
          aria-hidden
          onAnimationEnd={() => setShown((then) => (then.turn === shown.turn ? { ...then, was: undefined } : then))}
        >
          <Bidi>{shown.was}</Bidi>
        </span>
      )}
      <span key={`now-${String(shown.turn)}`} className={shown.turn > 0 ? 'in' : undefined}>
        <Bidi>{shown.now}</Bidi>
      </span>
    </span>
  )
}

/**
 * The latest the old caption goes, in ms: frame.css's `--tour-fade-gone`, so
 * the sheet's durations are named in one place (M54 F11).
 */
function fadeGone(): number {
  const named = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tour-fade-gone'))
  return Number.isFinite(named) ? named : 400
}

/** The boxes of an element's text, each run that holds more than white space. */
function textRuns(element: HTMLElement): DOMRect[] {
  const doc = element.ownerDocument
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const runs: DOMRect[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node.textContent ?? '').trim() === '') continue
    const range = doc.createRange()
    range.selectNodeContents(node)
    runs.push(range.getBoundingClientRect())
  }
  return runs
}

/** The least the ring's centre stands from the app's left edge, so a label at the edge keeps it on the frame. */
const RING_EDGE = 14

/**
 * **Where the ring rests on an element**, in the app's pixels (M54 F11): on a
 * box the row acts on, `anchorPoint`'s; on a box a `say` row only names, beside
 * the start of its text (`besidePoint`), so it points at what it names and the
 * label stays readable.
 */
function restingPoint(element: HTMLElement, names: boolean): Point | undefined {
  const own = element.getBoundingClientRect()
  if (!names) return anchorPoint(own)
  const point = besidePoint(contentOf(own, textRuns(element)))
  return point === undefined ? undefined : { x: Math.max(point.x, RING_EDGE), y: point.y }
}

/**
 * The box a crop keeps in view for an element (M33 F1): its own, except a
 * sheet's row, which is as wide as the sheet with its empty columns — there it
 * is what the row holds, from its first text to its last, so a charge's date,
 * merchant and amount are in the window together.
 */
function heldBy(element: HTMLElement): DOMRect {
  const own = element.getBoundingClientRect()
  if (element.tagName !== 'TR') return own
  const held: Box = contentOf(own, textRuns(element))
  return new DOMRect(held.left, own.top, held.width, own.height)
}

/**
 * **The crop's window for what the tour holds now** (M33 F1, F4): its corner
 * and the part of it nothing covers, in the app's own pixels — on the outline,
 * else the ring's anchor, and always with the ring's point in it. One function
 * for the frame's pan and the check's question, so they cannot disagree.
 */
function windowOf(
  frame: HTMLIFrameElement,
  box: HTMLElement,
  scale: number,
  target: HTMLElement | undefined,
  highlight: HTMLElement | undefined,
  names: boolean,
  was: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const shown = (element: HTMLElement | undefined): HTMLElement | undefined => (element?.isConnected === true ? element : undefined)
  const area = shown(highlight) ?? shown(target)
  const ringOn = shown(target)
  const ring = ringOn === undefined ? undefined : restingPoint(ringOn, names)
  // The paper's card holds the window's right side: the box is kept left of it.
  const card = box.querySelector<HTMLElement>('.tour-beside.card')
  const held = card === null ? 0 : card.offsetWidth + 16
  // The conversation's card holds its bottom (M33 F5): the window is what is above it.
  const said = box.querySelector<HTMLElement>('.tour-chat-card')
  const open = box.clientHeight - (said === null ? 0 : said.offsetHeight + 16)
  const at = cropAt(
    area === undefined ? undefined : heldBy(area),
    { width: frame.offsetWidth, height: frame.offsetHeight },
    { width: box.clientWidth, height: open },
    scale,
    was,
    held,
    ring,
  )
  return { ...at, width: (box.clientWidth - held) / scale, height: open / scale }
}

/**
 * The check's question at every anchor (M33 F4): in a crop, is the ring's
 * point inside the window the frame pans to? In a frame that shows the whole
 * app, is it on the frame at all (M54 F11) — the ring is hidden while it is
 * not? Said when it is not.
 */
function ringOutside(
  root: HTMLElement | null,
  frame: HTMLIFrameElement | null,
  box: HTMLElement | null,
  target: HTMLElement,
  highlight: HTMLElement | undefined,
  names: boolean,
): string | undefined {
  if (root === null || frame === null || box === null) return undefined
  const ring = restingPoint(target, names)
  if (ring === undefined) return undefined
  if (!root.classList.contains('movie')) {
    const view = box.getBoundingClientRect()
    const point = onViewport(view, frame.getBoundingClientRect(), frame.offsetWidth, ring)
    if (onView(view, point)) return undefined
    return `the ring at (${String(Math.round(point.x))}, ${String(Math.round(point.y))}) is off the frame's ${String(Math.round(view.width))} by ${String(Math.round(view.height))}`
  }
  const seen = windowOf(frame, box, CROP_SCALE, target, highlight, names, { x: 0, y: 0 })
  if (ring.x >= seen.x && ring.x <= seen.x + seen.width && ring.y >= seen.y && ring.y <= seen.y + seen.height) return undefined
  const span = (from: number, size: number): string => `${String(Math.round(from))}–${String(Math.round(from + size))}`
  return `the ring at (${String(Math.round(ring.x))}, ${String(Math.round(ring.y))}) is outside the crop's window, ${span(seen.x, seen.width)} by ${span(seen.y, seen.height)}`
}

/** The player's view of the iframe: its document, and the handle once its page has made one. */
function stageOf(iframe: React.RefObject<HTMLIFrameElement | null>) {
  return {
    doc(): Document {
      const doc = iframe.current?.contentDocument
      if (doc === null || doc === undefined) throw new Error('The app is not loaded.')
      return doc
    },
    async handle(): Promise<DemoHandle> {
      // The app page sets its handle as its module runs, before its `load`.
      for (;;) {
        const found = iframe.current?.contentWindow?.emeraldDemo
        if (found !== undefined) {
          await found.ready
          return found
        }
        await new Promise((resolve) => {
          const frame = iframe.current
          if (frame === null) requestAnimationFrame(resolve)
          else frame.addEventListener('load', resolve, { once: true })
        })
      }
    },
  }
}
