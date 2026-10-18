import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase } from '@/data/db/database.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'

import { guideStatusTool } from './guide.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

describe('guide_status (S7)', () => {
  it('lists the seven places, what is done, and the tool that does each', async () => {
    const path = join(await tempDir('emerald-guide-'), 'new.emd')
    const db = await createLedgerDatabase()
    await writeFile(path, exportDatabase(db))
    db.close()

    const text = await guideStatusTool.run({ path }, NO_CLIENT)
    expect(text).toContain('0 of 7 places done. Next: **Drop statements, paychecks and fund reports here**')
    expect(text).toContain('`import_statement`')
    expect(text).toContain('`create_category` and `edit_categories`')
    expect(text).toContain('fills once a statement is read')
    expect(text).toContain('nothing to advance')
  })
})
