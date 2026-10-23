import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { createDatabase } from '../../db/database.ts'
import { ok } from '@/core/result.ts'
import { adoptFormat, listFormats, readFormat } from '../../repositories/formatRepository.ts'
import { insertRows, listRows } from '../../repositories/formatRowRepository.ts'
import { openEncoded } from '../../storage/encoding.ts'
import { formatRowsTool } from '@/plugin/tools/formats.ts'
import { NO_CLIENT } from '@/plugin/tools/tool.ts'
import {
  boardSettings,
  listViewSettings,
  setBoardLanes,
  setEntryInput,
  viewSettings,
  writeViewSettings,
} from '../../repositories/formatViewRepository.ts'
import { keepPack, keptParts, packById, planKeep, planParts, upToDate, type PackDescription } from '../packs.ts'
import { fingerprint, placeKey } from '../past.ts'
import { DEVELOPMENT_PAST } from './past.ts'
import { startHereTool } from '@/plugin/tools/startHere.ts'
import { developmentFormats, developmentViews, installDevelopmentPack, startHereTable } from './pack.ts'
import { tempDirSync } from '../../../testing/tempDir'

const MEMORY = fileURLToPath(new URL('../../../../docs/memory.emd', import.meta.url))
const NOW = Date.UTC(2026, 9, 1)

function formats(): readonly FormatDeclaration[] {
  const read = developmentFormats()
  if (!read.ok) throw new Error(read.error)
  return read.value.map((each) => each.declaration)
}

describe('the development pack (M27 U1)', () => {
  it('parses its six formats, each after the formats it links to', () => {
    const names = formats().map((each) => each.name)
    expect([...names].sort()).toEqual(['decision', 'inbox', 'milestone', 'open_question', 'review_entry', 'unit'])
    for (const [at, declaration] of formats().entries()) {
      for (const column of declaration.columns) {
        if (column.type !== 'link' || column.target === declaration.name) continue
        expect(names.indexOf(column.target ?? ''), `${declaration.name}.${column.name}`).toBeLessThan(at)
      }
    }
  })

  it('names every link target by a unique first text column, which a text document needs', () => {
    const byName = new Map(formats().map((each) => [each.name, each]))
    for (const declaration of formats()) {
      for (const column of declaration.columns) {
        if (column.type !== 'link') continue
        const naming = byName.get(column.target ?? '')?.columns.find((each) => each.type === 'text')
        expect(naming?.unique, `${declaration.name}.${column.name} → ${column.target ?? ''}`).toBe(true)
      }
    }
  })

  // Any project keeps this pack, so its prose is for any project (M52 F2): it
  // names no file of this repository, none of its decisions, milestones or
  // open questions, and none of its history. Examples are neutral — `D-12`, `Q3`, `M2`.
  it('says what each format and column is for in general terms, naming nothing of this repository', () => {
    const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
    const ours = [/\bD-\d{3,}\b/, /\bM\d{2,}\b/, /\bH\d+\b/, /\bmigrat/i, /\bEmerald\b/, /\bledger\b/i, /CLAUDE\.md/, /\bdocs\//]
    for (const declaration of formats()) {
      const prose = [
        declaration.notes,
        ...declaration.columns.map((column) => `${column.name}: ${column.note}`),
      ]
      for (const line of prose) {
        for (const pattern of ours) expect(line, `${declaration.name} names ${String(pattern)}`).not.toMatch(pattern)
        for (const path of line.match(/[\w.-]*\/[\w./-]+/g) ?? []) {
          expect(existsSync(join(ROOT, path)), `${declaration.name} names this repository's ${path}`).toBe(false)
        }
      }
    }
  })

  it('is what docs/memory.emd declares, so the two cannot drift', async () => {
    const { db } = await openEncoded(readFileSync(MEMORY))
    const held = new Map(listFormats(db).map((each) => [each.name, each]))
    for (const declaration of formats()) {
      const mine = held.get(declaration.name)
      expect(mine, declaration.name).toBeDefined()
      expect(mine?.columns, declaration.name).toEqual(declaration.columns)
      expect(mine?.notes, declaration.name).toEqual(declaration.notes)
    }
    db.close()
  })

  // A link since M27 U2, when `match` learned to take a link's name.
  it('links every unit in docs/memory.emd to a milestone row', async () => {
    const { db } = await openEncoded(readFileSync(MEMORY))
    const unit = listFormats(db).find((each) => each.name === 'unit')
    const milestone = listFormats(db).find((each) => each.name === 'milestone')
    if (unit === undefined || milestone === undefined) throw new Error('memory.emd lacks unit or milestone')
    expect(unit.columns.find((each) => each.name === 'milestone')?.target).toBe('milestone')
    const ids = new Set(listRows(db, milestone).map((row) => row.id))
    const units = listRows(db, unit)
    expect(units.length).toBeGreaterThan(0)
    for (const row of units) {
      expect(ids.has(String(row.cells['milestone'])), String(row.cells['ref'])).toBe(true)
    }
    db.close()
  })

  it('answers format_rows unit match:{milestone:M20} on the real document', async () => {
    const dir = tempDirSync('emerald-memory-')
    const path = join(dir, 'memory.emd')
    copyFileSync(MEMORY, path)
    const answer = await formatRowsTool.run({ path, format: 'unit', match: { milestone: 'M20' }, columns: ['ref'] }, NO_CLIENT)
    expect(answer).toContain('M20 U0')
    expect(answer).not.toContain('M19 ')
  })

  it('installs into an empty document, and a second install declares nothing', async () => {
    const db = await createDatabase()
    const first = installDevelopmentPack(db, NOW)
    if (!first.ok) throw new Error(first.error)
    expect([...first.value.declared].sort()).toEqual(['decision', 'inbox', 'milestone', 'open_question', 'review_entry', 'unit'])
    const second = installDevelopmentPack(db, NOW)
    if (!second.ok) throw new Error(second.error)
    expect(second.value).toEqual({ declared: [], completed: [] })
    db.close()
  })
})

describe('the development pack’s views (M27 U3, D-301)', () => {
  const BOARDS = [
    ['open_question', 'question', 'card'],
    ['open_question', 'state', 'lanes'],
    // Who has a unit and on which branch, beside it (M51 U2).
    ['unit', 'branch', 'card'],
    ['unit', 'milestone', 'card'],
    ['unit', 'state', 'lanes'],
    ['unit', 'taken_by', 'card'],
    ['unit', 'title', 'card'],
  ]

  it('declares two boards, open questions by state and units by state', () => {
    const views = developmentViews()
    if (!views.ok) throw new Error(views.error)
    const boards = views.value.filter((each) => each.view === 'board')
    expect(boards.map((each) => [each.format, each.column, each.setting])).toEqual(BOARDS)
  })

  it('declares a roadmap of milestones with units folded under, and an entry for each format it shows', () => {
    const views = developmentViews()
    if (!views.ok) throw new Error(views.error)
    const of = (view: string) =>
      views.value.filter((each) => each.view === view).map((each) => `${each.format}.${each.column}: ${each.setting}`)
    expect(of('roadmap')).toEqual([
      // The goal under the title, as the approved timeline draws it (M27 U8).
      'milestone.goal: line',
      'milestone.position: order',
      'milestone.title: line',
      // The branch a session took it on, beside who (M51 U2).
      'unit.branch: line',
      'unit.decision: line',
      'unit.milestone: under',
      // A session at work on a unit shows since when and who (M27 U6; `taken_by` since D-420).
      'unit.started: line',
      'unit.taken_by: line',
      'unit.title: line',
    ])
    // The page's body and line, folded into the one entry view (M35 U2, D-401):
    // a body is markdown, a line is the header, and the title comes first.
    expect(views.value.some((each) => each.view === 'page')).toBe(false)
    expect(new Set(views.value.filter((each) => each.view === 'entry').map((each) => each.format))).toEqual(
      new Set(['decision', 'inbox', 'milestone', 'open_question', 'review_entry', 'unit']),
    )
    expect(of('entry').filter((each) => each.startsWith('unit.'))).toEqual([
      'unit.brief: markdown',
      'unit.files: markdown',
      'unit.milestone: header',
      // One path per line, in the code face (M51 U4).
      'unit.paths: mono',
      'unit.ref: header',
      'unit.scope: header',
      'unit.title: line #1',
    ])
  })

  it('writes them with the formats it declares, and leaves a document’s own alone', async () => {
    const db = await createDatabase()
    const installed = installDevelopmentPack(db, NOW)
    if (!installed.ok) throw new Error(installed.error)
    expect(boardSettings(db, 'unit')).toEqual(
      new Map([['branch', 'card'], ['milestone', 'card'], ['state', 'lanes'], ['taken_by', 'card'], ['title', 'card']]),
    )
    setBoardLanes(db, 'unit', undefined)
    installDevelopmentPack(db, NOW)
    expect(boardSettings(db, 'unit').get('state')).toBeUndefined()
    db.close()
  })

  it('is what docs/memory.emd holds, so the two cannot drift', async () => {
    const { db } = await openEncoded(readFileSync(MEMORY))
    for (const format of ['open_question', 'unit']) {
      const held = [...boardSettings(db, format)].map(([column, setting]) => [format, column, setting])
      expect(held.sort(), format).toEqual(BOARDS.filter((each) => each[0] === format))
    }
    // Every view, not only the boards (M27 U4): the pack's text and the document's agree.
    const views = developmentViews()
    if (!views.ok) throw new Error(views.error)
    for (const view of ['entry', 'roadmap', 'ready', 'start'] as const) {
      for (const format of new Set(views.value.filter((each) => each.view === view).map((each) => each.format))) {
        const declared = views.value
          .filter((each) => each.view === view && each.format === format)
          .map((each) => [each.column, each.setting])
        expect([...viewSettings(db, format, view)].sort(), `${format} ${view}`).toEqual(declared)
      }
    }
    db.close()
  })
})

describe('where a session starts (M27 U5, D-303)', () => {
  const CLAUDE = fileURLToPath(new URL('../../../../CLAUDE.md', import.meta.url))

  it('declares a ready view of units and start views for decisions, the inbox, milestones, open questions and review entries', () => {
    const views = developmentViews()
    if (!views.ok) throw new Error(views.error)
    const of = (view: string) =>
      views.value.filter((each) => each.view === view).map((each) => `${each.format}.${each.column}: ${each.setting}`)
    expect(of('ready')).toContain('unit.state: ready planned done built dropped')
    expect(new Set(views.value.filter((each) => each.view === 'start').map((each) => each.format))).toEqual(
      new Set(['decision', 'inbox', 'milestone', 'open_question', 'review_entry']),
    )
    // What another project handed this one and nobody has read yet (M44 U1),
    // with what the row it is about holds now (M47 U4, D-461).
    expect(of('start').filter((each) => each.startsWith('inbox.'))).toEqual([
      'inbox.about: line',
      'inbox.from: line',
      'inbox.state: is new',
      'inbox.subject: line',
    ])
  })

  it('is the table CLAUDE.md holds between its markers, so the two cannot drift', () => {
    const table = startHereTable()
    if (!table.ok) throw new Error(table.error)
    const text = readFileSync(CLAUDE, 'utf8').replace(/\r\n/g, '\n')
    const held = /<!-- start-here[^>]*-->\n([\s\S]*?)\n<!-- \/start-here -->/.exec(text)?.[1]
    expect(held, `CLAUDE.md's start-here table should read:\n\n${table.value}\n`).toBe(table.value)
  })

  it('answers start_here on the real document in one call', async () => {
    const dir = tempDirSync('emerald-memory-')
    const path = join(dir, 'memory.emd')
    copyFileSync(MEMORY, path)
    const answer = await startHereTool.run({ path }, NO_CLIENT)
    expect(answer).toContain('### Ready to start — unit')
    expect(answer).toContain('### decision — the 5 latest by date')
    expect(answer).toContain('### inbox — state is new')
    expect(answer).toContain('### milestone — state is open')
    expect(answer).toContain('### open_question — state is open')
    expect(answer).toContain('### review_entry — state is open')
    // And what a row of each looks like, so the next call can write one (M47 U2).
    const shapes = answer.slice(answer.indexOf('### What a row looks like'))
    expect(shapes).toMatch(/^- `unit` — \*\*ref\*\*: unique · \*\*milestone\*\*: → milestone · /m)
    expect(shapes).toContain('**state**: planned|in_progress|built|dropped')
    expect(shapes).toMatch(/^- `decision` — /m)
  })
})

describe('keeping the pack again brings its notes and view settings (M51 U9, D-491)', () => {
  const found = packById('development')
  if (found === undefined) throw new Error('no development pack')
  const development: PackDescription = found

  it('lists in its past every notes text and view setting it declares now', () => {
    // The next build must recognise what this one wrote, so the past holds it
    // before anything changes it. Missing lines are printed to paste into past.ts.
    const missing: string[] = []
    for (const declaration of formats()) {
      const print = fingerprint(declaration.notes)
      const listed = DEVELOPMENT_PAST.notes[declaration.name] ?? []
      if (!listed.includes(print)) missing.push(`notes ${declaration.name}: [${[...listed, print].map((each) => `'${each}'`).join(', ')}]`)
    }
    const views = developmentViews()
    if (!views.ok) throw new Error(views.error)
    for (const view of views.value) {
      const key = placeKey(view)
      const listed = DEVELOPMENT_PAST.views[key]
      if (listed?.includes(view.setting) === true) continue
      const values = [...(listed ?? [null]), view.setting]
      missing.push(`views '${key}': [${values.map((each) => (each === null ? 'null' : `'${each}'`)).join(', ')}]`)
    }
    expect(missing, `src/data/packs/development/past.ts lacks:\n${missing.join('\n')}\n`).toEqual([])
  })

  /** A development pack whose `unit` notes and `unit entry brief` changed since the one a document keeps. */
  function newer(): PackDescription {
    const formats = developmentFormats()
    const views = developmentViews()
    if (!formats.ok || !views.ok) throw new Error('the pack does not read')
    const notes = 'A newer build says this about units.'
    return {
      ...development,
      declarations: () =>
        ok(
          formats.value.map((each) =>
            each.declaration.name === 'unit' || each.declaration.name === 'decision'
              ? { ...each, declaration: { ...each.declaration, notes: `${notes} (${each.declaration.name})` } }
              : each,
          ),
        ),
      views: () =>
        ok(
          views.value.map((each) =>
            each.format === 'unit' && each.view === 'entry' && each.column === 'brief'
              ? { ...each, setting: 'line' }
              : each.format === 'unit' && each.view === 'roadmap' && each.column === 'branch'
                ? { ...each, setting: 'under' }
                : each,
          ),
        ),
      past: {
        notes: {
          ...DEVELOPMENT_PAST.notes,
          unit: [...(DEVELOPMENT_PAST.notes['unit'] ?? []), fingerprint(`${notes} (unit)`)],
          decision: [...(DEVELOPMENT_PAST.notes['decision'] ?? []), fingerprint(`${notes} (decision)`)],
        },
        views: {
          ...DEVELOPMENT_PAST.views,
          'unit entry brief': [...(DEVELOPMENT_PAST.views['unit entry brief'] ?? []), 'line'],
          'unit roadmap branch': [...(DEVELOPMENT_PAST.views['unit roadmap branch'] ?? []), 'under'],
        },
      },
    }
  }

  async function keptToday() {
    const db = await createDatabase()
    const kept = keepPack(db, development, NOW)
    if (!kept.ok) throw new Error(kept.error)
    const unit = readFormat(db, 'unit')
    const milestone = readFormat(db, 'milestone')
    if (unit === undefined || milestone === undefined) throw new Error('no unit')
    const [m1] = insertRows(db, milestone, [{ ref: 'M1', title: 'A milestone', goal: 'One.', state: 'open', position: 1 }])
    insertRows(db, unit, [{ ref: 'M1 U1', milestone: m1 ?? null, scope: 'engine', title: 'A unit', state: 'planned' }])
    return db
  }

  it('updates a changed format’s notes and a changed view setting, and nothing else', async () => {
    const db = await keptToday()
    const before = { formats: listFormats(db), views: listViewSettings(db) }
    const pack = newer()

    const planned = planKeep(db, pack)
    if (!planned.ok) throw new Error(planned.error)
    expect(planned.value.notes).toEqual(['decision', 'unit'])
    expect(planned.value.settings).toEqual([
      { format: 'unit', view: 'entry', column: 'brief', from: 'markdown', to: 'line' },
      { format: 'unit', view: 'roadmap', column: 'branch', from: 'line', to: 'under' },
    ])
    expect(planned.value.settingsKept).toEqual([])
    expect(upToDate(planned.value)).toBe(false)
    expect(planParts(planned.value, false)).toEqual([
      'brings the notes of decision, unit to this build’s',
      'changes unit entry brief from markdown to line',
      'changes unit roadmap branch from line to under',
    ])

    const kept = keepPack(db, pack, NOW)
    if (!kept.ok) throw new Error(kept.error)
    const after = listFormats(db)
    expect(after.find((each) => each.name === 'unit')?.notes).toBe('A newer build says this about units. (unit)')
    for (const format of after.filter((each) => each.name !== 'unit' && each.name !== 'decision')) {
      expect(format, format.name).toEqual(before.formats.find((each) => each.name === format.name))
    }
    expect(after.find((each) => each.name === 'unit')?.columns).toEqual(
      before.formats.find((each) => each.name === 'unit')?.columns,
    )
    const changed = (each: { format: string; view: string; column: string }) =>
      each.format === 'unit' && ((each.view === 'entry' && each.column === 'brief') || (each.view === 'roadmap' && each.column === 'branch'))
    expect(listViewSettings(db).filter((each) => !changed(each))).toEqual(before.views.filter((each) => !changed(each)))
    expect(viewSettings(db, 'unit', 'entry').get('brief')).toBe('line')
    expect(viewSettings(db, 'unit', 'roadmap').get('branch')).toBe('under')
    const unit = after.find((each) => each.name === 'unit')
    expect(unit === undefined ? [] : listRows(db, unit).map((row) => row.cells['ref'])).toEqual(['M1 U1'])

    // And once it has, keeping it again changes nothing.
    const again = planKeep(db, pack)
    expect(again.ok && upToDate(again.value)).toBe(true)
    db.close()
  })

  it('never overwrites what the person changed, and says it kept it', async () => {
    const db = await keptToday()
    // The person shows a unit's brief as a figure, rewrites the decision notes
    // and clears the board's lanes (arrange_views and the sheet do the same).
    setEntryInput(db, 'unit', 'brief', 'figure')
    const decision = readFormat(db, 'decision')
    if (decision === undefined) throw new Error('no decision')
    adoptFormat(db, { ...decision, notes: 'My own notes.' }, NOW)
    setBoardLanes(db, 'unit', undefined)

    const pack = newer()
    const planned = planKeep(db, pack)
    if (!planned.ok) throw new Error(planned.error)
    expect(planned.value.notes).toEqual(['unit'])
    expect(planned.value.notesKept).toEqual(['decision'])
    expect(planned.value.settings).toEqual([
      { format: 'unit', view: 'roadmap', column: 'branch', from: 'line', to: 'under' },
    ])
    expect(planned.value.settingsKept).toEqual([
      { format: 'unit', view: 'board', column: 'state', from: undefined, to: 'lanes' },
      { format: 'unit', view: 'entry', column: 'brief', from: 'figure', to: 'line' },
    ])
    expect(keptParts(planned.value)).toEqual([
      'the notes of decision, which this document rewrote',
      'unit board state is none (the pack’s is lanes)',
      'unit entry brief is figure (the pack’s is line)',
    ])

    const kept = keepPack(db, pack, NOW)
    if (!kept.ok) throw new Error(kept.error)
    expect(readFormat(db, 'decision')?.notes).toBe('My own notes.')
    expect(viewSettings(db, 'unit', 'entry').get('brief')).toBe('figure')
    expect(boardSettings(db, 'unit').get('state')).toBeUndefined()
    expect(readFormat(db, 'unit')?.notes).toBe('A newer build says this about units. (unit)')
    // What is left is the person's alone, so the pack is up to date and still says it kept them.
    const again = planKeep(db, pack)
    if (!again.ok) throw new Error(again.error)
    expect(upToDate(again.value)).toBe(true)
    expect(keptParts(again.value)).toHaveLength(3)
    db.close()
  })

  it('adds a line the pack newly declares for a column the document already had', async () => {
    // A document kept before M51 U2 has `taken_by` and no `taken_by: card` on the board.
    const db = await keptToday()
    writeViewSettings(db, [{ format: 'unit', view: 'board', column: 'taken_by', setting: undefined }])
    const planned = planKeep(db, development)
    if (!planned.ok) throw new Error(planned.error)
    expect(planned.value.settings).toEqual([
      { format: 'unit', view: 'board', column: 'taken_by', from: undefined, to: 'card' },
    ])
    expect(planParts(planned.value, false)).toEqual(['sets unit board taken_by to card'])
    const kept = keepPack(db, development, NOW)
    if (!kept.ok) throw new Error(kept.error)
    expect(boardSettings(db, 'unit').get('taken_by')).toBe('card')
    db.close()
  })

  it('finds docs/memory.emd up to date with this build', async () => {
    const { db } = await openEncoded(readFileSync(MEMORY))
    const planned = planKeep(db, development)
    if (!planned.ok) throw new Error(planned.error)
    expect(planParts(planned.value, false)).toEqual([])
    expect(keptParts(planned.value)).toEqual([])
    db.close()
  })
})
