import { createStore } from '@/state/store.ts'

/**
 * Whether the guide is open, and on which step — outside React, for the reason
 * the palette's open state is (D-130): four things open it — Home's line, the
 * offer, the palette and the shell's Help menu — and only one of them is in the
 * dialog's tree.
 *
 * Not the document: where the guide *stopped* is written there when it is put
 * away (`saveGuideProgress`); which step is on screen right now is a view, and
 * writing it on every press would mark the file dirty for walking through it.
 */

export type GuideOpen =
  /** Open on a step, by its index in the pack's list. */
  | { readonly kind: 'step'; readonly index: number }
  /** Asked to open, at the place it stopped — the dialog resolves where that is. */
  | { readonly kind: 'resume' }
  | undefined

/** Where the guide is; the same place asked for again is not a change, though it is a new object. */
const open = createStore<GuideOpen>(undefined, (a, b) => JSON.stringify(a) === JSON.stringify(b))
/** The step whose screen the walk last went to — kept out here so it outlives the dialog. */
let landed: number | undefined = undefined

/** Where the guide is now, outside a render — for keys pressed faster than React draws. */
export function currentGuideOpen(): GuideOpen {
  return open.get()
}

export function setGuideOpen(next: GuideOpen): void {
  if (JSON.stringify(next) === JSON.stringify(open.get())) return
  // A fresh open, or putting it away, goes to the step's screen again.
  if (next === undefined || next.kind === 'resume') landed = undefined
  open.set(next)
}

/**
 * True the first time the walk stands on this step since it was opened. The
 * dialog unmounts while a flow has the window (the column mapper, a payslip
 * review) and mounts again when it closes; on that remount the step has not
 * changed, so the person stays where the flow left them — Read files with the
 * next file waiting — rather than being sent back to the step's screen.
 */
export function landOn(index: number): boolean {
  if (landed === index) return false
  landed = index
  return true
}

/** Help › Guide me, the palette and Home's line: open where it stopped, or on a given step. */
export function openGuide(index?: number): void {
  setGuideOpen(index === undefined ? { kind: 'resume' } : { kind: 'step', index })
}

export function useGuideOpen(): GuideOpen {
  return open.use()
}
