/**
 * Reading the deposit table a fund report prints — the rows, off the page, with
 * no model anywhere near them (D-153).
 *
 * **The one table inside a label-value document**, and it is read differently
 * from everything else in `fundReportTemplate.ts` for a reason that is about the
 * document rather than about taste. Every other figure on a report sits at a
 * label that does not change between quarters, so it is anchored to that label.
 * A deposit table has no labels at all — every cell in it is data — and its
 * number of rows changes every quarter by construction, because a quarter has a
 * different number of deposits in it than the last one did.
 *
 * So a template stores the two things about the table that *are* stable — the
 * **heading line** and the **order of its columns** — and the rows are found
 * here, by shape, every time the document is opened:
 *
 * > Walk down from the heading. A line whose cells number what the heading's
 * > columns number, and whose declared date and month columns parse, is a row.
 * > The first line that is not one ends the table.
 *
 * **The count test is stricter than it looks.** A report prints a total line
 * under the table with the same layout; it fails because a word sits where a
 * month belongs. Prose fails on the count. A second table further down the page
 * is never reached, because the walk stops at the first line that is not a row
 * rather than scanning on for more.
 *
 * **A cell is a run of text separated from the next by two spaces or a tab**,
 * which is `valueOnLine`'s rule and the only notion of a column a flattened page
 * has. Empty cells collapse — nothing in extracted text distinguishes a blank
 * cell from the gap beside it — so a column index counts **values on the row**,
 * and a row that lost one is not a row. That is a limit stated rather than
 * worked around: a table with a genuinely empty cell mid-row reads as ending
 * there, and the surface shows the rows it got against the total it did not
 * reach.
 */

import { isDepositRole } from '@/domain/model/columnRoles.ts'
import { fromMajorUnits, type CurrencyCode, type Money } from '@/core/money.ts'
import type { LocalDate, YearMonth } from '@/core/time.ts'
import type { ReadDeposit } from '@/domain/model/funds.ts'
import type { DepositColumn } from '@/domain/model/templates.ts'

import { parseAmountText, parseDateText } from './normalize.ts'

/** How many lines that are not rows may sit between the heading and the first one. */
const LEADING_SKIPS = 2

export interface DepositTableRead {
  readonly rows: readonly ReadDeposit[]
  /** Lines that sat in the table's place and were not rows, for the surface. */
  readonly skipped: number
}

/**
 * Every row under a heading, in the order the report prints them.
 *
 * `headerLine` is one-based, as every line number in this app is.
 */
export function readDepositRows(
  text: string,
  headerLine: number,
  columns: readonly DepositColumn[],
  currency: CurrencyCode = 'ILS',
): DepositTableRead {
  const lines = text.split(/\r?\n/)
  const rows: ReadDeposit[] = []
  let skipped = 0
  let started = false

  for (let index = headerLine; index < lines.length; index++) {
    const line = lines[index]
    if (line === undefined) break

    const row = line.trim() === '' ? undefined : readDepositRow(line, columns, currency)
    if (row === undefined) {
      // A gap before the table starts is layout; anything after it has started
      // is the table ending. Both are what a flattened page actually looks like.
      if (started) break
      skipped += 1
      if (skipped > LEADING_SKIPS) break
      continue
    }

    started = true
    rows.push(row)
  }

  return { rows, skipped }
}

/**
 * One line as a deposit, or nothing if it is not one.
 *
 * Three tests and a line has to pass all of them: its cells number the columns,
 * every column declared as a date or a month parses as one, and at least one
 * amount column carries a figure. The third is what stops a second row of
 * headings from reading as a deposit of nothing.
 */
export function readDepositRow(
  line: string,
  columns: readonly DepositColumn[],
  currency: CurrencyCode = 'ILS',
): ReadDeposit | undefined {
  const cells = cellsOf(line)
  if (cells.length !== columns.length || columns.length === 0) return undefined

  let employerName: string | undefined
  let depositDate: LocalDate | undefined
  let salaryMonth: YearMonth | undefined
  const amounts = new Map<DepositColumn['role'], Money>()
  let anyAmount = false

  for (const column of columns) {
    const cell = cells[column.index]
    if (cell === undefined) return undefined

    // **An added role reaches a mapping and never a cell** (D-211, D-213).
    // Nothing below narrows on one, so it is skipped exactly where `ignore` is
    // — and past this line `column.role` is the union again, which is what
    // keeps the switch exhaustive.
    // Here it is load-bearing rather than tidy: the `default` arm parses
    // anything it does not recognise as an amount, so without this an added
    // role would be **stored**.
    if (!isDepositRole(column.role)) continue

    switch (column.role) {
      case 'ignore':
        break

      case 'employerName': {
        // The words in the cell, which is `valueOnLine`'s rule: an employer
        // column sometimes carries the employer's number beside the name.
        const name = cell
          .replace(/[\d,.%()]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (name !== '') employerName = name
        break
      }

      case 'depositDate': {
        const date = parseDateText(cell, 'DMY')
        if (date === undefined) return undefined
        depositDate = date
        break
      }

      case 'salaryMonth': {
        const month = parseSalaryMonth(cell)
        if (month === undefined) return undefined
        salaryMonth = month
        break
      }

      default: {
        const value = parseAmountText(cell)
        if (value === undefined) break
        amounts.set(column.role, fromMajorUnits(value, currency))
        anyAmount = true
      }
    }
  }

  if (!anyAmount) return undefined

  return {
    employerName,
    depositDate,
    salaryMonth,
    employee: amounts.get('employee'),
    employer: amounts.get('employer'),
    severance: amounts.get('severance'),
    total: amounts.get('total'),
    salary: amounts.get('salary'),
    note: undefined,
  }
}

/**
 * The values on a row, in the order they are printed.
 *
 * Two spaces or a tab. A single space is inside a value — an employer's name is
 * one cell however many words it is made of.
 */
export function cellsOf(line: string): readonly string[] {
  return line
    .split(/\s{2,}|\t/)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
}

/**
 * A salary month as a report writes one: `11/2025`, `2025-11`, `11.2025`, `11/25`.
 *
 * Its own parser rather than `parseDateText`, because a month has no day and
 * inventing one puts a deposit in the wrong month at either end of it. A
 * two-digit year reads as this century, which is the only reading ever meant on
 * a document about a pension.
 */
export function parseSalaryMonth(text: string): YearMonth | undefined {
  const match = /^\s*(\d{1,4})\s*[/.\-]\s*(\d{1,4})\s*$/.exec(text)
  if (match === null) return undefined

  const first = Number(match[1])
  const second = Number(match[2])
  if (!Number.isInteger(first) || !Number.isInteger(second)) return undefined

  // Whichever side is the year is the side that cannot be a month.
  const [month, year] = first > 12 ? [second, first] : [first, second]
  if (month === undefined || year === undefined) return undefined
  if (month < 1 || month > 12) return undefined

  const full = year < 100 ? 2000 + year : year
  if (full < 1900 || full > 2200) return undefined
  return { year: full, month }
}
