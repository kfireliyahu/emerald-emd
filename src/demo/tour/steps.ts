/**
 * **A tour is rows** (M33 U2, D-413): each names an anchor on the real app, one
 * action a person would take there, and — on the row that starts a scene — the
 * caption that scene shows. They are rows of the declared `tour_step` format
 * (M33 U3, `rows.ts`), and the shape here is that format's columns.
 *
 * Nothing in this file touches the DOM: it is the part of the runner a test
 * can hold in Node.
 */

import type { TourDeclare } from './declare.ts'

/** What a step does at its anchor (D-413). */
export type TourAction = 'click' | 'type' | 'press' | 'wait' | 'say' | 'write'

/** Who says a chat line (M33 F5). */
export type Speaker = 'person' | 'model'

/**
 * **What a `write` step writes** (M33 F5): exactly what `record_format_rows`
 * is handed — a format by name and its rows, links by name — run through the
 * same `stageRows` and `insertRows` the tool runs (`DemoHandle.record`).
 */
export type TourWrite =
  | {
      readonly format: string
      readonly rows: readonly Readonly<Record<string, unknown>>[]
    }
  /** A format made, or added to, as `declare_format` and `extend_format` are handed one (M33 U7, `declare.ts`). */
  | { readonly declare: TourDeclare }

export interface TourStep {
  /**
   * Where it acts: a `data-tour` name on the app's element (`new-format`), or
   * `choice:<text>` for the option with exactly that text in an open list,
   * or `row:<text>` for the sheet row holding that text, which need no
   * attribute. Empty for a `say` that points at nothing.
   */
  readonly anchor?: string
  readonly action: TourAction
  /** What `type` types, the key `press` presses (`Enter`), or a `write`'s batch or declaration as JSON. */
  readonly value?: string
  /** A `write`'s batch, read from `value` when the tours are read (`rows.ts`). */
  readonly write?: TourWrite
  /** `type` empties the field first. */
  readonly replace?: boolean
  /** Starts a scene: one caption, one dot. A row without one keeps the caption above it. */
  readonly caption?: string
  /**
   * On a row that starts a scene: a picture the frame shows beside the app for
   * the whole scene — the receipt being typed in (2026-10-07). A
   * file beside the document (`receipt.png`). The app never reads it, and no
   * caption says it does.
   */
  readonly beside?: string
  /**
   * An anchor to outline: a box the eye should be on, drawn around once and
   * held through the rows after it that only talk (`say`, `wait`). A new
   * scene, or a row that acts without outlining, lets go of it, and a row that
   * outlines another moves it there (2026-10-07; M33 F6). Apart from `anchor`, which is where the ring
   * points, and found after the row's action, so it can name what the action
   * brought on screen. `row:<text>` names the sheet row holding that text.
   */
  readonly highlight?: string
  /**
   * A line of the tour's conversation (M33 F5), new on this row: written for
   * the tour, shown in the frame's own panel beside the app and never in it.
   */
  readonly chat?: string
  /** Who says `chat`. */
  readonly from?: Speaker
}

/** A tour's conversation up to and including the row playing: what the panel shows. */
export function chatUpTo(steps: readonly TourStep[], step: number): readonly { readonly at: number; readonly chat: string; readonly from: Speaker }[] {
  return steps.slice(0, step + 1).flatMap((each, at) => (each.chat === undefined ? [] : [{ at, chat: each.chat, from: each.from ?? 'model' }]))
}

/**
 * **A tour**: what the strip says it is, the document it plays over, and its
 * rows (2026-10-07) — a row of the declared `tour` format and the
 * `tour_step` rows that point at it (M33 U3).
 */
export interface Tour {
  /** What the frame is asked for: `custom`. */
  readonly name: string
  /** Drawn large at the top of the strip: the question the tour answers. */
  readonly title: string
  /** One line under the title: why a visitor would ask it. */
  readonly description: string
  /** The document beside the app page it opens (`custom.emd`), by name. */
  readonly document: string
  readonly steps: readonly TourStep[]
}

/** One caption and the rows that make it true: what a dot stands for (P2). */
export interface Scene {
  readonly caption: string
  /** The picture beside the app while this scene plays, if any. */
  readonly beside?: string
  /** The row that carries the caption. */
  readonly first: number
  /** The last row before the next caption. */
  readonly last: number
}

/**
 * The scenes of a tour: a dot per caption, not per row. A tour whose first row
 * has no caption is refused rather than given an empty dot, when the tours are
 * read (`rows.ts`), so the demo never starts on one.
 */
export function scenesOf(steps: readonly TourStep[]): readonly Scene[] {
  const scenes: Scene[] = []
  steps.forEach((step, index) => {
    if (step.caption !== undefined) {
      const previous = scenes.at(-1)
      if (previous !== undefined) scenes[scenes.length - 1] = { ...previous, last: index - 1 }
      scenes.push({
        caption: step.caption,
        first: index,
        last: index,
        ...(step.beside === undefined ? {} : { beside: step.beside }),
      })
    } else if (index === 0) {
      throw new Error('A tour starts with a caption: its first row says what is happening.')
    }
  })
  const previous = scenes.at(-1)
  if (previous !== undefined) scenes[scenes.length - 1] = { ...previous, last: steps.length - 1 }
  return scenes
}

/** The scene a row belongs to, by its index. */
export function sceneAt(scenes: readonly Scene[], step: number): number {
  const found = scenes.findIndex((scene) => step >= scene.first && step <= scene.last)
  return found === -1 ? 0 : found
}

/** What a `choice:` anchor names, or `undefined` for a `data-tour` one. */
export function choiceOf(anchor: string): string | undefined {
  return anchor.startsWith('choice:') ? anchor.slice('choice:'.length) : undefined
}

/** What a `row:` anchor names — text in one of a sheet's rows — or `undefined`. */
export function rowOf(anchor: string): string | undefined {
  return anchor.startsWith('row:') ? anchor.slice('row:'.length) : undefined
}

/**
 * How long a caption is held before its scene's actions start
 * (2026-10-07): set by its length and nothing else — never by how many rows sit
 * under it — so a visitor reads it, then watches it happen at one tempo.
 */
export function readingTime(caption: string): number {
  return READING.base + caption.length * READING.perChar
}

/**
 * About sixteen characters a second, after a moment to find the line: what
 * was 0.75x of 1000 and 48 became 1x (2026-10-07).
 */
export const READING = { base: 1333, perChar: 64 } as const

/** The selector a `data-tour` anchor is found by. */
export function selectorOf(anchor: string): string {
  return `[data-tour="${anchor.replace(/["\\]/g, '\\$&')}"]`
}
