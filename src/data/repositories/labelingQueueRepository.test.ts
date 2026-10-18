import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '../db/database.ts'
import {
  readSkipped,
  skipAll,
  skipMerchant,
  unskipMerchant,
} from './labelingQueueRepository.ts'

const skippedMerchants = (db: Database): readonly string[] => [...readSkipped(db).keys()]

describe('the labeling queue’s skips', () => {
  it('remembers a name and when it was set aside', async () => {
    const db = await createLedgerDatabase()
    skipMerchant(db, 'העברה 0123456789', 1000)

    expect(readSkipped(db).get('העברה 0123456789')).toBe(1000)
  })

  it('puts one back, because a skip is a decision and not a deletion', async () => {
    const db = await createLedgerDatabase()
    skipMerchant(db, 'א', 1000)
    unskipMerchant(db, 'א', 2000)

    expect(skippedMerchants(db)).toEqual([])
  })

  it('skips the whole queue in one action and counts what was new', async () => {
    // docs/f06: "the whole queue is skippable in one action".
    const db = await createLedgerDatabase()
    skipMerchant(db, 'א', 1000)

    expect(skipAll(db, ['א', 'ב', 'ג'], 2000)).toBe(2)
    expect([...skippedMerchants(db)].sort()).toEqual(['א', 'ב', 'ג'])
    // The one already skipped keeps its original timestamp, so "skipped in
    // June" does not become "skipped today" every time the button is pressed.
    expect(readSkipped(db).get('א')).toBe(1000)
  })

  it('survives a round trip through the file', async () => {
    const db = await createLedgerDatabase()
    skipMerchant(db, 'א', 1000)

    expect(skippedMerchants(await openDatabase(exportDatabase(db)))).toEqual(['א'])
  })

  it('reads a mangled setting as nothing skipped rather than throwing', async () => {
    // The document is a real SQLite file the user can edit by hand.
    const db = await createLedgerDatabase()
    skipMerchant(db, 'א', 1000)
    db.run("UPDATE fmt_setting SET value = 'not json' WHERE key = 'labeling.skipped'")

    expect(skippedMerchants(db)).toEqual([])
  })
})
