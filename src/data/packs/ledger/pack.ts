/**
 * **The ledger as a pack** — M25 U1, D-265.
 *
 * A pack is three things: its declarations, its seeded rows (D-264) and its
 * code. This file is the first two. The declarations are the `.format.md` files
 * beside it, one per format and each the text a document stored as text already
 * is (D-244), so a pack's format and a person's are the same file; the seeds are
 * their `## rows`, plus the built-in category rules, which are generated from
 * the rule packs rather than written twice.
 *
 * ## Per document, because the tables live in the file
 *
 * Open question *M20 U0 #1* asked whether the ledger is on per machine or per
 * document. **Per document** (D-266): a document has the ledger when it
 * declares the ledger's formats, and the rail shows the pack exactly then — M25
 * U8 took away the switch that sat on top of it. A document that holds none of the ledger — `docs/memory.emd`, a recipe
 * book — is never given thirty-four tables it did not ask for.
 *
 * ## Declared before anything reads them
 *
 * **A declaration here is already the document's own the moment it is adopted**: a later build
 * does not re-adopt over it, because a person may have added a column, and an
 * empty table's declaration changing under a unit is a question that unit
 * answers where it can see the rows. **The one exception is a constraint the
 * pack added since** (M25 E1, D-270): it is added to the declaration the
 * document holds and nothing else changes, so a document that got the pack at
 * U1 has the same uniques as one that gets it today — and the same rollups
 * (M25 E2, D-271) and aggregates (M25 E3, D-272).
 *
 * **Since U8 there is nothing else.** Every table the ledger kept before M25 is
 * gone — migration 048 drops what is left, and a new document never keeps one —
 * so a document's ledger is these formats, their rows and the pack's code, and
 * nothing a seed has to wait for.
 */

import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { readFormat as readFormatText, readViews, type ParsedFormat } from '@/domain/format/document.ts'
import type { ViewSetting } from '@/domain/format/view.ts'
import { constraintKey } from '@/domain/format/constraint.ts'
import { rollupText } from '@/domain/format/rollup.ts'
import { sameOwner } from '@/domain/format/owner.ts'
import { SEEDED_UNITS } from '@/domain/format/unit.ts'
import { query } from '../../db/database.ts'
import { BUILT_IN_RULES } from '../../reference/rulepacks/index.ts'
import { BUILT_IN_PREFIX } from '../../reference/rulepacks/packFormat.ts'
import {
  adoptFormat,
  deleteFormat,
  formatsPointingAt,
  listFormats,
  readFormat,
  rowCountOf,
} from '../../repositories/formatRepository.ts'
import { listRows } from '../../repositories/formatRowRepository.ts'
import { listViewSettings, restoreViewSettings } from '../../repositories/formatViewRepository.ts'
import { seedRows, type Seeding } from '../../repositories/formatSeedRepository.ts'
import SEEDED_IDS from './seededIds.json'
import VIEWS from './views.md?raw'

const SOURCES = import.meta.glob<string>('./formats/*.format.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

let parsed: Result<readonly ParsedFormat[], string> | undefined

/**
 * Every format the pack declares, in the order they can be adopted: a format
 * comes after every format it links to, so a link always names a declared
 * table (D-265).
 *
 * **An aggregate points the other way** (M25 E3, D-272): a fund's latest
 * balance folds its snapshots, which link the fund — a circle no order
 * breaks. So each format is read first without its aggregates, in link order,
 * and then again whole against every other; the install adds the aggregates in
 * a second pass for the same reason. It is the order a person meets it in on
 * the Connections screen: the two formats, then the link, then the figure.
 */
export function ledgerFormats(): Result<readonly ParsedFormat[], string> {
  parsed ??= parseAll()
  return parsed
}

function parseAll(): Result<readonly ParsedFormat[], string> {
  const texts = new Map<string, string>()
  for (const [path, text] of Object.entries(SOURCES)) {
    const name = /([a-z_]+)\.format\.md$/.exec(path)?.[1]
    if (name !== undefined) texts.set(name, text)
  }

  const order = linkOrder(texts)
  if (!order.ok) return order

  const bare: ParsedFormat[] = []
  for (const name of order.value) {
    const read = readFormatText(
      withoutAggregates(texts.get(name) ?? ''),
      SEEDED_UNITS,
      bare.map((each) => each.declaration),
    )
    if (!read.ok) return err(`The ledger's ${name}: ${read.error}`)
    if (read.value.declaration.name !== name) {
      return err(`${name}.format.md declares ${read.value.declaration.name}.`)
    }
    bare.push(read.value)
  }

  // A worked-out column over a format's own row (M36 U03) — a debt payment's
  // principal part — is one another format's total may fold, so it is read
  // before the totals are: every format that folds nothing, with its derived
  // table back, against the formats bare.
  for (const [index, each] of bare.entries()) {
    const text = texts.get(each.declaration.name) ?? ''
    if (!DERIVED_HEADER.test(text) || AGGREGATE_HEADER.test(text)) continue
    const read = readFormatText(withoutAggregates(text, { keepDerived: true }), SEEDED_UNITS, bare.map((one) => one.declaration))
    if (!read.ok) return err(`The ledger's ${each.declaration.name}: ${read.error}`)
    bare[index] = read.value
  }

  const everyone = bare.map((each) => each.declaration)
  const formats: ParsedFormat[] = []
  for (const each of bare) {
    const text = texts.get(each.declaration.name) ?? ''
    if (text === withoutAggregates(text)) {
      formats.push(each)
      continue
    }
    const read = readFormatText(text, SEEDED_UNITS, everyone)
    if (!read.ok) return err(`The ledger's ${each.declaration.name}: ${read.error}`)
    formats.push(read.value)
  }
  return ok(formats)
}

/**
 * A format's text with its aggregates and rule sets taken out — the first
 * pass's reading. Both name another format that link order may not have
 * reached yet (M25 E3, D-272; M25 E4, D-273). And where it has aggregates,
 * its identities, which may name one — the paycheck's `net` names `deducted`
 * (M25 U7) — with nothing said to hold until the second pass brings them.
 */
function withoutAggregates(text: string, options: { readonly keepDerived?: boolean } = {}): string {
  let lines = text.split('\n')
  const folds = lines.some((line) => AGGREGATE_HEADER.test(line.trim()))
  // A worked-out column may name a total, or a worked-out column of a format
  // link order has not reached (M36 U03): it waits for the second pass too.
  const headers = [
    AGGREGATE_HEADER,
    /^\|\s*rule set\s*\|/,
    ...(options.keepDerived === true ? [] : [DERIVED_HEADER]),
    ...(folds ? [IDENTITY_HEADER] : []),
  ]
  for (const header of headers) {
    const start = lines.findIndex((line) => header.test(line.trim()))
    if (start === -1) continue
    let end = start
    while (end < lines.length && (lines[end] ?? '').trim().startsWith('|')) end += 1
    lines = [...lines.slice(0, start), ...lines.slice(end)]
    if (header === IDENTITY_HEADER) lines = saysNothingHolds(lines)
  }
  return lines.join('\n')
}

const IDENTITY_HEADER = /^\|\s*(claim|identity)\s*\|/
const AGGREGATE_HEADER = /^\|\s*aggregate\s*\|/m
const DERIVED_HEADER = /^\|\s*derived\s*\|/m

/** The front matter's `claims: none`, which a format with its identities held back needs. */
function saysNothingHolds(lines: readonly string[]): string[] {
  const kept = lines.filter((line) => !/^(claims|checks):/.test(line.trim()))
  const language = kept.findIndex((line) => /^language:/.test(line.trim()))
  return [...kept.slice(0, language + 1), 'claims: none', ...kept.slice(language + 1)]
}

/** The formats, each after the ones its columns point at. Read off the columns table's `link` rows. */
function linkOrder(texts: ReadonlyMap<string, string>): Result<readonly string[], string> {
  const targets = new Map<string, readonly string[]>()
  for (const [name, text] of texts) {
    const pointsAt = text
      .split('\n')
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .filter((cells) => (cells[2] === 'link' || cells[2] === 'links') && cells[3] !== undefined && cells[3] !== name)
      .map((cells) => cells[3] ?? '')
    targets.set(name, pointsAt)
  }

  const order: string[] = []
  const visiting = new Set<string>()
  const visit = (name: string, path: readonly string[]): string | undefined => {
    if (order.includes(name)) return undefined
    if (visiting.has(name)) return `The ledger's formats link in a circle: ${[...path, name].join(' → ')}.`
    const pointsAt = targets.get(name)
    if (pointsAt === undefined) return `${path.at(-1) ?? ''} points at ${name}, which the pack does not declare.`
    visiting.add(name)
    for (const target of pointsAt) {
      const problem = visit(target, [...path, name])
      if (problem !== undefined) return problem
    }
    visiting.delete(name)
    order.push(name)
    return undefined
  }
  for (const name of [...texts.keys()].sort()) {
    const problem = visit(name, [])
    if (problem !== undefined) return err(problem)
  }
  return ok(order)
}

/**
 * The built-in category rules, as seeds of `category_rule` — from the rule
 * packs, so the rules are written once. A rule names its category by the id
 * migration 002 gave it, and a seed names it by the name, which is what
 * `seededCategoryIds.json` maps.
 *
 * **Named by the pack's own rule id**, `il.fuel.delek`, and not by the rule's
 * name: a built-in's name defaults to its pattern, and `דלק` is two rules of
 * two kinds. A seed is keyed by its name (D-264), so the name has to be the one
 * thing about a rule that is unique by construction.
 */
export function builtInRuleSeeds(declaration: FormatDeclaration): Result<ParsedFormat, string> {
  const names: Readonly<Record<string, string>> = SEEDED_IDS.category
  const rows: ParsedFormat['rows'][number][] = []
  for (const rule of BUILT_IN_RULES) {
    const target = names[rule.targetCategoryId]
    if (target === undefined) {
      return err(`The built-in rule ${rule.name} names ${rule.targetCategoryId}, which the pack does not seed.`)
    }
    rows.push({
      cells: {
        name: rule.id.slice(BUILT_IN_PREFIX.length),
        kind: rule.kind,
        pattern: rule.pattern,
        priority: rule.priority,
        origin: 'BUILT_IN',
        is_enabled: 1,
      },
      links: { target },
    })
  }
  return ok({ declaration, rows })
}

/**
 * **Formats the ledger declared once and no longer does** — M28 U1 (D-308).
 * Investments left the pack whole (D-283): securities, positions, prices,
 * trades, purchase plans, and the exchange rates only they read. And the
 * category groups (M28 F29, D-348): a group was a top-level category by
 * another name, so the groups became the top of the category tree. A
 * document that held them keeps them as its own, and its categories' `group`
 * column with them; nothing reads either. And the funds (M36 U12, D-389): a
 * fund is a holding, its reports are readings and their deposit tables are
 * `reading_deposit` rows, so a document that kept funds the old way keeps them
 * as its own, at `#/formats`, and they count in no total.
 */
export const RETIRED_FORMATS: readonly string[] = [
  'purchase_plan',
  'security_trade',
  'security_position',
  'security',
  'security_price',
  'fx_rate',
  'category_group',
  'fund_deposit',
  'fund_balance_snapshot',
  'fund_account',
]

/**
 * **What the pack rebuilds in a document declared before** — its vouch (M36
 * U08, U09). A document keeps the declaration it was given, and the install
 * grows it and never shrinks it, so a column a person added is never lost —
 * which also kept every column the pack itself retired, and every enum list it
 * outgrew, because the reconciler refuses to drop or re-constrain a column
 * holding data (D-216). Named here, the pack vouches for it, and the
 * reconciler rebuilds the table over it:
 *
 * - **`RETIRED`** — the column goes, with what it held. Each `why` is why
 *   nothing it held is needed: said elsewhere, or never read.
 * - **`RELISTED`** — the enum takes the pack's list, every value kept. A list
 *   that would refuse a value rows still hold is refused, by name.
 *
 * A held document's values are not converted: this project carries no old
 * document forward (2026-09-26).
 */
export const REBUILT_COLUMNS: readonly {
  readonly format: string
  readonly column: string
  readonly change: 'RETIRED' | 'RELISTED'
  readonly why: string
}[] = [
  {
    format: 'holding_place',
    column: 'account',
    change: 'RETIRED',
    // Every writer kept the two together (D-354, D-362): the place that named
    // an account held that account's own cash, and that holding names it still.
    why: 'A place is an account’s because the account’s own cash is in it, and that holding names the account.',
  },
  { format: 'account', column: 'kind', change: 'RELISTED', why: 'An account with holdings is a kind of its own, HOLDINGS.' },
  { format: 'account', column: 'holds_things', change: 'RETIRED', why: 'The kind says it now.' },
  {
    format: 'split_bucket',
    column: 'target_kind',
    change: 'RELISTED',
    why: 'A fund and an account are kinds of their own; FIXED_EXPENSES went with D-319.',
  },
  { format: 'split_plan', column: 'fixed_expense_mode', change: 'RETIRED', why: 'A plan_fixed_expense row says it (D-319).' },
  { format: 'split_plan', column: 'fixed_in_split', change: 'RETIRED', why: 'A plan_fixed_expense row says it (D-319).' },
  { format: 'split_plan', column: 'applied_to_period', change: 'RETIRED', why: 'A plan_month row says it (M31 U4).' },
  {
    format: 'fixed_expense',
    column: 'source',
    change: 'RELISTED',
    why: 'A detected bill not yet answered is worked out on read (billCandidates), never stored as DETECTED_PENDING.',
  },
  { format: 'category', column: 'monthly_target', change: 'RETIRED', why: 'A category’s monthly figure is its Plan bucket (D-327).' },
  { format: 'saving_goal', column: 'emergency_months', change: 'RETIRED', why: 'The cushion holds the months (D-360).' },
  { format: 'saving_goal', column: 'emergency_basis', change: 'RETIRED', why: 'The cushion holds the months (D-360).' },
  // A fund is a holding (D-389): what a line or a bucket pays into is `linked_holding`
  // and `target_holding`, and nothing is carried across — no old document is converted.
  { format: 'deduction_type', column: 'linked_fund_account', change: 'RETIRED', why: 'A fund is a holding: linked_holding (D-389).' },
  { format: 'split_bucket', column: 'target_fund', change: 'RETIRED', why: 'A fund is a holding: target_holding (D-389).' },
  {
    format: 'holding_place',
    column: 'kind',
    change: 'RELISTED',
    why: 'A pension or a study fund is a holding of its own, in no place (D-389).',
  },
]

/** What installing the pack did. */
export interface Installation {
  /** Formats this call declared. A format the document already declares is left as it is. */
  readonly declared: readonly string[]
  readonly seeded: ReadonlyMap<string, Seeding>
  /** Retired formats this call took away: the pack's, and empty. */
  readonly retired?: readonly string[]
  /** Retired formats holding rows, handed to the document: no longer the pack's, and nothing lost. */
  readonly released?: readonly string[]
}

/**
 * Take away what the pack no longer declares (D-308). A retired format the
 * pack still owns is locked — "only the pack can take it away" (D-269) — so
 * leaving it would lock a person out of a table nothing writes any more.
 *
 * **Empty, it goes**: a table the pack made and nobody filled. **Holding
 * rows, it is released**: the lock comes off, and the format is the
 * person's own from then on — to keep, re-link or delete at `#/formats`.
 * Nothing written is removed on anybody's behalf. A format of the same name
 * that a person declared themselves is not the pack's and is not touched.
 *
 * Retired formats point at one another — a price links its security and the
 * security folds its prices — so an empty one goes only when everything
 * still pointing at it goes too.
 */
function retire(db: Database, now: number): Result<{ retired: string[]; released: string[] }, string> {
  const owned = RETIRED_FORMATS.map((name) => readFormat(db, name)).filter(
    (each): each is FormatDeclaration => each !== undefined && each.owner?.pack === 'ledger',
  )
  const empty = new Set(owned.filter((each) => rowCountOf(db, each) === 0).map((each) => each.name))
  for (let changed = true; changed; ) {
    changed = false
    for (const name of [...empty]) {
      if (formatsPointingAt(db, name).some((other) => !empty.has(other))) {
        empty.delete(name)
        changed = true
      }
    }
  }
  const retired: string[] = []
  const released: string[] = []
  for (const declaration of owned) {
    if (empty.has(declaration.name)) {
      deleteFormat(db, declaration.name)
      retired.push(declaration.name)
      continue
    }
    const { owner: _gone, ...theirs } = declaration
    const plan = adoptFormat(db, theirs, now)
    if (plan.refusals.length > 0) {
      return err(`The ledger could not hand ${declaration.name} over: ${plan.refusals.map((each) => each.detail).join(' ')}`)
    }
    released.push(declaration.name)
  }
  return ok({ retired, released })
}

/**
 * Give a document the ledger's declarations and seeds. Idempotent: the second
 * run declares nothing and its seedings change nothing.
 *
 * Refuses rather than half-installing a format: a declaration the reconciler
 * will not adopt stops the install at that format, and says which. The formats
 * before it stay — each is whole on its own, and the next open carries on.
 */
export function installLedgerPack(db: Database, now: number): Result<Installation, string> {
  const formats = ledgerFormats()
  if (!formats.ok) return formats

  const declared: string[] = []
  for (const { declaration } of formats.value) {
    const held = readFormat(db, declaration.name)
    if (held !== undefined) {
      // A document declared before the pack grew a constraint gets it now, and
      // only that (M25 E1, D-270): the rest of what it holds — a person's own
      // column among them — is left as it is.
      // A rollup the pack added since is the same kind of growth (M25 E2,
      // D-271), and adding one changes no table at all.
      const keys = new Set((held.constraints ?? []).map(constraintKey))
      // A constraint that reads a column the document does not hold yet waits
      // for the step that brings the whole declaration up — U5's drop, for
      // `debt_payment.transaction` (D-279) — or its trigger would read a
      // column the table does not have.
      // And an optional column the pack grew since (M28 U7, D-319): a link a
      // bucket points at a fund or an account with. Optional, so no row is
      // asked for an answer, and only that kind of growth — a required column
      // on rows that exist is the reconciler's refusal, not the pack's to force.
      const newColumns = declaration.columns.filter(
        (each) => !held.columns.some((one) => one.name === each.name) && !each.required,
      )
      // And a column the pack has made optional since (M36 U08): the reconciler
      // keeps every value it holds, and a required column is a rule the pack
      // no longer asks the rows to keep. `holding.holding_place`, since an
      // account's own cash is in no place.
      const loosened = new Map(
        held.columns.flatMap((each) => {
          const theirs = declaration.columns.find((one) => one.name === each.name)
          return theirs !== undefined && each.required && !theirs.required ? [[each.name, { ...each, required: false }] as const] : []
        }),
      )
      // And what the pack rebuilds (M36 U09): a column it retired goes, with
      // what it held, and an enum it re-listed takes the pack's list.
      const rebuilt = REBUILT_COLUMNS.filter(
        (each) => each.format === declaration.name && held.columns.some((one) => one.name === each.column),
      )
      const retiredHere = new Set(rebuilt.filter((each) => each.change === 'RETIRED').map((each) => each.column))
      const relisted = new Map(
        rebuilt.flatMap((each) => {
          const was = held.columns.find((one) => one.name === each.column)
          const theirs = declaration.columns.find((one) => one.name === each.column)
          return each.change === 'RELISTED' && was !== undefined && theirs !== undefined && was.values.join() !== theirs.values.join()
            ? [[each.column, { ...was, values: theirs.values }] as const]
            : []
        }),
      )
      const holds = new Set([...held.columns, ...newColumns].map((each) => each.name).filter((name) => !retiredHere.has(name)))
      const missing = (declaration.constraints ?? []).filter(
        (each) =>
          !keys.has(constraintKey(each)) &&
          [...each.columns, ...(each.when === undefined ? [] : [each.when])].every((name) => holds.has(name)),
      )
      const rolled = new Set((held.rollups ?? []).map((each) => each.name))
      const newRollups = (declaration.rollups ?? []).filter((each) => !rolled.has(each.name))
      // And a rollup the pack has reworded since (M36 U04): the pack owns the
      // format (D-269), a rollup changes no table, and the statistics read its
      // filters — so an older sentence would be an older rule for what counts.
      const theirs = new Map((declaration.rollups ?? []).map((each) => [each.name, rollupText(each)]))
      const reworded = (held.rollups ?? []).some((each) => {
        const now = theirs.get(each.name)
        return now !== undefined && now !== rollupText(each)
      })
      // And the lock (M25 E5, D-269): a document declared before the pack
      // said it owns its formats takes it now, and a sentence the pack has
      // since reworded is the pack's to reword.
      const owned = sameOwner(held.owner, declaration.owner)
      if (
        missing.length === 0 &&
        newRollups.length === 0 &&
        newColumns.length === 0 &&
        loosened.size === 0 &&
        retiredHere.size === 0 &&
        relisted.size === 0 &&
        owned &&
        !reworded
      ) {
        continue
      }
      const grown = {
        ...held,
        language: Math.max(held.language, declaration.language),
        columns: [
          ...held.columns
            .filter((each) => !retiredHere.has(each.name))
            .map((each) => relisted.get(each.name) ?? loosened.get(each.name) ?? each),
          ...newColumns,
        ],
        constraints: [...(held.constraints ?? []).filter((each) => each.columns.every((name) => !retiredHere.has(name))), ...missing],
        ...(newRollups.length === 0 && !reworded
          ? {}
          : {
              rollups: [
                ...(held.rollups ?? []).map(
                  (each) => (declaration.rollups ?? []).find((one) => one.name === each.name) ?? each,
                ),
                ...newRollups,
              ],
            }),
        ...(declaration.owner === undefined ? {} : { owner: declaration.owner }),
      }
      const plan = adoptFormat(db, grown, now, new Map(), new Set([...retiredHere, ...relisted.keys()]))
      if (plan.refusals.length > 0) {
        return err(`The ledger's ${declaration.name} did not take its new constraints, rollups or lock: ${plan.refusals.map((each) => each.detail).join(' ')}`)
      }
      continue
    }
    // Its aggregates wait for the second pass: the format one folds may not
    // be declared yet (M25 E3, D-272) — and its rule sets, for the format one
    // sets (M25 E4, D-273), and its identities, which may name an aggregate
    // (M25 U7).
    const { ruleSets: _later, derived: _worked, ...withoutRules } = declaration
    const holdBack = declaration.aggregates.length > 0 && declaration.identities.length > 0
    const plan = adoptFormat(
      db,
      {
        ...withoutRules,
        aggregates: [],
        ...(holdBack ? { identities: [], nothingMustHold: true } : {}),
      },
      now,
    )
    if (plan.refusals.length > 0) {
      return err(`The ledger's ${declaration.name} was not declared: ${plan.refusals.map((each) => each.detail).join(' ')}`)
    }
    declared.push(declaration.name)
  }

  // **After the pack's own tables are rebuilt** (M36 U12): a column it retired
  // may be the one pointing at a format it retires — a deduction type's fund —
  // and a format still pointed at is handed over rather than taken away.
  const retirement = retire(db, now)
  if (!retirement.ok) return retirement

  // Every format is declared, so every aggregate's source is: add the ones a
  // format does not hold yet — all of them on a new document, and on an older
  // one only those the pack grew since (M25 E3, D-272). A figure changes no
  // table, so this plans nothing but the declaration.
  // A rule set is the same kind of growth: it names the format it sets, which
  // is declared by now (M25 E4, D-273).
  // Identities are the same growth, and come after the aggregates they may
  // name (M25 U7) — but only onto a declaration that holds every column the
  // pack's does: one still missing a column waits for the step that brings
  // the whole declaration up, for the reason a grown constraint does (D-279).
  // A format that folds nothing takes its worked-out columns first, so a total
  // over one finds it declared (M36 U03).
  const folding = (one: ParsedFormat): number => (one.declaration.aggregates.length === 0 ? 0 : 1)
  for (const { declaration } of [...formats.value].sort((a, b) => folding(a) - folding(b))) {
    const identities = declaration.identities
    const worked = declaration.derived ?? []
    if (
      declaration.aggregates.length === 0 &&
      (declaration.ruleSets ?? []).length === 0 &&
      identities.length === 0 &&
      worked.length === 0
    ) {
      continue
    }
    const held = readFormat(db, declaration.name)
    if (held === undefined) continue
    const folded = new Set(held.aggregates.map((each) => each.name))
    const grown = declaration.aggregates.filter((each) => !folded.has(each.name))
    const ruled = new Set((held.ruleSets ?? []).map((each) => each.name))
    const newRules = (declaration.ruleSets ?? []).filter((each) => !ruled.has(each.name))
    const holds = new Set(held.columns.map((each) => each.name))
    const whole = declaration.columns.every((each) => holds.has(each.name))
    const known = new Set(held.identities.map((each) => each.name))
    const newIdentities = whole ? identities.filter((each) => !known.has(each.name)) : []
    // Worked-out columns come with the totals they may name (M36 U03), and onto
    // a whole declaration only, for the reason an identity does.
    const derivedHeld = new Set((held.derived ?? []).map((each) => each.name))
    const newDerived = whole ? worked.filter((each) => !derivedHeld.has(each.name)) : []
    if (grown.length === 0 && newRules.length === 0 && newIdentities.length === 0 && newDerived.length === 0) continue
    const plan = adoptFormat(
      db,
      {
        ...held,
        language: Math.max(held.language, declaration.language),
        aggregates: [...held.aggregates, ...grown],
        identities: [...held.identities, ...newIdentities],
        ...(newIdentities.length === 0 ? {} : { nothingMustHold: false }),
        ...(newRules.length === 0 ? {} : { ruleSets: [...(held.ruleSets ?? []), ...newRules] }),
        ...(newDerived.length === 0 ? {} : { derived: [...(held.derived ?? []), ...newDerived] }),
      },
      now,
    )
    if (plan.refusals.length > 0) {
      return err(`The ledger's ${declaration.name} did not take its aggregates, claims, rule sets or computed columns: ${plan.refusals.map((each) => each.detail).join(' ')}`)
    }
  }

  const index = new Map(listFormats(db).map((each) => [each.name, each]))
  const seeded = new Map<string, Seeding>()
  for (const format of formats.value) {
    const seeds =
      format.declaration.name === 'category_rule' ? liveBuiltIns(db, format.declaration) : ok(format)
    if (!seeds.ok) return seeds
    if (seeds.value.rows.length === 0) continue
    const seeding = seedRows(db, seeds.value, index, (key) => seedIdOf(format.declaration.name, key))
    if (!seeding.ok) return err(`The ledger's ${format.declaration.name}: ${seeding.error}`)
    seeded.set(format.declaration.name, seeding.value)
  }

  // The questions a conversation starts from (M36 U06): a view the document
  // has none of that kind on that format is the pack's to give, and one it
  // has is its own, as a development document's are (D-303).
  const views = ledgerViews()
  if (!views.ok) return views
  const kept = new Set(listViewSettings(db).map((each) => `${each.format} ${each.view}`))
  restoreViewSettings(db, views.value.filter((each) => !kept.has(`${each.format} ${each.view}`)))

  return ok({
    declared,
    seeded,
    ...(retirement.value.retired.length === 0 ? {} : { retired: retirement.value.retired }),
    ...(retirement.value.released.length === 0 ? {} : { released: retirement.value.released }),
  })
}

/**
 * The id a new seed is written under, where the pack has one to keep. A
 * built-in rule keeps the id transactions name it by (M25 U2); a built-in
 * deduction type keeps the `ded:` id migration 012 gave it (M25 U7), which is
 * what a payslip template and the plugin's own guidance name it by — and a
 * seeded category or institution the `cat:` or `inst:` id its
 * migration gave it (M25 U8). Until U8 those came through U2's conversion of
 * the migration's own rows; with no old table left, the seed keeps them.
 */
function seedIdOf(format: string, key: string): string | undefined {
  if (format === 'category_rule') return `${BUILT_IN_PREFIX}${key}`
  if (!isSeededFormat(format)) return undefined
  const ids: Readonly<Record<string, string>> = SEEDED_IDS[format]
  return Object.keys(ids).find((id) => ids[id] === key)
}

function isSeededFormat(format: string): format is keyof typeof SEEDED_IDS {
  return Object.hasOwn(SEEDED_IDS, format)
}

/**
 * The built-in rules whose category this document has. A built-in naming a
 * category somebody deleted or renamed is not seeded — it was inert before its
 * rules were rows (D-046), and a seed linking to a name nothing answers would
 * refuse the whole format.
 */
function liveBuiltIns(db: Database, declaration: FormatDeclaration): Result<ParsedFormat, string> {
  const seeds = builtInRuleSeeds(declaration)
  if (!seeds.ok) return seeds
  const category = readFormat(db, 'category')
  const names = new Set(
    category === undefined ? [] : listRows(db, category).map((row) => String(row.cells['name'])),
  )
  return ok({ ...seeds.value, rows: seeds.value.rows.filter((row) => names.has(String(row.links['target'] ?? ''))) })
}

/**
 * **The views the ledger declares** (M36 U06), each naming a format and a
 * column it has — or the sentence saying which line does not. Today they are
 * its `start` views, the questions waiting on an answer: transfers to pair,
 * card bills to settle, payments to confirm. `start_here` answers them for a
 * ledger document the way it answers `docs/memory.emd`'s, and Home's waiting
 * list counts the same rows (`startCount`).
 */
export function ledgerViews(): Result<readonly ViewSetting[], string> {
  const read = readViews(VIEWS)
  if (!read.ok) return err(`The ledger's views: ${read.error}`)
  const formats = ledgerFormats()
  if (!formats.ok) return formats
  for (const view of read.value.views) {
    const declaration = formats.value.find((each) => each.declaration.name === view.format)?.declaration
    if (declaration?.columns.some((column) => column.name === view.column) !== true) {
      return err(`The ledger's ${view.format} ${view.view} names ${view.column}, which it has not got.`)
    }
  }
  return ok(read.value.views)
}

/** The names of the pack's formats — what a screen or a tool leaves out when it lists a person's own. */
export function ledgerFormatNames(): ReadonlySet<string> {
  const formats = ledgerFormats()
  return new Set(formats.ok ? formats.value.map((each) => each.declaration.name) : [])
}

/**
 * Whether this document keeps the ledger (D-266): the pack has seeded it. A
 * document it has not has never been a ledger, and the pack is not pushed on
 * it — keeping one is a person's choice about that file.
 *
 * **By what only the pack writes** (M25 U2). U1 asked whether the document
 * declared a format of the ledger's name, and a person's own format called
 * `debt` or `account` answered yes — and was then refused by the plugin as a
 * ledger awaiting conversion. A seed record is written by the pack alone.
 */
export function documentHasLedger(db: Database): boolean {
  const formats = ledgerFormats()
  if (formats.ok) {
    const names = formats.value.map((each) => each.declaration.name)
    const seeded = query(
      db,
      `SELECT 1 FROM format_seed WHERE format_name IN (${names.map(() => '?').join(', ')}) LIMIT 1`,
      names,
    )
    if (seeded.length > 0) return true
  }
  return false
}
