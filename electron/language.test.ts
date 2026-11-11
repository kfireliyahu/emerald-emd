import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'

import { shell as english } from '../src/i18n/en/shell.ts'
import { automaticFrom } from './updates.ts'
import { keptLanguage, languageFrom, shellWords, withName, withSettings } from './language.ts'
import { buildMenuTemplate, NOTHING_OPEN } from './menu.ts'

/**
 * The shell in the app's language (M60 U7, D-588): the words are bundled, the choice is the
 * page's, kept per machine, and the computer's until a page has said one.
 */

const noActions = {
  send: () => undefined,
  clearRecents: () => undefined,
  showAbout: () => undefined,
  openText: () => undefined,
  openSource: () => undefined,
  checkForUpdates: () => undefined,
}

function labels(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((entry) => [
    ...(entry.label === undefined ? [] : [entry.label]),
    ...(Array.isArray(entry.submenu) ? labels(entry.submenu) : []),
  ])
}

describe('the shell’s language (M60 U7, D-588)', () => {
  it('follows the computer until a page has said one', () => {
    expect(languageFrom(undefined, 'he')).toBe('he')
    expect(languageFrom(undefined, 'he-IL')).toBe('he')
    expect(languageFrom(undefined, 'en-US')).toBe('en')
    expect(languageFrom(undefined, 'fr')).toBe('en')
    expect(languageFrom('not json', 'he')).toBe('he')
  })

  it('opens in the language the page last said, whatever the computer’s', () => {
    expect(languageFrom(withSettings(undefined, { language: 'he' }), 'en-US')).toBe('he')
    expect(languageFrom(withSettings(undefined, { language: 'en' }), 'he')).toBe('en')
    expect(keptLanguage(withSettings(undefined, { language: 'fr' }))).toBeUndefined()
  })

  it('keeps the updates setting when it writes the language, and the language when it writes that', () => {
    const both = withSettings(withSettings(undefined, { automaticUpdates: true }), { language: 'he' })
    expect(automaticFrom(both)).toBe(true)
    expect(keptLanguage(both)).toBe('he')
    const after = withSettings(both, { automaticUpdates: false })
    expect(automaticFrom(after)).toBe(false)
    expect(keptLanguage(after)).toBe('he')
  })

  it('has every word in Hebrew, and none of them the English left in place', () => {
    const he = shellWords('he')
    const en = shellWords('en')
    const left: string[] = []
    const walk = (a: unknown, b: unknown, at: string): void => {
      if (typeof a === 'string') {
        if (a === b) left.push(at)
        return
      }
      for (const key of Object.keys(a as object)) walk((a as never)[key], (b as never)[key], `${at}.${key}`)
    }
    walk(he, en, 'shell')
    expect(left).toEqual([])
    expect(en).toBe(english)
  })

  it('draws the menu in Hebrew, the glossary’s words where an item is a term', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const template = buildMenuTemplate(platform, [], noActions, NOTHING_OPEN, shellWords('he'))
      const all = labels(template)
      expect(all.filter((label) => /[A-Za-z]/.test(label.replace('Emerald', ''))), platform).toEqual([])
      expect(all).toContain('&קובץ')
      // `screen_hebrew` of the terms Save as and Guide me (M60 U2).
      expect(all).toContain('שמירה בשם…')
      expect(all).toContain('הדרכה')
    }
  })

  it('draws it in English by default, which is what a test or the palette’s parity reads', () => {
    expect(labels(buildMenuTemplate('win32', [], noActions))).toEqual(labels(buildMenuTemplate('win32', [], noActions, NOTHING_OPEN, shellWords('en'))))
  })

  it('puts the document’s name in the unsaved-work question', () => {
    expect(withName(shellWords('he').dialogs.unsavedClosing, 'a.emd')).toBe('לשמור את a.emd לפני הסגירה?')
    expect(withName(shellWords('en').dialogs.unsavedClosing, 'a.emd')).toBe('Save your changes to a.emd before closing?')
  })

  /**
   * **What the shell bundles from `src/` is its words and nothing else** (D-588): `src/` imports only
   * `bridge.ts` from the shell, and the shell only these data files from `src/`, through this one.
   */
  it('reaches into src/ only for its words, and only from language.ts', () => {
    const here = import.meta.dirname
    const reached: string[] = []
    for (const name of readdirSync(here)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
      const text = readFileSync(join(here, name), 'utf8')
      for (const match of text.matchAll(/^import\s+(?!type\b)[^'"]*['"](\.\.\/src\/[^'"]+)['"]/gm)) reached.push(`${name} → ${match[1] ?? ''}`)
    }
    expect(reached.sort()).toEqual([
      'language.ts → ../src/i18n/en/shell.ts',
      'language.ts → ../src/i18n/he/shell.ts',
      'language.ts → ../src/i18n/language.ts',
    ])
    for (const file of ['en/shell.ts', 'he/shell.ts', 'language.ts']) {
      const text = readFileSync(join(here, '..', 'src', 'i18n', file), 'utf8')
      expect(text.match(/^import\s+(?!type\b).*$/gm) ?? [], file).toEqual([])
    }
  })
})
