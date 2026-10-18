import { describe, expect, it } from 'vitest'

import { claimWindow, isWindowTaken } from './useFullWindow.ts'

/** Let the deferred release run. */
const settle = (): Promise<void> => new Promise((resolve) => queueMicrotask(() => resolve()))

describe('the window claim', () => {
  it('is nobody’s until something asks', () => {
    expect(isWindowTaken()).toBe(false)
  })

  it('is taken the moment a flow claims it, and given back after', async () => {
    const release = claimWindow()
    expect(isWindowTaken()).toBe(true)

    release()
    await settle()
    expect(isWindowTaken()).toBe(false)
  })

  it('stays taken while a second flow still holds it', async () => {
    const first = claimWindow()
    const second = claimWindow()

    first()
    await settle()
    expect(isWindowTaken()).toBe(true)

    second()
    await settle()
    expect(isWindowTaken()).toBe(false)
  })

  it('never reports the window free during a handover', async () => {
    // The report reader unmounting as the reading form mounts: React runs every
    // cleanup before any setup. The window must never read as free in between —
    // not merely go unannounced, because `useSyncExternalStore` reads the
    // snapshot on every render and a render landing in that gap would put the
    // list back.
    const reader = claimWindow()
    const seen: boolean[] = []

    reader()
    seen.push(isWindowTaken())
    const form = claimWindow()
    seen.push(isWindowTaken())
    await settle()
    seen.push(isWindowTaken())

    expect(seen).toEqual([true, true, true])

    form()
    await settle()
    expect(isWindowTaken()).toBe(false)
  })

  it('ignores a release called twice, so a double unmount cannot go negative', async () => {
    const release = claimWindow()
    const other = claimWindow()

    release()
    release()
    await settle()
    expect(isWindowTaken()).toBe(true)

    other()
    await settle()
    expect(isWindowTaken()).toBe(false)
  })
})
