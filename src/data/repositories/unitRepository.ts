/**
 * The units this document knows — `measurement_unit`, seeded by migration 034
 * (M19 U4a, [H7](../../../docs/engine.md), D-223).
 *
 * **The document's rows, not the build's array.** `SEEDED_UNITS` in
 * `@/domain/format/unit.ts` is what a new document is seeded with and what a
 * caller holding no document falls back to; this is what a conversion is
 * actually resolved against, so a person who added `slice` or corrected
 * `tbsp` to 20 ml gets their own answer rather than this build's opinion.
 * That is D-212's rule one level up — every check reads *what the document
 * declares* — and it is the reason the table exists at all.
 *
 * Decoding is defensive, as everywhere else here: a `.emd` is a real SQLite
 * database the user can open in any tool, and a row that no longer makes sense
 * is skipped rather than thrown. A skipped unit is one a conversion cannot find,
 * which comes back as a sentence naming it — the failure a person can act on.
 *
 * **There is no remove.** Taking a unit away asks what becomes of every
 * declaration and identity that names it, which is H9 at a smaller scale and
 * deserves its own answer rather than a line here (D-212 made the same call
 * about a role).
 */

import type { Database } from 'sql.js'

import {
  unitRejection,
  type Dimension,
  type UnitOrigin,
  type UnitRow,
  type UnitTable,
} from '@/domain/format/unit.ts'
import { MONDAY, parseWeekday, weekdayText, type Weekday } from '@/domain/format/clock.ts'
import { parseCurrency } from '@/domain/format/currency.ts'
import { query } from '../db/database.ts'

const SELECT = `SELECT symbol, dimension, per_base, origin, note
                  FROM measurement_unit`

/**
 * Every unit the document holds, smallest first within a dimension.
 *
 * The order is the order a person would print a table of units in and the order
 * a picker should offer them, and it is settled here rather than at each call
 * site so two surfaces cannot disagree about it.
 */
export function listUnits(db: Database): UnitTable {
  const rows = query(db, `${SELECT} ORDER BY dimension, per_base, symbol`).flatMap((row) => {
    const decoded = decode(row)
    return decoded === undefined ? [] : [decoded]
  })
  return rows
}

/**
 * Add one a person measures in that this build never heard of — `slice`, `IU`,
 * a 20 ml tablespoon under another name.
 *
 * Refuses rather than guesses, in the words a surface can print, and the symbol
 * is the primary key so adding one that exists is a refusal rather than a
 * silent overwrite of a factor somebody is already relying on.
 */
export function addUnit(
  db: Database,
  row: Omit<UnitRow, 'origin'>,
  now: number,
): { readonly added: UnitRow } | { readonly problem: string } {
  const unit: UnitRow = { ...row, origin: 'USER' }
  const rejection = unitRejection(unit)
  if (rejection !== undefined) return { problem: rejection }

  const existing = query(db, `${SELECT} WHERE symbol = ?`, [unit.symbol])
  if (existing.length > 0) {
    return {
      problem: `This document already has a unit called ${unit.symbol}. Change that row rather than adding a second one.`,
    }
  }

  db.run(
    `INSERT INTO measurement_unit (symbol, dimension, per_base, origin, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [unit.symbol, unit.dimension, unit.perBase, unit.origin, unit.note, now],
  )
  return { added: unit }
}

/**
 * Correct a factor — the tablespoon that is 20 ml in this kitchen.
 *
 * **The dimension does not move.** A `tbsp` that became a mass would re-mean
 * every identity that ever converted through it, which is the reconciler's
 * `UNIT_CHANGED` refusal (D-214) wearing a different hat: every figure stays,
 * every figure is wrong by a factor, and nothing records that the meaning moved.
 * Changing what a unit *measures* is therefore a new unit under a new symbol.
 */
export function correctUnit(
  db: Database,
  symbol: string,
  perBase: number,
  note: string,
): { readonly corrected: UnitRow } | { readonly problem: string } {
  const existing = query(db, `${SELECT} WHERE symbol = ?`, [symbol]).map(decode)[0]
  if (existing === undefined) {
    return { problem: `This document has no unit called ${symbol}.` }
  }
  const next: UnitRow = { ...existing, perBase, note }
  const rejection = unitRejection(next)
  if (rejection !== undefined) return { problem: rejection }

  db.run('UPDATE measurement_unit SET per_base = ?, note = ? WHERE symbol = ?', [
    perBase,
    note,
    symbol,
  ])
  return { corrected: next }
}

/**
 * **The document's currency** — what a new money figure is in until a row says
 * otherwise (M29 F3, D-344). Kept beside the units because it is the same kind
 * of fact: what this document's figures are measured in, the document's and
 * never the machine's (D-115).
 *
 * Nothing when none was chosen.
 */
export function documentCurrency(db: Database): string | undefined {
  const value = query(db, "SELECT value FROM document_setting WHERE key = 'currency'")[0]?.['value']
  if (typeof value !== 'string') return undefined
  const code = parseCurrency(value)
  return code.ok ? code.value : undefined
}

/**
 * Choose the document's currency, or change it. A row already written keeps
 * the currency it was written in: this is what the *next* figure is offered in,
 * never a conversion of any figure already kept.
 */
export function setDocumentCurrency(db: Database, typed: string): { problem: string } | { currency: string } {
  const code = parseCurrency(typed)
  if (!code.ok) return { problem: code.error }
  db.run(
    `INSERT INTO document_setting (key, value) VALUES ('currency', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [code.value],
  )
  return { currency: code.value }
}

/** The inside of `applyDocument`: a text document's currency, after its formats. */
export function restoreDocumentCurrency(db: Database, currency: string | undefined): void {
  if (currency !== undefined) setDocumentCurrency(db, currency)
}

/**
 * **The day this document's weeks start on** (M53 F6, D-528) — what `this
 * week` and `last week` name. The document's and never the machine's, beside
 * its currency for the same reason: the plugin and another machine must name
 * the same rows. Nothing when none was chosen, which reads as Monday (ISO).
 */
export function chosenWeekStart(db: Database): string | undefined {
  const value = query(db, "SELECT value FROM document_setting WHERE key = 'week_start'")[0]?.['value']
  const day = typeof value === 'string' ? parseWeekday(value) : undefined
  return day === undefined ? undefined : weekdayText(day)
}

/** The day this document's weeks start on, Monday when it chose none — what a window is worked out with. */
export function documentWeekStart(db: Database): Weekday {
  return parseWeekday(chosenWeekStart(db) ?? '') ?? MONDAY
}

/** Choose the day this document's weeks start on: `sunday`, `Monday`. Rows are untouched; a window is worked out again on read. */
export function setDocumentWeekStart(db: Database, typed: string): { problem: string } | { weekStart: string } {
  const day = parseWeekday(typed)
  if (day === undefined) return { problem: `"${typed.trim()}" is not a day of the week: say monday, sunday, or another day by name.` }
  db.run(
    `INSERT INTO document_setting (key, value) VALUES ('week_start', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [weekdayText(day)],
  )
  return { weekStart: weekdayText(day) }
}

/** The inside of `applyDocument`: a text document's week start, after its formats. */
export function restoreDocumentWeekStart(db: Database, weekStart: string | undefined): void {
  if (weekStart !== undefined) setDocumentWeekStart(db, weekStart)
}

function decode(row: Record<string, unknown>): UnitRow | undefined {
  const symbol = row['symbol']
  const dimension = row['dimension']
  const perBase = row['per_base']
  const origin = row['origin']
  if (typeof symbol !== 'string' || typeof dimension !== 'string') return undefined
  if (typeof perBase !== 'number' || typeof origin !== 'string') return undefined
  const unit: UnitRow = {
    symbol,
    dimension: dimension as Dimension,
    perBase,
    origin: origin as UnitOrigin,
    note: String(row['note'] ?? ''),
  }
  return unitRejection(unit) === undefined ? unit : undefined
}
