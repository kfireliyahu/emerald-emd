/**
 * The tools a declaration generates — what makes a format usable **the minute
 * it exists, with no screen at all** (M19 U2, D-210, D-217).
 *
 * ## What "generated from the declaration" turned out to mean
 *
 * The roadmap's words for this unit were *the plugin's tools are generated from
 * the declaration*, and building it found the one thing that sentence cannot
 * mean here: **`tools/list` carries no document.** The server is started by the
 * client with no path, every tool takes a path as an argument because nothing
 * is remembered between calls, and a tool named `add_ingredient` listed before
 * any document is named would be a tool about a table nobody has pointed at —
 * and could then be called against a second document that declares no such
 * thing.
 *
 * So what a declaration generates is **a tool's schema, its vocabulary and its
 * refusals, resolved against the document in the call** — and `formats` is the
 * surface that tells a conversation what exists. The six below are shaped in
 * exactly the sense D-095 means: they can name nothing but a declared format,
 * touch nothing but a `fmt_` table, and accept no SQL from anybody. A caller
 * that asks for a column the format has not got is told which columns it has,
 * in the same sentence, and gets it right next time.
 *
 * ## Why this surface edits and deletes when the rest of the plugin does not
 *
 * The instructions have said *everything here adds; nothing here edits or
 * deletes* since M8, and it was never a rule about safety — it is a rule about
 * where an edit belongs. The ledger's edits are app-side because the app has a
 * screen for each of them, built around what the app itself discovered: the
 * debt review queue, the splitter, the funding link. **A declared format's rows
 * have no screen** — `#/formats` edits the declaration (D-219) and never a row,
 * so a conversation is the only place one gets written, corrected or taken
 * back. A row nobody can correct from the only place it can be written is a row
 * that stops being true the first time a label is misread.
 *
 * `declare_format` is the other half, added by U2b: a format comes into
 * existence from the conversation the columns were worked out in, rather than
 * from a file somebody carries across. **It creates and never alters** — a
 * format that already exists is changed in the editor, where the plan is drawn
 * against the rows the table already holds.
 *
 * The protections are the ones every write here already has: a dry run by
 * default, a `.bak` before the commit, the whole batch or nothing.
 */

import { toISODate } from '@/core/time.ts'
import { today } from '../today.ts'
import { savedViewArgs, savedViewNamed, savedViewSaid } from './saved.ts'
import {
  planIsSettled,
  type ReconcilePlan,
  type ReconcileStep,
} from '@/domain/format/reconcile.ts'
import { declarationFollowingRenames, neighbourBreaks } from '@/domain/format/draft.ts'
import {
  identity,
  readTolerance,
  toleranceText,
  verdictSentence,
  type IdentityDeclaration,
} from '@/domain/format/identity.ts'
import {
  brokenConstraints,
  companionKeyOf,
  coerceEdit,
  isList,
  readValue,
  selfLinks,
  verdictsOf,
  type StoredRow,
  type StoredValue,
} from '@/domain/format/row.ts'
import {
  column,
  COLUMN_TYPES,
  type ColumnDeclaration,
  type ColumnType,
  DECLARATION_LANGUAGE,
  type DeclarationProblem,
  declarationProblems,
  type FormatDeclaration,
  inOrder,
  isLinkType,
  labelColumn,
  moneyColumnNames,
  orderChange,
  tableNameFor,
} from '@/domain/format/declaration.ts'
import { typeBriefing, wordsForTypes } from '@/domain/format/vocabulary.ts'
import { constraintKey, constraintText, parseConstraint, type RowConstraint } from '@/domain/format/constraint.ts'
import { figureText, parseRollup, rollupText, type RollupDeclaration } from '@/domain/format/rollup.ts'
import { instantDay } from '@/core/instant.ts'
import { formatMoney, money as moneyAmount } from '@/core/money.ts'
import { runRollup } from '@/data/repositories/formatRollupRepository.ts'
import {
  adoptFormat,
  changeMarks,
  deleteFormat,
  formatsPointingAt,
  listFormats,
  orphanedTables,
  planFor,
  rowCountOf,
  rowsBreaking,
  rowsHolding,
  unreadableFormats,
} from '@/data/repositories/formatRepository.ts'
import {
  countRows,
  deleteRows,
  insertRows,
  isHeldTo,
  linkingSentences,
  linkLabels,
  listRows,
  readRow,
  repeatedValues,
  rowsLinkingTo,
  repeatsIn,
  type RowQuery,
  updateRow,
} from '@/data/repositories/formatRowRepository.ts'
import {
  applyFoundLink,
  applyRuleSet,
  findRuleSet,
  planFoundLink,
  planRuleSet,
  findersFor,
  rulesSetting,
  withRules,
  type RuleSetPlan,
} from '@/data/repositories/formatRuleRepository.ts'
import { parseRuleSet, ruleSetText, type RuleSetDeclaration } from '@/domain/format/rule.ts'
import {
  addUnit,
  correctUnit,
  documentCurrency,
  listUnits,
  setDocumentCurrency,
} from '@/data/repositories/unitRepository.ts'
import { parseCurrency } from '@/domain/format/currency.ts'
import { stageRows } from '@/data/repositories/formatBatchRepository.ts'
import {
  aggregatesOf,
  foldAggregate,
  linksByColumns,
  danglingLinks as danglingLinksIn,
  linksByName,
  indexOf,
  inputsWithAggregates,
  type FormatIndex,
  type RowAggregate,
} from '@/data/repositories/formatJoinRepository.ts'
import {
  aggregate,
  aggregateFigure,
  aggregateSentence,
  AGGREGATE_KINDS,
  filterText,
  overText,
  parseFilter,
  word as aggregateWord,
  type AggregateDeclaration,
  type AggregateFilter,
  type AggregateKind,
} from '@/domain/format/aggregate.ts'
import { connect, freeColumnName, type ConnectionRequest } from '@/domain/format/connections.ts'
import { foundByText, matchedOn, parseFoundBy, type FindPlan, type FoundBy, type Unplaced } from '@/domain/format/foundBy.ts'
import {
  DIMENSIONS,
  SEEDED_UNITS,
  unitRejection,
  unitsOf,
  word,
  type Dimension,
  type UnitRow,
  type UnitTable,
} from '@/domain/format/unit.ts'

import { err, ok, type Result } from '@/core/result.ts'

import { elsewhereLabels, elsewhereValues } from '../elsewhere.ts'
import { fileLabels } from '../fileCells.ts'
import { readDocument, type OpenDocument } from '../document.ts'
import type { Database } from 'sql.js'
import { count, money, paragraphs, plural, section, table, verb } from '../format.ts'
import { withFilesPlaced } from '@/domain/format/file.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { filterQuery, matchCells, type FilterRefusal, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { columnValues } from '@/data/repositories/formatValuesRepository.ts'
import { declarationChangeRefusal, deleteFormatRefusal, rowWriteRefusal } from '@/domain/format/owner.ts'
import { evaluateIdentity, figureText as numberText, type IdentityInputs } from '@/domain/format/identity.ts'
import {
  compileDerived,
  derived as derivedColumn,
  derivedViewNameFor,
  type DerivedDeclaration,
  type DerivedValue,
} from '@/domain/format/derived.ts'
import { derivedOf, type RowDerived } from '@/data/repositories/formatDerivedRepository.ts'
import {
  ToolInputError,
  booleanProp,
  limitArg,
  numberProp,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  stringProp,
  PATH_PROP,
  type Args,
  type PluginTool,
} from './tool.ts'
import { arrangementText } from './views.ts'

/** One call. Beyond this the thing to reconsider is the batch, not the ceiling. */
const BATCH_MAX = 200

/**
 * Columns in one declaration. The vault's widest note has twenty-five, and a
 * format past this is a sign that two kinds of thing are being described as one.
 */
const COLUMNS_MAX = 64

const ROWS_DEFAULT = 25
const ROWS_MAX = 200

/** What `rule_sets` is, said once for both tools that take it (D-273). */
const RULE_SETS_DESCRIPTION =
  'Rows of this format as rules setting a link of another, each `{ name, sets, note }`: ' +
  '`note.topic from target when title matches pattern by kind (EXACT equals, PART ' +
  'contains) first by priority, recorded in topic_source as RULE, never over MANUAL`. Kinds: ' +
  'equals, contains, starts with, regex. `apply_rules` runs them.'

/** What `computed` is (D-334; named `derived` before M33 U3a). */
const DERIVED_DESCRIPTION =
  'Computed columns, worked out rather than typed, each `{ name, works_out, note }`: a claim\u2019s ' +
  'expression with no `=` \u2014 `price * (1 + vat)`, `amount in g`, `link.column`, an aggregate\u2019s ' +
  'name, another computed column, `end - start` of two times or dates, `due - 3 days`, `due - today`. Money stays money; empty ' +
  'when an input is.'

/** What `rollups` is, said once for both tools that take it (D-271). */
const ROLLUPS_DESCRIPTION =
  'Figures per month over this format’s rows, each `{ name, works_out, note }`: ' +
  '`sum of minutes by month of done_on or started_on and project where status ' +
  'is DONE` — sum, count, average, minimum or maximum; `of` one number or money ' +
  'column (none for count); `by` a month column or `month of` a date, one `or` fallback; ' +
  'optionally `and` one link; `where` filters as an aggregate’s, joined by `and`.'

// --- resolving a format, which every tool here does first -------------------

/**
 * The declaration this call is about, or a sentence saying why there is none.
 *
 * Three ways there is none, and they want three different answers: the document
 * declares no formats at all, it declares others, or it declares this one and
 * **its table has not caught up with it**. The third is the interesting one.
 * The app reconciles a document's tables when it opens it and the plugin never
 * does (D-094, D-216), so a format edited in the app and not yet opened there
 * has a declaration ahead of its table — and a row written against it would be
 * a row missing a column with nobody told. Refused, and the fix is one sentence
 * long.
 */
export function resolve(
  document: OpenDocument,
  name: string,
): { readonly declaration: FormatDeclaration } | { readonly refusal: string } {
  const declared = listFormats(document.db)
  const declaration = declared.find((one) => one.name === name)

  if (declaration === undefined) {
    const unreadable = unreadableFormats(document.db).find((one) => one.name === name)
    if (unreadable !== undefined) {
      return { refusal: `This document declares ${name}, but ${unreadable.reason}` }
    }
    if (declared.length === 0) {
      return {
        refusal:
          `${document.path} declares no formats yet. Work out the columns with the user — what ` +
          'one row is, what they will ask of it later, and whether any of its figures relate — ' +
          'and call `declare_format`; it takes a minute. The app has the same thing as a form ' +
          'at `#/formats`.',
      }
    }
    return {
      refusal:
        `This document has no format called ${name}. It has ` +
        `${declared.map((one) => one.name).join(', ')}.`,
    }
  }

  const plan = planFor(document.db, declaration)
  if (!planIsSettled(plan)) return { refusal: unsettled(declaration, plan) }
  return { declaration }
}

function unsettled(declaration: FormatDeclaration, plan: ReconcilePlan): string {
  const why =
    plan.refusals.length > 0
      ? plan.refusals.map((refusal) => `${refusal.column}: ${refusal.detail}`).join(' ')
      : `${plural(plan.steps.length, 'change')} to its table ${verb(plan.steps.length, 'is', 'are')} outstanding.`
  return (
    `The table behind ${declaration.name} does not match its declaration, so nothing here will ` +
    `touch it. ${why} Open the document in the Emerald app once — it reconciles a declared ` +
    'table on open, and this plugin deliberately never does.'
  )
}

/** Run `work` against a resolved format, or answer with the refusal. */
function withFormat<T extends string | Promise<string>>(
  document: OpenDocument,
  name: string,
  work: (declaration: FormatDeclaration) => T,
): string | T {
  const resolved = resolve(document, name)
  return 'refusal' in resolved ? resolved.refusal : work(resolved.declaration)
}

// --- formats ----------------------------------------------------------------

/** One declared column, as a row of the column table. */
function columnRow(column: ColumnDeclaration): readonly string[] {
  const bounds =
    column.minimum === undefined && column.maximum === undefined
      ? '-'
      : `${column.minimum === undefined ? '' : `≥ ${String(column.minimum)}`}${
          column.minimum !== undefined && column.maximum !== undefined ? ' ' : ''
        }${column.maximum === undefined ? '' : `≤ ${String(column.maximum)}`}`

  const companion = companionKeyOf(column)
  return [
    companion === undefined ? column.name : `${column.name} + ${companion}`,
    column.scale === undefined
      ? column.foundBy === undefined
        ? column.type
        : `${column.type}, found by ${foundByText(column.foundBy)}`
      : `${column.type}, ${String(column.scale)} places`,
    column.per === undefined ? (column.unit ?? '-') : `${column.unit ?? '?'} per ${column.per}`,
    // One cell for both constraints a column carries on its own, rather than a
    // column of `-` on every format that has no unique one (D-255).
    [column.required ? 'yes' : '', column.unique ? 'unique' : ''].filter((each) => each !== '').join(', ') ||
      '-',
    column.values.length === 0 ? '-' : column.values.join(' | '),
    bounds,
    column.note === '' ? '-' : column.note,
  ]
}

/**
 * What this document can convert between (M19 U4a, D-223).
 *
 * **On the list rather than on each format**, because it is a property of the
 * document and not of any one kind of thing, and because the reader who needs
 * it is the one about to write an identity with an `in` in it. A conversion is
 * resolved against these rows, so a caller that assumed this build's table
 * would be wrong in exactly the kitchen where `tbsp` is 20 ml.
 *
 * The dimensions are printed as a line each rather than a table: a reader wants
 * to know whether their symbol is in here, and a twenty-eight-row table to
 * answer that is the kind of output that costs more to read than it says.
 */
function unitsText(units: UnitTable, currency?: string | undefined): string {
  const lines = DIMENSIONS.map((dimension) => {
    const members = unitsOf(units, dimension)
    if (members.length === 0) return undefined
    return `- **${word(dimension)}** — ${members.map((each) => `\`${each.symbol}\``).join(', ')}`
  }).filter((line): line is string => line !== undefined)

  return paragraphs(
    section(
      'Units this document knows',
      [
        ...lines,
        '',
        '**Conversion happens inside a dimension and never across one.** `weight in kg` is ' +
          "arithmetic; `volume in g` needs a density, and a density is a fact about the thing " +
          'being measured rather than about the units, so it belongs in a column of the format. ' +
          'A unit this document has not got — `slice`, `IU`, a 20 ml tablespoon — is added with ' +
          '`record_units`, and a factor that is a convention rather than a definition can be ' +
          'corrected the same way.',
      ].join('\n'),
    ),
    // The document's currency, beside its units (M29 F3, D-344).
    currency === undefined
      ? 'No currency is chosen for this document; `record_units` with `currency` sets one.'
      : `**Currency:** ${currency} — what a new amount on a screen starts in. A row still names its own.`,
  )
}

/**
 * **When a format last changed** (M47 U5, D-462): the day a row of it was last
 * added, changed or removed, or its declaration changed. A text document
 * written before there were marks has none until its next write.
 */
export function changedDay(mark: number | undefined): string {
  return mark === undefined ? 'not marked yet' : instantDay(mark)
}

/** The same, as a clause: `last changed 2026-10-06`. */
export function lastChanged(mark: number | undefined): string {
  return mark === undefined ? 'no change marked yet' : `last changed ${instantDay(mark)}`
}

function describeFormat(document: OpenDocument, declaration: FormatDeclaration): string {
  const rows = rowCountOf(document.db, declaration)
  const changed = changeMarks(document.db).get(declaration.name)

  return paragraphs(
    `**${declaration.title}** — \`${declaration.name}\`, stored as ` +
      `\`${tableNameFor(declaration)}\`, ${plural(declaration.columns.length, 'column')}, ` +
      `${plural(rows, 'row')}, ${lastChanged(changed)}.`,
    table(
      ['Column', 'Type', 'Unit', 'Constraint', 'Values', 'Bounds', 'What it means'],
      declaration.columns.map(columnRow),
    ),
    identitiesText(declaration),
    constraintsText(declaration),
    rollupsText(declaration),
    ruleSetsText(declaration),
    derivedText(declaration, listFormats(document.db)),
    declaration.notes.trim() === ''
      ? undefined
      : section('What the declaration says about this format', declaration.notes.trim()),
    // M35 U4 (D-403): read before `arrange_views` changes it.
    arrangementText(document, declaration),
    'A row is written with `record_format_rows`, read with `format_rows`, corrected with ' +
      '`update_format_rows` and removed with `delete_format_rows`. A `money` column takes the ' +
      'amount in major units beside its own currency key, and a `quantity` column takes the ' +
      'figure beside its own unit key — the pair in the Column cell above, and both halves ' +
      'every time, because an amount without what it is in is a number that means nothing.',
  )
}

/**
 * One column as a writer needs it, and nothing it does not: the name, bold when
 * required; its type, left out for text; the members of an enum; what a link
 * points at; the key a money or quantity column takes beside it; and the two
 * things a write is refused over that the type does not say — unique, bounds.
 */
function compactColumn(column: ColumnDeclaration): string {
  const name = column.required ? `**${column.name}**` : column.name
  const companion = companionKeyOf(column)
  const unit =
    column.unit === undefined ? '' : column.per === undefined ? ` in ${column.unit}` : ` in ${column.unit} per ${column.per}`
  const type = (() => {
    switch (column.type) {
      case 'text':
        return ''
      case 'enum':
        return column.values.join('|')
      case 'enums':
        return `[${column.values.join('|')}]`
      case 'link':
        return `→ ${column.target ?? '?'}`
      case 'links':
        return `→ [${column.target ?? '?'}]`
      case 'elsewhere':
        return '→ "<path>.emd <row name>"'
      case 'money':
        return `money + ${companion ?? '?'}`
      case 'quantity':
        return `quantity + ${companion ?? '?'}`
      case 'decimal':
        return `decimal(${String(column.scale ?? 0)})${unit}`
      default:
        return `${column.type}${unit}`
    }
  })()
  const bounds =
    column.minimum !== undefined && column.maximum !== undefined
      ? `${String(column.minimum)}–${String(column.maximum)}`
      : column.minimum !== undefined
        ? `≥ ${String(column.minimum)}`
        : column.maximum !== undefined
          ? `≤ ${String(column.maximum)}`
          : ''
  const said = [type, bounds, column.unique ? 'unique' : ''].filter((each) => each !== '').join(', ')
  return said === '' ? name : `${name}: ${said}`
}

/**
 * **What a row looks like, one line per format** (M47 U2, D-460) — what
 * `start_here` appends after its views, so that the first call of a session is
 * enough to write a row.
 *
 * A week on three documents found every session calling `formats` once per
 * format it was about to write, up to eight times, 3 to 6 KB each, before it
 * could record a unit. The columns belong to the document, so nothing beside
 * it can say them; this is them, generated from the declarations, so it cannot
 * be stale. `formats` stays the whole declaration, with its prose.
 *
 * **A pack's locked format is named, never spelled out**: its rows are written
 * only through the pack (D-269), so its columns are not what a writer needs,
 * and a ledger's thirty-four would be most of the answer.
 */
export function compactDeclarations(declarations: readonly FormatDeclaration[]): string {
  if (declarations.length === 0) return ''
  const open = declarations.filter((each) => each.owner === undefined)
  const packs = new Map<string, string[]>()
  for (const each of declarations) {
    if (each.owner === undefined) continue
    packs.set(each.owner.pack, [...(packs.get(each.owner.pack) ?? []), each.name])
  }
  const lines = open.map((declaration) => {
    const columns = [
      ...declaration.columns.map(compactColumn),
      ...(declaration.derived ?? []).map((each) => `${each.name} = \`${each.expression}\``),
    ]
    return `- \`${declaration.name}\` — ${columns.join(' · ')}`
  })
  return paragraphs(
    '### What a row looks like',
    open.length === 0
      ? undefined
      : '**Bold** is required, a column with no type is text, `a|b` is one of and `[a|b]` several, ' +
          '`→ x` is a row of x and `→ [x]` a list of them, and `name = …` is worked out, never written.',
    lines.join('\n'),
    open.length === 0
      ? undefined
      : 'Every write — `record_format_rows`, `update_format_rows`, `delete_format_rows` — is a dry run ' +
          'until `commit: true`. A link takes the row’s id, or its name when one row has it. ' +
          '`formats` with a `format` is the whole declaration: its notes, units and what must hold.',
    writeShapeText(open),
    ...[...packs].map(
      ([pack, names]) =>
        `Written only through the ${pack} pack: ${names.join(', ')}. \`formats\` reads any of them.`,
    ),
  )
}

/** The one array a write tool's schema takes — `rows`, `edits` — and what each entry of it may hold. */
function batchKeyOf(tool: PluginTool): { readonly key: string; readonly entry: readonly string[] } {
  const properties = (tool.definition.inputSchema.properties ?? {}) as Record<string, { type?: string; items?: { properties?: object } }>
  const found = Object.entries(properties).find(([, each]) => each.type === 'array')
  if (found === undefined) throw new Error(`${tool.definition.name} takes no list.`)
  return { key: found[0], entry: Object.keys(found[1].items?.properties ?? {}) }
}

/**
 * **What a write looks like, in one line** (M51 F4) — read off the two tools'
 * own schemas, so it cannot name a key they have not got: a driver took three
 * tries at an edit's shape, guessing `rows`, `match` and `set` before `edits`,
 * `where` and `values`. The row named is a declared format's own unique column.
 */
function writeShapeText(open: readonly FormatDeclaration[]): string | undefined {
  const keyed = open.find((each) => each.columns.some((column) => column.unique && column.type === 'text'))
  if (keyed === undefined) return undefined
  const unique = keyed.columns.find((column) => column.unique && column.type === 'text')?.name ?? 'id'
  const record = batchKeyOf(recordFormatRowsTool)
  const update = batchKeyOf(updateFormatRowsTool)
  const where = update.entry.includes('where') ? 'where' : 'id'
  const values = update.entry.includes('values') ? 'values' : (update.entry[0] ?? 'values')
  return (
    `A write’s shape: \`record_format_rows format:${keyed.name} ${record.key}:[{…}]\` · ` +
    `\`update_format_rows format:${keyed.name} ${update.key}:[{${where}:{${unique}:…}, ${values}:{…}}]\`.`
  )
}

/**
 * The row constraints (M24 U7, D-259), each as the sentence `declare_format`
 * takes — so what a conversation reads back is what it would write. Nothing at
 * all for a format that has none.
 */
function constraintsText(declaration: FormatDeclaration): string {
  const constraints = declaration.constraints ?? []
  if (constraints.length === 0) return ''
  return section(
    `${plural(constraints.length, 'row constraint')} — refused at the write, not reported after it`,
    table(
      ['Rule', 'Why'],
      constraints.map((each) => [`\`${constraintText(each)}\``, each.note === '' ? '-' : each.note]),
    ),
  )
}

/**
 * The cells a rule set wrote (D-273) — what the rules added to a row beyond
 * what the writer sent, so the dry run can show them beside what was offered.
 */
function ruledOnly(
  offered: Readonly<Record<string, StoredValue>>,
  before: Readonly<Record<string, StoredValue>>,
  after: Readonly<Record<string, StoredValue>>,
): Readonly<Record<string, StoredValue>> {
  return Object.fromEntries(
    Object.entries(after).filter(([key, value]) => (before[key] ?? null) !== value && !(key in offered && offered[key] === value)),
  )
}

/**
 * The rollups (M25 E2, D-271), each as the sentence `declare_format` takes, and
 * the tool that runs one. Nothing for a format that has none.
 */
function rollupsText(declaration: FormatDeclaration): string {
  const rollups = declaration.rollups ?? []
  if (rollups.length === 0) return ''
  return section(
    `${plural(rollups.length, 'rollup')} — a figure per month, run with \`format_rollup\``,
    table(
      ['Name', 'Works out', 'Why'],
      rollups.map((each) => [`\`${each.name}\``, `\`${rollupText(each)}\``, each.note === '' ? '-' : each.note]),
    ),
  )
}

/**
 * The derived columns a format declares (D-334): each with what it works out
 * and what it comes out as, and the view anything can read them from.
 */
function derivedText(declaration: FormatDeclaration, others: readonly FormatDeclaration[]): string {
  const list = declaration.derived ?? []
  if (list.length === 0) return ''
  const { compiled } = compileDerived(
    declaration,
    others.filter((each) => each.name !== declaration.name),
  )
  return section(
    `${plural(list.length, 'computed column')} — worked out on read, never typed, and in SQL as \`${derivedViewNameFor(declaration)}\``,
    table(
      ['Name', 'Works out', 'Comes out as', 'Why'],
      list.map((each) => {
        const type = compiled.find((one) => one.declaration.name === each.name)?.type
        const as =
          type === undefined
            ? '-'
            : type.kind === 'MONEY'
              ? 'money'
              : type.kind === 'DATE'
                ? 'a date'
                : type.unit === undefined
                ? 'a number'
                : `a number in ${type.unit}`
        return [`\`${each.name}\``, `\`${each.expression}\``, as, each.note === '' ? '-' : each.note]
      }),
    ),
  )
}

/** One derived figure as a reader sees it, or the reason its cell is empty. */
function derivedValueText(value: DerivedValue): string {
  if (value.kind === 'EMPTY') return `empty — ${value.reason}`
  if (value.kind === 'MONEY') {
    return value.currency === undefined
      ? numberText(value.minor / 100)
      : formatMoney(moneyAmount(value.minor, value.currency))
  }
  if (value.kind === 'DATE') return value.date
  return `${numberText(value.value)}${value.unit === undefined ? '' : ` ${value.unit}`}`
}

/** A derived column as `declare_format` takes it: `{ name, works_out, note }`. */
function derivedOfOffered(offered: unknown, index: number): Result<DerivedDeclaration, string> {
  const where = `Computed column ${String(index + 1)}`
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { ok: false, error: `${where} is not an object with a \`name\` and \`works_out\`.` }
  }
  const entry = offered as Record<string, unknown>
  const unknown = Object.keys(entry).filter((key) => !['name', 'works_out', 'note'].includes(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `${where} was given ${unknown.join(', ')}; a computed column has a \`name\`, \`works_out\` and a \`note\`.`,
    }
  }
  const name = typeof entry['name'] === 'string' ? entry['name'].trim() : ''
  const worksOut = entry['works_out']
  if (typeof worksOut !== 'string' || worksOut.trim() === '') {
    return { ok: false, error: `${where}${name === '' ? '' : ` (${name})`} has no \`works_out\`.` }
  }
  return ok(derivedColumn(name, worksOut.trim(), typeof entry['note'] === 'string' ? entry['note'] : ''))
}

function identitiesText(declaration: FormatDeclaration): string {
  if (declaration.identities.length === 0) {
    return (
      'This format makes no claim, so no row of ' +
      'it is ever proved or failed. If something *should* hold, `extend_format` adds a ' +
      'claim, and so does the format’s own table in the app.'
    )
  }
  return paragraphs(
    section(
      `${plural(declaration.identities.length, 'claim')} — what this format claims`,
      table(
        ['Claim', 'Holds', 'Tolerance', 'Why'],
        declaration.identities.map((each) => [
          each.name,
          `\`${each.expression}\``,
          toleranceText(each.tolerance),
          each.note === '' ? '-' : each.note,
        ]),
      ),
    ),
    'These are judged as a row is read rather than stored with it, and a row a claim fails on ' +
      'is **kept and reported** — a label whose macros come to 61.6 against a printed 62 is a ' +
      'real label. `format_rows` carries the verdict for each row: proved, failed, or unchecked ' +
      'when the row has nothing in a column the claim names. A tolerance on a money column is ' +
      'in minor units.',
  )
}

export const formatsTool: PluginTool = {
  definition: {
    name: 'formats',
    title: 'Declared formats',
    description:
      'What kinds of thing this document holds — every format ' +
      'declared in it, with its columns, their types, units, bounds and enum members, and the ' +
      'prose the author wrote around them. The columns are declared per document: `start_here` ' +
      'ends with one line per format, enough to write a row, and this is the whole declaration. ' +
      'Name a `format` for its full column list; omit it for the list of ' +
      'what is declared. Reads the file; never modifies it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('One declared format by name, for its full column list.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const wanted = optionalString(args, 'format')

    return readDocument(path, (document) => {
      if (wanted !== undefined) {
        return withFormat(document, wanted, (declaration) => describeFormat(document, declaration))
      }

      const declared = listFormats(document.db)
      const unreadable = unreadableFormats(document.db)
      const orphans = orphanedTables(document.db)

      if (declared.length === 0 && unreadable.length === 0) {
        return paragraphs(
          `${document.path} declares no formats.`,
          'A format is a kind of thing this document can hold — an ingredient, a book, a ' +
            'workout — declared as markdown and compiled to a real typed table at `#/formats` ' +
            'in the app, or by `declare_format` here. Ask the user what one row is, what they ' +
            'will want to ask of it later, and whether any of its figures relate; the columns ' +
            'fall out of those answers. If they already keep it — a spreadsheet, a .json of rows, ' +
            'or a folder of Markdown notes — declare the format and then `read_onto_format` it onto it.',
        )
      }

      const marks = changeMarks(document.db)
      const unsettledNames = declared
        .filter((declaration) => !planIsSettled(planFor(document.db, declaration)))
        .map((declaration) => declaration.name)

      return paragraphs(
        `${plural(declared.length, 'format')} declared in ${document.path}.`,
        declared.length === 0
          ? undefined
          : table(
              ['Format', 'Name', 'Table', 'Columns', 'Rows', 'Last changed'],
              declared.map((declaration) => [
                declaration.title,
                declaration.name,
                tableNameFor(declaration),
                count(declaration.columns.length),
                count(rowCountOf(document.db, declaration)),
                // M47 U5 (D-462): a format nobody writes says so.
                changedDay(marks.get(declaration.name)),
              ]),
            ),
        declared.length === 0
          ? undefined
          : 'Call this again with a `format` name for its columns — that is what says what a ' +
            'row looks like, and the columns belong to this document rather than to this build.',
        unsettledNames.length === 0
          ? undefined
          : `${plural(unsettledNames.length, 'format')} — ${unsettledNames.join(', ')} — ` +
            `${verb(unsettledNames.length, 'has', 'have')} a table that does not match the ` +
            'declaration, and nothing here will touch one until the app has opened the ' +
            'document once.',
        unreadable.length === 0
          ? undefined
          : section(
              'Declared, and not readable by this build',
              table(
                ['Format', 'Why'],
                unreadable.map((one) => [one.name, one.reason]),
              ),
            ),
        orphans.length === 0
          ? undefined
          : `${plural(orphans.length, 'table')} — ${orphans.join(', ')} — ${verb(orphans.length, 'carries', 'carry')} ` +
            'the declared-format prefix with no declaration behind it. Left strictly alone.',
        unitsText(listUnits(document.db), documentCurrency(document.db)),
      )
    })
  },
}

// --- format_rows ------------------------------------------------------------

/**
 * The day a question is asked on, `YYYY-MM-DD` — the plugin's own clock
 * (`../today.ts`, S-064), read here at the edge and handed to the engine, which
 * reads none (M49 U2, D-472).
 */
export function askedOn(): string {
  return toISODate(today())
}

/**
 * **`match` and `search`, as every tool that filters a format's rows takes
 * them** — `format_rows`, and `show_format` since M44 U6 — so the two cannot
 * drift in what they promise. Read by `filterArgs`.
 */
export const MATCH_PROP = {
  type: 'object',
  description:
    'Column name to the value it must equal. Text and enum columns match without ' +
    'regard to case; money or a quantity, a range: `10..50 ILS`. A list is any of them (`[planned, in_progress]`; a list column holding any), ' +
    '`{not: x}` or `{not: [a, b]}` none (empty passes), `null` empty. ' +
    'A date takes `within 14 days`, `before today`, `after today`, `today`.',
  additionalProperties: true,
} as const

export const SEARCH_PROP = stringProp('A substring, in every column as shown but yes/no.')

/** The columns a caller asked to see, or every one of them. */
function chosenColumns(
  declaration: FormatDeclaration,
  args: Args,
  worked: readonly string[] = [],
): readonly ColumnDeclaration[] {
  const raw = args['columns']
  if (raw === undefined || raw === null) return declaration.columns
  if (!Array.isArray(raw)) throw new ToolInputError('`columns` must be an array of column names.')

  return raw.map((name) => {
    if (typeof name !== 'string') throw new ToolInputError('`columns` must be an array of names.')
    const column = declaration.columns.find((one) => one.name === name)
    if (column === undefined) {
      throw new ToolInputError(
        `${declaration.name} has no column ${name}. It has ` +
          `${declaration.columns.map((one) => one.name).join(', ')}` +
          `${worked.length === 0 ? '' : `, and works out ${worked.join(', ')}`}.`,
      )
    }
    return column
  })
}

/**
 * **A filter, read the one way every reader reads it** (M44 U6): the caller's
 * `match` and `search` as the `RowQuery` `filterQuery` makes of them, which is
 * what `show_format` and the app's format screen hand `listRows` too. Refused
 * in the tool's words, naming the argument.
 */
export function filterArgs(
  db: Database,
  declaration: FormatDeclaration,
  args: Args,
  declarations: readonly FormatDeclaration[] = listFormats(db),
): { readonly filter: RowFilter; readonly query: RowQuery } {
  const raw = args['match']
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new ToolInputError('`match` must be an object of column name to value.')
  }
  const search = optionalString(args, 'search')
  const filter: RowFilter = {
    ...(raw === undefined || raw === null ? {} : { match: raw as Record<string, unknown> }),
    ...(search === undefined ? {} : { search }),
  }
  const query = filterQuery(db, declaration, filter, declarations, askedOn())
  if (!query.ok) throw new ToolInputError(filterRefusalText('match', declaration, query.error))
  return { filter, query: query.value }
}

/** A refused filter, as a tool says it: which argument, and why. */
function filterRefusalText(field: string, declaration: FormatDeclaration, refusal: FilterRefusal): string {
  return refusal.kind === 'NO_COLUMN'
    ? `\`${field}\` names ${refusal.name}, which ${declaration.name} has not got. It has ` +
        `${declaration.columns.map((one) => one.name).join(', ')}.`
    : `\`${field}\`: ${refusal.reason}`
}

/** One value, printed the way the app prints that kind of thing. */
export function cellText(
  column: ColumnDeclaration,
  row: StoredRow,
  labels: ReadonlyMap<string, string> = new Map(),
): string {
  const value = readValue(column, row)
  if (value === undefined) return '-'
  // **A link prints what the row it names is called** (M22 U1). The id is what
  // is stored and what a write has to send; it is not what a reader came for,
  // and `supersedes: 0c0af4de-…` cost a second call every time anybody read
  // one. An id with no label is a row that is gone or a target with no text
  // column, and then the id is the only name it has.
  if (column.type === 'link' && typeof value === 'string') return labels.get(value) ?? value
  // **A row elsewhere prints what it holds now beside it** (M47 U4, D-461):
  // `F:/projects/site/site.emd S1 U5 → unit S1 U5 · built`, or why not.
  if (column.type === 'elsewhere' && typeof value === 'string') {
    const read = labels.get(value)
    return read === undefined ? value : `${value} → ${read}`
  }
  // **A file that has gone says so** (M37 U6): `scans/a.pdf · missing`.
  if (column.type === 'file' && typeof value === 'string') {
    const read = labels.get(value)
    return read === undefined ? value : `${value} · ${read}`
  }
  // Several rows, each by its name (M27 U2, D-300).
  if (isList(value)) return value.map((id) => labels.get(id) ?? id).join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  // **A quantity prints its unit and is never a bare number** (U4c, D-225).
  // `150` beside `200` where one is grams and the other millilitres is the
  // reading this type exists to prevent, and a caller reads this text.
  if ('amount' in value) return `${String(value.amount)} ${value.unit}`
  return money(value)
}

/**
 * A row as a block rather than a table cell.
 *
 * Thirty-one columns across a markdown table is a row nobody can read, and the
 * format this engine was designed against has thirty-one. So: a table when the
 * caller narrowed the columns, and a block per row when it did not — which is
 * also what the vault note this format came from looks like. An empty column is
 * left out of a block entirely; that a figure is absent is legible from its
 * absence, and printing thirty dashes per row is the sort of output that makes
 * a conversation expensive for nothing.
 */
/**
 * One row with its links resolved and its aggregates folded (U4b, D-224).
 *
 * Carried into `rowBlock` rather than recomputed inside it, because the two
 * things a reader sees — a total, and a verdict about that total — have to have
 * come off the same fold. A block printing `total_kcal: 2140` beside
 * `per_serving: proved` computed from a second, later fold would be a verifier
 * proving something other than what it showed, which is the law this file is
 * built on (D-138).
 */
interface JoinedRow {
  readonly inputs: IdentityInputs
  readonly aggregates: readonly RowAggregate[]
  /** Its derived figures, out of the same SQL the view is (D-334). */
  readonly derived?: readonly RowDerived[]
}

function joinOf(
  document: OpenDocument,
  declaration: FormatDeclaration,
  row: StoredRow,
  formats: FormatIndex,
  units: UnitTable,
): JoinedRow {
  return {
    inputs: inputsWithAggregates(document.db, declaration, row, formats, units),
    aggregates: aggregatesOf(document.db, declaration, row, formats, units),
    derived: derivedOf(document.db, declaration, [row], formats, units, askedOn()).get(row.id) ?? [],
  }
}

/**
 * Text longer than `max`, cut there and said to be — on one line, since it is
 * printed inside a list or a table (M38 U1). A dry run echoed a 16 KB note in
 * full, the largest cost of a read after the reading itself; what a person
 * checks there is that the right column landed, which the start shows.
 */
export function cutShort(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max).trimEnd()}… (${text.length.toLocaleString('en-US')} characters, cut short here)`
}

export function rowBlock(
  declaration: FormatDeclaration,
  row: StoredRow,
  units: UnitTable = SEEDED_UNITS,
  joined: JoinedRow | undefined = undefined,
  labels: ReadonlyMap<string, string> = new Map(),
  cutAt: number | undefined = undefined,
): string {
  const lines = declaration.columns
    .map((column) => ({ column, text: cutAt === undefined ? cellText(column, row, labels) : cutShort(cellText(column, row, labels), cutAt) }))
    .filter((one) => one.text !== '-')
    .map((one) => `- ${one.column.name}: ${one.text}${one.column.unit === undefined ? '' : ` ${one.column.unit}`}`)
  // **The totals go above the proofs** (U4b), because an identity may name one:
  // a reader following `per_serving: failed — 452 against 430` needs the figure
  // that went into it to already be on the page.
  const worked = (joined?.derived ?? []).map(
    (each) => `- ${each.compiled.declaration.name}: ${derivedValueText(each.value)} (derived)`,
  )
  const totals = (joined?.aggregates ?? []).map(
    (each) => `- ${aggregateSentence(each.aggregate, each.value)}`,
  )
  // **The verdicts go with the row rather than in a summary underneath.** A
  // proof that is true of something the reader has to go and find is the shape
  // D-138 keeps catching, and this is the surface where a row is actually read.
  const proofs = (
    joined === undefined
      ? verdictsOf(declaration, row, units)
      : declaration.identities.map((identity) => ({
          identity,
          verdict: evaluateIdentity(identity, joined.inputs, units),
        }))
  ).map((each) => `- ${verdictSentence(each.identity, each.verdict)}`)
  return [`**${row.id}**`, ...lines, ...worked, ...totals, ...proofs].join('\n')
}

export const formatRowsTool: PluginTool = {
  definition: {
    name: 'format_rows',
    title: 'Rows of a declared format',
    description:
      'The rows this document holds of one declared format. Ask `formats` first for the ' +
      'column names — they belong to the document. `match` filters on exact values (text and ' +
      'enum members case-insensitively; a list column, the rows holding the one named), `search` a substring in every column as shown (a price ' +
      'as 12.90, a link by its row’s name) but yes/no, and `order` sorts by any column, computed too — by default the one a row is named ' +
      'by, which is its first text column. Narrow `columns` to get a table of ' +
      'just those — a computed column (a total, or one worked out from the row) by its name too; leave it out and each row comes back in full with its empty columns left ' +
      'out, **and with what its claims say about it** — proved, failed, or unchecked when ' +
      'the row has nothing in a column one of them names. Every row carries the id the other ' +
      'tools use to correct or remove it. Reads the file; never modifies it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name. `formats` lists them.'),
        match: MATCH_PROP,
        search: SEARCH_PROP,
        columns: {
          type: 'array',
          description: 'Column names to show, as a table — stored or computed. Omit for every column.',
          items: { type: 'string' },
        },
        order: stringProp('A declared column to sort by. Defaults to the column a row is named by — its first text column — which is what the screen sorts by too. Ordering by the generated id shuffles, since an id is generated rather than counted.'),
        descending: booleanProp('Sort the other way. Defaults to false.'),
        limit: {
          type: 'number',
          description: `Rows to return. Defaults to ${String(ROWS_DEFAULT)}, at most ${String(ROWS_MAX)}.`,
        },
        offset: numberProp('Rows to skip first — the `offset` a cut-short answer hands back for the rest.'),
        values: stringProp('A column: each value it holds and how many rows, under the other filters.'),
        view: stringProp(
          'A saved view’s name: its match, search, order and columns, under any given here.',
        ),
      },
      required: ['path', 'format'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (given) => {
    const path = requireString(given, 'path')
    const name = requireString(given, 'format')
    const limit = limitArg(given, ROWS_DEFAULT, ROWS_MAX)
    const offset = Math.max(0, Math.floor(optionalNumber(given, 'offset') ?? 0))
    const viewName = optionalString(given, 'view')

    return readDocument(path, (document) =>
      withFormat(document, name, async (declaration) => {
        // **A saved view by its name** (M53 U5, D-520): its filter, order and
        // columns laid under whatever this call gives.
        const saved = viewName === undefined ? undefined : savedViewNamed(document.db, declaration.name, viewName)
        const args = saved === undefined ? given : savedViewArgs(saved, given, { withFolds: false, columnsAsList: true })
        // A worked-out figure may be asked for by name beside the stored ones:
        // a derived column (D-334), and a total folded from the rows that point
        // here (M38 U5) — `recipe has no column total_kcal` was a figure the
        // full block printed and the table refused.
        const derivedNames = new Set((declaration.derived ?? []).map((each) => each.name))
        const totalNames = new Set(declaration.aggregates.map((each) => each.name))
        const asked = Array.isArray(args['columns']) ? (args['columns'] as unknown[]) : undefined
        const wantedDerived = (asked ?? []).filter(
          (each): each is string => typeof each === 'string' && (derivedNames.has(each) || totalNames.has(each)),
        )
        const columns = chosenColumns(
          declaration,
          asked === undefined ? args : { ...args, columns: asked.filter((each) => !wantedDerived.includes(each as string)) },
          [...derivedNames, ...totalNames],
        )
        const narrowed = args['columns'] !== undefined && args['columns'] !== null
        const order = optionalString(args, 'order')
        // A computed column sorts too (M49 U1, D-471), as the screen sorts it.
        if (order !== undefined && !declaration.columns.some((one) => one.name === order) && !derivedNames.has(order)) {
          throw new ToolInputError(
            `\`order\` names ${order}, which ${declaration.name} has not got. It has ` +
              `${[...declaration.columns.map((one) => one.name), ...derivedNames].join(', ')}.`,
          )
        }

        const valuesOf = optionalString(args, 'values')
        if (valuesOf !== undefined) return valuesText(document.db, declaration, valuesOf, filterArgs(document.db, declaration, args).filter)

        const { query: filtered } = filterArgs(document.db, declaration, args)
        // **The default order is the column a row is named by, not its id**
        // (M22 U1). An id is generated rather than counted, so ordering by it
        // shuffles: M20's units came back U5, T4, U3, U1, U6, T1, U4, U0, U7,
        // U2. The screen has defaulted to this column since D-216 and the tool
        // never did, which is a parity gap in the plain sense — the same rows,
        // read two ways, in two orders.
        const sorted = order ?? labelColumn(declaration)?.name
        const request: RowQuery = {
          ...filtered,
          ...(sorted === undefined ? {} : { order: sorted }),
          descending: optionalBoolean(args, 'descending') ?? false,
          limit,
          offset,
        }

        const total = countRows(document.db, declaration, request)
        const rows = listRows(document.db, declaration, request)

        if (rows.length === 0 && offset > 0 && total > 0) {
          return `${plural(total, 'row')} of ${declaration.title} match, and \`offset: ${String(offset)}\` is past the last of them.`
        }
        if (rows.length === 0) {
          return paragraphs(
            `No ${declaration.title.toLowerCase()} rows match.`,
            rowCountOf(document.db, declaration) === 0
              ? `${declaration.name} has no rows at all yet — \`record_format_rows\` is what puts one in.`
              : `${declaration.name} holds ${plural(rowCountOf(document.db, declaration), 'row')}; ` +
                'the filters are what excluded them.',
          )
        }

        // **What this batch's links are called**, read once like the units and
        // the formats below and for the same reason: it is a query, and it does
        // not change between rows.
        // A row in another document is read there, and what it holds now goes
        // beside it (M47 U4, D-461) — the shown rows only, each file once.
        const labels = new Map([
          ...linkLabels(document.db, rows, declaration, listFormats(document.db)),
          ...(await elsewhereLabels(elsewhereValues(declaration, rows), path)),
          ...fileLabels(declaration, rows, path),
        ])

        // **The rest is one call away, and the answer says which** (M38 U5).
        // A trial listing 250 rows read the first 200 and had no way to the
        // other fifty but a filter it had to invent.
        const last = offset + rows.length
        const shown =
          total === rows.length ? '' : `, showing ${count(offset + 1)}–${count(last)}`
        const rest =
          last < total
            ? `Showing ${count(offset + 1)}–${count(last)} of ${plural(total, 'row')}. The rest: the same call with \`offset: ${String(last)}\`` +
              `${rows.length < ROWS_MAX ? ` (and \`limit\` up to ${count(ROWS_MAX)})` : ''}.`
            : undefined

        return paragraphs(
          `${plural(total, 'row')} of ${declaration.title}${shown}${saved === undefined ? '' : ` in the saved view ${saved.name} (${savedViewSaid(saved)})`}.`,
          narrowed
            ? ((): string => {
                const formats = indexOf(listFormats(document.db))
                const units = listUnits(document.db)
                const figures =
                  wantedDerived.some((name) => derivedNames.has(name))
                    ? derivedOf(document.db, declaration, rows, formats, units, askedOn())
                    : new Map<string, readonly RowDerived[]>()
                const totals = declaration.aggregates.filter((each) => wantedDerived.includes(each.name))
                return table(
                  ['Id', ...columns.map((column) => column.name), ...wantedDerived],
                  rows.map((row) => {
                    const folded = new Map(
                      totals.map((each) => [each.name, foldAggregate(document.db, each, row.id, formats, units)]),
                    )
                    return [
                      row.id,
                      ...columns.map((column) => cellText(column, row, labels)),
                      ...wantedDerived.map((name) => {
                        const sum = folded.get(name)
                        if (sum !== undefined) return sum.kind === 'VALUE' ? aggregateFigure(sum) : 'unchecked'
                        const found = figures.get(row.id)?.find((each) => each.compiled.declaration.name === name)
                        return found === undefined || found.value.kind === 'EMPTY' ? '-' : derivedValueText(found.value)
                      }),
                    ]
                  }),
                )
              })()
            : ((): string => {
                // **The document's units and the document's formats** — U4a
                // carried the first of these onto the plan and never spent it
                // here, so a verdict was judged against the table this build
                // ships rather than the one the file holds. Read once for the
                // batch, because both are a query and neither changes between
                // rows.
                const units = listUnits(document.db)
                const formats = indexOf(listFormats(document.db))
                return rows
                  .map((row) =>
                    rowBlock(
                      declaration,
                      row,
                      units,
                      joinOf(document, declaration, row, formats, units),
                      labels,
                    ),
                  )
                  .join('\n\n')
              })(),
          rest,
        )
      }),
    )
  },
}

/**
 * **A column's values, counted** (M37 U4) — the header menu's list, as a
 * conversation reads it: under the other columns held and the search, the
 * column's own hold set aside, so the counts are what is left to narrow by.
 */
function valuesText(db: Database, declaration: FormatDeclaration, name: string, filter: RowFilter): string {
  const read = columnValues(db, declaration, name, filter, listFormats(db), askedOn())
  if (!read.ok) throw new ToolInputError(filterRefusalText(read.error.kind === 'NO_COLUMN' ? 'values' : 'match', declaration, read.error))
  const found = read.value
  const lead = `${plural(found.rows, 'row')} of ${declaration.title}${filter.match === undefined && filter.search === undefined ? '' : ' under the other filters'}.`
  if (found.kind === 'PASSAGES') return paragraphs(lead, `${name} holds passages, not values to list — \`search\` finds them.`)
  if (found.kind === 'RANGE') {
    return paragraphs(
      lead,
      table(['In', 'Rows', 'Least', 'Most'], [
        ...found.units.map((each) => [each.unit, count(each.count), each.least, each.most]),
        ...(found.empty === 0 ? [] : [['(empty)', count(found.empty), '-', '-']]),
      ]),
      `Held by a range in one of them: \`match:{${name}: "10..50 ${found.units[0]?.unit ?? 'ILS'}"}\`.`,
    )
  }
  return paragraphs(
    lead,
    table(['Value', 'Rows'], [
      ...found.values.map((each) => [each.value === each.label ? each.value : `${each.label} (${each.value})`, count(each.count)]),
      ['(empty)', count(found.empty)],
    ]),
  )
}

// --- the three writes -------------------------------------------------------

/** A batch argument, read before the document is opened. */
function batchOf(args: Args, field: string, noun: string): readonly Record<string, unknown>[] {
  const raw = args[field]
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(`\`${field}\` must be a non-empty array of ${noun} objects.`)
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(
      `That is ${String(raw.length)} ${noun}s; the ceiling is ${String(BATCH_MAX)} in one call.`,
    )
  }
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ToolInputError(`\`${field}[${String(index)}]\` must be an object.`)
    }
    return entry as Record<string, unknown>
  })
}

/**
 * What a batch would do, with the reasons it would not.
 *
 * **A bad value refuses the whole call and writes nothing**, which is the rule
 * `create_category` already set for a malformed entry: a caller that sent
 * `micros_basis: "Label "` will send the corrected batch a second later, and a
 * half-applied one would have to be reconciled by hand first. A *data*
 * condition — an id that is not there — is per entry, because the rest of the
 * batch is still correct and the answer names every outcome.
 */
interface Refused {
  readonly index: number
  readonly reason: string
}

function refusalText(refusals: readonly Refused[], noun: string): string {
  return paragraphs(
    `**Nothing was written.** ${plural(refusals.length, `${noun} was`, `${noun}s were`)} refused, ` +
      'and this tool applies a batch whole or not at all.',
    table(
      ['Entry', 'Why'],
      refusals.map((refusal) => [`#${String(refusal.index + 1)}`, refusal.reason]),
    ),
    'Fix them and send the whole batch again.',
  )
}

// --- record_format_rows -----------------------------------------------------

interface RecordPlan {
  readonly declaration: FormatDeclaration | undefined
  readonly blocked: string | undefined
  readonly existing: number
  readonly cells: readonly Readonly<Record<string, StoredValue>>[]
  /** One per row of `cells`, drawn in the plan so the batch could name itself. */
  readonly ids: readonly string[]
  /**
   * `cells` before a link's name became its id (D-256) — what the dry run
   * prints, so a person confirming `supersedes: D-240` reads D-240 and not the
   * id it resolved to, which is a row this batch may not have written yet.
   */
  readonly shown: readonly Readonly<Record<string, StoredValue>>[]
  readonly refusals: readonly Refused[]
}

/**
 * `resolve`, for a tool about to write the format's rows: a format a pack owns
 * is written only through the pack (M25 E5, D-269), and the refusal says where.
 * Asked in the plan, so the dry run says it before anybody commits.
 */
export function resolveWritable(
  document: OpenDocument,
  name: string,
): { readonly declaration: FormatDeclaration } | { readonly refusal: string } {
  const resolved = resolve(document, name)
  if ('refusal' in resolved) return resolved
  const locked = rowWriteRefusal(resolved.declaration)
  return locked === undefined ? resolved : { refusal: locked }
}

export function recordMutation(name: string, offered: readonly Record<string, unknown>[]): Mutation<RecordPlan> {
  return {
    // A batch of many rows keeps a named copy first (M34 U6, D-399).
    copyBefore: (plan) => ({ what: `adding ${plan.cells.length} rows to ${name}`, rows: plan.cells.length }),
    // Whole or not at all, so a refused batch takes no copy of the document
    // to explain that nothing happened.
    refuses: (plan) => plan.blocked !== undefined || plan.refusals.length > 0,

    plan: (document) => {
      const resolved = resolveWritable(document, name)
      if ('refusal' in resolved) {
        return {
          declaration: undefined,
          blocked: resolved.refusal,
          existing: 0,
          cells: [],
          ids: [],
          shown: [],
          refusals: [],
        }
      }

      // The plan is the sheet's too (M26 U2): a paste is this batch, judged
      // by the same function, so a screen and a conversation cannot disagree
      // about what a batch of rows may hold (D-227).
      // A file under the document's folder is kept beside it (M37 U6).
      const batch = stageRows(document.db, resolved.declaration, withFilesPlaced(resolved.declaration, offered, document.path))
      return {
        declaration: resolved.declaration,
        blocked: undefined,
        existing: rowCountOf(document.db, resolved.declaration),
        cells: batch.accepted.map((each) => each.cells),
        ids: batch.accepted.map((each) => each.id),
        shown: batch.accepted.map((each) => ({
          ...each.typed,
          ...ruledOnly(each.typed, each.named, each.cells),
        })),
        refusals: batch.refusals.map(({ index, reason }) => ({ index, reason })),
      }
    },

    describe: (plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      if (plan.refusals.length > 0) return refusalText(plan.refusals, 'row')
      const declaration = plan.declaration
      if (declaration === undefined) return 'No format resolved.'

      return paragraphs(
        `${plural(plan.cells.length, 'row')} would be added to ${declaration.title} ` +
          `(\`${declaration.name}\`), which already holds ${plural(plan.existing, 'row')}.`,
        plan.shown
          .map((row, index) =>
            [
              `**Row ${String(index + 1)}**`,
              ...declaration.columns
                .map((column) => ({ column, text: cellText(column, { id: '', cells: row }) }))
                .filter((one) => one.text !== '-')
                .map(
                  (one) =>
                    `- ${one.column.name}: ${one.text}` +
                    `${one.column.unit === undefined ? '' : ` ${one.column.unit}`}`,
                ),
            ].join('\n'),
          )
          .join('\n\n'),
        'Every value above is what will be stored, after the declaration’s own types and bounds ' +
          'were applied to what you sent. Check it against the label, the page or the person ' +
          'who told you — that is the whole point of showing it.',
      )
    },

    apply: (document, plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      if (plan.refusals.length > 0) return refusalText(plan.refusals, 'row')
      const declaration = plan.declaration
      if (declaration === undefined) return 'No format resolved.'

      const ids = insertRows(document.db, declaration, plan.cells, plan.ids)
      return paragraphs(
        `${plural(ids.length, 'row')} added to ${declaration.title}, which now holds ` +
          `${plural(rowCountOf(document.db, declaration), 'row')}.`,
        table(
          ['Row', 'Id'],
          ids.map((id, index) => [`#${String(index + 1)}`, id]),
        ),
        // **And a text document's are already stale** (M22 U6, D-247). Its
        // rows have no ids in the file: the ids above are the ones this write
        // used, and reopening derives fresh ones from what each row now says
        // (D-245 is why — the text names a row and never numbers it). Saying so
        // costs a sentence; the alternative is a caller following an
        // instruction that cannot work and reading *no row with that id* as its
        // own mistake. A link no longer needs one (D-256): it may name its row
        // by a unique naming column, which a text document does keep.
        document.encoding === 'text'
          ? 'This document is stored as text, which holds no row ids, so the ids above end with ' +
            'this call. Ask `format_rows` for them again before `update_format_rows` or ' +
            '`delete_format_rows`. A link does not need one: it may name its row by the column ' +
            'that row is called by, where that column is unique.'
          : 'Those ids are what `update_format_rows` and `delete_format_rows` take.',
      )
    },
  }
}

export const recordFormatRowsTool: PluginTool = {
  definition: {
    name: 'record_format_rows',
    title: 'Record rows of a declared format',
    description:
      'Write rows into a declared format — **a list of them in one call**. The columns belong ' +
      'to the document — `start_here` lists them, `formats` in full — and a key the format has not got ' +
      'refuses the batch rather than being dropped, because a figure you believe you stored ' +
      'and did not is worse than one you know is missing. A `money` column takes the amount in ' +
      'major units beside its own `<column>_currency` key, and a `quantity` column takes the ' +
      'figure beside a `<column>_unit` key naming a unit this document knows — `amount: 200` ' +
      'with `amount_unit: ml`. A `link` takes the row’s id, its name (first text column) when ' +
      'one row has it — `recipe: "Pancakes"` — or columns that find one: `{name: "Salt", ' +
      'brand: "Fine"}`, or one unique column alone: `course: {notion_id: "a1b2"}`; a row may name another of the same batch. ' +
      'Types, bounds and enum members are ' +
      'checked before anything is written and the whole batch applies or none of it does. ' +
      'Returns the diff and writes nothing until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name.'),
        rows: {
          type: 'array',
          description:
            `One object per row, keyed by declared column name. Up to ${String(BATCH_MAX)} in a call.`,
          items: { type: 'object', additionalProperties: true },
        },
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path', 'format', 'rows'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const name = requireString(args, 'format')
    const rows = batchOf(args, 'rows', 'row')
    return mutatingCall(path, args['commit'] === true, recordMutation(name, rows))
  },
}

// --- update_format_rows -----------------------------------------------------

interface Edit {
  readonly id: string
  readonly cells: Readonly<Record<string, StoredValue>>
  readonly before: StoredRow
  /** Where it was in the batch, for a refusal found after the others (D-255). */
  readonly index: number
}

interface UpdatePlan {
  readonly declaration: FormatDeclaration | undefined
  readonly blocked: string | undefined
  readonly edits: readonly Edit[]
  readonly refusals: readonly Refused[]
}

export function updateMutation(name: string, offered: readonly Record<string, unknown>[]): Mutation<UpdatePlan> {
  return {
    copyBefore: (plan) => ({ what: `changing ${plan.edits.length} rows of ${name}`, rows: plan.edits.length }),
    // Whole or not at all, so a refused batch takes no copy of the document
    // to explain that nothing happened.
    refuses: (plan) => plan.blocked !== undefined || plan.refusals.length > 0,

    plan: (document) => {
      const resolved = resolveWritable(document, name)
      if ('refusal' in resolved) {
        return { declaration: undefined, blocked: resolved.refusal, edits: [], refusals: [] }
      }
      const declaration = resolved.declaration

      const edits: Edit[] = []
      const refusals: Refused[] = []
      const listed = listFormats(document.db)
      const formats = indexOf(listed)
      const rules = rulesSetting(document.db, declaration, listed)
      const finders = findersFor(document.db, declaration, listed)
      offered.forEach((entry, index) => {
        const found = rowAddressed(document.db, declaration, entry)
        if (!found.ok) {
          refusals.push({ index, reason: found.error })
          return
        }
        const before = found.value
        const id = before.id
        // **A conditional write** (M27 U6): the edit lands only on the row as
        // the caller last saw it. Checked here, inside the plan that runs again
        // in the write transaction under the document's lock, so of two
        // sessions claiming one unit the second is refused rather than both
        // being told it is theirs.
        const unmet = unmetExpectations(document.db, declaration, before, entry['expect'])
        if (unmet !== undefined) {
          refusals.push({ index, reason: unmet })
          return
        }
        const values = entry['values']
        if (typeof values !== 'object' || values === null || Array.isArray(values)) {
          refusals.push({ index, reason: '`values` must be an object of column name to value.' })
          return
        }
        const [placed = {}] = withFilesPlaced(declaration, [values as Record<string, unknown>], document.path)
        const byColumns = linksByColumns(document.db, declaration, placed, formats)
        if (!byColumns.ok) {
          refusals.push({ index, reason: byColumns.error.reason })
          return
        }
        const coerced = coerceEdit(declaration, byColumns.value, listUnits(document.db))
        if (!coerced.ok) {
          refusals.push({ index, reason: coerced.error })
          return
        }
        // A name resolves against the document as it stands (D-256): an edit
        // renaming a row and another naming it by its new name in the same
        // batch is two calls, because the batch is judged before any of it
        // lands.
        const [named = coerced.value] = linksByName(document.db, declaration, [coerced.value], formats)
        // The rules read the row as it would stand (D-273): an edit to the text
        // they match re-sorts a row that is theirs, and an edit to the link is a
        // person's.
        const ruled = withRules(document.db, declaration, named, before.cells, rules, finders)
        // A link found by a date that found no row, or two (D-350).
        if (ruled.refusals.length > 0) {
          refusals.push({ index, reason: ruled.refusals.map((one) => one.reason).join(' ') })
          return
        }
        const cells = ruled.cells
        const dangling = [...danglingLinks(document, declaration, cells, formats), ...selfLinks(declaration, id, cells)]
        if (dangling.length > 0) {
          refusals.push({ index, reason: dangling.join(' ') })
          return
        }
        // Judged on the row as it would stand: an edit naming one column of a
        // constraint over two is still held to both (D-259).
        const broken = brokenConstraints(declaration, { ...before.cells, ...cells })
        if (broken.length > 0) {
          refusals.push({ index, reason: broken.join(' ') })
          return
        }
        edits.push({ id, cells, before, index })
      })

      for (const repeat of repeatedValues(
        document.db,
        declaration,
        // The row as it would stand: an edit to one column of a `one row per`
        // collides in the others it left alone (D-270).
        edits.map((each) => ({ ...each.before.cells, ...each.cells })),
        edits.map((each) => each.id),
      )) {
        refusals.push({ index: edits[repeat.row]?.index ?? repeat.row, reason: repeat.message })
      }
      refusals.sort((a, b) => a.index - b.index)

      return { declaration, blocked: undefined, edits, refusals }
    },

    describe: (plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      if (plan.refusals.length > 0) return refusalText(plan.refusals, 'edit')
      const declaration = plan.declaration
      if (declaration === undefined) return 'No format resolved.'

      return paragraphs(
        `${plural(plan.edits.length, 'row')} of ${declaration.title} would change.`,
        table(
          ['Id', 'Column', 'Now', 'Would become'],
          plan.edits.flatMap((edit) =>
            declaration.columns
              .filter((column) => touches(column, edit.cells))
              .map((column) => [
                edit.id,
                column.name,
                cellText(column, edit.before),
                cellText(column, { id: edit.id, cells: edit.cells }),
              ]),
          ),
        ),
        'Columns not named above are left exactly as they are.',
      )
    },

    apply: (document, plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      if (plan.refusals.length > 0) return refusalText(plan.refusals, 'edit')
      const declaration = plan.declaration
      if (declaration === undefined) return 'No format resolved.'

      // In an order the table takes (M48 U1): the batch was judged by where it ends.
      const written = updateInOrder(document.db, declaration, plan.edits)
      const changed = plan.edits.filter((_, at) => written[at] === true)
      return paragraphs(
        `${plural(changed.length, 'row')} of ${declaration.title} changed.`,
        table(
          ['Id', 'Columns changed'],
          changed.map((edit) => [
            edit.id,
            declaration.columns
              .filter((column) => touches(column, edit.cells))
              .map((column) => column.name)
              .join(', '),
          ]),
        ),
      )
    },
  }
}

/**
 * **Several edits, written in an order the table takes** (M48 U1). A batch is
 * judged by where it ends (`repeatedValues`), but the table's unique indexes
 * judge each `UPDATE` as it lands: moving `Current` from one semester to the
 * next refuses if the new one is set before the old one is cleared. So an edit
 * the index refuses waits for the rest and is tried again, until a round writes
 * nothing more — the clears land first whatever order the batch was written
 * in. What still refuses then is a cycle no order settles (two rows swapping a
 * unique value), and it throws, inside the caller's transaction, so nothing of
 * the batch is kept.
 *
 * Returns, per edit, whether its row was there. A screen corrects one row at a
 * time, so this is the tool's alone, and every write in it is `updateRow`.
 */
function updateInOrder(
  db: Database,
  declaration: FormatDeclaration,
  edits: readonly { readonly id: string; readonly cells: Readonly<Record<string, StoredValue>> }[],
): readonly boolean[] {
  const done = new Map<number, boolean>()
  let waiting = edits.map((_, at) => at)
  for (;;) {
    const failed: number[] = []
    let last: unknown
    for (const at of waiting) {
      const edit = edits[at]
      if (edit === undefined) continue
      try {
        done.set(at, updateRow(db, declaration, edit.id, edit.cells))
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed')) throw error
        failed.push(at)
        last = error
      }
    }
    if (failed.length === 0) break
    if (failed.length === waiting.length) throw last
    waiting = failed
  }
  return edits.map((_, at) => done.get(at) ?? false)
}

/**
 * The one row an edit means: by `id`, or by `where` — column values that name
 * exactly one row (M27 U6). **`where` is how a session addresses a row it read
 * in an earlier call**: a document stored as text gives every row a new id on
 * every write (D-247), so `M27 U6` is a name that survives somebody else's
 * write between the two calls and an id is not.
 */
function rowAddressed(
  db: Database,
  declaration: FormatDeclaration,
  entry: Record<string, unknown>,
): Result<StoredRow, string> {
  const id = entry['id']
  const where = entry['where']
  if (id !== undefined && where !== undefined) {
    return err('Name the row by `id` or by `where`, not both.')
  }
  if (where !== undefined) {
    const cells = namedCells(db, declaration, where, 'where')
    if (!cells.ok) return cells
    if (cells.value.size === 0) return err('`where` names no columns.')
    const said = [...cells.value.keys()].map((name) => `${name} ${offeredText(where, name)}`).join(' and ')
    const rows = listRows(db, declaration, { match: cells.value, limit: 2 })
    const [row] = rows
    if (row === undefined) return err(`${declaration.name} has no row where ${said}.`)
    if (rows.length > 1) {
      return err(`More than one ${declaration.name} row has ${said}, so \`where\` must say more, or name a unique column.`)
    }
    return ok(row)
  }
  if (typeof id !== 'string' || id.trim() === '') {
    return err('No id and no `where`. `format_rows` prints the id of every row; `where` names one by a unique column.')
  }
  const row = readRow(db, declaration, id)
  return row === undefined ? err(`${declaration.name} has no row with id ${id}.`) : ok(row)
}

/** A value as the caller offered it, for a sentence. */
function offeredText(offered: unknown, name: string): string {
  const value = (offered as Record<string, unknown>)[name]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'empty'
}

/**
 * Column values, coerced the way `match` coerces them and with a link read by
 * the name of the row it points at — what `where` and `expect` both take.
 */
function namedCells(
  db: Database,
  declaration: FormatDeclaration,
  raw: unknown,
  field: string,
): Result<ReadonlyMap<string, StoredValue>, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err(`\`${field}\` must be an object of column name to value.`)
  }
  const cells = matchCells(db, declaration, raw as Record<string, unknown>, listFormats(db))
  if (!cells.ok) return err(filterRefusalText(field, declaration, cells.error))
  // One row is named by one value a column holds; several, or `not`, is a filter's (M37 U3).
  const one = new Map<string, StoredValue>()
  for (const [name, value] of cells.value) {
    if (isHeldTo(value)) return err(`\`${field}\` names one value per column, and ${name} is given several or a \`not\`.`)
    one.set(name, value)
  }
  return ok(one)
}

/**
 * What an edit's `expect` says the row holds and it does not, as the refusal —
 * or nothing when every expectation holds or there are none. Compared as
 * `match` compares: text and enums without regard to case, a list by whether
 * it holds the row named, and empty as empty.
 */
function unmetExpectations(
  db: Database,
  declaration: FormatDeclaration,
  before: StoredRow,
  raw: unknown,
): string | undefined {
  if (raw === undefined) return undefined
  const expected = namedCells(db, declaration, raw, 'expect')
  if (!expected.ok) return expected.error
  const missed = [...expected.value].filter(([name, value]) => !holds(before.cells[name], value))
  if (missed.length === 0) return undefined
  return (
    `${rowLabel(declaration, before)} is not as this edit expected: ` +
    missed
      .map(([name]) => {
        const column = declaration.columns.find((one) => one.name === name)
        const now = column === undefined ? '' : cellText(column, before)
        return `${name} is ${now === '' ? 'empty' : now}, not ${offeredText(raw, name)}`
      })
      .join('; ') +
    '. It changed since it was read; read it again before deciding.'
  )
}

function holds(cell: StoredValue | undefined, expected: StoredValue): boolean {
  if (expected === null) {
    return cell === null || cell === undefined || (Array.isArray(cell) && cell.length === 0)
  }
  if (Array.isArray(cell)) return typeof expected === 'string' && cell.includes(expected)
  if (typeof cell === 'string' && typeof expected === 'string') {
    return cell.toLowerCase() === expected.toLowerCase()
  }
  return cell === expected
}

function rowLabel(declaration: FormatDeclaration, row: StoredRow): string {
  const naming = declaration.columns.find((one) => one.type === 'text')
  const name = naming === undefined ? undefined : row.cells[naming.name]
  return typeof name === 'string' && name !== ''
    ? `${declaration.name} ${name}`
    : `${declaration.name} row ${row.id}`
}

/** Whether this edit names this declared column — either of a money pair does. */
function touches(column: ColumnDeclaration, cells: Readonly<Record<string, StoredValue>>): boolean {
  if (column.type !== 'money') return Object.hasOwn(cells, column.name)
  const names = moneyColumnNames(column)
  return Object.hasOwn(cells, names.minor) || Object.hasOwn(cells, names.currency)
}

export const updateFormatRowsTool: PluginTool = {
  definition: {
    name: 'update_format_rows',
    title: 'Correct rows of a declared format',
    description:
      'Change columns of rows already stored — **a list of edits in one call**. Each names its ' +
      'row by `id` or by `where` (`{ref: "INV-0042"}`, which survives another writer; a text ' +
      'document renews ids on every write), and the `values` to change. ' +
      '`expect` (`{state: "planned"}`) refuses the batch unless the row still holds that, so two ' +
      'sessions cannot both take one row. Every column not named is left ' +
      'exactly as it was, which is the difference between this and the app: `#/formats/<name>` ' +
      'shows a person every column and writes every column, and this corrects three of thirty ' +
      'across a batch. A required column cannot be emptied. A `link` value may be the name of ' +
      'the row it points at, or a unique column of it (`course: {notion_id: "a1b2"}`), as in `record_format_rows`. Returns the before-and-after and ' +
      'writes nothing until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name.'),
        edits: {
          type: 'array',
          description: `One entry per row. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              id: stringProp('The row’s id, as `format_rows` printed it. Or `where`.'),
              where: { type: 'object', description: 'Instead of `id`: values naming exactly one row.', additionalProperties: true },
              expect: { type: 'object', description: 'Values the row must still hold.', additionalProperties: true },
              values: {
                type: 'object',
                description: 'Column name to its new value. Columns left out do not change.',
                additionalProperties: true,
              },
            },
            required: ['values'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path', 'format', 'edits'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const name = requireString(args, 'format')
    const edits = batchOf(args, 'edits', 'edit')
    return mutatingCall(path, args['commit'] === true, updateMutation(name, edits))
  },
}

// --- delete_format_rows -----------------------------------------------------

interface RemovePlan {
  readonly declaration: FormatDeclaration | undefined
  readonly blocked: string | undefined
  readonly rows: readonly StoredRow[]
  readonly refusals: readonly Refused[]
  /**
   * The units the document held when this was planned (U4a, D-223).
   *
   * Carried on the plan rather than read again in `describe`, which has no
   * document: a preview that judged a row against a different unit table from
   * the one the count came off would be a verifier proving something other than
   * what it checked, which is the law this file is built on (D-138).
   */
  readonly units: UnitTable
}

function removeMutation(name: string, ids: readonly string[]): Mutation<RemovePlan> {
  return {
    copyBefore: (plan) => ({ what: `removing ${plan.rows.length} rows of ${name}`, rows: plan.rows.length }),
    // Whole or not at all, so a refused batch takes no copy of the document
    // to explain that nothing happened.
    refuses: (plan) => plan.blocked !== undefined || plan.refusals.length > 0,

    plan: (document) => {
      const resolved = resolveWritable(document, name)
      if ('refusal' in resolved) {
        return {
          declaration: undefined,
          blocked: resolved.refusal,
          rows: [],
          refusals: [],
          units: SEEDED_UNITS,
        }
      }
      const declaration = resolved.declaration

      const rows: StoredRow[] = []
      const refusals: Refused[] = []
      ids.forEach((id, index) => {
        const row = readRow(document.db, declaration, id)
        if (row === undefined) refusals.push({ index, reason: `No row with id ${id}.` })
        else rows.push(row)
      })

      // Refused, not cascaded, while anything links to them (M24 U11, D-263) —
      // the same check `deleteRows` makes, asked first so the dry run says it.
      const linking = rowsLinkingTo(
        document.db,
        declaration,
        rows.map((row) => row.id),
        listFormats(document.db),
      )
      if (linking.length > 0) {
        return {
          declaration,
          blocked: paragraphs(
            `**Nothing would be removed from ${declaration.title}**: other rows still link to ` +
              `${rows.length === 1 ? 'it' : 'them'}, and would be left naming nothing.`,
            linkingSentences(document.db, declaration, linking)
              .map((sentence) => `- ${sentence}`)
              .join('\n'),
            'Re-link or clear those rows first with `update_format_rows`, or remove them in the ' +
              'same call if they belong to this format. Nothing is removed on anybody’s behalf.',
          ),
          rows,
          refusals,
          units: SEEDED_UNITS,
        }
      }
      return { declaration, blocked: undefined, rows, refusals, units: listUnits(document.db) }
    },

    describe: (plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      if (plan.refusals.length > 0) return refusalText(plan.refusals, 'id')
      const declaration = plan.declaration
      if (declaration === undefined) return 'No format resolved.'

      return paragraphs(
        `${plural(plan.rows.length, 'row')} of ${declaration.title} would be removed. ` +
          '**There is no undo for this beyond the copy taken before the write.**',
        plan.rows.map((row) => rowBlock(declaration, row, plan.units)).join('\n\n'),
      )
    },

    apply: (document, plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      if (plan.refusals.length > 0) return refusalText(plan.refusals, 'id')
      const declaration = plan.declaration
      if (declaration === undefined) return 'No format resolved.'

      const gone = deleteRows(
        document.db,
        declaration,
        plan.rows.map((row) => row.id),
        listFormats(document.db),
      )
      return paragraphs(
        `${plural(gone.length, 'row')} removed from ${declaration.title}, which now holds ` +
          `${plural(rowCountOf(document.db, declaration), 'row')}.`,
        'The copy taken before this write is the way back.',
      )
    },
  }
}

export const deleteFormatRowsTool: PluginTool = {
  definition: {
    name: 'delete_format_rows',
    title: 'Remove rows of a declared format',
    description:
      'Remove rows from a declared format by id — **a list of them in one call**. ' +
      '**Refused while any other row still links ' +
      'to one of them** — the dry run names those rows; re-link or clear them first. The app ' +
      'removes one row at a time from ' +
      '`#/formats/<name>`; this is how thirty go at once, after printing every one of them in ' +
      'full. Writes nothing until `commit: true`; a copy of the document is taken first, and it ' +
      'is the only way back.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name.'),
        ids: {
          type: 'array',
          description: `Row ids, as \`format_rows\` printed them. Up to ${String(BATCH_MAX)}.`,
          items: { type: 'string' },
        },
        commit: booleanProp('Remove them. Omit or false for the dry run.'),
      },
      required: ['path', 'format', 'ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const name = requireString(args, 'format')

    const raw = args['ids']
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ToolInputError('`ids` must be a non-empty array of row ids.')
    }
    if (raw.length > BATCH_MAX) {
      throw new ToolInputError(
        `That is ${String(raw.length)} ids; the ceiling is ${String(BATCH_MAX)} in one call.`,
      )
    }
    const ids = raw.map((id, index) => {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new ToolInputError(`\`ids[${String(index)}]\` must be a non-empty string.`)
      }
      return id
    })

    return mutatingCall(path, args['commit'] === true, removeMutation(name, ids))
  },
}

// --- apply_rules ------------------------------------------------------------

interface RulePlan {
  readonly blocked: string | undefined
  readonly plan: RuleSetPlan | undefined
}

/** The dry run and the result say one thing, so they are one sentence (D-273). */
function rulePlanText(plan: RuleSetPlan, done: boolean): string {
  const { set, target } = plan
  const lead =
    `**${set.name}** — \`${ruleSetText(set)}\`. Over ${plural(plan.rows, 'row')} of ${target.name}: ` +
    `${plural(plan.changes.length, 'row')} ${done ? 'set' : 'would be set'}, ` +
    `${plural(plan.unmatched, 'row')} no rule matches, and ${plural(plan.kept, 'row')} a person ` +
    `or something other than these rules set, which ${plan.kept === 1 ? 'is' : 'are'} left as ${plan.kept === 1 ? 'it is' : 'they are'}.`
  return paragraphs(
    lead,
    plan.changes.length === 0
      ? ''
      : table(
          ['Row', set.sets, 'Becomes', 'Rule'],
          plan.changes.slice(0, ROWS_DEFAULT).map((each) => [each.id, each.from ?? '-', each.to, each.rule]),
        ),
    plan.changes.length > ROWS_DEFAULT ? `…and ${plural(plan.changes.length - ROWS_DEFAULT, 'more row')}.` : '',
    plan.ties.length === 0
      ? ''
      : `**${plural(plan.ties.length, 'row')} left as ${plan.ties.length === 1 ? 'it is' : 'they are'}**: ` +
        'rules tied at the top of the order name different rows, and the engine does not pick one. ' +
        plan.ties
          .slice(0, 5)
          .map((each) => `${each.id} (rules ${each.rules.join(', ')})`)
          .join('; ') +
        '. Give one of them a place ahead of the other.',
  )
}

function applyRulesMutation(name: string, setName: string | undefined): Mutation<RulePlan> {
  return {
    refuses: (plan) => plan.blocked !== undefined,
    plan: (document) => {
      const resolved = resolve(document, name)
      if ('refusal' in resolved) return { blocked: resolved.refusal, plan: undefined }
      const found = findRuleSet(listFormats(document.db), resolved.declaration, setName)
      if (typeof found === 'string') return { blocked: found, plan: undefined }
      // What a rule set writes is the target's rows, so a pack's target is
      // the pack's to sort (D-269) — on its write, where the rules run by
      // themselves, and never from here.
      const locked = rowWriteRefusal(found.target)
      if (locked !== undefined) return { blocked: locked, plan: undefined }
      return {
        blocked: undefined,
        plan: planRuleSet(document.db, resolved.declaration, found.set, found.target),
      }
    },
    describe: (plan) => plan.blocked ?? (plan.plan === undefined ? 'Nothing planned.' : rulePlanText(plan.plan, false)),
    apply: (document, plan) => {
      if (plan.blocked !== undefined || plan.plan === undefined) return plan.blocked ?? 'Nothing planned.'
      const resolved = resolve(document, name)
      if ('refusal' in resolved) return resolved.refusal
      const done = applyRuleSet(document.db, resolved.declaration, plan.plan.set, plan.plan.target)
      return rulePlanText(done, true)
    },
  }
}

// A found link, on the rows already there (M29 F11, D-353).

interface FoundLinkPlan {
  readonly blocked: string | undefined
  readonly plan: FindPlan | undefined
}

/** One row the rule cannot place, and why — the screen's reasons, in the tool's words. */
function unplacedText(plan: FindPlan, each: Unplaced): string {
  const who = each.name === undefined ? each.id : `"${each.name}" (${each.id})`
  if (each.kind === 'NO_DATE') return `- ${who}: no ${plan.foundBy.from}, so nothing to find it by.`
  const at = matchedOn(plan.foundBy, each.date)
  const where = plan.foundBy.grain === 'DAY' ? `${plan.foundBy.in} ${at}` : `${plan.foundBy.in} in ${at}`
  return each.kind === 'NONE'
    ? `- ${who}, ${plan.foundBy.from} ${each.date}: no ${plan.target.title} has ${where}.`
    : `- ${who}, ${plan.foundBy.from} ${each.date}: ${each.names.length} ${plan.target.title} rows have ${where} — ` +
        `${each.names.map((name) => `"${name}"`).join(', ')} — and the engine does not pick one.`
}

/** The dry run and the result say one thing (D-273's shape). */
function foundPlanText(format: string, plan: FindPlan, done: boolean): string {
  const link = `**${format}.${plan.column}**`
  const kept = plan.rows - plan.empty
  const lead =
    `${link} — found by \`${foundByText(plan.foundBy)}\`. Of ${plural(plan.rows, 'row')}, ` +
    `${plural(plan.empty, 'row')} ${plan.empty === 1 ? 'has' : 'have'} it empty: ` +
    `${plural(plan.placements.length, 'row')} ${done ? 'got' : 'would get'} a ${plan.target.name}` +
    (plan.unplaced.length === 0 ? '' : `, and ${plural(plan.unplaced.length, 'row')} cannot be placed and stay empty`) +
    `. ${plural(kept, 'row')} already name${kept === 1 ? 's' : ''} one and ${kept === 1 ? 'is' : 'are'} not touched, ` +
    'whoever set it.'
  return paragraphs(
    lead,
    plan.placements.length === 0
      ? ''
      : table(
          ['Row', plan.foundBy.from, plan.column],
          plan.placements
            .slice(0, ROWS_DEFAULT)
            .map((each) => [each.name ?? each.id, each.date, each.toName ?? each.to]),
        ),
    plan.placements.length > ROWS_DEFAULT ? `…and ${plural(plan.placements.length - ROWS_DEFAULT, 'more row')}.` : '',
    plan.unplaced.length === 0
      ? ''
      : [
          '**Left empty**:',
          ...plan.unplaced.slice(0, ROWS_DEFAULT).map((each) => unplacedText(plan, each)),
          ...(plan.unplaced.length > ROWS_DEFAULT
            ? [`…and ${plural(plan.unplaced.length - ROWS_DEFAULT, 'more row')}.`]
            : []),
        ].join('\n'),
  )
}

function applyFoundMutation(name: string, link: string): Mutation<FoundLinkPlan> {
  return {
    refuses: (plan) => plan.blocked !== undefined || plan.plan?.placements.length === 0,
    plan: (document) => {
      // A link is a write of this format's rows, so a pack's is the pack's (D-269).
      const resolved = resolveWritable(document, name)
      if ('refusal' in resolved) return { blocked: resolved.refusal, plan: undefined }
      const plan = planFoundLink(document.db, resolved.declaration, link)
      return typeof plan === 'string' ? { blocked: plan, plan: undefined } : { blocked: undefined, plan }
    },
    describe: (plan) =>
      plan.blocked ??
      (plan.plan === undefined
        ? 'Nothing planned.'
        : plan.plan.placements.length === 0
          ? paragraphs(foundPlanText(name, plan.plan, false), 'Nothing to write.')
          : foundPlanText(name, plan.plan, false)),
    apply: (document, plan) => {
      if (plan.blocked !== undefined || plan.plan === undefined) return plan.blocked ?? 'Nothing planned.'
      const resolved = resolveWritable(document, name)
      if ('refusal' in resolved) return resolved.refusal
      const done = applyFoundLink(document.db, resolved.declaration, link)
      return typeof done === 'string' ? done : foundPlanText(name, done, true)
    },
  }
}

/**
 * **Apply a rule set** (M25 E4, D-273) to every row of the format it sets — or,
 * with `link`, **a link's `found by`** to the rows already there (M29 F11,
 * D-353). The screen's halves are the rule format's own page, whose *Apply*
 * shows the same count before it writes, and the connection window's *Apply*
 * beside *Match by date*.
 */
export const applyRulesTool: PluginTool = {
  definition: {
    name: 'apply_rules',
    title: 'Apply a rule set',
    description:
      'Run a rule set over every row it sets — a write applies it by itself. A person’s ' +
      'value is never touched; a tie is named. With `link`, fill that link’s empty cells by its ' +
      '`found_by` instead; a set link is never moved, and a row with no match or two is named. ' +
      'Dry run until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The format whose rows are the rules — or, with `link`, the one the link is on.'),
        rule_set: stringProp('By name; optional when there is one.'),
        link: stringProp('A link column found by a date (`found_by`): fill the rows where it is empty.'),
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path', 'format'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const name = requireString(args, 'format')
    const link = optionalString(args, 'link')
    const setName = optionalString(args, 'rule_set')
    const commit = args['commit'] === true
    if (link !== undefined) {
      if (setName !== undefined) {
        return 'Name a `rule_set` or a `link`, not both — a rule set sets another format’s rows, and a link is filled on its own.'
      }
      return mutatingCall(path, commit, applyFoundMutation(name, link))
    }
    return mutatingCall(path, commit, applyRulesMutation(name, setName))
  },
}

// --- declare_format ---------------------------------------------------------

/**
 * The keys a column object may carry.
 *
 * **An unknown one refuses the declaration rather than being dropped**, which
 * is D-217's rule about row keys applied one level up and for the same reason:
 * a caller that sent `enum: [...]` instead of `values` believes it declared an
 * enum, and a text column that silently arrived instead would be wrong in every
 * row anybody ever puts in it.
 */
const COLUMN_KEYS = [
  'name',
  'type',
  'target',
  'unit',
  'per',
  'required',
  'unique',
  'scale',
  'values',
  'minimum',
  'maximum',
  'note',
  'found_by',
]

const AGGREGATE_KEYS = [
  'name',
  'of',
  'over_format',
  'over_column',
  'every',
  'works_out',
  'unit',
  'where',
  'by',
  'note',
]

interface DeclarePlan {
  readonly declaration: FormatDeclaration | undefined
  readonly blocked: string | undefined
  readonly reconcile: ReconcilePlan | undefined
}

/**
 * The two slips forgiven here, and they are D-217's two.
 *
 * A number sent as a string and an enum member in the wrong case are
 * unambiguous — nothing else could have been meant — and the line is that a
 * coercion may never change *which* value was meant. Everything else is
 * refused by naming what was expected, because the reader of that sentence is a
 * model about to try again.
 */
function boundValue(value: unknown, key: string, column: string): Result<number | undefined, string> {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  const number = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return { ok: false, error: `The column ${column} has a ${key} of ${String(value)}, which is not a number.` }
  }
  return { ok: true, value: number }
}

function columnTypeOf(value: unknown, column: string): Result<ColumnType, string> {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const type = COLUMN_TYPES.find((each) => each === text)
  if (type === undefined) {
    return {
      ok: false,
      error:
        `The column ${column} has type ${JSON.stringify(value)}. It has to be one of ` +
        `${COLUMN_TYPES.join(', ')}.`,
    }
  }
  return { ok: true, value: type }
}

/** One offered column object as a declared column, or the sentence saying why not. */
function columnOf(offered: unknown, index: number): Result<ColumnDeclaration, string> {
  const where = `Column ${String(index + 1)}`
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { ok: false, error: `${where} is not an object of column properties.` }
  }
  const entry = offered as Record<string, unknown>

  const rawName = entry['name']
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (name === '') return { ok: false, error: `${where} has no name.` }

  const unknown = Object.keys(entry).filter((key) => !COLUMN_KEYS.includes(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `The column ${name} was given ${unknown.join(', ')}, which ${verb(unknown.length, 'is', 'are')} ` +
        `not part of a column. A column has ${COLUMN_KEYS.join(', ')}.`,
    }
  }

  const type = columnTypeOf(entry['type'], name)
  if (!type.ok) return type

  const minimum = boundValue(entry['minimum'], 'minimum', name)
  if (!minimum.ok) return minimum
  const maximum = boundValue(entry['maximum'], 'maximum', name)
  if (!maximum.ok) return maximum

  const rawValues = entry['values']
  if (rawValues !== undefined && !Array.isArray(rawValues)) {
    return { ok: false, error: `The column ${name} has \`values\` that are not a list.` }
  }
  const values = (rawValues ?? []).map((each) => (typeof each === 'string' ? each.trim() : String(each)))

  const rawUnit = entry['unit']
  const unit = typeof rawUnit === 'string' && rawUnit.trim() !== '' ? rawUnit.trim() : undefined

  // The other half of a ratio (U4c, D-225). Refused rather than dropped when it
  // is not text, for the reason every other key here is: a caller that sent one
  // believes it declared a bridge, and a column that quietly arrived without it
  // would be a `via` that resolves to nothing on every row.
  const rawPer = entry['per']
  const per = typeof rawPer === 'string' && rawPer.trim() !== '' ? rawPer.trim() : undefined

  // The places a `decimal` keeps (M24 U6, D-257). A number sent as a string is
  // D-217's forgiven slip; anything else is refused rather than dropped, since
  // a decimal without its scale is a column that cannot be made.
  const rawScale = entry['scale']
  const scale =
    rawScale === undefined || rawScale === null
      ? undefined
      : typeof rawScale === 'number'
        ? rawScale
        : typeof rawScale === 'string' && /^\d+$/.test(rawScale.trim())
          ? Number(rawScale.trim())
          : Number.NaN
  if (scale !== undefined && Number.isNaN(scale)) {
    return {
      ok: false,
      error: `The column ${name} has a \`scale\` of ${JSON.stringify(rawScale)}; a scale is how many places a decimal keeps, 1 to 9.`,
    }
  }

  const rawTarget = entry['target']
  const target =
    typeof rawTarget === 'string' && rawTarget.trim() !== '' ? rawTarget.trim() : undefined
  if (isLinkType(type.value) && target === undefined) {
    return {
      ok: false,
      error: `The column ${name} is a link and was given no \`target\`. A link holds the id of a row of another format, and the target is which format \u2014 \`ingredient\`.`,
    }
  }

  // How a link is found (M29 F8, D-350): `date in period`. Refused rather than
  // dropped when it does not read, for every other key's reason.
  const rawFound = entry['found_by']
  let foundBy: FoundBy | undefined
  if (rawFound !== undefined && rawFound !== null && rawFound !== '') {
    if (typeof rawFound !== 'string') {
      return { ok: false, error: `The column ${name} has a \`found_by\` that is not a sentence — \`date in period\`.` }
    }
    const parsed = parseFoundBy(rawFound)
    if (!parsed.ok) return { ok: false, error: `The column ${name}: ${parsed.error}` }
    foundBy = parsed.value
  }

  return {
    ok: true,
    value: column(name, type.value, {
      unit,
      per,
      target,
      foundBy,
      required: entry['required'] === true,
      unique: entry['unique'] === true,
      scale,
      values,
      minimum: minimum.value,
      maximum: maximum.value,
      note: typeof entry['note'] === 'string' ? entry['note'] : '',
    }),
  }
}

/** The keys an offered claim may carry. Anything else refuses the call. */
/**
 * One offered aggregate, or the sentence saying why it is not one (U4b, D-224).
 *
 * The same shape as `columnOf` and `identityOf`, and the same rule: an unknown
 * key refuses rather than being dropped, because a caller that sent `sum` when
 * the key is `of` believes it said which fold it wanted, and a default that
 * quietly stood in for it would be a figure nobody asked for.
 */
function aggregateOf(offered: unknown, index: number): Result<AggregateDeclaration, string> {
  const where = `Aggregate ${String(index + 1)}`
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { ok: false, error: `${where} is not an object of aggregate properties.` }
  }
  const entry = offered as Record<string, unknown>

  const rawName = entry['name']
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (name === '') return { ok: false, error: `${where} has no name.` }

  const unknown = Object.keys(entry).filter((key) => !AGGREGATE_KEYS.includes(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `The aggregate ${name} was given ${unknown.join(', ')}, which ${verb(unknown.length, 'is', 'are')} ` +
        `not part of an aggregate. One has ${AGGREGATE_KEYS.join(', ')}.`,
    }
  }

  const rawKind = entry['of']
  const kind = AGGREGATE_KINDS.find(
    (each) => each.toLowerCase() === String(rawKind ?? '').trim().toLowerCase(),
  )
  if (kind === undefined) {
    return {
      ok: false,
      error: `The aggregate ${name} is a ${JSON.stringify(rawKind)}. \`of\` is one of ${AGGREGATE_KINDS.map((each) => each.toLowerCase()).join(', ')}.`,
    }
  }

  const overFormat = typeof entry['over_format'] === 'string' ? entry['over_format'].trim() : ''
  const overColumn = typeof entry['over_column'] === 'string' ? entry['over_column'].trim() : ''
  // **Every row, said in a word** (M34 U4, D-397): `every: true` instead of
  // the column, never a column left out \u2014 a forgotten column is still refused.
  const every = entry['every'] === true
  if (every && overColumn !== '') {
    return {
      ok: false,
      error: `The aggregate ${name} says both \`every\` and \`over_column\`. It folds every row of ${overFormat || 'its format'}, or the rows whose ${overColumn} names this one \u2014 one of the two.`,
    }
  }
  if (overFormat === '' || (overColumn === '' && !every)) {
    return {
      ok: false,
      error: `The aggregate ${name} needs \`over_format\` and \`over_column\` \u2014 the format whose rows it folds, and that format's link column pointing back at this one \u2014 or \`over_format\` and \`every: true\` for every row of it.`,
    }
  }

  const rawExpression = entry['works_out']
  const expression = typeof rawExpression === 'string' ? rawExpression.trim() : ''
  if (kind !== 'COUNT' && expression === '') {
    return {
      ok: false,
      error: `The aggregate ${name} has no \`works_out\`. It is what to work out on each row of ${overFormat} \u2014 \`amount_g / 100 * ingredient.kcal\`. A fold with nothing to fold is a count.`,
    }
  }

  const rawUnit = entry['unit']
  const unit = typeof rawUnit === 'string' && rawUnit.trim() !== '' ? rawUnit.trim() : undefined

  // One sentence, the artefact's spelling (U8, D-260). Whether the column and
  // the member are real is the declaration's check, against the source.
  let filter: AggregateFilter | undefined
  const rawWhere = entry['where']
  if (rawWhere !== undefined && rawWhere !== null && rawWhere !== '') {
    if (typeof rawWhere !== 'string') {
      return {
        ok: false,
        error: `The aggregate ${name}'s \`where\` is one sentence \u2014 \`kind is OUTFLOW\`, \`kind is not TRANSFER\`, \`kind is one of TAX, HEALTH\`, \`employer is not empty\`, or through a link, \`deduction_type.reduces_net is true\`.`,
      }
    }
    const parsed = parseFilter(rawWhere)
    if ('problem' in parsed) return { ok: false, error: `The aggregate ${name}: ${parsed.problem}` }
    filter = parsed
  }

  // What a latest or earliest picks by (M25 E3, D-272): one column name.
  // Whether the kind takes one, and whether the column can order, is the
  // declaration's check against the source.
  const rawBy = entry['by']
  let by: string | undefined
  if (rawBy !== undefined && rawBy !== null && rawBy !== '') {
    if (typeof rawBy !== 'string') {
      return {
        ok: false,
        error: `The aggregate ${name}'s \`by\` is one column of ${overFormat} — \`as_of\`.`,
      }
    }
    by = rawBy.trim()
  }

  return {
    ok: true,
    value: aggregate(
      name,
      kind as AggregateKind,
      every ? { format: overFormat } : { format: overFormat, column: overColumn },
      {
        expression,
        unit,
        note: typeof entry['note'] === 'string' ? entry['note'] : '',
        where: filter,
        by,
      },
    ),
  }
}

/**
 * Whether every link in these cells names a row that is actually there (U4b,
 * D-224).
 *
 * **The refusal that holds**, because the `REFERENCES` clause in the table does
 * not: this app never sets `PRAGMA foreign_keys = ON` (D-067), so SQLite will
 * take an id pointing at nothing without a word. A row written that way is a
 * join that silently returns nothing for the rest of its life and an aggregate
 * that folds to `unchecked` with no obvious cause — which is why it is caught
 * here, at the moment it is written, with the column and the id in the sentence.
 */
/**
 * The links in a row that name a row that is not there.
 *
 * **One implementation, in the repository** (M20 U1): U1's row form writes rows
 * too, and a second copy of this check is how a screen and a tool come to hold
 * different opinions about the same document. This is the document-shaped
 * wrapper around it and nothing more.
 */
function danglingLinks(
  document: OpenDocument,
  declaration: FormatDeclaration,
  cells: Readonly<Record<string, StoredValue>>,
  formats: FormatIndex,
  pending?: ReadonlySet<string>,
): readonly string[] {
  return danglingLinksIn(document.db, declaration, cells, formats, pending)
}

const IDENTITY_KEYS = ['name', 'expression', 'tolerance', 'note']

/**
 * One offered row constraint (M24 U7, D-259): a `rule`, the sentence the
 * artefact writes, and a `note`. The three shapes are the grammar; whether the
 * columns and members exist is `declarationProblems`', in one pass with the
 * rest. A sentence is read into fields and never reaches SQL as text.
 */
function constraintOf(offered: unknown, index: number): Result<RowConstraint, string> {
  const where = `Constraint ${String(index + 1)}`
  if (typeof offered === 'string') return parseConstraint(offered)
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { ok: false, error: `${where} is not a rule or an object with a \`rule\`.` }
  }
  const entry = offered as Record<string, unknown>
  const unknown = Object.keys(entry).filter((key) => key !== 'rule' && key !== 'note')
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `${where} was given ${unknown.join(', ')}; a constraint has a \`rule\` and a \`note\`.`,
    }
  }
  const rule = entry['rule']
  if (typeof rule !== 'string' || rule.trim() === '') {
    return { ok: false, error: `${where} has no \`rule\`.` }
  }
  return parseConstraint(rule, typeof entry['note'] === 'string' ? entry['note'] : '')
}

/** One offered rule set (M25 E4, D-273): a `name`, the `sets` sentence and a `note`. */
function ruleSetOf(offered: unknown, index: number): Result<RuleSetDeclaration, string> {
  const where = `Rule set ${String(index + 1)}`
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { ok: false, error: `${where} is not an object with a \`name\` and \`sets\`.` }
  }
  const entry = offered as Record<string, unknown>
  const unknown = Object.keys(entry).filter((key) => !['name', 'sets', 'note'].includes(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `${where} was given ${unknown.join(', ')}; a rule set has a \`name\`, \`sets\` and a \`note\`.`,
    }
  }
  const name = typeof entry['name'] === 'string' ? entry['name'].trim() : ''
  const sets = entry['sets']
  if (typeof sets !== 'string' || sets.trim() === '') {
    return { ok: false, error: `${where}${name === '' ? '' : ` (${name})`} has no \`sets\`.` }
  }
  return parseRuleSet(name, sets, typeof entry['note'] === 'string' ? entry['note'] : '')
}

/** The rule sets a format declares, each as the sentence `declare_format` takes (D-273). */
function ruleSetsText(declaration: FormatDeclaration): string {
  const sets = declaration.ruleSets ?? []
  if (sets.length === 0) return ''
  return paragraphs(
    `${plural(sets.length, 'rule set')} \u2014 its rows set a link of another format, applied on a write of it and by \`apply_rules\``,
    table(
      ['Rule set', 'Sets', 'Note'],
      sets.map((each) => [`\`${each.name}\``, `\`${ruleSetText(each)}\``, each.note === '' ? '-' : each.note]),
    ),
  )
}

/**
 * One offered rollup (M25 E2, D-271): a `name`, `works_out` — the sentence the
 * artefact writes — and a `note`. Whether its columns exist is
 * `declarationProblems`', in one pass with the rest.
 */
function rollupOf(offered: unknown, index: number): Result<RollupDeclaration, string> {
  const where = `Rollup ${String(index + 1)}`
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { ok: false, error: `${where} is not an object with a \`name\` and \`works_out\`.` }
  }
  const entry = offered as Record<string, unknown>
  const unknown = Object.keys(entry).filter((key) => !['name', 'works_out', 'note'].includes(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `${where} was given ${unknown.join(', ')}; a rollup has a \`name\`, \`works_out\` and a \`note\`.`,
    }
  }
  const name = typeof entry['name'] === 'string' ? entry['name'].trim() : ''
  const worksOut = entry['works_out']
  if (typeof worksOut !== 'string' || worksOut.trim() === '') {
    return { ok: false, error: `${where}${name === '' ? '' : ` (${name})`} has no \`works_out\`.` }
  }
  return parseRollup(name, worksOut, typeof entry['note'] === 'string' ? entry['note'] : '')
}

/**
 * One offered identity, or the sentence saying why it is not one.
 *
 * `tolerance` is read the way the artefact writes it — `exactly`, `± 2`, `2%` —
 * and a bare number is taken as an absolute. **The equation itself is not
 * validated here**: `declarationProblems` does that against the columns, in one
 * pass with every other problem, so a caller gets *"the identity atwater names
 * fibre_g, and this format has no such column"* rather than a parser's opinion
 * in isolation.
 */
function identityOf(offered: unknown, index: number): Result<IdentityDeclaration, string> {
  const where = `Claim ${String(index + 1)}`
  if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
    return { ok: false, error: `${where} is not an object of claim properties.` }
  }
  const entry = offered as Record<string, unknown>

  const rawName = entry['name']
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (name === '') return { ok: false, error: `${where} has no name.` }

  const unknown = Object.keys(entry).filter((key) => !IDENTITY_KEYS.includes(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `The claim ${name} was given ${unknown.join(', ')}, which ${verb(unknown.length, 'is', 'are')} ` +
        `not part of a claim. One has ${IDENTITY_KEYS.join(', ')}.`,
    }
  }

  const expression = entry['expression']
  if (typeof expression !== 'string' || expression.trim() === '') {
    return {
      ok: false,
      error: `The claim ${name} has no \`expression\`. It is an equation over this format's own numeric columns — \`4*protein_g + 4*carbs_g + 9*fat_g + 2*fiber_g = kcal\`.`,
    }
  }

  const rawTolerance = entry['tolerance']
  const tolerance =
    rawTolerance === undefined || rawTolerance === null
      ? { kind: 'ABSOLUTE' as const, amount: 0 }
      : readTolerance(typeof rawTolerance === 'number' ? String(rawTolerance) : String(rawTolerance))
  if (tolerance === undefined) {
    return {
      ok: false,
      error: `The claim ${name} has a tolerance of ${JSON.stringify(rawTolerance)}. It is \`exactly\`, a number like \`2\`, or a percentage like \`2%\`.`,
    }
  }

  return {
    ok: true,
    value: identity(name, expression.trim(), {
      tolerance,
      note: typeof entry['note'] === 'string' ? entry['note'] : '',
    }),
  }
}

/** One thing wrong, and the column it is about if it is about one. */
interface Wrong {
  readonly column: string | undefined
  readonly message: string
}

/**
 * Everything wrong with the declaration, each naming its column.
 *
 * **A list rather than the first one**, which is what `declarationProblems`
 * exists for (D-219): the reader here is a model that will rewrite the whole
 * call, and telling it one of four mistakes costs four round trips for no
 * reason. The editor draws the same sentences beside their fields.
 */
function wrongText(problems: readonly Wrong[]): string {
  return paragraphs(
    'This declaration cannot be accepted, so **nothing was written**. ' +
      `${plural(problems.length, 'thing')} to fix:`,
    problems
      .map(
        (problem) =>
          `- ${problem.column === undefined ? '' : `\`${problem.column}\` — `}${problem.message}`,
      )
      .join('\n'),
  )
}

function problemText(
  declaration: FormatDeclaration,
  problems: readonly DeclarationProblem[],
): string {
  return wrongText(
    problems.map((problem) => ({
      column:
        problem.columnIndex === undefined
          ? (declaration.identities[problem.identityIndex ?? -1]?.name ??
            declaration.derived?.[problem.derivedIndex ?? -1]?.name)
          : declaration.columns[problem.columnIndex]?.name,
      message: problem.message,
    })),
  )
}

/** What the declaration would create, before it creates it. */
function describeDeclaration(declaration: FormatDeclaration): string {
  return paragraphs(
    `**${declaration.title}** — \`${declaration.name}\`, a new format in this document, stored ` +
      `as \`${tableNameFor(declaration)}\` with ${plural(declaration.columns.length, 'column')}.`,
    table(
      ['Column', 'Type', 'Unit', 'Constraint', 'Values', 'Bounds', 'What it means'],
      declaration.columns.map(columnRow),
    ),
    identitiesText(declaration),
    constraintsText(declaration),
    rollupsText(declaration),
    ruleSetsText(declaration),
    derivedText(declaration, []),
    declaration.notes.trim() === ''
      ? 'It carries no notes. The prose around a format is kept word for word and is usually ' +
          'the half that stops the figures being read wrongly later — offer to write some.'
      : section('What the declaration will say about this format', declaration.notes.trim()),
    'Nothing in this document is changed by it: a declared table is prefixed `fmt_` and no ' +
      'built-in table carries that prefix.',
  )
}

/** A declaration from the arguments, or every way its shape is wrong, at once. */
function parseDeclare(
  args: DeclareArgs,
): { readonly declaration: FormatDeclaration } | { readonly blocked: string } {
  // Shape first, and **all of it** — a column object that is not a column
  // cannot become one, so these cannot be merged with the declaration's own
  // problems below. Reporting them one at a time was the version of this
  // that cost a round trip per mistake.
  const columns: ColumnDeclaration[] = []
  const malformed: Wrong[] = []
  args.columns.forEach((offered, index) => {
    const parsed = columnOf(offered, index)
    if (parsed.ok) columns.push(parsed.value)
    else malformed.push({ column: undefined, message: parsed.error })
  })

  const identities: IdentityDeclaration[] = []
  args.identities.forEach((offered, index) => {
    const parsed = identityOf(offered, index)
    if (parsed.ok) identities.push(parsed.value)
    else malformed.push({ column: undefined, message: parsed.error })
  })

  const aggregates: AggregateDeclaration[] = []
  args.aggregates.forEach((offered, index) => {
    const parsed = aggregateOf(offered, index)
    if (parsed.ok) aggregates.push(parsed.value)
    else malformed.push({ column: undefined, message: parsed.error })
  })

  const constraints: RowConstraint[] = []
  args.constraints.forEach((offered, index) => {
    const parsed = constraintOf(offered, index)
    if (parsed.ok) constraints.push(parsed.value)
    else malformed.push({ column: undefined, message: parsed.error })
  })
  const rollups: RollupDeclaration[] = []
  args.rollups.forEach((offered, index) => {
    const parsed = rollupOf(offered, index)
    if (parsed.ok) rollups.push(parsed.value)
    else malformed.push({ column: undefined, message: parsed.error })
  })
  const ruleSets: RuleSetDeclaration[] = []
  args.ruleSets.forEach((offered, index) => {
    const parsed = ruleSetOf(offered, index)
    if (parsed.ok) ruleSets.push(parsed.value)
    else malformed.push({ column: undefined, message: parsed.error })
  })
  const derived: DerivedDeclaration[] = []
  args.derived.forEach((offered, index) => {
    const parsed = derivedOfOffered(offered, index)
    if (parsed.ok) derived.push(parsed.value)
    else malformed.push({ column: undefined, message: parsed.error })
  })
  if (malformed.length > 0) return { blocked: wrongText(malformed) }

  const declaration: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: args.name.trim(),
    title: args.title.trim(),
    notes: args.notes ?? '',
    columns,
    identities,
    aggregates,
    ...(constraints.length === 0 ? {} : { constraints }),
    ...(rollups.length === 0 ? {} : { rollups }),
    ...(ruleSets.length === 0 ? {} : { ruleSets }),
    ...(derived.length === 0 ? {} : { derived }),
    nothingMustHold: args.nothingMustHold,
  }

  return { declaration }
}

/**
 * Whether this document may take the declaration: not a name it has, nothing it
 * cannot read, no problem `declarationProblems` finds — judged against what it
 * declares **and `others`**, the formats declared beside it in the same call
 * (M34 U2) — and one `CREATE TABLE`.
 */
function judgeDeclaration(
  document: OpenDocument,
  declaration: FormatDeclaration,
  others: readonly FormatDeclaration[],
): DeclarePlan {
  const nothing = (blocked: string): DeclarePlan => ({ declaration: undefined, blocked, reconcile: undefined })

  const declared = listFormats(document.db)
  if (declared.some((each) => each.name === declaration.name)) {
    return nothing(
      `This document already declares \`${declaration.name}\`, and this tool brings a format ` +
        'into existence rather than altering one. **To change it**, `extend_format` adds, renames, ' +
        'retypes and removes, judged against the rows the table already holds, and ' +
        '`connect_formats` links it to another format. `formats` prints what it declares now.',
    )
  }

  const unreadable = unreadableFormats(document.db).find(
    (each) => each.name === declaration.name,
  )
  if (unreadable !== undefined) {
    return nothing(
      `This document already declares \`${declaration.name}\`, but ${unreadable.reason} ` +
        'Declaring over it would replace something nobody here can read, so nothing was ' +
        'written. Update the app, then open the document — `#/formats` lists a declaration ' +
        'this build cannot read and leaves it exactly as it is.',
    )
  }

  const problems = declarationProblems(declaration, [...declared, ...others], listUnits(document.db))
  if (problems.length > 0) return nothing(problemText(declaration, problems))

  // **The last gate, and it is checked rather than assumed.** With the two
  // refusals above passed, a format the document has not got can only plan
  // to one `CREATE TABLE` — unless a `fmt_` table of that name is sitting
  // there with no declaration behind it at all, which the app leaves
  // strictly alone and so does this. A verifier proves what it checks
  // (D-138), and what is claimed here is that this call creates and never
  // alters. **This branch has no test**: reaching it means a `fmt_` table
  // with its declaration rows gone, and building one needs raw SQL, which
  // `src/plugin/` forbids with no exemptions (D-095). Kept anyway — the
  // cost is eight lines and the thing it prevents is a silent `ALTER`.
  const reconcile = planFor(document.db, declaration)
  const step = reconcile.steps[0]
  if (
    reconcile.refusals.length > 0 ||
    reconcile.steps.length !== 1 ||
    step?.kind !== 'CREATE_TABLE'
  ) {
    return nothing(
      `\`${tableNameFor(declaration)}\` is already in this document with no declaration ` +
        'behind it, so declaring this format would change a table rather than create one. ' +
        'Nothing here touches a table it cannot see a declaration for. Open `#/formats` in ' +
        'the app, which lists an orphaned table and leaves it exactly as it is.',
    )
  }

  return { declaration, blocked: undefined, reconcile }
}

/**
 * A list argument under its name, or under the one it had before M33 U3a:
 * `claims` was `identities` and `computed` was `derived`. A model reads the new
 * name in the schema; a conversation that learned the old one is still
 * answered. Both at once is refused rather than merged.
 */
function renamedList(args: Args, key: string, before: string): unknown {
  const now = args[key]
  const was = args[before]
  if (now !== undefined && was !== undefined) {
    throw new ToolInputError(`Send \`${key}\` — \`${before}\` is the name it had before — not both.`)
  }
  return now ?? was
}

/** The arguments of one declaration, checked for shape: `declare_format`'s own, or one entry of its `formats`. */
function declareArgsFrom(args: Args): DeclareArgs {
  const columns = args['columns']
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new ToolInputError('`columns` must be a list with at least one column in it.')
  }
  const offeredIdentities = renamedList(args, 'claims', 'identities')
  if (offeredIdentities !== undefined && !Array.isArray(offeredIdentities)) {
    throw new ToolInputError('`claims` must be a list of claim objects.')
  }
  const identities = offeredIdentities ?? []
  const offeredAggregates = args['aggregates']
  if (offeredAggregates !== undefined && !Array.isArray(offeredAggregates)) {
    throw new ToolInputError('`aggregates` must be a list of aggregate objects.')
  }
  const aggregates = offeredAggregates ?? []
  const offeredConstraints = args['constraints']
  if (offeredConstraints !== undefined && !Array.isArray(offeredConstraints)) {
    throw new ToolInputError('`constraints` must be a list of constraint objects.')
  }
  const constraints = offeredConstraints ?? []
  const offeredRollups = args['rollups']
  if (offeredRollups !== undefined && !Array.isArray(offeredRollups)) {
    throw new ToolInputError('`rollups` must be a list of rollup objects.')
  }
  const rollups = offeredRollups ?? []
  const offeredRuleSets = args['rule_sets']
  if (offeredRuleSets !== undefined && !Array.isArray(offeredRuleSets)) {
    throw new ToolInputError('`rule_sets` must be a list of rule set objects.')
  }
  const ruleSets = offeredRuleSets ?? []
  const offeredDerived = renamedList(args, 'computed', 'derived')
  if (offeredDerived !== undefined && !Array.isArray(offeredDerived)) {
    throw new ToolInputError('`computed` must be a list of computed column objects.')
  }
  const derived = offeredDerived ?? []
  if (derived.length > COLUMNS_MAX) {
    throw new ToolInputError(
      `${String(derived.length)} computed columns is more than the ${String(COLUMNS_MAX)} this takes in one call.`,
    )
  }
  if (ruleSets.length > COLUMNS_MAX) {
    throw new ToolInputError(
      `${String(ruleSets.length)} rule sets is more than the ${String(COLUMNS_MAX)} this takes in one call.`,
    )
  }
  if (rollups.length > COLUMNS_MAX) {
    throw new ToolInputError(
      `${String(rollups.length)} rollups is more than the ${String(COLUMNS_MAX)} this takes in one call.`,
    )
  }
  if (constraints.length > COLUMNS_MAX) {
    throw new ToolInputError(
      `${String(constraints.length)} constraints is more than the ${String(COLUMNS_MAX)} this takes in one call.`,
    )
  }
  if (aggregates.length > COLUMNS_MAX) {
    throw new ToolInputError(
      `${String(aggregates.length)} aggregates is more than the ${String(COLUMNS_MAX)} this takes in one call.`,
    )
  }
  if (identities.length > COLUMNS_MAX) {
    throw new ToolInputError(
      `${String(identities.length)} claims is more than the ${String(COLUMNS_MAX)} this takes in one call.`,
    )
  }
  if (columns.length > COLUMNS_MAX) {
    throw new ToolInputError(
      `${String(columns.length)} columns is more than the ${String(COLUMNS_MAX)} this takes in one call.`,
    )
  }
  // The name and the title are read leniently here and judged by
  // `declarationProblems` — one authority on what a declaration may be, and
  // it is the one whose sentences name the format. `requireString` would
  // answer an empty title with a sentence about an argument.
  return {
    name: optionalString(args, 'format') ?? '',
    title: optionalString(args, 'title') ?? '',
    notes: optionalString(args, 'notes'),
    columns,
    identities,
    aggregates,
    constraints,
    rollups,
    ruleSets,
    derived,
    // **Nothing to add up is the default** (M38 U5): a list needs no flag
    // saying so, and the trial's books spent a refusal learning the word.
    nothingMustHold: identities.length === 0,
  }
}

function declareMutation(args: DeclareArgs): Mutation<DeclarePlan> {
  return {
    // Nothing is written unless the declaration stands, so a refused call takes
    // no copy of the document to explain that nothing happened (D-217).
    refuses: (plan) => plan.blocked !== undefined,

    plan: (document) => {
      const nothing = (blocked: string): DeclarePlan => ({
        declaration: undefined,
        blocked,
        reconcile: undefined,
      })

      const parsed = parseDeclare(args)
      if ('blocked' in parsed) return nothing(parsed.blocked)
      return judgeDeclaration(document, parsed.declaration, [])
    },

    describe: (plan) =>
      plan.blocked ??
      (plan.declaration === undefined
        ? 'No declaration resolved.'
        : describeDeclaration(plan.declaration)),

    apply: (document, plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      const declaration = plan.declaration
      if (declaration === undefined) return 'No declaration resolved.'

      const applied = adoptFormat(document.db, declaration, Date.now())
      if (applied.refusals.length > 0) {
        return paragraphs(
          'Nothing was written. Between the preview and now, this document stopped agreeing:',
          applied.refusals.map((refusal) => `- \`${refusal.column}\` — ${refusal.detail}`).join('\n'),
        )
      }

      return paragraphs(
        `**${declaration.title}** is declared. \`${tableNameFor(declaration)}\` now exists with ` +
          `${plural(declaration.columns.length, 'column')} and no rows.`,
        'Write the first rows with `record_format_rows` — a batch in one call, a dry run ' +
          'first, and a key this format has not got refuses the batch rather than being dropped. ' +
          '`formats` prints the columns back at any time, and `extend_format` changes them.',
      )
    },
  }
}

// --- several formats in one call (M34 U2, D-395) ---------------------------

interface DeclareManyPlan {
  /** Each declaration's plan, in the order given. */
  readonly plans: readonly DeclarePlan[]
  /** Positions in the order given, in the order they are declared. */
  readonly order: readonly number[]
  /** The name each was asked for by, for a sentence about one that did not parse. */
  readonly names: readonly string[]
}

/**
 * The order a set of new formats is declared in: a format after every format
 * of the set it links to, and otherwise as given — the order a reading of
 * their files takes, for the same reason.
 */
function declarationOrder(declarations: readonly (FormatDeclaration | undefined)[]): readonly number[] {
  const names = new Set(declarations.flatMap((each) => (each === undefined ? [] : [each.name])))
  const needs = declarations.map(
    (each) =>
      new Set(
        (each?.columns ?? []).flatMap((one) =>
          isLinkType(one.type) && one.target !== undefined && one.target !== each?.name && names.has(one.target)
            ? [one.target]
            : [],
        ),
      ),
  )
  const order: number[] = []
  const done = new Set<string>()
  while (order.length < declarations.length) {
    const free = declarations.findIndex(
      (_, at) => !order.includes(at) && [...(needs[at] ?? [])].every((name) => done.has(name)),
    )
    const at = free === -1 ? declarations.findIndex((_, k) => !order.includes(k)) : free
    order.push(at)
    const name = declarations[at]?.name
    if (name !== undefined) done.add(name)
  }
  return order
}

function describeMany(plan: DeclareManyPlan): string {
  const refused = plan.order.filter((at) => plan.plans[at]?.blocked !== undefined)
  const titles = plan.order.map((at) => `\`${plan.names[at] ?? ''}\``).join(', ')
  return paragraphs(
    refused.length > 0
      ? `**Nothing will be declared.** These are declared all together or not at all, and ` +
          `${refused.map((at) => `\`${plan.names[at] ?? ''}\``).join(', ')} cannot be — each says why below.`
      : `**${plural(plan.plans.length, 'format')}, declared in the order their links need**: ${titles}.`,
    ...plan.order.map((at) => {
      const one = plan.plans[at]
      if (one === undefined) return undefined
      const body =
        one.blocked !== undefined
          ? `\`${plan.names[at] ?? ''}\`: ${one.blocked}`
          : one.declaration === undefined
            ? ''
            : describeDeclaration(one.declaration)
      return `---\n\n${body}`
    }),
  )
}

/**
 * **Several new formats in one call** (M34 U2): each judged against what the
 * document declares and the rest of the set, so a link between two of them is
 * not refused for pointing at a format that does not exist yet; declared in the
 * order their links need; **all of them or none**.
 */
function declareManyMutation(all: readonly DeclareArgs[]): Mutation<DeclareManyPlan> {
  return {
    refuses: (plan) => plan.plans.some((each) => each.blocked !== undefined),

    plan: (document) => {
      const parsed = all.map(parseDeclare)
      const declarations = parsed.map((each) => ('declaration' in each ? each.declaration : undefined))
      const plans = parsed.map((each, at): DeclarePlan => {
        const refused = (blocked: string): DeclarePlan => ({ declaration: undefined, blocked, reconcile: undefined })
        if ('blocked' in each) return refused(each.blocked)
        const name = each.declaration.name
        if (declarations.slice(0, at).some((other) => other?.name === name)) {
          return refused(`\`${name}\` is declared twice in this call; each format is declared once.`)
        }
        const others = declarations.flatMap((other, k) => (other === undefined || k === at ? [] : [other]))
        return judgeDeclaration(document, each.declaration, others)
      })
      return { plans, order: declarationOrder(declarations), names: all.map((each) => each.name) }
    },

    describe: describeMany,

    apply: (document, plan) => {
      if (plan.plans.some((each) => each.blocked !== undefined)) return describeMany(plan)
      const now = Date.now()
      const declared: FormatDeclaration[] = []
      for (const at of plan.order) {
        const declaration = plan.plans[at]?.declaration
        if (declaration === undefined) continue
        const applied = adoptFormat(document.db, declaration, now)
        if (applied.refusals.length > 0) {
          // Thrown, so the transaction takes back the formats declared before it.
          throw new Error(
            `Nothing was declared: between the preview and now \`${declaration.name}\` stopped fitting this document.`,
          )
        }
        declared.push(declaration)
      }
      return paragraphs(
        `**${plural(declared.length, 'format')} declared**, in this order: ` +
          `${declared.map((each) => `${each.title} (\`${tableNameFor(each)}\`)`).join(', ')} — each with no rows.`,
        'Read the files they come from with `read_onto_format` — several in one call with `files`, ' +
          'parents first on their own — or write rows with `record_format_rows`.',
      )
    },
  }
}

interface DeclareArgs {
  readonly name: string
  readonly title: string
  readonly notes: string | undefined
  readonly columns: readonly unknown[]
  readonly identities: readonly unknown[]
  readonly aggregates: readonly unknown[]
  /** Row constraints, each a `rule` sentence (D-259). */
  readonly constraints: readonly unknown[]
  /** Rollups, each a `works_out` sentence (D-271). */
  readonly rollups: readonly unknown[]
  /** Rule sets, each a `sets` sentence (D-273). */
  readonly ruleSets: readonly unknown[]
  /** Derived columns, each `{ name, works_out, note }` (D-334). */
  readonly derived: readonly unknown[]
  /** True exactly when there are no identities — the default since M38 U5. */
  readonly nothingMustHold: boolean
}

export const declareFormatTool: PluginTool = {
  definition: {
    name: 'declare_format',
    title: 'Declare a new format',
    description:
      'Bring a **new** kind of thing into a document: a format, compiled to a real table with ' +
      'real types and checks. Call `formats` first. Each column has a `snake_case` `name`, a ' +
      `\`type\` — one of ${wordsForTypes()} — and optionally a \`unit\` (\`g\`, \`kcal\`), ` +
      '`required`, `unique` (no two rows share it — a name a row is known by; text, integer, ' +
      'decimal, date, month or link), `values` for an enum or enums, `minimum`/`maximum`, a `scale` for a ' +
      '`decimal` (6 for a rate) and a `note` saying what it means. **A format declares its ' +
      'claims** — `claims`, equations over its numeric columns with a tolerance, like ' +
      '`4*protein_g + 4*carbs_g + 9*fat_g = kcal` within 2%; they make a row provable and never ' +
      'refuse one. **Ask the user whether any figures relate** before answering (a total and its ' +
      'parts, a price and a quantity); a list — books, contacts — makes none, needs no ' +
      'claims, and still gets every refusal. A figure worked out rather than typed is a ' +
      '`computed` column. **`money` is ' +
      'two columns**, minor units beside a currency, so no figure is a float. **`quantity` is two ' +
      'as well**, a figure beside the unit *that row* is in — only when the unit varies by row; ' +
      'otherwise a `real` with a `unit`. Neither takes a `unit`. A **ratio** has a `unit` and a ' +
      '`per` — `density`, `g` per `ml` — the only way a figure crosses dimensions: a claim ' +
      'writes `amount in g via ingredient.density`. No free-text check, no expression. **Across ' +
      'two columns of one row** is a `constraint`, one of four sentences: `isbn is required when ' +
      'kind is BOOK` (`required only when` adds *and empty otherwise*), `at most one of book, ' +
      'article, video`, `score is at most 10 when kind is QUIZ` (or `at least`), and `one row ' +
      'per course, week` (`when status is DONE` limits it) — a row breaking one is ' +
      'refused. `notes` is prose kept word for word: where the figures come from and what was ' +
      'decided. This **creates and never alters**: `extend_format` changes, `connect_formats` joins ' +
      'two. Writes nothing until `commit: true`. **Several ' +
      'at once**: `formats`, a list of these same arguments — links between them resolved in ' +
      'the order they need, all or none.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The name of the format, `snake_case` — `ingredient`. It names the table.'),
        formats: {
          type: 'array',
          description: 'Several new formats, each `{ format, title, columns, … }`.',
          items: { type: 'object', additionalProperties: true },
        },
        title: stringProp('What a person calls one of these — `Ingredient`.'),
        notes: stringProp('Prose about the format. Kept verbatim, never parsed. Optional but wanted.'),
        columns: {
          type: 'array',
          description:
            `The columns, in the order they should read. Up to ${String(COLUMNS_MAX)}. ` +
            // Generated from the same rows the editor draws its tiles from, so the
            // day a tenth type is added a model is told about it by the edit that
            // adds it. The hand-written list this replaced named seven of nine and
            // had never mentioned `link` at all (M20 U3).
            `${typeBriefing()} ` +
            'A `link` or `links` also takes a `target` — the format it points at. A ratio is a number ' +
            'with both a `unit` and a `per`.',
          items: { type: 'object', additionalProperties: true },
        },
        claims: {
          type: 'array',
          description:
            'What is claimed about one of these, proved or failed on every row. Each has a `name` in `snake_case`, an ' +
            '`expression` — one `=` with arithmetic over this format’s own numeric columns on ' +
            'either side — an optional `tolerance` (`exactly`, `2`, or `2%` of the right-hand ' +
            'side) and a `note` saying why it holds. Omit when there is none.',
          items: { type: 'object', additionalProperties: true },
        },
        aggregates: {
          type: 'array',
          description:
            'What this format works out from the rows of another that point at it. Each has a ' +
            '`name` in `snake_case`, an `of` — one of ' +
            'sum, count, average, minimum, maximum, latest, earliest — an `over_format` and an `over_column` ' +
            '(that format\u2019s `link` column pointing back at this one) or `every: true` for every ' +
            'row of it, a `works_out` ' +
            'expression evaluated on each of those rows **in their own vocabulary**, and an ' +
            'optional `unit`. A `count` needs no `works_out`. A `works_out` may reach one hop through the source\u2019s own ' +
            'links: `amount_g / 100 * ingredient.kcal`. An optional `where` folds only the rows ' +
            'that match \u2014 one column of the source, or one hop through its link: ' +
            '`project.active is true`, `kind is not X` (empty passes), `kind is one of X, Y`, ' +
            '`author is not empty`. `latest` and `earliest` read the one row ' +
            'with the greatest (least) `by` — a date, month, instant or integer of the source, ' +
            '`by: as_of`; a tie is unchecked. A claim of this format may then ' +
            'name the aggregate, which is what makes a total something the document proves ' +
            'rather than merely prints.',
          items: { type: 'object', additionalProperties: true },
        },
        constraints: {
          type: 'array',
          description:
            'Rules across the columns of one row, each `{ rule, note }` — `rule` is one of ' +
            '`x is required when kind is A, B`, `x is required only when kind is A, B` (and ' +
            'empty otherwise), `at most one of a, b, c`, `x is at most 0 when kind is A` or ' +
            '`x is at least 0 when kind is A`, or `one row per a, b` — no two rows share all of ' +
            'them; add `when kind is A` to count only those rows. `kind` is an enum of this ' +
            'format and the members are its own; a sign goes on a number or money column. Not ' +
            'a claim: a row that breaks one is refused, not reported.',
          items: { type: 'object', additionalProperties: true },
        },
        rollups: {
          type: 'array',
          description: ROLLUPS_DESCRIPTION,
          items: { type: 'object', additionalProperties: true },
        },
        rule_sets: {
          type: 'array',
          description: RULE_SETS_DESCRIPTION,
          items: { type: 'object', additionalProperties: true },
        },
        computed: {
          type: 'array',
          description: DERIVED_DESCRIPTION,
          items: { type: 'object', additionalProperties: true },
        },
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const many = args['formats']
    if (many !== undefined && many !== null) {
      if (args['format'] !== undefined || args['columns'] !== undefined) {
        throw new ToolInputError('Send `formats`, or one format’s own arguments — not both.')
      }
      if (!Array.isArray(many) || many.length === 0) {
        throw new ToolInputError('`formats` must be a list of declarations, with at least one in it.')
      }
      if (many.length > COLUMNS_MAX) {
        throw new ToolInputError(
          `${String(many.length)} formats is more than the ${String(COLUMNS_MAX)} this takes in one call.`,
        )
      }
      const each = many.map((one: unknown) => {
        if (typeof one !== 'object' || one === null || Array.isArray(one)) {
          throw new ToolInputError('Each entry of `formats` is one declaration: `{ format, title, columns, … }`.')
        }
        return declareArgsFrom(one as Args)
      })
      return mutatingCall(path, args['commit'] === true, declareManyMutation(each))
    }
    return mutatingCall(path, args['commit'] === true, declareMutation(declareArgsFrom(args)))
  },
}

// --- format_rollup ----------------------------------------------------------


/**
 * **Run a rollup** (M25 E2, D-271): the figure a format declares per month and
 * perhaps per link, as a table. The screen's view of the same thing is the
 * format's own page (`#/formats/<name>`), which shows every rollup it has.
 */
export const formatRollupTool: PluginTool = {
  definition: {
    name: 'format_rollup',
    title: 'A rollup of a declared format',
    description:
      'A rollup a format declares, run: a figure per month, and per linked row. `formats` ' +
      'lists them. A month with a row that cannot answer is `unchecked`, naming it; money ' +
      'stays per currency. Reads only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The declared format, by name.'),
        rollup: stringProp('By name; optional when there is one.'),
        from: stringProp('First month, `YYYY-MM`.'),
        to: stringProp('Last month, `YYYY-MM`.'),
        limit: { type: 'number', description: `Groups. Default ${String(ROWS_DEFAULT)}.` },
      },
      required: ['path', 'format'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const name = requireString(args, 'format')
    const limit = limitArg(args, ROWS_DEFAULT, ROWS_MAX)
    const from = optionalString(args, 'from')
    const to = optionalString(args, 'to')
    for (const [key, value] of [['from', from], ['to', to]] as const) {
      if (value !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
        throw new ToolInputError(`\`${key}\` is a month, \`YYYY-MM\` — ${value} is not one.`)
      }
    }

    return readDocument(path, (document) =>
      withFormat(document, name, (declaration) => {
        const declared = declaration.rollups ?? []
        if (declared.length === 0) {
          return `${declaration.name} declares no rollup. \`extend_format\` adds one: \`rollups: [{ name, works_out }]\`.`
        }
        const asked = optionalString(args, 'rollup')
        const chosen = asked ?? (declared.length === 1 ? declared[0]?.name : undefined)
        if (chosen === undefined || !declared.some((each) => each.name === chosen)) {
          throw new ToolInputError(
            `${asked === undefined ? `${declaration.name} declares ${plural(declared.length, 'rollup')}; name one` : `${declaration.name} has no rollup called ${asked}`} — ` +
              declared.map((each) => `\`${each.name}\` (${rollupText(each)})`).join(', ') +
              '.',
          )
        }
        const result = runRollup(document.db, declaration, chosen, listFormats(document.db), {
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
          today: askedOn(),
        })
        if (result === undefined) return 'No rollup resolved.'
        const lead = `**${result.rollup.name}** of ${declaration.name} \u2014 \`${rollupText(result.rollup)}\``
        if (result.groups.length === 0) {
          return paragraphs(lead, (from ?? to) === undefined ? 'No row falls in it yet.' : 'No row falls in it in those months.')
        }
        const shown = result.groups.slice(0, limit)
        const byTitle = result.target?.title ?? result.rollup.by ?? ''
        const moneyOf = (minor: number, currency: string): string => formatMoney(moneyAmount(minor, currency))
        const unchecked = result.groups.filter((group) => group.value.kind === 'UNCHECKED').length
        return paragraphs(
          lead,
          table(
            ['Month', ...(result.rollup.by === undefined ? [] : [byTitle]), 'Figure', 'Rows'],
            shown.map((group) => [
              group.period ?? '(no month)',
              ...(result.rollup.by === undefined
                ? []
                : [group.by === undefined ? '(none)' : (result.labels.get(group.by) ?? group.by)]),
              group.value.kind === 'VALUE'
                ? group.value.figures.map((figure) => figureText(figure, moneyOf)).join(' + ')
                : `unchecked \u2014 ${group.value.reason}`,
              String(group.rows),
            ]),
          ),
          result.groups.length > shown.length
            ? `Showing ${String(shown.length)} of ${plural(result.groups.length, 'group')}; \`from\`, \`to\` or \`limit\` shows the rest.`
            : '',
          unchecked === 0 ? '' : `${plural(unchecked, 'group')} ${unchecked === 1 ? 'is' : 'are'} unchecked, and only ${unchecked === 1 ? 'that one' : 'those'}: every other figure is the whole of its month.`,
        )
      }),
    )
  },
}

// --- connect_formats --------------------------------------------------------

/**
 * **Parity gap #11, closed** — M24 U2, D-253. `#/connections` joins two formats
 * that are both already there: a `link` on one and, if wanted, the figure folded
 * back across it. `declare_format` creates and never alters, so a conversation
 * could make the first side of a connection only while making the format — and
 * the kitchen's `recipe` could never fold `recipe_line`, because each had to
 * exist before the other.
 *
 * **The same writes the screen makes, in the same order, through the same
 * function**: `connect` builds the revised declarations and `adoptFormat` adopts
 * each, the link before the figure. The panel builds its own from `FormatDraft`s
 * (`buildDrafts`), because it also edits and removes — which this does not. What the screen judges before it offers its
 * button — `declarationProblems` against the merged set, then the plan against
 * the rows — is what this judges before it offers a commit.
 *
 * **Additive only, and checked rather than assumed** (D-138): a plan with any
 * step but `ADD_COLUMN` is refused. A link may be empty, so adding one to a table
 * with rows loses nothing; a *required* one is the reconciler's
 * `REQUIRED_ON_ROWS`, reported in its own words and never worked around.
 */
interface ConnectPlan {
  readonly revised: readonly FormatDeclaration[]
  readonly request: ConnectionRequest | undefined
  /** Whether the link column is new, or already there and only folded over. */
  readonly newLink: boolean
  /** The rows the link's format already holds, which start with it empty. */
  readonly rows: number
  readonly blocked: string | undefined
}

interface ConnectArgs {
  readonly from: string
  readonly column: string | undefined
  readonly target: string
  readonly required: boolean
  readonly note: string
  readonly aggregate: unknown
  /** `date in period` (D-350), as offered. */
  readonly foundBy: string | undefined
}

const CONNECT_AGGREGATE_KEYS = ['name', 'of', 'works_out', 'unit', 'where', 'by', 'note']

function connectMutation(args: ConnectArgs): Mutation<ConnectPlan> {
  return {
    refuses: (plan) => plan.blocked !== undefined,

    plan: (document) => {
      const nothing = (blocked: string): ConnectPlan => ({
        revised: [],
        request: undefined,
        newLink: false,
        rows: 0,
        blocked,
      })

      // Both ends through `resolve`, so a table that has not caught up with its
      // declaration is refused here exactly as a row written to it would be.
      const from = resolve(document, args.from)
      if ('refusal' in from) return nothing(from.refusal)
      const target = resolve(document, args.target)
      if ('refusal' in target) return nothing(target.refusal)

      const column = args.column ?? freeColumnName(from.declaration, target.declaration.name)

      let figure: AggregateDeclaration | undefined
      if (args.aggregate !== undefined) {
        const offered = args.aggregate
        if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
          return nothing('`aggregate` is one object — the figure folded back along this link.')
        }
        const extra = Object.keys(offered).filter((key) => !CONNECT_AGGREGATE_KEYS.includes(key))
        if (extra.length > 0) {
          return nothing(
            `The aggregate was given ${extra.join(', ')}, which ${verb(extra.length, 'is', 'are')} ` +
              `not part of one here. It has ${CONNECT_AGGREGATE_KEYS.join(', ')} — and no ` +
              '`over_format` or `over_column`, because the link this call names is what it folds over.',
          )
        }
        // The parser `declare_format` uses, handed the over this call implies,
        // so a figure reads the same whichever tool it arrives through.
        const parsed = aggregateOf(
          { ...offered, over_format: from.declaration.name, over_column: column },
          0,
        )
        if (!parsed.ok) return nothing(wrongText([{ column: undefined, message: parsed.error }]))
        figure = parsed.value
      }

      let foundBy: FoundBy | undefined
      if (args.foundBy !== undefined) {
        const parsed = parseFoundBy(args.foundBy)
        if (!parsed.ok) return nothing(parsed.error)
        foundBy = parsed.value
      }

      const request: ConnectionRequest = {
        from: from.declaration.name,
        column,
        target: target.declaration.name,
        required: args.required,
        note: args.note,
        figure,
        foundBy,
      }
      const declared = listFormats(document.db)
      const connected = connect(declared, request)
      if (!connected.ok) return nothing(connected.error)
      const revised = connected.value
      // Adding a link or a figure to a pack's format is a person's own column
      // (D-269), and the check says so rather than assuming it.
      for (const each of revised) {
        const was = declared.find((one) => one.name === each.name)
        const owned = was === undefined ? undefined : declarationChangeRefusal(was, each)
        if (owned !== undefined) return nothing(owned)
      }

      const merged = declared.map((each) => revised.find((one) => one.name === each.name) ?? each)
      const units = listUnits(document.db)
      for (const declaration of revised) {
        const problems = declarationProblems(
          declaration,
          merged.filter((each) => each.name !== declaration.name),
          units,
        )
        if (problems.length > 0) return nothing(problemText(declaration, problems))
      }

      for (const declaration of revised) {
        const reconcile = planFor(document.db, declaration)
        if (reconcile.refusals.length > 0) {
          const required = reconcile.refusals.some((each) => each.reason === 'REQUIRED_ON_ROWS')
          return nothing(
            paragraphs(
              `\`${tableNameFor(declaration)}\` cannot take this as it stands, so **nothing was written**:`,
              reconcile.refusals
                .map((refusal) => `- \`${refusal.column}\` — ${refusal.detail}`)
                .join('\n'),
              ...(required
                ? [
                    'Make the link without `required` — a link may be empty — fill it on the ' +
                      'rows already there with `update_format_rows`, and ask the user afterwards ' +
                      'whether it should be required.',
                  ]
                : []),
            ),
          )
        }
        if (reconcile.steps.some((step) => step.kind !== 'ADD_COLUMN')) {
          return nothing(
            `Connecting would change \`${tableNameFor(declaration)}\` by more than adding a ` +
              'column, and this tool only ever adds. Nothing was written. Open `#/connections` ' +
              'in the app, where the plan is drawn in full before anything is saved.',
          )
        }
      }

      return {
        revised,
        request,
        newLink: !from.declaration.columns.some((each) => each.name === column),
        rows: rowCountOf(document.db, from.declaration),
        blocked: undefined,
      }
    },

    describe: (plan) => plan.blocked ?? describeConnection(plan, 'Would connect'),

    apply: (document, plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      const now = Date.now()
      for (const declaration of plan.revised) {
        const applied = adoptFormat(document.db, declaration, now)
        // Thrown, not returned: the link may already be adopted inside this
        // transaction, and a throw is what rolls it back and skips the save. The
        // plan was judged clean a moment ago in the same transaction, so this is
        // the document disagreeing with itself rather than a caller's mistake.
        if (applied.refusals.length > 0) {
          throw new Error(
            `Nothing was written: ${declaration.name} refused ` +
              applied.refusals.map((each) => `${each.column} (${each.detail})`).join('; '),
          )
        }
      }
      return paragraphs(
        describeConnection(plan, 'Connected'),
        (plan.newLink && plan.request?.foundBy === undefined
          ? 'Fill the link with `update_format_rows` — it takes the id of the row it names, ' +
            'which `format_rows` prints beside each one. '
          : '') +
          '`formats` prints both declarations back, and the connection is on the graph at ' +
          '`#/connections` in the app.',
      )
    },
  }
}

/** The connection a plan makes, in the words the tool answers with. */
function describeConnection(plan: ConnectPlan, lead: string): string {
  const request = plan.request
  if (request === undefined) return 'No connection resolved.'
  const link = `\`${request.from}.${request.column}\``
  const figure = request.figure
  return paragraphs(
    `${lead} **${request.from}** to **${request.target}**.`,
    [
      plan.newLink
        ? `- ${link} — a new \`link\` column: each ${request.from} belongs to one ` +
          `${request.target}${request.required ? ', and must have one' : ', or to none'}.` +
          (plan.rows > 0
            ? ` The ${plural(plan.rows, 'row')} already there start with it empty, which loses nothing.`
            : '')
        : request.foundBy === undefined
          ? `- ${link} — already a link to ${request.target}, and left exactly as it is.`
          : `- ${link} — already a link to ${request.target}.`,
      request.foundBy === undefined
        ? ''
        : `- ${link} is **found by ${foundByText(request.foundBy)}**: a row written with it empty ` +
          `gets the ${request.target} its ${request.foundBy.from} falls ` +
          `${request.foundBy.grain === 'DAY' ? 'on' : 'in the month of'}, stored as if picked. ` +
          `No ${request.target} or two is a refusal naming them, never a guess, and a link a ` +
          'person set is never moved. Rows already there are left as they are until ' +
          `\`apply_rules\` with \`format: ${request.from}\` and \`link: ${request.column}\` fills their empty ones.`,
      figure === undefined
        ? ''
        : `- \`${request.target}.${figure.name}\` — the ${figure.kind.toLowerCase()}` +
          (figure.expression === '' ? '' : ` of \`${figure.expression}\``) +
          `${figure.unit === undefined ? '' : ` in ${figure.unit}`} over the ${request.from} ` +
          `rows that belong to it through ${request.column}` +
          (figure.where === undefined ? '' : ` and where ${filterText(figure.where)}`) +
          '. Computed on every read and never stored, so ' +
          'nothing already written changes.',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  )
}

export const connectFormatsTool: PluginTool = {
  definition: {
    name: 'connect_formats',
    title: 'Connect two formats',
    description:
      'Join two formats this document **already** declares: a `link` column on `format`, so ' +
      'each of its rows belongs to one row of `target` — each `recipe_line` belongs to one `recipe` — and, ' +
      'optionally, a total on `target` along it (an `aggregate`): `recipe.total_kcal`, the ' +
      'sum of `amount_g / 100 * ingredient.kcal` over the lines that name it. This is how a ' +
      'format gets a total of another declared after it, which `declare_format` ' +
      'cannot do. Name an existing link as `column` to add only the total. **It only ' +
      'adds**: a link may be empty, so rows already there lose nothing; `required: true` on a ' +
      'format that has rows is refused. A connection is removed with `extend_format` `remove` ' +
      '(the link column once its cells are emptied, or the total); re-pointing one is done at ' +
      '`#/connections` in the app. Returns what it would add and writes nothing until ' +
      '`commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The format that gets the link — the many side, `recipe_line`.'),
        target: stringProp('The format each row belongs to one of — `recipe`, the one side.'),
        column: stringProp(
          'The link column’s name, `snake_case`. Defaults to the target’s name, suffixed if ' +
            'taken. Name an existing link to it to add only the total.',
        ),
        required: booleanProp('Every row must name one. Refused on a format that already has rows.'),
        note: stringProp('What the link means. Kept with the declaration, word for word.'),
        found_by: stringProp(
          'How the link fills itself while empty: `date in period` (this date’s month) or `date on ' +
            'paid_on` (the same day). No row or two is refused by name; a link a person set stays.',
        ),
        aggregate: {
          type: 'object',
          description:
            'The total `target` keeps of the rows that name it: a `name` in ' +
            '`snake_case`, an `of` — one of sum, count, average, minimum, maximum — a ' +
            '`works_out` expression over each of those rows in their own vocabulary (their ' +
            'computed columns too, and one hop, `ingredient.kcal`). A `count` needs no `works_out`. It takes a ' +
            '`unit` (none for money: it keeps its currency), `where` (only the rows that match: `status is DONE`, ' +
            '`kind is not X`, `kind is one of X, Y`, `author is empty`) and `note`. No `over_*`: this link is what it ' +
            'folds over.',
          additionalProperties: true,
        },
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path', 'format', 'target'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) =>
    mutatingCall(
      requireString(args, 'path'),
      args['commit'] === true,
      connectMutation({
        from: requireString(args, 'format'),
        target: requireString(args, 'target'),
        column: optionalString(args, 'column')?.trim() || undefined,
        required: optionalBoolean(args, 'required') ?? false,
        note: optionalString(args, 'note') ?? '',
        aggregate: args['aggregate'],
        foundBy: optionalString(args, 'found_by')?.trim() || undefined,
      }),
    ),
}

// --- extend_format ----------------------------------------------------------

/**
 * **Add to a format that exists** — M24 U3, D-254. The screen's edit has two
 * verbs since D-237, add a column or remove the whole format, and this is the
 * first of them with an identity beside it (`M23 U2 #1`): an identity adds no
 * DDL and refuses no row, so it is the one alteration that loses nothing at all.
 *
 * The same rule as `connect_formats`, and checked the same way: every step of
 * the plan is an `ADD_COLUMN`, and a refusal is the reconciler's own sentence —
 * a required column on a table with rows is `REQUIRED_ON_ROWS`, never worked
 * around with a default nobody chose.
 */
/**
 * **What a conversation changes about what a format has** (M38 U6, D-412). The
 * sheet's alterations, made through the same `adoptFormat` with the same
 * renames and judged by the same reconciler — so a rename keeps its values, a
 * list every row fits is rebuilt, and a change that would lose or re-mean what
 * the rows hold is refused, naming the rows.
 */
interface Alteration {
  /** New name to old, as `adoptFormat` takes them. */
  readonly renames: ReadonlyMap<string, string>
  readonly changes: readonly unknown[]
  readonly removals: readonly string[]
}

const NO_ALTERATION: Alteration = { renames: new Map(), changes: [], removals: [] }

/** The key each field of a column is offered as — what a `change` keeps when it does not name it. */
const CHANGE_FIELDS: readonly (readonly [string, keyof ColumnDeclaration])[] = [
  ['target', 'target'],
  ['unit', 'unit'],
  ['per', 'per'],
  ['required', 'required'],
  ['unique', 'unique'],
  ['scale', 'scale'],
  ['values', 'values'],
  ['minimum', 'minimum'],
  ['maximum', 'maximum'],
  ['note', 'note'],
  ['found_by', 'foundBy'],
]

/** What a column keeps across a change of type: nothing that belonged to the old one. */
const KEPT_ACROSS_TYPES = new Set(['required', 'unique', 'note'])

interface ExtendPlan {
  readonly before: FormatDeclaration | undefined
  /** `before` renamed, changed and with its removals gone — nothing added yet. */
  readonly base: FormatDeclaration | undefined
  readonly after: FormatDeclaration | undefined
  readonly rows: number
  readonly renames: ReadonlyMap<string, string>
  readonly changed: readonly string[]
  readonly removed: readonly string[]
  readonly steps: readonly ReconcileStep[]
  readonly blocked: string | undefined
}

/** `before` with a conversation's renames, changes and removals, and what is wrong with them. */
function alteredOf(
  before: FormatDeclaration,
  alter: Alteration,
): {
  readonly base: FormatDeclaration
  readonly changed: readonly string[]
  readonly removed: readonly string[]
  readonly wrong: readonly Wrong[]
} {
  const wrong: Wrong[] = []
  const had = before.columns.map((column) => column.name)
  const renamed = new Map([...alter.renames].map(([to, from]) => [from, to]))
  for (const from of renamed.keys()) {
    if (!had.includes(from)) {
      wrong.push({ column: from, message: `${before.name} has no column called ${from} to rename. It has ${had.join(', ')}.` })
    }
  }
  let columns = before.columns.map((column) => ({ ...column, name: renamed.get(column.name) ?? column.name }))

  const changed: string[] = []
  alter.changes.forEach((offered, index) => {
    if (typeof offered !== 'object' || offered === null || Array.isArray(offered)) {
      wrong.push({ column: undefined, message: `Change ${String(index + 1)} is not an object of column properties.` })
      return
    }
    const entry = offered as Record<string, unknown>
    const named = typeof entry['name'] === 'string' ? entry['name'].trim() : ''
    const name = renamed.get(named) ?? named
    const was = columns.find((column) => column.name === name)
    if (was === undefined) {
      wrong.push({
        column: undefined,
        message: `${before.name} has no column called ${named === '' ? '(no name)' : named} to change. It has ${columns.map((column) => column.name).join(', ')}.`,
      })
      return
    }
    const parsed = columnOf({ type: was.type, ...entry, name }, index)
    if (!parsed.ok) {
      wrong.push({ column: name, message: parsed.error })
      return
    }
    const retyped = parsed.value.type !== was.type
    const kept = Object.fromEntries(
      CHANGE_FIELDS.filter(([key]) => !(key in entry) && (!retyped || KEPT_ACROSS_TYPES.has(key))).map(
        ([, field]) => [field, was[field]],
      ),
    )
    columns = columns.map((column) => (column.name === name ? { ...parsed.value, ...kept } : column))
    changed.push(name)
  })

  let identities = before.identities
  let aggregates = before.aggregates
  let derived = before.derived
  let rollups = before.rollups
  let ruleSets = before.ruleSets
  const removed: string[] = []
  for (const name of alter.removals) {
    const kinds = [
      columns.some((each) => each.name === name) ? 'column' : undefined,
      identities.some((each) => each.name === name) ? 'claim' : undefined,
      aggregates.some((each) => each.name === name) ? 'total' : undefined,
      (derived ?? []).some((each) => each.name === name) ? 'computed column' : undefined,
      (rollups ?? []).some((each) => each.name === name) ? 'rollup' : undefined,
      (ruleSets ?? []).some((each) => each.name === name) ? 'rule set' : undefined,
    ].filter((kind) => kind !== undefined)
    if (kinds.length !== 1) {
      wrong.push({
        column: undefined,
        message:
          kinds.length === 0
            ? `${before.name} has nothing called ${name} to remove: no column, claim, total, computed column, rollup or rule set.`
            : `${name} is both a ${kinds.join(' and a ')} of ${before.name}; remove it on the format’s own table in the app.`,
      })
      continue
    }
    columns = columns.filter((each) => each.name !== name)
    identities = identities.filter((each) => each.name !== name)
    aggregates = aggregates.filter((each) => each.name !== name)
    derived = derived?.filter((each) => each.name !== name)
    rollups = rollups?.filter((each) => each.name !== name)
    ruleSets = ruleSets?.filter((each) => each.name !== name)
    removed.push(name)
  }

  return {
    base: {
      ...before,
      columns,
      identities,
      aggregates,
      ...(derived === undefined ? {} : { derived }),
      ...(rollups === undefined ? {} : { rollups }),
      ...(ruleSets === undefined ? {} : { ruleSets }),
    },
    changed,
    removed,
    wrong,
  }
}

/**
 * The rows a refusal is about, by id (D-259's rule, M38 U6): what holds a value
 * in a column that would go, or a value a new list leaves out — so they can be
 * changed with `update_format_rows` first.
 */
function refusedRows(
  db: Database,
  before: FormatDeclaration,
  after: FormatDeclaration,
  renames: ReadonlyMap<string, string>,
  refusal: { readonly column: string; readonly reason: string },
): readonly string[] {
  if (refusal.reason === 'DROP_WITH_DATA') return rowsHolding(db, before, [refusal.column])
  if (refusal.reason !== 'TYPE_CHANGED' && refusal.reason !== 'CONSTRAINT_CHANGED') return []
  const now = after.columns.find((column) => column.name === refusal.column)
  if (now?.type !== 'enum') return []
  return rowsHolding(db, before, [renames.get(now.name) ?? now.name], now.values)
}

/** What the reconciler will do to the rows already there, in the sheet's words (`ShapePanel`). */
function stepsText(plan: ExtendPlan): string {
  const some = plural(plan.rows, 'row')
  const rebuilt = new Set(
    plan.steps
      .filter((step) => step.kind === 'ADD_COLUMN')
      .map((step) => step.column)
      .filter((column) => plan.steps.some((step) => step.kind === 'DROP_COLUMN' && step.column === column)),
  )
  return plan.steps
    .flatMap((step): string[] => {
      switch (step.kind) {
        case 'RENAME_COLUMN':
          return [`\`${step.from}\` becomes \`${step.column}\`${plan.rows === 0 ? '.' : `; its ${some} keep their values.`}`]
        case 'REBUILD_TABLE':
          return [`\`${step.column}\` takes its new list; the ${some} keep their values.`]
        case 'LOOSEN_COLUMN':
          return [`\`${step.column}\` may be left empty now; the ${some} keep their values.`]
        case 'ADD_COLUMN':
          return rebuilt.has(step.column) ? [`\`${step.column}\` is made again in its new shape; it holds nothing, so nothing is lost.`] : []
        case 'DROP_COLUMN':
          return rebuilt.has(step.column) ? [] : [`\`${step.column}\` goes; it holds nothing, so nothing is lost.`]
        case 'DROP_INDEX':
          return [`\`${step.column}\` may repeat again.`]
        // Taken down and put back around a rebuild, it is held throughout (M48 U1).
        case 'DROP_CHECK':
          return step.kept === true ? [] : [`No longer held to: ${step.column}.`]
        default:
          return []
      }
    })
    .join('\n')
}

function extendMutation(
  name: string,
  offeredColumns: readonly unknown[],
  offeredIdentities: readonly unknown[],
  madeUnique: readonly string[],
  offeredConstraints: readonly unknown[] = [],
  offeredRollups: readonly unknown[] = [],
  offeredRuleSets: readonly unknown[] = [],
  order: readonly string[] | undefined = undefined,
  offeredDerived: readonly unknown[] = [],
  offeredAggregates: readonly unknown[] = [],
  alter: Alteration = NO_ALTERATION,
): Mutation<ExtendPlan> {
  return {
    refuses: (plan) => plan.blocked !== undefined,

    plan: (document) => {
      const nothing = (blocked: string): ExtendPlan => ({
        before: undefined,
        base: undefined,
        after: undefined,
        rows: 0,
        renames: alter.renames,
        changed: [],
        removed: [],
        steps: [],
        blocked,
      })
      const resolved = resolve(document, name)
      if ('refusal' in resolved) return nothing(resolved.refusal)
      const before = resolved.declaration
      const { base, changed, removed, wrong } = alteredOf(before, alter)

      const columns: ColumnDeclaration[] = []
      const identities: IdentityDeclaration[] = []
      const malformed: Wrong[] = [...wrong]
      offeredColumns.forEach((offered, index) => {
        const parsed = columnOf(offered, index)
        if (parsed.ok) columns.push(parsed.value)
        else malformed.push({ column: undefined, message: parsed.error })
      })
      offeredIdentities.forEach((offered, index) => {
        const parsed = identityOf(offered, index)
        if (parsed.ok) identities.push(parsed.value)
        else malformed.push({ column: undefined, message: parsed.error })
      })
      const constraints: RowConstraint[] = []
      offeredConstraints.forEach((offered, index) => {
        const parsed = constraintOf(offered, index)
        if (!parsed.ok) malformed.push({ column: undefined, message: parsed.error })
        // One the format holds already is said as that, not as *declared twice* (M48 U1).
        else if ((base.constraints ?? []).some((each) => constraintKey(each) === constraintKey(parsed.value))) {
          malformed.push({
            column: undefined,
            message: `${name} already holds "${constraintText(parsed.value)}", so there is nothing to add. \`formats\` with this format lists what it holds.`,
          })
        } else constraints.push(parsed.value)
      })
      const rollups: RollupDeclaration[] = []
      offeredRollups.forEach((offered, index) => {
        const parsed = rollupOf(offered, index)
        if (parsed.ok) rollups.push(parsed.value)
        else malformed.push({ column: undefined, message: parsed.error })
      })
      const ruleSets: RuleSetDeclaration[] = []
      offeredRuleSets.forEach((offered, index) => {
        const parsed = ruleSetOf(offered, index)
        if (parsed.ok) ruleSets.push(parsed.value)
        else malformed.push({ column: undefined, message: parsed.error })
      })
      const derived: DerivedDeclaration[] = []
      offeredDerived.forEach((offered, index) => {
        const parsed = derivedOfOffered(offered, index)
        if (parsed.ok) derived.push(parsed.value)
        else malformed.push({ column: undefined, message: parsed.error })
      })
      // A total adds no column and refuses no row, as an identity does (M34
      // U4, D-397) — `every: true` is how a conversation folds every row of a
      // format nothing links from, which `connect_formats` cannot say.
      const aggregates: AggregateDeclaration[] = []
      offeredAggregates.forEach((offered, index) => {
        const parsed = aggregateOf(offered, index)
        if (parsed.ok) aggregates.push(parsed.value)
        else malformed.push({ column: undefined, message: parsed.error })
      })
      for (const each of madeUnique) {
        if (!base.columns.some((column) => column.name === each)) {
          malformed.push({
            column: each,
            message: `${before.name} has no column called ${each} to make unique. It has ${base.columns.map((column) => column.name).join(', ')}.`,
          })
        }
      }
      if (malformed.length > 0) return nothing(wrongText(malformed))

      const added: FormatDeclaration = {
        ...base,
        // Rewritten by this build, as the screen's edit is (D-255): a unique
        // column needs the language that can say it.
        language: DECLARATION_LANGUAGE,
        columns: [
          ...base.columns.map((column) =>
            madeUnique.includes(column.name) ? { ...column, unique: true } : column,
          ),
          ...columns,
        ],
        identities: [...base.identities, ...identities],
        aggregates: [...base.aggregates, ...aggregates],
        ...(constraints.length === 0 && base.constraints === undefined
          ? {}
          : { constraints: [...(base.constraints ?? []), ...constraints] }),
        ...(rollups.length === 0 && base.rollups === undefined
          ? {}
          : { rollups: [...(base.rollups ?? []), ...rollups] }),
        ...(ruleSets.length === 0 && base.ruleSets === undefined
          ? {}
          : { ruleSets: [...(base.ruleSets ?? []), ...ruleSets] }),
        ...(derived.length === 0 && base.derived === undefined
          ? {}
          : { derived: [...(base.derived ?? []), ...derived] }),
        // A format that said nothing has to hold has now been told something
        // does, and H3's two answers cannot both stand (D-222).
        nothingMustHold: identities.length > 0 ? false : before.nothingMustHold,
      }
      // **A new order, every column named once** (M29 U2, D-332) — the new
      // ones included, so a column can be added where it belongs.
      // What reads a renamed column on this format follows it, as on the sheet.
      const followed = declarationFollowingRenames(added, alter.renames)
      const ordered = order === undefined ? { ok: true as const, value: followed } : inOrder(followed, order)
      if (!ordered.ok) return nothing(ordered.error)
      const after = ordered.value

      const declared = listFormats(document.db)
      const units = listUnits(document.db)
      const problems = declarationProblems(
        after,
        declared.filter((each) => each.name !== after.name),
        units,
      )
      if (problems.length > 0) return nothing(problemText(after, problems))
      // A pack's format takes a person's own column, and keeps the pack's
      // as it declared them (M25 E5, D-269) — making one unique changes it.
      const owned = declarationChangeRefusal(before, after)
      if (owned !== undefined) return nothing(owned)
      // Another format reading what this changes is the sheet's refusal too (D-290).
      const breaks = neighbourBreaks(after, before, declared, units)
      if (breaks.length > 0) {
        return nothing(paragraphs('Nothing was written. This change would break another format:', breaks.map((each) => `- ${each}`).join('\n')))
      }

      const reconcile = planFor(document.db, after, alter.renames)
      if (reconcile.refusals.length > 0) {
        const required = reconcile.refusals.some((each) => each.reason === 'REQUIRED_ON_ROWS')
        return nothing(
          paragraphs(
            `\`${tableNameFor(after)}\` cannot take this as it stands, so **nothing was written**:`,
            reconcile.refusals
              .map((each) => {
                const line = `- \`${each.column}\` — ${each.detail}`
                if (each.reason === 'NOT_HELD') {
                  // The rows, by id, so they can be corrected with
                  // `update_format_rows` before the rule goes on (D-259).
                  const rule = constraints.find((one) => each.detail.includes(`"${constraintText(one)}"`))
                  const ids = rule === undefined ? [] : rowsBreaking(document.db, after, rule)
                  return ids.length === 0 ? line : `${line} Among them: ${ids.map((id) => `\`${id}\``).join(', ')}.`
                }
                const held = refusedRows(document.db, before, after, alter.renames, each)
                if (held.length > 0) return `${line} The rows: ${held.map((id) => `\`${id}\``).join(', ')}.`
                if (each.reason !== 'NOT_UNIQUE') return line
                const repeats = repeatsIn(document.db, after, each.column)
                  .map((one) => `${JSON.stringify(one.value)} (${plural(one.rows, 'row')})`)
                  .join(', ')
                return `${line} The repeated values: ${repeats}.`
              })
              .join('\n'),
            ...(required
              ? [
                  'Add it without `required`, fill it on the rows already there with ' +
                    '`update_format_rows`, then `change` it to `required: true`.',
                ]
              : []),
            ...(reconcile.refusals.some(
              (each) =>
                each.reason === 'UNIT_CHANGED' ||
                each.reason === 'TARGET_CHANGED' ||
                (each.reason === 'TYPE_CHANGED' && refusedRows(document.db, before, after, alter.renames, each).length === 0),
            )
              ? [
                  'What a column holds keeps its type and unit. To move it, add a column in the new shape, ' +
                    'copy the values across with `update_format_rows`, then `remove` this one.',
                ]
              : []),
          ),
        )
      }

      return {
        before,
        base,
        after,
        rows: rowCountOf(document.db, before),
        renames: alter.renames,
        changed,
        removed,
        steps: reconcile.steps,
        blocked: undefined,
      }
    },

    describe: (plan) => plan.blocked ?? describeExtension(plan, false),

    apply: (document, plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      if (plan.after === undefined) return 'No declaration resolved.'
      const applied = adoptFormat(document.db, plan.after, Date.now(), plan.renames)
      if (applied.refusals.length > 0) {
        return paragraphs(
          'Nothing was written. Between the preview and now, this document stopped agreeing:',
          applied.refusals.map((each) => `- \`${each.column}\` — ${each.detail}`).join('\n'),
        )
      }
      return paragraphs(
        describeExtension(plan, true),
        '`format_rows` prints each row with what its claims now say about it — and a row ' +
          'with nothing in a column a claim names is `unchecked`, which is what every row ' +
          'already there is until somebody fills the new columns.',
      )
    },
  }
}

function describeExtension(plan: ExtendPlan, done: boolean): string {
  const { before, base, after } = plan
  if (before === undefined || base === undefined || after === undefined) return 'No declaration resolved.'
  // By name, not by place: an `order` moves the columns it already had (D-332),
  // and a rename, change or removal is said apart from what is added (D-412).
  const had = new Set(base.columns.map((column) => column.name))
  const named = <T extends { readonly name: string }>(was: readonly T[] | undefined, now: readonly T[] | undefined): readonly T[] => {
    const old = new Set((was ?? []).map((each) => each.name))
    return (now ?? []).filter((each) => !old.has(each.name))
  }
  const columns = after.columns.filter((column) => !had.has(column.name))
  const moved = orderChange(before, after, plan.renames)
  const identities = named(base.identities, after.identities)
  const constraints = (after.constraints ?? []).slice((base.constraints ?? []).length)
  const rollups = named(base.rollups, after.rollups)
  const ruleSets = named(base.ruleSets, after.ruleSets)
  const derived = named(base.derived, after.derived)
  const aggregates = named(base.aggregates, after.aggregates)
  const madeUnique = after.columns
    .filter((column) => had.has(column.name))
    .filter(
      (column) =>
        column.unique && base.columns.find((each) => each.name === column.name)?.unique !== true,
    )
    .map((column) => `\`${column.name}\``)
  const altered = plan.renames.size > 0 || plan.changed.length > 0 || plan.removed.length > 0
  const changed = after.columns.filter((column) => plan.changed.includes(column.name))
  const lead = altered ? (done ? 'Changed' : 'Would change') : done ? 'Added' : 'Would add'
  return paragraphs(
    `${lead} ${altered ? '' : 'to '}**${after.title}** (\`${after.name}\`)` +
      (plan.rows > 0 && columns.length > 0
        ? ` — its ${plural(plan.rows, 'row')} start with the new columns empty, which loses nothing.`
        : '.'),
    changed.length === 0
      ? ''
      : table(['Column', 'Type', 'Unit', 'Constraint', 'Values', 'Bounds', 'What it means'], changed.map(columnRow)),
    stepsText(plan),
    plan.removed.length === 0
      ? ''
      : `${plan.removed.map((each) => `\`${each}\``).join(', ')} ${verb(plan.removed.length, 'goes', 'go')} from the declaration.`,
    columns.length === 0
      ? ''
      : table(
          ['Column', 'Type', 'Unit', 'Constraint', 'Values', 'Bounds', 'What it means'],
          columns.map(columnRow),
        ),
    identities.length === 0
      ? ''
      : identitiesText({ ...after, identities }),
    constraintsText({ ...after, constraints }),
    rollupsText({ ...after, rollups }),
    ruleSetsText({ ...after, ruleSets }),
    derivedText({ ...after, derived }, []),
    aggregates.length === 0
      ? ''
      : aggregates
          .map((each) => `Total \`${each.name}\`: the ${aggregateWord(each.kind)}${each.kind === 'COUNT' ? '' : ` of \`${each.expression}\``} over \`${overText(each)}\`${each.unit === undefined ? '' : `, in ${each.unit}`} — computed on every read, never stored.`)
          .join('\n'),
    madeUnique.length === 0
      ? ''
      : `${madeUnique.join(', ')} ${verb(madeUnique.length, 'becomes', 'become')} unique: no two ` +
        'rows may hold the same value, and a write that would is refused naming the row that has it.',
    moved.moved
      ? `The columns are shown in this order, on the table and everywhere else, and no row changes: ` +
        `${after.columns.map((column) => `\`${column.name}\``).join(', ')}.`
      : '',
    moved.naming === undefined
      ? ''
      : moved.naming.now === undefined
        ? `No text column is left to call its rows by, so a link to one shows the row's id.`
        : `Its rows are called by their \`${moved.naming.now}\` from now on` +
          (moved.naming.was === undefined ? '' : `, not their \`${moved.naming.was}\``) +
          ' — the first text column is what a link to one shows, and what heads its row in a text document.',
  )
}

export const extendFormatTool: PluginTool = {
  definition: {
    name: 'extend_format',
    title: 'Change a format',
    description:
      'Change a format this document **already** declares, as its table does: add `columns`, ' +
      '`claims`, `computed` columns, `unique`, `constraints`, `rollups` and `aggregates` as ' +
      '`declare_format` takes them; `rename`, `change` or `remove` what it has; `order` the columns. ' +
      'A rename keeps its values. Refused, naming the rows: a `required` column on rows, removing ' +
      'a column holding values, a list the rows do not fit, a type or unit change over values. ' +
      'Writes nothing until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The format to change, by name.'),
        columns: {
          type: 'array',
          description: `The new columns, after the ones it has. Up to ${String(COLUMNS_MAX)}. ${typeBriefing()}`,
          items: { type: 'object', additionalProperties: true },
        },
        claims: {
          type: 'array',
          description:
            'New claims, each with a `name`, an `expression` with one `=`, an optional ' +
            '`tolerance` and a `note` — as `declare_format` takes them.',
          items: { type: 'object', additionalProperties: true },
        },
        unique: {
          type: 'array',
          description:
            'Columns it already has that should become unique — refused, naming the repeated ' +
            'values, while two rows share one.',
          items: { type: 'string' },
        },
        constraints: {
          type: 'array',
          description:
            'New row constraints, each `{ rule, note }` as `declare_format` takes them — ' +
            'refused, naming the rows, while any row already breaks one.',
          items: { type: 'object', additionalProperties: true },
        },
        rollups: {
          type: 'array',
          description: 'New rollups, as `declare_format` takes them.',
          items: { type: 'object', additionalProperties: true },
        },
        rule_sets: {
          type: 'array',
          description: 'New rule sets.',
          items: { type: 'object', additionalProperties: true },
        },
        computed: {
          type: 'array',
          description: 'New computed columns, as `declare_format` takes them.',
          items: { type: 'object', additionalProperties: true },
        },
        aggregates: {
          type: 'array',
          description: 'New totals, as `declare_format` takes them. A `count` needs no `works_out`.',
          items: { type: 'object', additionalProperties: true },
        },
        order: {
          type: 'array',
          description: 'Every column, new ones too, once each, in order.',
          items: { type: 'string' },
        },
        rename: {
          type: 'object',
          description: '`{ old: new }`.',
          additionalProperties: { type: 'string' },
        },
        change: {
          type: 'array',
          description: 'Columns it has, named, with what changes: `{ name, type: "enum", values }`.',
          items: { type: 'object', additionalProperties: true },
        },
        remove: {
          type: 'array',
          description: 'Names of columns, claims, totals, computed columns, rollups or rule sets.',
          items: { type: 'string' },
        },
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path', 'format'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const columns = args['columns'] ?? []
    const identities = renamedList(args, 'claims', 'identities') ?? []
    const unique = args['unique'] ?? []
    const constraints = args['constraints'] ?? []
    const rollups = args['rollups'] ?? []
    const ruleSets = args['rule_sets'] ?? []
    const derived = renamedList(args, 'computed', 'derived') ?? []
    const aggregates = args['aggregates'] ?? []
    const order = args['order']
    const rename = args['rename'] ?? {}
    const change = args['change'] ?? []
    const remove = args['remove'] ?? []
    if (
      typeof rename !== 'object' ||
      rename === null ||
      Array.isArray(rename) ||
      Object.values(rename).some((each) => typeof each !== 'string' || each.trim() === '')
    ) {
      throw new ToolInputError('`rename` maps each old column name to its new one: `{ "price": "cost" }`.')
    }
    if (!Array.isArray(change) || !Array.isArray(remove) || remove.some((each) => typeof each !== 'string')) {
      throw new ToolInputError('`change` is a list of column objects and `remove` a list of names.')
    }
    const renames = new Map(
      Object.entries(rename as Record<string, string>).map(([from, to]) => [to.trim(), from.trim()]),
    )
    if (
      order !== undefined &&
      (!Array.isArray(order) || order.some((each) => typeof each !== 'string'))
    ) {
      throw new ToolInputError('`order` is a list of column names, every one the format has.')
    }
    if (
      !Array.isArray(columns) ||
      !Array.isArray(identities) ||
      !Array.isArray(unique) ||
      !Array.isArray(constraints) ||
      !Array.isArray(rollups) ||
      !Array.isArray(ruleSets) ||
      !Array.isArray(derived) ||
      !Array.isArray(aggregates)
    ) {
      throw new ToolInputError(
        '`columns`, `claims`, `unique`, `constraints`, `rollups`, `rule_sets`, `computed` and `aggregates` are lists.',
      )
    }
    if (unique.some((each) => typeof each !== 'string')) {
      throw new ToolInputError('`unique` is a list of column names.')
    }
    if (
      columns.length === 0 &&
      identities.length === 0 &&
      unique.length === 0 &&
      constraints.length === 0 &&
      rollups.length === 0 &&
      ruleSets.length === 0 &&
      derived.length === 0 &&
      aggregates.length === 0 &&
      order === undefined &&
      renames.size === 0 &&
      change.length === 0 &&
      remove.length === 0
    ) {
      throw new ToolInputError('There is nothing to change: give what to add, `rename`, `change`, `remove` or `order`.')
    }
    if (
      columns.length > COLUMNS_MAX ||
      identities.length > COLUMNS_MAX ||
      constraints.length > COLUMNS_MAX ||
      rollups.length > COLUMNS_MAX ||
      ruleSets.length > COLUMNS_MAX ||
      derived.length > COLUMNS_MAX ||
      aggregates.length > COLUMNS_MAX
    ) {
      throw new ToolInputError(`This takes at most ${String(COLUMNS_MAX)} of each in one call.`)
    }
    return mutatingCall(
      requireString(args, 'path'),
      args['commit'] === true,
      extendMutation(
        requireString(args, 'format'),
        columns,
        identities,
        unique as string[],
        constraints,
        rollups,
        ruleSets,
        order as string[] | undefined,
        derived,
        aggregates,
        { renames, changes: change, removals: (remove as string[]).map((each) => each.trim()) },
      ),
    )
  },
}

// --- delete_format ----------------------------------------------------------

/**
 * **Take a format away** — M24 U3, D-254. The widest destructive act the engine
 * has, and D-251 left open whether a conversation may do it at all. It may, on
 * the terms the screen already sets: **refused while another format links to it
 * or folds it** (`formatsPointingAt`, the screen's own guard — nothing here is
 * removed on somebody's behalf), a dry run that says how many rows go with it,
 * and the backup every commit takes. Refusing it outright would leave a
 * conversation that made a format by mistake unable to undo it, which is the
 * more dangerous half on its own — the argument `supersede_reading` was built on.
 */
interface DeleteFormatPlan {
  readonly declaration: FormatDeclaration | undefined
  readonly rows: number
  readonly blocked: string | undefined
}

function deleteFormatMutation(name: string): Mutation<DeleteFormatPlan> {
  return {
    copyBefore: (plan) => ({ what: `removing ${name}`, rows: plan.rows }),
    refuses: (plan) => plan.blocked !== undefined,

    plan: (document) => {
      const nothing = (blocked: string): DeleteFormatPlan => ({
        declaration: undefined,
        rows: 0,
        blocked,
      })
      const resolved = resolve(document, name)
      if ('refusal' in resolved) return nothing(resolved.refusal)
      const declaration = resolved.declaration
      const owned = deleteFormatRefusal(declaration)
      if (owned !== undefined) return nothing(owned)

      const referrers = formatsPointingAt(document.db, declaration.name)
      if (referrers.length > 0) {
        return nothing(
          `\`${declaration.name}\` cannot go while ${referrers.map((each) => `\`${each}\``).join(', ')} ` +
            `${verb(referrers.length, 'refers', 'refer')} to it — a link would be left naming rows ` +
            'that are not there, and an aggregate folding a table that is gone. **Nothing was ' +
            'written.** Nothing in this document is removed on somebody’s behalf: take the link ' +
            'or the aggregate out first — `extend_format` `remove`, the link once its cells are ' +
            'emptied — or remove those formats.',
        )
      }
      return { declaration, rows: rowCountOf(document.db, declaration), blocked: undefined }
    },

    describe: (plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      const declaration = plan.declaration
      if (declaration === undefined) return 'No declaration resolved.'
      return (
        `Would remove **${declaration.title}** (\`${declaration.name}\`): its declaration, the ` +
        `table \`${tableNameFor(declaration)}\` and **${plural(plan.rows, 'row')}** in it, and the ` +
        'record of which files wrote them. Nothing else in the document refers to it. A copy of ' +
        'the document is taken before the write, and that copy is the only way back.'
      )
    },

    apply: (document, plan) => {
      if (plan.blocked !== undefined) return plan.blocked
      const declaration = plan.declaration
      if (declaration === undefined) return 'No declaration resolved.'
      deleteFormat(document.db, declaration.name)
      return `**${declaration.title}** is gone, with ${plural(plan.rows, 'row')}.`
    },
  }
}

export const deleteFormatTool: PluginTool = {
  definition: {
    name: 'delete_format',
    title: 'Remove a format and every row in it',
    description:
      'Remove a declared format: its declaration, its table and **every row in it**. Refused ' +
      'while another format links to it or folds its rows. The dry run says how many rows go; ' +
      'show that to the user, and call again with `commit: true` only on a plain yes. To remove ' +
      'some rows, use `delete_format_rows` instead.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        format: stringProp('The format to remove, by name.'),
        commit: booleanProp('Remove it. Omit or false for the dry run.'),
      },
      required: ['path', 'format'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) =>
    mutatingCall(
      requireString(args, 'path'),
      args['commit'] === true,
      deleteFormatMutation(requireString(args, 'format')),
    ),
}

// --- record_units -----------------------------------------------------------

/**
 * How many units one call takes. The same ceiling the column batches use, and
 * for the same reason: a list-taking tool that took one at a time would be a
 * round trip per unit, and round trips are the bill.
 */
const UNITS_MAX = 64

interface UnitPlan {
  readonly adding: readonly UnitRow[]
  readonly correcting: readonly { readonly was: UnitRow; readonly now: UnitRow }[]
  /** The document's currency, when the call chooses or changes it (M29 F3, D-344). */
  readonly currency: { readonly was: string | undefined; readonly now: string } | undefined
  readonly refusals: readonly Refused[]
}

/**
 * The word a caller used for a dimension, if it is one this build has.
 *
 * Closed, and handed to a model as an `enum` for the reason every vocabulary in
 * this app is (D-114): a model asked to use an app's vocabulary unaided invents
 * members of it. **Unlike the four reading vocabularies this one is not rows** —
 * a dimension is a thing the engine knows how to be, and a seventh would be
 * code rather than data.
 */
function dimensionOf(offered: unknown): Dimension | undefined {
  return (DIMENSIONS as readonly string[]).includes(String(offered))
    ? (offered as Dimension)
    : undefined
}

function unitMutation(offered: readonly Record<string, unknown>[], currency?: string | undefined): Mutation<UnitPlan> {
  return {
    // Whole or not at all, so a refused batch takes no copy of the document to
    // explain that nothing happened (D-217).
    refuses: (plan) => plan.refusals.length > 0,

    plan: (document) => {
      const held = listUnits(document.db)
      const adding: UnitRow[] = []
      const correcting: { was: UnitRow; now: UnitRow }[] = []
      const refusals: Refused[] = []

      offered.forEach((one, index) => {
        const symbol = typeof one['symbol'] === 'string' ? one['symbol'] : ''
        const named = symbol === '' ? 'This entry' : symbol
        const perBase = one['per_base']
        const note = typeof one['note'] === 'string' ? one['note'] : ''
        if (typeof perBase !== 'number') {
          refusals.push({
            index,
            reason: `${named} needs \`per_base\` — how many of the dimension's base unit one of them is.`,
          })
          return
        }

        const was = held.find((each) => each.symbol === symbol)
        if (was !== undefined) {
          // **A correction is a factor and a note and nothing else.** A `tbsp`
          // that became a mass would re-mean every identity that ever converted
          // through it — every figure kept, every figure wrong by a factor, and
          // nothing recording that the meaning moved. That is the reconciler's
          // `UNIT_CHANGED` refusal (D-214) met again in another table.
          const asked = one['dimension']
          if (asked !== undefined && asked !== was.dimension) {
            refusals.push({
              index,
              reason: `${symbol} already measures ${word(was.dimension)} in this document. Changing what a unit measures would re-mean every figure ever converted through it — add a new symbol instead.`,
            })
            return
          }
          const now: UnitRow = { ...was, perBase, note }
          const rejection = unitRejection(now)
          if (rejection !== undefined) refusals.push({ index, reason: rejection })
          else correcting.push({ was, now })
          return
        }

        const dimension = dimensionOf(one['dimension'])
        if (dimension === undefined) {
          refusals.push({
            index,
            reason: `${named} is not in this document yet, so it needs a \`dimension\` — one of ${DIMENSIONS.join(', ')}.`,
          })
          return
        }
        const now: UnitRow = { symbol, dimension, perBase, origin: 'USER', note }
        const rejection = unitRejection(now)
        if (rejection !== undefined) refusals.push({ index, reason: rejection })
        else if (adding.some((each) => each.symbol === symbol)) {
          refusals.push({ index, reason: `${symbol} is in this call twice.` })
        } else adding.push(now)
      })

      // The document's currency, beside its units (M29 F3, D-344).
      let chosen: UnitPlan['currency']
      if (currency !== undefined) {
        const code = parseCurrency(currency)
        if (!code.ok) refusals.push({ index: offered.length, reason: code.error })
        else chosen = { was: documentCurrency(document.db), now: code.value }
      }

      return { adding, correcting, currency: chosen, refusals }
    },

    describe: (plan) => {
      if (plan.refusals.length > 0) return refusalText(plan.refusals, 'unit')
      return paragraphs(
        `${plural(plan.adding.length, 'unit')} added and ${plural(plan.correcting.length, 'unit')} corrected.`,
        plan.currency === undefined ? undefined : currencyChange(plan.currency),
        plan.adding.length === 0
          ? undefined
          : section(
              'Added',
              table(
                ['Unit', 'Measures', 'How many of the base', 'Note'],
                plan.adding.map((each) => [
                  each.symbol,
                  word(each.dimension),
                  String(each.perBase),
                  each.note,
                ]),
              ),
            ),
        plan.correcting.length === 0
          ? undefined
          : section(
              'Corrected',
              table(
                ['Unit', 'Was', 'Becomes', 'Note'],
                plan.correcting.map((each) => [
                  each.was.symbol,
                  String(each.was.perBase),
                  String(each.now.perBase),
                  each.now.note,
                ]),
              ),
            ),
        plan.correcting.length === 0
          ? undefined
          : '**Correcting a factor re-judges every claim that converts through it.** No ' +
            'stored figure moves and none is rewritten — a verdict is computed on read, never ' +
            'stored — so what changes is which rows prove and which fail, from the ' +
            'next read onwards.',
      )
    },

    apply: (document, plan) => {
      // **Re-checked here and not only in `describe`.** A commit runs `apply`
      // whatever `refuses` said — the gate decides whether a backup is taken,
      // not whether the work happens — so a mutation that trusted the gate
      // would write half a batch and report the other half as fine. That is
      // D-138 in the write path, and it is the same guard every other mutation
      // in this file makes.
      if (plan.refusals.length > 0) return refusalText(plan.refusals, 'unit')

      const now = Date.now()
      for (const unit of plan.adding) {
        addUnit(
          document.db,
          {
            symbol: unit.symbol,
            dimension: unit.dimension,
            perBase: unit.perBase,
            note: unit.note,
          },
          now,
        )
      }
      for (const each of plan.correcting) {
        correctUnit(document.db, each.now.symbol, each.now.perBase, each.now.note)
      }
      if (plan.currency !== undefined) setDocumentCurrency(document.db, plan.currency.now)
      return paragraphs(
        `${plural(plan.adding.length, 'unit')} added and ${plural(plan.correcting.length, 'unit')} corrected.`,
        plan.currency === undefined ? undefined : currencyChange(plan.currency),
      )
    },
  }
}

/** A currency chosen or changed, in a sentence. */
function currencyChange(change: NonNullable<UnitPlan['currency']>): string {
  if (change.was === change.now) return `The document's currency is already ${change.now}.`
  return change.was === undefined
    ? `The document's currency becomes ${change.now}: a new amount on a screen starts in it.`
    : `The document's currency moves from ${change.was} to ${change.now}. No amount already kept changes.`
}

/**
 * The write half of the unit table (M19 U4a, D-223).
 *
 * **This tool is why the table is rows rather than an array in the build.** A
 * vocabulary compiled into the binary cannot name a thing a real document
 * measures in, and a missing word should never wait for a release (D-208,
 * D-212). Somebody who buys bread in slices, doses in IU or keeps a 20 ml
 * tablespoon should not be waiting for one.
 */
export const recordUnitsTool: PluginTool = {
  definition: {
    name: 'record_units',
    title: 'Add or correct a unit of measure, or set the currency',
    description:
      'Teach this document a unit it does not know — `slice`, `IU`, a tablespoon that is 20 ml ' +
      'in this kitchen. A unit is what a declared column says its figures are in and what a ' +
      "claim's `in` converts into, so a conversion the document cannot make is a conversion " +
      'this fixes. **The engine converts inside a dimension and never across one**: grams to ' +
      'kilograms is arithmetic, millilitres to grams needs a density, and a density is a column ' +
      'of the format rather than a unit. A symbol the document already has is corrected — its ' +
      'factor and its note, never what it measures. `currency` sets the document’s currency — ' +
      'what a new amount on a screen starts in; a row still names its own. `formats` lists both. ' +
      'Returns the diff and writes nothing until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        units: {
          type: 'array',
          description: `One object per unit. Up to ${String(UNITS_MAX)} in a call; none when only \`currency\` is set.`,
          items: {
            type: 'object',
            properties: {
              symbol: stringProp(
                'As it is written on a column and after an `in` — `slice`, `µg`, `tbsp`. ' +
                  'Letters and digits, no spaces, no arithmetic. Case matters: mg is not Mg.',
              ),
              dimension: {
                type: 'string',
                enum: [...DIMENSIONS],
                description:
                  'What it measures. Needed for a unit this document has not got, and refused ' +
                  'for one it has.',
              },
              per_base: numberProp(
                "How many of that dimension's base unit one of these is — g, ml, mm, s, kJ, " +
                  'each. A kilogram is 1000. Above zero.',
              ),
              note: stringProp(
                'What it is, or which convention it follows. A tablespoon is 15 ml here and ' +
                  '20 ml in Australia, and this is what tells the next reader which.',
              ),
            },
            required: ['symbol', 'per_base'],
            additionalProperties: false,
          },
        },
        currency: stringProp('The document’s currency, a three-letter code: `ILS`.'),
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const currency = typeof args['currency'] === 'string' ? args['currency'] : undefined
    const units = currency !== undefined && args['units'] === undefined ? [] : batchOf(args, 'units', 'unit')
    if (units.length > UNITS_MAX) {
      throw new ToolInputError(
        `${String(units.length)} units is more than the ${String(UNITS_MAX)} this takes in one call.`,
      )
    }
    return mutatingCall(path, args['commit'] === true, unitMutation(units, currency))
  },
}
