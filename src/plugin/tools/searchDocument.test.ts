import { writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { installDevelopmentPack } from '@/data/packs/development/pack.ts'
import { listFormats, saveFormat } from '@/data/repositories/formatRepository.ts'
import { exportEncoded, type DocumentEncoding } from '@/data/storage/encoding.ts'

import { deleteFormatRowsTool, formatRowsTool, recordFormatRowsTool } from './formats.ts'
import { searchDocumentTool } from './searchDocument.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * **A search across the whole document, and the scan before it is shared** —
 * M47 U6. A project's memory with a made-up address, a made-up note and a
 * made-up account name spread over three formats and a format's own notes, the
 * way the real one was before it was committed: one call names every row.
 */

const NOW = Date.UTC(2026, 9, 13)
const ADDRESS = '12 Example Lane'
const ACCOUNT = 'Old Sample Account'

async function memory(encoding: DocumentEncoding, note?: string): Promise<string> {
  const db = await createDatabase()
  const installed = installDevelopmentPack(db, NOW)
  if (!installed.ok) throw new Error(installed.error)
  // A format's own notes, which no tool writes but a person's editor does.
  if (note !== undefined) {
    const milestone = listFormats(db).find((each) => each.name === 'milestone')
    if (milestone === undefined) throw new Error('no milestone format')
    saveFormat(db, { ...milestone, notes: `${milestone.notes ?? ''}${note}` }, NOW)
  }
  const bytes = await exportEncoded(db, encoding)
  db.close()
  if (!bytes.ok) throw new Error(bytes.error)
  const path = `${(await tempDir('emerald-search-')).replace(/\\/g, '/')}/memory.emd`
  await writeFile(path, bytes.value)
  const record = async (format: string, rows: readonly Record<string, unknown>[]): Promise<void> => {
    const said = await recordFormatRowsTool.run({ path, format, rows, commit: true }, NO_CLIENT)
    expect(said).toMatch(/added/i)
  }
  await record('milestone', [
    { ref: 'M1', title: 'Move the files', goal: `Everything off the box at ${ADDRESS}`, state: 'open', position: 1 },
    { ref: 'M2', title: 'Nothing here', goal: 'Plain', state: 'planned', position: 2 },
  ])
  await record('unit', [
    { ref: 'M1 U1', milestone: 'M1', scope: 'engine', title: `Close ${ACCOUNT}`, state: 'planned', brief: `Mail goes to ${ADDRESS.toUpperCase()}.` },
    { ref: 'M1 U2', milestone: 'M1', scope: 'engine', title: 'Unrelated', state: 'planned' },
  ])
  await record('decision', [
    {
      ref: 'D-1',
      date: '2026-10-01',
      milestone: 'M1',
      scope: 'engine',
      title: 'Keep the old name out',
      question: `Is ${ACCOUNT} still used?`,
      answer: 'No.',
      state: 'live',
    },
  ])
  await record('inbox', [{ subject: `${ACCOUNT} is closed`, from: 'a person', sent_on: '2026-10-02', state: 'new' }])
  return path
}

describe('search_document (M47 U6)', () => {
  for (const encoding of ['text', 'sqlite'] as const) {
    it(`names every row and column that holds any term, by format — a ${encoding} document`, async () => {
      const path = await memory(encoding)
      const answer = await searchDocumentTool.run({ path, terms: ['example lane', ACCOUNT, 'not anywhere'] }, NO_CLIENT)

      expect(answer).toMatch(/^Searched for “example lane”, “Old Sample Account”, “not anywhere”: 4 rows in 4 formats hold them\./)
      // Each hit by format, row and the column that holds it, with the text around it.
      expect(answer).toContain('## Milestone (`milestone`) — 1 row')
      expect(answer).toMatch(/\| M1 \| goal \| example lane \| Everything off the box at 12 Example Lane \|/)
      expect(answer).toContain('## Unit (`unit`) — 1 row')
      expect(answer).toMatch(/\| M1 U1 \| title \| Old Sample Account \| Close Old Sample Account \|/)
      expect(answer).toMatch(/\| Old Sample Account is closed \| subject \| Old Sample Account \|/)
      // Case folds, as format_rows' search does.
      expect(answer).toMatch(/\| ″ \| brief \| example lane \| Mail goes to 12 EXAMPLE LANE\. \|/)
      expect(answer).toMatch(/\| D-1 \| question \| Old Sample Account \|/)
      expect(answer).toContain('Not found: “not anywhere”.')
      // A row that only links to a hit is not one: M1 U2 names M1 and holds nothing.
      expect(answer).not.toContain('Unrelated')
    })
  }

  it('reads past the rows: a format’s own notes are counted, not shown', async () => {
    const path = await memory('text', ` Kept at ${ADDRESS}.`)
    const answer = await searchDocumentTool.run({ path, terms: [ADDRESS] }, NO_CLIENT)
    expect(answer).toContain('## Beyond the rows')
    expect(answer).toMatch(/\| format \| notes \| 1 \| 12 Example Lane \| milestone \|/)
  })

  it('says so when nothing holds a term', async () => {
    const path = await memory('text')
    expect(await searchDocumentTool.run({ path, terms: ['zzz'] }, NO_CLIENT)).toMatch(
      /^Nothing in this document holds “zzz” — \d+ formats and the rest of the file searched\.$/,
    )
  })

  it('refuses both forms at once, neither, and an empty list', async () => {
    const path = await memory('text')
    await expect(searchDocumentTool.run({ path }, NO_CLIENT)).rejects.toThrow(/one of the two/)
    await expect(searchDocumentTool.run({ path, terms: ['a'], denylist: path }, NO_CLIENT)).rejects.toThrow(/one of the two/)
    await expect(searchDocumentTool.run({ path, terms: ['  '] }, NO_CLIENT)).rejects.toThrow(/nothing to look for/)
    await expect(searchDocumentTool.run({ path, denylist: 'relative.txt' }, NO_CLIENT)).rejects.toThrow(/absolute/)
  })
})

describe('search_document with a denylist — the scan before sharing (M47 U6)', () => {
  async function denylist(lines: readonly string[]): Promise<string> {
    const file = `${(await tempDir('emerald-denylist-')).replace(/\\/g, '/')}/denylist.txt`
    await writeFile(file, lines.join('\n'))
    return file
  }

  it('returns hits only: where, by denylist line, and never the value', async () => {
    const path = await memory('text')
    const list = await denylist(['# a comment', `${ADDRESS}==>an address`, 'regex:Old Sample \\w+==>an account', 'absent term==>x'])
    const answer = await searchDocumentTool.run({ path, denylist: list }, NO_CLIENT)

    expect(answer).toMatch(/^Scanned with the 3 terms of .*denylist\.txt: 4 rows in 4 formats hold one\./)
    expect(answer).toMatch(/\| M1 \| goal \| line 2 \|/)
    // The row's name is a hit, so the row is not named by it.
    expect(answer).toMatch(/\| \(its name is a hit\) \| subject \| line 3 \|/)
    expect(answer).toMatch(/\| M1 U1 \| title \| line 3 \|/)
    expect(answer).toContain('Not found: line 4.')
    // Case is kept, as filter-repo keeps it: the upper-cased brief is not a hit.
    expect(answer).not.toMatch(/\| brief \|/)
    // Nothing the list guards is repeated.
    expect(answer).not.toContain(ADDRESS)
    expect(answer).not.toContain(ACCOUNT)
  })

  it('says a clean document is clean', async () => {
    const path = await memory('text')
    const answer = await searchDocumentTool.run({ path, denylist: await denylist(['never in it==>x']) }, NO_CLIENT)
    expect(answer).toMatch(/^Clean: nothing in this document holds any of the 1 term of /)
  })

  it('finds a deleted value still in the bytes of a document stored as SQLite bytes', async () => {
    const path = await memory('sqlite')
    const rows = await formatRowsTool.run({ path, format: 'decision', columns: ['ref'] }, NO_CLIENT)
    const id = /\| ([0-9a-f-]{36}) \| D-1 \|/.exec(rows)?.[1]
    expect(id).toBeDefined()
    const removed = await deleteFormatRowsTool.run({ path, format: 'decision', ids: [id], commit: true }, NO_CLIENT)
    expect(removed).toMatch(/removed/i)

    const answer = await searchDocumentTool.run(
      { path, denylist: await denylist(['Is Old Sample Account still used==>x']) },
      NO_CLIENT,
    )
    expect(answer).toMatch(/In the file but in no value it holds: line 1\./)
  })

  it('rejects a pattern that does not parse, by its line', async () => {
    const path = await memory('text')
    await expect(
      searchDocumentTool.run({ path, denylist: await denylist(['ok==>x', 'regex:(unclosed==>x']) }, NO_CLIENT),
    ).rejects.toThrow(/line 2 is not a pattern/)
  })
})
