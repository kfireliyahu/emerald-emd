import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import { createStore } from '@/state/store.ts'

/**
 * **Whether an entry keeps its format's list beside it** — M37 U2b (D-475, 2B).
 *
 * The viewer's, not the document's: one boolean kept the way the rail's
 * collapsed state is (`useSidebar`), so hiding the list once hides it on every
 * entry until it is shown again, across a reload and a relaunch. Shown is the
 * default; a narrow window hides it by itself whatever this says.
 */

const STORAGE_KEY = 'fc-entry-list-hidden'

const hidden = createStore(readPreference(STORAGE_KEY) === 'true')

export function toggleEntryList(): void {
  const next = !hidden.get()
  writePreference(STORAGE_KEY, String(next))
  hidden.set(next)
}

export function useEntryListHidden(): boolean {
  return hidden.use()
}
