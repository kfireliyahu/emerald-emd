/**
 * **What a row looks like, in the first call** (M47 U2, D-460): `start_here`
 * ends with one line per format, generated from the declarations, so a session
 * can write a row without asking `formats` once per format first.
 */

import { describe, expect, it } from 'vitest'

import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'

import { compactDeclarations } from './formats.ts'

function column(name: string, type: ColumnDeclaration['type'], more: Partial<ColumnDeclaration> = {}): ColumnDeclaration {
  return {
    name,
    type,
    unit: undefined,
    per: undefined,
    required: false,
    unique: false,
    scale: undefined,
    values: [],
    minimum: undefined,
    maximum: undefined,
    target: undefined,
    note: 'Prose a writer does not need here.',
    ...more,
  }
}

function format(name: string, columns: readonly ColumnDeclaration[], more: Partial<FormatDeclaration> = {}): FormatDeclaration {
  return {
    language: 16,
    name,
    title: name,
    notes: 'Notes stay in formats.',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    ...more,
  }
}

describe('compactDeclarations', () => {
  it('says every column a writer needs on one line: required, type, members, targets, keys, bounds', () => {
    const text = compactDeclarations([
      format(
        'dish',
        [
          column('name', 'text', { required: true, unique: true }),
          column('course', 'enum', { required: true, values: ['starter', 'main'] }),
          column('tags', 'enums', { values: ['quick', 'cheap'] }),
          column('made_from', 'link', { target: 'ingredient' }),
          column('pairs_with', 'links', { target: 'dish' }),
          column('price', 'money'),
          column('weight', 'quantity'),
          column('rating', 'decimal', { scale: 1, minimum: 0, maximum: 5 }),
          column('serves', 'integer', { minimum: 1 }),
          column('density', 'real', { unit: 'g', per: 'ml' }),
          column('made_on', 'date'),
        ],
        { derived: [{ name: 'per_serving', expression: 'price / serves', note: '' }] },
      ),
    ])
    expect(text).toContain('### What a row looks like')
    expect(text).toContain(
      '- `dish` — **name**: unique · **course**: starter|main · tags: [quick|cheap] · made_from: → ingredient · ' +
        'pairs_with: → [dish] · price: money + price_currency · weight: quantity + weight_unit · ' +
        'rating: decimal(1), 0–5 · serves: integer, ≥ 1 · density: real in g per ml · made_on: date · ' +
        'per_serving = `price / serves`',
    )
    expect(text).toContain('is a dry run until `commit: true`')
    // A write's shape, read off the two tools' schemas and named by the format's own unique column (M51 F4).
    expect(text).toContain(
      'A write’s shape: `record_format_rows format:dish rows:[{…}]` · ' +
        '`update_format_rows format:dish edits:[{where:{name:…}, values:{…}}]`.',
    )
    // The prose stays in `formats`, which is the whole declaration.
    expect(text).not.toContain('Prose a writer does not need here.')
    expect(text).not.toContain('Notes stay in formats.')
  })

  it("names a pack's locked formats instead of spelling them out, and says nothing for a document with none", () => {
    const owner = { pack: 'ledger', written: 'with the ledger’s tools', columns: ['name'] }
    const text = compactDeclarations([
      format('account', [column('name', 'text', { required: true })], { owner }),
      format('category', [column('name', 'text', { required: true })], { owner }),
    ])
    expect(text).toContain('Written only through the ledger pack: account, category.')
    expect(text).not.toContain('- `account`')
    expect(text).not.toContain('dry run')
    expect(compactDeclarations([])).toBe('')
  })
})
