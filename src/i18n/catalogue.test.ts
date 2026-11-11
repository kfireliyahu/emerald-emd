import { describe, expect, it } from 'vitest'

import { NAVIGATION } from '@/ui/nav.ts'

import { areasOf, englishKeys, fill, missingWords, translate } from './catalogue.ts'

describe('the catalogue (M60 U1, D-584)', () => {
  it('gives a word in the language asked', () => {
    expect(translate('en', 'rail.home')).toBe('Home')
    expect(translate('he', 'rail.home')).toBe('בית')
  })

  it('fills a word’s placeholders, and leaves one it has nothing for', () => {
    expect(fill('{month} {year}', { month: 'July', year: 2026 })).toBe('July 2026')
    expect(fill('{day} {month}', { day: 3 })).toBe('3 {month}')
  })

  /**
   * **An area with a Hebrew file is held complete**; one without is English for
   * now (D-583's fallback). A word missing from a translated area still shows —
   * in English — and this names it.
   */
  it('lists the Hebrew words missing from a translated area — and there are none', () => {
    const { translated, english } = areasOf('he')
    const missing = missingWords('he').filter((key) => translated.some((area) => key.startsWith(`${area}.`)))
    expect(missing, `Hebrew is missing ${missing.join(', ')}; still English: ${english.join(', ') || 'none'}`).toEqual([])
  })

  it('every English key is a word or a list', () => {
    expect(englishKeys()).toContain('settings.language.row')
    expect(englishKeys()).toContain('dates.months')
  })

  it('names every place the app draws in the rail by a word', () => {
    const places = NAVIGATION.flatMap((section) => [section, ...(section.children ?? []), ...(section.tabs ?? [])])
    const unnamed = places.filter((place) => place.word === undefined).map((place) => place.to)
    expect(unnamed).toEqual([])
    for (const place of places) if (place.word !== undefined) expect(translate('en', place.word)).toBe(place.label)
  })
})
