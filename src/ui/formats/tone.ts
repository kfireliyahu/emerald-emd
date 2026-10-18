/**
 * **How a state looks** — M27 U8, D-306.
 *
 * Four tones, and they are presentation and nothing else: a dot, a chip, a
 * segment of a bar and a card's edge read one, and no rule, count or view
 * reads it to decide anything. That is why it is a word list here rather than
 * a setting in the declaration — the engine never needs to know which member
 * is "done" to be right, only to look it.
 *
 * - `live` — work under way, which is where you act: `in_progress`, an `open`
 *   milestone. The one tone that wears `accent` (D-306 amends D-125: live work
 *   is something you act on, so marking it is not reporting a fact).
 * - `done` — filled ink: `built`, `closed`, a decision still `live`.
 * - `struck` — dashed and struck through: `dropped`, `superseded`.
 * - `waiting` — hollow: everything else, `planned` included, and any member a
 *   format somebody declared calls something this list has not heard of.
 *
 * An unknown member is `waiting` on purpose: hollow is the tone that claims
 * nothing, so a word missing from the list costs a dot its fill and never puts
 * accent on something nobody is working on.
 */
export type Tone = 'live' | 'done' | 'struck' | 'waiting'

const LIVE: ReadonlySet<string> = new Set(['in_progress', 'open', 'active', 'doing'])
const DONE: ReadonlySet<string> = new Set(['built', 'closed', 'done', 'live', 'answered', 'accepted', 'finished'])
const STRUCK: ReadonlySet<string> = new Set(['dropped', 'superseded', 'cancelled', 'canceled'])

export function toneOf(member: string | undefined): Tone {
  if (member === undefined) return 'waiting'
  const word = member.toLowerCase()
  if (LIVE.has(word)) return 'live'
  if (DONE.has(word)) return 'done'
  if (STRUCK.has(word)) return 'struck'
  return 'waiting'
}

/** A member as a chip prints it: `in_progress` is "in progress". */
export function memberText(member: string): string {
  return member.replace(/_/g, ' ')
}

/**
 * Where a timeline's line stops being solid: the first `live` row, or the
 * first row that is not `done` when none is live — or past the end when every
 * row is done. Solid is what happened; dashed is what is still ahead.
 */
export function liveIndex(tones: readonly Tone[]): number {
  const live = tones.indexOf('live')
  if (live !== -1) return live
  const ahead = tones.findIndex((tone) => tone !== 'done' && tone !== 'struck')
  return ahead === -1 ? tones.length : ahead
}
