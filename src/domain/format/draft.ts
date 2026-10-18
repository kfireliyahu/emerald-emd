/**
 * **A format being edited** — M19 U2a, D-219.
 *
 * ## Why this file exists at all
 *
 * `#/formats` was driven on 2026-09-16 and rejected in about ten
 * seconds: it was a box you paste markdown into, and no user does that. The
 * fault was narrow — the types, the reconciler, the `fmt_` guard and all
 * five plugin tools sit on a `FormatDeclaration` and never see markdown — so
 * the fix is narrow too. **This is the missing half: the shape a declaration
 * takes while somebody is still typing it.**
 *
 * A `FormatDeclaration` is finished. `minimum` is a number or nothing; `values`
 * is a list; `unit` is a string or nothing. A person halfway through typing
 * `-5` has written `-`, which is neither a number nor nothing, and a form that
 * stored numbers would have to either reject that keystroke or quietly discard
 * it. **So a draft holds every field as the text it was typed as**, and turning
 * one into a declaration is a function with no React in it, which is the same
 * reason every other rule in this folder is testable without a browser.
 *
 * ## What a draft is not allowed to be
 *
 * It is not a second source of truth. Nothing is stored in this shape, nothing
 * reads it back, and it never reaches SQL: `declarationOf` is the only way out
 * of it and `declarationRejection` still governs what may be adopted. A draft
 * that could be saved without becoming a declaration first would be the untyped
 * storage D-209 rejected, arriving through the editor instead of the schema.
 */

import {
  column,
  isChoiceType,
  isLinkType,
  isListType,
  UNIQUE_TYPES,
  DECLARATION_LANGUAGE,
  declarationProblems,
  type ColumnDeclaration,
  type ColumnType,
  type DeclarationProblem,
  type FormatAspect,
  type FormatDeclaration,
} from './declaration.ts'
import {
  aggregate,
  isOrdered,
  type AggregateDeclaration,
  type AggregateFilter,
  type AggregateKind,
} from './aggregate.ts'
import { SEEDED_UNITS, type UnitTable } from './unit.ts'
import { identity, renameInExpression, type IdentityDeclaration, type Tolerance } from './identity.ts'
import type { RowConstraint } from './constraint.ts'
import { declarationChangeRefusal, type FormatOwner } from './owner.ts'
import type { RollupDeclaration } from './rollup.ts'
import type { RuleSetDeclaration } from './rule.ts'
import type { FoundBy } from './foundBy.ts'
import { workedOutColumn } from './workedOut.ts'

/**
 * One column, as typed.
 *
 * `key` is local identity and is **never stored**. React needs a stable key
 * across a rename, and a problem needs to name the column it is about — and the
 * one case where two problems are genuinely about different columns is the case
 * where both columns are called the same thing, which is exactly where the name
 * stops being an identity.
 */
export interface ColumnDraft {
  readonly key: string
  readonly name: string
  readonly type: ColumnType
  /** The format a `link` points at, as picked. Empty for every other type. */
  readonly target: string
  readonly unit: string
  /** The other half of a ratio — this column is `unit` per `per` (U4c, D-225). */
  readonly per: string
  readonly required: boolean
  /**
   * Carried rather than edited (M24 U4, D-255): the form has no control for it
   * until M26, and a draft that dropped it would make saving an unrelated edit
   * quietly take a declared constraint away.
   */
  readonly unique: boolean
  /**
   * The places a `decimal` keeps, as typed (M24 U6, D-257). **No control draws
   * it until M26**: a column re-typed to decimal on screen takes 2, and one
   * declared by a tool keeps the scale it was given through any edit here.
   */
  readonly scale: string
  /** The enum's members, comma-separated, exactly as typed. */
  readonly values: string
  readonly minimum: string
  readonly maximum: string
  readonly note: string
  /**
   * How a `link` is filled while it is empty (M29 F8, D-350) — set on the
   * Connections panel and carried through every edit here, so saving an
   * unrelated change does not quietly take it away. Optional so a draft
   * written before it needs none.
   */
  readonly foundBy?: FoundBy | undefined
}

/**
 * One identity, as typed (U3, D-222).
 *
 * The tolerance is two fields rather than one because it is two questions —
 * how far apart, and whether that is an amount or a percentage — and a single
 * `± 2%` text box would be a parser in a form field.
 *
 * **The expression stays text and is the only storage**, which is what lets a
 * screen draw it — as a balance for a row's verdict (D-232), and as *this
 * column worked out from these parts* while it is being written (D-236) —
 * without inventing a second representation for it. Every picture is read out
 * of this string and written back into it, so a conversation and a screen keep
 * writing the same characters.
 */
export interface IdentityDraft {
  readonly key: string
  readonly name: string
  readonly expression: string
  readonly toleranceKind: Tolerance['kind']
  /** As typed: `2`, `2.5`, or empty, which is exact. */
  readonly amount: string
  readonly note: string
}

/**
 * One aggregate, as typed (U4b, D-224).
 *
 * `over` is two fields rather than the artefact's one `recipe_line.recipe`,
 * because in a form they are two choices and the second depends on the first —
 * pick the format, then pick which of its links points back here. The text
 * form is for a file a person diffs; a form has room to be unambiguous.
 */
export interface AggregateDraft {
  readonly key: string
  readonly name: string
  readonly kind: AggregateKind
  readonly overFormat: string
  /** Its link pointing back here — empty for every row of it (M34 U4, D-397). */
  readonly overColumn: string
  readonly expression: string
  readonly unit: string
  readonly note: string
  /**
   * The filter (M24 U8, D-260), **carried and not shown** — as the row
   * constraints are. No screen says `where` before M26, and a form that
   * dropped what it could not show would widen a figure on the next save.
   */
  readonly where?: AggregateFilter | undefined
  /**
   * The column a `LATEST` or `EARLIEST` picks by (M25 E3, D-272) — empty for
   * every other kind, which the editor blanks on a change of kind as it blanks
   * a `COUNT`'s expression.
   */
  readonly by: string
}

/** One format, as typed. */
/**
 * A derived column being written (M29 U3b, D-334) — a name and what it works
 * out, declared from a column's header in the same panel as a stored one.
 */
export interface DerivedDraft {
  readonly key: string
  readonly name: string
  readonly expression: string
  readonly note: string
}

export interface FormatDraft {
  readonly name: string
  readonly title: string
  readonly notes: string
  readonly columns: readonly ColumnDraft[]
  readonly identities: readonly IdentityDraft[]
  readonly aggregates: readonly AggregateDraft[]
  /** Columns worked out rather than typed (D-334). Optional: most drafts have none. */
  readonly derived?: readonly DerivedDraft[]
  /**
   * The row constraints (M24 U7, D-259), **carried and not shown** — the form
   * has no control for one until M26, so an edit made on screen keeps them as
   * they were, and one that renames a column they name is refused at the
   * format rather than quietly dropping the rule.
   */
  readonly constraints?: readonly RowConstraint[]
  /**
   * The rollups (D-271), the rule sets (D-273) and which pack owns the format
   * (D-269) — carried and not shown, for the constraints' reason. Before M25
   * E5 the first two were dropped here, so an edit on screen took a format's
   * rollups and rule sets away with nobody told.
   */
  readonly rollups?: readonly RollupDeclaration[]
  readonly ruleSets?: readonly RuleSetDeclaration[]
  readonly owner?: FormatOwner
  /**
   * The format this draft is a revision of, or nothing for a new one.
   *
   * Two things turn on it. A format is checked against its *neighbours* for a
   * duplicate name, and its own name is not one of them. And **the name of an
   * existing format is not editable**: it is what the table is called and what
   * the declaration is keyed by, so a rename reaches the reconciler as a new
   * format beside an abandoned one. Not offering it is cheaper than a rename
   * nobody asked for — D-214's *refuse rather than guess*, in the editor.
   */
  readonly revising: string | undefined
}

/** A derived column with nothing in it yet. */
export function newDerived(): DerivedDraft {
  return { key: nextKey(), name: '', expression: '', note: '' }
}

/** A column with nothing in it yet. `text` because it is the type that needs no other field. */
export function newColumn(): ColumnDraft {
  return {
    key: nextKey(),
    name: '',
    type: 'text',
    target: '',
    unit: '',
    per: '',
    required: false,
    unique: false,
    scale: '',
    values: '',
    minimum: '',
    maximum: '',
    note: '',
  }
}

/** An identity with nothing in it yet. Absolute and exact is the resting state. */
export function newIdentity(): IdentityDraft {
  return {
    key: nextKey(),
    name: '',
    expression: '',
    toleranceKind: 'ABSOLUTE',
    amount: '',
    note: '',
  }
}

/**
 * An aggregate with nothing in it yet. `SUM` because it is the one the engine's
 * line names, and the one every other kind is a variation on.
 */
export function newAggregate(): AggregateDraft {
  return {
    key: nextKey(),
    name: '',
    kind: 'SUM',
    overFormat: '',
    overColumn: '',
    expression: '',
    unit: '',
    note: '',
    by: '',
  }
}

/**
 * A new format, with one empty column already in it.
 *
 * Not zero: a format with no columns is refused, and an editor that opens
 * showing a refusal nobody caused is nagging rather than helpful.
 *
 * **No empty identity, though**: a format must have columns and may have no
 * identity at all, so one here would be the editor answering the question it
 * is supposed to ask.
 */
export function newDraft(): FormatDraft {
  return {
    name: '',
    title: '',
    notes: '',
    columns: [newColumn()],
    identities: [],
    aggregates: [],
    revising: undefined,
  }
}

/** An existing format, opened for editing. */
export function draftOf(declaration: FormatDeclaration): FormatDraft {
  return {
    name: declaration.name,
    title: declaration.title,
    notes: declaration.notes,
    revising: declaration.name,
    ...(declaration.constraints === undefined ? {} : { constraints: declaration.constraints }),
    ...(declaration.rollups === undefined ? {} : { rollups: declaration.rollups }),
    ...(declaration.ruleSets === undefined ? {} : { ruleSets: declaration.ruleSets }),
    ...(declaration.owner === undefined ? {} : { owner: declaration.owner }),
    ...(declaration.derived === undefined
      ? {}
      : {
          derived: declaration.derived.map((each) => ({
            key: nextKey(),
            name: each.name,
            expression: each.expression,
            note: each.note,
          })),
        }),
    identities: declaration.identities.map((each) => ({
      key: nextKey(),
      name: each.name,
      expression: each.expression,
      toleranceKind: each.tolerance.kind,
      amount: String(
        each.tolerance.kind === 'ABSOLUTE' ? each.tolerance.amount : each.tolerance.percent,
      ),
      note: each.note,
    })),
    aggregates: declaration.aggregates.map((each) => ({
      key: nextKey(),
      name: each.name,
      kind: each.kind,
      overFormat: each.over.format,
      // Empty for every row of the source (M34 U4, D-397).
      overColumn: each.over.column ?? '',
      expression: each.expression,
      unit: each.unit ?? '',
      note: each.note,
      ...(each.where === undefined ? {} : { where: each.where }),
      by: each.by ?? '',
    })),
    columns: declaration.columns.map((each) => ({
      key: nextKey(),
      name: each.name,
      type: each.type,
      target: each.target ?? '',
      unit: each.unit ?? '',
      per: each.per ?? '',
      required: each.required,
      unique: each.unique,
      scale: each.scale === undefined ? '' : String(each.scale),
      values: each.values.join(', '),
      minimum: each.minimum === undefined ? '' : String(each.minimum),
      maximum: each.maximum === undefined ? '' : String(each.maximum),
      note: each.note,
      ...(each.foundBy === undefined ? {} : { foundBy: each.foundBy }),
    })),
  }
}

/**
 * The declaration a draft is describing.
 *
 * **Total on purpose**: every draft becomes a declaration, and whether that
 * declaration is any good is `declarationProblems`' question rather than this
 * one's. Splitting "can it be read" from "is it allowed" is the separation the
 * artefact reader already keeps, and it is what lets the plan and the problems
 * both be drawn from one pass while somebody types.
 *
 * `abc` in a minimum therefore becomes `NaN`, which is a number that is not
 * finite, which is a sentence `columnRejection` already knows how to say.
 */
export function declarationOf(draft: FormatDraft): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name: draft.name.trim(),
    title: draft.title.trim(),
    notes: draft.notes,
    columns: draft.columns.map(columnOf),
    identities: draft.identities.map(identityOf),
    aggregates: draft.aggregates.map(aggregateOf),
    ...(draft.constraints === undefined || draft.constraints.length === 0
      ? {}
      : { constraints: draft.constraints }),
    ...(draft.rollups === undefined || draft.rollups.length === 0 ? {} : { rollups: draft.rollups }),
    ...(draft.ruleSets === undefined || draft.ruleSets.length === 0 ? {} : { ruleSets: draft.ruleSets }),
    ...(draft.owner === undefined ? {} : { owner: draft.owner }),
    ...(draft.derived === undefined || draft.derived.length === 0
      ? {}
      : {
          derived: draft.derived.map((each) => ({
            name: each.name.trim(),
            expression: each.expression.trim(),
            note: each.note,
          })),
        }),
    // **A draft with no identity says nothing has to add up** (M29 F4, D-345).
    // The editor asked for it out loud — a *Nothing does* button — and the
    // verdict was *"why do we need the nothing does add up button?
    // just let the user continue"*. Pressing Create or Save on a format with
    // no identity is the saying — and since M38 U5 (D-411) the plugin sets it
    // the same way, from no identities.
    nothingMustHold: draft.identities.length === 0,
  }
}

function aggregateOf(draft: AggregateDraft): AggregateDeclaration {
  const unit = draft.unit.trim()
  return aggregate(
    draft.name.trim(),
    draft.kind,
    // An empty column is every row of the source (M34 U4, D-397) — chosen as
    // such on Connections, the one place a total is made on a screen.
    draft.overColumn.trim() === ''
      ? { format: draft.overFormat.trim() }
      : { format: draft.overFormat.trim(), column: draft.overColumn.trim() },
    {
      // A `COUNT` keeps neither, and the editor blanks them on the way in
      // rather than at the last moment: a person who typed an expression and
      // then switched to counting should see it go, the same way `retype`
      // already clears a bound that stopped meaning anything.
      expression: draft.kind === 'COUNT' ? '' : draft.expression.trim(),
      unit: draft.kind === 'COUNT' || unit === '' ? undefined : unit,
      note: draft.note,
      where: draft.where,
      by: isOrdered(draft.kind) && draft.by.trim() !== '' ? draft.by.trim() : undefined,
    },
  )
}

function identityOf(draft: IdentityDraft): IdentityDeclaration {
  const amount = draft.amount.trim() === '' ? 0 : Number(draft.amount.trim())
  return identity(draft.name.trim(), draft.expression.trim(), {
    tolerance:
      draft.toleranceKind === 'RELATIVE'
        ? { kind: 'RELATIVE', percent: amount }
        : { kind: 'ABSOLUTE', amount },
    note: draft.note,
  })
}

function columnOf(draft: ColumnDraft): ColumnDeclaration {
  const unit = draft.unit.trim()
  const per = draft.per.trim()
  const target = draft.target.trim()
  return column(draft.name.trim(), draft.type, {
    target: isLinkType(draft.type) ? target : undefined,
    unit: unit === '' ? undefined : unit,
    per: per === '' ? undefined : per,
    required: draft.required,
    unique: draft.unique,
    scale: draft.type === 'decimal' ? boundOf(draft.scale) : undefined,
    values: membersOf(draft.values),
    minimum: boundOf(draft.minimum),
    maximum: boundOf(draft.maximum),
    note: draft.note,
    foundBy: draft.type === 'link' ? draft.foundBy : undefined,
  })
}

/**
 * `a, b, c` as three members.
 *
 * Empty pieces are dropped rather than refused, because a trailing comma is
 * something a person types on the way to the next member and not a mistake they
 * want reported. The artefact reader still refuses an empty member, where it
 * means a blank cell in a table somebody wrote on purpose.
 */
function membersOf(text: string): readonly string[] {
  return text
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '')
}

/** Blank is *no bound*; anything else is a number, even when it is not one. */
function boundOf(text: string): number | undefined {
  const trimmed = text.trim()
  return trimmed === '' ? undefined : Number(trimmed)
}

/**
 * A column re-typed, with everything the new type cannot carry cleared.
 *
 * The one thing a form can do that a text box cannot. A `real` with bounds
 * switched to `text` would otherwise keep them and be refused for holding a
 * bound it no longer shows — a control with a hidden second state, which is the
 * shape of every confirm-surface bug D-138 keeps finding.
 *
 * `money` loses its unit for a reason of its own: a currency lives in the row,
 * so a unit on a money column is a second, quieter place for it to be written.
 */
export function retype(draft: ColumnDraft, type: ColumnType): ColumnDraft {
  return {
    ...draft,
    type,
    unit: acceptsUnit(type) ? draft.unit : '',
    per: acceptsRatio(type) ? draft.per : '',
    values: isChoiceType(type) ? draft.values : '',
    minimum: acceptsBounds(type) ? draft.minimum : '',
    maximum: acceptsBounds(type) ? draft.maximum : '',
    target: isLinkType(type) ? draft.target : '',
    // A list cannot be required (M27 U2, D-300; M34 U5, D-398).
    required: isListType(type) ? false : draft.required,
    unique: UNIQUE_TYPES.has(type) ? draft.unique : false,
    scale: type === 'decimal' ? (draft.scale === '' ? DEFAULT_SCALE : draft.scale) : '',
    foundBy: type === 'link' ? draft.foundBy : undefined,
  }
}

/** The places a column re-typed to `decimal` on screen keeps — a price's two. */
const DEFAULT_SCALE = '2'

/** Whether a bound means anything on this type. A minimum on a brand name does not. */
export function acceptsBounds(type: ColumnType): boolean {
  return type === 'integer' || type === 'real' || type === 'decimal' || type === 'percent'
}

/**
 * Whether a unit means anything on this type. See `retype` for why money is out.
 *
 * A link is out for a nearer reason: it holds an id, and an id is not in
 * anything. **A quantity is out for the opposite reason to all of them** (U4c,
 * D-225): its unit is in every row, and a second one declared on the column
 * would be a quieter place for the same fact to be written. A percent is a
 * share, which is not in anything (D-333).
 */
export function acceptsUnit(type: ColumnType): boolean {
  return (
    type !== 'money' &&
    !isLinkType(type) &&
    type !== 'quantity' &&
    type !== 'percent' &&
    type !== 'time' &&
    type !== 'enums' &&
    type !== 'elsewhere' &&
    type !== 'file'
  )
}

/**
 * Whether this type can be *one unit per another* — a density, what one of them
 * weighs (U4c, D-225).
 *
 * A ratio is a plain number, so it is the two types that hold one. The control
 * is only on the screen for those, which is the same rule bounds and members
 * already follow: **a control a type cannot use is not there.**
 */
export function acceptsRatio(type: ColumnType): boolean {
  return type === 'integer' || type === 'real' || type === 'decimal'
}

/** Where a problem belongs on the screen. */
export type DraftLocation =
  /** The declaration itself, and which part of it (T1, D-237). */
  | { readonly kind: 'FORMAT'; readonly about: FormatAspect | undefined }
  | { readonly kind: 'COLUMN'; readonly key: string }
  | { readonly kind: 'IDENTITY'; readonly key: string }
  | { readonly kind: 'AGGREGATE'; readonly key: string }
  | { readonly kind: 'DERIVED'; readonly key: string }

export interface DraftProblem {
  readonly where: DraftLocation
  readonly message: string
}

/**
 * Everything wrong with a draft, each attached to the field that caused it.
 *
 * **This is the unit's whole claim.** The same sentences as before, from the
 * same function as before — `declarationProblems` stays the one authority on
 * what a declaration may be, and nothing here re-states a rule. What changes is
 * that each sentence arrives with somewhere to be drawn, so a person reads *"the
 * column sodium_mg has a minimum that is not a number"* beside `sodium_mg`
 * instead of underneath a box holding thirty-one columns.
 *
 * `existing` is every format in the document, this one included: a draft
 * revising `ingredient` is not a duplicate of `ingredient`, and filtering that
 * here means no caller has to remember to.
 */
export function draftProblems(
  draft: FormatDraft,
  existing: readonly FormatDeclaration[] = [],
  units: UnitTable = SEEDED_UNITS,
): readonly DraftProblem[] {
  const neighbours = existing.filter((each) => each.name !== draft.revising)
  const declaration = declarationOf(draft)
  // A pack's format takes a person's own column and keeps the pack's (D-269).
  const before = existing.find((each) => each.name === draft.revising)
  const owned = before === undefined ? undefined : declarationChangeRefusal(before, declaration)
  const problems = [
    ...declarationProblems(declaration, neighbours, units),
    ...(owned === undefined ? [] : [{ columnIndex: undefined, about: 'COLUMNS' as const, message: owned }]),
    ...(before === undefined ? [] : neighbourProblems(declaration, before, neighbours, units)),
  ]
  return problems.map((problem) => {
    const columnKey =
      problem.columnIndex === undefined ? undefined : draft.columns[problem.columnIndex]?.key
    if (columnKey !== undefined) {
      return { where: { kind: 'COLUMN' as const, key: columnKey }, message: problem.message }
    }
    const identityKey =
      problem.identityIndex === undefined ? undefined : draft.identities[problem.identityIndex]?.key
    if (identityKey !== undefined) {
      return { where: { kind: 'IDENTITY' as const, key: identityKey }, message: problem.message }
    }
    const aggregateKey =
      problem.aggregateIndex === undefined
        ? undefined
        : draft.aggregates[problem.aggregateIndex]?.key
    if (aggregateKey !== undefined) {
      return { where: { kind: 'AGGREGATE' as const, key: aggregateKey }, message: problem.message }
    }
    const derivedKey =
      problem.derivedIndex === undefined ? undefined : draft.derived?.[problem.derivedIndex]?.key
    if (derivedKey !== undefined) {
      return { where: { kind: 'DERIVED' as const, key: derivedKey }, message: problem.message }
    }
    return {
      where: { kind: 'FORMAT' as const, about: problem.about },
      message: problem.message,
    }
  })
}

/**
 * **What a change to one format breaks in the others** (M26 U3).
 *
 * A column renamed, retyped or removed may be one another format reads —
 * `ingredient.kcal` in an identity, a total folded over it — and the edit is
 * on this format's sheet, where nothing of the other is on the screen. So each
 * neighbour is judged against the format as it would be and as it is, and a
 * problem only the new one causes is this edit's, worded with the neighbour's
 * name. One that was already there is not this edit's to report.
 */
function neighbourProblems(
  declaration: FormatDeclaration,
  before: FormatDeclaration,
  neighbours: readonly FormatDeclaration[],
  units: UnitTable,
): readonly DeclarationProblem[] {
  const rest = (other: FormatDeclaration): readonly FormatDeclaration[] =>
    neighbours.filter((each) => each.name !== other.name)
  return neighbours.flatMap((other) => {
    const was = new Set(
      declarationProblems(other, [...rest(other), before], units).map(
        (each) => each.message,
      ),
    )
    return declarationProblems(other, [...rest(other), declaration], units)
      .filter((each) => !was.has(each.message))
      .map((each) => ({
        columnIndex: undefined,
        about: 'COLUMNS' as const,
        message: `${other.title} would break: ${each.message}`,
      }))
  })
}

/**
 * The columns a draft renamed, **new name to old** — what `adoptFormat` takes
 * so a column keeps its values under its new name (M26 U3).
 *
 * `origin` is each column's name by the key `draftOf` gave it, taken when the
 * draft was opened. A key that was not there is a new column and a key that is
 * gone is a removed one; only a key that stayed and changed its name is a
 * rename, which is what keeps *rename* from being a guess.
 */
export function renamesOf(
  draft: FormatDraft,
  origin: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const renames = new Map<string, string>()
  for (const column of draft.columns) {
    const was = origin.get(column.key)
    const now = column.name.trim()
    if (was !== undefined && now !== '' && now !== was) renames.set(now, was)
  }
  return renames
}

/**
 * The draft with what it says about a renamed column following the rename —
 * every identity's expression (M26 U3). A rename that left `grams` in an
 * identity would turn a rename into a refusal for a reason nobody typed.
 */
export function followingRenames(
  draft: FormatDraft,
  renames: ReadonlyMap<string, string>,
): FormatDraft {
  if (renames.size === 0) return draft
  const follow = (text: string): string =>
    [...renames].reduce((written, [to, from]) => renameInExpression(written, from, to), text)
  const renamed = new Map([...renames].map(([to, from]) => [from, to]))
  return {
    ...draft,
    // A link found by a date names that date by its name (D-350).
    columns: draft.columns.map((each) =>
      each.foundBy === undefined || !renamed.has(each.foundBy.from)
        ? each
        : { ...each, foundBy: { ...each.foundBy, from: renamed.get(each.foundBy.from) ?? each.foundBy.from } },
    ),
    identities: draft.identities.map((each) => ({ ...each, expression: follow(each.expression) })),
    // A derived column reads columns by name too (D-334).
    ...(draft.derived === undefined
      ? {}
      : { derived: draft.derived.map((each) => ({ ...each, expression: follow(each.expression) })) }),
  }
}

/**
 * `followingRenames` for a declaration rather than a draft — what a rename a
 * conversation asks for follows (M38 U6, D-412), so the two halves rewrite the
 * same things: a link's `found_by` date, each identity, each derived column.
 */
export function declarationFollowingRenames(
  declaration: FormatDeclaration,
  renames: ReadonlyMap<string, string>,
): FormatDeclaration {
  if (renames.size === 0) return declaration
  const follow = (text: string): string =>
    [...renames].reduce((written, [to, from]) => renameInExpression(written, from, to), text)
  const renamed = new Map([...renames].map(([to, from]) => [from, to]))
  return {
    ...declaration,
    columns: declaration.columns.map((each) =>
      each.foundBy === undefined || !renamed.has(each.foundBy.from)
        ? each
        : { ...each, foundBy: { ...each.foundBy, from: renamed.get(each.foundBy.from) ?? each.foundBy.from } },
    ),
    identities: declaration.identities.map((each) => ({ ...each, expression: follow(each.expression) })),
    ...(declaration.derived === undefined
      ? {}
      : { derived: declaration.derived.map((each) => ({ ...each, expression: follow(each.expression) })) }),
  }
}

/**
 * What changing `before` into `declaration` breaks in the other formats, each
 * sentence naming the one it breaks — the screen's check, for a conversation
 * (M38 U6, D-412).
 */
export function neighbourBreaks(
  declaration: FormatDeclaration,
  before: FormatDeclaration,
  existing: readonly FormatDeclaration[],
  units: UnitTable = SEEDED_UNITS,
): readonly string[] {
  const neighbours = existing.filter((each) => each.name !== before.name)
  return neighbourProblems(declaration, before, neighbours, units).map((each) => each.message)
}

/** Each column's name by its key — `renamesOf`'s `origin`, taken when a draft opens. */
export function originOf(draft: FormatDraft): ReadonlyMap<string, string> {
  return new Map(draft.columns.map((column) => [column.key, column.name]))
}

/** Whether a column of this type can be made unique (D-255). */
export function acceptsUnique(type: ColumnType): boolean {
  return UNIQUE_TYPES.has(type)
}

/**
 * Whether nothing has been typed into this column yet.
 *
 * **A form that opens red is nagging, not helpful.** Every problem here is
 * worth drawing the moment it is caused — but "a column needs a name" is not
 * caused by anybody; it is the state a new column starts in, and reporting it
 * before the person has reached that row spends `negative` on something they
 * are already on their way to doing.
 *
 * A predicate over the draft rather than a `touched` flag, because that is the
 * version with no bookkeeping to get wrong: a column somebody typed into and
 * then emptied again is blank, and asking about it again is correct.
 */
export function columnIsBlank(column: ColumnDraft): boolean {
  return (
    column.name.trim() === '' &&
    column.unit.trim() === '' &&
    column.values.trim() === '' &&
    column.minimum.trim() === '' &&
    column.maximum.trim() === '' &&
    column.note.trim() === '' &&
    !column.required
  )
}

/**
 * The draft without the columns nobody filled in — what Create declares
 * (M29 U1, D-331).
 *
 * Applied on the way to the document rather than as you type, so a column
 * you are halfway through is never taken away from under you. Moved here from
 * the walk when the walk went; nothing to prune is the same object.
 */
export function pruned(draft: FormatDraft): FormatDraft {
  const kept = draft.columns.filter((each) => !columnIsBlank(each))
  return kept.length === draft.columns.length ? draft : { ...draft, columns: kept }
}

/**
 * **A column moved** — M29 U2, D-332. `key` lands just before the column whose
 * key is `before`, or last when `before` is `undefined` or names no column of
 * the draft. Moving a column onto itself, or to where it already is, hands
 * back the same draft, so a drop that changed nothing is not a change to save.
 *
 * The order is the declaration's (`columns` is a list, and every surface draws
 * it as written), so this is the whole of what a move is: no table changes and
 * no entry does. What it can change is which column the entries are *called*
 * by — the first `text` one — and `orderChange` says so before anything saves.
 */
export function moveColumn(draft: FormatDraft, key: string, before: string | undefined): FormatDraft {
  const moving = draft.columns.find((each) => each.key === key)
  if (moving === undefined || before === key) return draft
  const rest = draft.columns.filter((each) => each.key !== key)
  const at = before === undefined ? -1 : rest.findIndex((each) => each.key === before)
  const columns = at === -1 ? [...rest, moving] : [...rest.slice(0, at), moving, ...rest.slice(at)]
  return columns.every((each, index) => each.key === draft.columns[index]?.key)
    ? draft
    : { ...draft, columns }
}

/** The same question for the format's own two fields. See `columnIsBlank`. */
export function headIsBlank(draft: FormatDraft): boolean {
  return draft.name.trim() === '' && draft.title.trim() === ''
}

/* ------------------------------------------------- what has to add up (T4) */

/**
 * How close an identity has to come, as the surface asks it (T4, D-236).
 *
 * Three answers, not two fields: **exactly**, *within a number*, *within a
 * percent*. A `Tolerance` already says all three — `ABSOLUTE 0` is exact — and
 * this is the reading of it that a question can be asked in, derived rather
 * than stored so the draft keeps one shape for the tolerance and not two.
 */
export type Closeness = 'EXACT' | 'AMOUNT' | 'PERCENT'

/** Which of the three an identity currently says. */
export function closenessOf(draft: IdentityDraft): Closeness {
  if (draft.toleranceKind === 'RELATIVE') return 'PERCENT'
  const amount = draft.amount.trim()
  return amount === '' || Number(amount) === 0 ? 'EXACT' : 'AMOUNT'
}

/**
 * The same identity, answering the other way.
 *
 * **A blank allowance gets a `1`** when the answer stops being *exactly*, and
 * the reason is that `closenessOf` reads a blank one back as exact: leaving the
 * box empty would make the question answer itself again the moment it was
 * asked. A figure that is visible and editable is the honest version of that,
 * the way an empty column select would be.
 */
export function withCloseness(draft: IdentityDraft, closeness: Closeness): IdentityDraft {
  if (closeness === 'EXACT') return { ...draft, toleranceKind: 'ABSOLUTE', amount: '' }
  const kind = closeness === 'PERCENT' ? 'RELATIVE' : 'ABSOLUTE'
  const amount = closenessOf(draft) === 'EXACT' ? '1' : draft.amount
  return { ...draft, toleranceKind: kind, amount }
}

/**
 * Every identity the per-column questions do not show — the text box's list.
 *
 * `answerable` is the columns being asked about, and an identity answering
 * anything else belongs here whatever its shape: a column that has since been
 * renamed or retyped leaves a real identity behind, and an identity nothing
 * draws is the failure mode this split exists to avoid.
 */
export function freehandIdentities(
  draft: FormatDraft,
  answerable: readonly string[],
): readonly IdentityDraft[] {
  const answered = new Set<string>()
  return draft.identities.filter((each) => {
    const column = workedOutColumn(each.expression)
    if (column === undefined || !answerable.includes(column) || answered.has(column)) return true
    answered.add(column)
    return false
  })
}

/** Whether nothing has been typed into this identity yet. See `columnIsBlank`. */
export function identityIsBlank(draft: IdentityDraft): boolean {
  return (
    draft.name.trim() === '' &&
    draft.expression.trim() === '' &&
    draft.amount.trim() === '' &&
    draft.note.trim() === ''
  )
}

/** The problems belonging to one identity, in order. */
export function problemsOfIdentity(
  problems: readonly DraftProblem[],
  key: string,
): readonly DraftProblem[] {
  return problems.filter((each) => each.where.kind === 'IDENTITY' && each.where.key === key)
}

/** The problems belonging to one aggregate, in order (U4b). */
export function problemsOfAggregate(
  problems: readonly DraftProblem[],
  key: string,
): readonly DraftProblem[] {
  return problems.filter((each) => each.where.kind === 'AGGREGATE' && each.where.key === key)
}

/** The problems belonging to one column, in order. */
export function problemsOfColumn(
  problems: readonly DraftProblem[],
  key: string,
): readonly DraftProblem[] {
  return problems.filter((each) => each.where.kind === 'COLUMN' && each.where.key === key)
}

/**
 * `Sat fat (g)` as `sat_fat_g`, for the moment a name is first typed.
 *
 * A suggestion and never a correction: it fills a name field that is still
 * empty and stops the instant one is touched, because silently rewriting what
 * somebody typed into a column name is how a table ends up with a column nobody
 * chose. `columnRejection` still has the final word.
 *
 * Empty when the slug would not start with a letter, which is the one rule a
 * suggestion cannot satisfy by trimming — `2_percent_milk` has no good guess.
 */
export function suggestedName(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(slug) ? slug.slice(0, 48) : ''
}

/**
 * What to call the identity that works `column` out (T4, D-236).
 *
 * **Shown, never asked for** — the same rule the format's own `snake_case` name
 * follows. A verdict is reported by this name (`verdictSentence`), so it is not
 * internal and it is not hidden; it is just not a question, because the answer
 * is already on the screen.
 */
export function identityNameFor(column: string): string {
  return `${column.trim()}_adds_up`.slice(0, 48)
}

/**
 * Local identity, monotonic within a session.
 *
 * Not `crypto.randomUUID`: this never leaves the screen it is drawn on, and a
 * counter is the boring version. `ROW_ID_COLUMN` is the row's own identity and
 * is unrelated to this.
 */
let counter = 0
function nextKey(): string {
  counter += 1
  return `c${counter}`
}
