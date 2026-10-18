/**
 * **Guide me** — a walk through the real screens, one place at a time (M28 U9, D-330).
 *
 * The engine's half: a pack hands it a list of steps and what its document
 * says about each, and these functions decide which step comes next, which are
 * passed over and where a guide that was put away picks up. **A step only
 * points** (choice b, A): the screen does the work and the step
 * ticks itself when the document shows it done, so the guide adds no write of
 * its own beyond remembering where it stopped.
 *
 * Nothing here knows about money. The ledger is the first pack to declare a list
 * (`data/packs/ledger/guide.ts`); the engine's own guide — formats, linking — is
 * the same reader with another list. Plain functions over plain values: no
 * React, no sql.js, no DOM.
 */

/** One place on a real screen, as a pack declares it (S2). */
export interface GuideStep {
  readonly id: string
  /** The route the step stands on, as the router names it: `/plan`. */
  readonly route: string
  /** Where that is, in the rail's words: `Plan › The split`. */
  readonly where: string
  /**
   * The named place on the screen (S4) — a screen marks it `data-guide="plan.split"`,
   * and a test fails when a step names a place no screen has.
   */
  readonly place: string
  readonly title: string
  readonly body: string
  /** What the document has to show for the step to tick itself, as a phrase: `a plan exists`. */
  readonly test: string
  /**
   * A step that has nothing to show until another is done (S5): it says so and
   * waits, rather than pointing at an empty page as if it were done.
   */
  readonly needs?: { readonly step: string; readonly until: string } | undefined
}

/** What the document says about one step. `says` names what it found (S1). */
export interface GuideCheck {
  readonly done: boolean
  readonly says?: string | undefined
}

export type GuideChecks = Readonly<Record<string, GuideCheck>>

/**
 * Where the guide is in this document — the place onboarding's progress kept,
 * reshaped (choice a, B).
 *
 * `step` is where it stopped when it was put away; `offered` is whether a new
 * document has been asked once; `started` is whether the walk was ever opened,
 * which turns Home's *Guide me* into *Continue the guide*; `lineAway` is Home's
 * line, put away.
 */
export interface GuideProgress {
  readonly offered: boolean
  readonly started: boolean
  readonly step: string | undefined
  readonly lineAway: boolean
}

/** A new document: ask once, and show the line on Home. */
export const FRESH_GUIDE: GuideProgress = { offered: false, started: false, step: undefined, lineAway: false }

/**
 * A document that already holds work and was never asked: nothing on Home and
 * no offer. Help › Guide me still opens it — the app forgetting what it can
 * plainly see is the thing onboarding's `NO_ONBOARDING` existed to prevent.
 */
export const QUIET_GUIDE: GuideProgress = { offered: true, started: false, step: undefined, lineAway: true }

export function isDone(checks: GuideChecks, id: string): boolean {
  return checks[id]?.done === true
}

export function doneCount(steps: readonly GuideStep[], checks: GuideChecks): number {
  return steps.filter((step) => isDone(checks, step.id)).length
}

/** The first step not done, or the first step when every one is. */
export function firstOpen(steps: readonly GuideStep[], checks: GuideChecks): number {
  const index = steps.findIndex((step) => !isDone(checks, step.id))
  return index < 0 ? 0 : index
}

/**
 * The step after (or before) this one, **passing over the done ones** (choice d, B):
 * ticked in the strip and still one press away, but Next does not stop on them.
 * Returns `steps.length` past the end and `-1` before the start.
 */
export function move(steps: readonly GuideStep[], checks: GuideChecks, from: number, direction: 1 | -1): number {
  let index = from + direction
  while (index >= 0 && index < steps.length && isDone(checks, steps[index]?.id ?? '')) index += direction
  return index
}

/**
 * Where the guide opens (choice c, B): the step it stopped at, unless that one
 * has been done since — then the first step still open.
 */
export function resumeAt(steps: readonly GuideStep[], checks: GuideChecks, progress: GuideProgress): number {
  const stopped = steps.findIndex((step) => step.id === progress.step)
  if (stopped >= 0 && !isDone(checks, progress.step ?? '')) return stopped
  return firstOpen(steps, checks)
}

/**
 * What the step says about itself under its words: done and what was found,
 * later and why, or waiting on the screen.
 */
export type StepState =
  | { readonly kind: 'done'; readonly says: string }
  | { readonly kind: 'later'; readonly until: string }
  | { readonly kind: 'waiting'; readonly test: string }

export function stepState(step: GuideStep, checks: GuideChecks): StepState {
  const check = checks[step.id]
  if (check?.done === true) return { kind: 'done', says: check.says ?? 'Done.' }
  if (step.needs !== undefined && !isDone(checks, step.needs.step)) return { kind: 'later', until: step.needs.until }
  return { kind: 'waiting', test: step.test }
}

/** The first word of `where` — the screen a step stands on: `Plan`. */
export function screenOf(step: GuideStep): string {
  return step.where.split(' › ')[0] ?? step.where
}

/**
 * The label on the step's forward button, as the mockup words it: `Next` on the
 * same screen, `Next: Plan` when the next step is on another, `Finish` at the
 * end — and while a step is not done, `Skip for now` or `Skip, go to Plan`.
 */
export function forwardLabel(steps: readonly GuideStep[], checks: GuideChecks, index: number): string {
  const step = steps[index]
  if (step === undefined) return 'Finish'
  const next = move(steps, checks, index, 1)
  const target = steps[next]
  if (target === undefined) return 'Finish'
  const otherScreen = screenOf(target) !== screenOf(step)
  if (isDone(checks, step.id)) return otherScreen ? `Next: ${screenOf(target)}` : 'Next'
  return otherScreen ? `Skip, go to ${screenOf(target)}` : 'Skip for now'
}

/** The step's title as the end of a sentence: `Next: give each shop a category, once.` */
export function asNext(step: GuideStep): string {
  return `${step.title.charAt(0).toLowerCase()}${step.title.slice(1)}`
}

/** Decode a stored progress defensively: the document is a database anyone can edit. */
export function decodeGuideProgress(value: Record<string, unknown> | undefined): GuideProgress | undefined {
  if (value === undefined) return undefined
  const step = value['step']
  return {
    offered: value['offered'] === true,
    started: value['started'] === true,
    step: typeof step === 'string' && step !== '' ? step : undefined,
    lineAway: value['lineAway'] === true,
  }
}
