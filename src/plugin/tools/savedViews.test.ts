/**
 * **Saved views** — M53 U5, D-514, D-520.
 *
 * The done-test: *Due today* saved on the synthetic task format as the screen
 * saves it, listed with the format's views, and drawn by `show_format
 * view:"Due today"` tomorrow with tomorrow's rows — the window kept as its
 * phrase, never a fixed date; and a conversation saving *Open by project*,
 * which the screen then reads. Renamed, deleted, refused by name, and carried
 * by a text document.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { deleteFormat } from '@/data/repositories/formatRepository.ts'
import { savedViews, saveView } from '@/data/repositories/formatViewRepository.ts'
import { openEncoded } from '@/data/storage/encoding.ts'
import { canonicalAddress, filterAddress } from '@/ui/formats/addressFilter.ts'
import { savedNow } from '@/ui/formats/savedView.ts'

import { declareFormatTool, formatRowsTool, formatsTool, recordFormatRowsTool } from './formats.ts'
import { showFormatTool } from './sheet.ts'
import { storeDocumentAsTool } from './storeAs.ts'
import { NO_CLIENT } from './tool.ts'
import { arrangeViewsTool } from './views.ts'
import { tempDir } from '../../testing/tempDir'

const TASK = {
  format: 'task',
  title: 'Task',
  columns: [
    { name: 'title', type: 'text', required: true },
    { name: 'due', type: 'date' },
    { name: 'state', type: 'enum', values: ['open', 'done'] },
    { name: 'project', type: 'text' },
  ],
  nothing_must_hold: true,
}

const ROWS = [
  { title: 'Call the bank', due: '2026-10-22', state: 'open', project: 'Home' },
  { title: 'Ship the release', due: '2026-10-23', state: 'open', project: 'Work' },
  { title: 'Book the dentist', due: '2026-10-23', state: 'done', project: 'Home' },
  { title: 'Write the review', due: '2026-10-30', state: 'open', project: 'Work' },
]

/** The clock, pinned: the calendar day here is `day`. */
function pin(day: string): void {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  vi.setSystemTime(new Date(year, month - 1, date, 9, 30))
}

async function tasks(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-saved-'), 'tasks.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  expect(await declareFormatTool.run({ path, formats: [TASK], commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  expect(await recordFormatRowsTool.run({ path, format: 'task', rows: ROWS, commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  return path
}

/** The screen's half: what *Save this view* writes, from the address on screen. */
async function saveOnScreen(path: string, name: string, kind: 'list' | 'table', address: string): Promise<void> {
  const db = await openDatabase(readFileSync(path))
  saveView(db, { format: 'task', name, kind, address: canonicalAddress(address) })
  await writeFile(path, exportDatabase(db))
  db.close()
}

async function savedIn(path: string) {
  const { db } = await openEncoded(readFileSync(path))
  const views = savedViews(db, 'task')
  db.close()
  return views
}

function titles(text: string): readonly string[] {
  return ROWS.map((row) => row.title).filter((title) => text.includes(title))
}

describe('saved views (M53 U5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    pin('2026-10-22')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps “due today” as the phrase, so tomorrow draws tomorrow’s rows', async () => {
    const path = await tasks()
    await saveOnScreen(path, 'Due today', 'list', filterAddress({ match: { due: 'today' } }))
    const views = await savedIn(path)
    expect(views).toEqual([{ format: 'task', name: 'Due today', kind: 'list', address: '?due=today' }])
    // The band says *Saved as Due today* on that address, and on no other kind.
    expect(savedNow(views, 'list', '?due=today')?.name).toBe('Due today')
    expect(savedNow(views, 'table', '?due=today')).toBeUndefined()

    expect(titles(await showFormatTool.run({ path, format: 'task', view: 'Due today' }, NO_CLIENT))).toEqual(['Call the bank'])
    pin('2026-10-23')
    const tomorrow = await showFormatTool.run({ path, format: 'task', view: 'Due today' }, NO_CLIENT)
    expect(tomorrow).toContain('The saved view Due today: list')
    expect(titles(tomorrow)).toEqual(['Ship the release', 'Book the dentist'])
    const rows = await formatRowsTool.run({ path, format: 'task', view: 'Due today', columns: ['title'] }, NO_CLIENT)
    expect(titles(rows)).toEqual(['Ship the release', 'Book the dentist'])
    expect(rows).toContain('in the saved view Due today')
    // A match given beside it adds to the view's.
    const open = await formatRowsTool.run({ path, format: 'task', view: 'Due today', match: { state: 'open' } }, NO_CLIENT)
    expect(titles(open)).toEqual(['Ship the release'])
  })

  it('saves one from a conversation, and the screen reads it', async () => {
    const path = await tasks()
    const settings = [
      { format: 'task', view: 'saved', name: 'Open by project', kind: 'list', match: { state: { not: 'done' } }, order: 'due' },
    ]
    const dry = await arrangeViewsTool.run({ path, settings }, NO_CLIENT)
    expect(dry).toContain('Open by project')
    expect(await savedIn(path)).toEqual([])
    await arrangeViewsTool.run({ path, settings, commit: true }, NO_CLIENT)
    const [kept] = await savedIn(path)
    expect(kept?.kind).toBe('list')
    expect(kept?.address).toBe(canonicalAddress('?state!=done&order:due=ascending'))
    expect(savedNow(await savedIn(path), 'list', '?order:due=ascending&state!=done')?.name).toBe('Open by project')

    const drawn = await showFormatTool.run({ path, format: 'task', view: 'Open by project' }, NO_CLIENT)
    expect(titles(drawn)).toEqual(['Call the bank', 'Ship the release', 'Write the review'])
    expect(await formatsTool.run({ path, format: 'task' }, NO_CLIENT)).toContain('`Open by project` (list')
  })

  it('renames and deletes one, and refuses what it cannot keep, by name', async () => {
    const path = await tasks()
    await arrangeViewsTool.run({ path, settings: [{ format: 'task', view: 'saved', name: 'Mine', match: { project: 'Home' } }], commit: true }, NO_CLIENT)
    await arrangeViewsTool.run({ path, settings: [{ format: 'task', view: 'saved', name: 'Mine', rename: 'Home' }], commit: true }, NO_CLIENT)
    expect((await savedIn(path)).map((each) => each.name)).toEqual(['Home'])

    const refused = await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'task', view: 'saved', name: 'Odd', match: { colour: 'red' } },
          { format: 'task', view: 'saved', name: 'list' },
          { format: 'task', view: 'saved', name: 'Gone', delete: true },
          { format: 'task', view: 'saved', name: 'Old', kind: 'roadmap' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(refused).toContain('Nothing was written')
    expect(refused).toContain('colour')
    expect(refused).toContain('a view’s own name')
    expect(refused).toContain('no saved view called Gone')
    expect(refused).toContain('task has no roadmap')
    await expect(showFormatTool.run({ path, format: 'task', view: 'Nowhere' }, NO_CLIENT)).rejects.toThrow(/Its saved views: Home/)

    await arrangeViewsTool.run({ path, settings: [{ format: 'task', view: 'saved', name: 'Home', delete: true }], commit: true }, NO_CLIENT)
    expect(await savedIn(path)).toEqual([])
  })

  it('travels in a text document’s views part, and goes with its format', async () => {
    const path = await tasks()
    await saveOnScreen(path, 'Due within a week', 'table', '?due=within+7+days&order:due=descending')
    const stored = await storeDocumentAsTool.run({ path, as: 'text', commit: true }, NO_CLIENT)
    expect(stored).not.toMatch(/refus/i)
    const text = readFileSync(path, 'utf8')
    expect(text).toContain('### task saved\nname: Due within a week\nkind: table\naddress: ')
    expect(await savedIn(path)).toEqual([
      { format: 'task', name: 'Due within a week', kind: 'table', address: canonicalAddress('?due=within+7+days&order:due=descending') },
    ])

    const { db } = await openEncoded(readFileSync(path))
    deleteFormat(db, 'task')
    expect(savedViews(db)).toEqual([])
    db.close()
  })
})
