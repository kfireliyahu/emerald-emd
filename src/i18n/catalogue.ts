import { dates as enDates } from './en/dates.ts'
import { rail as enRail } from './en/rail.ts'
import { settings as enSettings } from './en/settings.ts'
import { shell as enShell } from './en/shell.ts'
import { dates as heDates } from './he/dates.ts'
import { rail as heRail } from './he/rail.ts'
import { settings as heSettings } from './he/settings.ts'
import { shell as heShell } from './he/shell.ts'
import type { Language } from './language.ts'

/**
 * **The app's words, one catalogue per language and one file per area** —
 * M60 U1 (D-583, D-584).
 *
 * **English is the source**: `en/<area>.ts`, and its keys are the type
 * `MessageKey`, so a word asked for by a key that is not there is a type error
 * rather than a blank on a screen. **Hebrew is `he/<area>.ts` beside it**, one
 * file per area so two units can translate two areas without touching one
 * file. A Hebrew area may lack a key — the word then falls back to English —
 * but **an area with a Hebrew file is held complete** by `catalogue.test.ts`,
 * which lists what is missing; an area with none is English for now.
 *
 * A new area is an `en/<area>.ts` and a line in `ENGLISH`; its Hebrew is a
 * `he/<area>.ts` and a line in `HEBREW`. The catalogue files hold data and import
 * nothing but types, so anything that can read a TypeScript object can read
 * them — and the desktop shell does, bundling `shell` into its own build (M60 U7,
 * D-588) through `electron/language.ts`.
 */
export const ENGLISH = {
  rail: enRail,
  settings: enSettings,
  dates: enDates,
  shell: enShell,
} as const

export type English = typeof ENGLISH
export type Area = keyof English

/** A Hebrew area: every word optional, but a list is the whole list — twelve months, not nine. */
type Partially<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: Partially<T[K]> }
    : { readonly [K in keyof T]?: Partially<T[K]> }

export type Translation<A extends Area> = Partially<English[A]>

export const HEBREW: { readonly [A in Area]?: Translation<A> } = {
  rail: heRail,
  settings: heSettings,
  dates: heDates,
  shell: heShell,
}

const CATALOGUES: Readonly<Record<Language, unknown>> = { en: ENGLISH, he: HEBREW }

type Leaves<T, P extends string> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends readonly unknown[]
      ? never
      : Leaves<T[K], `${P}${K}.`>
}[keyof T & string]

/** A word's key — `rail.home`, `settings.language.row` — and only one the English has. */
export type MessageKey = Leaves<English, ''>

/** What a word's `{name}` placeholders are filled with. */
export type Fill = Readonly<Record<string, string | number>>

/** The value at a dotted key, or `undefined` when a step is missing. */
export function lookup(catalogue: unknown, key: string): unknown {
  let at: unknown = catalogue
  for (const part of key.split('.')) {
    if (typeof at !== 'object' || at === null) return undefined
    at = (at as Record<string, unknown>)[part]
  }
  return at
}

/** `{month} {year}` with its parts put in; a placeholder with nothing for it stays as written. */
export function fill(pattern: string, parts: Fill): string {
  return pattern.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const part = parts[name]
    return part === undefined ? whole : String(part)
  })
}

/**
 * A word in a language, and English where that language has none. Prefer
 * `useT()` in a component, which draws again when the language changes.
 */
export function translate(language: Language, key: MessageKey, parts?: Fill): string {
  const found = lookup(CATALOGUES[language], key)
  const english = lookup(ENGLISH, key)
  const word = typeof found === 'string' ? found : typeof english === 'string' ? english : key
  return parts === undefined ? word : fill(word, parts)
}

/** A list of words — the months — in a language, or the English list where it has none. */
export function translateList(language: Language, key: string): readonly string[] {
  const found = lookup(CATALOGUES[language], key)
  if (Array.isArray(found)) return found as readonly string[]
  const english = lookup(ENGLISH, key)
  return Array.isArray(english) ? (english as readonly string[]) : []
}

/** Every key the English has, a list counted as one, in the order the files give them. */
export function englishKeys(): readonly string[] {
  const keys: string[] = []
  const walk = (at: unknown, prefix: string): void => {
    if (typeof at === 'string' || Array.isArray(at)) {
      keys.push(prefix)
      return
    }
    if (typeof at !== 'object' || at === null) return
    for (const [name, value] of Object.entries(at)) walk(value, prefix === '' ? name : `${prefix}.${name}`)
  }
  walk(ENGLISH, '')
  return keys
}

/** The keys a language's catalogue lacks, which show in English. */
export function missingWords(language: Language): readonly string[] {
  if (language === 'en') return []
  const catalogue = CATALOGUES[language]
  return englishKeys().filter((key) => {
    const english = lookup(ENGLISH, key)
    const found = lookup(catalogue, key)
    if (Array.isArray(english)) return !Array.isArray(found) || found.length !== english.length
    return typeof found !== 'string' || found.trim() === ''
  })
}

/** The areas a language has a file for — held complete — and the ones still English. */
export function areasOf(language: Language): { readonly translated: readonly Area[]; readonly english: readonly Area[] } {
  const areas = Object.keys(ENGLISH) as Area[]
  if (language === 'en') return { translated: areas, english: [] }
  const has = (area: Area): boolean => HEBREW[area] !== undefined
  return { translated: areas.filter(has), english: areas.filter((area) => !has(area)) }
}
