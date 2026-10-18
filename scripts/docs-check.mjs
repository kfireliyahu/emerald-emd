/**
 * The closing pass, as a command rather than a discipline.
 *
 * `docs/` is the specification and it is versioned with the code, which means it
 * drifts the way code does — except nothing compiles it, so nothing complains.
 * Five separate sessions were asked to "clean up the docs" before this file
 * existed; every one of them found the same four shapes of rot:
 *
 *   1. A finished unit still carrying its full reasoning in the roadmap, when
 *      the roadmap's own rule is milestones only, a unit being its row (D-286).
 *      Retired with the roadmap itself (D-438): a milestone is a row too, and
 *      the note is in archive/.
 *   2. `status.md` accreting blockquotes under whatever list item was nearest,
 *      each one a second copy of a decision entry. Retired with the file
 *      itself (D-434): where the build is is `start_here` over the rows now.
 *   3. A claim that quietly became false — "the installer has never been run",
 *      "next is the desktop shell" — left standing in a file nobody reopened.
 *   4. A decision entry with no row in the index, which makes it unfindable by
 *      the one method conventions.md tells a session to use.
 *
 * The index is still checked here, and so are the rows that replaced the rest.
 * The third is not, and no script will ever catch it — which is why the convention that
 * points at this file also asks for one grep.
 *
 * **Errors fail; budgets only warn.** A budget is a tripwire for "this file is
 * turning back into a narrative", not a rule about length. Being over one is a
 * prompt to condense something before adding more, not a thing to fix by
 * deleting content that belongs somewhere.
 */

import fs from 'node:fs'
import path from 'node:path'
import { closedEntriesInLog } from './archive-decisions.mjs'

const root = path.resolve(import.meta.dirname, '..')
const docs = path.join(root, 'docs')

/**
 * Set just above where each file sat when this script was written, so a budget
 * bites on the next drift rather than on the day it was introduced. The roadmap's
 * and review.md's went with the notes (M40 U5, D-438): milestones are rows, and
 * both files are in archive/.
 */
const BUDGETS = [
  ['docs/09-decision-log.md', 1200, 'a milestone may have closed — its entries move out of the log'],
  ['docs/04-data-model.md', 300, 'the engine has few tables on purpose; a declared one is not a schema change'],
  ['docs/conventions.md', 240, 'the contract, not a manual — a trap that belongs to one pack belongs in that pack'],
]

/**
 * A session pays for a note twice: once to read it, and again on every turn it
 * then sits in context. Measured over 67 sessions, whole-file reads of the four
 * largest notes were the biggest single line in the bill — `07-roadmap.md` was
 * read end to end 28 times and `09-decision-log.md` 26, against a rule in
 * CLAUDE.md that says to grep them instead.
 *
 * Nothing here fails or even warns. It prints what a whole read costs, at the
 * seam where the roadmap line is being condensed anyway, because the cost was
 * invisible and that is the only reason it grew.
 */
const READ_COST_LINES = 600

/**
 * Grepping headings is what makes "read the section, not the file" possible: a
 * session runs `grep -n '^#\{2,3\} '` and slices with `sed -n`. That works only
 * while no single stretch is too long to slice, so this measures the longest run
 * of PROSE between headings — fenced blocks and table rows are excluded,
 * because the decision index is one 190-row table and the source tree is one
 * 185-line fence, and a heading in the middle of either would be vandalism.
 *
 * Every note passes today; the worst prose run in `docs/` is 79 lines. The
 * threshold is set just above it, like the budgets, so it bites on the drift
 * rather than on the day it was written.
 */
const HEADING_MAP_LINES = 400
const PROSE_RUN = 100

const errors = []
const warnings = []
const costs = []

/** Every `.md` under `docs/`, recursively, repo-relative and slash-separated. */
/** `docs/archive/` is kept privately and is not in the repository (D-495), so it is not checked. */
const ARCHIVE = path.join(docs, 'archive')

function markdownFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (full === ARCHIVE) return []
      if (entry.isDirectory()) return markdownFiles(full)
      return entry.name.endsWith('.md') ? [path.relative(root, full).split(path.sep).join('/')] : []
    })
}

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const lines = (file) => read(file).split(/\r?\n/)

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * The files outside `docs/` that send a session somewhere: the one every session
 * reads, the README, and the skills. A link from one of them to a retired note
 * sends a session nowhere — D-434 retired `status.md`, and all of them named it.
 */
function orientationFiles() {
  const skills = path.join(root, '.claude', 'skills')
  const skillFiles = fs.existsSync(skills)
    ? fs
        .readdirSync(skills, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skills, entry.name, 'SKILL.md')))
        .map((entry) => `.claude/skills/${entry.name}/SKILL.md`)
    : []
  return ['CLAUDE.md', 'README.md', ...skillFiles]
}

/** A relative link to a note that is not there. Silent in every renderer. */
function checkLinks(files) {
  for (const file of files) {
    for (const match of read(file).matchAll(/\]\((\.[^)#\s]*\.md)/g)) {
      const target = path.resolve(root, path.dirname(file), match[1])
      if (!fs.existsSync(target)) errors.push(`${file} links to ${match[1]}, which does not exist`)
    }
    // The archive exists in the maintainer's checkout and nowhere else (D-495).
    for (const match of read(file).matchAll(/\]\(([^)#\s:]+)[)#]/g)) {
      const target = path.resolve(root, path.dirname(file), match[1])
      if (target === ARCHIVE || target.startsWith(ARCHIVE + path.sep)) {
        errors.push(`${file} links to ${match[1]}, and docs/archive/ is not in the repository — name the D-ref instead`)
      }
    }
  }
}

/**
 * The index is how a session finds a decision — conventions.md says to grep it
 * rather than read the log. An entry missing from it is an entry nobody finds.
 */
function checkDecisionIndex() {
  const file = 'docs/09-decision-log.md'
  const text = read(file)

  const entries = [...text.matchAll(/^## (D-\d+) · /gm)].map((m) => m[1])
  const rows = new Map()
  for (const match of text.matchAll(/^\| (D-\d+) \| [^|]* \| [^|]* \| ([^|]*) \|/gm)) {
    if (rows.has(match[1])) errors.push(`${file}: ${match[1]} has two index rows`)
    rows.set(match[1], match[2].trim())
  }

  for (const id of entries) {
    if (!rows.has(id)) errors.push(`${file}: ${id} is written out in full but has no index row`)
  }
  for (const [id, where] of rows) {
    if (where.includes('below') && !entries.includes(id)) {
      errors.push(`${file}: the index says ${id} is below, and it is not — did it move to the archive?`)
    }
  }

  const duplicates = entries.filter((id, i) => entries.indexOf(id) !== i)
  for (const id of new Set(duplicates)) errors.push(`${file}: ${id} is written out twice`)
}

/**
 * A link to a decision's anchor — `09-decision-log.md#d-307`, an archive file's,
 * or `#d-307` inside either — whose entry is not in that file (M43 U5). A
 * renderer scrolls nowhere and says nothing, which is how 118 links went on
 * pointing at the log after their entries had moved to the archive.
 */
function checkDecisionAnchors(files) {
  const holds = new Map()
  const entries = (file) => {
    if (!holds.has(file)) holds.set(file, new Set([...read(file).matchAll(/^## (D-\d+) · /gm)].map((m) => m[1])))
    return holds.get(file)
  }
  const isDecisions = (file) => file === 'docs/09-decision-log.md' || file.startsWith('docs/archive/decisions/')
  for (const file of files) {
    for (const match of read(file).matchAll(/\]\(([^)#\s]*)#d-(\d+)\)/g)) {
      const target = match[1]
        ? path.relative(root, path.resolve(root, path.dirname(file), match[1])).split(path.sep).join('/')
        : file
      if (!isDecisions(target) || !fs.existsSync(path.join(root, target))) continue
      if (!entries(target).has(`D-${match[2]}`)) {
        errors.push(`${file} links to ${match[1]}#d-${match[2]}, and D-${match[2]} is not in ${target} — node scripts/archive-decisions.mjs repoints links to moved entries`)
      }
    }
  }
}

/**
 * The log holds the open milestones' entries and nothing else (M43 U5). Moving
 * a closed milestone's entries out was a step remembered by hand, and by
 * 2026-10-08 thirteen closures had skipped it. Which milestone an entry is, and
 * whether it is closed, are the `decision` and `milestone` rows.
 */
function checkClosedMilestonesArchived() {
  const left = closedEntriesInLog()
  const byMilestone = new Map()
  for (const [id, milestone] of left) byMilestone.set(milestone, [...(byMilestone.get(milestone) ?? []), id])
  for (const [milestone, ids] of byMilestone) {
    errors.push(`docs/09-decision-log.md still holds ${ids.join(', ')}, and ${milestone} is closed — node scripts/archive-decisions.mjs moves them out of the log`)
  }
}

/**
 * A decision written out in the log with no row in `docs/memory.emd` (M22 U5).
 * The rule "write the row as well as the entry" lasted four hours: the session
 * that wrote it recorded four decisions to markdown and not one row, because
 * the markdown was the easier path. This is where forgetting gets caught.
 *
 * The document does not hold the whole back-catalogue until M22 U2, so the rule
 * starts at the lowest decision it does hold and moves down as U2 migrates —
 * nothing here needs editing when it does. A document stored as SQLite bytes
 * cannot be read by a script, and that is a choice (D-246), so it is a note.
 */
function checkDecisionRows() {
  const file = 'docs/memory.emd'
  const text = read(file)
  if (!text.startsWith('<!-- emerald document')) {
    costs.push(`${file} is stored as SQLite bytes, so no decision was checked for a row — Ctrl+K, Save this document as text`)
    return
  }

  const section = text.split(/^<!-- emerald: /m).find((part) => part.startsWith('decision.format.md')) ?? ''
  const rows = new Set([...section.matchAll(/^### D-(\d+)\s*$/gm)].map((m) => Number(m[1])))
  if (rows.size === 0) return
  const floor = Math.min(...rows)

  const entries = [...read('docs/09-decision-log.md').matchAll(/^## D-(\d+) · /gm)].map((m) => Number(m[1]))
  for (const n of entries) {
    if (n >= floor && !rows.has(n)) {
      errors.push(`D-${n} is in docs/09-decision-log.md and has no row in ${file} — record_format_rows decision, the other half of the entry`)
    }
  }
}

/**
 * A unit row that says less than the roadmap used to (D-286). Since the row is
 * the only record of a finished unit, a `built` one with no `landed` is a unit
 * nobody can date, and a `planned` one with no `files` (the brief's `Files:`
 * line until M27 U1) sends the
 * session that builds it back to grep for what the session that planned it
 * already knew. A built unit with no decision is allowed: M22 U2 closed short
 * and decided nothing.
 */
function checkUnitRows() {
  const file = 'docs/memory.emd'
  const text = read(file)
  if (!text.startsWith('<!-- emerald document')) return
  const section = text.split(/^<!-- emerald: /m).find((part) => part.startsWith('unit.format.md')) ?? ''
  for (const block of section.split(/^### /m).slice(1)) {
    const ref = block.split(/\r?\n/)[0].trim()
    const state = /^state: (\w+)/m.exec(block)?.[1]
    if (state === 'built' && !/^landed: /m.test(block)) {
      errors.push(`${ref} is built and has no landed date in ${file} — the row is the record of a finished unit (D-286)`)
    }
    if (state === 'planned' && !/^files: \S/m.test(block)) {
      warnings.push(`${ref} is planned and has no files — list what a session should open first (D-286, M27 U1)`)
    }
  }
}

/**
 * The rows of one declared format in the text `docs/memory.emd`, as plain
 * objects keyed by column, the row's label under `label`. A value the writer
 * had to quote (multi-line, padded, starting with a quote) is a JSON string,
 * and a `links` value is a JSON list — the two shapes `document.ts` writes.
 */
function memoryRows(format) {
  const text = read('docs/memory.emd')
  if (!text.startsWith('<!-- emerald document')) return undefined
  const section = text.split(/^<!-- emerald: /m).find((part) => part.startsWith(`${format}.format.md`)) ?? ''
  const rows = section.split(/^## rows\s*$/m)[1] ?? ''
  return rows
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [label, ...body] = block.split(/\r?\n/)
      const row = { label: label.trim() }
      for (const line of body) {
        const match = /^([a-z_][a-z0-9_]*): (.*)$/.exec(line)
        if (match === null) continue
        const value = match[2]
        // A quoted value is always JSON; a text that merely starts with `[` is not a list.
        if (value.startsWith('"')) row[match[1]] = JSON.parse(value)
        else if (value.startsWith('[')) {
          try {
            row[match[1]] = JSON.parse(value)
          } catch {
            row[match[1]] = value
          }
        } else row[match[1]] = value
      }
      return row
    })
}

/** A `rule` row as CLAUDE.md's rules block shows it: the statement, its decisions, what enforces it. */
function ruleLine(rule) {
  const decisions = Array.isArray(rule.decided_by) && rule.decided_by.length > 0 ? ` (${rule.decided_by.join(', ')})` : ''
  const enforced = rule.enforced_by ? ` — \`${rule.enforced_by}\`` : ''
  return `- **${rule.statement}**${decisions}${enforced}`
}

const RULES_OPEN = '<!-- rules: the rule rows marked always, rendered by `npm run docs:check -- --write`; docs:check fails when they differ -->'
const RULES_CLOSE = '<!-- /rules -->'

/**
 * The `rule` format (M40 U2, D-435): one place per rule. Three things only a
 * script can keep true, because the engine cannot say them:
 *
 * - **A live rule's `enforced_by` names files that exist** — the half of the
 *   *Code facts* question a format cannot answer, since a document knows
 *   nothing of the repo it sits in. An error: a rule citing a deleted test is
 *   a rule nobody is enforcing any more, and it reads as though somebody were.
 * - **A live rule resting on a superseded decision** — a warning, since a rule
 *   may outlive one of several decisions behind it. A computed column cannot
 *   read through a `links` column and an aggregate folds only the rows that
 *   point back, so this is here rather than a view (open question *Rules on a
 *   superseded decision*).
 * - **CLAUDE.md's rules block is the `always` rows, rendered** — CLAUDE.md is
 *   the one file every session loads, so it carries the few a session breaks
 *   before it would think to ask; a copy kept by hand is the drift this format
 *   was made to end, so it is generated, and `--write` regenerates it.
 */
function checkRuleRows() {
  const rules = memoryRows('rule')
  if (rules === undefined || rules.length === 0) return
  const live = rules.filter((rule) => rule.state === 'live')

  for (const rule of live) {
    for (const each of String(rule.enforced_by ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
      if (!fs.existsSync(path.join(root, each))) {
        errors.push(`rule "${rule.label}" is enforced by ${each}, which does not exist — point it at what enforces it now, or empty it`)
      }
    }
  }

  const superseded = new Set((memoryRows('decision') ?? []).filter((row) => row.state === 'superseded').map((row) => row.label))
  for (const rule of live) {
    const gone = (Array.isArray(rule.decided_by) ? rule.decided_by : []).filter((ref) => superseded.has(ref))
    if (gone.length > 0) warnings.push(`rule "${rule.label}" rests on ${gone.join(', ')}, which is superseded — is the rule still live?`)
  }

  const file = 'CLAUDE.md'
  const text = read(file)
  const start = text.indexOf(RULES_OPEN)
  const end = text.indexOf(RULES_CLOSE)
  if (start < 0 || end < start) {
    errors.push(`${file} has no rules block (${RULES_OPEN} … ${RULES_CLOSE}) — the rule rows marked always are rendered there`)
    return
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const rendered = [RULES_OPEN, ...live.filter((rule) => rule.always === 'true').map(ruleLine), RULES_CLOSE].join(eol)
  const current = text.slice(start, end + RULES_CLOSE.length)
  if (current === rendered) return
  if (process.argv.includes('--write')) {
    fs.writeFileSync(path.join(root, file), text.slice(0, start) + rendered + text.slice(end + RULES_CLOSE.length))
    costs.push(`${file}'s rules block was rewritten from the rule rows marked always`)
  } else {
    errors.push(`${file}'s rules block differs from the rule rows marked always — npm run docs:check -- --write`)
  }
}

/**
 * The `term` format (M40 U3, D-436): one name per thing. A term's `named_by` is
 * one link, and a computed column could read `named_by.state` through it — but
 * a computed column does arithmetic only and `state` is an enum, so a live term
 * whose naming decision was superseded is a warning here: the name may have
 * moved on without its row.
 */
function checkTermRows() {
  const terms = memoryRows('term')
  if (terms === undefined || terms.length === 0) return
  const superseded = new Set((memoryRows('decision') ?? []).filter((row) => row.state === 'superseded').map((row) => row.label))
  for (const term of terms) {
    if (term.state === 'live' && superseded.has(term.named_by)) {
      warnings.push(`term "${term.label}" was named by ${term.named_by}, which is superseded — is it still the name?`)
    }
  }
}

/**
 * **The hooks that put the build and the inbox in a session's context** (M47 U1).
 * A session that has to remember to look missed the row twice in one evening
 * and polled thirteen times for nothing; the hooks remember instead. So their
 * lines are kept here, the way the rows are: a settings edit that drops one
 * fails the closing pass rather than quietly sending sessions back to polling.
 */
const HOOK_LINES = [
  ['SessionStart', 'node "$CLAUDE_PROJECT_DIR/dist-plugin/hooks.mjs" start-here "$CLAUDE_PROJECT_DIR"'],
  ['UserPromptSubmit', 'node "$CLAUDE_PROJECT_DIR/dist-plugin/hooks.mjs" rows "$CLAUDE_PROJECT_DIR" inbox --match state=new --once-per-session'],
]

function checkSessionHooks() {
  let settings
  try {
    settings = JSON.parse(read('.claude/settings.json'))
  } catch (error) {
    errors.push(`.claude/settings.json cannot be read as JSON (${error.message}); its hooks print start_here and the inbox`)
    return
  }
  for (const [event, command] of HOOK_LINES) {
    const commands = (settings.hooks?.[event] ?? []).flatMap((group) => (group.hooks ?? []).map((hook) => hook.command))
    if (!commands.includes(command)) {
      errors.push(`.claude/settings.json has no ${event} hook running \`${command}\` (M47 U1)`)
    }
  }
  let named
  try {
    named = JSON.parse(read('.claude/emerald.json')).document
  } catch {
    named = undefined
  }
  if (typeof named !== 'string' || !fs.existsSync(path.join(root, named))) {
    errors.push('.claude/emerald.json must name the document the hooks read — { "document": "docs/memory.emd" }')
  }
}

// ── Warnings ────────────────────────────────────────────────────────────────

function checkBudgets() {
  for (const [file, budget, why] of BUDGETS) {
    const count = lines(file).length
    if (count > budget) warnings.push(`${file} is ${count} lines, over its ${budget}-line budget — ${why}`)
  }
}


// ── Notes ───────────────────────────────────────────────────────────────────

/**
 * What a whole read of the biggest notes costs, in the tokens a session spends
 * on it. Four characters to the token is the usual estimate and close enough to
 * make the point, which is comparative: this note against a grep of it.
 */
function reportReadCost(files) {
  const heavy = files
    .filter((file) => !file.startsWith('docs/archive/'))
    .map((file) => ({ file, count: lines(file).length, chars: read(file).length }))
    .filter((entry) => entry.count > READ_COST_LINES)
    .sort((a, b) => b.chars - a.chars)

  for (const { file, count, chars } of heavy) {
    costs.push(`${file} is ${count} lines — reading it whole costs a session ~${Math.round(chars / 4 / 100) / 10}k tokens; grep the headings and sed the section`)
  }
}

/**
 * Is this note still sliceable? See PROSE_RUN — fenced blocks and table rows do
 * not count, since a long one of either is a single thing and correct as it is.
 */
function checkHeadingMap(files) {
  for (const file of files) {
    if (file.startsWith('docs/archive/')) continue
    const all = lines(file)
    if (all.length <= HEADING_MAP_LINES) continue

    let fenced = false
    let run = 0
    let start = 0
    let longest = 0
    let longestAt = 0

    all.forEach((line, index) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced
        return
      }
      if (fenced || /^\s*\|/.test(line)) return
      if (/^#{2,3} /.test(line)) {
        run = 0
        start = index + 1
        return
      }
      run += 1
      if (run > longest) {
        longest = run
        longestAt = start
      }
    })

    if (longest > PROSE_RUN) {
      warnings.push(
        `${file} runs ${longest} lines of prose without a heading after line ${longestAt + 1} — a session cannot slice what it cannot find; break it up so grep returns a map`,
      )
    }
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

const files = markdownFiles(docs)
checkLinks([...files, ...orientationFiles()])
checkDecisionIndex()
checkDecisionAnchors([...files, ...orientationFiles()])
checkClosedMilestonesArchived()
checkDecisionRows()
checkUnitRows()
checkRuleRows()
checkTermRows()
checkSessionHooks()
checkBudgets()
checkHeadingMap(files)
reportReadCost(files)

for (const cost of costs) console.log(`  cost   ${cost}`)
for (const warning of warnings) console.log(`  warn   ${warning}`)
for (const error of errors) console.log(`  error  ${error}`)

if (errors.length === 0 && warnings.length === 0) {
  console.log(`docs check: ${files.length} notes, nothing drifted.`)
} else {
  console.log(
    `\ndocs check: ${files.length} notes, ${errors.length} error(s), ${warnings.length} warning(s).`,
  )
  console.log('The one thing this cannot check: a claim that became false. Grep for what you just changed.')
}

process.exit(errors.length > 0 ? 1 : 0)
