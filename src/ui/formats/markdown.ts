/**
 * **Markdown, read into blocks** — M26 U6, D-294.
 *
 * A long text column chosen to draw as markdown is read by this, so a format
 * that is mostly prose reads like the `.md` note it would otherwise have been
 * kept in. It is a small subset on purpose, and it is ours rather than a
 * dependency: headings, paragraphs, lists, quotes, fenced code, a rule, and
 * bold, italic, inline code and links inside a line.
 *
 * **It produces data, never HTML.** What is in a cell was written by somebody
 * else (D-114, D-120), so nothing here is ever handed to `innerHTML`: the page
 * draws these blocks as React elements, and a `<script>` in a note is the text
 * `<script>`. **A link is not followed** — the app makes no request it did not
 * serve itself — so it is drawn as its words, with where it points beside them.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly children: readonly Inline[]; readonly href: string }

export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | { readonly kind: 'quote'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'rule' }

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE = /^\s*```/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/

/** A text as blocks. An empty or blank text is no blocks. */
export function parseMarkdown(text: string): readonly Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let at = 0

  while (at < lines.length) {
    const line = lines[at] ?? ''

    if (line.trim() === '') {
      at += 1
      continue
    }

    if (FENCE.test(line)) {
      const body: string[] = []
      at += 1
      while (at < lines.length && !FENCE.test(lines[at] ?? '')) {
        body.push(lines[at] ?? '')
        at += 1
      }
      at += 1 // the closing fence, or past the end when there is none
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      // Four to six hashes read as the smallest heading: a note is not deep
      // enough for six sizes to mean anything apart.
      const hashes = heading[1]?.length ?? 1
      const level = hashes >= 3 ? 3 : hashes === 2 ? 2 : 1
      blocks.push({ kind: 'heading', level, children: parseInline(heading[2] ?? '') })
      at += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      at += 1
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (at < lines.length) {
        const quoted = QUOTE.exec(lines[at] ?? '')
        if (quoted === null) break
        body.push(quoted[1] ?? '')
        at += 1
      }
      blocks.push({ kind: 'quote', children: parseInline(body.join(' ').trim()) })
      continue
    }

    const ordered = NUMBERED.test(line)
    if (ordered || BULLET.test(line)) {
      const marker = ordered ? NUMBERED : BULLET
      const items: Inline[][] = []
      while (at < lines.length) {
        const current = lines[at] ?? ''
        const item = marker.exec(current)
        if (item !== null) {
          items.push(parseInline(item[1] ?? ''))
        } else if (current.trim() !== '' && /^\s+/.test(current) && items.length > 0) {
          // An indented line carries on the item above it.
          const last = items[items.length - 1] ?? []
          items[items.length - 1] = [...last, { kind: 'text', text: ' ' }, ...parseInline(current.trim())]
        } else {
          break
        }
        at += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // A paragraph runs until a blank line or the start of another block.
    const body: string[] = []
    while (at < lines.length) {
      const current = lines[at] ?? ''
      if (current.trim() === '' || startsBlock(current)) break
      body.push(current.trim())
      at += 1
    }
    blocks.push({ kind: 'paragraph', children: parseInline(body.join(' ')) })
  }

  return blocks
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line)
  )
}

/**
 * One line's emphasis, code and links.
 *
 * Left to right, taking the first marker that closes; a marker that never
 * closes is its own characters. Code is literal inside — nothing in backticks
 * is read as emphasis.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let plain = ''
  let at = 0

  const flush = (): void => {
    if (plain !== '') out.push({ kind: 'text', text: plain })
    plain = ''
  }

  while (at < text.length) {
    const rest = text.slice(at)

    if (rest.startsWith('`')) {
      const close = text.indexOf('`', at + 1)
      if (close > at + 1) {
        flush()
        out.push({ kind: 'code', text: text.slice(at + 1, close) })
        at = close + 1
        continue
      }
    }

    const strong = rest.startsWith('**') ? '**' : rest.startsWith('__') ? '__' : undefined
    if (strong !== undefined) {
      const close = text.indexOf(strong, at + 2)
      if (close > at + 2) {
        flush()
        out.push({ kind: 'strong', children: parseInline(text.slice(at + 2, close)) })
        at = close + 2
        continue
      }
    }

    const em = rest.startsWith('*') ? '*' : rest.startsWith('_') ? '_' : undefined
    // An underscore inside a word is a name like `snake_case`, not emphasis.
    const wordBefore = at > 0 && /\w/.test(text[at - 1] ?? '')
    if (em !== undefined && !(em === '_' && wordBefore)) {
      const close = text.indexOf(em, at + 1)
      if (close > at + 1 && text[at + 1] !== ' ') {
        flush()
        out.push({ kind: 'em', children: parseInline(text.slice(at + 1, close)) })
        at = close + 1
        continue
      }
    }

    if (rest.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
      if (link !== null) {
        flush()
        out.push({ kind: 'link', children: parseInline(link[1] ?? ''), href: link[2] ?? '' })
        at += link[0].length
        continue
      }
    }

    plain += text[at] ?? ''
    at += 1
  }

  flush()
  return out
}
