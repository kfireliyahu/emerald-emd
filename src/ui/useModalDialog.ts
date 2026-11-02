import { useEffect, type KeyboardEvent, type RefObject } from 'react'

import { createStore } from '@/state/store.ts'

/**
 * **One modal dialog at a time, holding focus while it is open** (M54 F6).
 *
 * About and Earlier copies are each `aria-modal`, and the native menu can ask
 * for one while the other is open: both were drawn, one over the other. They
 * share this store, so opening one closes the other.
 *
 * While open, Tab and Shift+Tab move among the dialog's own controls and wrap
 * (WAI-ARIA's modal dialog); closed, focus goes back to what had it before —
 * the control that opened it, or wherever the person was when the menu did.
 */
export type ModalDialog = 'about' | 'earlier-copies'

export const openDialog = createStore<ModalDialog | undefined>(undefined)

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Focus the dialog's box on open, give focus back on close, and keep Tab
 * inside. Spread the returned handler on the box's `onKeyDown`; `onEscape`
 * is what Esc does.
 */
export function useModalDialog(
  panel: RefObject<HTMLElement | null>,
  onEscape: () => void,
): (event: KeyboardEvent<HTMLElement>) => void {
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    panel.current?.focus()
    return () => {
      // Only if it is still on the page: the opener may have gone with a reload.
      if (before !== undefined && before.isConnected) before.focus()
    }
  }, [panel])

  return (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onEscape()
      return
    }
    if (event.key !== 'Tab' || panel.current === null) return
    const stops = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (each) => each.getClientRects().length > 0,
    )
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (first === undefined || last === undefined) {
      event.preventDefault()
      return
    }
    const at = document.activeElement
    if (event.shiftKey && (at === first || at === panel.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (at === last || !panel.current.contains(at))) {
      event.preventDefault()
      first.focus()
    }
  }
}
