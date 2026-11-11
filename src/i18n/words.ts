import { translate, type Fill, type MessageKey } from './catalogue.ts'
import { currentLanguage } from './current.ts'

/**
 * **A word outside a render** — M60 U5 (D-590). A helper that builds a label
 * for a screen (`labels.ts`, a command's title) asks for it in the language
 * now; a component asks `useT()`, which draws again when the language changes.
 * The language changes only on Settings › Language, so a label built here is
 * built again the next time its screen opens.
 */
export function tNow(key: MessageKey, parts?: Fill): string {
  return translate(currentLanguage(), key, parts)
}

/**
 * **A category path's arrows point the way its words run** (M60 U5, D-590).
 * The repositories join a path with ` → ` (`Living → Groceries`); drawn
 * right-to-left — a Hebrew name, in its own `Bidi` span — that arrow points
 * back at the parent, so a path whose first strong letter is Hebrew turns it
 * round. Decided by the path's own words, never the app's language: a Hebrew
 * document's paths read right in English too, and a Latin path is unchanged.
 */
export function pathArrows(path: string): string {
  const first = /[A-Za-z֐-׿]/.exec(path)
  if (first === null || !/[֐-׿]/.test(first[0])) return path
  return path.replaceAll(' → ', ' ← ')
}
