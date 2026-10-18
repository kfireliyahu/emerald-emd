import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { installLedgerPack } from '@/data/packs/ledger/pack.ts'
import { adoptFormat, deleteFormat, readFormat } from '@/data/repositories/formatRepository.ts'
import { listPlanMonths, listSplitBuckets, createSplitBucket } from '@/data/repositories/splitPlanRepository.ts'

import { readDocument } from './document.ts'
import { writeDocument } from './write.ts'
import { tempDir } from '../testing/tempDir'

/**
 * **A conversation brings a document up to date itself** (M36 U02, D-378).
 *
 * A ledger written before the pack's latest growth — here, before `plan_month`
 * (M31 U4) and before a bucket could point at a fund or an account (D-319) —
 * and never opened in the app since. The plugin used to read it through probes
 * and second paths, and refuse what those could not cover.
 */
async function olderLedger(name: string): Promise<string> {
  const db = await createDatabase()
  installLedgerPack(db, 1)
  deleteFormat(db, 'plan_month')
  const held = readFormat(db, 'split_bucket')
  if (held === undefined) throw new Error('the ledger lost split_bucket')
  const newer = (name: string): boolean => name === 'target_holding' || name === 'target_account'
  const older = {
    ...held,
    columns: held.columns.filter((one) => !newer(one.name)),
    constraints: (held.constraints ?? []).map((one) =>
      one.kind === 'AT_MOST_ONE' ? { ...one, columns: one.columns.filter((each) => !newer(each)) } : one,
    ),
  }
  if (adoptFormat(db, older, 1).refusals.length > 0) throw new Error('could not make the older shape')
  const path = join(await tempDir('emerald-up-to-date-'), name)
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

describe('a plugin open brings the pack up to date (D-378)', () => {
  it('takes a write with no app open, and saves the pack with the change', async () => {
    const path = await olderLedger('older.emd')

    const answer = await writeDocument(path, (document) => {
      createSplitBucket(document.db, { name: 'Free', targetKind: 'FREE' }, 1)
      return `${String(listSplitBuckets(document.db).length)} bucket, ${String(listPlanMonths(document.db).size)} months`
    })
    expect(answer).toBe('1 bucket, 0 months')

    const after = await readDocument(path, (document) =>
      [
        readFormat(document.db, 'plan_month') === undefined ? 'no plan_month' : 'plan_month',
        readFormat(document.db, 'split_bucket')?.columns.some((one) => one.name === 'target_holding') === true
          ? 'target_holding'
          : 'no target_holding',
        String(listSplitBuckets(document.db).length),
      ].join(' '),
    )
    expect(after).toBe('plan_month target_holding 1')
  })

  it('reads it up to date in memory, and leaves the file as it was', async () => {
    const path = await olderLedger('read.emd')
    const before = await readFile(path)

    const answer = await readDocument(path, (document) =>
      readFormat(document.db, 'plan_month') === undefined ? 'old' : `months: ${String(listPlanMonths(document.db).size)}`,
    )
    expect(answer).toBe('months: 0')
    expect(Buffer.compare(await readFile(path), before)).toBe(0)
  })
})
