import { describe, expect, it } from 'vitest'

import { layoutSettled, LAYOUT_MOTION, movingLayout, type Moving } from '@/ui/motion/settle.ts'

/** An animation that finishes when told to. */
function animation(id: string, playState = 'running'): Moving & { end: () => void; fail: () => void } {
  let end = (): void => undefined
  let fail = (): void => undefined
  const finished = new Promise<unknown>((resolve, reject) => {
    end = () => resolve(undefined)
    fail = () => reject(new Error('cancelled'))
  })
  return { id, playState, finished, end, fail }
}

describe('what is moving layout', () => {
  it('is the animations tagged as layout and still playing, and not a verdict\'s mark', () => {
    const row = animation(LAYOUT_MOTION)
    const mark = animation('')
    const done = animation(LAYOUT_MOTION, 'finished')
    expect(movingLayout({ getAnimations: () => [row, mark, done] })).toEqual([row])
  })

  it('counts a card popping in, which moves its box while it plays, and no other CSS entrance (M39 F1)', () => {
    const pop = { ...animation(''), animationName: 'fc-pop-in' }
    const fade = { ...animation(''), animationName: 'fc-fade' }
    expect(movingLayout({ getAnimations: () => [pop, fade] })).toEqual([pop])
  })

  it('is nothing in a document that cannot animate', () => {
    expect(movingLayout({})).toEqual([])
  })
})

describe('waiting for the layout to settle', () => {
  it('answers at once, and that it waited for nothing, when nothing moves', async () => {
    expect(await layoutSettled({ getAnimations: () => [] })).toBe(false)
  })

  it('waits for the moves by their own finish, and for a wave that starts as one ends', async () => {
    const slide = animation(LAYOUT_MOTION)
    const ghost = animation(LAYOUT_MOTION)
    const closing = animation(LAYOUT_MOTION)
    let playing: Moving[] = [slide, ghost]
    let settled = false
    const waiting = layoutSettled({ getAnimations: () => playing }).then((waited) => {
      settled = true
      return waited
    })
    slide.end()
    await Promise.resolve()
    expect(settled).toBe(false)
    // The ghost is cancelled rather than finished, and a panel starts closing.
    playing = [closing]
    ghost.fail()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    playing = []
    closing.end()
    expect(await waiting).toBe(true)
  })

  it('lets go when the tour is stopped', async () => {
    const row = animation(LAYOUT_MOTION)
    let stopped = false
    const waiting = layoutSettled({ getAnimations: () => [row] }, () => stopped)
    stopped = true
    row.end()
    expect(await waiting).toBe(true)
  })
})
