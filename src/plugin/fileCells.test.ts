import { mkdir, rename, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { exportEncoded } from '@/data/storage/encoding.ts'

import { declareFormatTool, formatRowsTool, recordFormatRowsTool, updateFormatRowsTool } from './tools/formats.ts'
import { NO_CLIENT } from './tools/tool.ts'
import { tempDir } from '../testing/tempDir'

/**
 * **A file on this computer, from a conversation** — M37 U6's done-test: a
 * format with a file column, a row pointing at a made-up file beside the
 * document, kept relative so the folder can move; a missing file says so; a
 * web address is refused with the reason.
 */

async function emptyDocument(path: string): Promise<void> {
  const db = await createDatabase()
  const bytes = await exportEncoded(db, 'sqlite')
  db.close()
  if (!bytes.ok) throw new Error(bytes.error)
  await writeFile(path, bytes.value)
}

describe('a file column through the conversation (M37 U6)', () => {
  it('stores a file under the document’s folder beside it, reads missing when it goes, and refuses the web', async () => {
    const root = (await tempDir('emerald-file-')).replace(/\\/g, '/')
    await mkdir(`${root}/plans/scans`, { recursive: true })
    const path = `${root}/plans/plans.emd`
    await emptyDocument(path)
    await writeFile(`${root}/plans/scans/receipt.txt`, 'a made-up receipt')

    const declared = await declareFormatTool.run(
      {
        path,
        format: 'receipt',
        title: 'Receipt',
        columns: [
          { name: 'shop', type: 'text', required: true },
          { name: 'scan', type: 'file' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(declared).toContain('is declared')

    const recorded = await recordFormatRowsTool.run(
      {
        path,
        format: 'receipt',
        rows: [
          { shop: 'Corner shop', scan: `${root}/plans/scans/receipt.txt`.replace(/\//g, '\\') },
          { shop: 'Market', scan: 'scans/gone.txt' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(recorded).toContain('2 rows added')

    const read = await formatRowsTool.run({ path, format: 'receipt' }, NO_CLIENT)
    expect(read).toContain('scans/receipt.txt')
    expect(read).not.toContain(`${root}/plans/scans/receipt.txt`)
    expect(read).not.toMatch(/receipt\.txt · missing/)
    expect(read).toContain('scans/gone.txt · missing')

    // The folder moves, with its document and its scans: the link holds.
    await rename(`${root}/plans`, `${root}/moved`)
    const moved = await formatRowsTool.run({ path: `${root}/moved/plans.emd`, format: 'receipt' }, NO_CLIENT)
    expect(moved).toContain('scans/receipt.txt')
    expect(moved).not.toMatch(/receipt\.txt · missing/)

    const web = await recordFormatRowsTool.run(
      { path: `${root}/moved/plans.emd`, format: 'receipt', rows: [{ shop: 'Online', scan: 'https://example.com/r.pdf' }], commit: true },
      NO_CLIENT,
    )
    expect(web).toContain('opening one is a request — Emerald makes none')

    const edited = await updateFormatRowsTool.run(
      {
        path: `${root}/moved/plans.emd`,
        format: 'receipt',
        edits: [{ where: { shop: 'Market' }, values: { scan: `${root}/moved/scans/receipt.txt` } }],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(edited).not.toContain('must')
    const after = await formatRowsTool.run({ path: `${root}/moved/plans.emd`, format: 'receipt' }, NO_CLIENT)
    expect(after).not.toContain('gone.txt')
    expect(after).not.toContain('missing')
  })
})
