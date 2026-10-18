import type { TourSnapshot } from './player.ts'

/**
 * **What the frame tells the page it is embedded in** (M33 U4, D-418), and
 * nothing else: which step is on screen while the tour plays, that the visitor
 * took it over, and that they pressed Reset. A page that embeds the frame can
 * follow along — a caption of its own, a count — and a page that does not
 * listen loses nothing.
 *
 * `step` is the step the strip shows after the event, counted from 1 as the
 * strip counts it (`2 / 5`), and `of` is how many there are. A Reset says 1,
 * the step it goes back to.
 *
 * Posted to `'*'`: with `referrerpolicy=no-referrer` the frame cannot know the
 * page's origin, and the message holds two counts and a word — nothing a page
 * that is not the parent could learn anything from. It goes only to
 * `window.parent`, and only when there is one.
 */
export const EMBED_SOURCE = 'emerald-demo'

export type EmbedEvent = 'step' | 'took-over' | 'reset'

export interface EmbedMessage {
  readonly source: typeof EMBED_SOURCE
  readonly event: EmbedEvent
  readonly step: number
  readonly of: number
}

type Seen = Pick<TourSnapshot, 'mode' | 'scene' | 'lost'>

/**
 * What a change of the player's state says to the parent, if anything: a step
 * coming up while the tour plays — never while it fast-forwards — or the
 * visitor taking it over. A tour that lost its way says nothing; it is not the
 * visitor's doing.
 */
export function messageBetween(was: Seen | undefined, now: Seen, of: number): EmbedMessage | undefined {
  if (now.mode === 'watch' && (was === undefined || was.mode !== 'watch' || was.scene !== now.scene)) {
    return { source: EMBED_SOURCE, event: 'step', step: now.scene + 1, of }
  }
  if (now.mode === 'try' && now.lost === undefined && was?.mode !== 'try') {
    return { source: EMBED_SOURCE, event: 'took-over', step: now.scene + 1, of }
  }
  return undefined
}

/** Reset: the tour goes back to its first step. */
export function resetMessage(of: number): EmbedMessage {
  return { source: EMBED_SOURCE, event: 'reset', step: 1, of }
}

/** To the page around the frame, when there is one. */
export function tell(message: EmbedMessage, from: Window = window): void {
  if (from.parent === from) return
  from.parent.postMessage(message, '*')
}
