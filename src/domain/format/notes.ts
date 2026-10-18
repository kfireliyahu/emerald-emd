/**
 * **A folder of Markdown notes, as a table** — M34 U7.
 *
 * A notes vault, a wiki, an export: a folder of `.md` files, each one a thing
 * and its frontmatter the thing's fields. Nothing read them, so a folder like
 * that ended in hand-typing. This turns one into the same `ReadTable` a
 * spreadsheet becomes, so everything downstream — the guessed mapping, the
 * plan, the refusals by line, the batch read in link order — is the one a
 * `.csv` gets, and **nothing here knows which program wrote the folder**
 * (readers are generic by kind of file, never by product).
 *
 * ## The table
 *
 * One note is one row. The header row is `title`, `file`, then every
 * frontmatter key in the order the notes first use it, then `inline tags` and
 * `body links` when any note has one, then `body`:
 *
 * - **`title`** is the frontmatter's `title`, else the note's file name without
 *   `.md`. **Never its first heading** (M38 U1): two recipes both headed
 *   `# For 1 serving` were two rows of one name, and a heading is the body's;
 * - **`file`** is the file name, so a row can always be found again — its path
 *   under the folder read, when the read went into the folders inside it;
 * - **`folder`**, only when a note sits in such a folder (M48 U2), is that
 *   folder's path under the one read: `Year 1` at depth one;
 * - **`inline tags`** are the `#tags` written in the body, a list like a
 *   frontmatter one — what the mapping does with them is the mapping's;
 * - **`body links`** are the notes the body links to (M38 U2), each read as a
 *   frontmatter link is — the title of the note it names — a list again, and
 *   **prose** (`ReadTable.prose`): a member that names no row is left out of
 *   the row and named in the read's report, never a refusal of the note. A
 *   link to a file that is not a note — `![[Pasted image.png]]` — is no link
 *   at all, and is counted rather than named (M48 U2);
 * - **`body`** is everything under the frontmatter, whole.
 *
 * **A hidden file is not a note** (M38 U1): a name starting with `.` — the `._`
 * copy a disk leaves beside every file it touched, binary and not Markdown —
 * is skipped and named as not read, like a file with no extension.
 *
 * The frontmatter is read as the small part of YAML notes use — `key: value`,
 * quoted or not, a list as `[a, b]` or as `- a` lines, and `|` or `>` blocks. A
 * nested map is not a column and is left out; a value is text, which is what
 * every cell of a `.csv` is too, and the column it lands on types it.
 *
 * ## A list stays a list
 *
 * A frontmatter list is several members, and the file says so — it is not a
 * guess. Its cell holds the members joined by `NOTE_LIST_SEPARATOR`, and the
 * table records that the column is split by it (`separators`), so a guessed
 * mapping onto an `enums` or `links` column splits it without a person naming
 * a separator (D-398's rule is that a separator is never *guessed*; here it
 * was written by the file).
 *
 * ## A link names a row by its exact name
 *
 * Both common forms are read: `[[name]]` (with `|alias` or `#heading` after the
 * name ignored) and `[text](path/to/file.md)`. Either way the link names a
 * **note**, and the cell is the **title of that note** when it is among the
 * notes read — found by its file name, or by its title — so `[Plain flour](flour.md)`
 * becomes `Plain flour`, the row `flour.md` writes. A link to a note not among
 * them keeps the name it was written with. Then the engine fills the link by
 * the exact unique name of its row and refuses the line otherwise (D-261) — a
 * link is never matched loosely here either. Only a value that is wholly a link
 * (or a list of them) is rewritten; a link inside a sentence is text — and is
 * also one of the note's `body links` when it sits in the body (M38 U2).
 */

import type { ItemPart, ReadCell, ReadTable } from './reading.ts'

/**
 * A note as a file: its name with `.md` and its text. A note read from a
 * folder inside the one read (M48 U2) carries its path under it —
 * `Year 1/Algebra.md` — and its `folder` is that path's folder.
 */
export interface Note {
  readonly file: string
  readonly text: string
}

/** A frontmatter value: one scalar, or the members of a list. */
export type NoteValue = string | readonly string[]

export interface ParsedNote {
  readonly file: string
  /** The folder it sits in under the one read, `Year 1/Semester A` — empty for a note directly in it (M48 U2). */
  readonly folder: string
  /** The file name without `.md`. */
  readonly stem: string
  readonly title: string
  /** Frontmatter keys in the order the note writes them, `title` among them if it has one. */
  readonly fields: ReadonlyMap<string, NoteValue>
  /** The `#tags` written in the body, each once, in the order they first appear, without the `#`. */
  readonly tags: readonly string[]
  /**
   * The notes the body links to, by the name each link writes (`linkedNote`),
   * each once, in the order they first appear (M38 U2). An embed is a link.
   */
  readonly links: readonly string[]
  readonly body: string
}

/** What joins a list's members in one cell, and splits them again on read. */
export const NOTE_LIST_SEPARATOR = ';'

/** The header cell the body's `#tags` are read into. */
export const INLINE_TAGS_HEADER = 'inline tags'

/** The header cell the body's links are read into (M38 U2). */
export const BODY_LINKS_HEADER = 'body links'

/** The header cell a note's folder under the one read is read into (M48 U2). */
export const FOLDER_HEADER = 'folder'

/** Whether a file is hidden: its name, any folder left off, starts with a dot. */
export function isHiddenFileName(name: string): boolean {
  return (name.split(/[\\/]/).pop() ?? name).startsWith('.')
}

/** Whether a file name is a Markdown note — and not a hidden file that only looks like one. */
export function isNoteFileName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name) && !isHiddenFileName(name)
}

/** The file name without its folder and without `.md`. */
export function noteStem(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file
  return base.replace(/\.(md|markdown)$/i, '')
}

/**
 * Whether a link's target names **a file that is not a note** (M48 U2): an
 * extension other than `.md` — `Pasted image 2026.png`, `syllabus.pdf`. An
 * embedded image is not a link to a note, and naming one as a link that named
 * no row was a report's worth of noise per folder. A note whose own name looks
 * like that — `Node.js` — is still found by its name first (`linkedTitles`).
 */
export function isFileTarget(name: string): boolean {
  const extension = /\.([\p{L}\p{N}]{1,8})$/u.exec(name.trim())?.[1]
  return extension !== undefined && /\p{L}/u.test(extension) && !/^(md|markdown)$/i.test(extension)
}

/* ------------------------------------------------------------- one note */

export function parseNote(note: Note): ParsedNote {
  const text = note.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const { fields, rest } = splitFrontmatter(text)
  const stem = noteStem(note.file)

  const fromFrontmatter = scalarOf(fields.get('title'))
  const title = fromFrontmatter !== undefined && fromFrontmatter !== '' ? fromFrontmatter : stem
  const body = rest.trim()
  const parts = note.file.split(/[\\/]/)
  const folder = parts.slice(0, -1).filter((part) => part !== '').join('/')
  return { file: note.file, folder, stem, title, fields, tags: inlineTags(body), links: bodyLinks(body), body }
}

/**
 * The notes a body links to (M38 U2): every `[[name]]`, `![[name#section]]`
 * and `[text](file.md)` in it, read by `linkedNote` — so an embedded section
 * links to its note, and a web address or an image is no note. Nothing inside
 * a fenced code block or an inline code span is a link. Each name once, in the
 * order it first appears.
 */
export function bodyLinks(body: string): readonly string[] {
  const found: string[] = []
  let fenced = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const prose = line.replace(/`[^`]*`/g, ' ')
    for (const match of prose.matchAll(/!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)/g)) {
      const name = linkedNote(match[0].replace(/^!(?=\[[^[])/, ''))
      if (name !== undefined && !found.includes(name)) found.push(name)
    }
  }
  return found
}

/**
 * The `#tags` a body writes: `#` at the start of a line or after a space, then
 * letters, digits, `_`, `-` and `/` with at least one that is not a digit — so
 * `# Heading` is a heading, `#3` is a number and `page#part` is an address.
 * Nothing inside a fenced code block or an inline code span is a tag.
 */
export function inlineTags(body: string): readonly string[] {
  const found: string[] = []
  let fenced = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const prose = line.replace(/`[^`]*`/g, ' ')
    for (const match of prose.matchAll(/(?:^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu)) {
      const tag = match[1] ?? ''
      if (/^[\p{N}_\-/]+$/u.test(tag) || found.includes(tag)) continue
      found.push(tag)
    }
  }
  return found
}

function scalarOf(value: NoteValue | undefined): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function splitFrontmatter(text: string): { fields: ReadonlyMap<string, NoteValue>; rest: string } {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { fields: new Map(), rest: text }
  const end = lines.findIndex((line, at) => at > 0 && (line.trim() === '---' || line.trim() === '...'))
  if (end === -1) return { fields: new Map(), rest: text }
  return { fields: parseYamlSubset(lines.slice(1, end)), rest: lines.slice(end + 1).join('\n') }
}

/**
 * The frontmatter's keys and values — the part of YAML a note's properties use.
 * A key whose value is a nested map is left out: it is not one column.
 */
export function parseYamlSubset(lines: readonly string[]): ReadonlyMap<string, NoteValue> {
  const fields = new Map<string, NoteValue>()
  let at = 0
  while (at < lines.length) {
    const line = lines[at] ?? ''
    at += 1
    if (line.trim() === '' || line.trimStart().startsWith('#') || /^\s/.test(line)) continue
    const match = /^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*)|\s*)$/.exec(line)
    if (match === null) continue
    const key = unquote((match[1] ?? '').trim())
    const raw = withoutComment((match[2] ?? '').trim())

    // What is indented under the key belongs to it.
    const child: string[] = []
    while (at < lines.length) {
      const next = lines[at] ?? ''
      if (next.trim() !== '' && !/^\s/.test(next) && !next.startsWith('-')) break
      child.push(next)
      at += 1
    }

    if (raw === '|' || raw === '>' || /^[|>][-+]?$/.test(raw)) {
      const block = dedent(child)
      fields.set(key, raw.startsWith('|') ? block.join('\n').trim() : block.join(' ').replace(/\s+/g, ' ').trim())
      continue
    }
    if (raw !== '' && !raw.startsWith('#')) {
      fields.set(key, valueOf(raw))
      continue
    }
    const items = child.filter((each) => each.trim() !== '')
    if (items.length === 0) {
      fields.set(key, '')
      continue
    }
    if (items.every((each) => /^\s*-(\s|$)/.test(each))) {
      fields.set(
        key,
        items.map((each) => scalar(each.replace(/^\s*-\s?/, ''))).filter((each) => each !== ''),
      )
    }
    // Anything else indented under a key is a map, which is not a column.
  }
  return fields
}

/** A value with a trailing ` # comment` taken off — one outside quotes and brackets. */
function withoutComment(raw: string): string {
  let quote: string | undefined
  let depth = 0
  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at] ?? ''
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[') depth += 1
    else if (char === ']') depth -= 1
    else if (char === '#' && depth === 0 && (at === 0 || /\s/.test(raw[at - 1] ?? ''))) return raw.slice(0, at).trim()
  }
  return raw
}

function dedent(lines: readonly string[]): readonly string[] {
  const indents = lines.filter((each) => each.trim() !== '').map((each) => /^\s*/.exec(each)?.[0].length ?? 0)
  const least = indents.length === 0 ? 0 : Math.min(...indents)
  return lines.map((each) => each.slice(least))
}

function valueOf(raw: string): NoteValue {
  // `[[name]]` is a link, not a list holding a list.
  if (/^\[\[[^\]]*\]\]$/.test(raw)) return raw
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return splitFlow(raw.slice(1, -1)).map(scalar).filter((each) => each !== '')
  }
  return scalar(raw)
}

/** A flow list's members, split on the commas outside quotes and outside `[[…]]`. */
function splitFlow(inner: string): readonly string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | undefined
  let depth = 0
  for (const char of inner) {
    if (quote !== undefined) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    if (char === '[') depth += 1
    if (char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

/** One scalar: unquoted, and a trailing ` # comment` taken off a bare one. */
function scalar(raw: string): string {
  const text = raw.trim()
  if ((text.startsWith('"') && text.endsWith('"') && text.length >= 2) || (text.startsWith("'") && text.endsWith("'") && text.length >= 2)) {
    return unquote(text)
  }
  if (text.startsWith('#')) return ''
  const comment = text.search(/\s#/)
  const bare = comment === -1 ? text : text.slice(0, comment).trim()
  return bare === '~' || bare === 'null' ? '' : bare
}

function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'")
  }
  return text
}

/* ------------------------------------------------------------- links */

/**
 * The note a value names, when the whole value is one link: `[[name]]`,
 * `[[name|shown]]`, `[[name#heading]]`, or `[text](path.md)`. An address that
 * is not a `.md` file — a web page, an image — is no note, and the value is
 * left as it is.
 */
export function linkedNote(value: string): string | undefined {
  const text = value.trim()
  const wiki = /^!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(text)
  if (wiki !== null) {
    const target = (wiki[1] ?? '').trim()
    return target === '' ? undefined : noteStem(target)
  }
  const markdown = /^\[[^\]]*\]\(\s*<?([^)>]*?)>?\s*\)$/.exec(text)
  if (markdown !== null) {
    let address = (markdown[1] ?? '').replace(/#.*$/, '').trim()
    try {
      address = decodeURIComponent(address)
    } catch {
      // A stray `%` is part of the name.
    }
    return /^[a-z][a-z0-9+.-]*:/i.test(address) || !isNoteFileName(address) ? undefined : noteStem(address)
  }
  return undefined
}

/**
 * Every note's title, found by file name or by title — the lookup a link is
 * resolved through. A file name is matched as written first, then ignoring
 * case, as a notes app does; two notes that differ only in case are both kept
 * as written and neither is matched loosely.
 */
export interface NoteIndex {
  titleOf(name: string): string | undefined
}

export function noteIndex(notes: readonly ParsedNote[]): NoteIndex {
  const byStem = new Map<string, string>()
  const byLowerStem = new Map<string, string | null>()
  const titles = new Set<string>()
  for (const note of notes) {
    if (!byStem.has(note.stem)) byStem.set(note.stem, note.title)
    const lower = note.stem.toLowerCase()
    byLowerStem.set(lower, byLowerStem.has(lower) && byLowerStem.get(lower) !== note.title ? null : note.title)
    titles.add(note.title)
  }
  return {
    titleOf: (name) => byStem.get(name) ?? byLowerStem.get(name.toLowerCase()) ?? (titles.has(name) ? name : undefined),
  }
}

function resolveValue(value: string, index: NoteIndex): string {
  const linked = linkedNote(value)
  if (linked === undefined) return value
  return index.titleOf(linked) ?? linked
}

/* ------------------------------------------------------------- the table */

/**
 * Notes as a table: a header row, then a row per note in the order given.
 * `index` resolves the links — every note read in the same call, so a recipe
 * in one folder names an ingredient in another by its title.
 */
export function notesTable(notes: readonly ParsedNote[], index: NoteIndex = noteIndex(notes)): ReadTable {
  const keys: string[] = []
  const lists = new Set<string>()
  for (const note of notes) {
    for (const [key, value] of note.fields) {
      if (key === 'title') continue
      if (!keys.includes(key)) keys.push(key)
      if (typeof value !== 'string') lists.add(key)
    }
  }

  // The body's tags and links are a column each only when a note writes one,
  // so a folder with none reads exactly as it did.
  const tagged = notes.some((note) => note.tags.length > 0)
  const linking = notes.some((note) => linkedTitles(note, index).length > 0)
  // A folder column only when a note sits in a folder inside the one read (M48 U2).
  const nested = notes.some((note) => note.folder !== '')
  const header = [
    'title',
    'file',
    ...(nested ? [FOLDER_HEADER] : []),
    ...keys,
    ...(tagged ? [INLINE_TAGS_HEADER] : []),
    ...(linking ? [BODY_LINKS_HEADER] : []),
    'body',
  ]
  const tagsAt = tagged ? header.indexOf(INLINE_TAGS_HEADER) : -1
  const linksAt = linking ? header.indexOf(BODY_LINKS_HEADER) : -1
  const text = (value: string): ReadCell => (value.trim() === '' ? { kind: 'empty', text: value } : { kind: 'text', text: value })
  const rows: ReadCell[][] = [header.map(text)]
  for (const note of notes) {
    rows.push([
      text(note.title),
      text(note.file),
      ...(nested ? [text(note.folder)] : []),
      ...keys.map((key) => {
        const value = note.fields.get(key)
        if (value === undefined) return text('')
        if (typeof value === 'string') return text(resolveValue(value, index))
        return text(value.map((each) => resolveValue(each, index)).join(`${NOTE_LIST_SEPARATOR} `))
      }),
      ...(tagged ? [text(note.tags.join(`${NOTE_LIST_SEPARATOR} `))] : []),
      ...(linking ? [text(linkedTitles(note, index).join(`${NOTE_LIST_SEPARATOR} `))] : []),
      text(note.body),
    ])
  }

  return {
    rows,
    columnCount: header.length,
    separators: header.map((key, at) =>
      lists.has(key) || at === tagsAt || at === linksAt ? NOTE_LIST_SEPARATOR : undefined,
    ),
    prose: header.map((_, at) => at === linksAt),
    rowNames: [undefined, ...notes.map((note) => note.file)],
  }
}

/**
 * The titles a note's body links to, each resolved as a frontmatter link is —
 * a note among those read by its title, any other by the name written — once
 * each. A link to the note itself is no connection, and is left out; so is
 * one to a file that is not a note and is not among those read (M48 U2).
 */
function linkedTitles(note: ParsedNote, index: NoteIndex): readonly string[] {
  const titles: string[] = []
  for (const name of note.links) {
    const found = index.titleOf(name)
    if (found === undefined && isFileTarget(name)) continue
    const title = found ?? name
    if (title === note.title || titles.includes(title)) continue
    titles.push(title)
  }
  return titles
}

/**
 * How many links of the notes' bodies name a file that is not a note — an
 * embedded image, a PDF — and were left out (M48 U2): counted once for the
 * read, never listed, since a pasted screenshot is not a missing row.
 */
export function fileLinkCount(notes: readonly ParsedNote[], index: NoteIndex = noteIndex(notes)): number {
  return notes.reduce(
    (sum, note) => sum + note.links.filter((name) => index.titleOf(name) === undefined && isFileTarget(name)).length,
    0,
  )
}

/**
 * The text a folder of notes is hashed over, so the app and the plugin call
 * the same folder the same file: every note's name and text, in name order.
 */
export function notesDigestText(notes: readonly Note[]): string {
  return [...notes]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((note) => `${note.file}\n${note.text}`)
    .join('\u0000')
}

/* ------------------------------------------------------------- items */

/**
 * **A note's list items, or the rows of a table in its body, as rows of a table
 * of their own** — M38 U4.
 *
 * One note is one row, so a recipe's ingredient lines and a board's cards were
 * typed by hand. This turns what a note's body *lists* into a second table, one
 * row per item, read onto a second format like any spreadsheet — and nothing
 * here knows which program wrote the notes. Its header row is:
 *
 * - **`note`** — the file name of the note the item sits in. It is the item's
 *   way back to its note's row, and is resolved by the **key the note's row was
 *   written under** (`keyedBy`, D-408), never by a name: two notes may share a
 *   title, never a file name;
 * - **`section`** — the heading the item sits under, and **`position`**, its
 *   place among the note's items, from 1;
 * - for a list: **`item`** as written (a checkbox taken off), **`checked`** for
 *   a task item (`- [x]`), **`figure`** and **`unit`** — a leading figure, a
 *   fraction counted out, and the unit right after it when the document knows
 *   that unit — **`link`**, the first note the item links to, read as a
 *   frontmatter link is, and **`text`**, what is left: the words, with each
 *   link as the text it shows;
 * - for a table: its own header cells, a cell that is wholly a link read as the
 *   note it names and a cell that is `[x]` or `[ ]` as ticked or not.
 *
 * **Only top-level items are items**: an indented one belongs to the item
 * above it, as its detail. `under` reads only the items under a heading of that
 * name — a recipe's `Ingredients` and not its `Method`. Each row is named by its
 * note and place (`Pancakes.md, item 3`), which is also its key when the folder
 * is read again: an edited line is that row changed, a line added at the end a
 * row added.
 */

/** Where a note's items come from: its list items, or the rows of a table in its body. */
export type ItemsFrom = 'list' | 'table'

/** One item of a note's body: the heading it is under, and what it holds. */
export interface NoteItem {
  readonly section: string
  /** A list item as written, its checkbox taken off; a table row's cells joined, for a person. */
  readonly text: string
  /** A task item's box: ticked or not; `undefined` when it has none. */
  readonly checked: boolean | undefined
  /** A table row's cells, by the table's header cell; empty for a list item. */
  readonly cells: ReadonlyMap<string, string>
}

/** The header of a list's items table. */
export const LIST_ITEM_HEADER = ['note', 'section', 'position', 'item', 'checked', 'figure', 'unit', 'link', 'text'] as const

const LIST_ITEM_PARTS: readonly (ItemPart | undefined)[] = [
  undefined,
  undefined,
  undefined,
  undefined,
  'checked',
  'figure',
  'unit',
  'link',
  'text',
]

/** What the source of a folder's items is called — the file name a read records them under. */
export function itemsFileName(folder: string, from: ItemsFrom, under?: string | undefined): string {
  const what = from === 'list' ? 'list items' : 'table rows'
  return `${folder} · ${what}${under === undefined || under.trim() === '' ? '' : ` under ${under.trim()}`}`
}

/** The hash a folder's items are known by: the folder's, and which items. */
export function itemsHash(folderHash: string, from: ItemsFrom, under?: string | undefined): string {
  return `${folderHash}:${from}:${(under ?? '').trim()}`
}

/** A heading line's text, or `undefined` for a line that is not one. */
function headingOf(line: string): string | undefined {
  const match = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
  return match === null ? undefined : (match[1] ?? '').trim()
}

const THEMATIC_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** A table row's cells: split on `|`, not an escaped one and not one inside `[[…]]`. */
function tableCells(line: string): readonly string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  const cells: string[] = []
  let current = ''
  let depth = 0
  for (let at = 0; at < inner.length; at += 1) {
    const char = inner[at] ?? ''
    if (char === '\\' && inner[at + 1] === '|') {
      current += '|'
      at += 1
      continue
    }
    if (char === '[' && inner[at + 1] === '[') depth += 1
    if (char === ']' && inner[at + 1] === ']') depth = Math.max(0, depth - 1)
    if (char === '|' && depth === 0) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

/**
 * The items a note's body lists, or the rows of the tables in it, in order —
 * nothing inside a fenced code block. `under`, when given, keeps only the
 * items under a heading of that name (case ignored).
 */
export function noteItems(body: string, from: ItemsFrom, under?: string | undefined): readonly NoteItem[] {
  const wanted = under === undefined || under.trim() === '' ? undefined : under.trim().toLowerCase()
  const items: NoteItem[] = []
  const lines = body.split('\n')
  let fenced = false
  let section = ''
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? ''
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const heading = headingOf(line)
    if (heading !== undefined) {
      section = heading
      continue
    }
    const keep = wanted === undefined || section.toLowerCase() === wanted
    if (from === 'list') {
      if (THEMATIC_BREAK.test(line)) continue
      // Top-level only: an item indented under another is its detail.
      const match = /^ ?(?:[-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line)
      if (match === null || !keep) continue
      const written = (match[1] ?? '').trim()
      const box = /^\[([ xX])\]\s*(.*)$/.exec(written)
      const text = box === null ? written : (box[2] ?? '').trim()
      if (text === '') continue
      items.push({ section, text, checked: box === null ? undefined : box[1] !== ' ', cells: new Map() })
      continue
    }
    // A table: a row of cells over a rule of dashes, then its rows.
    const rule = lines[at + 1] ?? ''
    if (!line.includes('|') || !rule.includes('-') || !TABLE_RULE.test(rule)) continue
    const header = tableCells(line)
    at += 2
    for (; at < lines.length; at += 1) {
      const row = lines[at] ?? ''
      if (!row.includes('|') || row.trim() === '') {
        at -= 1
        break
      }
      if (!keep) continue
      const cells = tableCells(row)
      const byHeader = new Map<string, string>()
      header.forEach((name, k) => {
        if (name !== '' && !byHeader.has(name)) byHeader.set(name, cells[k] ?? '')
      })
      items.push({ section, text: cells.join(' · '), checked: undefined, cells: byHeader })
    }
  }
  return items
}

/** The headings a folder's items sit under, each once, in the order they first appear. */
export function itemSections(notes: readonly ParsedNote[], from: ItemsFrom): readonly string[] {
  const found: string[] = []
  for (const note of notes) {
    for (const item of noteItems(note.body, from)) {
      if (item.section !== '' && !found.includes(item.section)) found.push(item.section)
    }
  }
  return found
}

const VULGAR: Readonly<Record<string, number>> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
}

/** An item's leading figure: a number, a fraction, or a whole number and a fraction. */
function leadingFigure(text: string): { readonly value: number; readonly written: string } | undefined {
  const mixed = /^(\d+)\s+(\d+)\/(\d+)(?![\d/])/.exec(text)
  if (mixed !== null) {
    const below = Number(mixed[3])
    if (below > 0) return { value: Number(mixed[1]) + Number(mixed[2]) / below, written: mixed[0] }
  }
  const fraction = /^(\d+)\/(\d+)(?![\d/])/.exec(text)
  if (fraction !== null) {
    const below = Number(fraction[2])
    if (below > 0) return { value: Number(fraction[1]) / below, written: fraction[0] }
  }
  const vulgar = /^(\d*)\s?([½⅓⅔¼¾⅛])/.exec(text)
  if (vulgar !== null) {
    return { value: Number(vulgar[1] === '' ? 0 : vulgar[1]) + (VULGAR[vulgar[2] ?? ''] ?? 0), written: vulgar[0] }
  }
  const plain = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d.])|^\d+(?:\.\d+)?(?![\d.])/.exec(text)
  if (plain === null) return undefined
  return { value: Number(plain[0].replace(/,/g, '')), written: plain[0] }
}

/** Every link written in a piece of text, wiki or Markdown, with what it shows. */
const ANY_LINK = /!?\[\[([^\]\n]*)\]\]|!?\[([^\]\n]*)\]\(([^)\n]*)\)/g

/** A link as the words it shows: `[[a|b]]` is `b`, `[[a#h]]` is `a`, `[t](f.md)` is `t`. */
function shownText(wiki: string | undefined, shown: string | undefined): string {
  if (wiki !== undefined) {
    const bar = wiki.indexOf('|')
    if (bar !== -1) return wiki.slice(bar + 1).trim()
    return noteStem(wiki.replace(/#.*$/, '').trim())
  }
  return (shown ?? '').trim()
}

/** The parts of one list item, as the items table holds them. */
export interface ItemParts {
  readonly figure: { readonly value: number; readonly written: string } | undefined
  readonly unit: string | undefined
  /** The first note the item links to, by the name the link writes (`linkedNote`). */
  readonly link: string | undefined
  readonly text: string
}

/**
 * An item's parts. A unit is taken only when `units` knows it — exactly, else
 * ignoring case, else without a plural `s` — so `2 eggs` is a figure and words,
 * and `200 g flour` a figure, a unit and words.
 */
export function itemParts(text: string, units: readonly string[]): ItemParts {
  const figure = leadingFigure(text)
  let rest = figure === undefined ? text : text.slice(figure.written.length)
  let unit: string | undefined
  if (figure !== undefined) {
    const word = /^\s?([\p{L}µ°]+)\.?(?=$|[\s,;:)(])/u.exec(rest)
    const symbol = word === null ? undefined : knownUnit(word[1] ?? '', units)
    if (word !== null && symbol !== undefined) {
      unit = symbol
      rest = rest.slice(word[0].length)
    }
  }
  let link: string | undefined
  for (const match of text.matchAll(ANY_LINK)) {
    const name = linkedNote(match[0].replace(/^!(?=\[[^[])/, ''))
    if (name !== undefined) {
      link = name
      break
    }
  }
  const words = rest.replace(ANY_LINK, (_whole: string, wiki: string | undefined, shown: string | undefined) =>
    shownText(wiki, shown),
  )
  return { figure, unit, link, text: words.replace(/\s+/g, ' ').replace(/^[\s,;:–-]+/, '').trim() }
}

function knownUnit(word: string, units: readonly string[]): string | undefined {
  if (units.includes(word)) return word
  const lower = word.toLowerCase()
  const folded = units.find((each) => each.toLowerCase() === lower)
  if (folded !== undefined) return folded
  if (lower.length > 2 && lower.endsWith('s')) return units.find((each) => each.toLowerCase() === lower.slice(0, -1))
  return undefined
}

export interface ItemsOptions {
  readonly from: ItemsFrom
  readonly under?: string | undefined
  /** The file name the folder's own rows were read from — what `note` is resolved against. */
  readonly source: string
  /** The unit symbols the document knows, for an item's `unit`. */
  readonly units: readonly string[]
}

/**
 * The items of every note, as one table: a header row, then a row per item,
 * note by note in the order given. `index` resolves links as `notesTable` does.
 */
export function itemsTable(
  notes: readonly ParsedNote[],
  options: ItemsOptions,
  index: NoteIndex = noteIndex(notes),
): ReadTable {
  const text = (value: string): ReadCell => (value.trim() === '' ? { kind: 'empty', text: value } : { kind: 'text', text: value })
  const number = (value: number, written: string = String(value)): ReadCell => ({ kind: 'number', text: written, value })
  const perNote = notes.map((note) => noteItems(note.body, options.from, options.under))
  const names: (string | undefined)[] = [undefined]

  if (options.from === 'list') {
    const rows: ReadCell[][] = [LIST_ITEM_HEADER.map((each) => text(each))]
    notes.forEach((note, k) => {
      ;(perNote[k] ?? []).forEach((item, at) => {
        const parts = itemParts(item.text, options.units)
        rows.push([
          text(note.file),
          text(item.section),
          number(at + 1),
          text(item.text),
          item.checked === undefined ? text('') : { kind: 'boolean', text: item.checked ? '[x]' : '[ ]', value: item.checked },
          parts.figure === undefined ? text('') : number(parts.figure.value, parts.figure.written),
          text(parts.unit ?? ''),
          text(parts.link === undefined ? '' : (index.titleOf(parts.link) ?? parts.link)),
          text(parts.text),
        ])
        names.push(`${note.file}, item ${String(at + 1)}`)
      })
    })
    return {
      rows,
      columnCount: LIST_ITEM_HEADER.length,
      rowNames: names,
      keyedBy: LIST_ITEM_HEADER.map((_, at) => (at === 0 ? options.source : undefined)),
      parts: LIST_ITEM_PARTS,
    }
  }

  // A table's own header cells, in the order the notes first use them.
  const keys: string[] = []
  for (const items of perNote) {
    for (const item of items) for (const key of item.cells.keys()) if (!keys.includes(key)) keys.push(key)
  }
  const header = ['note', 'section', 'position', ...keys]
  const rows: ReadCell[][] = [header.map((each) => text(each))]
  notes.forEach((note, k) => {
    ;(perNote[k] ?? []).forEach((item, at) => {
      rows.push([
        text(note.file),
        text(item.section),
        number(at + 1),
        ...keys.map((key): ReadCell => {
          const cell = (item.cells.get(key) ?? '').trim()
          const box = /^\[([ xX])\]$/.exec(cell)
          if (box !== null) return { kind: 'boolean', text: cell, value: box[1] !== ' ' }
          return text(resolveValue(cell, index))
        }),
      ])
      names.push(`${note.file}, row ${String(at + 1)}`)
    })
  })
  return {
    rows,
    columnCount: header.length,
    rowNames: names,
    keyedBy: header.map((_, at) => (at === 0 ? options.source : undefined)),
  }
}
