/**
 * Institutions — the `Institution` of docs/04-data-model.md.
 *
 * Reference data, shipped as seed rows in migration 006 and extended by the user
 * through onboarding's "other". docs/f12 is explicit that this list is
 * convenience data and never a constraint: an account can exist with no
 * institution, and a provider that is not in the list must never block anybody.
 *
 * Decoding is defensive for the same reason the mappings are: the document is a
 * real SQLite file the user owns and can edit in any tool, so `aliases` may hold
 * anything. A row whose aliases no longer parse is still a usable institution.
 */

import type { Database } from 'sql.js'

import { stringListOf } from './json.ts'
import { newId } from '@/core/id.ts'
import { query } from '../db/database.ts'
import { declared } from '../packs/ledger/tables.ts'
import { insertRows } from './formatRowRepository.ts'

export type InstitutionKind =
  | 'CARD_ISSUER'
  | 'BANK'
  | 'INVESTMENT_PLATFORM'
  | 'FUND_MANAGER'
  | 'OTHER'

export interface Institution {
  readonly id: string
  readonly name: string
  readonly kind: InstitutionKind
  /** Hebrew and English, former names included. Used for search and statement detection. */
  readonly aliases: readonly string[]
  readonly isUserCreated: boolean
}

/**
 * The aliases are rows of `institution_alias` since M25 U2 — the JSON list in a
 * cell they were is a column nothing could check — gathered back into the list
 * every caller already reads.
 */
const SELECT = `SELECT i.id, i.name, i.kind, i.is_user_created, i.sort_order,
                       (SELECT json_group_array(a.alias) FROM fmt_institution_alias a
                         WHERE a.institution = i.id) AS aliases
                  FROM fmt_institution i
                 WHERE 1 = 1`

/**
 * Seeds in their shipped order, then anything the user added, alphabetically.
 *
 * A user-created institution sorts after the seeds of its kind rather than into
 * them: its `sort_order` is 0 and the seeds start at 10, so "other" rows would
 * otherwise land above the list they were an exception to.
 */
const ORDER = ' ORDER BY i.is_user_created, i.sort_order, i.name'

export function listInstitutions(
  db: Database,
  options: { readonly kind?: InstitutionKind } = {},
): readonly Institution[] {
  const rows =
    options.kind === undefined
      ? query(db, SELECT + ORDER)
      : query(db, `${SELECT} AND i.kind = ?${ORDER}`, [options.kind])
  return rows.map(decode)
}

export function findInstitutionById(db: Database, id: string): Institution | undefined {
  return query(db, `${SELECT} AND i.id = ?`, [id]).map(decode)[0]
}

/**
 * Add an institution the app does not ship — onboarding's "other", which docs/f12
 * requires to always be present and always work.
 *
 * A name that already exists among the same kind returns that row instead of
 * making a second one. Typing "Cal" into the other box is a user who did not
 * spot it in the list, not a request for two Cals.
 *
 * **A name is one institution's** since M25 U2 (D-268): a name another kind
 * already has is told apart by this one's kind — `Everyday Bank (bank)` — which is
 * what the conversion did to a real document's second Everyday Bank.
 */
export function createInstitution(
  db: Database,
  institution: { readonly name: string; readonly kind: InstitutionKind },
  _now: number,
): Institution {
  const name = institution.name.trim()
  const existing = listInstitutions(db, { kind: institution.kind }).find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  )
  if (existing !== undefined) return existing

  const taken = listInstitutions(db).some((each) => each.name.toLowerCase() === name.toLowerCase())
  const distinct = taken ? `${name} (${institution.kind.toLowerCase().replace(/_/g, ' ')})` : name
  const again = listInstitutions(db).find((each) => each.name === distinct)
  if (again !== undefined) return again

  const id = newId()
  insertRows(
    db,
    declared(db, 'institution'),
    [{ name: distinct, kind: institution.kind, color: null, is_user_created: 1, sort_order: 0 }],
    [id],
  )
  return { id, name: distinct, kind: institution.kind, aliases: [], isUserCreated: true }
}

function decode(row: Record<string, unknown>): Institution {
  return {
    id: String(row['id']),
    name: String(row['name']),
    kind: String(row['kind']) as InstitutionKind,
    aliases: stringListOf(row['aliases']),
    isUserCreated: Number(row['is_user_created']) === 1,
  }
}
