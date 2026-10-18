import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { installDevelopmentPack } from '@/data/packs/development/pack.ts'
import { ledgerFormatNames } from '@/data/packs/ledger/pack.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { formatPlacesOf } from '@/ui/formats/places.ts'
import { FORMATS_PATH, railSections } from '@/ui/nav.ts'
import { formatsByPack, keepsLedger, keptPacks, packRails, showingOf } from './packs.ts'

/**
 * Which packs are showing — M25 U8, which took M20 U0's switch away (D-228).
 *
 * The rail follows the open document, and nothing else: no flag on the
 * machine, nothing written into the file to say it.
 */
describe('the ledger at the front door', () => {
  it('shows for a document that keeps a ledger', async () => {
    expect(keepsLedger(await createLedgerDatabase())).toBe(true)
  })

  it('does not for one that never did, nor with nothing open', async () => {
    expect(keepsLedger(await createDatabase())).toBe(false)
    expect(keepsLedger(undefined)).toBe(false)
  })
})

/**
 * **A pack's formats sit under the pack, and a person's own first** — M33 F3.
 * 2026-10-07: *"so user would be able to find his own easily"*.
 */
describe('whose each format is', () => {
  const NOW = Date.UTC(2026, 9, 7)
  const own = (name: string, title: string): FormatDeclaration => ({
    language: DECLARATION_LANGUAGE,
    name,
    title,
    notes: '',
    columns: [column('name', 'text', { required: true })],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  })

  async function both() {
    const db = await createLedgerDatabase()
    const installed = installDevelopmentPack(db, NOW)
    if (!installed.ok) throw new Error(installed.error)
    for (const format of [own('ingredient', 'Ingredient'), own('recipe', 'Recipe')]) {
      expect(adoptFormat(db, format, NOW).refusals).toEqual([])
    }
    return db
  }

  it('puts the person’s two first in the rail, and every ledger format under the ledger', async () => {
    const db = await both()
    const kept = keptPacks(db)
    expect([...kept].sort()).toEqual(['development', 'ledger'])
    const rail = railSections(showingOf(kept), formatPlacesOf(db), packRails(kept))
    const children = rail.find((section) => section.to === FORMATS_PATH)?.children ?? []
    expect(children.slice(0, 2).map((child) => [child.label, child.group])).toEqual([
      ['Ingredient', undefined],
      ['Recipe', undefined],
    ])
    const rest = children.slice(2)
    expect(rest.length).toBe(ledgerFormatNames().size)
    for (const child of rest) expect(child.group).toBe('The ledger')
    // The development pack draws a section of its own, and its formats are in it.
    const development = rail.find((section) => section.label === 'Development')
    for (const name of ['decision', 'unit', 'milestone', 'open_question', 'review_entry', 'inbox']) {
      expect(development?.children?.some((child) => child.to === `/formats/${name}`)).toBe(true)
      expect(children.some((child) => child.to === `/formats/${name}`)).toBe(false)
    }
  })

  it('groups the same way for the Formats page: own first, then each pack by its name', async () => {
    const db = await both()
    const grouped = formatsByPack(formatPlacesOf(db), keptPacks(db), (each) => each.name)
    expect(grouped.own.map((each) => each.name)).toEqual(['ingredient', 'recipe'])
    expect(grouped.packs.map((group) => group.title)).toEqual(['The ledger', 'Development'])
    expect(grouped.packs[1]?.formats.map((each) => each.name).sort()).toEqual(
      ['decision', 'inbox', 'milestone', 'open_question', 'review_entry', 'unit'],
    )
  })

  it('leaves a person’s own `account` theirs in a document that keeps no ledger', async () => {
    const db = await createDatabase()
    expect(adoptFormat(db, own('account', 'Account'), NOW).refusals).toEqual([])
    const grouped = formatsByPack(formatPlacesOf(db), keptPacks(db), (each) => each.name)
    expect(grouped.own.map((each) => each.name)).toEqual(['account'])
    expect(grouped.packs).toEqual([])
  })
})
