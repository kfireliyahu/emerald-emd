import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { adoptFormat, listFormats, readFormat } from '@/data/repositories/formatRepository.ts'
import { insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { viewSettings } from '@/data/repositories/formatViewRepository.ts'

import { developmentFormats, installDevelopmentPack } from './development/pack.ts'
import { installLedgerPack, ledgerFormatNames } from './ledger/pack.ts'
import { keepPack, PACKS, packsKeptBy, placesOf, planKeep, upToDate } from './packs.ts'

/**
 * **Which packs a document keeps** — M27 U7. Asked of every pack, each by its
 * own test, and the development pack only whole.
 */

const NOW = Date.UTC(2026, 9, 1)
const development = PACKS.find((pack) => pack.id === 'development')

describe('which packs a document keeps', () => {
  it('keeps none in a new document, and none with no document', async () => {
    expect([...packsKeptBy(await createDatabase())]).toEqual([])
    expect([...packsKeptBy(undefined)]).toEqual([])
  })

  it('keeps the development pack when it declares its formats', async () => {
    const db = await createDatabase()
    const installed = installDevelopmentPack(db, NOW)
    expect(installed.ok).toBe(true)
    expect([...packsKeptBy(db)]).toEqual(['development'])
  })

  it('keeps both, side by side', async () => {
    const db = await createDatabase()
    installLedgerPack(db, NOW)
    installDevelopmentPack(db, NOW)
    expect([...packsKeptBy(db)].sort()).toEqual(['development', 'ledger'])
  })

  it('keeps nothing of a pack it declares in part', async () => {
    const db = await createDatabase()
    const formats = developmentFormats()
    if (!formats.ok || development === undefined) throw new Error('the pack does not read')
    // The first in link order links to nothing the document lacks.
    const [first] = formats.value
    if (first === undefined) throw new Error('the pack declares nothing')
    adoptFormat(db, first.declaration, NOW)
    expect(packsKeptBy(db).has('development')).toBe(false)
    expect(listFormats(db).map((format) => format.name)).toContain(first.declaration.name)
  })
})

describe('the views that are places', () => {
  it('draws the development pack’s roadmap, two boards and ready list, in that order', () => {
    expect(development?.places()).toEqual([
      { kind: 'roadmap', format: 'milestone' },
      { kind: 'board', format: 'open_question' },
      { kind: 'board', format: 'unit' },
      { kind: 'ready', format: 'unit' },
    ])
  })

  it('leaves out a roadmap setting that only folds a format under another', () => {
    expect(
      placesOf([
        { format: 'unit', view: 'roadmap', setting: 'under' },
        { format: 'unit', view: 'page', setting: 'body' },
      ]),
    ).toEqual([])
  })
})

describe('keeping a pack (M38 U7, D-405)', () => {
  const pack = (id: string) => {
    const found = PACKS.find((each) => each.id === id)
    if (found === undefined) throw new Error(id)
    return found
  }
  const declaration = (name: string) => {
    const read = developmentFormats()
    if (!read.ok) throw new Error(read.error)
    const found = read.value.find((each) => each.declaration.name === name)?.declaration
    if (found === undefined) throw new Error(name)
    return found
  }

  it('keeps the development pack in an empty document, and a second keep is a no-op that says so', async () => {
    const db = await createDatabase()
    const first = keepPack(db, pack('development'), NOW)
    if (!first.ok) throw new Error(first.error)
    expect(first.value.kept).toBe(false)
    expect([...first.value.declares].sort()).toEqual(['decision', 'inbox', 'milestone', 'open_question', 'review_entry', 'unit'])
    expect([...packsKeptBy(db)]).toEqual(['development'])
    expect(listFormats(db).some((each) => ledgerFormatNames().has(each.name))).toBe(false)

    const second = keepPack(db, pack('development'), NOW)
    if (!second.ok) throw new Error(second.error)
    expect(second.value.kept).toBe(true)
    expect(second.value.declares).toEqual([])
  })

  it('keeps one in a document with rows, and changes none of them', async () => {
    const db = await createDatabase()
    const recipe = {
      ...declaration('milestone'),
      name: 'recipe',
      title: 'Recipe',
    }
    expect(adoptFormat(db, recipe, NOW).refusals).toEqual([])
    insertRows(db, recipe, [{ ref: 'R1', title: 'Soup', goal: 'Warm', state: 'open', position: 1 }])
    const kept = keepPack(db, pack('development'), NOW)
    expect(kept.ok).toBe(true)
    expect(listRows(db, recipe).map((row) => row.cells['title'])).toEqual(['Soup'])
  })

  it('completes a format it holds that is the pack’s, keeping the document’s own column', async () => {
    const db = await createDatabase()
    const full = declaration('decision')
    const theirs = {
      ...full,
      columns: [
        ...full.columns.filter((each) => each.name !== 'supersedes'),
        { ...full.columns.find((each) => each.name === 'title')!, name: 'mood', required: false, unique: false },
      ],
    }
    expect(adoptFormat(db, theirs, NOW).refusals).toEqual([])

    const plan = planKeep(db, pack('development'))
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.value.completes).toEqual([{ format: 'decision', columns: ['supersedes'] }])
    expect(plan.value.declares).not.toContain('decision')
    expect(plan.value.clashes).toEqual([])

    expect(keepPack(db, pack('development'), NOW).ok).toBe(true)
    const names = readFormat(db, 'decision')?.columns.map((each) => each.name) ?? []
    expect(names).toContain('supersedes')
    expect(names).toContain('mood')
    expect([...packsKeptBy(db)]).toEqual(['development'])
  })

  it('refuses a format of the same name that is not the pack’s, naming the column, and writes nothing', async () => {
    const db = await createDatabase()
    const full = declaration('decision')
    const theirs = {
      ...full,
      columns: full.columns.map((each) => (each.name === 'state' ? { ...each, type: 'text' as const, values: [] } : each)),
    }
    expect(adoptFormat(db, theirs, NOW).refusals).toEqual([])

    const kept = keepPack(db, pack('development'), NOW)
    expect(kept.ok).toBe(false)
    if (kept.ok) return
    expect(kept.error).toContain('`decision.state` is text here and enum in the pack.')
    expect(listFormats(db).map((each) => each.name)).toEqual(['decision'])
  })

  it('refuses a person’s own format that shares a ledger name, rather than making a ledger of it', async () => {
    const db = await createDatabase()
    const theirs = { ...declaration('milestone'), name: 'account', title: 'Account' }
    expect(adoptFormat(db, theirs, NOW).refusals).toEqual([])
    const kept = keepPack(db, pack('ledger'), NOW)
    expect(kept.ok).toBe(false)
    expect([...packsKeptBy(db)]).toEqual([])
  })

  it('brings a kept pack up to date: a column it grew since is added, and a second keep changes nothing (D-443)', async () => {
    const db = await createDatabase()
    expect(keepPack(db, pack('development'), NOW).ok).toBe(true)
    // As a document kept before open_question had `answer` (D-444) holds it.
    const full = declaration('open_question')
    const older = { ...full, columns: full.columns.filter((each) => each.name !== 'answer') }
    expect(adoptFormat(db, older, NOW).refusals).toEqual([])
    expect([...packsKeptBy(db)]).toEqual(['development'])

    const plan = planKeep(db, pack('development'))
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.value.kept).toBe(true)
    expect(upToDate(plan.value)).toBe(false)
    expect(plan.value.completes).toEqual([{ format: 'open_question', columns: ['answer'] }])

    expect(keepPack(db, pack('development'), NOW).ok).toBe(true)
    expect(readFormat(db, 'open_question')?.columns.map((each) => each.name)).toContain('answer')
    const again = planKeep(db, pack('development'))
    if (!again.ok) throw new Error(again.error)
    expect(upToDate(again.value)).toBe(true)
  })

  it('raises a held format to the pack’s language when the column it grew needs it (M47 U4)', async () => {
    const db = await createDatabase()
    expect(keepPack(db, pack('development'), NOW).ok).toBe(true)
    // As a document kept before the inbox had `about`, an `elsewhere` (language 23), holds it.
    const full = declaration('inbox')
    const older = { ...full, language: 22, columns: full.columns.filter((each) => each.name !== 'about') }
    expect(adoptFormat(db, older, NOW).refusals).toEqual([])
    expect(keepPack(db, pack('development'), NOW).ok).toBe(true)
    const kept = readFormat(db, 'inbox')
    expect(kept?.columns.map((each) => each.name)).toContain('about')
    expect(kept?.language).toBe(23)
    // With the line the pack's start view gives it, and the document's own view otherwise as it was.
    expect(viewSettings(db, 'inbox', 'start').get('about')).toBe('line')
  })

  it('renames a column the pack renamed, keeping its values, in a document that kept it before (D-420, D-443)', async () => {
    const full = declaration('unit')
    const older = {
      ...full,
      columns: full.columns.map((each) => (each.name === 'taken_by' ? { ...each, name: 'claimed_by' } : each)),
    }
    // What a document made before D-420 holds: the column by its old name, with values in it.
    const fresh = await createDatabase()
    for (const name of ['milestone', 'decision']) expect(adoptFormat(fresh, declaration(name), NOW).refusals).toEqual([])
    expect(adoptFormat(fresh, older, NOW).refusals).toEqual([])
    insertRows(fresh, declaration('milestone'), [{ ref: 'M1', title: 'One', goal: 'Go', state: 'open', position: 1 }])
    const milestone = listRows(fresh, declaration('milestone'))[0]?.id
    if (milestone === undefined) throw new Error('the milestone was not written')
    insertRows(fresh, older, [
      { ref: 'M1 U1', milestone, scope: 'engine', title: 'First', state: 'built', claimed_by: 'the driver' },
    ])

    const plan = planKeep(fresh, pack('development'))
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.value.renames).toEqual([{ format: 'unit', from: 'claimed_by', to: 'taken_by' }])
    expect(plan.value.completes.find((each) => each.format === 'unit')).toBeUndefined()
    expect(plan.value.clashes).toEqual([])

    const kept = keepPack(fresh, pack('development'), NOW)
    if (!kept.ok) throw new Error(kept.error)
    const unit = readFormat(fresh, 'unit')
    if (unit === undefined) throw new Error('unit is gone')
    const names = unit.columns.map((each) => each.name)
    expect(names).toContain('taken_by')
    expect(names).not.toContain('claimed_by')
    expect(listRows(fresh, unit).map((row) => row.cells['taken_by'])).toEqual(['the driver'])
    const again = planKeep(fresh, pack('development'))
    if (!again.ok) throw new Error(again.error)
    expect(upToDate(again.value)).toBe(true)
  })

  it('finds a ledger that was just installed up to date, so its card offers nothing', async () => {
    const db = await createDatabase()
    expect(installLedgerPack(db, NOW).ok).toBe(true)
    const plan = planKeep(db, pack('ledger'))
    if (!plan.ok) throw new Error(plan.error)
    expect(upToDate(plan.value)).toBe(true)
  })
})
