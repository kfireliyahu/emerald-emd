/**
 * Date-only values, as calendar parts.
 *
 * `transactionDate`, `chargeDate` and `billingPeriod` are calendar facts, not
 * instants. A purchase made on 3 July was made on 3 July in Tel Aviv, in UTC,
 * and in a test runner set to Honolulu. Representing that as a `Date` attaches
 * a timezone to something that does not have one, and the first symptom is an
 * off-by-one day at a month boundary.
 *
 * This is not a hypothetical risk on this project: reading real statement
 * files already produced a ~40-second-per-date drift because SheetJS converts
 * spreadsheet serials through the local timezone, and Asia/Jerusalem's 1899
 * offset is +02:20:54 — not a whole number of minutes. See D-023.
 */

export interface LocalDate {
  readonly year: number
  /** 1-12. */
  readonly month: number
  /** 1-31. */
  readonly day: number
}

export interface YearMonth {
  readonly year: number
  /** 1-12. */
  readonly month: number
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return DAYS_IN_MONTH[month - 1] ?? 0
}

/** Rejects 31 September and 29 February in a common year, rather than rolling them over. */
export function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12) return false
  return day >= 1 && day <= daysInMonth(year, month)
}

export function localDate(year: number, month: number, day: number): LocalDate {
  if (!isValidDate(year, month, day)) {
    throw new Error(`Not a real date: ${year}-${month}-${day}`)
  }
  return { year, month, day }
}

export function tryLocalDate(year: number, month: number, day: number): LocalDate | undefined {
  return isValidDate(year, month, day) ? { year, month, day } : undefined
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

export function toISODate(date: LocalDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`
}

export function parseISODate(text: string): LocalDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (match === null) return undefined
  const [, y, m, d] = match
  if (y === undefined || m === undefined || d === undefined) return undefined
  return tryLocalDate(Number(y), Number(m), Number(d))
}

// --- Written dates ----------------------------------------------------------

/**
 * Which way round a written date is: day, month or year first.
 *
 * The three answers are lowercase here; the ledger's importer spells its own
 * `DateOrder` in capitals and converts at the call (M45 F1).
 */
export type NumericDateOrder = 'dmy' | 'mdy' | 'ymd'

/** `03/07/2026`, `3-7-26`, `2026.07.03`, `03 07 2026` — slash, dot, dash or space. */
const NUMERIC_DATE = /^(\d{1,4})[./\- ](\d{1,2})[./\- ](\d{1,4})$/

/**
 * **One reader of a written date for the importer and the engine** (M45 F1,
 * S-054). They were two, and the same file read differently in a bank import
 * and in a declared format: only the importer took a space between the parts,
 * and only it read `26` as 2026. Real statements print both, so both readers do
 * now.
 *
 * Pure: the caller cleans the cell's text (`cleanText`) and says the order,
 * which `inferNumericDateOrder` guesses from the column — `03/07/2026` is 3 July
 * in Israel and 7 March in the US, and nothing in the cell says which.
 */
export function parseNumericDate(text: string, order: NumericDateOrder): LocalDate | undefined {
  const match = NUMERIC_DATE.exec(text.trim())
  if (match === null) return undefined
  const [, first, second, third] = match
  if (first === undefined || second === undefined || third === undefined) return undefined
  const a = Number(first)
  const b = Number(second)
  const c = Number(third)
  switch (order) {
    case 'dmy':
      return tryLocalDate(expandYear(c), b, a)
    case 'mdy':
      return tryLocalDate(expandYear(c), a, b)
    case 'ymd':
      return tryLocalDate(expandYear(a), b, c)
  }
}

/**
 * `26` → 2026. A two-digit year in a statement is always recent, so the
 * century is not really in doubt; the window is generous in both directions
 * so an old archived file still reads correctly.
 */
function expandYear(year: number): number {
  if (year >= 100) return year
  return year <= 69 ? 2000 + year : 1900 + year
}

/**
 * Which order the written dates of one column imply.
 *
 * A four-digit first part is a year and settles it. Otherwise a date counts
 * only when it reads one way and not the other: a first part over twelve with
 * a second that is not is day-first, and the reverse is month-first; a date
 * with both over twelve is no date either way and counts for neither. More
 * month-first than day-first answers month-first; anything else — a tie, or no
 * evidence at all — is day-first, which every real file checked so far writes.
 */
export function inferNumericDateOrder(texts: readonly string[]): NumericDateOrder {
  let dayFirst = 0
  let monthFirst = 0
  for (const text of texts) {
    const match = NUMERIC_DATE.exec(text.trim())
    if (match === null) continue
    const [, first, second] = match
    if (first === undefined || second === undefined) continue
    if (first.length === 4) return 'ymd'
    const a = Number(first)
    const b = Number(second)
    if (a > 12 && b <= 12) dayFirst += 1
    if (b > 12 && a <= 12) monthFirst += 1
  }
  return monthFirst > dayFirst ? 'mdy' : 'dmy'
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

/**
 * Whole days from `a` to `b` — negative when `b` is the earlier of the two.
 *
 * **Not a subtraction of two `Date`s**, which is the reason this file exists
 * (D-023). Two instants in Asia/Jerusalem's 1899 offset are not a whole number
 * of days apart, and the symptom of pretending they are is an off-by-one that
 * only shows up near a month boundary. This counts days on the civil calendar
 * instead: a date becomes a day number by Hinnant's `days_from_civil`, and the
 * answer is one integer minus another.
 */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return dayNumber(b) - dayNumber(a)
}

/**
 * Days since 1970-01-01, for a date with no time in it.
 *
 * The calendar shifted so March is month 0: a leap day is then the last day of
 * the year rather than the 60th, which is what removes every special case from
 * the arithmetic below.
 */
function dayNumber(date: LocalDate): number {
  const year = date.year - (date.month <= 2 ? 1 : 0)
  const era = Math.floor(year / 400)
  const yearOfEra = year - era * 400
  const dayOfYear =
    Math.floor((153 * (date.month + (date.month > 2 ? -3 : 9)) + 2) / 5) + date.day - 1
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear
  return era * 146097 + dayOfEra - 719468
}

export function yearMonthOf(date: LocalDate): YearMonth {
  return { year: date.year, month: date.month }
}

/**
 * The **stored** form of a salary month: `2026-07`.
 *
 * A paycheck's period is persisted like this, the ledger filters by it,
 * `parseYearMonth` is its only reader and the plugin's tool arguments use it.
 * It sorts as a string, which is why several maps here are keyed on it. **It is
 * not a display string** — see `formatYearMonth` (D-172), and do not be tempted
 * to make this one prettier: a display string that leaks into storage is a
 * migration.
 */
export function toYearMonthString(period: YearMonth): string {
  return `${pad(period.year, 4)}-${pad(period.month)}`
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * A month as a person reads it: **July 2026** (D-172).
 *
 * A second function rather than a nicer `toYearMonthString`, because that one
 * is a wire format and this one is prose. They will never converge: the day
 * this returns `2026-07` again is the day somebody has decided a stored value
 * should be readable, which is how a display string becomes a migration.
 *
 * **English, and deliberately not the platform's locale.** Every string this
 * app prints is English (conventions); a month name that followed the machine's
 * language would be the one word on the screen that did, and the locale pack
 * (M12) is where that decision belongs rather than here.
 */
export function formatYearMonth(period: YearMonth): string {
  const name = MONTH_NAMES[period.month - 1]
  return name === undefined ? toYearMonthString(period) : `${name} ${String(period.year)}`
}

/**
 * The month alone: **July**.
 *
 * For a table that has already said which year it is about — the year
 * overview's twelve rows, where repeating `2026` twelve times says nothing
 * that the heading above them has not (D-172).
 */
export function formatMonthName(period: YearMonth): string {
  return MONTH_NAMES[period.month - 1] ?? toYearMonthString(period)
}

/**
 * The same month where it has to share the space: **Jul 2026**.
 *
 * A twelve-month axis of full month names does not fit, and that was the
 * question worth answering once rather than per chart (D-172). **The year
 * stays**: a trends window crosses a year boundary as a matter of course, and
 * two `Jul`s a year apart on one axis is worse than a slightly wider label.
 */
export function formatMonthShort(period: YearMonth): string {
  const name = MONTH_NAMES[period.month - 1]
  return name === undefined
    ? toYearMonthString(period)
    : `${name.slice(0, 3)} ${String(period.year)}`
}

/**
 * The month's short name alone: **Jul**. For a row of months that says the
 * year where it changes rather than under every box.
 */
export function formatMonthAbbrev(period: YearMonth): string {
  return MONTH_NAMES[period.month - 1]?.slice(0, 3) ?? toYearMonthString(period)
}

/** A day and its month, for a line that is about this year: **3 Oct**. */
export function formatDayMonth(date: LocalDate): string {
  return `${String(date.day)} ${formatMonthAbbrev(yearMonthOf(date))}`
}

export function compareYearMonths(a: YearMonth, b: YearMonth): number {
  return a.year - b.year || a.month - b.month
}

/**
 * A month before or after another, rolling the year over.
 *
 * Counted in whole months from year zero rather than by incrementing and
 * carrying, so December → January and January → December are the same
 * arithmetic as any other step and there is no branch to get wrong.
 */
export function addMonths(period: YearMonth, months: number): YearMonth {
  const total = period.year * 12 + (period.month - 1) + months
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 }
}

/**
 * Whole months from one period to another. Negative when `to` is earlier.
 *
 * Counted from year zero for the reason `addMonths` is: a December-to-January
 * step is the same arithmetic as any other, with no carry to get wrong. Here
 * rather than private to a caller because the second one arrived — the
 * settlement window in `domain/bankImport.ts` and the snapshot window in
 * `domain/funds.ts` ask the same question of two different kinds of month.
 */
export function monthsBetween(from: YearMonth, to: YearMonth): number {
  return to.year * 12 + to.month - (from.year * 12 + from.month)
}

/**
 * A `YYYY-MM` string as a `YearMonth`, or nothing if it is not one.
 *
 * The counterpart to `toYearMonthString`, and the only reader of that format. A
 * paycheck's salary month is stored in it, and the ledger and re-apply both
 * filter by it.
 */
export function parseYearMonth(text: string): YearMonth | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(text.trim())
  if (match?.[1] === undefined || match[2] === undefined) return undefined

  const month = Number(match[2])
  if (month < 1 || month > 12) return undefined

  return { year: Number(match[1]), month }
}

/**
 * A `YYYY-MM` string as the inclusive day range it covers, or nothing if it is
 * not one.
 *
 * Here rather than in a screen because two of them now turn a month the user
 * picked into a filter — the ledger and re-apply's scope — and a second copy of
 * "which days are in June" is a second thing that can be wrong about February.
 */
export function monthRange(
  period: string,
): { readonly from: LocalDate; readonly to: LocalDate } | undefined {
  const parsed = parseYearMonth(period)
  if (parsed === undefined) return undefined

  const { year, month } = parsed
  return { from: localDate(year, month, 1), to: localDate(year, month, daysInMonth(year, month)) }
}

/**
 * The first and the last day of a month, from a `YearMonth` rather than a
 * string.
 *
 * The typed twin of `monthRange`, promoted here on the third private copy — the
 * debt repository's, the insights screen's, and the splitter's comparison. The
 * last-day one is the whole reason: it is `daysInMonth`, and every copy of it is
 * another place February can be wrong.
 */
export function monthStart(period: YearMonth): LocalDate {
  return localDate(period.year, period.month, 1)
}

export function monthEnd(period: YearMonth): LocalDate {
  return localDate(period.year, period.month, daysInMonth(period.year, period.month))
}
