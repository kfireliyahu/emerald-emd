import { afterEach, describe, expect, it, vi } from 'vitest'

import { readPreference, writePreference } from './preference.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a remembered preference (M45 U3)', () => {
  it('reads back what was written, and forgets it on undefined', () => {
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => kept.set(key, value),
      removeItem: (key: string) => kept.delete(key),
    })
    expect(readPreference('fc-theme')).toBeUndefined()
    writePreference('fc-theme', 'dark')
    expect(readPreference('fc-theme')).toBe('dark')
    writePreference('fc-theme', undefined)
    expect(readPreference('fc-theme')).toBeUndefined()
  })

  it('is nothing, and never throws, where there is no storage', () => {
    const refuse = (): never => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse })
    expect(readPreference('fc-theme')).toBeUndefined()
    expect(() => writePreference('fc-theme', 'dark')).not.toThrow()
  })
})
