/**
 * **Rule sets, applied** (M25 E4, D-273).
 *
 * A format declared a rule set over another (`rule.ts`); this is where its
 * rows are read and what they decide is written. Two ways in, and both halves
 * of D-234 reach each:
 *
 * - **On a write of the target** — `withRules`, called by every generic write
 *   (the format's own page, `record_format_rows`, `update_format_rows`,
 *   `read_onto_format`) on the cells *before* they are judged, so the dry run
 *   shows what the rules set and a constraint is held to it too. **Not in
 *   `insertRows`**: that is also what a text document's rows come back through
 *   on open (D-247), and opening a file must not change what it says.
 * - **On demand** — `planRuleSet` says what applying one would change, and
 *   `applyRuleSet` writes it. A new rule changes nothing until somebody asks:
 *   a rule written on Tuesday re-sorting a year of rows is a change a person
 *   should see before it lands.
 *
 * A row a person set is never the rules' (`isTheRules`), on either path.
 *
 * **A link found by a date has the same two ways in** (D-350, D-353):
 * `withRules` fills an empty one on a write, and `planFoundLink` /
 * `applyFoundLink` fill the empty ones already there, on demand — never one
 * that is set.
 */

import type { Database } from 'sql.js'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  applyOnWrite,
  decide,
  isTheRules,
  prepareRules,
  type PreparedRules,
  type RuledWrite,
  type RuleSetDeclaration,
} from '@/domain/format/rule.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import {
  applyFinds,
  foundColumns,
  planFinds,
  type Finder,
  type FindPlan,
  type FoundRefusal,
} from '@/domain/format/foundBy.ts'

import { inTransaction } from '../db/database.ts'
import { listFormats } from './formatRepository.ts'
import { listRows, updateRow } from './formatRowRepository.ts'

/** Every rule set that sets this format's rows, ready to decide. */
export function rulesSetting(
  db: Database,
  target: FormatDeclaration,
  formats: readonly FormatDeclaration[] = listFormats(db),
): readonly PreparedRules[] {
  return formats.flatMap((rules) =>
    (rules.ruleSets ?? [])
      .filter((each) => each.target === target.name)
      .map((each) => prepareRules(each, rules.columns, listRows(db, rules))),
  )
}

/**
 * The links of `declaration` found by a date (M29 F8, D-350), each with the
 * rows of the format it points at — read once, for a batch.
 */
export function findersFor(
  db: Database,
  declaration: FormatDeclaration,
  formats: readonly FormatDeclaration[] = listFormats(db),
): readonly Finder[] {
  return foundColumns(declaration).flatMap((column) => {
    const target =
      column.target === declaration.name ? declaration : formats.find((each) => each.name === column.target)
    return target === undefined ? [] : [{ column, target, rows: listRows(db, target) }]
  })
}

/** A write with its rules applied, and the links a date could not find. */
export interface WriteWithRules extends RuledWrite {
  /** A link found by a date with no row, or two, to find (D-350). Refuses the row. */
  readonly refusals: readonly FoundRefusal[]
}

/**
 * A write to `target`, with its rules applied — the rule sets over it (D-273),
 * then its links found by a date (D-350). `cells` is what the writer sends —
 * every column for a new row, the columns named for an edit — and `before` the
 * row as it stood. A format neither touches comes back as it went in, at the
 * cost of one read of the declarations.
 */
export function withRules(
  db: Database,
  target: FormatDeclaration,
  cells: Readonly<Record<string, StoredValue>>,
  before: Readonly<Record<string, StoredValue>> = {},
  prepared: readonly PreparedRules[] = rulesSetting(db, target),
  finders: readonly Finder[] = findersFor(db, target),
): WriteWithRules {
  const ruled = prepared.length === 0 ? { cells, decisions: [] } : applyOnWrite(prepared, cells, before)
  if (finders.length === 0) return { ...ruled, refusals: [] }
  const found = applyFinds(finders, ruled.cells, before)
  return { cells: found.cells, decisions: ruled.decisions, refusals: found.refusals }
}

/** One row a rule set would change. */
export interface RuleChange {
  readonly id: string
  readonly from: string | null
  readonly to: string
  readonly rule: string
}

/** What applying a rule set would do, before it does it. */
export interface RuleSetPlan {
  readonly set: RuleSetDeclaration
  readonly target: FormatDeclaration
  readonly changes: readonly RuleChange[]
  /** Rows the rules tied on, naming them — left as they are. */
  readonly ties: readonly { readonly id: string; readonly rules: readonly string[] }[]
  /** Rows a person (or anybody but the rules) set, and so not the rules' to touch. */
  readonly kept: number
  /** Rows the rules could set and no rule matched. */
  readonly unmatched: number
  readonly rows: number
}

/** Find a rule set by the format declaring it and, if it has several, its name. */
export function findRuleSet(
  formats: readonly FormatDeclaration[],
  rules: FormatDeclaration,
  name: string | undefined,
): { readonly set: RuleSetDeclaration; readonly target: FormatDeclaration } | string {
  const declared = rules.ruleSets ?? []
  if (declared.length === 0) {
    return `${rules.name} declares no rule set. \`extend_format\` adds one: \`rule_sets: [{ name, sets }]\`.`
  }
  const set =
    name === undefined ? (declared.length === 1 ? declared[0] : undefined) : declared.find((each) => each.name === name)
  if (set === undefined) {
    return (
      `${name === undefined ? `${rules.name} declares ${declared.length} rule sets; name one` : `${rules.name} has no rule set called ${name}`}` +
      ` — ${declared.map((each) => `\`${each.name}\``).join(', ')}.`
    )
  }
  const target = formats.find((each) => each.name === set.target)
  if (target === undefined) return `The rule set ${set.name} sets ${set.target}, which this document no longer declares.`
  return { set, target }
}

/**
 * What applying `set` to every row of its target would change. A row the rules
 * set before and no rule matches now is left as it is, for the reason a write
 * leaves it (`applyOnWrite`).
 */
export function planRuleSet(
  db: Database,
  rules: FormatDeclaration,
  set: RuleSetDeclaration,
  target: FormatDeclaration,
): RuleSetPlan {
  const prepared = prepareRules(set, rules.columns, listRows(db, rules))
  const rows = listRows(db, target)
  const changes: RuleChange[] = []
  const ties: { id: string; rules: readonly string[] }[] = []
  let kept = 0
  let unmatched = 0
  for (const row of rows) {
    if (!isTheRules(set, row.cells)) {
      kept += 1
      continue
    }
    const decision = decide(prepared, row.cells)
    if (decision.kind === 'NONE') unmatched += 1
    else if (decision.kind === 'TIE') ties.push({ id: row.id, rules: decision.rules })
    else {
      const from = row.cells[set.sets] ?? null
      const sameRule = set.noting === undefined || row.cells[set.noting] === decision.rule
      if (from === decision.value && row.cells[set.source] === set.ruleMember && sameRule) continue
      changes.push({ id: row.id, from: from === null ? null : String(from), to: decision.value, rule: decision.rule })
    }
  }
  return { set, target, changes, ties, kept, unmatched, rows: rows.length }
}

/** Apply a rule set to every row of its target it may set. Returns what changed. */
export function applyRuleSet(
  db: Database,
  rules: FormatDeclaration,
  set: RuleSetDeclaration,
  target: FormatDeclaration,
): RuleSetPlan {
  const plan = planRuleSet(db, rules, set, target)
  inTransaction(db, () => {
    for (const change of plan.changes) {
      updateRow(db, target, change.id, {
        [set.sets]: change.to,
        [set.source]: set.ruleMember,
        ...(set.noting === undefined ? {} : { [set.noting]: change.rule }),
      })
    }
  })
  return plan
}

/* ------------------------------------------- a found link, on the rows there */

/**
 * What filling `column`'s empty links by its `found by` would do, over every
 * row of `declaration` (M29 F11, D-353) — or the sentence saying why it cannot
 * be asked. A link already set is not touched, by a person or by the rule.
 */
export function planFoundLink(
  db: Database,
  declaration: FormatDeclaration,
  column: string,
  formats: readonly FormatDeclaration[] = listFormats(db),
): FindPlan | string {
  const declared = declaration.columns.find((each) => each.name === column)
  if (declared === undefined) {
    return `${declaration.name} has no column called ${column}.`
  }
  const finder = findersFor(db, declaration, formats).find((each) => each.column.name === column)
  if (finder === undefined) {
    return declared.type === 'link' && declared.foundBy !== undefined
      ? `${declaration.name}.${column} points at ${declared.target ?? 'a format'}, which this document no longer declares.`
      : `${declaration.name}.${column} is not found by a date, so there is no rule to apply — ` +
          '`connect_formats` with `found_by` gives it one (`date in period`).'
  }
  return planFinds(finder, declaration, listRows(db, declaration))
}

/** Fill the empty links the plan can place. Returns what was planned and written. */
export function applyFoundLink(
  db: Database,
  declaration: FormatDeclaration,
  column: string,
): FindPlan | string {
  const plan = planFoundLink(db, declaration, column)
  if (typeof plan === 'string') return plan
  inTransaction(db, () => {
    for (const placement of plan.placements) updateRow(db, declaration, placement.id, { [column]: placement.to })
  })
  return plan
}
