import { useMemo } from 'react'

import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import { createStore } from '@/state/store.ts'

import { translate, type Fill, type MessageKey } from './catalogue.ts'
import { dateWords, type DateWords } from './dates.ts'
import { directionOf, isLanguage, languageOfTag, type Language } from './language.ts'

/**
 * **Which language this copy of the app shows** — M60 U1 (D-583, D-584).
 *
 * **The computer's, until Settings › Language says otherwise** — and then that,
 * kept per machine in `localStorage` like the theme (D-115, D-320), never in a
 * document: two people open one document in two languages. On first open,
 * `navigator.language` starting with `he` is Hebrew, anything else English.
 *
 * `<html lang dir>` follow the choice, set before the first render by
 * `initLanguage()` (from `main.tsx`, beside `initTheme()`), so the first paint
 * is already the right way round.
 *
 * The words themselves are `catalogue.ts`'s and the months `dates.ts`'s; this
 * file is only which language, and the two hooks a screen draws with.
 */

const STORAGE_KEY = 'emerald-language'

/** The language chosen in Settings on this machine, if one was. */
export function chosenLanguage(): Language | undefined {
  const stored = readPreference(STORAGE_KEY)
  return isLanguage(stored) ? stored : undefined
}

/** The computer's language, as the app follows it. */
export function computerLanguage(): Language {
  return languageOfTag(typeof navigator === 'undefined' ? undefined : navigator.language)
}

/**
 * English until `initLanguage()` runs, and only the app's entry runs it: the
 * demo is the public site's and stays English (D-583), and so does the frame a
 * host draws, a tour and a test.
 */
const language = createStore<Language>('en')

function apply(next: Language): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = next
  document.documentElement.dir = directionOf(next)
}

function choose(next: Language): void {
  apply(next)
  language.set(next)
}

/**
 * Run once, before the first render: the language on `<html>`, and a choice
 * made in another window of this origin followed here, as the theme is.
 */
export function initLanguage(): void {
  choose(chosenLanguage() ?? computerLanguage())
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) choose(chosenLanguage() ?? computerLanguage())
    })
  }
}

/** Settings › Language: this machine's choice from now on. */
export function setLanguage(next: Language): void {
  writePreference(STORAGE_KEY, next)
  choose(next)
}

/**
 * The language for this page only, kept nowhere: `probe:screens -- --lang he`
 * measures a screen in Hebrew without choosing it on the machine (M60 U5, D-590).
 */
export function showLanguage(next: Language): void {
  choose(next)
}

/** The language now, outside a render. */
export function currentLanguage(): Language {
  return language.get()
}

/** The language in a component, which draws again when it changes. */
export function useLanguage(): Language {
  return language.use()
}

/** A word by its key in the language now: `t('rail.home')`. */
export type Translate = (key: MessageKey, parts?: Fill) => string

export function useT(): Translate {
  const now = useLanguage()
  return useMemo(() => (key: MessageKey, parts?: Fill) => translate(now, key, parts), [now])
}

/** The month and date formatters in the language now: `dates.yearMonth(period)`. */
export function useDates(): DateWords {
  const now = useLanguage()
  return useMemo(() => dateWords(now), [now])
}
