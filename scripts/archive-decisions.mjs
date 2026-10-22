/**
 * Moves the decision entries of every closed milestone out of the decision log
 * and into `docs/archive/decisions/` (M43 U5).
 *
 * **`docs/archive/` is not in the repository** (D-495): it is ignored, and kept
 * only in the maintainer's checkout. In the repository a moved entry's record is
 * its `decision` row in `docs/memory.emd`, so its index row names the milestone
 * without a link, and every link to it becomes the plain `D-NNN`.
 *
 *   node scripts/archive-decisions.mjs            # write it
 *   node scripts/archive-decisions.mjs --dry      # say what would move, write nothing
 *   node scripts/archive-decisions.mjs M34="What the trial found"
 *                                                 # a title for the file other than the row's
 *   node scripts/archive-decisions.mjs --root <folder>
 *                                                 # another checkout's docs (the test's fixture)
 *
 * The log opens with an index of every decision and holds the open milestones'
 * entries in full; a closed milestone's entries live in an archive file, moved
 * verbatim. That was a step somebody remembered when a milestone closed, and by
 * 2026-10-08 thirteen closed milestones were still in the log, at 5,500 lines
 * against a 1,200-line budget. So it is a script, and `npm run docs:check`
 * fails while a closed milestone has an entry left in the log.
 *
 * Which milestone an entry belongs to, and whether that milestone is closed, is
 * read from `docs/memory.emd` — the `decision` and `milestone` rows — so this
 * needs the document stored as text (D-246). What it does, in order:
 *
 * 1. Each closed milestone's entries go to its archive file: the one already
 *    named `…-m27-…` if there is one (appended), else a new `dNNN-dMMM-mNN-slug.md`.
 *    A `## M19 — …` section heading in the log goes with its milestone, and its
 *    prose becomes the archive file's opening. A heading without an anchor gets
 *    `<a id="d-NNN"></a>`, which is what every link to an entry targets.
 * 2. Relative links inside a moved entry are rebased to the archive folder, and
 *    a `](#d-NNN)` points at wherever D-NNN now lives.
 * 3. The index rows of what moved name their milestone, from the decision row —
 *    never the link's text, which says `below` while the entry is in the log.
 * 4. Every Markdown link in a tracked `.md` file to an entry that is not in the
 *    log any more becomes its text. Only a link: a code file's comment quoting
 *    a path to an entry as an example is left as written.
 *
 * Entries are never reworded. The remaining log is rewritten in number order,
 * with its `## Related` footer last.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

let root = path.resolve(import.meta.dirname, '..')
const LOG = 'docs/09-decision-log.md'
const ARCHIVE = 'docs/archive/decisions'
const MEMORY = 'docs/memory.emd'

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const posix = (p) => p.split(path.sep).join('/')

/** The rows of one declared format in a text document, as `ref -> {column: first line}`. */
function rowsOf(text, format) {
  const section = text.split(/^<!-- emerald: /m).find((part) => part.startsWith(`${format}.format.md`)) ?? ''
  const rows = section.split(/^## rows\s*$/m)[1] ?? ''
  const out = new Map()
  for (const block of rows.split(/^### /m).slice(1)) {
    const [head, ...lines] = block.split(/\r?\n/)
    const row = {}
    for (const line of lines) {
      const match = /^([a-z_]+): (.*)$/.exec(line)
      if (match && !(match[1] in row)) row[match[1]] = match[2]
    }
    out.set(head.trim(), row)
  }
  return out
}

/** `null` when the document is stored as SQLite bytes and cannot be read by a script. */
export function readMemory() {
  const text = read(MEMORY)
  if (!text.startsWith('<!-- emerald document')) return null
  const decisions = new Map([...rowsOf(text, 'decision')].map(([ref, row]) => [ref, row.milestone]))
  const milestones = rowsOf(text, 'milestone')
  return { decisions, milestones }
}

/** The log cut into its preamble (through the index and its rule) and its `## ` blocks. */
function parseLog(text) {
  const lines = text.split('\n')
  const index = lines.findIndex((line) => line === '## Index')
  let start = lines.findIndex((line, i) => i > index && line.startsWith('## '))
  const preamble = lines.slice(0, start)
  const blocks = []
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) blocks.push([])
    blocks.at(-1).push(lines[i])
  }
  return {
    preamble,
    blocks: blocks.map((body) => {
      const entry = /^## (D-\d+) · /.exec(body[0])
      const section = /^## (M\d+) — /.exec(body[0])
      return { body, id: entry?.[1] ?? null, sectionOf: section?.[1] ?? null }
    }),
  }
}

/** Every entry in the log whose milestone row says closed: `[id, milestone]`. */
export function closedEntriesInLog(memory = readMemory()) {
  if (!memory) return []
  const { blocks } = parseLog(read(LOG))
  return blocks
    .filter((block) => block.id)
    .map((block) => [block.id, memory.decisions.get(block.id)])
    .filter(([, milestone]) => memory.milestones.get(milestone)?.state === 'closed')
}

const number = (id) => Number(id.slice(2))
const slug = (title) =>
  title
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')

/** Every entry the archive holds, `D-NNN -> file`. */
function archived() {
  const out = new Map()
  if (!fs.existsSync(path.join(root, ARCHIVE))) return out
  for (const name of fs.readdirSync(path.join(root, ARCHIVE))) {
    if (!name.endsWith('.md')) continue
    for (const match of read(`${ARCHIVE}/${name}`).matchAll(/^## (D-\d+) · /gm)) out.set(match[1], `${ARCHIVE}/${name}`)
  }
  return out
}

function withAnchor(heading, id) {
  return heading.includes(`<a id="d-${number(id)}">`) ? heading : `${heading} <a id="d-${number(id)}"></a>`
}

/** `](target)` links in `text`, as written from `from`, rewritten to be written from `to`. */
function rebase(text, from, to, where) {
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^[a-z]+:/i.test(target) || target.startsWith('/')) return whole
    const anchor = /^#d-(\d+)$/.exec(target)
    if (anchor) {
      const home = where.get(`D-${anchor[1]}`)
      if (!home || home === to) return whole
      return `](${relative(to, home)}#d-${anchor[1]})`
    }
    if (target.startsWith('#')) return whole
    const [file, hash = ''] = target.split('#')
    const resolved = posix(path.relative(root, path.resolve(root, path.dirname(from), file)))
    // `[text](file.md)` quoted as an example names no file, and is left as written.
    if (!fs.existsSync(path.join(root, resolved))) return whole
    const home = hash.match(/^d-\d+$/) && resolved === LOG ? where.get(`D-${hash.slice(2)}`) ?? LOG : resolved
    if (home === resolved && from === to) return whole
    if (home === to && hash) return `](#${hash})`
    return `](${relative(to, home)}${hash ? `#${hash}` : ''})`
  })
}

function relative(from, to) {
  const rel = posix(path.relative(path.dirname(path.join(root, from)), path.join(root, to)))
  return rel.startsWith('.') ? rel : `./${rel}`
}

function main() {
  const dry = process.argv.includes('--dry')
  const at = process.argv.indexOf('--root')
  if (at > 0) root = path.resolve(process.argv[at + 1])
  const titles = new Map(
    process.argv.slice(2).flatMap((arg) => {
      const match = /^(M\d+)=(.+)$/.exec(arg)
      return match ? [[match[1], match[2]]] : []
    }),
  )
  const titleOf = (milestone) => titles.get(milestone) ?? memory.milestones.get(milestone)?.title ?? ''
  const memory = readMemory()
  if (!memory) {
    console.error(`${MEMORY} is stored as SQLite bytes — save it as text first (D-246).`)
    process.exit(1)
  }

  const log = parseLog(read(LOG))
  const closed = (milestone) => memory.milestones.get(milestone)?.state === 'closed'
  const milestoneOf = (block) => block.sectionOf ?? (block.id ? memory.decisions.get(block.id) : null)
  const moving = log.blocks.filter((block) => {
    const milestone = milestoneOf(block)
    return milestone && closed(milestone)
  })

  const unknown = log.blocks.filter((block) => block.id && !memory.decisions.has(block.id))
  for (const block of unknown) console.log(`  ${block.id} has no decision row, so it stays in the log`)

  // Where each moving milestone's entries go.
  fs.mkdirSync(path.join(root, ARCHIVE), { recursive: true })
  const names = fs.readdirSync(path.join(root, ARCHIVE))
  const groups = new Map()
  for (const block of moving) {
    const milestone = milestoneOf(block)
    if (!groups.has(milestone)) groups.set(milestone, { sections: [], entries: [] })
    groups.get(milestone)[block.id ? 'entries' : 'sections'].push(block)
  }
  const where = archived()
  for (const block of log.blocks) if (block.id) where.set(block.id, LOG)
  for (const [milestone, group] of groups) {
    const token = `-${milestone.toLowerCase()}`
    const existing = names.find((name) => name.includes(`${token}-`) || name.endsWith(`${token}.md`))
    const ids = group.entries.map((block) => block.id).sort((a, b) => number(a) - number(b))
    group.file = existing
      ? `${ARCHIVE}/${existing}`
      : `${ARCHIVE}/d${number(ids[0])}-d${number(ids.at(-1))}-${milestone.toLowerCase()}-${slug(titleOf(milestone))}.md`
    group.existing = Boolean(existing)
    for (const id of ids) where.set(id, group.file)
  }

  const today = new Date().toISOString().slice(0, 10)
  const writes = new Map()
  for (const [milestone, group] of groups) {
    const entries = group.entries
      .sort((a, b) => number(a.id) - number(b.id))
      .map((block) => {
        const body = [withAnchor(block.body[0], block.id), ...block.body.slice(1)].join('\n')
        return rebase(body, LOG, group.file, where).replace(/\n*$/, '\n')
      })
    const ids = group.entries.map((block) => block.id)
    if (group.existing) {
      const before = read(group.file).replace(/\n*$/, '\n')
      writes.set(group.file, `${before}\n${entries.join('\n')}`)
    } else {
      const title = titleOf(milestone)
      const opening = group.sections
        .map((block) => rebase(block.body.slice(1).join('\n'), LOG, group.file, where).trim())
        .filter(Boolean)
      const range = ids.length === 1 ? ids[0] : `${ids[0]} to ${ids.at(-1)}`
      writes.set(
        group.file,
        [
          '---',
          'type: log',
          'project: Emerald',
          '---',
          '',
          `# ${range} — ${milestone}, ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
          '',
          `Moved here verbatim on ${today}, ${milestone} being closed, by \`scripts/archive-decisions.mjs\`. **Never`,
          `rewritten**, and kept privately: \`docs/archive/\` is not in the repository (D-495). Every one of`,
          'these is also a `decision` row in `docs/memory.emd`, which is the record the repository holds.',
          '',
          ...(opening.length ? [opening.join('\n\n'), ''] : []),
          entries.join('\n'),
        ].join('\n'),
      )
    }
  }

  // The log: its index repointed, what stays in number order, the footer last.
  const movedIds = new Set(moving.filter((block) => block.id).map((block) => block.id))
  const preamble = log.preamble.map((line) => {
    const row = /^(\| (D-\d+) \| [^|]* \| [^|]* \| )([^|]*)( \|.*)$/.exec(line)
    if (!row || !movedIds.has(row[2])) return line
    return `${row[1]}${memory.decisions.get(row[2])}${row[4]}`
  })
  const staying = log.blocks.filter((block) => !moving.includes(block))
  const footer = staying.filter((block) => /^## Related\b/.test(block.body[0]))
  const sections = staying.filter((block) => !block.id && !footer.includes(block))
  const kept = staying.filter((block) => block.id).sort((a, b) => number(a.id) - number(b.id))
  const tidy = (block) => block.body.join('\n').replace(/\n*$/, '\n')
  const logText = [
    preamble.join('\n'),
    [...sections, ...kept, ...footer].map((block) => rebase(tidy(block), LOG, LOG, where)).join('\n'),
  ].join('\n')
  writes.set(LOG, logText.replace(/\n*$/, '\n'))

  // Every link into the log for an entry that is not there any more.
  const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.endsWith('.md') && fs.existsSync(path.join(root, file)))
  // The archive is not in the repository, so a tracked file never links into it:
  // a link to a moved entry keeps its text. A path that is not a link is prose,
  // and is left alone: M42's run rewrote an example in docs-check.mjs's comment.
  const moved = (n) => where.get(`D-${n}`)?.startsWith(`${ARCHIVE}/`)
  const intoLog = (file, prefix) =>
    posix(path.relative(root, path.resolve(root, path.dirname(file), `${prefix}09-decision-log.md`))) === LOG
  let repointed = 0
  for (const file of files) {
    const text = writes.get(file) ?? read(file)
    const own = (file === LOG ? rebase(text, file, file, where) : text)
      .replace(/\[([^\]]+)\]\(((?:\.{1,2}\/|[\w.-]+\/)*)(?:09-decision-log\.md)?#d-(\d+)\)/g, (whole, label, prefix, n) => {
        const target = whole.includes('09-decision-log.md') ? intoLog(file, prefix) : file === LOG
        if (!target || !moved(n)) return whole
        repointed += 1
        return label
      })
      .replace(/\[([^\]]+)\]\(([^)\s]*archive\/decisions\/[^)\s]*)\)/g, (whole, label) => {
        repointed += 1
        return label
      })
    if (own !== text) writes.set(file, own)
  }

  for (const [milestone, group] of groups) {
    const ids = group.entries.map((block) => block.id)
    console.log(`  ${milestone}: ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} → ${group.file}${group.existing ? ' (appended)' : ''}`)
  }
  console.log(`  ${repointed} link(s) repointed; the log goes from ${read(LOG).split('\n').length} lines to ${logText.split('\n').length}`)
  if (dry) return console.log('archive-decisions: dry run, nothing written.')
  for (const [file, text] of writes) fs.writeFileSync(path.join(root, file), text)
  console.log(`archive-decisions: ${writes.size} file(s) written.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
