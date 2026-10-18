import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DemoHandle } from '../contract.ts'
import { PACE, TourPlayer, type TourStage } from './player.ts'
import { SEEN_AT, watchSeen } from './seen.ts'
import { readingTime, type TourStep } from './steps.ts'

/** Three captions and nothing to click: what a row holds for is its reading. */
const steps: TourStep[] = [
  { action: 'say', caption: 'One' },
  { action: 'say', caption: 'Two' },
  { action: 'say', caption: 'Three' },
]
/** A row's whole hold at 1x, and a little over. */
const held = (caption: string): number => Math.max(readingTime(caption), PACE.beat) + 50

const handle = { ready: Promise.resolve(), reopen: () => Promise.resolve(), onWrite: () => () => undefined } as unknown as DemoHandle
const stage: TourStage = { handle: () => Promise.resolve(handle), doc: () => ({ defaultView: null }) as unknown as Document }

describe('a tour plays only while its frame is seen (M42 F1, D-496)', () => {
  let player: TourPlayer
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    player = new TourPlayer(steps, stage, { reduced: false })
  })
  afterEach(() => {
    player.dispose()
    vi.useRealTimers()
  })

  it('holds an unseen frame at its first step, however long it waits', async () => {
    player.setSeen(false)
    player.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.snapshot()).toMatchObject({ mode: 'watch', step: 0 })
  })

  it('starts a frame from its first step when it is seen, and walks on from there', async () => {
    player.setSeen(false)
    player.start()
    await vi.advanceTimersByTimeAsync(60_000)
    player.setSeen(true)
    await vi.advanceTimersByTimeAsync(held('One') - 200)
    expect(player.snapshot().step).toBe(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(player.snapshot().step).toBe(1)
  })

  it('pauses a frame that leaves the view, and goes on from the same step when it comes back', async () => {
    player.start()
    await vi.advanceTimersByTimeAsync(held('One'))
    expect(player.snapshot().step).toBe(1)
    player.setSeen(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.snapshot()).toMatchObject({ mode: 'watch', step: 1 })
    player.setSeen(true)
    await vi.advanceTimersByTimeAsync(held('Two'))
    expect(player.snapshot().step).toBe(2)
  })

  it('keeps what was left of a hold, rather than starting it over', async () => {
    player.start()
    await vi.advanceTimersByTimeAsync(held('One') - 600)
    player.setSeen(false)
    await vi.advanceTimersByTimeAsync(10_000)
    player.setSeen(true)
    await vi.advanceTimersByTimeAsync(650)
    expect(player.snapshot().step).toBe(1)
  })

  it('leaves a frame the visitor took over as they left it when it is seen again', async () => {
    player.start()
    await vi.advanceTimersByTimeAsync(held('One'))
    player.takeOver()
    player.setSeen(false)
    player.setSeen(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.snapshot()).toMatchObject({ mode: 'try', step: 1 })
  })

  it('starts nothing in a frame waiting for Watch', async () => {
    player.wait()
    player.setSeen(false)
    player.setSeen(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.snapshot()).toMatchObject({ mode: 'ready', step: 0 })
  })
})

describe('the frame knows whether it is seen', () => {
  type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void
  function fakeWindow() {
    let callback: Callback = () => undefined
    const listeners = new Set<() => void>()
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }
    const disconnect = vi.fn()
    class Observer {
      constructor(said: Callback) {
        callback = said
      }
      observe = vi.fn()
      disconnect = disconnect
    }
    const win = { IntersectionObserver: Observer, document: doc } as unknown as Window & typeof globalThis
    return {
      win,
      disconnect,
      shows: (ratio: number) => callback([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]),
      tab: (state: DocumentVisibilityState) => {
        doc.visibilityState = state
        for (const listener of listeners) listener()
      },
      listeners,
    }
  }

  it('is unseen until a third of it is in view, and while its tab is hidden', () => {
    const fake = fakeWindow()
    const said: boolean[] = []
    const stop = watchSeen({} as Element, (seen) => said.push(seen), fake.win)
    fake.shows(SEEN_AT / 2)
    fake.shows(SEEN_AT)
    fake.tab('hidden')
    fake.tab('visible')
    fake.shows(0)
    expect(said).toEqual([false, false, true, false, true, false])
    stop()
    expect(fake.disconnect).toHaveBeenCalled()
    expect(fake.listeners.size).toBe(0)
  })

  it('counts as seen where there is no observer, so the tour plays as it did', () => {
    const said: boolean[] = []
    watchSeen({} as Element, (seen) => said.push(seen), { document: {} } as unknown as Window & typeof globalThis)
    expect(said).toEqual([])
  })
})
