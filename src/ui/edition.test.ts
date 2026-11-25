/**
 * **The specimen page opens in the dev and demo builds, never the release**
 * (M64 U16, D-611). The gate is what `App.tsx` reads before it lazily imports
 * the page, so where it is false the route is absent and the chunk unbuilt.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { isDemo, specimenOpens } from './edition.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('specimenOpens', () => {
  it('is false in the desktop release', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    expect(specimenOpens()).toBe(false)
    expect(isDemo()).toBe(false)
  })

  it('is true in the demo build', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'demo')
    expect(specimenOpens()).toBe(true)
  })

  it('is true on the dev server', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('MODE', 'development')
    expect(specimenOpens()).toBe(true)
  })
})
