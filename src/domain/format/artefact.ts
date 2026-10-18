/**
 * The artefact: **a format declaration as something a model can emit and a
 * person can read and diff** (D-215, M19 U1 clause (a)).
 *
 * ## Why this half exists at all
 *
 * M19 said how a format *compiles* and how its tools are *generated*, and
 * nothing at all about how a format comes into existence. Under D-215's dial
 * that is a hole rather than a detail: prior structure is a dial, not two
 * adapters, and **at the zero-structure end there is no data yet, only intent —
 * so eliciting the format is arrow 1.** A declaration nobody can produce is a
 * table nobody can have.
 *
 * ## Why it is markdown, and why the prose survives
 *
 * The evidence for this whole design is a vault of markdown notes
 * built by hand in three days, and `Ingredients/Pasta.md` is its specification.
 * That note is frontmatter *and argument*: the twenty-five typed fields are half
 * of it, and the other half is *"these are dry-weight values, which is what
 * recipes measure"* — the sentence that stops the dish being understated by
 * half. An artefact that kept the columns and dropped that would be a worse
 * document than the one it replaces.
 *
 * So: frontmatter for what the format is, a pipe table for the columns, and
 * every other line kept verbatim as the format's notes. The shape is chosen
 * against three readers and no other criterion.
 *
 * - **A model emits it.** Markdown with a table is the thing a model produces
 *   most reliably without a grammar, and the elicitation happens wherever the
 *   user already talks to a model — by the privacy cut this half carries no
 *   personal figures, so it may use the best model available with nothing at
 *   stake (D-215). The deliverable is therefore *a declaration the app can
 *   import*, not a screen.
 * - **A person reads it.** Twenty-five columns as a table is legible; the same
 *   thing as JSON is not.
 * - **A person diffs it.** Which is why nothing here is padded to align: a
 *   column renamed from `fat_g` to `total_fat_g` would otherwise re-space every
 *   row in the table and the diff would show twenty-five changed lines for one
 *   changed word.
 *
 * ## What it is not
 *
 * Not a general markdown parser, and not a YAML one. The frontmatter is three
 * known keys read as plain strings, and the table is found by its header. A
 * dependency would buy generality this file does not want — every input it
 * accepts has to be something `write` could have produced, because round-tripping
 * is what makes "read and diff" mean anything.
 */

import { err, ok, type Result } from '@/core/result.ts'
import {
  DECLARATION_LANGUAGE,
  declarationRejection,
  type ColumnDeclaration,
  type ColumnType,
  type FormatDeclaration,
  COLUMN_TYPES,
} from './declaration.ts'
import {
  aggregate,
  AGGREGATE_KINDS,
  overText,
  parseFilter,
  type AggregateDeclaration,
  type AggregateFilter,
} from './aggregate.ts'
import { derived, type DerivedDeclaration } from './derived.ts'
import { constraintText, parseConstraint, type RowConstraint } from './constraint.ts'
import { parseRollup, rollupText, type RollupDeclaration } from './rollup.ts'
import { parseRuleSet, ruleSetText, type RuleSetDeclaration } from './rule.ts'
import { foundByText, parseFoundBy, type FoundBy } from './foundBy.ts'
import { identity, readTolerance, toleranceText, type IdentityDeclaration } from './identity.ts'
import { SEEDED_UNITS, type UnitTable } from './unit.ts'

/** What the file is called, by convention — `ingredient.format.md`. */
export const ARTEFACT_EXTENSION = '.format.md'

/**
 * The columns table's header, and the order the cells are written in.
 *
 * Read positionally rather than by name, and the header is checked against this
 * exactly. A table whose columns were reordered would still parse "correctly"
 * under a by-name reader and mean something else entirely in a diff, which is
 * the failure this ordering avoids by refusing.
 */
const TABLE_HEADER = [
  'column',
  'type',
  'points at',
  'unit',
  'per',
  'required',
  'values',
  'min',
  'max',
  'note',
] as const

/**
 * The columns table with `unique` beside `required` (M24 U4, D-255) — the two
 * are the constraints a column carries on its own.
 *
 * **Written only by a declaration with a unique column in it**, and the current
 * header otherwise. A document stored as text (D-246) is this file per format,
 * so a new header on every format would be a diff on every format in every
 * document the first time this build saved it, over a fact none of them had.
 */
const TABLE_HEADER_V5 = [
  'column',
  'type',
  'points at',
  'unit',
  'per',
  'required',
  'unique',
  'values',
  'min',
  'max',
  'note',
] as const

/**
 * The columns table with a `scale` beside `per` (M24 U6, D-257) — the places a
 * `decimal` keeps, and empty for every other type.
 *
 * **Written only by a declaration with a decimal in it**, for `TABLE_HEADER_V5`'s
 * reason: a new header on every format would be a diff on every format of every
 * text document, over a fact none of them had. It carries `unique` too, so a
 * format with both needs one header rather than a fourth.
 */
const TABLE_HEADER_V6 = [
  'column',
  'type',
  'points at',
  'unit',
  'per',
  'scale',
  'required',
  'unique',
  'values',
  'min',
  'max',
  'note',
] as const

/**
 * The columns table as language 3 wrote it, before a ratio had a second half.
 *
 * `per` sits beside `unit` in the current header because the two are one fact —
 * *this column is `g` per `ml`* — and a reader who found them at opposite ends
 * of a row would have to be told they belong together (U4c, D-225).
 */
const TABLE_HEADER_V3 = [
  'column',
  'type',
  'points at',
  'unit',
  'required',
  'values',
  'min',
  'max',
  'note',
] as const

/**
 * The columns table as language 1 and 2 wrote it, before a link existed.
 *
 * **Read and never written** (U4b, D-224), and now one of two that are. Every
 * `.format.md` written before it is eight cells wide, and a reader that refused
 * them would make the language integer a lie: a declaration in an *older*
 * language is exactly the case a build is supposed to handle, and the only one
 * where it costs nothing. The writer emits ten, so a file that has been through
 * the app once is current.
 */
const TABLE_HEADER_V2 = ['column', 'type', 'unit', 'required', 'values', 'min', 'max', 'note'] as const

/** Between a link's target and how it is found: `paycheck, found by date in period`. */
const FOUND_BY_SEPARATOR = ', found by '

/** Which of the three the columns table was written in. */
type TableShape = 'V2' | 'V3' | 'V4' | 'V5' | 'V6'

/**
 * The identities table (U3, D-222), read the same way and for the same reason.
 *
 * A second table rather than more columns on the first: an identity is not a
 * column, and a file where the two shared a row would be unreadable by the
 * person this artefact exists for. `holds` carries the equation exactly as it
 * was typed — this file never rewrites somebody's arithmetic into a canonical
 * form, because a diff of two versions of a format is the whole point of it.
 */
const IDENTITY_HEADER = ['claim', 'holds', 'tolerance', 'note'] as const

/**
 * **The same table under the word it had before M33 U3a.** An identity is a
 * *claim* wherever a person or a model meets it, so that is what is written;
 * a file written before still reads, because accepting the old header is one
 * entry in a list. Nothing writes it.
 */
const IDENTITY_HEADER_BEFORE = ['identity', 'holds', 'tolerance', 'note'] as const

/**
 * The aggregates table (U4b, D-224) — a third table, for the same reason there
 * is a second.
 *
 * An aggregate is not a column and not an identity: it is a figure worked out
 * from rows that are not in this file at all. `over` is written as
 * `format.column` because that is one fact — *the rows of `recipe_line` whose
 * `recipe` is this row* — and splitting it across two cells would let a person
 * edit half of it.
 *
 * **A filter is part of that fact too** (M24 U8, D-260), so it goes in the same
 * cell: `paycheck_line.paycheck where deduction_type.reduces_net is true`. A
 * seventh cell would have made every file written before it a file of the wrong
 * width, and *which rows* is one answer, not two.
 */
const AGGREGATE_HEADER = ['aggregate', 'of', 'over', 'works out', 'unit', 'note'] as const

/**
 * The constraints table (M24 U7, D-259) — a fourth, and the smallest: the rule
 * as its one sentence, and why. **Written only by a format that has one**, for
 * the reason the `unique` cell is: a text document is this file per format, and
 * an empty table would be a diff on every one of them.
 */
const CONSTRAINT_HEADER = ['constraint', 'note'] as const

/**
 * The rollups table (M25 E2, D-271) — a fifth: a name, the sentence, and why.
 * The sentence is one cell for the reason a constraint's is — `sum of amount
 * by month of charge_date and category where direction is OUTFLOW` is one fact
 * — and the name is its own, because a view is asked for by it.
 */
const ROLLUP_HEADER = ['rollup', 'works out', 'note'] as const

/**
 * The rule sets table (M25 E4, D-273) — a sixth: a name, the sentence, and why,
 * on the format whose rows are the rules.
 */
const RULE_SET_HEADER = ['rule set', 'sets', 'note'] as const

/**
 * The derived columns table (M29 U3b, D-334) — a seventh: a name, the
 * expression exactly as typed, and why. Written only by a format that has one.
 */
const DERIVED_HEADER = ['derived', 'works out', 'note'] as const

/** What the frontmatter says when a format was declared to make no claim. */
const NO_CHECKS = 'none'

/**
 * The frontmatter key that says it: `claims: none` since M33 U3a, and the
 * `checks: none` written before still read.
 */
const NO_CHECKS_KEY = 'claims'
const NO_CHECKS_KEY_BEFORE = 'checks'

/**
 * A declaration as text.
 *
 * Deterministic: the same declaration always writes the same bytes, which is
 * what lets a diff between two versions of a format be a diff of two files.
 */
export function write(declaration: FormatDeclaration): string {
  const withScale = declaration.columns.some((column) => column.scale !== undefined)
  const withUnique = withScale || declaration.columns.some((column) => column.unique)
  const header = withScale ? TABLE_HEADER_V6 : withUnique ? TABLE_HEADER_V5 : TABLE_HEADER
  const rows = declaration.columns.map((column) =>
    row([
      column.name,
      column.type,
      // A link found by a date says so in the cell that names what it points
      // at (D-350) — one fact about the link, and no new header on every format.
      column.foundBy === undefined
        ? (column.target ?? '')
        : `${column.target ?? ''}${FOUND_BY_SEPARATOR}${foundByText(column.foundBy)}`,
      column.unit ?? '',
      column.per ?? '',
      ...(withScale ? [column.scale === undefined ? '' : String(column.scale)] : []),
      column.required ? 'yes' : 'no',
      ...(withUnique ? [column.unique ? 'yes' : 'no'] : []),
      column.values.join(', '),
      column.minimum === undefined ? '' : String(column.minimum),
      column.maximum === undefined ? '' : String(column.maximum),
      column.note,
    ]),
  )

  const identities = declaration.identities.map((each) =>
    row([each.name, each.expression, toleranceText(each.tolerance), each.note]),
  )

  const aggregates = declaration.aggregates.map((each) =>
    row([
      each.name,
      each.kind.toLowerCase(),
      overText(each),
      each.expression,
      each.unit ?? '',
      each.note,
    ]),
  )

  const constraints = (declaration.constraints ?? []).map((each) =>
    row([constraintText(each), each.note]),
  )

  const rollups = (declaration.rollups ?? []).map((each) =>
    row([each.name, rollupText(each), each.note]),
  )

  const ruleSets = (declaration.ruleSets ?? []).map((each) =>
    row([each.name, ruleSetText(each), each.note]),
  )

  const derivedRows = (declaration.derived ?? []).map((each) =>
    row([each.name, each.expression, each.note]),
  )

  const notes = declaration.notes.trim()
  return [
    '---',
    `format: ${declaration.name}`,
    `title: ${declaration.title}`,
    `language: ${declaration.language}`,
    // Written only when it is true, and then it is the person's own sentence
    // rather than a default: *nothing about one of these has to add up* (H3).
    ...(declaration.nothingMustHold ? [`${NO_CHECKS_KEY}: ${NO_CHECKS}`] : []),
    // Which pack owns it (D-269): its name, where its rows are written instead,
    // and the columns that are the pack's — so a column somebody added is
    // theirs in the text as it is in the file.
    ...(declaration.owner === undefined
      ? []
      : [
          `pack: ${declaration.owner.pack}`,
          `written: ${declaration.owner.written}`,
          `pack columns: ${declaration.owner.columns.join(', ')}`,
        ]),
    '---',
    '',
    ...(notes === '' ? [] : [notes, '']),
    row(header),
    row(header.map(() => '---')),
    ...rows,
    ...(identities.length === 0
      ? []
      : ['', row(IDENTITY_HEADER), row(IDENTITY_HEADER.map(() => '---')), ...identities]),
    ...(aggregates.length === 0
      ? []
      : ['', row(AGGREGATE_HEADER), row(AGGREGATE_HEADER.map(() => '---')), ...aggregates]),
    ...(constraints.length === 0
      ? []
      : ['', row(CONSTRAINT_HEADER), row(CONSTRAINT_HEADER.map(() => '---')), ...constraints]),
    ...(rollups.length === 0
      ? []
      : ['', row(ROLLUP_HEADER), row(ROLLUP_HEADER.map(() => '---')), ...rollups]),
    ...(ruleSets.length === 0
      ? []
      : ['', row(RULE_SET_HEADER), row(RULE_SET_HEADER.map(() => '---')), ...ruleSets]),
    ...(derivedRows.length === 0
      ? []
      : ['', row(DERIVED_HEADER), row(DERIVED_HEADER.map(() => '---')), ...derivedRows]),
    '',
  ].join('\n')
}

/**
 * Text back into a declaration, or one sentence saying why not.
 *
 * **One sentence, naming the line.** These are read by a person editing a file
 * and by a model being told its last attempt was wrong, and neither can ask a
 * follow-up question. A list of six problems is no more useful to either than
 * the first one is.
 *
 * `neighbours` is every format the document already has, **this one included**:
 * a file declaring `ingredient` when the document has `ingredient` is a revision
 * of it rather than a duplicate, so it is filtered here and no caller has to
 * remember to — the same rule `draftProblems` keeps for the editor.
 *
 * It was not a parameter until M20 U6, and the missing argument was a parity
 * break rather than an omission (D-234): a conversation can write a declaration
 * carrying a `link` and this reader refused every one of them, because a link is
 * checked against the format it points at and the empty list it was given held
 * none. **The two halves disagreed about what a declaration is** — which is the
 * whole thing the audit was opened to find.
 */
export function read(
  text: string,
  units: UnitTable = SEEDED_UNITS,
  neighbours: readonly FormatDeclaration[] = [],
): Result<FormatDeclaration, string> {
  const parsed = parse(text)
  if (!parsed.ok) return parsed
  const rejection = declarationRejection(
    parsed.value,
    neighbours.filter((each) => each.name !== parsed.value.name),
    units,
  )
  return rejection === undefined ? parsed : err(rejection)
}

/**
 * The text's shape and nothing else: a declaration as written, **not yet held
 * to its own rules or to its neighbours'**.
 *
 * Split from `read` by M29 F1 (D-336) for a reader holding several files at
 * once — a document — which must have every declaration in hand before it can
 * check any of them, because a link and an aggregate point opposite ways
 * (`shift.person` names `person`, `person.total_hours` folds `shift`). Nothing
 * may use what this returns without `declarationRejection` having passed it.
 */
export function parse(text: string): Result<FormatDeclaration, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  const front = readFrontmatter(lines)
  if (!front.ok) return front

  const found = findTables(lines, front.value.endsAt)
  if (!found.ok) return found

  // Ten cells if the file is current, nine before U4c and eight before U4b. An
  // older file is read as what it is rather than refused for a column that did
  // not exist when it was written, which is the one case a language integer is
  // supposed to make free.
  const table =
    found.value.find((each) => each.header === TABLE_HEADER_V6) ??
    found.value.find((each) => each.header === TABLE_HEADER_V5) ??
    found.value.find((each) => each.header === TABLE_HEADER) ??
    found.value.find((each) => each.header === TABLE_HEADER_V3) ??
    found.value.find((each) => each.header === TABLE_HEADER_V2)
  if (table === undefined) {
    return err(
      `No columns table found. A declaration has a table headed ${TABLE_HEADER.join(' | ')}.`,
    )
  }
  const shape: TableShape =
    table.header === TABLE_HEADER_V6
      ? 'V6'
      : table.header === TABLE_HEADER_V5
      ? 'V5'
      : table.header === TABLE_HEADER
        ? 'V4'
        : table.header === TABLE_HEADER_V3
          ? 'V3'
          : 'V2'

  const columns: ColumnDeclaration[] = []
  for (const parsed of table.rows) {
    const column = readColumn(parsed.cells, parsed.line, shape)
    if (!column.ok) return column
    columns.push(column.value)
  }

  const identities: IdentityDeclaration[] = []
  for (const parsed of found.value.find((each) => each.header === IDENTITY_HEADER || each.header === IDENTITY_HEADER_BEFORE)
    ?.rows ?? []) {
    const read = readIdentity(parsed.cells, parsed.line)
    if (!read.ok) return read
    identities.push(read.value)
  }

  const aggregates: AggregateDeclaration[] = []
  for (const parsed of found.value.find((each) => each.header === AGGREGATE_HEADER)?.rows ?? []) {
    const read = readAggregate(parsed.cells, parsed.line)
    if (!read.ok) return read
    aggregates.push(read.value)
  }

  const constraints: RowConstraint[] = []
  for (const parsed of found.value.find((each) => each.header === CONSTRAINT_HEADER)?.rows ?? []) {
    if (parsed.cells.length !== CONSTRAINT_HEADER.length) {
      return err(
        `Line ${parsed.line} has ${parsed.cells.length} cells; every row of the constraints table needs ${CONSTRAINT_HEADER.length} — ${CONSTRAINT_HEADER.join(' | ')}.`,
      )
    }
    const read = parseConstraint(parsed.cells[0] ?? '', parsed.cells[1] ?? '')
    if (!read.ok) return err(`Line ${parsed.line}: ${read.error}`)
    constraints.push(read.value)
  }

  const rollups: RollupDeclaration[] = []
  for (const parsed of found.value.find((each) => each.header === ROLLUP_HEADER)?.rows ?? []) {
    if (parsed.cells.length !== ROLLUP_HEADER.length) {
      return err(
        `Line ${parsed.line} has ${parsed.cells.length} cells; every row of the rollups table needs ${ROLLUP_HEADER.length} — ${ROLLUP_HEADER.join(' | ')}.`,
      )
    }
    const read = parseRollup(parsed.cells[0] ?? '', parsed.cells[1] ?? '', parsed.cells[2] ?? '')
    if (!read.ok) return err(`Line ${parsed.line}: ${read.error}`)
    rollups.push(read.value)
  }

  const ruleSets: RuleSetDeclaration[] = []
  for (const parsed of found.value.find((each) => each.header === RULE_SET_HEADER)?.rows ?? []) {
    if (parsed.cells.length !== RULE_SET_HEADER.length) {
      return err(
        `Line ${parsed.line} has ${parsed.cells.length} cells; every row of the rule sets table needs ${RULE_SET_HEADER.length} — ${RULE_SET_HEADER.join(' | ')}.`,
      )
    }
    const read = parseRuleSet(parsed.cells[0] ?? '', parsed.cells[1] ?? '', parsed.cells[2] ?? '')
    if (!read.ok) return err(`Line ${parsed.line}: ${read.error}`)
    ruleSets.push(read.value)
  }

  const derivedList: DerivedDeclaration[] = []
  for (const parsed of found.value.find((each) => each.header === DERIVED_HEADER)?.rows ?? []) {
    if (parsed.cells.length !== DERIVED_HEADER.length) {
      return err(
        `Line ${parsed.line} has ${parsed.cells.length} cells; every row of the computed columns table needs ${DERIVED_HEADER.length} — ${DERIVED_HEADER.join(' | ')}.`,
      )
    }
    derivedList.push(derived(parsed.cells[0] ?? '', parsed.cells[1] ?? '', parsed.cells[2] ?? ''))
  }

  const notes = lines
    .slice(front.value.endsAt, table.startsAt)
    .join('\n')
    .trim()

  const declaration: FormatDeclaration = {
    language: front.value.language,
    name: front.value.name,
    title: front.value.title,
    notes,
    columns,
    identities,
    aggregates,
    ...(constraints.length === 0 ? {} : { constraints }),
    ...(rollups.length === 0 ? {} : { rollups }),
    ...(ruleSets.length === 0 ? {} : { ruleSets }),
    ...(derivedList.length === 0 ? {} : { derived: derivedList }),
    ...(front.value.pack === undefined
      ? {}
      : {
          owner: {
            pack: front.value.pack.name,
            written: front.value.pack.written,
            // A pack's own file names none: every column it declares is its own.
            columns: front.value.pack.columns ?? columns.map((each) => each.name),
          },
        }),
    nothingMustHold: front.value.nothingMustHold,
  }

  return ok(declaration)
}

interface Frontmatter {
  readonly name: string
  readonly title: string
  readonly language: number
  /** `checks: none` — H3's answer, said on purpose. */
  readonly nothingMustHold: boolean
  /** `pack:`, `written:` and `pack columns:` — which pack owns it (D-269). */
  readonly pack:
    | { readonly name: string; readonly written: string; readonly columns: readonly string[] | undefined }
    | undefined
  /** The line after the closing `---`. */
  readonly endsAt: number
}

function readFrontmatter(lines: readonly string[]): Result<Frontmatter, string> {
  if (lines[0]?.trim() !== '---') {
    return err('A declaration starts with a --- line. See the head of any .format.md file.')
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (close === -1) return err('The --- block at the top of the file is never closed.')

  const values = new Map<string, string>()
  for (let index = 1; index < close; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) return err(`Line ${index + 1} of the --- block is not a key: value pair.`)
    values.set(line.slice(0, colon).trim(), unquote(line.slice(colon + 1).trim()))
  }

  const name = values.get('format')
  if (name === undefined) return err('The --- block needs a `format:` naming the format.')
  const title = values.get('title') ?? name
  const languageText = values.get('language')
  if (languageText === undefined) {
    return err(`The --- block needs a \`language:\`. This build writes ${DECLARATION_LANGUAGE}.`)
  }
  const language = Number(languageText)
  if (!Number.isInteger(language)) {
    return err(`\`language: ${languageText}\` is not a whole number.`)
  }

  const checksKey = values.has(NO_CHECKS_KEY) ? NO_CHECKS_KEY : NO_CHECKS_KEY_BEFORE
  const checks = values.get(checksKey)
  if (checks !== undefined && checks.trim().toLowerCase() !== NO_CHECKS) {
    return err(
      `\`${checksKey}: ${checks}\` is not a value this build knows. The only one is \`${NO_CHECKS}\`, which says this format makes no claim; a claim belongs in the ${IDENTITY_HEADER.join(' | ')} table.`,
    )
  }

  const pack = values.get('pack')
  const written = values.get('written')
  const packColumns = values.get('pack columns')
  if (pack === undefined && (written !== undefined || packColumns !== undefined)) {
    return err('`written:` and `pack columns:` say where a pack writes its format, and the --- block names no `pack:`.')
  }
  if (pack !== undefined && (written === undefined || written.trim() === '')) {
    return err(`\`pack: ${pack}\` needs a \`written:\` saying where its rows are written instead.`)
  }

  return ok({
    name,
    title,
    language,
    nothingMustHold: checks !== undefined,
    pack:
      pack === undefined || written === undefined
        ? undefined
        : {
            name: pack,
            written,
            columns:
              packColumns === undefined
                ? undefined
                : packColumns.split(',').map((each) => each.trim()).filter((each) => each !== ''),
          },
    endsAt: close + 1,
  })
}

interface TableRow {
  readonly cells: readonly string[]
  /** 1-based, for the message. */
  readonly line: number
}

interface ParsedTable {
  /** Which of the known headers this one is, so a caller matches rather than guesses. */
  readonly header: readonly string[]
  readonly rows: readonly TableRow[]
  /** The index of the header line, so everything above it is prose. */
  readonly startsAt: number
  /** The line after the last row, so a second table can be looked for below. */
  readonly endsAt: number
}

/**
 * The next table with this header, or nothing at all.
 *
 * `undefined` rather than an error when the file has no such table, because the
 * identities table is **optional** and its absence is H3's other answer rather
 * than a malformed file. A table that *is* there with the wrong header is still
 * an error: the cells are read positionally, so a reordered header means
 * something else entirely and a by-name reader would accept it silently.
 */
/**
 * Every table in the file, each matched to the header it is (U4b, D-224).
 *
 * **All of them at once rather than one search per table**, which is what three
 * tables cost. U3's version scanned forward for a named header and refused the
 * first table it met that was not that one, which worked while there were two
 * and could not work with three: looking for the aggregates table would meet
 * the identities table, and looking for the identities table in a file that has
 * none would meet the aggregates table. Order of tables in the file stops
 * mattering, which is also one less thing for a person editing one to get
 * wrong.
 *
 * **The strictness is kept exactly where it was.** A table whose header matches
 * none of the four known ones is still an error naming the line, because that
 * is what catches a columns table somebody reordered — which would otherwise
 * parse "correctly" and mean something else entirely.
 */
function findTables(
  lines: readonly string[],
  from: number,
): Result<readonly ParsedTable[], string> {
  const known = [
    TABLE_HEADER_V6,
    TABLE_HEADER_V5,
    TABLE_HEADER,
    TABLE_HEADER_V3,
    TABLE_HEADER_V2,
    IDENTITY_HEADER,
    IDENTITY_HEADER_BEFORE,
    AGGREGATE_HEADER,
    CONSTRAINT_HEADER,
    ROLLUP_HEADER,
    RULE_SET_HEADER,
    DERIVED_HEADER,
  ]
  const tables: ParsedTable[] = []

  let index = from
  while (index < lines.length) {
    const cells = splitRow(lines[index] ?? '')
    if (cells === undefined) {
      index += 1
      continue
    }
    const header = known.find((each) => sameHeader(cells, each))
    if (header === undefined) {
      return err(
        `The table at line ${index + 1} has the columns ${cells.join(', ')}; a declaration's tables are headed ${TABLE_HEADER.join(' | ')}, ${IDENTITY_HEADER.join(' | ')}, ${AGGREGATE_HEADER.join(' | ')}, ${CONSTRAINT_HEADER.join(' | ')}, ${ROLLUP_HEADER.join(' | ')}, ${RULE_SET_HEADER.join(' | ')}, or ${DERIVED_HEADER.join(' | ')}.`,
      )
    }

    const rows: TableRow[] = []
    let last = index
    for (let row = index + 1; row < lines.length; row += 1) {
      const line = lines[row] ?? ''
      const parsed = splitRow(line)
      // **A blank line ends the table**, which is what every markdown renderer
      // already does and what this reader only started doing when there were
      // two tables to tell apart (U3): the identities table sits below the
      // columns table with a blank line between them, and a reader that skipped
      // blanks swallowed its header as a four-cell column.
      if (parsed === undefined) break
      last = row
      if (parsed.every((cell) => /^:?-{3,}:?$/.test(cell) || cell === '')) continue
      rows.push({ cells: parsed, line: row + 1 })
    }
    if (rows.length === 0) return err(`The table at line ${index + 1} has a header and no rows.`)
    tables.push({ rows, startsAt: index, endsAt: last + 1, header })
    index = last + 1
  }

  return ok(tables)
}

/**
 * One identity's row.
 *
 * Positional like a column's, and the tolerance cell is the one with a shape of
 * its own: `exactly`, `± 2` or `± 2%`, which is what `toleranceText` wrote.
 */
function readIdentity(
  cells: readonly string[],
  line: number,
): Result<IdentityDeclaration, string> {
  if (cells.length !== IDENTITY_HEADER.length) {
    return err(
      `Line ${line} has ${cells.length} cells; every row of the claims table needs ${IDENTITY_HEADER.length} — ${IDENTITY_HEADER.join(' | ')}.`,
    )
  }
  const [name = '', expression = '', tolerance = '', note = ''] = cells
  const read = readTolerance(tolerance)
  if (read === undefined) {
    return err(
      `Line ${line} has a tolerance of \`${tolerance}\`. It is \`exactly\`, \`± 2\` or \`± 2%\`.`,
    )
  }
  return ok(identity(name, expression, { tolerance: read, note }))
}

function readColumn(
  cells: readonly string[],
  line: number,
  shape: TableShape,
): Result<ColumnDeclaration, string> {
  const header =
    shape === 'V6'
      ? TABLE_HEADER_V6
      : shape === 'V5'
      ? TABLE_HEADER_V5
      : shape === 'V4'
        ? TABLE_HEADER
        : shape === 'V3'
          ? TABLE_HEADER_V3
          : TABLE_HEADER_V2
  if (cells.length !== header.length) {
    return err(
      `Line ${line} has ${cells.length} cells; every row of the table needs ${header.length} — ${header.join(' | ')}.`,
    )
  }
  const [name = '', type = ''] = cells
  // Positional, and the two cells that came later are the two that move: a
  // `points at` from U4b and a `per` from U4c. Read from the front in every
  // shape, so a file written by any of the three builds means the same thing.
  const pointsAt = shape === 'V2' ? '' : (cells[2] ?? '')
  const split = pointsAt.indexOf(FOUND_BY_SEPARATOR)
  const target = split === -1 ? pointsAt : pointsAt.slice(0, split).trim()
  let foundBy: FoundBy | undefined
  if (split !== -1) {
    const parsed = parseFoundBy(pointsAt.slice(split + FOUND_BY_SEPARATOR.length))
    if (!parsed.ok) return err(`Line ${line}: ${parsed.error}`)
    foundBy = parsed.value
  }
  const rest = cells.slice(shape === 'V2' ? 2 : 3)
  const unit = rest[0] ?? ''
  const withPer = shape === 'V4' || shape === 'V5' || shape === 'V6'
  const per = withPer ? (rest[1] ?? '') : ''
  const withScale = shape === 'V6'
  const scaleCell = withScale ? (rest[2] ?? '') : ''
  const [required = '', ...after] = rest.slice(withScale ? 3 : withPer ? 2 : 1)
  const withUnique = shape === 'V5' || shape === 'V6'
  const unique = withUnique ? (after[0] ?? '') : 'no'
  const [values = '', min = '', max = '', note = ''] = withUnique ? after.slice(1) : after

  if (!(COLUMN_TYPES as readonly string[]).includes(type)) {
    return err(
      `Line ${line} gives ${name || 'a column'} the type "${type}", which is not one of ${COLUMN_TYPES.join(', ')}.`,
    )
  }

  const requiredFlag = readFlag(required)
  if (requiredFlag === undefined) {
    return err(`Line ${line} has required "${required}"; write yes or no.`)
  }

  const uniqueFlag = readFlag(unique)
  if (uniqueFlag === undefined) {
    return err(`Line ${line} has unique "${unique}"; write yes or no.`)
  }

  const scale = readNumber(scaleCell)
  if (scale === null) {
    return err(`Line ${line} has a scale of "${scaleCell}", which is not a number of places.`)
  }

  const minimum = readNumber(min)
  if (minimum === null) return err(`Line ${line} has a min of "${min}", which is not a number.`)
  const maximum = readNumber(max)
  if (maximum === null) return err(`Line ${line} has a max of "${max}", which is not a number.`)

  return ok({
    name,
    type: type as ColumnType,
    unit: unit === '' ? undefined : unit,
    per: per === '' ? undefined : per,
    required: requiredFlag,
    unique: uniqueFlag,
    scale,
    values: values === '' ? [] : values.split(',').map((value) => value.trim()),
    minimum,
    maximum,
    target: target === '' ? undefined : target,
    ...(foundBy === undefined ? {} : { foundBy }),
    note,
  })
}

/**
 * One aggregate row (U4b).
 *
 * `over` is split here rather than in the declaration, so `recipe_line` with no
 * dot is a sentence about a missing column rather than a source whose column is
 * the empty string — which would resolve to nothing and read as *this format
 * has no column called ""*.
 */
/** `every course` — the word, then one format's name (D-397). */
const EVERY_SOURCE = /^every\s+(\S+)$/

function readAggregate(
  cells: readonly string[],
  line: number,
): Result<AggregateDeclaration, string> {
  if (cells.length !== AGGREGATE_HEADER.length) {
    return err(
      `Line ${line} has ${cells.length} cells; every row of the aggregates table needs ${AGGREGATE_HEADER.length} — ${AGGREGATE_HEADER.join(' | ')}.`,
    )
  }
  const [name = '', kind = '', over = '', expression = '', unit = '', note = ''] = cells

  const folded = AGGREGATE_KINDS.find((each) => each.toLowerCase() === kind.trim().toLowerCase())
  if (folded === undefined) {
    return err(
      `Line ${line} says ${name || 'an aggregate'} is a "${kind}", which is not one of ${AGGREGATE_KINDS.map((each) => each.toLowerCase()).join(', ')}.`,
    )
  }

  // `security_price.security by as_of where source is FETCHED` — the order
  // first, then the filter (M25 E3, D-272). Whether an order belongs on this
  // kind at all is the declaration's check, which can name the kind.
  const [picked = '', ...filtered] = over.split(' where ')
  const [source = '', ...ordered] = picked.split(' by ')
  const by = ordered.length === 0 ? undefined : ordered.join(' by ').trim()
  // `every course` — every row of the format, in a word (M34 U4, D-397).
  const every = EVERY_SOURCE.exec(source.trim())
  const parts = every === null ? source.split('.') : [every[1] ?? '']
  if (
    every === null &&
    (parts.length !== 2 || parts[0]?.trim() === '' || parts[1]?.trim() === '')
  ) {
    return err(
      `Line ${line} says ${name || 'an aggregate'} runs over "${over}". Write it as the format and the column that points back here — recipe_line.recipe — or, for every row of a format, every course.`,
    )
  }
  let where: AggregateFilter | undefined
  if (filtered.length > 0) {
    const parsed = parseFilter(filtered.join(' where '))
    if ('problem' in parsed) return err(`Line ${line}: ${parsed.problem}`)
    where = parsed
  }

  return ok(
    aggregate(
      name,
      folded,
      every === null
        ? { format: parts[0]?.trim() ?? '', column: parts[1]?.trim() ?? '' }
        : { format: parts[0] ?? '' },
      { expression: expression.trim(), unit: unit === '' ? undefined : unit, note, where, by },
    ),
  )
}

function readFlag(cell: string): boolean | undefined {
  const lowered = cell.toLowerCase()
  if (lowered === 'yes' || lowered === 'y' || lowered === 'true') return true
  if (lowered === 'no' || lowered === 'n' || lowered === 'false' || lowered === '') return false
  return undefined
}

/** `undefined` for an empty cell, `null` for one that is not a number. */
function readNumber(cell: string): number | undefined | null {
  if (cell === '') return undefined
  const value = Number(cell)
  return Number.isFinite(value) ? value : null
}

/** A markdown pipe row's cells, or nothing if the line is not one. */
function splitRow(line: string): readonly string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return undefined
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

function sameHeader(cells: readonly string[], header: readonly string[]): boolean {
  return (
    cells.length === header.length &&
    header.every((expected, index) => cells[index]?.toLowerCase() === expected)
  )
}

/**
 * One row, unpadded.
 *
 * A pipe inside a cell is escaped rather than refused, because a note is the one
 * cell holding a sentence somebody wrote and *"g | ml"* is a reasonable thing to
 * have written. A newline is not: it would end the row, so it is flattened.
 */
function row(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')).join(' | ')} |`
}

function unquote(value: string): string {
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value)
  return quoted?.[1] ?? value
}
