import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { EASING, FADE_MS, MOTION_MS, motionOn } from '@/ui/motion/motion.ts'
import { LAYOUT_MOTION } from '@/ui/motion/settle.ts'

/**
 * **A panel opens by making room, and closes by fading out of it** — M39's
 * motions (2) and (4), for a panel under a sheet (U1's mockup; on everywhere
 * since U2 and U3).
 *
 * Opening, its height goes from nothing to what it needs, and the sheet above
 * gets shorter as it does rather than at once; closing, it fades and gives the
 * room back, in `FADE_MS`. A dialog or popover over the page needs none of
 * this: what pops in fades out by itself (`closing.ts`), and so does a panel
 * nobody wrapped — this is for the one whose *opening* should make room.
 *
 * **Closing keeps what was showing, inert, until it has gone** — the last
 * children, rendered as they were, taking no clicks and no focus, for 150 ms.
 * Nothing waits on it: the screen behind is usable the moment the panel was
 * told to close. The wrapper is always there, so the tree is one shape whether
 * anything moves. A room growing or closing carries `LAYOUT_MOTION`, so the
 * demo's tour waits for it (`settle.ts`).
 */
export function Reveal({ children }: { children?: ReactNode }) {
  const present = children !== null && children !== undefined && children !== false
  const kept = useRef<ReactNode>(null)
  if (present) kept.current = children
  const [, settle] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const was = useRef(present)
  const playing = useRef<Animation | undefined>(undefined)

  useLayoutEffect(() => {
    const before = was.current
    was.current = present
    if (before === present) return
    playing.current?.cancel()
    playing.current = undefined
    const element = wrapper.current
    if (element === null || !motionOn()) {
      kept.current = null
      return
    }
    if (present) {
      element.removeAttribute('inert')
      const height = element.scrollHeight
      element.style.overflow = 'hidden'
      const opening = element.animate([{ height: '0px', opacity: 0 }, { height: `${String(height)}px`, opacity: 1 }], {
        duration: MOTION_MS,
        easing: EASING,
        id: LAYOUT_MOTION,
      })
      const done = (): void => {
        element.style.overflow = ''
      }
      opening.addEventListener('finish', done)
      opening.addEventListener('cancel', done)
      playing.current = opening
      return
    }
    // Closing: what was showing stays, inert, while it goes.
    element.setAttribute('inert', '')
    element.style.overflow = 'hidden'
    const closing = element.animate(
      [
        { height: `${String(element.offsetHeight)}px`, opacity: 1 },
        { height: '0px', opacity: 0 },
      ],
      { duration: FADE_MS, easing: EASING, fill: 'forwards', id: LAYOUT_MOTION },
    )
    const done = (): void => {
      element.style.overflow = ''
      element.removeAttribute('inert')
      kept.current = null
      settle((count) => count + 1)
    }
    closing.addEventListener('finish', done)
    playing.current = closing
  }, [present])

  const showing = present ? children : motionOn() ? kept.current : null
  return (
    <div ref={wrapper} data-motion-reveal="" className="shrink-0">
      {showing}
    </div>
  )
}
