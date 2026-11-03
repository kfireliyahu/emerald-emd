/**
 * **A link field finds by name and makes what is missing in place** — M55 U6,
 * D-550. On the development pack's own formats: a unit's milestone lists its
 * milestones in the roadmap's order, each by its ref with its title beside it;
 * a name no milestone has is made from the inline form, refused at its fields
 * first; and a target that asks for nothing but its name is made at once.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { installDevelopmentPack } from '@/data/packs/development/pack.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { insertRows } from '@/data/repositories/formatRowRepository.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { withField } from '@/domain/format/rowDraft.ts'
import { SEEDED_UNITS } from '@/domain/format/unit.ts'

import { NewLinkForm, type LinkMaker } from './EntryView.tsx'
import { linkChoices, newLinked, stageLinked, type NewLinked } from './linkTargets.ts'

const NOW = Date.UTC(2026, 10, 3)
const DAY = '2026-11-03'

/** A format that needs nothing but its name: its one other required column is an enum, which starts at its first member. */
const TAG: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'tag',
  title: 'Tag',
  notes: '',
  columns: [column('name', 'text', { required: true, unique: true }), column('kind', 'enum', { required: true, values: ['topic', 'person'] })],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const NOTE: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'note',
  title: 'Note',
  notes: '',
  columns: [column('text', 'text', { required: true }), column('tag', 'link', { target: 'tag' })],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function project(): Promise<Database> {
  const db = await createDatabase()
  const installed = installDevelopmentPack(db, NOW)
  if (!installed.ok) throw new Error(installed.error)
  for (const each of [TAG, NOTE]) {
    expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  }
  return db
}

const formatsOf = (db: Database): Map<string, FormatDeclaration> => new Map(listFormats(db).map((each) => [each.name, each]))

/** Made as a link field makes it: planned, staged, inserted. */
function make(db: Database, made: NewLinked): string {
  const staged = stageLinked(db, made, DAY, listFormats(db))
  if ('refusals' in staged) throw new Error(staged.refusals.map((each) => each.reason).join(' '))
  insertRows(db, made.format, [staged.row.cells], [staged.row.id])
  return staged.row.id
}

function milestone(db: Database, ref: string, title: string, position: string): string {
  const format = formatsOf(db).get('milestone')
  if (format === undefined) throw new Error('no milestone')
  let made = newLinked(db, format, ref, DAY)
  for (const [key, value] of [['title', title], ['goal', `${title}, done.`], ['position', position]] as const) {
    made = { ...made, draft: withField(made.draft, key, value) }
  }
  return make(db, made)
}

describe('a link field’s choices (M55 U6, D-550)', () => {
  it('are in the target’s roadmap order, each by its name with its title beside it', async () => {
    const db = await project()
    // Written out of order: the list was id order, M2, M3, M1.
    milestone(db, 'M2', 'Second', '20')
    milestone(db, 'M10', 'Tenth', '100')
    milestone(db, 'M1', 'First', '10')
    const formats = formatsOf(db)
    const unit = formats.get('unit')
    if (unit === undefined) throw new Error('no unit')
    const choices = linkChoices(db, unit, formats).get('milestone') ?? []
    expect(choices.map((each) => [each.label, each.title])).toEqual([
      ['M1', 'First'],
      ['M2', 'Second'],
      ['M10', 'Tenth'],
    ])
  })

  it('are in name order with a name’s numbers read as numbers, and no title where the name is the title', async () => {
    const db = await project()
    const tag = formatsOf(db).get('tag')
    if (tag === undefined) throw new Error('no tag')
    for (const name of ['T10', 'T2', 'T1']) make(db, newLinked(db, tag, name, DAY))
    const choices = linkChoices(db, NOTE, formatsOf(db)).get('tag') ?? []
    expect(choices.map((each) => each.label)).toEqual(['T1', 'T2', 'T10'])
    expect(choices.every((each) => each.title === undefined)).toBe(true)
  })
})

describe('+ New from a link field (M55 U6, D-550)', () => {
  it('makes a target that needs nothing but its name at once', async () => {
    const db = await project()
    const tag = formatsOf(db).get('tag')
    if (tag === undefined) throw new Error('no tag')
    const made = newLinked(db, tag, ' urgent ', DAY)
    expect(made.asks).toEqual([])
    expect(made.draft).toMatchObject({ name: 'urgent', kind: 'topic' })
    const id = make(db, made)
    expect(linkChoices(db, NOTE, formatsOf(db)).get('tag')?.find((each) => each.id === id)?.label).toBe('urgent')
  })

  it('asks a target’s required columns, refuses at each, and then makes it', async () => {
    const db = await project()
    milestone(db, 'M1', 'First', '10')
    const format = formatsOf(db).get('milestone')
    if (format === undefined) throw new Error('no milestone')
    const made = newLinked(db, format, 'M9', DAY)
    // State starts at its first member, as a new entry does (D-518); the rest are asked.
    expect(made.named?.name).toBe('ref')
    expect(made.asks.map((each) => each.name)).toEqual(['title', 'goal', 'position'])

    // Add with nothing filled: every asked field refused, each at its own column.
    const refused = stageLinked(db, made, DAY, listFormats(db))
    if (!('refusals' in refused)) throw new Error('should have been refused')
    expect(refused.refusals.map((each) => each.column).sort()).toEqual(['goal', 'position', 'title'])

    // The form draws the name typed and the three it asks, each refusal at its field.
    const maker: LinkMaker = {
      one: () => 'milestone',
      plan: () => made,
      choices: () => [],
      make: () => refused,
      units: SEEDED_UNITS,
      today: DAY,
    }
    const markup = renderToStaticMarkup(
      createElement(NewLinkForm, { making: { made, refusals: refused.refusals }, maker, onChange: () => undefined, onAdd: () => undefined, onCancel: () => undefined }),
    )
    expect(markup).toContain('data-new-link')
    expect(markup).toContain('>M9</textarea>')
    for (const name of ['title', 'goal', 'position']) expect(markup).toContain(`data-field="${name}"`)
    expect(markup.match(/text-negative/g)?.length).toBe(3)

    // Filled, it is made, and the unit's milestone lists it in its place.
    let filled = made
    for (const [key, value] of [['title', 'Ninth'], ['goal', 'Ninth, done.'], ['position', '90']] as const) {
      filled = { ...filled, draft: withField(filled.draft, key, value) }
    }
    const id = make(db, filled)
    const formats = formatsOf(db)
    const unit = formats.get('unit')
    if (unit === undefined) throw new Error('no unit')
    expect(linkChoices(db, unit, formats).get('milestone')?.map((each) => each.label)).toEqual(['M1', 'M9'])
    expect(linkChoices(db, unit, formats).get('milestone')?.[1]?.id).toBe(id)
  })
})
