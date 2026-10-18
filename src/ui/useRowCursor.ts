import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Where the keyboard is in a table (D-130).
 *
 * "Keyboard navigation works on any screen with a table" has been in
 * [conventions](../../docs/conventions.md)' definition of done since M1, and it
 * was the item there most likely to be quietly untrue: the import review built
 * a full cursor of its own (`j`/`k`, Enter, `s`, `c`) and the ledger and the
 * categorize queue — the two longest tables in the app — had none at all.
 *
 * **The cursor is state, not focus.** That is the whole design, and it is what
 * the roadmap means by "a row focus that survives the window losing focus": a
 * `:focus` ring goes out when you click another window, and coming back to a
 * table that has forgotten which of 500 rows you were on is the difference
 * between a document and a web page. This draws its own marker off a
 * `data-cursor` attribute, so the window can lose focus, the app can lose
 * focus, and the row is still where you left it.
 *
 * Movement only. Keys that *do* something to a row are the screen's — they
 * differ per table, and a hook that guessed would be wrong on every one of
 * them — so `onActivate` and `keys` are handed in.
 */

export interface RowCursor {
  readonly index: number
  readonly set: (index: number) => void
  /** Spread onto the scrolling container. */
  readonly container: {
    readonly ref: (node: HTMLElement | null) => void
    readonly tabIndex: 0
    readonly onKeyDown: (event: React.KeyboardEvent) => void
  }
  /** Spread onto each row, in the same order the rows are rendered. */
  readonly row: (index: number) => { readonly 'data-cursor': boolean }
  /**
   * The element the cursor is on, for a key that has to operate a control
   * *inside* the row — the category picker, say. Reaching for the real control
   * rather than for the component's state is what keeps one implementation of
   * opening it.
   */
  readonly element: () => HTMLElement | undefined
}

/** How far Page Up and Page Down go. A screenful, roughly, at 40px a row. */
const PAGE = 10

export function useRowCursor(
  count: number,
  options: {
    /** Enter, and a click on the row where the screen wires one. */
    readonly onActivate?: (index: number) => void
    /** Extra single-key verbs, by lowercased key. `s` to skip, `c` to pick. */
    readonly keys?: Readonly<Record<string, (index: number) => void>>
  } = {},
): RowCursor {
  const [index, setIndex] = useState(0)
  const container = useRef<HTMLElement | null>(null)
  const { onActivate, keys } = options

  // A filter that shortens the table must not leave the cursor past its end.
  // Clamped rather than reset: narrowing a filter should keep you near where
  // you were, and only the rows that vanished should move you.
  useEffect(() => {
    setIndex((current) => (count === 0 ? 0 : Math.min(current, count - 1)))
  }, [count])

  const set = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(next, Math.max(0, count - 1)))),
    [count],
  )

  const element = useCallback((): HTMLElement | undefined => {
    const found = container.current?.querySelector('[data-cursor="true"]')
    return found instanceof HTMLElement ? found : undefined
  }, [])

  // Follow the cursor, but only as far as it takes: `nearest` leaves the table
  // still when the row is already on screen, which is what makes holding `j`
  // feel like a list rather than a slideshow.
  useEffect(() => {
    element()?.scrollIntoView({ block: 'nearest' })
  }, [index, element])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // A field has its own idea of what these keys mean, and the category
    // picker is a combobox with arrow keys of its own.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return

    const key = event.key.toLowerCase()

    if (event.key === 'ArrowDown' || key === 'j') {
      event.preventDefault()
      set(index + 1)
      return
    }
    if (event.key === 'ArrowUp' || key === 'k') {
      event.preventDefault()
      set(index - 1)
      return
    }
    if (event.key === 'PageDown') {
      event.preventDefault()
      set(index + PAGE)
      return
    }
    if (event.key === 'PageUp') {
      event.preventDefault()
      set(index - PAGE)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      set(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      set(count - 1)
      return
    }
    if (event.key === 'Enter' && onActivate !== undefined) {
      event.preventDefault()
      onActivate(index)
      return
    }

    const verb = keys?.[key]
    if (verb !== undefined) {
      event.preventDefault()
      verb(index)
    }
  }

  return {
    index,
    set,
    container: {
      ref: (node) => {
        container.current = node
      },
      tabIndex: 0,
      onKeyDown,
    },
    row: (at) => ({ 'data-cursor': at === index }),
    element,
  }
}
