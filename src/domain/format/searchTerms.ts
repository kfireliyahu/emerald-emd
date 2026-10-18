/**
 * **What a search across a whole document looks for** — M47 U6.
 *
 * Two kinds of term, and they differ on purpose:
 *
 * - **typed** — what a person or a conversation asks for. A substring, folded
 *   the way `format_rows`' `search` folds (`LOWER` there, `toLowerCase` here, so
 *   a name typed back in another case still finds its row), and named in the
 *   answer by itself, since the asker already holds it.
 * - **a denylist line** — what must never be shared. The file is in
 *   `git filter-repo --replace-text` form, the one `src/privacy.test.ts` reads,
 *   so one list serves the repository check, the history rewrite and a scan of a
 *   document: `literal==>replacement` or `regex:pattern==>replacement`, one per
 *   line, `#` for a comment, only the left side read. **Case is kept**, because
 *   it is kept in filter-repo, and a scan that found more than the rewrite would
 *   replace would report hits nobody can clear. **A term is named by its line
 *   number, never by itself**, so an answer about the list does not repeat it.
 */

export interface SearchTerm {
  /** How an answer names it: the term as typed, or `line N` of a denylist. */
  readonly name: string
  /** Whether a text holds it at all. */
  readonly holds: (text: string) => boolean
  /** How many times it is in a text — what the repository check reports. */
  readonly count: (text: string) => number
}

/** Terms as a person typed them — trimmed, folded, the empty and the repeated dropped. */
export function typedTerms(terms: readonly string[]): readonly SearchTerm[] {
  const seen = new Set<string>()
  const out: SearchTerm[] = []
  for (const raw of terms) {
    const term = raw.trim()
    const folded = term.toLowerCase()
    if (folded === '' || seen.has(folded)) continue
    seen.add(folded)
    out.push({
      name: term,
      holds: (text) => text.toLowerCase().includes(folded),
      count: (text) => occurrences(text.toLowerCase(), folded),
    })
  }
  return out
}

/** A denylist line that does not parse, named by its number and never by its text. */
export class DenylistError extends Error {}

/** The terms of a denylist in `--replace-text` form. */
export function denylistTerms(text: string): readonly SearchTerm[] {
  const out: SearchTerm[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === '' || raw.startsWith('#')) return
    const left = raw.split('==>')[0] ?? ''
    if (left === '') return
    const name = `line ${String(index + 1)}`
    if (left.startsWith('regex:')) {
      let pattern: RegExp
      try {
        pattern = new RegExp(left.slice('regex:'.length), 'g')
      } catch {
        throw new DenylistError(`The denylist's ${name} is not a pattern that parses.`)
      }
      const once = new RegExp(pattern.source)
      out.push({
        name,
        holds: (t) => once.test(t),
        count: (t) => t.match(pattern)?.length ?? 0,
      })
    } else {
      out.push({ name, holds: (t) => t.includes(left), count: (t) => occurrences(t, left) })
    }
  })
  return out
}

function occurrences(text: string, term: string): number {
  let n = 0
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) n++
  return n
}
