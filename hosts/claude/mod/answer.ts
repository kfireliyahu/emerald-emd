/**
 * **What the pane draws, read out of an answer's text** (M56 U1). `start_here`
 * and `show_format` answer a model: a first line meant for it alone, headed
 * sections of `- ` lines, and between them the calls that list a thing whole.
 * The pane is for the person, so it keeps the sections and their lines and
 * leaves out every line that speaks to the model — the first line, a call in
 * backticks, the shape of a row (D-493: nothing about servers, tools or
 * drawing reaches the person).
 *
 * Pure, and importing nothing, so a Vitest test reads it as the module does.
 */

export interface PaneLine {
  readonly text: string
  /** A line under a sub-heading of its section (`Held:`, `Stalled — …:`). */
  readonly under?: string
}

export interface PaneSection {
  /** The section's heading, or undefined for what comes before the first one. */
  readonly heading?: string
  /** What the section says of itself, in its own words: `None.`, `12 rows in all.`. */
  readonly notes: readonly string[]
  readonly lines: readonly PaneLine[]
}

/** Where `start_here` stops answering questions and starts teaching a model to write. */
const MODEL_ONLY_HEADINGS = [/^What a row looks like/i]

/** `_state is planned, …_` → `state is planned, …`; anything else as it is. */
function unitalic(text: string): string {
  const found = /^_(.+)_$/.exec(text)
  return found?.[1] ?? text
}

/**
 * A paragraph that is not a list, kept only when it names no call: `12 rows in
 * all. Whole list: \`…\`.` keeps its first sentence, and a paragraph that is
 * only a call, a pointer at a tool, or the line meant for the model is dropped.
 */
function noteOf(paragraph: string): string | undefined {
  if (paragraph.startsWith('**For you')) return undefined
  const text = unitalic(paragraph.replace(/\s+/g, ' ').trim())
  if (!text.includes('`')) return text
  const before = text.slice(0, text.indexOf('`'))
  const sentences = before.split(/(?<=\.)\s+/).filter((sentence) => /\.$/.test(sentence.trim()))
  const kept = sentences.join(' ').trim()
  return kept === '' ? undefined : kept
}

/** The sections of an answer, as the pane draws them. */
export function paneSections(answer: string): PaneSection[] {
  const sections: { heading?: string; notes: string[]; lines: PaneLine[] }[] = []
  let current: { heading?: string; notes: string[]; lines: PaneLine[] } = { notes: [], lines: [] }
  let stopped = false
  const close = () => {
    if (current.heading !== undefined || current.notes.length + current.lines.length > 0) sections.push(current)
  }
  for (const paragraph of answer.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    if (stopped) break
    const text = paragraph.trim()
    if (text === '') continue
    const heading = /^#{1,6}\s+(.*)$/.exec(text.split('\n')[0] ?? '')
    if (heading !== null) {
      const title = (heading[1] ?? '').trim()
      if (MODEL_ONLY_HEADINGS.some((pattern) => pattern.test(title))) {
        stopped = true
        break
      }
      close()
      current = { heading: title, notes: [], lines: [] }
      const rest = text.split('\n').slice(1).join('\n').trim()
      if (rest === '') continue
      readParagraph(rest, current)
      continue
    }
    readParagraph(text, current)
  }
  close()
  return sections
}

function readParagraph(text: string, into: { notes: string[]; lines: PaneLine[] }): void {
  const rows = text.split('\n').map((row) => row.trim())
  if (!rows.some((row) => row.startsWith('- '))) {
    const note = noteOf(text)
    if (note !== undefined) into.notes.push(note)
    return
  }
  let under: string | undefined
  for (const row of rows) {
    if (row.startsWith('- ')) into.lines.push(under === undefined ? { text: row.slice(2) } : { text: row.slice(2), under })
    else if (row !== '' && !row.includes('`')) under = row.replace(/:$/, '')
  }
}

/** A line as the pane draws it as a row: its ref set apart from its title, and what qualifies it beneath. */
export interface PaneRow {
  /** What the row is named by — `M2 U3`, `D-541`, an open question's name — when the line opens with one. */
  readonly ref?: string
  readonly title: string
  /** What the line adds after a ` — `: `waits on M32 U1 · …`, a decision title's tail and its state. */
  readonly detail?: string
}

/** Longer than this, a line's first part is its text, not a name to set apart. */
const REF_AT_MOST = 32

/**
 * A line's ref, title and detail, every word of it kept and in its order:
 * `M3 U1 · M3 · reported — waits on M2 U3` is ref `M3 U1`, title `M3 ·
 * reported` and detail `waits on M2 U3`.
 */
export function paneRow(text: string): PaneRow {
  const dash = text.indexOf(' — ')
  const head = dash < 0 ? text : text.slice(0, dash)
  const detail = dash < 0 ? undefined : text.slice(dash + 3).trim()
  const cut = head.indexOf(' · ')
  const ref = cut > 0 && cut <= REF_AT_MOST ? head.slice(0, cut) : undefined
  const title = ref === undefined ? head : head.slice(cut + 3)
  return {
    ...(ref === undefined ? {} : { ref }),
    title,
    ...(detail === undefined || detail === '' ? {} : { detail }),
  }
}

/** How many rows of one list the pane shows before it says how many more there are. */
export const FEW = 6

/** The first few of a list, and how many it leaves out. */
export function firstFew<T>(items: readonly T[]): { readonly shown: readonly T[]; readonly more: number } {
  return { shown: items.slice(0, FEW), more: Math.max(0, items.length - FEW) }
}
