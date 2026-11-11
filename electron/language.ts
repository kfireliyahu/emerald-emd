/**
 * **The shell in the app's language** — M60 U7 (D-588, after D-583 and D-584).
 *
 * The menu, the shell's dialogs and its windows' titles are words the shell writes itself, so it
 * has to have them before any page has loaded: on a first run on a Hebrew computer, and from the
 * first frame after a restart. So **the words are bundled into the shell**, not sent by the page:
 * `src/i18n/en/shell.ts` and `src/i18n/he/shell.ts` are data that import nothing at run time, and
 * this is the one file in `electron/` that reaches them — and `src/i18n/language.ts`, which is the
 * same kind of file. `language.test.ts` holds the shell to that list.
 *
 * **Which language is the page's word, kept per machine.** The page holds the choice in its own
 * `localStorage`, which the shell cannot read, so it says which language it settled on over the
 * bridge (`EmeraldWindow.setLanguage`), as it does the theme; the shell writes it to `settings.json`
 * beside the updates setting and rebuilds its menu. Until a page has ever said, it follows the
 * computer: `app.getLocale()`, read the way the page reads `navigator.language`.
 *
 * Pure and string-in, string-out, so all of it is a test.
 */

import { shell as english } from '../src/i18n/en/shell.ts'
import { shell as hebrew } from '../src/i18n/he/shell.ts'
import { isLanguage, languageOfTag, type Language } from '../src/i18n/language.ts'

export type { Language }

/** The English's shape with its words widened, so a Hebrew one has the same type. */
type Words<T> = { readonly [K in keyof T]: T[K] extends string ? string : Words<T[K]> }

export type ShellWords = Words<typeof english>

/** A translation over the English, key by key: a word Hebrew lacks shows in English. */
function over<T>(base: T, translated: unknown): T {
  if (typeof base === 'string') return (typeof translated === 'string' && translated.trim() !== '' ? translated : base) as T
  const out: Record<string, unknown> = {}
  const from = typeof translated === 'object' && translated !== null ? (translated as Record<string, unknown>) : {}
  for (const [key, value] of Object.entries(base as Record<string, unknown>)) out[key] = over(value, from[key])
  return out as T
}

const HEBREW: ShellWords = over<ShellWords>(english, hebrew)

/** The shell's words in a language. */
export function shellWords(language: Language): ShellWords {
  return language === 'he' ? HEBREW : english
}

/** `{name}` put in — the one placeholder the shell's words have. */
export function withName(pattern: string, name: string): string {
  return pattern.replaceAll('{name}', name)
}

/**
 * The language the shell starts in: the one the page last said, kept in `settings.json`, else the
 * computer's. Anything unreadable is as if nothing were kept.
 */
export function languageFrom(settings: string | undefined, locale: string | undefined): Language {
  return keptLanguage(settings) ?? languageOfTag(locale)
}

/** The language `settings.json` keeps, if a page has ever said one. */
export function keptLanguage(settings: string | undefined): Language | undefined {
  const kept = readSettings(settings)['language']
  return isLanguage(kept) ? kept : undefined
}

/**
 * `settings.json` with some keys set and every other kept: the updates setting and the language
 * share the file, and writing one must not drop the other.
 */
export function withSettings(settings: string | undefined, patch: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify({ ...readSettings(settings), ...patch }, null, 2)}\n`
}

function readSettings(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
