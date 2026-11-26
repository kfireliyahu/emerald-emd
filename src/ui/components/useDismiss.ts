import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

/**
 * **How a popover is dismissed — one way, for all of them** (M45 F1, S-071).
 *
 * Six popovers wrote this six times and differed in ways a person could feel:
 * three ignored Escape, two let it through to the editor behind, so one key
 * closed both, and one decided "outside" by where a click's target was *now*
 * rather than by the path it took. The one rule:
 *
 * - **A press outside closes it** — on `pointerdown`, on the document, and
 *   outside by the event's `composedPath()`, so a target the press itself swapped
 *   out of the page is not outside (CategoryPicker's *+ New…*, M31 U6).
 * - **Escape closes it, and only it.** From outside the popover it is caught in
 *   the capture phase on the document and stopped there, as WherePicker did, so
 *   an editor, a drawer or a frame behind it never hears the key. From inside, the
 *   popover's own keyboard handling goes first — a search input, or the category
 *   picker's create form, where Escape goes back to the list — and whatever it
 *   leaves reaches the handler this returns, which closes the popover at its
 *   edge and stops the key there. Spread it as the box's `onKeyDown`.
 */
export function useDismiss(
  open: boolean,
  box: RefObject<HTMLElement | null>,
  close: () => void,
): (event: ReactKeyboardEvent) => void {
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })

  useEffect(() => {
    if (!open) return
    const outside = (event: Event): boolean => {
      const element = box.current
      return element !== null && !event.composedPath().includes(element)
    }
    const away = (event: PointerEvent): void => {
      if (outside(event)) latest.current()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !outside(event)) return
      event.stopPropagation()
      latest.current()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key, true)
    }
  }, [open, box])

  return (event) => {
    if (!open || event.key !== 'Escape') return
    event.stopPropagation()
    latest.current()
  }
}

/**
 * **A question asked where its button was** (M64 U15, the walk of D-617's
 * conventions): *Delete Groceries? Delete · Keep* standing in the place of the
 * button that asked. It behaves as every popover does — its confirming button
 * has the focus, so Enter answers; Escape takes the question back and nothing
 * else, so the panel it was asked in stays open; a press outside takes it back
 * too — and focus returns to the button that asked. Spread `onKeyDown` and
 * `box` on the question, `back` on the button, and call `takeBack` for Keep.
 */
export function useAskHere<Box extends HTMLElement>(
  asking: boolean,
  cancel: () => void,
): {
  readonly box: RefObject<Box>
  readonly back: RefObject<HTMLButtonElement>
  readonly onKeyDown: (event: ReactKeyboardEvent) => void
  readonly takeBack: () => void
} {
  const box = useRef<Box>(null)
  const back = useRef<HTMLButtonElement>(null)
  const takeBack = (): void => {
    cancel()
    // The button is drawn again once the question has gone.
    requestAnimationFrame(() => back.current?.focus({ preventScroll: true }))
  }
  const onKeyDown = useDismiss(asking, box, takeBack)
  return { box, back, onKeyDown, takeBack }
}
