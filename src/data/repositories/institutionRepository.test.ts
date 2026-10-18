import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import {
  createInstitution,
  findInstitutionById,
  listInstitutions,
  type Institution,
} from './institutionRepository.ts'

/**
 * The institution reference data of docs/f12, against the real seed set: it is
 * what every user starts from, and "the list is never a constraint" is the
 * property worth testing.
 */
describe('institutions', () => {
  let db: Database

  beforeEach(async () => {
    db = await createLedgerDatabase()
  })

  it('ships the issuers and banks the app is built for', () => {
    const names = listInstitutions(db).map((institution) => institution.name)

    expect(names).toContain('Cal')
    expect(names).toContain('Max')
    expect(names).toContain('Bank Hapoalim')
    expect(names).toContain('Mizrahi-Tefahot')
  })

  it('groups by kind, in the order it ships them', () => {
    const issuers = listInstitutions(db, { kind: 'CARD_ISSUER' })

    expect(issuers[0]?.name).toBe('Cal')
    expect(issuers.every((institution) => institution.kind === 'CARD_ISSUER')).toBe(true)
    expect(issuers.every((institution) => !institution.isUserCreated)).toBe(true)
  })

  it('carries Hebrew and former names as aliases', () => {
    const max = byName(listInstitutions(db), 'Max')

    expect(max.aliases).toContain('מקס')
    // The rename that breaks matching, per docs/f12.
    expect(max.aliases).toContain('Leumi Card')
  })

  it('accepts a provider it has never heard of', () => {
    const created = createInstitution(db, { name: 'בנק של השכונה', kind: 'BANK' }, 1)

    expect(created.isUserCreated).toBe(true)
    expect(findInstitutionById(db, created.id)?.name).toBe('בנק של השכונה')
    expect(listInstitutions(db, { kind: 'BANK' }).at(-1)?.id).toBe(created.id)
  })

  it('trims what was typed, and does not make a second Cal', () => {
    const first = createInstitution(db, { name: '  cal  ', kind: 'CARD_ISSUER' }, 1)
    const again = createInstitution(db, { name: 'Cal', kind: 'CARD_ISSUER' }, 2)

    expect(first.id).toBe('inst:cal')
    expect(again.id).toBe('inst:cal')
    expect(listInstitutions(db, { kind: 'CARD_ISSUER' }).filter((i) => i.name === 'Cal')).toHaveLength(1)
  })

  /** One name may legitimately be two things: a bank and the fund manager beside it. */
  it('treats the same name under a different kind as a different institution', () => {
    const created = createInstitution(db, { name: 'Cal', kind: 'BANK' }, 1)

    expect(created.id).not.toBe('inst:cal')
  })

  /** The aliases are rows of their own since M25 U2, read back into the list every caller uses. */
  it('reads its aliases from the rows that hold them', () => {
    const cal = findInstitutionById(db, 'inst:cal')
    expect(cal?.aliases).toContain('כאל')
    expect(listInstitutions(db).find((each) => each.id === 'inst:max')?.aliases).toContain('לאומי קארד')
  })

  /** A name is one institution's; the same name of another kind is told apart by it (D-268). */
  it('tells the same name of another kind apart by its kind', () => {
    const created = createInstitution(db, { name: 'Cal', kind: 'BANK' }, 1)
    expect(created.name).toBe('Cal (bank)')
    expect(createInstitution(db, { name: 'Cal', kind: 'BANK' }, 2).id).toBe(created.id)
  })
})

function byName(institutions: readonly Institution[], name: string): Institution {
  const found = institutions.find((institution) => institution.name === name)
  if (found === undefined) throw new Error(`no institution called ${name}`)
  return found
}
