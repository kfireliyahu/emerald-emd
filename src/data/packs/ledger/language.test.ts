import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { localDate } from '@/core/time.ts'
import { starterShareOf } from '@/domain/starterPlan.ts'
import { createDatabase, openDatabase } from '../../db/database.ts'
import { starterHeadings } from '../../repositories/categoryBudgetRepository.ts'
import { readFormat } from '../../repositories/formatRepository.ts'
import { listRows } from '../../repositories/formatRowRepository.ts'
import { listSeeds } from '../../repositories/formatSeedRepository.ts'
import { bringUpToDate, keepPack, packById } from '../packs.ts'
import { installLedgerPack, ledgerLanguageOf } from './pack.ts'
import SEEDED_IDS from './seededIds.json'
import SEEDED_HEBREW from './seededIds.he.json'

/**
 * **A ledger made in Hebrew gets Hebrew category names, and one made before
 * keeps its own** — M60 U6, D-587 (D-583 point 6, D-576).
 */

const NOW = Date.UTC(2026, 10, 11)
const LEDGER = packById('ledger')
if (LEDGER === undefined) throw new Error('no ledger pack')

/** Every category as id → name and the parent's id, which is what a rule, a plan and the starter read. */
function categories(db: Database): Map<string, { name: unknown; parent: unknown }> {
  const category = readFormat(db, 'category')
  if (category === undefined) throw new Error('no category')
  return new Map(listRows(db, category).map((row) => [row.id, { name: row.cells['name'], parent: row.cells['parent'] }]))
}

/** Everything a reopen could change: every row of the pack's seeded formats, and the seed records. */
function snapshot(db: Database): unknown {
  return {
    rows: ['category', 'category_rule', 'institution', 'deduction_type', 'institution_alias'].map((name) => {
      const declared = readFormat(db, name)
      return declared === undefined ? [] : listRows(db, declared).map((row) => [row.id, row.cells])
    }),
    seeds: listSeeds(db),
  }
}

async function made(language: 'en' | 'he'): Promise<Database> {
  const db = await createDatabase()
  const installed = installLedgerPack(db, NOW, language)
  if (!installed.ok) throw new Error(installed.error)
  return db
}

describe('a new ledger made in Hebrew', () => {
  it('names every seeded category in Hebrew, under the ids an English one has', async () => {
    const hebrew = categories(await made('he'))
    const english = categories(await made('en'))
    expect([...hebrew.keys()].sort()).toEqual([...english.keys()].sort())
    for (const [id, { name, parent }] of hebrew) {
      expect(name, id).toBe((SEEDED_HEBREW.category as Record<string, string>)[id])
      expect(parent, id).toBe(english.get(id)?.parent)
    }
    expect(ledgerLanguageOf(await made('he'))).toBe('he')
  })

  it('takes each name from the sheet the maintainer passed, intact', () => {
    const sheet = readFileSync(fileURLToPath(new URL('../../../../docs/mockups/m60-u2/glossary.md', import.meta.url)), 'utf8')
    const section = sheet.slice(sheet.indexOf("## The ledger's seeded categories"))
    const rows = new Map(
      section
        .split('\n')
        .filter((line) => line.startsWith('| ') && !line.startsWith('| English'))
        .map((line) => line.split('|').map((cell) => cell.trim()))
        .map(([, english = '', hebrew = '']) => [english.replace(/ \(under Insurance\)$/, ''), hebrew]),
    )
    const english: Readonly<Record<string, string>> = SEEDED_IDS.category
    const hebrew: Readonly<Record<string, string>> = SEEDED_HEBREW.category
    expect(Object.keys(hebrew).sort()).toEqual(Object.keys(english).sort())
    for (const [id, name] of Object.entries(english)) expect(hebrew[id], id).toBe(rows.get(name))
    // One read back by its code points, so an encoding slip cannot pass as Hebrew.
    expect(hebrew['cat:utilities']).toBe('חשבונות שוטפים')
    expect(new Set(Object.values(hebrew)).size).toBe(Object.keys(hebrew).length)
  })

  it('links the built-in rules to the same categories', async () => {
    const targets = (db: Database): unknown => {
      const rules = readFormat(db, 'category_rule')
      if (rules === undefined) throw new Error('no category_rule')
      return listRows(db, rules).map((row) => [row.id, row.cells['target']]).sort()
    }
    const hebrew = targets(await made('he'))
    expect(hebrew).toEqual(targets(await made('en')))
    expect((hebrew as unknown[]).length).toBeGreaterThan(0)
  })

  it('places its headings in the 50 / 30 / 20 starter as an English one does', async () => {
    const shares = async (language: 'en' | 'he'): Promise<unknown> =>
      starterHeadings(await made(language), localDate(2026, 11, 11), 'ILS').map((one) => [one.id, starterShareOf(one)])
    expect(await shares('he')).toEqual(await shares('en'))
  })

  it('stays Hebrew when the app is in English, and is given no English tree', async () => {
    const db = await made('he')
    const before = snapshot(db)
    const again = installLedgerPack(db, NOW, 'en')
    if (!again.ok) throw new Error(again.error)
    expect(again.value.seeded.get('category')?.added).toEqual([])
    expect(bringUpToDate(db, NOW).ok).toBe(true)
    const kept = keepPack(db, LEDGER, NOW, 'en')
    expect(kept.ok).toBe(true)
    expect(snapshot(db)).toEqual(before)
  })
})

describe('a ledger made by the build before M60 U6 (D-576)', () => {
  // Made by `create_document` with `packs: ["ledger"]` on the build at e3f6231,
  // stored as SQLite bytes — a ledger cannot be stored as text yet (D-246).
  const fixture = (): Uint8Array =>
    gunzipSync(readFileSync(fileURLToPath(new URL('../../../../fixtures/synthetic/ledger-before-m60-u6.emd.gz', import.meta.url))))

  it('opens in Hebrew with its names and rows unchanged', async () => {
    const db = await openDatabase(fixture())
    expect(ledgerLanguageOf(db)).toBe('en')
    const english: Readonly<Record<string, string>> = SEEDED_IDS.category
    for (const [id, { name }] of categories(db)) expect(name, id).toBe(english[id])

    const before = snapshot(db)
    const reopened = bringUpToDate(db, NOW)
    expect(reopened.ok).toBe(true)
    const kept = keepPack(db, LEDGER, NOW, 'he')
    expect(kept.ok).toBe(true)
    const installed = installLedgerPack(db, NOW, 'he')
    if (!installed.ok) throw new Error(installed.error)
    expect(installed.value.seeded.get('category')?.added).toEqual([])
    expect(snapshot(db)).toEqual(before)
  })

  it('keeps English when a person renamed every category the pack recorded', async () => {
    const db = await openDatabase(fixture())
    db.run('DELETE FROM format_seed WHERE format_name = ?', ['category'])
    expect(ledgerLanguageOf(db)).toBe('en')
  })
})
