/**
 * **A row in another document** — the `elsewhere` column (M47 U4, D-461).
 *
 * Every reference between this project's documents was prose until it: an
 * inbox row's `from` was a path in a text column, `became_unit` could not point
 * outside its own file, and a hand-off had to say *M1 U10 can be marked built*
 * because nothing could name the row it meant. The value is the other
 * document's path and the row's name — `F:/projects/site/site.emd S1 U5`.
 *
 * **By name, never by id** (D-241, D-245): a text document renews its ids on
 * every write, so an id written into another file would be stale by the next
 * save of that file. The name is the row's naming column — its first text
 * column (`labelColumn`) — which is what a person writes and what the other
 * document's own links are read back as.
 *
 * **Unresolved is an answer, not a failure.** The other file may be closed,
 * moved, renamed or on another machine; a write never refuses a value for being
 * out of reach, and a read says what it could not find and why. Only the shape
 * is checked at write time: a path ending in `.emd` and a name after it.
 *
 * This file is the shape and the words; reading the other file is whoever can
 * reach the disk (the plugin's `elsewhere.ts`).
 */

import { err, ok, type Result } from '@/core/result.ts'

/** The extension a document has, and what the path in a value ends at. */
const DOCUMENT_EXTENSION = '.emd'

/** A value taken apart: the other document, and the name of its row. */
export interface Elsewhere {
  /** As written, with `\` turned to `/`: absolute, or relative to the holding document's folder. */
  readonly path: string
  /** The row's name in that document — `S1 U5`, `D-27`. */
  readonly name: string
}

/**
 * The value taken apart, or why it is not one.
 *
 * The path runs to the first `.emd` followed by a space or a `#`, so a folder
 * with a space in its name is still a path; the rest, trimmed, is the name.
 */
export function parseElsewhere(value: string): Result<Elsewhere, string> {
  const text = value.trim().replace(/\\/g, '/')
  const at = /\.emd(?=[\s#])/i.exec(text)
  if (at === null) {
    return err(
      text.toLowerCase().endsWith(DOCUMENT_EXTENSION)
        ? `"${value}" names a document and no row in it. Write the row's name after the path: F:/projects/site/site.emd S1 U5.`
        : `"${value}" is not a row in another document. Write the document's path, then the row's name: F:/projects/site/site.emd S1 U5.`,
    )
  }
  const end = at.index + DOCUMENT_EXTENSION.length
  const path = text.slice(0, end).trim()
  const name = text
    .slice(end)
    .replace(/^[\s#]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (path === DOCUMENT_EXTENSION || path === '') return err(`"${value}" has no document before ${DOCUMENT_EXTENSION}.`)
  if (name === '') return err(`"${value}" names a document and no row in it.`)
  return ok({ path, name })
}

/** The one spelling a value is stored in: the path, a space, the name. */
export function elsewhereText(elsewhere: Elsewhere): string {
  return `${elsewhere.path} ${elsewhere.name}`
}

/** The file's own name — `site.emd` — which is what a cell shows of the path. */
export function documentNameOf(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

/** Whether a path is absolute — a drive, a root, or a share — rather than beside the holder. */
export function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith('/') || path.startsWith('//')
}

/** What a value turned out to point at, when it was looked for. */
export type ElsewhereReading =
  | {
      readonly kind: 'resolved'
      /** The format the row is a row of, in the other document. */
      readonly format: string
      /** The row's name, as that document holds it. */
      readonly name: string
      /** Its state — the first list column, which is what a line shows as a row's state (`lineShapeOf`). */
      readonly state: string | undefined
    }
  | {
      readonly kind: 'unresolved'
      /** Why, in a clause: `no file at …`, `site.emd has no row called S1 U9`. */
      readonly why: string
    }

/** A row of the other document whose name matched — what `readingOf` is handed. */
export interface NamedRow {
  readonly format: string
  readonly name: string
  readonly state: string | undefined
}

/**
 * What the rows called `name` in the other document make of a value: one is
 * the answer, none and several are each a reason it is unresolved.
 */
export function readingOf(elsewhere: Elsewhere, found: readonly NamedRow[]): ElsewhereReading {
  const document = documentNameOf(elsewhere.path)
  const [only, ...more] = found
  if (only === undefined) return { kind: 'unresolved', why: `${document} has no row called ${elsewhere.name}` }
  if (more.length > 0) {
    return {
      kind: 'unresolved',
      why: `${document} has ${String(found.length)} rows called ${elsewhere.name}, in ${found.map((each) => each.format).join(', ')}`,
    }
  }
  return { kind: 'resolved', format: only.format, name: only.name, state: only.state }
}

/** A reading in a clause, for beside the value: `unit S1 U5 · built`, or `unresolved — why`. */
export function readingText(reading: ElsewhereReading): string {
  if (reading.kind === 'unresolved') return `unresolved — ${reading.why}`
  return [`${reading.format} ${reading.name}`, reading.state].filter((part) => part !== undefined).join(' · ')
}

/**
 * Where the other document is: the path itself when it is absolute, else
 * beside the holding document — `../site/site.emd` from `F:/projects/planner/planner.emd`
 * is `F:/projects/site/site.emd`. Nothing when it is relative and the holder
 * has no path of its own (a document not yet saved, or the page in a browser).
 */
export function pathFrom(path: string, holder: string | undefined): string | undefined {
  if (isAbsolutePath(path)) return path
  if (holder === undefined) return undefined
  const folder = holder.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
  const parts: string[] = []
  for (const part of `${folder}/${path}`.split('/')) {
    if (part === '.') continue
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..' && parts[parts.length - 1] !== '') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}
