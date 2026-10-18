import { useEffect, useRef, useState, type RefObject } from 'react'

/** What a chart is drawn at before its figure has been measured. */
const DEFAULT_WIDTH = 1080

/**
 * Width of the figure, so the chart is drawn at the size it is shown.
 *
 * Measured rather than scaled: the `viewBox` is the width it is drawn at, so a
 * month's name is 11px in a narrow window too. A width of nothing — a figure
 * not laid out yet — is ignored, and so is a platform with no `ResizeObserver`.
 */
export function useWidth(): { ref: RefObject<HTMLElement>; value: number } {
  const ref = useRef<HTMLElement>(null)
  const [value, setValue] = useState(DEFAULT_WIDTH)
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry?.contentRect.width ?? 0)
      if (width > 0) setValue(width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, value }
}
