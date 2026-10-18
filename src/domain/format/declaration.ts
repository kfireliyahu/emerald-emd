/**
 * A **format**: a kind of thing, declared rather than hand-written, compiling
 * to a real table with real types and real `CHECK`s (M19 U1, D-214, D-215).
 *
 * **This is the engine's spine and it touches none of the finance app.** Nothing
 * here imports a repository, a screen or a domain rule of the ledger, and
 * nothing in the ledger imports this. That is D-214's decision said in the
 * import graph: the format model is built clean, beside the app, in the same
 * document, and finance keeps working until the engine is good enough to eat it.
 *
 * ## What a declaration is, and what it deliberately is not
 *
 * The specification is `Ingredients/Pasta.md` — twenty-five typed fields of an
 * ingredient note already kept by hand, in a vault, with nothing
 * enforcing them. **A format that is not money, on purpose** (D-211): building
 * against `holding` first would make retrofitting finance the path of least
 * resistance on day one, and the whole claim of the engine is that it holds a
 * dataset that is not money.
 *
 * A declaration is **columns, identities, links and aggregates**. Not a reading:
 * how a document's columns reach these is `reading.ts` (U5, D-226), and it binds
 * the keys this file defines rather than adding anything to them. The
 * identities arrived in U3 (D-222) once there was an evaluator in front of them; links and the fold across one arrived in U4b (D-224), and
 * between them they are the parts of a declaration that become **no SQL at all**:
 * a `CHECK` says what cannot be stored, an identity says what should add up, and
 * an aggregate says what this row works out from rows that are not in this table.
 * The first refuses a row; the other two are computed on read and report on it.
 * See `identity.ts` and `aggregate.ts`, which is where those arguments are kept.
 *
 * ## Why user-authored schemas keep their correctness
 *
 * The objection is that flexible schemas forfeit the constraints. The app has
 * already disproved it: `deduction_type` (012, D-049) is a real table whose rows
 * the user creates, carrying a foreign key into another entity. **Correctness
 * never came from schemas being fixed. It came from their being real** (D-209).
 * What forfeits D-004's `CHECK` is **untyped storage** — an EAV row, a JSON
 * blob, a `value TEXT` column — not who authored the declaration.
 *
 * So every *column* property below exists to become SQL rather than to be
 * interpreted: a type is a storage class, `required` is `NOT NULL`, an enum's
 * members are an `IN (…)`, a bound is a comparison. **There is still no
 * free-text `CHECK`**, and that is a decision rather than an omission — a
 * declaration that carries SQL is a program, and a string from a model that
 * reaches `db.run` is the injection this file would otherwise invent. An
 * identity is the opposite arrangement and keeps the same rule: it is parsed by
 * the engine's own total parser, evaluated in TypeScript over numbers, and
 * never sees `db.run` in any form.
 *
 * ## Money is not a number here either
 *
 * `money` is the one type that is not one column. It compiles to a minor-units
 * integer beside a currency code, because the app's oldest non-negotiable rule
 * has no exception for a table somebody declared. A declared table that could
 * hold `19.99` as a float would break the rule by construction, in the one place
 * nobody would think to look.
 *
 * **`quantity` is the second** (U4c, D-225), and it is the same argument about
 * a different pair: a figure and the unit it is in, in two columns, because a
 * recipe line is `150 g` on one row and `200 ml` on the next and a unit declared
 * once on the column cannot say that. A `real` with the unit kept in a `text`
 * column beside it would be this type built by hand, one format at a time, with
 * nothing checking that the symbol is a unit the document knows.
 */

import {
  AGGREGATE_KINDS,
  foldsEvery,
  sourceText,
  isEmptyTest,
  isOrdered,
  isWiderFilter,
  filterMembers,
  filterText,
  word as aggregateWord,
  type AggregateDeclaration,
  type AggregateFilter,
} from './aggregate.ts'
import { rollupText, type RollupDeclaration } from './rollup.ts'
import { EMPTY, ruleSetText, type RuleSetDeclaration } from './rule.ts'
import {
  columnsNamedBy,
  identityUnitProblem,
  isIdentityType,
  parseExpression,
  parseIdentity,
  type IdentityDeclaration,
} from './identity.ts'
import { constraintProblem, type RowConstraint } from './constraint.ts'
import { compileDerived, derivedProblems, type DerivedDeclaration } from './derived.ts'
import type { FormatOwner } from './owner.ts'
import { parseDecimal } from './decimal.ts'
import { parsePercent, PERCENT_PLACES } from './percent.ts'
import { aType, equationPointProblem, isPointType, pointProblem, pointSide } from './span.ts'
import { CLOCK_REASON, TODAY } from './clock.ts'
import { foundByRejection, foundByText, type FoundBy } from './foundBy.ts'
import { SEEDED_UNITS, unitNamed, type UnitTable } from './unit.ts'

/**
 * The declaration language's version — **the one number that has to be
 * version-compatible** (D-214).
 *
 * This is the unlock the reconciler bought. The fear was a document carrying
 * tables this build never shipped, and the answer to it was per-document
 * migrations. But if the tables are *described by the document*, the build does
 * not need to have shipped them: the declarations are the source of truth, the
 * app makes the tables match on open, and what must be understood across builds
 * is **the shape of a declaration, which is one integer — not the set of tables,
 * which is unbounded.**
 *
 * A document whose declarations are written in a newer language than this build
 * understands is refused for those formats and left alone, exactly as
 * `SchemaTooNewError` refuses a newer file rather than corrupting it.
 *
 * **5 is a `unique` column** (M24 U4, D-255). A build that could not read it
 * would write duplicates into a column somebody declared could have none, so a
 * declaration that says it is refused there rather than half-understood.
 */
export const DECLARATION_LANGUAGE = 24

/** The first language a `unique` column may be written in. */
export const UNIQUE_LANGUAGE = 5

/**
 * The first language `decimal`, `month` and `instant` may be written in (M24
 * U6, D-257). A build that did not know them would read a `decimal` as nothing
 * at all, and a column it cannot read is a format it cannot reconcile.
 */
export const TIME_AND_SCALE_LANGUAGE = 6

/**
 * The first language a row constraint may be written in (M24 U7, D-259). A
 * build that could not read one would write the rows it forbids, so it refuses
 * the format instead.
 */
export const CONSTRAINT_LANGUAGE = 7

/**
 * The first language an aggregate may say `where` in (M24 U8, D-260). A build
 * that could not read the filter would fold every row — the paycheck's net
 * less the employer's pension too — and print that as the figure, so it
 * refuses the format instead.
 */
export const FILTER_LANGUAGE = 8

/**
 * The first language `one row per` may be written in (M25 E1, D-270). A build
 * that read the constraints table without it would refuse the sentence it
 * cannot parse, which is right — but one that parsed only the other three
 * would write the repeats it forbids, so the number says it.
 */
export const ONE_PER_LANGUAGE = 9

/**
 * The first language a rollup may be written in (M25 E2, D-271). A build that
 * did not know the table would read the format without its rollups, and a
 * view somebody declared would go missing without a word.
 */
export const ROLLUP_LANGUAGE = 10

/**
 * The first language an aggregate may be `latest` or `earliest` (M25 E3,
 * D-272). A build that did not know the kinds would refuse the format, which
 * is right — but one that read `security_price.security by as_of` as a source
 * with a column called `security by as_of` would say something stranger, so
 * the number says it.
 */
export const LATEST_LANGUAGE = 11

/**
 * The first language a rule set may be written in (M25 E4, D-273). A build that
 * did not know the table would read the rule format without its rule set, and
 * rows a person expected sorted would arrive unsorted without a word.
 */
export const RULE_LANGUAGE = 12

/**
 * The first language a format may say which pack owns it (M25 E5, D-269). A
 * build that did not know it would read the pack's format unlocked, and let a
 * generic write past the pack's code — so it refuses the format instead.
 */
export const OWNED_LANGUAGE = 13

/**
 * The first language a column may be `links` — a link to several rows (M27 U2,
 * D-300). A build that did not know it would find no stored column for it and
 * read every row as naming nothing, so it refuses the format instead.
 */
export const LINKS_LANGUAGE = 14

/**
 * The first language a column may be `percent` (M29 U3, D-333). A build that
 * did not know it would read `125000` as a figure rather than 12.5%, so it
 * refuses the format instead.
 */
export const PERCENT_LANGUAGE = 15

/**
 * The first language a format may declare a derived column (M29 U3b, D-334).
 * A build that did not know them would read the format without its worked-out
 * figures, and a column somebody declared would go missing without a word.
 */
export const DERIVED_LANGUAGE = 16

/**
 * The first language a column may be a `time` of day (M29 U4, D-335). A build
 * that did not know it would hold `09:30` as text nobody can take a span of,
 * so it refuses the format instead.
 */
export const TIME_LANGUAGE = 17

/**
 * The first language a link may say how it is found — `found by date in
 * period` (M29 F8, D-350). A build that did not know it would leave the link
 * empty on every write a person expected filled, so it refuses the format
 * instead.
 */
export const FOUND_BY_LANGUAGE = 18

/**
 * The first language a filter may say `is not`, `is one of` or — outside a
 * rule set, which had it from 12 — `is empty` (M36 U04, D-380). A build that
 * read `category.kind is not TRANSFER` as D-260's one member would refuse it,
 * and one that skipped the filter would total every row; so it refuses the
 * format instead.
 */
export const FILTER_TESTS_LANGUAGE = 19

/**
 * The first language a worked-out column may name a `latest` or `earliest`
 * total (M36 U05, D-381) — a holding's worth is its latest reading. A build
 * that did not know it refused the column as something a derived column did not
 * read yet; the language says so before that build tries.
 */
export const LATEST_DERIVED_LANGUAGE = 20

/**
 * The first language a total may fold **every row** of a format — `every
 * course` (M34 U4, D-397). A build that did not know it would read the source
 * as a link with no name and fold nothing, so it refuses the format instead.
 */
export const EVERY_ROW_LANGUAGE = 21

/**
 * The first language a column may hold **several members of its list** —
 * `enums` (M34 U5, D-398): a recipe's tags, a product's allergens. A build that
 * did not know it would read the column as one it cannot store, so it refuses
 * the format instead.
 */
export const ENUMS_LANGUAGE = 22

/**
 * The first language a column may be **a row in another document** —
 * `elsewhere` (M47 U4, D-461): an inbox row's `about`, which names the unit in
 * the sending project's document that it concerns. A build that did not know it
 * would read `F:/site/site.emd S1 U5` as text and never resolve it, so it
 * refuses the format instead.
 */
export const ELSEWHERE_LANGUAGE = 23

/**
 * The first language a column may be **a file on this computer** — `file`
 * (M37 U6): where a scan, a plan or a note is, opened from the cell. A build
 * that did not know it would show `scans/a.pdf` as text with nothing to open,
 * so it refuses the format instead.
 */
export const FILE_LANGUAGE = 24

/**
 * The types a `latest` or `earliest` may pick by: ones whose stored values sort
 * the way they mean — ISO text for a day, a month or a moment in UTC, and a
 * whole number. Not `real`, whose equality is a float's and so whose ties are
 * an accident; not `decimal`, which nobody has needed to order by yet.
 */
export const ORDER_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'date',
  'month',
  'instant',
  'integer',
])

/** The three types language 6 added. */
export const LANGUAGE_6_TYPES: ReadonlySet<string> = new Set(['decimal', 'month', 'instant'])

/**
 * How many digits after the point a `decimal` may keep — one to nine.
 *
 * Nine rather than more because the stored integer has to stay a whole number
 * JavaScript holds exactly: at nine places the largest figure is nine million,
 * and at six — the ledger's `_micro` columns — it is nine thousand million.
 * Zero is refused because a decimal with no places is an `integer`.
 */
export const MAX_SCALE = 9

/**
 * The types a column may be `unique` on — a value a person would name a row by.
 *
 * Not `real`, whose equality is a float's; not `boolean` or `enum`, which have
 * two or a handful of values and so a unique one is a format of that many rows;
 * not `money` or `quantity`, which are two columns and a figure beside a unit.
 */
export const UNIQUE_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'text',
  'integer',
  'date',
  'link',
  // Language 6 (D-257). A decimal is an integer underneath, so its equality is
  // exact where a real's is not; a month is the period a salary is paid for.
  'decimal',
  'month',
])

/**
 * What a column stores.
 *
 * Eighteen, and each is a storage class plus the checks that follow from it
 * (`links` and `enums` are tables of their own, M27 U2 and M34 U5).
 * The list is closed: it is handed to a model as an enum the same way a
 * column-role vocabulary is (D-114, D-212), and a model asked to use an app's
 * vocabulary unaided invents members of it. **It moves only with the language
 * integer**, which is what it did at the tenth (M24 U6, D-257).
 *
 * - `text` — a string. A name, a brand, a source, an allergen list.
 * - `integer` — a whole number. `sodium_mg: 4`.
 * - `real` — a number with a fraction. `cooked_yield_factor: 2.0`. **Never
 *   money**, which is the next entry and the reason this one is safe.
 * - `date` — a date-only `YYYY-MM-DD` string, the app's only date shape (D-023).
 *   `verified: 2026-09-13`.
 * - `boolean` — `0` or `1`, checked.
 * - `enum` — one of the members the declaration names. `micros_basis: analogue |
 *   mixed | label`, which is the vault's own third state (D-149 met again in
 *   another domain).
 * - `money` — minor units and a currency, in two columns. See the head of this
 *   file.
 * - `link` — the `id` of a row of another format (M19 U4b, D-224). The eighth,
 *   and the first one whose meaning is outside the row it is in: `ingredient`
 *   on a recipe line is a *pointer*, and everything the engine can do across
 *   one — reach a column of the row it names, sum a column of every row that
 *   names this one — exists because this type does.
 * - `quantity` — a figure and the unit it is in, per row (M19 U4c, D-225).
 *   `150 g` on one recipe line and `200 ml` on the next. Two columns, like
 *   `money`, and the ninth (three more came with language 6): it is `real` for the rows where a unit
 *   declared once on the column would have done, and the only type that can say
 *   what a line of a recipe actually says.
 * - `decimal` — a number with a declared count of places, **stored as a whole
 *   number** (M24 U6, D-257). `rate: 3.5` at scale 6 is the integer `3500000`.
 *   Written and read as a decimal string, so no float ever carries it; the
 *   ledger's `quantity_micro`, `price_micro` and `rate_micro` are this type
 *   built by hand. A figure with more places than the scale is refused, never
 *   rounded.
 * - `month` — `YYYY-MM`, a period rather than a day: a billing period, the
 *   month a salary is for. Not a date on the first, which would be a day
 *   somebody has to know to ignore.
 * - `instant` — a moment, in UTC, as `YYYY-MM-DDTHH:MM:SS.sssZ`. Written with
 *   its offset or not at all: a time with no zone is a question.
 * - `links` — the ids of **several** rows of another format, in order (M27 U2,
 *   D-300). A unit blocked by three others; a decision amended by two. Still
 *   one hop to each (D-224): an aggregate may fold over it, an expression may
 *   not read through it, because `blocks.title` would be three titles. It has
 *   **no column of its own** — its members are rows of a table of their own,
 *   `fmt_<format>__<column>`, so a target that is deleted is a row a query can
 *   find rather than a name inside a delimited cell.
 * - `percent` — a share, entered and shown as `12.5%` (M29 U3, D-333). Stored
 *   as millionths of the whole — `125000` — so it is exact, and so SQL integer
 *   arithmetic can multiply money by it. Four places of a percent, fixed; more
 *   is refused, never rounded. An identity reads it as its fraction, so
 *   `price * (1 + vat)` means what it says.
 * - `enums` — **several** members of the list the declaration names (M34 U5,
 *   D-398). `tags: vegan | quick | freezes`, a row holding two of them. What a
 *   multi-select was in an export and what a trial flattened to `vegan, quick`
 *   in one text cell, which is the untyped storage D-209 says forfeits every
 *   check. Kept the way `links` is — a table of its own, one row per member —
 *   and that table's `CHECK` names the list, so every member is checked and a
 *   member is a row a query finds rather than a word inside a delimited cell.
 * - `time` — a time of day, `HH:MM` in twenty-four hours (M29 U4, D-335).
 *   `start: 09:00`. Stored as that text, so it sorts as it reads. With `date`
 *   and `instant` it is a *point*: the one arithmetic it takes is `end -
 *   start`, which is a span in hours, and two times wrap at midnight
 *   (`span.ts`).
 * - `elsewhere` — **a row in another document**, as that document's path and
 *   the row's name: `F:/projects/site/site.emd S1 U5` (M47 U4, D-461). The
 *   seventeenth, and the one link the document cannot check: the other file
 *   may be closed, moved or on another machine, so a write never refuses one
 *   for being out of reach, and a read resolves it when the file is readable
 *   and says *unresolved* when it is not (`elsewhere.ts`). By name and never by
 *   id, because a text document renews its ids on every write (D-245). Stored
 *   as that text, so a text document writes it as it reads.
 * - `file` — **a file on this computer**: its path, relative to the document's
 *   folder when it is under it, or a local app's own address (M37 U6,
 *   `file.ts`). The eighteenth. Where the file is, never what is in it; a file
 *   that has gone reads *missing* and never stops a write. Opened by the
 *   system's own app from the cell, in the desktop app.
 */
export const COLUMN_TYPES = [
  'text',
  'integer',
  'real',
  'date',
  'boolean',
  'enum',
  'money',
  'link',
  'quantity',
  'decimal',
  'month',
  'instant',
  'links',
  'percent',
  'time',
  'enums',
  'elsewhere',
  'file',
] as const

export type ColumnType = (typeof COLUMN_TYPES)[number]

/** The types a bound may be written on. A minimum on a brand name means nothing. */
const NUMERIC_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>(['integer', 'real', 'decimal', 'percent'])

/** One declared column. */
export interface ColumnDeclaration {
  /** `snake_case`, and the name the SQL column takes. */
  readonly name: string
  readonly type: ColumnType
  /**
   * What the figure is *in* — `g`, `mg`, `kcal`, `µg`, `ml`.
   *
   * **Interpreted since U4a** (D-223), and still free text. A unit the
   * document knows — `unit.ts`, `measurement_unit` — is what an identity's `in`
   * converts through; one it does not know is a label, which is what keeps
   * `per 100g` from having become a refusal in every declaration written before
   * schema 34. What it already bought before that, and still buys, is the
   * refusal: **changing a column's unit is one of the two things the reconciler
   * may not decide by itself** (D-214), and it can only refuse a change it can
   * see.
   */
  readonly unit: string | undefined
  /**
   * The *other* unit, for a column that holds a ratio — **this column is
   * `unit` per `per`** (U4c, D-225).
   *
   * `density`: `unit` is `g`, `per` is `ml`. `egg_weight`: `g` per `each`.
   * Together they are the one thing `unit.ts` refuses to know — a factor that
   * crosses a dimension — written down by the person who knows it, about the
   * thing it is a fact about.
   *
   * **It is only ever read when an identity asks for it**, by name, after a
   * `via`. A ratio column nobody bridges through is a number with two units
   * printed beside it, which is what the vault already wrote by hand
   * in the column's own name — `density_g_per_ml` — and the improvement is that
   * the two halves are now fields rather than spelling.
   */
  readonly per: string | undefined
  /** `NOT NULL`. */
  readonly required: boolean
  /**
   * No two rows hold the same value here — a `UNIQUE` index (M24 U4, D-255).
   * Empty cells do not collide, so an optional unique column is a name that
   * some rows have and no two share.
   */
  readonly unique: boolean
  /**
   * How many digits after the point, for `decimal` and nothing else (M24 U6,
   * D-257). The stored integer is the figure times ten to this.
   */
  readonly scale: number | undefined
  /** The members, for `enum` and `enums` and nothing else. */
  readonly values: readonly string[]
  /**
   * Inclusive bounds, for `integer`, `real` and `decimal` and nothing else. A
   * decimal's is written as the figure and compiled onto the stored integer.
   */
  readonly minimum: number | undefined
  readonly maximum: number | undefined
  /**
   * The format this points at, for `link` and nothing else (U4b, D-224).
   *
   * A format name rather than a table name, because a declaration names
   * declarations: the table is `fmt_` plus this, and a reader who had to know
   * that in order to read a declaration would be reading storage. **It may name
   * this format itself** — a cooked label pointing at the dry one it was made
   * from is the case the roadmap has been carrying since U3, and it is one row
   * of a format pointing at another row of the same format.
   */
  readonly target: string | undefined
  /**
   * How a `link` is filled on a write while it is empty — this row's date
   * falls in a month or on a day of the target (M29 F8, D-350). **Language
   * 18.** Stored as the link a person would have picked; never a search on
   * read. Optional because every column before it carries none.
   */
  readonly foundBy?: FoundBy | undefined
  /** What the column means, in the person's words. Prose, stored, never parsed. */
  readonly note: string
}

/** One declared format: a kind of thing. */
export interface FormatDeclaration {
  /** The declaration language this was written in. See `DECLARATION_LANGUAGE`. */
  readonly language: number
  /** `snake_case`, unique in the document, and what the table is named after. */
  readonly name: string
  /** What a person calls it. `Ingredient`. */
  readonly title: string
  /**
   * The prose around the columns — why this format exists, where the figures
   * came from, what was decided.
   *
   * **Kept verbatim and never parsed**, and it is not decoration. The vault's
   * ingredient notes are half argument: *"these are dry-weight values, which is
   * what recipes measure"* is the sentence that stops the dish being understated
   * by half, and a declaration that threw it away would be a worse artefact than
   * the markdown file it replaced.
   */
  readonly notes: string
  readonly columns: readonly ColumnDeclaration[]
  /**
   * What has to hold about one of these (M19 U3, D-222).
   *
   * **Language 2.** A declaration written before identities existed carries
   * none and reads exactly as it did; one written with them is refused by a
   * build that does not know what they are, rather than read down to a table
   * with its proof quietly missing — which is the whole of what the language
   * integer is for.
   */
  readonly identities: readonly IdentityDeclaration[]
  /**
   * What is worked out from the rows of another format that point here (M19
   * U4b, D-224).
   *
   * **Language 3.** An aggregate is not stored and compiles to no SQL — it is
   * folded on read, like a verdict and for the same reason (D-222, D-210) — but
   * a declaration carrying one is refused by a build that does not know what it
   * is, rather than read down to a format whose totals have quietly gone
   * missing. That is the whole of what the language integer is for, and this is
   * the third time it has earned itself.
   */
  readonly aggregates: readonly AggregateDeclaration[]
  /**
   * What has to be true across the columns of one row (M24 U7, D-259) —
   * required when, at most one of, a sign when. **Language 7.** Compiled to a
   * trigger the reconciler owns, and refused at the write by `row.ts` first.
   *
   * Optional because a declaration written before it carries none, and every
   * reader takes a missing list as an empty one.
   */
  readonly constraints?: readonly RowConstraint[]
  /**
   * Figures keyed by a month and perhaps a link, folded over this format's own
   * rows (M25 E2, D-271). **Language 10.** Compiled to one `GROUP BY` on read
   * and never stored. Optional for the reason `constraints` is.
   */
  readonly rollups?: readonly RollupDeclaration[]
  /**
   * This format's rows as rules that set a link of another format (M25 E4,
   * D-273). **Language 12.** Applied by the engine on a write of the target
   * and on demand. Optional for the reason `constraints` is.
   */
  readonly ruleSets?: readonly RuleSetDeclaration[]
  /**
   * Columns worked out from other columns rather than typed (M29 U3b, D-334).
   * **Language 16.** An expression in the identity grammar, compiled by the
   * engine into the format's view and never stored. Optional for the reason
   * `constraints` is.
   */
  readonly derived?: readonly DerivedDeclaration[]
  /**
   * The pack that owns this format, where its rows are written instead, and
   * which columns are the pack's (M25 E5, D-269). **Language 13.** Absent for a
   * format a person declared, which is every format but a pack's. See
   * `owner.ts` for what it locks.
   */
  readonly owner?: FormatOwner
  /**
   * Whoever declared it said, on purpose, that nothing about this format has to add up
   * — [H3](../../../docs/engine.md)'s *prompted*, answered in 2026-09-07 and
   * built in U3.
   *
   * **Since M38 U5 it is the default and nothing refuses its absence**: a
   * format with no identities is allowed whether or not it said so, and every
   * surface sets this when there are none. It is meaningless once an identity
   * exists — a declaration carrying both is refused rather than resolved.
   */
  readonly nothingMustHold: boolean
}

/**
 * The table a format compiles to.
 *
 * Prefixed, and the prefix is load-bearing: it is what makes *"the reconciler
 * only ever touches tables it can see a declaration for"* checkable rather than
 * promised. No built-in table begins `fmt_`, so no reconciliation can reach one
 * however wrong a declaration is — which is the guard that lets this thing be
 * built beside the finance app rather than on top of it.
 */
export function tableNameFor(format: Pick<FormatDeclaration, 'name'>): string {
  return `${TABLE_PREFIX}${format.name}`
}

export const TABLE_PREFIX = 'fmt_'

/** A link to one row, or to several (M27 U2, D-300) — the two types with a target. */
export function isLinkType(type: ColumnType): type is 'link' | 'links' {
  return type === 'link' || type === 'links'
}

/**
 * **A column whose members are rows of a table of their own** — `links` (M27
 * U2, D-300) and `enums` (M34 U5, D-398). Neither has a cell in the format's
 * table; both are a list in a row as it is read and written.
 */
export function isListType(type: ColumnType): type is 'links' | 'enums' {
  return type === 'links' || type === 'enums'
}

/** One of a list, or several of it (M34 U5, D-398) — the two types with `values`. */
export function isChoiceType(type: ColumnType): type is 'enum' | 'enums' {
  return type === 'enum' || type === 'enums'
}

/**
 * The table a `links` column's members are kept in — `fmt_unit__blocks` (M27
 * U2, D-300): one row per member, naming the row it belongs to, the row it
 * names, and where in the list it sits. Prefixed like every declared table, and
 * spelled like the reconciler's own index names, `<table>__<column>`.
 */
export function memberTableNameFor(
  format: Pick<FormatDeclaration, 'name'>,
  column: Pick<ColumnDeclaration, 'name'>,
): string {
  return `${TABLE_PREFIX}${format.name}__${column.name}`
}

/** The three columns of a member table. */
export const MEMBER_COLUMNS = { row: 'row_id', member: 'member_id', position: 'position' } as const

/**
 * The column a member table keeps its member in: a row's id for `links`, and
 * for `enums` the member itself (M34 U5, D-398) — `member`, since a word of the
 * list is not an id, and a person opening the file in another tool reads it.
 */
export function memberColumnOf(column: Pick<ColumnDeclaration, 'type'>): string {
  return column.type === 'enums' ? 'member' : MEMBER_COLUMNS.member
}

/**
 * The two columns a `money` column becomes.
 *
 * Exported because the reconciler, the DDL and anything that ever reads a row
 * have to agree on the names, and agreeing by convention is how two of them
 * would eventually disagree.
 */
export function moneyColumnNames(column: Pick<ColumnDeclaration, 'name'>): {
  readonly minor: string
  readonly currency: string
} {
  return { minor: `${column.name}_minor`, currency: `${column.name}_currency` }
}

/**
 * The two columns a `quantity` column becomes (U4c, D-225).
 *
 * `amount` is the figure and `amount_unit` is what it is in. Exported for the
 * same reason `moneyColumnNames` is: the reconciler, the DDL and everything
 * that reads a row have to agree on the names, and agreeing by convention is
 * how two of them would eventually disagree.
 *
 * The suffix is the same word the declaration's own field uses, so a person
 * looking at the table in another tool reads `amount` and `amount_unit` and
 * needs nothing explained.
 */
export function quantityColumnNames(column: Pick<ColumnDeclaration, 'name'>): {
  readonly amount: string
  readonly unit: string
} {
  return { amount: column.name, unit: `${column.name}_unit` }
}

/**
 * The SQL columns one declared column occupies — one for every type but `money`
 * and `quantity`.
 *
 * The distinction between a *declared* column and a *stored* column exists only
 * because of those two, and it is cheaper to have it everywhere than to
 * special-case them at each of the four places that compare a declaration
 * against a table.
 */
export function storedColumnsOf(column: ColumnDeclaration): readonly string[] {
  // Its members are rows of a table of their own (M27 U2, D-300; M34 U5, D-398).
  if (isListType(column.type)) return []
  if (column.type === 'money') {
    const names = moneyColumnNames(column)
    return [names.minor, names.currency]
  }
  if (column.type === 'quantity') {
    const names = quantityColumnNames(column)
    return [names.amount, names.unit]
  }
  return [column.name]
}

/**
 * The column every declared table gets, which no declaration may name.
 *
 * A row needs an identity to be referred to, and U4b's links will refer to rows.
 * `TEXT PRIMARY KEY` is the shape every table in this document already uses.
 */
export const ROW_ID_COLUMN = 'id'

/**
 * The column a row of this format is *called* by — its first `text` column.
 *
 * **The rule was already here three times and applied in none of the places a
 * link is read back** (M22 U1 found it against this project's own memory:
 * `supersedes` printed `0c0af4de-6da3-4935-9201-54246964ddca` where a person
 * expects `D-232`). `IntakePanel`'s picker, `FormatRows`' picker and this now
 * share one copy, which is the only way a rule like this stays one rule.
 *
 * **First `text` column, and a declaration still has no display column.** That
 * decision is older than this function and is not reopened by moving it: a
 * guess a person reads is cheap, and a guess stored in a declaration is a field
 * nobody asked for. `undefined` means the format has no text column at all, and
 * every caller falls back to the id — which is not a failure, it is the only
 * name that row has.
 *
 * An `enum` is deliberately not eligible. A column of three repeated words
 * names nothing, and a format whose first column is a status would read as
 * four rows all called `open`.
 */
export function labelColumn(
  declaration: Pick<FormatDeclaration, 'columns'>,
): ColumnDeclaration | undefined {
  return declaration.columns.find((column) => column.type === 'text')
}

/**
 * **The parent a name is a name within** (M48 U1): the link column of a format
 * whose rows are `one row per <link>, <naming column>` — a concept is one row
 * per course and name, so *Recursion* names a concept within one course and
 * not across the document. A link into such a format may be written by name
 * from a row that links to that parent too, and the name is looked for among
 * that parent's rows only.
 */
export function namingScope(
  declaration: Pick<FormatDeclaration, 'columns' | 'constraints'>,
): (ColumnDeclaration & { readonly target: string }) | undefined {
  const naming = labelColumn(declaration)
  if (naming === undefined) return undefined
  for (const each of declaration.constraints ?? []) {
    if (each.kind !== 'ONE_PER' || each.when !== undefined || each.columns.length !== 2) continue
    if (!each.columns.includes(naming.name)) continue
    const other = declaration.columns.find((column) => column.name !== naming.name && each.columns.includes(column.name))
    if (other?.type === 'link' && other.target !== undefined) return { ...other, target: other.target }
  }
  return undefined
}

/** What a change to a declaration does to the order its columns are shown in. */
export interface OrderChange {
  /** Whether any two columns both declarations have swapped places. */
  readonly moved: boolean
  /**
   * The column the entries were called by, and the one they are called by now,
   * when a move or a retype changed it (`labelColumn`). Not set by a rename,
   * which keeps the column and only renames it.
   */
  readonly naming: { readonly was: string | undefined; readonly now: string | undefined } | undefined
}

/**
 * **What a move does** — M29 U2, D-332.
 *
 * The order is the declaration's, so a move changes no table and no entry. It
 * can change one thing a person minds: **the entries are called by their first
 * `text` column**, so moving a text column ahead of the one that named them
 * renames every entry where it is read back — a link, a picker, the heading of
 * a row in a text document. That stays the rule (a declaration still has no
 * display column, see `labelColumn`); it is said before anything is written,
 * on the sheet and in `extend_format`'s dry run, rather than prevented.
 *
 * `renames` maps a new column name to the one it had (`renamesOf`), so a
 * renamed column is the same column on both sides.
 */
export function orderChange(
  before: Pick<FormatDeclaration, 'columns'>,
  after: Pick<FormatDeclaration, 'columns'>,
  renames: ReadonlyMap<string, string> = new Map(),
): OrderChange {
  const was = (name: string): string => renames.get(name) ?? name
  const kept = new Set(before.columns.map((each) => each.name))
  const then = before.columns.map((each) => each.name).filter((name) =>
    after.columns.some((each) => was(each.name) === name),
  )
  const now = after.columns.map((each) => was(each.name)).filter((name) => kept.has(name))
  const moved = then.some((name, index) => now[index] !== name)
  const named = labelColumn(before)?.name
  const naming = labelColumn(after)?.name
  return {
    moved,
    naming:
      (naming === undefined ? undefined : was(naming)) === named
        ? undefined
        : { was: named, now: naming },
  }
}

/**
 * **A declaration with its columns in the order given** — M29 U2, D-332, what
 * `extend_format`'s `order` asks for. Every column the format has, each once:
 * a list that leaves one out is refused rather than read as *the rest after*,
 * because a half-given order is a guess about where the others go.
 */
export function inOrder<T extends Pick<FormatDeclaration, 'name' | 'columns'>>(
  declaration: T,
  order: readonly string[],
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string } {
  const names = declaration.columns.map((each) => each.name)
  const unknown = order.filter((name) => !names.includes(name))
  const twice = order.filter((name, index) => order.indexOf(name) !== index)
  const missing = names.filter((name) => !order.includes(name))
  if (unknown.length > 0 || twice.length > 0 || missing.length > 0) {
    return {
      ok: false,
      error:
        `An order names every column of ${declaration.name} once: ${names.join(', ')}.` +
        (unknown.length > 0 ? ` It has no ${unknown.join(', ')}.` : '') +
        (twice.length > 0 ? ` ${[...new Set(twice)].join(', ')} came more than once.` : '') +
        (missing.length > 0 ? ` ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} left out.` : ''),
    }
  }
  return {
    ok: true,
    value: {
      ...declaration,
      columns: order.flatMap((name) => declaration.columns.filter((each) => each.name === name)),
    },
  }
}

/**
 * `snake_case`, ASCII, starting with a letter.
 *
 * The same rule D-213 put on an added column role, and for the same reason: a
 * name goes into a grammar handed to a model, and into SQL. `Cost`, `עלות` and
 * `two words` are all refused on purpose.
 */
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * The two words a column may not be called. See `identity.ts`.
 *
 * `in` asks for a conversion (U4a) and `via` names the column that bridges one
 * (U4c). Two reserved words is what the whole conversion syntax costs, and the
 * price is paid here rather than by the tokenizer guessing which was meant.
 */
const RESERVED_WORDS = ['in', 'via'] as const

const MAX_NAME_LENGTH = 48
/**
 * One problem with a declaration, and **which column it is about**.
 *
 * The index rather than the name, because the one case where two problems are
 * genuinely about different columns is the case where the two columns are
 * called the same thing. A name would collapse exactly the collision this
 * reports.
 *
 * `columnIndex` is `undefined` for the format's own problems — its name, its
 * title, its language, its having no columns at all.
 */
/**
 * What a problem about the format as a whole is about (T1, D-237).
 *
 * A column's problem already named its column and an identity's named its
 * identity; the four that are about the declaration itself named nothing,
 * because the one screen that read them had one place to draw them. A walk has
 * four, and *which step can fix this* is a fact the code raising the problem
 * knows and nothing downstream can recover. So it is carried rather than
 * guessed at.
 */
export type FormatAspect = 'LANGUAGE' | 'NAME' | 'TITLE' | 'COLUMNS' | 'IDENTITIES'

export interface DeclarationProblem {
  readonly columnIndex: number | undefined
  /** Which part of the declaration itself, when it is about no column at all. */
  readonly about?: FormatAspect | undefined
  /** The identity it is about, the same way and for the same reason (U3). */
  readonly identityIndex?: number | undefined
  /** The aggregate it is about, the same way again (U4b). */
  readonly aggregateIndex?: number | undefined
  /** The row constraint it is about (M24 U7). */
  readonly constraintIndex?: number | undefined
  /** The rollup it is about (M25 E2). */
  readonly rollupIndex?: number | undefined
  /** The rule set it is about (M25 E4). */
  readonly ruleSetIndex?: number | undefined
  /** The derived column it is about (M29 U3b). */
  readonly derivedIndex?: number | undefined
  readonly message: string
}

/**
 * Everything wrong with a declaration, in reading order.
 *
 * **Every rejection names the thing it is about**, because these are read in
 * three places that cannot ask a follow-up question: a person diffing a file, a
 * model being told its last attempt was wrong, and — since D-219 — a field in an
 * editor, which is the one that needs to know *which* field. That is the whole
 * reason this returns a list and `declarationRejection` is one line over it: a
 * text box can only show the first problem, and a form can show each one beside
 * the control that caused it.
 *
 * `neighbours` are the other formats in the document — a declaration is checked
 * against them, not only against itself. **Whole declarations rather than names
 * since U4b** (D-224), because a link has to be checked against what it points
 * at: that the format exists, that a hop through it reaches a real column, and
 * that an aggregate's source really does point back here. A list of names could
 * answer the first of those three and would have made the other two unsayable.
 */
export function declarationProblems(
  declaration: FormatDeclaration,
  neighbours: readonly FormatDeclaration[] = [],
  units: UnitTable = SEEDED_UNITS,
): readonly DeclarationProblem[] {
  const problems: DeclarationProblem[] = []
  const existingNames = neighbours.map((each) => each.name)
  const wrong = (message: string, columnIndex?: number): void => {
    problems.push({ columnIndex, message })
  }
  const wrongFormat = (message: string, about: FormatAspect): void => {
    problems.push({ columnIndex: undefined, about, message })
  }
  const wrongIdentity = (message: string, identityIndex: number): void => {
    problems.push({ columnIndex: undefined, identityIndex, message })
  }
  const wrongAggregate = (message: string, aggregateIndex: number): void => {
    problems.push({ columnIndex: undefined, aggregateIndex, message })
  }
  const wrongConstraint = (message: string, constraintIndex: number): void => {
    problems.push({ columnIndex: undefined, constraintIndex, message })
  }
  const wrongRollup = (message: string, rollupIndex: number): void => {
    problems.push({ columnIndex: undefined, rollupIndex, message })
  }
  const wrongRuleSet = (message: string, ruleSetIndex: number): void => {
    problems.push({ columnIndex: undefined, ruleSetIndex, message })
  }

  if (declaration.language > DECLARATION_LANGUAGE) {
    wrongFormat(
      `This declaration is written in format language ${declaration.language}; this build understands ${DECLARATION_LANGUAGE}. Update the app rather than editing it down.`,
      'LANGUAGE',
    )
  } else if (declaration.language < 1) {
    wrongFormat('A declaration needs a format language of at least 1.', 'LANGUAGE')
  }

  const nameProblem = nameRejection(declaration.name, 'format')
  if (nameProblem !== undefined) wrongFormat(nameProblem, 'NAME')
  else if (existingNames.includes(declaration.name)) {
    wrongFormat(`This document already has a format called ${declaration.name}.`, 'NAME')
  }
  if (declaration.title.trim() === '') {
    wrongFormat(`The format ${declaration.name} needs a title.`, 'TITLE')
  }
  if (declaration.columns.length === 0) {
    wrongFormat(
      `The format ${declaration.name} declares no columns, so there would be nothing to put in it.`,
      'COLUMNS',
    )
  }

  const seen = new Set<string>([ROW_ID_COLUMN])
  declaration.columns.forEach((column, index) => {
    const problem = columnRejection(column)
    // A column that is already wrong does not also get to collide: its stored
    // names are not registered, so the next column is judged against the ones
    // that would really be there.
    if (problem !== undefined) {
      wrong(problem, index)
      return
    }
    if (column.unique && declaration.language < UNIQUE_LANGUAGE) {
      wrong(
        `${column.name} is unique, which format language ${UNIQUE_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (LANGUAGE_6_TYPES.has(column.type) && declaration.language < TIME_AND_SCALE_LANGUAGE) {
      wrong(
        `${column.name} is a ${column.type}, which format language ${TIME_AND_SCALE_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (column.type === 'links' && declaration.language < LINKS_LANGUAGE) {
      wrong(
        `${column.name} links several rows, which format language ${LINKS_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (column.type === 'percent' && declaration.language < PERCENT_LANGUAGE) {
      wrong(
        `${column.name} is a percent, which format language ${PERCENT_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (column.type === 'enums' && declaration.language < ENUMS_LANGUAGE) {
      wrong(
        `${column.name} holds several of a list, which format language ${ENUMS_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (column.type === 'elsewhere' && declaration.language < ELSEWHERE_LANGUAGE) {
      wrong(
        `${column.name} names a row in another document, which format language ${ELSEWHERE_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (column.type === 'file' && declaration.language < FILE_LANGUAGE) {
      wrong(
        `${column.name} is a file on this computer, which format language ${FILE_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (column.type === 'time' && declaration.language < TIME_LANGUAGE) {
      wrong(
        `${column.name} is a time of day, which format language ${TIME_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    // A link is checked against the document rather than against itself, which
    // is why it is here and not in `columnRejection` (U4b, D-224).
    if (isLinkType(column.type)) {
      const target = column.target ?? ''
      if (target !== declaration.name && !existingNames.includes(target)) {
        wrong(
          existingNames.length === 0
            ? `${column.name} points at ${target}, and this document declares no format called that.`
            : `${column.name} points at ${target}, and this document declares ${existingNames.join(', ')}.`,
          index,
        )
        return
      }
    }
    if (column.foundBy !== undefined) {
      if (declaration.language < FOUND_BY_LANGUAGE) {
        wrong(
          `${column.name} is found by ${foundByText(column.foundBy)}, which format language ${FOUND_BY_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
          index,
        )
        return
      }
      const pointed =
        column.target === declaration.name
          ? declaration
          : neighbours.find((each) => each.name === column.target)
      const found = foundByRejection(column, column.foundBy, declaration, pointed)
      if (found !== undefined) {
        wrong(found, index)
        return
      }
    }

    for (const stored of storedColumnsOf(column)) {
      if (seen.has(stored)) {
        wrong(
          stored === column.name
            ? `Two columns are called ${stored}.`
            : `The column ${column.name} would store itself as ${stored}, and something else is already called that.`,
          index,
        )
        return
      }
      seen.add(stored)
    }
  })

  // **The identities are judged against the columns as declared**, not against
  // the table: a format being written for the first time has no table, and an
  // identity naming a column three lines below it is the ordinary case.
  const named = new Set<string>()
  declaration.identities.forEach((each, index) => {
    const problem = identityRejection(each, declaration, neighbours, units, declaration.aggregates)
    if (problem !== undefined) {
      wrongIdentity(problem, index)
      return
    }
    if (named.has(each.name)) {
      wrongIdentity(`Two claims are called ${each.name}.`, index)
      return
    }
    named.add(each.name)
  })

  // The aggregates, judged the same way and against the same neighbours. They
  // come after the identities because an identity may name one, and a reader
  // following a problem list reads them in the order the format declares them.
  const folded = new Set<string>()
  declaration.aggregates.forEach((each, index) => {
    if (each.where !== undefined && declaration.language < FILTER_LANGUAGE) {
      wrongAggregate(
        `The total ${each.name} says where, which format language ${FILTER_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (each.where !== undefined && isWiderFilter(each.where) && declaration.language < FILTER_TESTS_LANGUAGE) {
      wrongAggregate(
        `The total ${each.name} says where ${filterText(each.where)}, which format language ${FILTER_TESTS_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (foldsEvery(each.over) && declaration.language < EVERY_ROW_LANGUAGE) {
      wrongAggregate(
        `The total ${each.name} folds every row of ${each.over.format}, which format language ${EVERY_ROW_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (isOrdered(each.kind) && declaration.language < LATEST_LANGUAGE) {
      wrongAggregate(
        `The total ${each.name} is a ${aggregateWord(each.kind)}, which format language ${LATEST_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    const problem = aggregateRejection(each, declaration, neighbours, units)
    if (problem !== undefined) {
      wrongAggregate(problem, index)
      return
    }
    if (folded.has(each.name)) {
      wrongAggregate(`Two aggregates are called ${each.name}.`, index)
      return
    }
    if (declaration.columns.some((column) => column.name === each.name)) {
      wrongAggregate(
        `The total ${each.name} is called the same thing as a column of this format, so a claim naming it would mean two things.`,
        index,
      )
      return
    }
    folded.add(each.name)
  })

  // The row constraints, against the columns as declared — a renamed column
  // is a refusal here rather than a trigger naming a column that is gone.
  const constraints = declaration.constraints ?? []
  const written = new Set<string>()
  constraints.forEach((each, index) => {
    if (declaration.language < CONSTRAINT_LANGUAGE) {
      wrongConstraint(
        `This format has a row constraint, which format language ${CONSTRAINT_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    if (each.kind === 'ONE_PER' && declaration.language < ONE_PER_LANGUAGE) {
      wrongConstraint(
        `"one row per" is a constraint format language ${ONE_PER_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    const problem = constraintProblem(each, declaration.columns)
    if (problem !== undefined) {
      wrongConstraint(problem, index)
      return
    }
    const key = JSON.stringify([each.kind, each.columns, each.when, each.is, each.only, each.sign])
    if (written.has(key)) {
      wrongConstraint('The same constraint is declared twice.', index)
      return
    }
    written.add(key)
  })

  // The rollups, against this format's own columns and one hop through its
  // links (D-271). A name is shared with nothing else the format declares,
  // since a view and a column called the same would be one word for two things.
  const rolled = new Set<string>()
  ;(declaration.rollups ?? []).forEach((each, index) => {
    if (declaration.language < ROLLUP_LANGUAGE) {
      wrongRollup(
        `The rollup ${each.name} is something format language ${ROLLUP_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    const wider = each.where.find(isWiderFilter)
    if (wider !== undefined && declaration.language < FILTER_TESTS_LANGUAGE) {
      wrongRollup(
        `The rollup ${each.name} says where ${filterText(wider)}, which format language ${FILTER_TESTS_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    const problem = rollupRejection(each, declaration, neighbours)
    if (problem !== undefined) {
      wrongRollup(problem, index)
      return
    }
    if (rolled.has(each.name)) {
      wrongRollup(`Two rollups are called ${each.name}.`, index)
      return
    }
    if (
      declaration.columns.some((column) => column.name === each.name) ||
      declaration.aggregates.some((aggregate) => aggregate.name === each.name)
    ) {
      wrongRollup(
        `The rollup ${each.name} is called the same thing as a column or an aggregate of this format.`,
        index,
      )
      return
    }
    rolled.add(each.name)
  })

  // The rule sets (M25 E4, D-273), against this format's own columns and the
  // target's. A name is shared with nothing else the format declares.
  const ruled = new Set<string>()
  ;(declaration.ruleSets ?? []).forEach((each, index) => {
    if (declaration.language < RULE_LANGUAGE) {
      wrongRuleSet(
        `The rule set ${each.name} is something format language ${RULE_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    // A rule set has said `is empty` since 12; `not` and `one of` are 19's.
    const wider = each.where.find((filter) => filter.not === true || filter.oneOf !== undefined)
    if (wider !== undefined && declaration.language < FILTER_TESTS_LANGUAGE) {
      wrongRuleSet(
        `The rule set ${each.name} says where ${filterText(wider)}, which format language ${FILTER_TESTS_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        index,
      )
      return
    }
    const problem = ruleSetRejection(each, declaration, neighbours)
    if (problem !== undefined) {
      wrongRuleSet(problem, index)
      return
    }
    if (ruled.has(each.name)) {
      wrongRuleSet(`Two rule sets are called ${each.name}.`, index)
      return
    }
    if (
      declaration.columns.some((column) => column.name === each.name) ||
      declaration.aggregates.some((aggregate) => aggregate.name === each.name) ||
      (declaration.rollups ?? []).some((rollup) => rollup.name === each.name)
    ) {
      wrongRuleSet(
        `The rule set ${each.name} is called the same thing as a column, an aggregate or a rollup of this format.`,
        index,
      )
      return
    }
    ruled.add(each.name)
  })

  // Which pack owns it (M25 E5, D-269): a language that can say so, and
  // columns the format has.
  const owner = declaration.owner
  if (owner !== undefined) {
    if (declaration.language < OWNED_LANGUAGE) {
      wrongFormat(
        `The format ${declaration.name} says the ${owner.pack} pack owns it, which is something format language ${OWNED_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        'LANGUAGE',
      )
    } else if (owner.pack.trim() === '' || owner.written.trim() === '') {
      wrongFormat(
        `The format ${declaration.name} says a pack owns it without saying which, or where its rows are written instead.`,
        'NAME',
      )
    } else {
      const stray = owner.columns.find((name) => !declaration.columns.some((each) => each.name === name))
      if (stray !== undefined) {
        wrongFormat(`The format ${declaration.name} says ${stray} is its pack's column, and has no column by that name.`, 'COLUMNS')
      }
    }
  }

  // The derived columns (M29 U3b, D-334): parsed, typed and compiled, so one
  // that would not make a view is refused here rather than missing later.
  if ((declaration.derived ?? []).length > 0 && declaration.language < DERIVED_LANGUAGE) {
    problems.push({
      columnIndex: undefined,
      derivedIndex: 0,
      message: `A computed column is something format language ${DERIVED_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
    })
  } else {
    const picks = new Set(
      declaration.aggregates.filter((each) => each.kind === 'LATEST' || each.kind === 'EARLIEST').map((each) => each.name),
    )
    if (picks.size > 0 && declaration.language < LATEST_DERIVED_LANGUAGE) {
      ;(declaration.derived ?? []).forEach((each, index) => {
        const parsed = parseExpression(each.expression)
        if ('problem' in parsed) return
        const picked = columnsNamedBy({ left: parsed, right: parsed }).find((name) => picks.has(name))
        if (picked === undefined) return
        problems.push({
          columnIndex: undefined,
          derivedIndex: index,
          message: `The computed column ${each.name} names ${picked}, a total that picks one row, which format language ${LATEST_DERIVED_LANGUAGE} says and this declaration's ${declaration.language} cannot.`,
        })
      })
    }
    for (const problem of derivedProblems(declaration, neighbours, units)) {
      problems.push({ columnIndex: undefined, derivedIndex: problem.index, message: problem.message })
    }
  }

  // H3: a format with nothing that must hold is allowed, and **since M38 U5 it
  // is the default** — it needs no flag saying so (D-345's prompt is gone). A
  // declaration that says nothing adds up *and* declares an identity is still
  // refused: one or the other.
  if (declaration.identities.length > 0 && declaration.nothingMustHold) {
    wrongFormat(
      `The format ${declaration.name} says it makes no claim and then declares ${declaration.identities.length === 1 ? 'a claim' : `${declaration.identities.length} claims`}. One or the other.`,
      'IDENTITIES',
    )
  }

  return problems
}

/**
 * One identity's own rules: a name, an equation that parses, and columns that
 * exist and hold numbers.
 *
 * **Every column is checked against the declaration it arrived in**, which is
 * what makes a renamed column a refusal rather than a silent `unchecked` on
 * every row for the rest of the format's life. That is the one failure mode an
 * identity has that a `CHECK` does not: it is evaluated later, somewhere else,
 * against data nobody is looking at.
 */
/**
 * A name's column type, through one hop as `resolveName` reads it — what
 * `pointProblem` asks of a date, a time or an instant (M29 U4, D-335).
 */
export function pointTypeOf(
  self: Pick<FormatDeclaration, 'name' | 'columns'>,
  neighbours: readonly FormatDeclaration[],
): (name: string) => ColumnType | undefined {
  return (name) => {
    const resolved = resolveName(name, self, neighbours)
    return 'problem' in resolved ? undefined : resolved.column.type
  }
}

/**
 * What one name in an expression refers to (U4b, D-224).
 *
 * A plain name is a column of `self`. **A dotted name is one hop**:
 * `ingredient.kcal` is the `kcal` of whatever row this row's `ingredient`
 * column points at. Resolving it needs three things to be true at once — the
 * first part is a `link` column here, its target is a format this document
 * declares, and the second part is a column of that — and each of the three
 * gets its own sentence, because a reader who is told only *"that name does not
 * resolve"* has to guess which of the three they got wrong.
 *
 * `self` is passed beside `neighbours` rather than being in it, because a link
 * may name the format being declared: a cooked label pointing at the dry one it
 * was made from is one row of a format pointing at another row of the same
 * format, and it is the case the roadmap has carried since U3.
 */
export function resolveName(
  name: string,
  self: Pick<FormatDeclaration, 'name' | 'columns'>,
  neighbours: readonly FormatDeclaration[],
): { readonly column: ColumnDeclaration } | { readonly problem: string } {
  const parts = name.split('.')
  if (parts.length === 1) {
    const column = self.columns.find((each) => each.name === name)
    return column === undefined
      ? { problem: `names ${name}, and this format has no such column.` }
      : { column }
  }

  const [first, second] = parts
  if (first === undefined || second === undefined) {
    return { problem: `names ${name}, which is not a column or a link to one.` }
  }

  const link = self.columns.find((each) => each.name === first)
  if (link === undefined) {
    return { problem: `reaches through ${first}, and this format has no such column.` }
  }
  // **One hop to one row** (D-224). A `links` column names several, so
  // `blocks.title` would be several titles and an expression reads one figure;
  // an aggregate is what folds over a list (M27 U2, D-300).
  if (link.type === 'links') {
    return {
      problem: `reaches through ${first}, which links several rows, so there is no one row to read. Fold over it with an aggregate instead.`,
    }
  }
  if (link.type !== 'link') {
    return {
      problem: `reaches through ${first}, which is a ${link.type} rather than a link, so there is no other row to read.`,
    }
  }

  const target: Pick<FormatDeclaration, 'name' | 'columns'> | undefined =
    link.target === self.name
      ? self
      : neighbours.find((each) => each.name === link.target)
  if (target === undefined) {
    return {
      problem: `reaches through ${first} into ${link.target ?? 'nothing'}, and this document declares no format called that.`,
    }
  }

  const column = target.columns.find((each) => each.name === second)
  return column === undefined
    ? { problem: `reaches ${name}, and ${link.target ?? 'that format'} has no column called ${second}.` }
    : { column }
}

export function identityRejection(
  identity: IdentityDeclaration,
  self: Pick<FormatDeclaration, 'name' | 'columns'>,
  neighbours: readonly FormatDeclaration[] = [],
  units: UnitTable = SEEDED_UNITS,
  /**
   * Names that are not columns but are numbers all the same — this format's
   * aggregates (U4b).
   *
   * **This is the line that makes an aggregate worth declaring.** A figure the
   * engine worked out across a link is a figure an identity can be written
   * about: `total_kcal / servings = per_serving_kcal` is the sentence a recipe
   * card prints, and until an aggregate could be named here it was a number the
   * app computed and nobody checked.
   */
  computed: readonly { readonly name: string; readonly unit: string | undefined }[] = [],
): string | undefined {
  const nameProblem = nameRejection(identity.name, 'identity')
  if (nameProblem !== undefined) return nameProblem

  const equation = parseIdentity(identity.expression)
  if ('problem' in equation) return `The claim ${identity.name}: ${equation.problem}`

  const names = columnsNamedBy(equation)
  // Today is a question's, never a claim's (M49 U2, D-472).
  if (names.includes(TODAY)) return `The claim ${identity.name} names ${TODAY}, and ${CLOCK_REASON}.`
  if (names.length === 0) {
    return `The claim ${identity.name} names no column, so it says the same thing about every row.`
  }

  // The columns an `in` is judged against — the format's own, plus a stand-in
  // per resolved name so a hop and an aggregate carry their units too (U4a).
  const forUnits: ColumnDeclaration[] = [...self.columns]

  for (const name of names) {
    const computedOne = computed.find((each) => each.name === name)
    if (computedOne !== undefined) {
      forUnits.push(column(name, 'real', { unit: computedOne.unit }))
      continue
    }
    const resolved = resolveName(name, self, neighbours)
    if ('problem' in resolved) return `The claim ${identity.name} ${resolved.problem}`
    if (!isIdentityType(resolved.column) && !isPointType(resolved.column.type)) {
      return `The claim ${identity.name} does arithmetic on ${name}, which is a ${resolved.column.type}. Only integer, real, money and quantity columns hold numbers.`
    }
    if (name.includes('.')) {
      forUnits.push(
        column(name, resolved.column.type, {
          unit: resolved.column.unit,
          per: resolved.column.per,
        }),
      )
    }
  }

  // Every `in` it asks for, judged against the units this document knows (U4a,
  // D-223). Here rather than in the evaluator for the reason the column check
  // above is here: an identity is judged later, somewhere else, against rows
  // nobody is looking at, and `weight in g` where `weight` is millilitres is
  // wrong on every row that will ever be typed.
  // A date, a time or an instant is a point, and the one thing it does is
  // `end - start` with another of its kind (M29 U4, D-335).
  // A claim may hold two dates, a side moved by whole days (D-471).
  const typeOf = pointTypeOf(self, neighbours)
  const pointed = equationPointProblem(equation.left, equation.right, typeOf)
  if (pointed !== undefined) return `The claim ${identity.name}: ${pointed}`
  if (identity.tolerance.kind === 'RELATIVE' && pointSide(equation.left, typeOf) !== undefined) {
    return `The claim ${identity.name} holds two points, and how far apart they may be is a number of days, not a percent.`
  }

  const unitProblem = identityUnitProblem(equation, forUnits, units)
  if (unitProblem !== undefined) return `The claim ${identity.name}: ${unitProblem}`

  const tolerance = identity.tolerance
  const amount = tolerance.kind === 'ABSOLUTE' ? tolerance.amount : tolerance.percent
  if (!Number.isFinite(amount) || amount < 0) {
    return `The claim ${identity.name} has a tolerance that is not a number at or above zero.`
  }

  return undefined
}

/**
 * One aggregate's own rules (U4b, D-224).
 *
 * **The source has to point back here, and that is the check worth having.** An
 * aggregate over `recipe_line` summing through a column that points at
 * `ingredient` would fold every line of every recipe into one total, silently,
 * and the figure would look entirely plausible. So the column is resolved, its
 * type is checked, and *what it points at* is compared with the format being
 * declared — which is the one thing a list of format names could never have
 * answered, and the reason `neighbours` carries declarations.
 */
export function aggregateRejection(
  each: AggregateDeclaration,
  self: Pick<FormatDeclaration, 'name' | 'columns'> & Partial<Pick<FormatDeclaration, 'aggregates' | 'derived'>>,
  neighbours: readonly FormatDeclaration[] = [],
  units: UnitTable = SEEDED_UNITS,
): string | undefined {
  const nameProblem = nameRejection(each.name, 'aggregate')
  if (nameProblem !== undefined) return nameProblem

  if (!(AGGREGATE_KINDS as readonly string[]).includes(each.kind)) {
    return `The total ${each.name} is a ${String(each.kind)}, which is not one of ${AGGREGATE_KINDS.join(', ')}.`
  }

  const source: (Pick<FormatDeclaration, 'name' | 'columns'> & Partial<Pick<FormatDeclaration, 'aggregates' | 'derived'>>) | undefined =
    each.over.format === self.name
      ? self
      : neighbours.find((one) => one.name === each.over.format)
  if (source === undefined) {
    return `The total ${each.name} runs over ${each.over.format}, and this document declares no format called that.`
  }

  // **Every row, said on purpose** (M34 U4, D-397): `every course` names no
  // link, so there is no link to check — and the fold the check below exists
  // to stop happening by accident is the one this asks for in a word.
  const over = each.over.column
  if (over !== undefined) {
    const link = source.columns.find((one) => one.name === over)
    if (link === undefined) {
      return `The total ${each.name} runs over ${each.over.format}.${over}, and ${each.over.format} has no such column.`
    }
    // A `links` column is gathered by too (M27 U2, D-300): the rows whose list
    // holds this one — still one hop, from each of them to this row.
    if (!isLinkType(link.type)) {
      return `The total ${each.name} gathers rows by ${each.over.format}.${over}, which is a ${link.type} rather than a link, so it names no row of this format.`
    }
    if (link.target !== self.name) {
      return `The total ${each.name} gathers rows by ${each.over.format}.${over}, which points at ${link.target ?? 'nothing'} rather than at ${self.name}. Every row of ${each.over.format} would be folded into every row of this format — write \`every ${each.over.format}\` if that is what you mean.`
    }
  }

  if (each.where !== undefined) {
    const problem = filterRejection(each, source, neighbours)
    if (problem !== undefined) return problem
  }

  const orderProblem = orderRejection(each, source)
  if (orderProblem !== undefined) return orderProblem

  if (each.kind === 'COUNT') {
    if (each.expression.trim() !== '') {
      return `The total ${each.name} counts rows, so it has nothing to work out on each one. Take the expression out, or make it a sum.`
    }
    if (each.unit !== undefined) {
      return `The total ${each.name} counts rows, and a count of rows is in rows. Leave the unit out.`
    }
    return undefined
  }

  const expression = parseExpression(each.expression)
  if ('problem' in expression) return `The total ${each.name}: ${expression.problem}`

  // **In the source's vocabulary, not this format's.** The expression runs on a
  // line rather than on the recipe, and an author who wrote `servings` into it
  // meant a column of the wrong format — which is a sentence worth printing
  // rather than a name that silently never resolves.
  const names = columnsNamedBy({ left: expression, right: expression })
  if (names.length === 0) {
    return `The ${aggregateWord(each.kind)} ${each.name} names no column of ${each.over.format}, so it would be the same figure on every row.`
  }
  const forUnits: ColumnDeclaration[] = [...source.columns]
  for (const name of names) {
    if (name === TODAY) return `The total ${each.name} names ${TODAY}: a total is what a claim reads, and ${CLOCK_REASON}.`
    // **A worked-out column folds as one the row stores** (M29 F7, D-334): the
    // rows show `earned`, so a total of it is the sum of what they show. A
    // rollup has folded one since U4 (D-335); this is the aggregate agreeing.
    const worked = workedOutOf(name, source, neighbours, units)
    if (worked !== undefined) {
      if ('problem' in worked) return `The total ${each.name} folds ${name}, which ${worked.problem}`
      forUnits.push(worked.column)
      continue
    }
    const resolved = resolveName(name, source, neighbours)
    if ('problem' in resolved) {
      return `The total ${each.name} ${resolved.problem.replace('this format', each.over.format)}`
    }
    if (!isIdentityType(resolved.column) && !isPointType(resolved.column.type)) {
      return `The total ${each.name} does arithmetic on ${name}, which is a ${resolved.column.type}. Only integer, real, money and quantity columns hold numbers.`
    }
    if (name.includes('.')) {
      forUnits.push(
        column(name, resolved.column.type, {
          unit: resolved.column.unit,
          per: resolved.column.per,
        }),
      )
    }
  }

  const pointed = pointProblem(expression, pointTypeOf(source, neighbours))
  if (pointed !== undefined) return `The total ${each.name}: ${pointed}`

  const unitProblem = identityUnitProblem(
    { left: expression, right: expression },
    forUnits,
    units,
  )
  if (unitProblem !== undefined) return `The total ${each.name}: ${unitProblem}`

  if (each.unit !== undefined && unitNamed(units, each.unit) === undefined) {
    return `The total ${each.name} is in ${each.unit}, which is not a unit this document knows. Add it, or say what it is in a unit this document has.`
  }

  return undefined
}

/**
 * A derived column of the rows a total gathers, as the column it would be if
 * the rows stored it — money, or a figure in what it comes out in — or why it
 * cannot be folded. `undefined` when the name is not one (M29 F7).
 */
function workedOutOf(
  name: string,
  source: Pick<FormatDeclaration, 'name' | 'columns'> & Partial<Pick<FormatDeclaration, 'aggregates' | 'derived'>>,
  neighbours: readonly FormatDeclaration[],
  units: UnitTable,
): { readonly column: ColumnDeclaration } | { readonly problem: string } | undefined {
  if (name.includes('.') || source.columns.some((one) => one.name === name)) return undefined
  if (!(source.derived ?? []).some((one) => one.name === name)) return undefined
  const { compiled, problems } = compileDerived(
    { name: source.name, columns: source.columns, aggregates: source.aggregates ?? [], derived: source.derived ?? [] },
    neighbours.filter((one) => one.name !== source.name),
    units,
  )
  const found = compiled.find((one) => one.declaration.name === name)
  if (found === undefined) {
    const at = (source.derived ?? []).findIndex((one) => one.name === name)
    const own = problems.find((one) => one.index === at) ?? problems[0]
    return { problem: `is a computed column that does not compute: ${own?.message ?? 'it does not compile.'}` }
  }
  if (found.clock) return { problem: `reads ${TODAY}: a total is what a claim reads, and ${CLOCK_REASON}.` }
  return {
    column:
      found.type.kind === 'MONEY'
        ? column(name, 'money')
        : found.type.kind === 'DATE'
          ? column(name, 'date')
          : column(name, 'real', { unit: found.type.unit }),
  }
}

/**
 * What a `latest` or `earliest` picks by (M25 E3, D-272): a column of the
 * source's own row — never a hop, which would be ordering by a second table —
 * of a type whose stored values sort the way they mean. Every other kind folds
 * every row, and an order on one would be a word that changes nothing.
 */
function orderRejection(
  each: AggregateDeclaration,
  source: Pick<FormatDeclaration, 'name' | 'columns'>,
): string | undefined {
  if (!isOrdered(each.kind)) {
    return each.by === undefined
      ? undefined
      : `The total ${each.name} is a ${aggregateWord(each.kind)}, which folds every row, so there is nothing for "by ${each.by}" to do. Only latest and earliest pick by an order.`
  }
  const kind = aggregateWord(each.kind)
  if (each.by === undefined || each.by.trim() === '') {
    return `The total ${each.name} is the ${kind} row of ${each.over.format}, and says by what. Name the column that orders them — ${sourceText(each.over)} by as_of.`
  }
  if (each.by.includes('.')) {
    return `The total ${each.name} picks by ${each.by}, which reaches through a link. It picks by a column of ${each.over.format}'s own rows, and no further.`
  }
  const order = source.columns.find((column) => column.name === each.by)
  if (order === undefined) {
    return `The total ${each.name} picks by ${each.by}, and ${each.over.format} has no such column.`
  }
  if (!ORDER_TYPES.has(order.type)) {
    return `The total ${each.name} picks by ${each.by}, which is a ${order.type}. The ${kind} is by a date, a month, an instant or an integer.`
  }
  return undefined
}

/**
 * An aggregate's filter against its source (M24 U8, D-260): one enum or boolean,
 * of the source row or one hop through its link, and a member it really has.
 *
 * **A member the column does not have is the refusal worth having.** `OUTFLOW`
 * spelled `OUTFLOWS` would match no row, and a sum of no rows is zero — a
 * figure, not a complaint, and the one an identity would then fail on for a
 * reason nobody could find.
 */
function filterRejection(
  each: AggregateDeclaration,
  source: Pick<FormatDeclaration, 'name' | 'columns'>,
  neighbours: readonly FormatDeclaration[],
): string | undefined {
  if (each.where === undefined) return undefined
  if (each.where.clock !== undefined) {
    return `The total ${each.name} says where ${filterText(each.where)}: a total is what a claim reads, and ${CLOCK_REASON}.`
  }
  return filterProblem(`The total ${each.name}`, each.where, source, neighbours)
}

/** One filter against the format whose rows it decides — an aggregate's source, or a rollup's own. */
function filterProblem(
  who: string,
  filter: AggregateFilter,
  source: Pick<FormatDeclaration, 'name' | 'columns'>,
  neighbours: readonly FormatDeclaration[],
): string | undefined {
  const text = `where ${filterText(filter)}`
  if (filter.column.split('.').length > 2) {
    return `${who} says ${text}, which reaches two hops. A filter reads the row, or one hop through its link, and no further.`
  }
  const resolved = resolveName(filter.column, source, neighbours)
  if ('problem' in resolved) {
    return `${who}'s filter ${resolved.problem.replace('this format', source.name)}`
  }
  const decider = resolved.column
  // A window around today is a date's (D-472) — a computed date's too, which
  // only the row's own SQL can say, so a filter here names a typed one.
  if (filter.clock !== undefined) {
    return decider.type === 'date'
      ? undefined
      : `${who} says ${text}, and ${filter.column} is ${aType(decider.type)}. A window around today is a date's.`
  }
  // Whether a cell holds anything is a question of any column but a list,
  // whose members are rows of a table of their own (M36 U04).
  if (isEmptyTest(filter)) {
    return isListType(decider.type)
      ? `${who} says ${text}, and ${filter.column} is a list. Whether a list is empty is not something a filter reads.`
      : undefined
  }
  const members = filterMembers(filter)
  if (decider.type === 'boolean') {
    return members.every((member) => member === 'true' || member === 'false')
      ? undefined
      : `${who} says ${text}, and ${filter.column} is a boolean: true or false.`
  }
  if (decider.type !== 'enum') {
    return `${who} says ${text}, and ${filter.column} is a ${decider.type}. A filter is decided by an enum or a boolean, equal to a member — or by whether a column is empty.`
  }
  const unknown = members.find((member) => !decider.values.includes(member))
  if (unknown !== undefined) {
    return `${who} says ${text}, and ${filter.column} is one of ${decider.values.join(', ')}.`
  }
  return undefined
}

/** The column types a rollup folds: the ones SQL can sum exactly as stored. */
const ROLLUP_FIGURE_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'integer',
  'real',
  'decimal',
  'money',
])

/**
 * One rollup's own rules (M25 E2, D-271): the column it folds holds a figure,
 * the period is a month or a date truncated to one, the link is a link, and
 * every filter is D-260's.
 */
export function rollupRejection(
  each: RollupDeclaration,
  self: Pick<FormatDeclaration, 'name' | 'columns'> & Partial<Pick<FormatDeclaration, 'aggregates' | 'derived'>>,
  neighbours: readonly FormatDeclaration[] = [],
): string | undefined {
  const nameProblem = nameRejection(each.name, 'rollup')
  if (nameProblem !== undefined) return nameProblem
  const who = `The rollup ${each.name}`
  const columnOf = (name: string): ColumnDeclaration | undefined =>
    self.columns.find((column) => column.name === name)

  if (each.kind === 'COUNT') {
    if (each.of !== '') {
      return `${who} counts rows, so it folds no column. Write \`count by …\`, or make it a sum of ${each.of}.`
    }
  } else {
    if (each.of === '') {
      return `${who} is a ${aggregateWord(each.kind)} of nothing. Say which column: \`${each.kind.toLowerCase()} of amount by …\`.`
    }
    const figure = columnOf(each.of)
    // A derived column folds too, when it is a figure (M29 U4, D-335): the
    // rollup reads it out of the same SQL its view is, so `sum of hours by
    // month of date` is the hours a person sees on each row, added up.
    const worked = (self.derived ?? []).find((one) => one.name === each.of)
    if (figure === undefined && worked !== undefined) {
      const compiled = compileDerived(
        { name: self.name, columns: self.columns, aggregates: self.aggregates ?? [], derived: self.derived ?? [] },
        neighbours,
      ).compiled.find((one) => one.declaration.name === each.of)
      if (compiled?.type.kind === 'MONEY') {
        return `${who} folds ${each.of}, which is computed as money, and a rollup folds a computed column only when it is a number. Fold the money columns it is made of.`
      }
      if (compiled?.type.kind === 'DATE') {
        return `${who} folds ${each.of}, which is computed as a date, and a rollup folds a computed column only when it is a number.`
      }
    } else {
      if (figure === undefined) return `${who} folds ${each.of}, and ${self.name} has no such column.`
      if (figure.type === 'quantity') {
        return `${who} folds ${each.of}, a quantity, whose rows may be in different units — and a rollup adds what is stored rather than converting it. Fold it with an aggregate, which converts.`
      }
      if (!ROLLUP_FIGURE_TYPES.has(figure.type)) {
        return `${who} folds ${each.of}, which is a ${figure.type}. Only integer, real, decimal and money columns hold figures — or a column computed from them.`
      }
      if (figure.type === 'money' && each.kind === 'AVERAGE') {
        return `${who} is an average of ${each.of}, which is money — and an average of money is not an amount anybody paid. Declare the sum and the count.`
      }
    }
  }

  const periodType = each.period.truncate ? 'date' : 'month'
  const periods = [each.period.column, ...(each.period.fallback === undefined ? [] : [each.period.fallback])]
  for (const name of periods) {
    const column = columnOf(name)
    if (column === undefined) return `${who} is by ${name}, and ${self.name} has no such column.`
    if (column.type === 'instant') {
      return `${who} is by ${name}, an instant — and which month a moment falls in depends on a time zone this document does not hold. Group by a date or a month.`
    }
    if (column.type !== periodType) {
      return each.period.truncate
        ? `${who} is by month of ${name}, which is a ${column.type}. \`month of\` takes a date column.`
        : column.type === 'date'
          ? `${who} is by ${name}, which is a date. Write \`month of ${name}\` to group its rows by month.`
          : `${who} is by ${name}, which is a ${column.type}. A rollup is by a month column, or by \`month of\` a date column.`
    }
  }

  if (each.by !== undefined) {
    const link = columnOf(each.by)
    if (link === undefined) return `${who} is by ${each.by}, and ${self.name} has no such column.`
    if (link.type !== 'link') {
      return `${who} is by ${each.by}, which is a ${link.type}. Besides the month, a rollup groups by one link — the rows it names are what the figure is per.`
    }
  }

  const said = new Set<string>()
  for (const filter of each.where) {
    const problem = filterProblem(who, filter, self, neighbours)
    if (problem !== undefined) return problem
    if (said.has(filter.column)) {
      return `${who} filters on ${filter.column} twice. One member each; a filter has no \`or\`.`
    }
    said.add(filter.column)
  }
  return undefined
}

/** Re-exported so a surface printing a declaration needs one import. */
export { rollupText }

/** The types a rule set may order its rules by: a whole number, a day, a month, a moment, or an enum's declared order. */
const RULE_ORDER_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>(['integer', 'date', 'month', 'instant', 'enum'])

/**
 * One rule set's own rules (M25 E4, D-273): what it sets and what it sets it
 * from point at one format, what it reads is text, the kind is on the list,
 * the order is required, and the source is an enum holding both members.
 * `self` is the rule format and the target is a neighbour — a document holding
 * the rules and not what they set is refused rather than half-declared.
 */
export function ruleSetRejection(
  each: RuleSetDeclaration,
  self: Pick<FormatDeclaration, 'name' | 'columns'>,
  neighbours: readonly FormatDeclaration[] = [],
): string | undefined {
  const nameProblem = nameRejection(each.name, 'rule set')
  if (nameProblem !== undefined) return nameProblem
  const who = `The rule set ${each.name}`
  const own = (name: string): ColumnDeclaration | undefined => self.columns.find((column) => column.name === name)

  if (each.target === self.name) {
    return `${who} sets ${self.name}'s own rows. A rule set's rows are rules, and what they set is another format.`
  }
  const target = neighbours.find((format) => format.name === each.target)
  if (target === undefined) return `${who} sets ${each.target}, and this document declares no such format.`
  const theirs = (name: string): ColumnDeclaration | undefined =>
    target.columns.find((column) => column.name === name)

  const sets = theirs(each.sets)
  if (sets === undefined) return `${who} sets ${each.target}.${each.sets}, and ${each.target} has no such column.`
  if (sets.type !== 'link') {
    return `${who} sets ${each.target}.${each.sets}, which is a ${sets.type}. A rule set sets a link — the row a rule names.`
  }
  const from = own(each.from)
  if (from === undefined) return `${who} sets it from ${each.from}, and ${self.name} has no such column.`
  if (from.type !== 'link' || from.target !== sets.target) {
    return `${who} sets ${each.target}.${each.sets}, which points at ${sets.target ?? 'nothing'}, from ${each.from}, which ${from.type === 'link' ? `points at ${from.target ?? 'nothing'}` : `is a ${from.type}`}. Both have to name rows of one format.`
  }

  for (const name of each.reads) {
    const read = theirs(name)
    if (read === undefined) return `${who} reads ${each.target}.${name}, and ${each.target} has no such column.`
    if (read.type !== 'text') {
      return `${who} reads ${each.target}.${name}, which is a ${read.type}. A pattern matches text.`
    }
  }
  if (new Set(each.reads).size !== each.reads.length) return `${who} reads one column twice.`

  const pattern = own(each.pattern)
  if (pattern === undefined) return `${who} matches ${each.pattern}, and ${self.name} has no such column.`
  if (pattern.type !== 'text') {
    return `${who} matches ${each.pattern}, which is a ${pattern.type}. A pattern is a text column of the rule's row.`
  }

  if (!('fixed' in each.kind)) {
    const kind = own(each.kind.column)
    if (kind === undefined) return `${who} is by ${each.kind.column}, and ${self.name} has no such column.`
    if (kind.type !== 'enum') {
      return `${who} is by ${each.kind.column}, which is a ${kind.type}. A rule's kind is an enum whose members are named against the list — or one kind for every rule, \`as contains\`.`
    }
    if (each.kind.members.length === 0) return `${who} names no member of ${each.kind.column} as a kind it reads.`
    const seen = new Set<string>()
    for (const [member] of each.kind.members) {
      if (!kind.values.includes(member)) {
        return `${who} reads ${each.kind.column} ${member}, and ${each.kind.column} is one of ${kind.values.join(', ')}.`
      }
      if (seen.has(member)) return `${who} names ${member} twice.`
      seen.add(member)
    }
  }

  for (const name of each.order) {
    const column = own(name)
    if (column === undefined) return `${who} is first by ${name}, and ${self.name} has no such column.`
    if (!RULE_ORDER_TYPES.has(column.type)) {
      return `${who} is first by ${name}, which is a ${column.type}. Rules are ordered by a whole number, a date, a month, an instant or an enum's declared order.`
    }
    if (!column.required) {
      return `${who} is first by ${name}, which may be empty — and a rule with no place in the order is one the engine would have to place by guessing. Make ${name} required.`
    }
  }
  if (new Set(each.order).size !== each.order.length) return `${who} orders by one column twice.`

  const said = new Set<string>()
  for (const filter of each.where) {
    if (filter.column.includes('.')) {
      return `${who} filters on ${filter.column}. A rule set's filter reads the rule's own row.`
    }
    // `scope_account is empty`: a rule that carries a condition this sentence
    // cannot say is left to whoever can (D-273).
    if (filter.is === EMPTY) {
      if (own(filter.column) === undefined) return `${who} filters on ${filter.column}, and ${self.name} has no such column.`
      if (said.has(filter.column)) return `${who} filters on ${filter.column} twice.`
      said.add(filter.column)
      continue
    }
    const problem = filterProblem(who, filter, self, neighbours)
    if (problem !== undefined) return problem
    if (said.has(filter.column)) return `${who} filters on ${filter.column} twice.`
    said.add(filter.column)
  }

  const source = theirs(each.source)
  if (source === undefined) {
    return `${who} is recorded in ${each.target}.${each.source}, and ${each.target} has no such column.`
  }
  if (source.type !== 'enum') {
    return `${who} is recorded in ${each.target}.${each.source}, which is a ${source.type}. Where a value came from is an enum, with a member for a rule and one for a person.`
  }
  for (const member of [each.ruleMember, each.personMember]) {
    if (!source.values.includes(member)) {
      return `${who} writes ${member} into ${each.target}.${each.source}, which is one of ${source.values.join(', ')}.`
    }
  }
  if (each.ruleMember === each.personMember) {
    return `${who} records a rule's value and a person's as one member, ${each.ruleMember} — and then nothing could tell them apart.`
  }

  if (each.noting !== undefined) {
    const noting = theirs(each.noting)
    if (noting === undefined) {
      return `${who} notes the rule in ${each.target}.${each.noting}, and ${each.target} has no such column.`
    }
    if (noting.type !== 'link' || noting.target !== self.name) {
      return `${who} notes the rule in ${each.target}.${each.noting}, which has to be a link to ${self.name}.`
    }
  }
  const written = [each.sets, each.source, ...(each.noting === undefined ? [] : [each.noting])]
  if (new Set(written).size !== written.length) return `${who} writes one column of ${each.target} for two things.`
  if (each.reads.some((name) => written.includes(name))) return `${who} reads a column it writes.`
  return undefined
}

export { ruleSetText }

/**
 * Why a declaration cannot be accepted, in a sentence, or nothing.
 *
 * The first problem, which is what a reader with one line to spend wants: the
 * artefact parser, the plugin's refusal, a model's retry.
 */
export function declarationRejection(
  declaration: FormatDeclaration,
  neighbours: readonly FormatDeclaration[] = [],
  units: UnitTable = SEEDED_UNITS,
): string | undefined {
  return declarationProblems(declaration, neighbours, units)[0]?.message
}

/** One column's own rules, which are the ones that become `CHECK`s. */
export function columnRejection(column: ColumnDeclaration): string | undefined {
  const nameProblem = nameRejection(column.name, 'column')
  if (nameProblem !== undefined) return nameProblem

  if (!(COLUMN_TYPES as readonly string[]).includes(column.type)) {
    return `The column ${column.name} has type ${String(column.type)}, which is not one of ${COLUMN_TYPES.join(', ')}.`
  }

  if (isChoiceType(column.type)) {
    if (column.values.length === 0) {
      return `The column ${column.name} is an ${column.type} and names no values, so nothing could ever be stored in it.`
    }
    const members = new Set<string>()
    for (const value of column.values) {
      if (value.trim() === '') return `The column ${column.name} has an empty value in its list.`
      if (members.has(value)) return `The column ${column.name} lists ${value} twice.`
      members.add(value)
    }
  } else if (column.values.length > 0) {
    return `The column ${column.name} lists values but is a ${column.type}, not an enum or enums.`
  }

  if (column.unique && !UNIQUE_TYPES.has(column.type)) {
    return `The column ${column.name} is unique but is a ${column.type}; only ${[...UNIQUE_TYPES].join(', ')} can be.`
  }

  if (column.type === 'decimal') {
    if (column.scale === undefined) {
      return `The column ${column.name} is a decimal and does not say how many places it keeps. Give it a scale from 1 to ${MAX_SCALE} — 2 for a price, 6 for a rate.`
    }
    if (!Number.isInteger(column.scale) || column.scale < 1 || column.scale > MAX_SCALE) {
      return `The column ${column.name} keeps ${String(column.scale)} places; a decimal keeps from 1 to ${MAX_SCALE}. A figure with none is an integer.`
    }
  } else if (column.scale !== undefined) {
    return `The column ${column.name} has a scale but is a ${column.type}; only a decimal keeps a count of places.`
  }

  const bounded = NUMERIC_TYPES.has(column.type)
  if (!bounded && (column.minimum !== undefined || column.maximum !== undefined)) {
    return `The column ${column.name} has a bound but is a ${column.type}; only integer, real, decimal and percent can be bounded.`
  }
  if (column.minimum !== undefined && !Number.isFinite(column.minimum)) {
    return `The column ${column.name} has a minimum that is not a number.`
  }
  if (column.maximum !== undefined && !Number.isFinite(column.maximum)) {
    return `The column ${column.name} has a maximum that is not a number.`
  }
  if (
    column.minimum !== undefined &&
    column.maximum !== undefined &&
    column.minimum > column.maximum
  ) {
    return `The column ${column.name} has a minimum of ${column.minimum} above its maximum of ${column.maximum}.`
  }
  if (column.type === 'integer') {
    if (column.minimum !== undefined && !Number.isInteger(column.minimum)) {
      return `The column ${column.name} is an integer with a fractional minimum.`
    }
    if (column.maximum !== undefined && !Number.isInteger(column.maximum)) {
      return `The column ${column.name} is an integer with a fractional maximum.`
    }
  }
  // A decimal's bound is compiled onto the stored integer, so it has to be a
  // figure the column could hold: `0.001` on a column of two places is a bound
  // the CHECK could only write as a fraction of the thing it compares.
  if (column.type === 'decimal' && column.scale !== undefined) {
    for (const [word, bound] of [
      ['minimum', column.minimum],
      ['maximum', column.maximum],
    ] as const) {
      if (bound !== undefined && !parseDecimal(String(bound), column.scale).ok) {
        return `The column ${column.name} keeps ${column.scale} places and has a ${word} of ${bound}, which it could not hold.`
      }
    }
  }

  // A time of day is not in anything either (M29 U4, D-335): what it is in
  // comes out of `end - start`, in hours.
  if (column.type === 'time' && column.unit !== undefined) {
    return `The column ${column.name} is a time of day, which is not in ${column.unit}. Leave the unit out; the span of two times comes out in hours.`
  }

  // A percent's bound is a percent — `maximum: 100` — and compiles onto the
  // stored millionths, so it has to be one the column could hold.
  if (column.type === 'percent') {
    for (const [word, bound] of [
      ['minimum', column.minimum],
      ['maximum', column.maximum],
    ] as const) {
      if (bound !== undefined && !parsePercent(String(bound)).ok) {
        return `The column ${column.name} is a percent and has a ${word} of ${bound}%, which it could not hold — a percent keeps ${PERCENT_PLACES} places.`
      }
    }
    // A share of something is not *in* anything (D-333). A unit here would be
    // read by `identityUnitProblem` and by nothing else, and a `per` needs one.
    if (column.unit !== undefined) {
      return `The column ${column.name} is a percent — a share, which is not in ${column.unit}. Leave the unit out; a figure in ${column.unit} is a real or a decimal.`
    }
  }

  // A currency lives in the row, not in the declaration: one ingredient bought
  // abroad and one bought here are two rows of one format. A `unit` on a money
  // column would be a second, quieter place for the currency to be written, and
  // the two would disagree.
  if (column.type === 'money' && column.unit !== undefined) {
    return `The column ${column.name} is money, so its currency is stored per row rather than declared as a unit.`
  }
  // An id is not *in* anything (U4b, D-224). The same shape of refusal as money
  // one line up, and worth making for the same reason: a unit on a link would
  // be read by `identityUnitProblem` and by nothing else, so it would look like
  // it meant something.
  if (isLinkType(column.type) && column.unit !== undefined) {
    return `The column ${column.name} is a link, so it holds the id of a row rather than a figure in ${column.unit}.`
  }
  // **A row elsewhere names its document in the value** (M47 U4, D-461), so
  // there is nothing here for a unit or a target to say.
  if (column.type === 'elsewhere' && column.unit !== undefined) {
    return `The column ${column.name} names a row in another document, which is not in ${column.unit}. Leave the unit out.`
  }
  if (column.type === 'elsewhere' && column.target !== undefined) {
    return `The column ${column.name} names a row in another document, and the value says which: the document's path and the row's name. Leave out what it points at.`
  }
  // A file is where it is, which the value says (M37 U6).
  if (column.type === 'file' && column.unit !== undefined) {
    return `The column ${column.name} is a file, which is not in ${column.unit}. Leave the unit out.`
  }
  if (column.type === 'file' && column.target !== undefined) {
    return `The column ${column.name} is a file, and the value says where it is. Leave out what it points at.`
  }
  if (!isLinkType(column.type) && column.target !== undefined) {
    return `The column ${column.name} points at ${column.target} but is a ${column.type}, not a link.`
  }
  // **Empty is what most rows of a `links` column hold** — a unit blocked by
  // nothing — and no `NOT NULL` could say *at least one*: the members are rows
  // of another table (M27 U2, D-300).
  if (column.type === 'links' && column.required) {
    return `The column ${column.name} links several rows, and none is a real answer, so it cannot be required.`
  }
  // **The same for several of a list** (M34 U5, D-398): a recipe with no tags
  // is a real answer, and the members are rows of a table of their own.
  if (column.type === 'enums' && column.required) {
    return `The column ${column.name} holds several of a list, and none is a real answer, so it cannot be required.`
  }
  // A word of a list is not in anything, as an enum's is not.
  if (column.type === 'enums' && column.unit !== undefined) {
    return `The column ${column.name} holds members of a list, which are not in ${column.unit}. Leave the unit out.`
  }
  if (column.unit !== undefined && column.unit.trim() === '') {
    return `The column ${column.name} has an empty unit. Leave it out rather than blank.`
  }

  // A quantity's unit is in the row, which is the whole of what the type is for
  // (U4c, D-225). One declared on the column would be a second, quieter place
  // for it to be written, and the two would disagree on the row where it
  // matters — the same refusal money gets, for the same reason.
  if (column.type === 'quantity' && column.unit !== undefined) {
    return `The column ${column.name} is a quantity, so what each figure is in is stored per row rather than declared once. That is the difference between it and a real column in ${column.unit}.`
  }

  if (column.per !== undefined) {
    if (column.per.trim() === '') {
      return `The column ${column.name} has an empty per. Leave it out rather than blank.`
    }
    // A ratio is a number, and it is *this unit per that one*. Both halves or
    // neither: a `per` with nothing above it is half a fact, and the identity
    // that bridged through it would be multiplying by a figure in nothing.
    if (!NUMERIC_TYPES.has(column.type)) {
      return `The column ${column.name} is ${column.unit ?? 'something'} per ${column.per} but is a ${column.type}. A ratio between two units is a number, so it is an integer, a real or a decimal.`
    }
    if (column.unit === undefined) {
      return `The column ${column.name} is per ${column.per} and has no unit of its own, which is half a fact. A ratio says what it is *of* as well as what it is *per* — g per ml.`
    }
    if (column.unit === column.per) {
      return `The column ${column.name} is ${column.unit} per ${column.per}, which is the number one however it was measured.`
    }
  }

  return undefined
}

export function nameRejection(
  name: string,
  kind: 'format' | 'column' | 'identity' | 'aggregate' | 'rollup' | 'rule set' | 'derived column',
): string | undefined {
  // An aggregate is called a total wherever a person reads it (M29 F9): it is
  // printed on the connection dialog where one is authored, beside fields
  // that say *total*.
  const said = kind === 'aggregate' ? 'total' : kind === 'identity' ? 'claim' : kind === 'derived column' ? 'computed column' : kind
  if (name.trim() === '') return `${/^[aeiou]/.test(said) ? 'An' : 'A'} ${said} needs a name.`
  if (!NAME_PATTERN.test(name)) {
    const example =
      kind === 'format'
        ? 'ingredient'
        : kind === 'identity'
          ? 'atwater'
          : kind === 'aggregate'
            ? 'total_kcal'
            : kind === 'rollup'
              ? 'spending'
              : kind === 'rule set'
                ? 'categories'
                : kind === 'derived column'
                  ? 'price_with_vat'
                  : 'sat_fat_g'
    return `${name} is not a usable ${said} name. Use lower-case letters, digits and underscores, starting with a letter — ${example}.`
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `The ${said} name ${name} is longer than ${MAX_NAME_LENGTH} characters.`
  }
  if ((kind === 'column' || kind === 'derived column') && name === ROW_ID_COLUMN) {
    return `${ROW_ID_COLUMN} is the column every declared table already has; call this one something else.`
  }
  // `in` is the word an identity uses to ask for a conversion (U4a, D-223) and
  // `via` is the word that names the fact it converts through (U4c, D-225). A
  // column called either would make `amount in g via density` mean two things.
  if ((kind === 'column' || kind === 'derived column') && (RESERVED_WORDS as readonly string[]).includes(name)) {
    return `${name} is a word a claim uses to convert a figure — \`amount in g via ingredient.density\`. Call this column something else.`
  }
  // `today` is the day a question is asked on (M49 U2, D-472).
  if ((kind === 'column' || kind === 'derived column') && name === TODAY) {
    return `${TODAY} is the word a question reads the day by — \`days_left = due - today\`. Call this column something else.`
  }
  if ((kind === 'column' || kind === 'derived column') && name.startsWith(TABLE_PREFIX)) {
    return `A column may not start with ${TABLE_PREFIX}; that prefix is what keeps declared tables apart from the app's own.`
  }
  return undefined
}

/** A column with the properties a `text` column has and nothing else. */
export function column(
  name: string,
  type: ColumnType,
  extra: Partial<Omit<ColumnDeclaration, 'name' | 'type'>> = {},
): ColumnDeclaration {
  return {
    name,
    type,
    unit: extra.unit,
    per: extra.per,
    required: extra.required ?? false,
    unique: extra.unique ?? false,
    scale: extra.scale,
    values: extra.values ?? [],
    minimum: extra.minimum,
    maximum: extra.maximum,
    target: extra.target,
    ...(extra.foundBy === undefined ? {} : { foundBy: extra.foundBy }),
    note: extra.note ?? '',
  }
}
