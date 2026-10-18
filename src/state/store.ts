import { useSyncExternalStore } from 'react'

/**
 * A value kept outside React, that React can watch.
 *
 * For state that something outside the component tree has to read or change —
 * a keyboard shortcut on the window, the shell's menu, a read that outlives the
 * flow that started it — and that is too small for a framework store: the
 * sidebar, the theme, the command palette, the guide, the full-window claim,
 * the payslip and statement batches and the document being read.
 */
export interface Store<T> {
  /** The value now, outside a render. */
  get(): T
  /** Replace it, and tell every subscriber — unless it is the same value. */
  set(next: T): void
  subscribe(listener: () => void): () => void
  /** The value in a component, which draws again when it changes. */
  use(): T
}

/**
 * A store holding `initial`. **The same value is not news**: a `set` that
 * changes nothing tells nobody, by `Object.is` unless `same` says otherwise —
 * which a store of a fresh object per write needs, so `useSyncExternalStore`
 * is not handed a new snapshot it would draw for, or loop on.
 */
export function createStore<T>(
  initial: T,
  same: (a: T, b: T) => boolean = Object.is,
): Store<T> {
  let current = initial
  const listeners = new Set<() => void>()
  const get = (): T => current
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    get,
    set(next) {
      if (same(current, next)) return
      current = next
      for (const listener of listeners) listener()
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, get, get),
  }
}
