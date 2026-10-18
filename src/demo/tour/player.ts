import { layoutSettled } from '@/ui/motion/settle.ts'

import type { DemoHandle } from '../contract.ts'
import {
  bringIntoView,
  click,
  onScreen,
  OutlineOutlived,
  painted,
  press,
  routeDrawn,
  setText,
  sideways,
  startingText,
  TourCancelled,
  TourLost,
  TourRefused,
  typedStill,
  TypingMoved,
  waitForAnchor,
} from './runner.ts'
import { chatUpTo, readingTime, sceneAt, scenesOf, type Scene, type TourStep } from './steps.ts'

/**
 * **The tour, played** (M33 U2): Watch, Try it, Reset, a dot, and the loop —
 * the frame's whole behaviour, kept out of React so the view is only a view
 * and U3's check can drive the same thing.
 *
 * Every way of starting over goes through `replay`: **reopen the document's
 * bytes, fast-forward to a row with no travel, no typing and no pause, then
 * play on**. So going back to Watch after Try it never plays over what a
 * visitor did (2026-10-07): it is thrown away, and the tour comes
 * back to the scene it had reached.
 */

/**
 * `ready` is a frame asked for without `autoplay` (M33 U4): the first caption
 * up, the app opening behind it, and nothing moving until the visitor asks.
 * `opening` is the first load: the first caption is up while the app page is
 * still opening its document, so the wait is reading time (M33 U3).
 * `catching-up` is a replay's fast-forward: the strip says so and the shield stays.
 */
export type TourMode = 'ready' | 'opening' | 'watch' | 'try' | 'catching-up'

export interface TourSnapshot {
  readonly mode: TourMode
  /** The row playing, or the one the visitor took over at. */
  readonly step: number
  readonly scene: number
  /** A visitor wrote to the document since taking over. */
  readonly changed: boolean
  /** What the ring is on, in the app's document. */
  readonly target: HTMLElement | undefined
  /** Bumped on every click the ring makes, so the view can play a press. */
  readonly presses: number
  /** The tour could not find its next anchor; said in the strip, and it stops. */
  readonly lost: string | undefined
  /** The box outlined for the eye (a row's `highlight`), held through the rows after it that only talk (M33 F6). */
  readonly highlight: HTMLElement | undefined
  /** The visitor's speed: every hold is divided by it, reading and actions alike. */
  readonly speed: number
}

/**
 * The clock for the eye, in ms (2026-10-07). **A caption moves at
 * once and is read while it does** (M33 F1): the ring sets off for its first
 * anchor `lead` after the caption comes up, and the caption's reading time —
 * capped at `read` — is held before the first click or keystroke, not before
 * any motion. Then every action runs at one tempo: the ring's travel, a beat after each
 * action, and the typing speed are constants, whatever the scene. Fast-forward
 * and a reduced-motion visitor skip the travel and the typing. **The visitor's
 * speed scales all of it** (2026-10-07): every hold is divided by
 * it, so at 2x a caption is held half as long and the ring travels twice as
 * fast, and the frame's CSS travel follows (`travelAt`).
 */
/*
 * 1x was reset on 2026-10-07: what was 0.75x became 1x — travel 700,
 * key 65, beat 250 and the last hold 6000 over 0.75 — and the slider's range
 * moved with it, so it runs from half to twice this.
 */
export const PACE = {
  /** The ring's travel to an anchor (Frame.tsx, M33 F2), and a crop's pan with it (the frame's CSS). */
  travel: 933,
  /**
   * A new caption to the ring setting off (M33 F1): long enough for the line
   * to have faded in, so the eye goes to it first. U3 held the whole reading
   * here, and the frame sat still for 5.4 to 5.8 s under every caption.
   */
  lead: 400,
  /**
   * The most a caption is read before its scene's first click or keystroke,
   * counted from when it came up, so the ring's travel is part of it (M33 F1).
   * The caption stays up for the rest of its scene, read as it plays.
   */
  read: 3500,
  /** Between two characters typed. */
  key: 87,
  /** After every action, before the next travel. */
  beat: 333,
  /** The last caption, at least, before the loop starts over (P5). */
  last: 8000,
  /**
   * After a row that outlines, at least: the outline drawing itself (1.4
   * travels, the frame's CSS) and a beat to see it whole (M33 U3).
   */
  outlined: Math.round(933 * 1.4) + 333,
} as const

/** The speeds a visitor can pick, slowest first; 1 is the pace above. */
export const SPEEDS = { least: 0.5, most: 2, step: 0.25 } as const

/** A speed kept inside what the control offers; anything else is 1. */
export function speedOf(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(n) && n >= SPEEDS.least && n <= SPEEDS.most ? n : 1
}

/**
 * **A crop starts at 0.75x** (M33 F2, 2026-10-07): on a phone the
 * window pans as well as the ring travelling, and at 1x the eye has two things
 * to follow at once. Only a default — a speed the visitor picked on the slider
 * wins, here and on every later visit.
 */
export const MOVIE_SPEED = 0.75

/** The speed a tour starts at: the visitor's own when they have picked one, else a crop's or 1. */
export function startingSpeed(chosen: number | undefined, movie: boolean): number {
  return chosen === undefined ? (movie ? MOVIE_SPEED : 1) : speedOf(chosen)
}

/** The ring's travel at a speed, in ms — and what a crop's CSS pan takes, so the two arrive together. */
export function travelAt(speed: number): number {
  return Math.round(PACE.travel / speedOf(speed))
}

export interface TourStage {
  /** The app page's handle, once it has one. */
  handle(): Promise<DemoHandle>
  /** The app's document, inside the frame's iframe. */
  doc(): Document
}

type Listener = () => void

/** What `check` found: every row played, or the first that could not be (M33 U3). */
export type TourCheck =
  | { readonly ok: true; readonly steps: number; readonly ms: number }
  | { readonly ok: false; readonly step: number | undefined; readonly said: string; readonly ms: number }

/**
 * The check's question at every anchor (M33 F4), asked of the frame: with the
 * ring on `target` and `highlight` outlined, is the ring off what a visitor
 * sees? What is wrong, or `undefined`.
 */
export type RingCheck = (target: HTMLElement, highlight: HTMLElement | undefined) => string | undefined

/** The ring's point outside what the frame shows, found by the check (M33 F4). */
class RingOutside extends Error {
  constructor(
    readonly step: number,
    what: string,
  ) {
    super(`Step ${String(step + 1)}: ${what}.`)
  }
}

export class TourPlayer {
  readonly scenes: readonly Scene[]
  private state: TourSnapshot = {
    mode: 'opening',
    step: 0,
    scene: 0,
    changed: false,
    target: undefined,
    presses: 0,
    lost: undefined,
    highlight: undefined,
    speed: 1,
  }
  private readonly listeners = new Set<Listener>()
  /** Every replay takes a new generation; an older one's next await throws. */
  private generation = 0
  private unsubscribe: (() => void) | undefined
  /**
   * The app page has just opened the document and nobody has touched it: the
   * first play needs no second open (M33 U3 — that open was most of the first
   * second, under a caption saying the document was being put back).
   */
  private fresh = true
  /** The check's run: every field is typed a key at a time, and a keystroke that moves anything fails it. */
  private checking = false
  /** The frame's question while checking: is the ring where a visitor sees it (M33 F4). */
  private ringCheck: RingCheck | undefined
  /** Which caption is on screen, and since when: its reading counts from there. */
  private shown: { key: string; at: number } = { key: 'scene 0', at: performance.now() }

  constructor(
    readonly steps: readonly TourStep[],
    private readonly stage: TourStage,
    private readonly motion: { readonly reduced: boolean; readonly speed?: number },
  ) {
    this.scenes = scenesOf(steps)
    this.state = { ...this.state, speed: speedOf(motion.speed ?? 1) }
  }

  /** The speed control: takes effect from the next hold. */
  setSpeed(speed: number): void {
    this.set({ speed: speedOf(speed) })
  }

  snapshot = (): TourSnapshot => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Without `autoplay` (M33 U4): the tour's first frame, held. Watch, a click
   * on the app, Reset or a dot starts it from here.
   */
  wait(): void {
    this.generation += 1
    this.set({ mode: 'ready', step: 0, scene: 0, target: undefined, highlight: undefined, lost: undefined })
  }

  /** From the first row. Also Reset, from either mode. */
  start(): void {
    void this.replay(0)
  }

  /** A dot: the scene's first row, fast-forwarded to. */
  jump(scene: number): void {
    const target = this.scenes[scene]
    if (target !== undefined) void this.replay(target.first)
  }

  /** Try it, or a click in the app while it plays (P4). */
  takeOver(): void {
    if (this.state.mode === 'try') return
    this.generation += 1
    this.fresh = false
    this.set({ mode: 'try', changed: false, target: undefined, highlight: undefined, lost: undefined })
  }

  /** Watch, after Try it: the bytes again, and back to the scene it had reached. From `ready`, the start. */
  watch(): void {
    if (this.state.mode === 'ready') {
      this.start()
      return
    }
    if (this.state.mode !== 'try') return
    void this.replay(this.scenes[this.state.scene]?.first ?? 0)
  }

  /** Stops it. The view's own subscription is the view's to drop, so a remount can start it again. */
  dispose(): void {
    this.generation += 1
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  private set(next: Partial<TourSnapshot>): void {
    this.state = { ...this.state, ...next }
    const { mode, scene, step } = this.state
    // A new chat line is read from when it comes up, as a caption is (M33 F5).
    const key =
      mode === 'watch' || mode === 'opening' || mode === 'ready'
        ? `scene ${String(scene)} line ${String(chatUpTo(this.steps, step).length)}`
        : mode
    if (key !== this.shown.key) this.shown = { key, at: performance.now() }
    for (const listener of this.listeners) listener()
  }

  /**
   * What is left of a caption's reading time, in the 1x ms `hold` takes: it
   * counts from when the caption came up, so a caption read while the app was
   * opening, or while the ring travelled, is not read twice.
   */
  private unread(reading: number): number {
    return Math.max(0, reading - (performance.now() - this.shown.at) * this.state.speed)
  }

  /**
   * **The check** (M33 U3, `scripts/check-tours.mjs`): every row at
   * fast-forward over the document as the app page opened it, once, with no
   * loop — the first anchor or outline that never comes is the answer. It
   * plays inside the frame itself, so the app is laid out as a visitor's is,
   * the paper beside it included. At every anchor it asks the frame whether
   * the ring is in view (`ringCheck`, M33 F4), so the ring and the outline
   * are set as they are when the tour plays.
   */
  async check(ringCheck?: RingCheck): Promise<TourCheck> {
    const generation = ++this.generation
    const started = performance.now()
    const ms = (): number => Math.round(performance.now() - started)
    this.checking = true
    this.ringCheck = ringCheck
    try {
      await this.stage.handle()
      for (let step = 0; step < this.steps.length; step += 1) {
        await this.act(step, generation, true)
        // Every row with the app as wide as the frame lays it out: nothing of it
        // off a box's edge, where a click scrolls the rest away (M33 F1).
        const cramped = sideways(this.stage.doc())
        if (cramped !== undefined) {
          return { ok: false, step: step + 1, said: `Step ${String(step + 1)}: the app scrolls sideways — ${cramped}.`, ms: ms() }
        }
      }
      return { ok: true, steps: this.steps.length, ms: ms() }
    } catch (error) {
      if (error instanceof TourLost || error instanceof TypingMoved || error instanceof RingOutside || error instanceof TourRefused || error instanceof OutlineOutlived) return { ok: false, step: error.step + 1, said: error.message, ms: ms() }
      return { ok: false, step: undefined, said: String(error), ms: ms() }
    }
  }

  private async replay(from: number): Promise<void> {
    const generation = ++this.generation
    const live = (): void => {
      if (generation !== this.generation) throw new TourCancelled()
    }
    try {
      // The first play shows its first caption while the app opens; every
      // other start says the document is being put back.
      if (!this.fresh) this.set({ mode: 'catching-up', target: undefined, highlight: undefined, lost: undefined, changed: false })
      const handle = await this.stage.handle()
      live()
      if (this.unsubscribe === undefined) {
        this.unsubscribe = handle.onWrite(() => {
          if (this.state.mode === 'try' && !this.state.changed) this.set({ changed: true })
        })
      }
      for (let at = from; ; at = 0) {
        if (!this.fresh || at !== 0) {
          this.set({ mode: 'catching-up', target: undefined, highlight: undefined, lost: undefined, changed: false })
          await handle.reopen()
          live()
        }
        this.fresh = false
        for (let step = 0; step < at; step += 1) await this.act(step, generation, true)
        this.set({ mode: 'watch' })
        for (let step = at; step < this.steps.length; step += 1) await this.act(step, generation, false)
        const closing = this.steps.at(-1)?.caption
        await this.hold(Math.max(PACE.last, closing === undefined ? 0 : readingTime(closing)), generation)
      }
    } catch (error) {
      if (error instanceof TourCancelled) return
      const said = error instanceof TourLost || error instanceof TourRefused ? error.message : `The tour stopped: ${String(error)}`
      console.error(said, error)
      if (generation === this.generation) this.set({ mode: 'try', target: undefined, lost: said })
    }
  }

  /**
   * One row. A row that starts a scene shows its caption and holds it for its
   * reading time first; then the ring travels, acts, and takes one beat. A
   * `say` is its caption held, with the ring on what it is about.
   */
  private async act(index: number, generation: number, fast: boolean): Promise<void> {
    const step = this.steps[index]
    if (step === undefined) return
    const cancelled = (): boolean => generation !== this.generation
    const live = (): void => {
      if (cancelled()) throw new TourCancelled()
    }
    const doc = this.stage.doc()
    const scene = sceneAt(this.scenes, index)
    const last = index === this.steps.length - 1
    // What is new on screen with this row — its caption, its chat line, or
    // both — is read by the captions' rule (M33 F5).
    const fresh = [step.caption, step.chat].filter((each) => each !== undefined).join(' ')
    const reading = fresh === '' ? 0 : readingTime(fresh)
    const saying = step.action === 'say' || step.action === 'wait'
    const outlines = step.highlight !== undefined

    // An outline is the point of its row and of the rows after it that only
    // talk: a new scene lets go of it, and so does a row that acts without
    // outlining, before the ring sets off — so it never stays over a box the
    // screen moves on from (M33 F6). A row that outlines moves it straight on.
    const letsGo = step.caption !== undefined || (!saying && !outlines)
    if (letsGo && this.state.highlight !== undefined) this.set({ highlight: undefined })
    // At the row's start, fast or not, so the frame lays the app out for its
    // scene (the paper beside it) before the row acts.
    this.set(fast ? { step: index, scene } : { mode: 'watch', step: index, scene })
    // A row that starts a scene and acts: the ring sets off under the caption
    // at once, and the caption is read before the first click or keystroke (M33
    // F1). A row that outlines what its caption is about acts first: the action
    // brings the box on, the outline draws, and the caption is read with it in
    // view. A `say` is read after the ring is on its anchor.
    const reads = !fast && !saying && reading > 0 && !outlines
    if (reads) await this.hold(Math.min(PACE.lead, this.unread(reading)), generation)

    let element: HTMLElement | undefined
    if (step.anchor !== undefined) {
      // **Never measured mid-move** (M39 U2): the last action may have set rows
      // sliding or a panel growing, and a box measured now is where it was a
      // frame ago. The layout's own animations say when it has stopped.
      await layoutSettled(doc, cancelled)
      live()
      element = await waitForAnchor(doc, step.anchor, index, cancelled, 'anchor')
      live()
      // An anchor that arrived with motion of its own (a panel making its
      // room): found again once it has stopped, in case the move replaced it.
      if (await layoutSettled(doc, cancelled)) {
        live()
        element = await waitForAnchor(doc, step.anchor, index, cancelled, 'anchor')
        live()
      }
      if (bringIntoView(element)) {
        await painted(doc)
        live()
      }
      if (!fast) {
        this.set({ target: element })
        if (!this.motion.reduced) await this.hold(PACE.travel, generation)
      } else if (this.checking) {
        this.set({ target: element })
        this.ringSeen(index, element)
      }
    } else if (!fast || this.checking) {
      this.set({ target: undefined })
    }
    if (reads) {
      await this.hold(this.unread(Math.min(reading, PACE.read)), generation)
      live()
    }

    if (step.write !== undefined) {
      // The model's line first, then what it writes: the rows arrive through
      // the engine and the screen redraws them as after any write (M33 F5).
      if (!fast && !reads) await this.hold(PACE.lead, generation)
      const handle = await this.stage.handle()
      live()
      try {
        if ('declare' in step.write) handle.declare(step.write.declare)
        else handle.record(step.write.format, step.write.rows)
      } catch (error) {
        throw new TourRefused(index, error instanceof Error ? error.message : String(error))
      }
    } else if (element !== undefined) {
      if (step.action === 'click') {
        if (!fast) this.set({ presses: this.state.presses + 1 })
        click(element)
      } else if (step.action === 'press') {
        if (!fast) this.set({ presses: this.state.presses + 1 })
        press(element, step.value ?? 'Enter')
      } else if (step.action === 'type') {
        element.focus({ preventScroll: true })
        const before = startingText(element, step)
        const value = step.value ?? ''
        if (this.checking) {
          const moved = await typedStill(element, before, value)
          if (moved !== undefined) throw new TypingMoved(index, moved)
        } else if (fast || this.motion.reduced) setText(element, before + value)
        else {
          if (step.replace === true) setText(element, '')
          for (let typed = 1; typed <= value.length; typed += 1) {
            setText(element, before + value.slice(0, typed))
            await this.hold(PACE.key, generation)
          }
        }
      }
    }
    // A click that navigates is drawn a frame or more later (M43 U10).
    await routeDrawn(doc, cancelled)
    await painted(doc)
    live()
    // The outline, once the action has brought its box on screen and the
    // layout has stopped moving (M39 U2).
    if (step.highlight !== undefined) {
      await layoutSettled(doc, cancelled)
      live()
      const highlight = await waitForAnchor(doc, step.highlight, index, cancelled, 'highlight')
      live()
      // A box no action brought on — rows a `write` added at a list's foot
      // (M33 F5) — is scrolled into view as an anchor is.
      if (bringIntoView(highlight)) {
        await painted(doc)
        live()
      }
      if (!fast) this.set({ highlight })
      else if (this.checking) {
        this.set({ highlight })
        if (element?.isConnected === true) this.ringSeen(index, element)
      }
    }
    // The check's: an outline held into this row is over a box still on the
    // screen, or it has outlived what it was the point of (M33 F6).
    if (this.checking && this.state.highlight !== undefined && !onScreen(this.state.highlight)) throw new OutlineOutlived(index)
    if (fast) return
    // The last row's hold is the loop's (`PACE.last`, or its reading if longer).
    if (last) return
    // A caption read with its box in view is held for what is left of its
    // reading, counted from when it came up, and long enough to see the outline.
    await this.hold(
      outlines ? Math.max(this.unread(reading), PACE.outlined) : saying ? Math.max(this.unread(reading), PACE.beat) : PACE.beat,
      generation,
    )
  }

  /** The check's: the ring on `element`, with this scene's outline, is where a visitor sees it, or the step fails. */
  private ringSeen(index: number, element: HTMLElement): void {
    const said = this.ringCheck?.(element, this.state.highlight)
    if (said !== undefined) throw new RingOutside(index, said)
  }

  /** A hold for the eye, at the visitor's speed. */
  private hold(ms: number, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => (generation === this.generation ? resolve() : reject(new TourCancelled())), ms / this.state.speed)
    })
  }
}
