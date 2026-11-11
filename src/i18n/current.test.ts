import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * M60 U1 (D-584): the language follows the computer until Settings says
 * otherwise, the choice is this machine's and outlives a reload, and `<html>`
 * runs the language's way. A reload is a fresh import of the module over the
 * same storage.
 */

const storage = new Map<string, string>()
const root = { lang: 'en', dir: '' }

function machine(tag: string): void {
  vi.stubGlobal('navigator', { language: tag })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  })
  vi.stubGlobal('document', { documentElement: root })
  vi.stubGlobal('window', { addEventListener: () => undefined })
}

async function open(): Promise<typeof import('./current.ts')> {
  vi.resetModules()
  const current = await import('./current.ts')
  current.initLanguage()
  return current
}

beforeEach(() => {
  storage.clear()
  root.lang = 'en'
  root.dir = ''
})
afterEach(() => vi.unstubAllGlobals())

describe('the language on first open', () => {
  it.each([
    ['he-IL', 'he'],
    ['he', 'he'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
    ['ar', 'en'],
  ])('follows a computer in %s: %s', async (tag, expected) => {
    machine(tag)
    expect((await open()).currentLanguage()).toBe(expected)
  })

  it('is English before the app asks — the demo, the frame and a test stay English', async () => {
    machine('he-IL')
    vi.resetModules()
    const current = await import('./current.ts')
    expect(current.currentLanguage()).toBe('en')
  })
})

describe('the choice in Settings', () => {
  it('overrides the computer, and survives a reload', async () => {
    machine('en-US')
    const first = await open()
    expect(first.currentLanguage()).toBe('en')
    first.setLanguage('he')
    expect(first.currentLanguage()).toBe('he')

    const reloaded = await open()
    expect(reloaded.currentLanguage()).toBe('he')
    expect(reloaded.chosenLanguage()).toBe('he')
  })

  it('a stored value that is no language is the computer’s', async () => {
    machine('he-IL')
    storage.set('emerald-language', 'klingon')
    expect((await open()).currentLanguage()).toBe('he')
  })
})

describe('<html lang dir>', () => {
  it('flips with the language', async () => {
    machine('he-IL')
    const current = await open()
    expect(root).toEqual({ lang: 'he', dir: 'rtl' })
    current.setLanguage('en')
    expect(root).toEqual({ lang: 'en', dir: 'ltr' })
    current.setLanguage('he')
    expect(root).toEqual({ lang: 'he', dir: 'rtl' })
  })
})
