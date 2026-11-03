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
