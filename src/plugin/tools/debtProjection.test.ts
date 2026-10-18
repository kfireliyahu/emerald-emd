import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase } from '@/data/db/database.ts'
import { createDebt } from '@/data/repositories/debtRepository.ts'

import { NO_CLIENT } from './tool.ts'
import { debtProjectionTool } from './wealth.ts'
import { tempDir } from '../../testing/tempDir'

describe('debt_projection', () => {
  it('says what each debt has left by plain addition, and says there is no interest', async () => {
    const db = await createLedgerDatabase()
    createDebt(
      db,
      {
        name: 'Car loan',
        kind: 'BANK_LOAN',
        principalAmount: money(1_000_000, 'ILS'),
        openedDate: localDate(2026, 1, 1),
        monthlyPaymentAmount: money(100_000, 'ILS'),
      },
      1,
    )
    const path = join(await tempDir('emerald-debtproj-'), 'doc.emd')
    await writeFile(path, exportDatabase(db))
    db.close()

    const text = await debtProjectionTool.run({ path, months: 3 }, NO_CLIENT)
    expect(text).toContain('Car loan')
    expect(text).toContain('7,000.00')
    expect(text).toContain('no interest is counted')
  })

  it('answers plainly for a document with no debts', async () => {
    const db = await createLedgerDatabase()
    const path = join(await tempDir('emerald-debtproj-'), 'doc.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    expect(await debtProjectionTool.run({ path }, NO_CLIENT)).toContain('no open debts')
  })
})
