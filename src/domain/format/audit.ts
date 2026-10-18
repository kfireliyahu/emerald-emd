/**
 * **What is wrong, said without being asked** — M34 U3, D-396.
 *
 * The pitch is *won't let you be wrong quietly*, and in the trial it fired only
 * when the model was asked to look. So the engine looks, after every
 * read and whenever asked, and says what it can know **mechanically** — from
 * the rows and the declaration, with nothing guessed:
 *
 * - **A link left empty where the rest are filled.** Seven assignments name a
 *   course and the eighth names none: the eighth is the odd one, whatever the
 *   reason. Only where *most* rows fill it, so a link that is usually empty —
 *   a `supersedes`, a `blocks` — says nothing. A link into the format's own
 *   rows is left out: a tree's top rows have no parent on purpose.
 * - **Rows the same in every column.** The duplicate workout. A format with a
 *   unique column cannot hold two, so this is the one the table cannot refuse.
 * - **An identity failed, or unchecked**, by the rows it is about.
 *
 * What it cannot know is not guessed. *A project Done whose tasks are Not
 * started* is wrong only under a rule somebody holds, and a rule nobody declared
 * is a guess stored — that is a later question, and an open one.
 *
 * And **every line of a file read is accounted for** (`lineTally`): the column
 * names and what is above them, the lines a header row was read from, the
 * lines read, refused, and skipped as empty — summing to the file's lines, so a
 * reading cannot drop a row quietly, which is what the trial's model did.
 */

import { isLinkType, labelColumn, type FormatDeclaration } from './declaration.ts'
import { figureIn } from './identity.ts'
import { positionRow, type ReadResult, type ReadTable, type Reading } from './reading.ts'
import { idsIn, type RowVerdict, type StoredRow } from './row.ts'

/** A row, by what it is called — its naming column, or its id when that is empty. */
export interface AuditRow {
  readonly id: string
  readonly name: string
  /**
   * What a failed identity came to on this row — `85 against 84.52` — so the
   * sentence names both figures rather than only the row (M34 U4, D-397).
   */
  readonly says?: string | undefined
}

export type Finding =
  /** A link most rows fill, empty on these. */
  | {
      readonly kind: 'LINK_GAP'
      readonly column: string
      readonly target: string
      readonly filled: number
      readonly empty: readonly AuditRow[]
    }
  /** Rows identical in every column, one finding per set of them. */
  | { readonly kind: 'DUPLICATE'; readonly rows: readonly AuditRow[] }
  /** An identity that failed on these rows. */
  | { readonly kind: 'FAILED'; readonly identity: string; readonly rows: readonly AuditRow[] }
  /** An identity these rows have not got the figures to check. */
  | { readonly kind: 'UNCHECKED'; readonly identity: string; readonly rows: readonly AuditRow[] }

export interface FormatAudit {
  readonly format: string
  readonly title: string
  readonly rows: number
  readonly findings: readonly Finding[]
}

/**
 * Look over a format's rows. `verdictsFor` is each row's identities, judged
 * through the join by the caller — the domain holds no database.
 */
export function auditRows(
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  verdictsFor: (row: StoredRow) => readonly RowVerdict[],
): FormatAudit {
  const naming = labelColumn(declaration)
  const named = (row: StoredRow): AuditRow => {
    const label = naming === undefined ? undefined : row.cells[naming.name]
    return { id: row.id, name: typeof label === 'string' && label !== '' ? label : row.id }
  }

  const findings: Finding[] = []

  for (const column of declaration.columns) {
    if (!isLinkType(column.type) || column.target === undefined) continue
    if (column.target === declaration.name) continue
    const empty = rows.filter((row) => idsIn(row.cells[column.name]).length === 0)
    const filled = rows.length - empty.length
    if (empty.length > 0 && filled * 2 > rows.length) {
      findings.push({ kind: 'LINK_GAP', column: column.name, target: column.target, filled, empty: empty.map(named) })
    }
  }

  const alike = new Map<string, StoredRow[]>()
  for (const row of rows) {
    const key = JSON.stringify(Object.keys(row.cells).sort().map((name) => [name, row.cells[name] ?? null]))
    const seen = alike.get(key)
    if (seen === undefined) alike.set(key, [row])
    else seen.push(row)
  }
  for (const same of alike.values()) {
    if (same.length > 1) findings.push({ kind: 'DUPLICATE', rows: same.map(named) })
  }

  if (declaration.identities.length > 0) {
    const failed = new Map<string, AuditRow[]>()
    const unchecked = new Map<string, AuditRow[]>()
    for (const row of rows) {
      for (const each of verdictsFor(row)) {
        const into = each.verdict.kind === 'FAILED' ? failed : each.verdict.kind === 'UNCHECKED' ? unchecked : undefined
        if (into === undefined) continue
        const list = into.get(each.identity.name) ?? []
        const verdict = each.verdict
        list.push(
          verdict.kind === 'FAILED'
            ? {
                ...named(row),
                // Two dates as the dates they are (D-471), never as ordinals.
                says:
                  verdict.points !== undefined
                    ? `${verdict.points.left} against ${verdict.points.right}`
                    : `${figureIn(verdict.currency)(verdict.left)} against ${figureIn(verdict.currency)(verdict.right)}`,
              }
            : named(row),
        )
        into.set(each.identity.name, list)
      }
    }
    for (const [identity, list] of failed) findings.push({ kind: 'FAILED', identity, rows: list })
    for (const [identity, list] of unchecked) findings.push({ kind: 'UNCHECKED', identity, rows: list })
  }

  return { format: declaration.name, title: declaration.title, rows: rows.length, findings }
}

/** Rows a sentence names before it says how many more. */
const NAMED = 5

function some(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`
}

function names(rows: readonly AuditRow[]): string {
  const shown = rows
    .slice(0, NAMED)
    .map((row) => (row.says === undefined ? row.name : `${row.name} (${row.says})`))
    .join(', ')
  return rows.length > NAMED ? `${shown} and ${String(rows.length - NAMED)} more` : shown
}

/** One finding, in a sentence. */
export function findingSentence(finding: Finding): string {
  switch (finding.kind) {
    case 'LINK_GAP':
      return (
        `\`${finding.column}\` is empty on ${some(finding.empty.length, 'row')} where ` +
        `${String(finding.filled)} name a ${finding.target}: ${names(finding.empty)}.`
      )
    case 'DUPLICATE':
      return `${some(finding.rows.length, 'row')} the same in every column: ${names(finding.rows)}.`
    case 'FAILED':
      return `\`${finding.identity}\` fails on ${some(finding.rows.length, 'row')}: ${names(finding.rows)}.`
    case 'UNCHECKED':
      return (
        `\`${finding.identity}\` cannot be checked on ${some(finding.rows.length, 'row')}, ` +
        `each missing a figure it names: ${names(finding.rows)}.`
      )
  }
}

/* ------------------------------------------------------------ every line */

/** Every line of a file read, by what became of it. The parts sum to `lines`. */
export interface LineTally {
  /** The file's lines — its rows, to the last one holding anything. */
  readonly lines: number
  /** The line of column names, and everything above it. */
  readonly heading: number
  /** Lines under it a header row's cells were read from — a printed total. */
  readonly header: number
  readonly read: number
  readonly refused: number
  /** Blank in every mapped column, and not rows at all. */
  readonly empty: number
}

export function lineTally(table: ReadTable, reading: Reading, read: ReadResult): LineTally {
  const lines = table.rows.length
  const heading = Math.min(reading.headerRow + 1, lines)
  const headerRows = new Set<number>()
  for (const each of reading.header?.cells ?? []) {
    const row = positionRow(table, each.row)
    if (row !== undefined && row > reading.headerRow) headerRows.add(row)
  }
  const typed = read.rows.filter((row) => row.cells !== undefined).length
  return {
    lines,
    heading,
    header: headerRows.size,
    read: typed,
    refused: read.rows.length - typed,
    empty: read.blank,
  }
}

/** Whether the parts sum to the file — the one thing this exists to make checkable. */
export function tallyAccounts(tally: LineTally): boolean {
  return tally.heading + tally.header + tally.read + tally.refused + tally.empty === tally.lines
}

/** The tally in a sentence: `12 lines: 1 heading, 9 read, 1 refused, 1 empty.` */
export function tallySentence(tally: LineTally): string {
  const parts = [
    `${String(tally.heading)} heading`,
    ...(tally.header === 0 ? [] : [`${String(tally.header)} header row`]),
    `${String(tally.read)} read`,
    `${String(tally.refused)} refused`,
    ...(tally.empty === 0 ? [] : [`${String(tally.empty)} empty`]),
  ]
  const missing = tally.lines - (tally.heading + tally.header + tally.read + tally.refused + tally.empty)
  return (
    `${some(tally.lines, 'line')}: ${parts.join(', ')}.` +
    (missing === 0 ? '' : ` ${some(Math.abs(missing), 'line')} not accounted for.`)
  )
}
