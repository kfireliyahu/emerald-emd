import { useState } from 'react'

import { fromMajorUnits, formatMoney, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  parseISODate,
  parseYearMonth,
  toISODate,
  toYearMonthString,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { FIELD } from '@/ui/components/fieldLook.ts'

/**
 * A figure a reader produced, as a field the person confirming it can type over.
 *
 * **M16 U10, and U11 is the same shape on the other three readers.** A reader is
 * a *proposer* — a local model picks the roles, an anchored template executes
 * them, and both are wrong sometimes in ways no arithmetic catches. The answer
 * chosen is not a better reader: it is that **every figure a reader
 * produces becomes an editable field on the confirm surface, and what is edited
 * is what is written**. That is also the answer to statements from countries
 * nobody has written a rulepack for.
 *
 * All three confirm surfaces are built on these — the payslip, the fund report,
 * and the import review screen, whose reader is the column mapping and whose
 * reading is rows in the staging table rather than an object in memory.
 *
 * Three rules hold across all of these, and each is one way an edited figure
 * goes quietly wrong:
 *
 * - **A blank field means the document printed nothing there**, and is not zero.
 *   Committing `undefined` is what keeps `unchecked` reachable: a row with no
 *   figure is an ordinary row, and a row at zero is a claim.
 * - **A keystroke that would make the text unreadable is refused** rather than
 *   accepted and reported. There is no error state here and no blocked accept,
 *   because the alternative is a surface that holds a figure it cannot write —
 *   and D-138's law says the thing to fear is a proof that ran over the wrong
 *   version of what is stored.
 * - **The text is local and the value is not.** Each field keeps what was typed
 *   so `1.` and `2.50` survive being half-written, and commits the parsed value
 *   upward on every keystroke so the arithmetic on the screen is about the
 *   figures the accept will use. Nothing resyncs the text from above: where a
 *   caller replaces the reading wholesale — another format, a re-mapping, a
 *   fresh read — it remounts the surface instead.
 */

/** Digits, one decimal separator, an optional sign. Empty is allowed. */
const NUMERIC_DRAFT = /^-?\d*(?:[.,]\d*)?$/

/**
 * Whether a field may hold this text at all.
 *
 * The guard is on the *keystroke*, so what it has to allow is every half-typed
 * state on the way to a figure — `-`, `1.`, `` — and not only the finished ones.
 * A single decimal separator, because `1.2.3` is the text a person meant to
 * delete rather than a figure anybody meant.
 */
export function acceptsFigureText(text: string): boolean {
  return NUMERIC_DRAFT.test(text.trim())
}

/**
 * A figure as text to type over: exact, and without the grouping commas.
 *
 * The formatters cut their digits out of the integer rather than dividing
 * (D-003), so this is the figure and not a float's opinion of it. The commas go
 * because a field the user is about to edit should not need them removed first —
 * and because with them gone a comma can only ever be a decimal separator, which
 * is what makes `1,5` unambiguous on a keyboard that types it.
 */
export function figureText(formatted: string): string {
  return formatted.replace(/,/g, '')
}

/**
 * What a field's text is worth, or nothing.
 *
 * **Blank is `undefined` and not zero** — the document printed nothing there,
 * which is the state every three-valued check in the app rests on. So is a
 * half-typed `-`: it is not yet a figure, and treating it as one would make a
 * row fail its own arithmetic between two keystrokes.
 */
export function figureFromText(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || !NUMERIC_DRAFT.test(trimmed)) return undefined
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function NumericInput({
  initial,
  label,
  onText,
  className,
}: {
  initial: string
  label: string
  onText: (text: string) => void
  className: string
}) {
  const [text, setText] = useState(initial)

  return (
    <input
      className={className}
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        const next = event.target.value
        // The refusal, and the whole of it: a keystroke that would leave the
        // field holding something no parser can turn into a figure never lands.
        if (!acceptsFigureText(next)) return
        setText(next)
        onText(next)
      }}
    />
  )
}

/** The look of a figure in a table cell: right-aligned, its own width. */
export const FIGURE_FIELD = `${FIELD} w-28 text-right tabular-nums`

/** The look of a word in a table cell. */
export const WORD_FIELD = `${FIELD} w-full`

export function AmountField({
  value,
  currency,
  label,
  onCommit,
  className = FIGURE_FIELD,
}: {
  value: Money | undefined
  currency: CurrencyCode
  label: string
  onCommit: (value: Money | undefined) => void
  className?: string
}) {
  return (
    <NumericInput
      initial={value === undefined ? '' : figureText(formatMoney(value, { symbol: false }))}
      label={label}
      className={className}
      onText={(text) => {
        const parsed = figureFromText(text)
        onCommit(
          parsed === undefined ? undefined : fromMajorUnits(parsed, value?.currency ?? currency),
        )
      }}
    />
  )
}

/**
 * A date a reader read off the page.
 *
 * The one field here whose absence is silent rather than visible: a report or a
 * slip whose date did not read has nothing to file its figures under — so the
 * field exists as much to *say* the date is missing as to correct it.
 */
export function DateField({
  value,
  label,
  onCommit,
  className = FIELD,
}: {
  value: LocalDate | undefined
  label: string
  onCommit: (value: LocalDate | undefined) => void
  className?: string
}) {
  const [text, setText] = useState(value === undefined ? '' : toISODate(value))

  return (
    <input
      type="date"
      className={className}
      aria-label={label}
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        onCommit(parseISODate(event.target.value))
      }}
    />
  )
}

/**
 * A word a reader read — a security's name, the number printed beside it.
 *
 * Trimmed on the way up and blank means absent, so a key typed over with spaces
 * does not become a key that matches nothing. The untrimmed text stays in the
 * field, because a person mid-word has not finished typing.
 */
export function WordField({
  value,
  label,
  placeholder,
  onCommit,
  className = WORD_FIELD,
}: {
  value: string | undefined
  label: string
  placeholder?: string | undefined
  onCommit: (value: string | undefined) => void
  className?: string
}) {
  const [text, setText] = useState(value ?? '')

  return (
    <input
      className={className}
      aria-label={label}
      dir="auto"
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        const trimmed = event.target.value.trim()
        onCommit(trimmed === '' ? undefined : trimmed)
      }}
    />
  )
}

/**
 * The salary month a slip is for — the one field here whose value is a
 * `YearMonth` rather than a day.
 *
 * A month rather than a date because that is what the figure *is*: a slip filed
 * under the wrong month is wrong in a way every figure on it being right does
 * not fix, and a day picker would invite a person to answer a question the
 * document never asked. `toYearMonthString` is the storage format and it is also
 * what `<input type="month">` reads and writes, so nothing is converted twice.
 */
export function MonthField({
  value,
  label,
  onCommit,
  className = FIELD,
}: {
  value: YearMonth | undefined
  label: string
  onCommit: (value: YearMonth | undefined) => void
  className?: string
}) {
  const [text, setText] = useState(value === undefined ? '' : toYearMonthString(value))

  return (
    <input
      type="month"
      className={className}
      aria-label={label}
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        onCommit(parseYearMonth(event.target.value))
      }}
    />
  )
}
