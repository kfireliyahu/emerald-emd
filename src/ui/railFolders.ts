import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import { createStore } from '@/state/store.ts'

/**
 * **Which of the rail's format folders are open** — M37 U2 (D-475, 1B).
 *
 * The viewer's, not the document's: kept the way the rail's collapsed state is
 * (`useSidebar`), so a reload and a relaunch open the same folders. A format's
 * name is the key, and a name with `!` before it is a folder the person shut
 * while standing in it — the format you are in opens by itself, and closing it
 * by hand has to be able to win over that.
 *
 * This amends D-130's *no disclosure triangle* for formats only: a section
 * still expands by route. A folder you could not open without leaving where you
 * are would not be one.
 */

const STORAGE_KEY = 'fc-rail-open'

function read(): ReadonlySet<string> {
  const stored = readPreference(STORAGE_KEY)
  if (stored === undefined) return new Set()
  try {
    const parsed: unknown = JSON.parse(stored)
    return new Set(Array.isArray(parsed) ? parsed.filter((each): each is string => typeof each === 'string') : [])
  } catch {
    return new Set()
  }
}

const open = createStore<ReadonlySet<string>>(read())

/** Shut by hand while in it. */
const shut = (name: string): string => `!${name}`

/**
 * Whether a folder is open: opened by hand, or the one you are in and not shut
 * by hand since.
 */
export function folderIsOpen(held: ReadonlySet<string>, name: string, inside: boolean): boolean {
  return held.has(name) || (inside && !held.has(shut(name)))
}

/** The set after the arrow is pressed. */
export function toggled(held: ReadonlySet<string>, name: string, inside: boolean): ReadonlySet<string> {
  const next = new Set(held)
  if (folderIsOpen(held, name, inside)) {
    next.delete(name)
    if (inside) next.add(shut(name))
  } else {
    next.add(name)
    next.delete(shut(name))
  }
  return next
}

export function toggleFolder(name: string, inside: boolean): void {
  const next = toggled(open.get(), name, inside)
  writePreference(STORAGE_KEY, JSON.stringify([...next]))
  open.set(next)
}

export function useOpenFolders(): ReadonlySet<string> {
  return open.use()
}
