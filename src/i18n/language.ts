/**
 * **The languages the app's own words come in** — M60 U1 (D-583, D-584).
 *
 * English is the source and Hebrew the one translation. Which one shows is this
 * machine's (`current.ts`), never the document's: two people can open one
 * document in two languages. Nothing here touches the DOM or React, so the
 * shell and a test can ask the same questions.
 */

export type Language = 'en' | 'he'

export const LANGUAGES: readonly Language[] = ['en', 'he']

/**
 * Each language by its own name, and the same in every language — a person
 * looking for theirs reads it in theirs, whatever the app is in now.
 */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { en: 'English', he: 'עברית' }

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'he'
}

/**
 * The computer's language as the app follows it: a tag starting with `he` is
 * Hebrew, and anything else — French included, which has no catalogue — is
 * English (D-583).
 */
export function languageOfTag(tag: string | undefined): Language {
  return tag !== undefined && tag.toLowerCase().startsWith('he') ? 'he' : 'en'
}

/** Which way a language's page runs: `<html dir>`. What it does to the layout is M60 U3's. */
export function directionOf(language: Language): 'ltr' | 'rtl' {
  return language === 'he' ? 'rtl' : 'ltr'
}
