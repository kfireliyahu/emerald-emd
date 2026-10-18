/**
 * "Has the file changed underneath us?" — the policy half, with no DOM in it.
 *
 * The app holds the document in memory and overwrites the file wholesale on
 * save. Without this check, anything else that writes the same file — a second
 * tab, a sync client, the Claude plugin (docs/f14) — is silently undone by the
 * next Save. D-092 answers that with "the app learns to reload rather than
 * clobber", and this is what it compares.
 *
 * A mark is the file's `lastModified` and `size`. Neither is a content hash and
 * this is deliberate: reading the whole file back on every window focus to hash
 * it would make focusing the tab cost as much as opening the document. A
 * changed file that kept both is possible in theory and harmless in practice —
 * the failure mode is the one we already have, and only for a writer that
 * preserves the timestamp to the millisecond and the size to the byte.
 */

import { marksDiffer } from '../../../electron/bridge.ts'

/** What the file looked like at a moment: cheap facts, not content. */
export interface FileMark {
  readonly lastModified: number
  readonly size: number
}

/** What an adapter can say about the file right now. */
export type MarkReading =
  /** This adapter has no file to watch — no handle yet, or downloads-only. */
  | { readonly kind: 'unwatched' }
  | { readonly kind: 'mark'; readonly mark: FileMark }
  /** There is a handle, but the file behind it could not be read. */
  | { readonly kind: 'unreadable'; readonly reason: string }

export type DiskState =
  /** Nothing to compare. Not a claim that the file is unchanged. */
  | { readonly kind: 'unwatched' }
  | { readonly kind: 'in-sync' }
  | { readonly kind: 'changed'; readonly hasUnsavedWork: boolean }
  | { readonly kind: 'unreadable'; readonly reason: string }

/**
 * The whole decision, as one pure function of three inputs.
 *
 * `known` is the mark taken when we last read or wrote the file — undefined
 * until we have done either, which is why a brand-new document is `unwatched`
 * rather than `in-sync`: we have no basis for the reassuring answer.
 */
export function compareToDisk(
  known: FileMark | undefined,
  reading: MarkReading,
  hasUnsavedWork: boolean,
): DiskState {
  if (reading.kind === 'unwatched') return { kind: 'unwatched' }
  if (reading.kind === 'unreadable') return { kind: 'unreadable', reason: reading.reason }
  if (known === undefined) return { kind: 'unwatched' }
  return marksDiffer(known, reading.mark)
    ? { kind: 'changed', hasUnsavedWork }
    : { kind: 'in-sync' }
}

/** True when saving would overwrite something the app has not seen. */
export function wouldOverwrite(state: DiskState): boolean {
  return state.kind === 'changed'
}

/**
 * `untitled-2026-08.emd` → `untitled-2026-08 (copy).emd`.
 *
 * The lossless way out of a conflict: the disk keeps what the other writer put
 * there, and this session's work goes somewhere new. A name already ending in
 * `(copy)` is not stacked, because the second conflict in one session is
 * exactly when a pile of `(copy) (copy)` files stops being readable.
 */
export function copyFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const extension = dot <= 0 ? '' : name.slice(dot)
  const trimmed = stem.trimEnd()
  return trimmed.endsWith('(copy)') ? `${trimmed}${extension}` : `${trimmed} (copy)${extension}`
}

/**
 * True when the window should simply re-read the file (M27 U6): it changed,
 * and nothing here is unsaved, so the disk holds everything the window does
 * and more. With unsaved work it is still the person's question.
 */
export function followsDisk(state: DiskState): boolean {
  return state.kind === 'changed' && !state.hasUnsavedWork
}
