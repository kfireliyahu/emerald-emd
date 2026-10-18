import { useEffect, useState } from 'react'

import { shellWindow } from '@/data/storage/desktop.ts'

/**
 * The frame the app has to draw for itself, in the shell (D-130).
 *
 * The window is frameless: what the platform still draws is the caption
 * buttons, and the whole of this file is about not putting anything underneath
 * them. Three numbers — how tall the bar is, and how much room to leave at each
 * end — and one of them is measured rather than assumed.
 *
 * `undefined` outside the shell. A browser tab already has a title bar and it
 * is not ours to draw.
 */

export interface WindowFrame {
  readonly height: number
  /** macOS's traffic lights sit here. */
  readonly insetStart: number
  /** Chromium's caption buttons sit here, on Windows and Linux. */
  readonly insetEnd: number
}

/**
 * The part of Chromium's Window Controls Overlay we use.
 *
 * Not in the DOM typings, and declared narrowly on purpose: the rectangle it
 * reports is the strip of the title bar the *page* owns, so the width of the
 * caption buttons is what is left over. That number belongs to Chromium and
 * changes with display scaling, which is exactly why it is read rather than
 * hardcoded — the fallback in `electron/windowChrome.ts` is only for the first
 * paint and for the platforms that have no overlay.
 */
interface ControlsOverlay {
  readonly visible: boolean
  getTitlebarAreaRect(): { x: number; width: number }
  addEventListener(type: 'geometrychange', listener: () => void): void
  removeEventListener(type: 'geometrychange', listener: () => void): void
}

function controlsOverlay(): ControlsOverlay | undefined {
  if (typeof navigator === 'undefined') return undefined
  const found = (navigator as unknown as Record<string, unknown>)['windowControlsOverlay']
  return typeof found === 'object' && found !== null ? (found as ControlsOverlay) : undefined
}

function measure(): WindowFrame | undefined {
  const chrome = shellWindow()?.chrome
  if (chrome === undefined || !chrome.frameless) return undefined

  const overlay = controlsOverlay()
  if (overlay === undefined || !overlay.visible) {
    return { height: chrome.height, insetStart: chrome.insetStart, insetEnd: chrome.insetEnd }
  }

  const area = overlay.getTitlebarAreaRect()
  return {
    height: chrome.height,
    insetStart: area.x,
    // What the page does not own is what the buttons occupy. Never negative:
    // a zero-width area during a resize would otherwise reserve the window.
    insetEnd: Math.max(0, window.innerWidth - area.x - area.width),
  }
}

export function useWindowFrame(): WindowFrame | undefined {
  const [frame, setFrame] = useState<WindowFrame | undefined>(measure)

  useEffect(() => {
    const overlay = controlsOverlay()
    if (overlay === undefined) return

    const remeasure = (): void => setFrame(measure)
    // Once on mount, because the overlay's rectangle is not laid out yet when
    // the first render asks for it — measured on Windows as the fallback width
    // surviving to the DOM by a pixel, which is the whole point of measuring.
    remeasure()
    // Then whenever it moves: maximising slides the buttons, and on Windows 11
    // a maximised window's caption strip is not the same width as a restored
    // one's.
    overlay.addEventListener('geometrychange', remeasure)
    return () => overlay.removeEventListener('geometrychange', remeasure)
  }, [])

  return frame
}

/**
 * Whether the window has the user's attention.
 *
 * The chrome an inactive window draws is quieter — the one visual state a page
 * never had and a window always does. The renderer's own `focus`/`blur` follow
 * the OS window, so this needs nothing from the shell.
 */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() =>
    typeof document === 'undefined' ? true : document.hasFocus(),
  )

  useEffect(() => {
    const on = (): void => setFocused(true)
    const off = (): void => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])

  return focused
}
