/**
 * "May the app write this document by itself, and when?" — the policy half,
 * with no DOM and no store in it, the same shape as `externalChange.ts`.
 *
 * D-155 in one sentence: **auto-save makes the file more reliable; it must not
 * make the document optional.** Every rule below is that sentence applied
 * somewhere, and the one it exists to protect is D-115 — the app is
 * document-based on purpose, and the failure mode named in advance is *making
 * the app stateful because it finally could*.
 *
 * So this never answers "yes" for a document with nowhere to write. That is not
 * a limitation working around a missing feature; it is the decision. A file the
 * user named is the only place this app puts money, and inventing a default
 * location would be the mistake D-115 exists to prevent.
 */

import { wouldOverwrite, type DiskState } from './externalChange.ts'

/**
 * How long the app waits after the last edit before writing.
 *
 * Long enough that typing through a form is one save rather than twelve, short
 * enough that "did that save?" never becomes a question worth asking. Each write
 * exports the whole database (`mutate` already does that for the crash cache on
 * every mutation, so the cost is a known one).
 */
export const AUTO_SAVE_IDLE_MS = 1_200

/**
 * The ceiling: however long the edits keep coming, the document is written at
 * most this long after the first unsaved one.
 *
 * Without it a slider being dragged for a minute is a minute of work held in
 * memory — which is exactly the afternoon the dirty dot was invented to protect.
 */
export const AUTO_SAVE_CEILING_MS = 8_000

/** What the app knows about the document when it is deciding whether to write. */
export interface AutoSaveInputs {
  readonly hasDocument: boolean
  readonly isDirty: boolean
  /** Something else is already opening, creating, saving or reloading. */
  readonly isBusy: boolean
  /** The adapter can write without a picker. False for downloads, always. */
  readonly canSaveSilently: boolean
  /**
   * We have read or written this file, so there is a path or a handle behind
   * it. `knownMark === undefined` is how a never-saved document says it has
   * nowhere to go — see rule 1.
   */
  readonly knowsTheFile: boolean
  readonly diskState: DiskState
}

/**
 * Whether the app may write this document on its own right now.
 *
 * The order is the argument: what cannot be written at all, then what must not
 * be written yet, then what would overwrite somebody else.
 */
export function mayAutoSave(inputs: AutoSaveInputs): boolean {
  if (!canAutoSaveAtAll(inputs)) return false
  if (!inputs.isDirty || inputs.isBusy) return false
  // D-092 and D-127's refusal, reused rather than re-implemented: an automatic
  // write that loses another writer's work is worse than every prompt it ever
  // saved. `save()` re-checks the disk itself; this stops the attempt from
  // being made in the first place, so a standing conflict does not become a
  // timer that fires every second and answers itself.
  return !wouldOverwrite(inputs.diskState)
}

/**
 * Whether this document *could* ever be written automatically — a fact about
 * where it lives, not about whether it has unsaved work.
 *
 * The UI needs this separately, because the dirty indicator says different true
 * things in the two cases: under auto-save it reports what just happened, and
 * under the download adapter it still has to ask for a save. Rule 6 — the
 * download adapter is unchanged and says so — lives here.
 */
export function canAutoSaveAtAll(
  inputs: Pick<AutoSaveInputs, 'hasDocument' | 'canSaveSilently' | 'knowsTheFile'>,
): boolean {
  return inputs.hasDocument && inputs.canSaveSilently && inputs.knowsTheFile
}

/**
 * When the write should happen, as a timestamp: the debounce, capped by the
 * ceiling.
 *
 * `firstEditAt` is the first unsaved edit of the current run and `lastEditAt`
 * the most recent one. Pure, so the two timings are testable without waiting
 * for them.
 */
export function autoSaveAt(
  firstEditAt: number,
  lastEditAt: number,
  timing: { readonly idleMs?: number; readonly ceilingMs?: number } = {},
): number {
  const idleMs = timing.idleMs ?? AUTO_SAVE_IDLE_MS
  const ceilingMs = timing.ceilingMs ?? AUTO_SAVE_CEILING_MS
  return Math.min(lastEditAt + idleMs, firstEditAt + ceilingMs)
}
