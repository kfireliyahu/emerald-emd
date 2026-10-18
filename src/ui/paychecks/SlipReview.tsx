import { useState } from 'react'

import { formatMoney, type CurrencyCode, type Money } from '@/core/money.ts'

import { storesTemplate, type SlipRead } from '@/data/importer/payslipLadder.ts'
import type {
  DeductionKind,
  DeductionReading,
  PayslipReading,
} from '@/domain/model/paycheck.ts'
import type { PayslipDocumentTemplate } from '@/domain/model/templates.ts'
import type { TypeGroup } from '@/domain/paycheckEntry.ts'
import type { PayslipReview, ReviewRow } from '@/domain/review.ts'
import { Button } from '@/ui/components/Button.tsx'
import { FlowFrame } from '@/ui/components/FlowFrame.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import {
  AmountField,
  DateField,
  FIGURE_FIELD,
  MonthField,
  WordField,
} from '@/ui/documents/ReadField.tsx'
import { DocumentPane } from '@/ui/documents/DocumentPane.tsx'
import { Look, lineOf } from '@/ui/documents/Look.tsx'
import type { DocumentSource } from '@/ui/documents/openDocumentText.ts'
import { DeductionTypeSelect } from '@/ui/paychecks/DeductionTypeSelect.tsx'
import { FormatPicker } from '@/ui/paychecks/FormatPicker.tsx'

/**
 * What a person is shown before a read payslip becomes anything — M11's confirm
 * surface.
 *
 * **The layout is the argument.** Two regions, and which region a figure is in
 * is the claim being made about it:
 *
 * - The **strip** at the top holds gross, what was deducted and net, beside the
 *   two equations the slip ran on itself. These are the figures the document
 *   proved, and they say so only while both equations came out to zero.
 * - The **table** below holds every deduction line. Nothing in it is proved —
 *   the *total* is, and a figure moved from one row to the next leaves that
 *   total exactly where it was. The employer column especially: no equation on
 *   an Israeli slip runs through it, and a real run had every employer amount on
 *   a two-figure row dropped while both proofs passed (D-138).
 *
 * **One accept, with the doubts above it** (D-092). Not forty confirmations —
 * that is the plugin's whole value handed straight back — and not a silent
 * accept either: everything that deserves a second look is a sentence over the
 * button, in the order that matters.
 *
 * **Accepting fills the form. It does not save a paycheck.** The slip lands in
 * the editor a typed one lands in, with the same validation and the same save
 * button, so "nothing is written without a human action" is kept by there being
 * no other way through.
 *
 * **And every figure on it is a field** (M16 U11, D-205). The template is a
 * proposer — a stored one executes somebody's proposal from months ago, a
 * derived one executes a local model's — so the last word sits here rather than
 * in the reader. Both equations are re-run over whatever was typed, so the strip
 * describes the figures the accept will use rather than the ones the template
 * produced. The regions still mean what they meant: what changes is that a
 * figure in the wrong one can be moved back.
 */
export function SlipReview({
  outcome,
  review,
  groups,
  formats,
  currency,
  name,
  notice,
  source,
  onName,
  onNameRow,
  onReading,
  onUseFormat,
  onCreateType,
  onAccept,
  onDecline,
  onLeave,
  leaveLabel,
}: {
  outcome: SlipRead
  review: PayslipReview
  /** The picker's contents, the same ones the form below it offers. */
  groups: readonly TypeGroup[]
  /** Every stored format, so a wrong match is a click rather than a dead end. */
  formats: readonly PayslipDocumentTemplate[]
  /** Something about the document itself, rather than about what it says. */
  notice?: string | undefined
  /**
   * The PDF this reading came off, when it came off one (D-168).
   *
   * Absent for pasted text, and absent again the moment the text is edited —
   * `DocumentTextInput` drops it, because the boxes describe lines that have
   * since moved.
   */
  source?: DocumentSource | undefined
  /** What this format will be stored as. Only asked when there is nothing stored yet. */
  name: string
  onName: (name: string) => void
  /** The user saying what a row is. Kept against the format on accept (D-145). */
  onNameRow: (field: string, deductionTypeId: string) => void
  /**
   * A figure typed over — the reading as it now stands, restated (M16 U11).
   *
   * The edit goes into the reading rather than beside it, for D-205's reason:
   * an overlay would be two versions of every figure with one of them reaching
   * the accept, which is the shape D-138's law says goes wrong.
   */
  onReading: (reading: PayslipReading) => void
  /** The currency a figure typed into a blank field is in. */
  currency: CurrencyCode
  /** The user overruling the match: read this slip with that format instead. */
  onUseFormat: (id: string) => void
  onCreateType: (name: string, kind: DeductionKind) => string | undefined
  onAccept: () => void
  onDecline: () => void
  /** Out of the flow entirely. Discard only drops the reading. */
  onLeave: () => void
  /**
   * Where leaving goes, named — `FlowFrame`'s rule, and it stopped being a
   * constant when onboarding gained the same flow (D-166). "Back to the list"
   * is a lie in a wizard step that has no list behind it.
   */
  leaveLabel: string
}) {

  /**
   * Whether accepting also **stores** the template — and it does so only while
   * the slip agrees with itself.
   *
   * "A template is trusted only while it reconciles" (F17) is a rule about the
   * store, so the store is where it is kept: a template derived from a slip
   * whose figures do not add up reads the form and is then thrown away, because
   * remembering it would mean trusting next month's slip to a map that has
   * never once been right. Nothing is lost — next month derives again.
   */
  const remembers = storesTemplate(outcome) && review.reconciles
  // A format chosen by hand for a document its own labels do not cover is
  // stored a second time rather than named a second time: it already has a name
  // and the user already chose it, and what is missing is only that this slip's
  // labels find it next month.
  const names = remembers && outcome.stored === undefined
  const accept = names
    ? 'Accept and remember this format'
    : remembers
      ? 'Accept and read paychecks like this one with it'
      : 'Accept'

  /**
   * The page, and the line being pointed at — the two halves of D-168.
   *
   * **Off until asked for**, because a render is work and a person accepting
   * their fourth slip under a stored format has no reason to pay for it. The
   * line is whatever the pointer or the keyboard is on: pointing is the whole
   * gesture, so there is nothing to pin, unpin or get out of sync.
   */
  const [showing, setShowing] = useState(false)
  const [look, setLook] = useState<number | undefined>()
  const lines = outcome.reading.lines

  return (
    <FlowFrame
      title={
        <>
          {outcome.source === 'stored' && (
            <>
              Read with your reader{' '}
              <span className="font-medium text-ink">{outcome.stored?.name}</span> — nothing was
              asked of anything.
            </>
          )}
          {outcome.source === 'derived' && (
            <>A reader was worked out for this paycheck. You are looking at what it read.</>
          )}
          {outcome.source === 'chosen' && (
            <>
              Read with the reader you picked. If the figures below are right, accepting teaches
              this document to reach for it on a paycheck like this one.
            </>
          )}
        </>
      }
      // The way out of a wrong match, beside the sentence that names it — and
      // beside the way to check the reading against the page it came off.
      actions={
        <>
          {source !== undefined && (
            <Button variant="ghost" size="sm" onClick={() => setShowing(!showing)}>
              {showing ? 'Hide the document' : 'Show the document'}
            </Button>
          )}
          <FormatPicker formats={formats} current={outcome.stored?.id} onPick={onUseFormat} />
        </>
      }
      leaveLabel={leaveLabel}
      onLeave={onLeave}
      footer={
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-3 px-6 py-3">
          <Button variant="primary" onClick={onAccept}>
            {accept}
          </Button>
          <Button variant="ghost" onClick={onDecline}>
            Discard
          </Button>
          <span className="text-caption text-ink-tertiary">
            Accepting fills in the paycheck form. Nothing is saved until you save it there.
            {storesTemplate(outcome) && !review.reconciles && (
              <> This paycheck does not add up, so the reader that read it is not kept.</>
            )}
          </span>
        </div>
      }
    >
      <div className="px-6 py-4">
        <div
          className={
            showing && source !== undefined
              ? 'mx-auto grid max-w-[1600px] items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]'
              : 'mx-auto max-w-[1100px]'
          }
        >
          <div className="space-y-6">
          <Proved
            reading={outcome.reading}
            review={review}
            currency={currency}
            lines={lines}
            onReading={onReading}
            onLook={setLook}
            onShow={() => setShowing(true)}
          />

          {names && (
            <label className="flex flex-wrap items-center gap-2 text-ink-secondary">
              Call this format
              <input
                className={`${FIELD} w-64`}
                value={name}
                onChange={(event) => onName(event.target.value)}
                placeholder="e.g. Software Labs"
              />
              <span className="text-caption text-ink-tertiary">
                Every later paycheck that looks like this one is read with it, and nothing is asked
                again.
              </span>
            </label>
          )}

          <Rows
            reading={outcome.reading}
            rows={review.rows}
            groups={groups}
            currency={currency}
            onNameRow={onNameRow}
            onReading={onReading}
            onCreateType={onCreateType}
            onLook={setLook}
          />

          <Doubts
            review={review}
            attempts={outcome.attempts}
            notice={notice}
            lines={lines}
            onLook={setLook}
            onShow={() => setShowing(true)}
          />
          </div>

          {showing && source !== undefined && (
            // Sticky, so the page stays beside the row being read rather than
            // scrolling away from it — the pane is a column of the flow's one
            // scroller rather than a second one to get lost in.
            <div className="fc-pop-enter sticky top-0 space-y-2">
              <p className="text-caption text-ink-tertiary">
                The document, as it was read. Point at a figure or a row and its line is marked on
                the page.
              </p>
              <DocumentPane source={source} active={look} read={Object.values(lines)} />
            </div>
          )}
        </div>
      </div>
    </FlowFrame>
  )
}

/**
 * The strip: the two equations, and the three figures they vouch for.
 *
 * A failed equation does not put a mark against the figure that looks wrong —
 * the equations are over all three at once, so a failure says nothing about
 * which of them moved. What changes is the claim made about all three.
 *
 * **All three are drawn whether or not the slip printed them** (M16 U11), and
 * each is a field. A blank one is the honest drawing of "nothing was read as
 * the gross" *and* the place to correct it, and the second equation goes from
 * absent to running the moment a total is typed in — which is the whole of what
 * a person could not do here before.
 */
function Proved({
  reading,
  review,
  currency,
  lines,
  onReading,
  onLook,
  onShow,
}: {
  reading: PayslipReading
  review: PayslipReview
  currency: CurrencyCode
  lines: Readonly<Record<string, number>>
  onReading: (reading: PayslipReading) => void
  onLook: (line: number | undefined) => void
  onShow: () => void
}) {
  /** One of the three, set or cleared. A blank field is not a zero. */
  const setFigure = (
    key: 'gross' | 'net' | 'statedDeductionsTotal',
    amount: Money | undefined,
  ): void => {
    const next = { ...reading }
    delete next[key]
    onReading(amount === undefined ? next : { ...next, [key]: amount })
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        {review.figures.map((figure) => (
          <Look key={figure.field} line={lineOf(lines, figure.field)} onLook={onLook} onShow={onShow}>
            <div className="text-caption text-ink-secondary">{figure.label}</div>
            {/* Never coloured: `accent` marks what you can act on and never a
                figure, and `negative` is for the gap itself, which the sentence
                below already carries. The field's own border is the affordance. */}
            <AmountField
              value={figure.amount}
              currency={currency}
              label={figure.label}
              className={`${FIGURE_FIELD} w-36 text-secondary-number ${
                figure.proved ? 'text-ink' : 'text-ink-tertiary'
              }`}
              onCommit={(amount) => setFigure(FIGURE_KEY[figure.field] ?? 'gross', amount)}
            />
          </Look>
        ))}

        <div className="ml-auto space-y-1">
          {review.checks.map((check) => (
            <div key={check.label} className="flex items-baseline gap-2 text-caption">
              <span className={check.passed ? 'text-positive' : 'text-ink-tertiary'}>
                {check.delta === undefined ? '—' : formatMoney(check.delta)}
              </span>
              <span className="text-ink-secondary">{check.label}</span>
            </div>
          ))}
        </div>
      </div>

      <p className={review.reconciles ? 'text-positive' : 'text-negative'}>
        {review.reconciles ? (
          <>
            The paycheck agrees with itself twice over, so these three figures are what it says. The
            lines below are not checked by anything — read them.
          </>
        ) : (
          <>
            The paycheck does not agree with itself, so none of these three is confirmed by it. Read
            everything below against the page, and type over whatever is wrong.
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-caption text-ink-secondary">
        <label className="flex items-center gap-2">
          Salary month
          {/* Worth having even on a slip that adds up: every figure on it can be
              right and the month still be the one before, and nothing on the
              page checks it. */}
          <MonthField
            value={reading.salaryMonth}
            label="Salary month"
            className={`${FIELD} h-7`}
            onCommit={(salaryMonth) => {
              const next = { ...reading }
              delete next.salaryMonth
              onReading(salaryMonth === undefined ? next : { ...next, salaryMonth })
            }}
          />
        </label>
        <label className="flex items-center gap-2">
          Paid
          <DateField
            value={reading.payDate}
            label="Payment date"
            className={`${FIELD} h-7`}
            onCommit={(payDate) => {
              const next = { ...reading }
              delete next.payDate
              onReading(payDate === undefined ? next : { ...next, payDate })
            }}
          />
        </label>
        <span>
          Employer contributions{' '}
          {/* Derived from the column below rather than typed: it is the sum of
              the employer amounts, so the place to correct it is the row that
              is wrong. */}
          <span className="text-ink">{formatMoney(review.employerTotal)}</span>
        </span>
      </div>
    </section>
  )
}

/** Which of the reading's three headline figures a strip field writes to. */
const FIGURE_KEY: Readonly<Record<string, 'gross' | 'net' | 'statedDeductionsTotal'>> = {
  grossLine: 'gross',
  netLine: 'net',
  employeeDeductionsTotalLine: 'statedDeductionsTotal',
}

/**
 * The deductions table — the half a person actually has to read, and now the
 * half they can correct.
 *
 * **This is where D-138's law and U11 meet.** The employer column is the one no
 * equation on an Israeli slip runs through, and a real run dropped every
 * employer amount on a two-figure row while both proofs passed. The column was
 * drawn for the eye; it is a field now, so noticing costs a correction rather
 * than a re-read of the same document by the same template.
 */
function Rows({
  reading,
  rows,
  groups,
  currency,
  onNameRow,
  onReading,
  onCreateType,
  onLook,
}: {
  reading: PayslipReading
  rows: readonly ReviewRow[]
  groups: readonly TypeGroup[]
  currency: CurrencyCode
  onNameRow: (field: string, deductionTypeId: string) => void
  onReading: (reading: PayslipReading) => void
  onCreateType: (name: string, kind: DeductionKind) => string | undefined
  onLook: (line: number | undefined) => void
}) {
  /** One row's one figure, set or cleared, by the anchor that produced it. */
  const editRow = (field: string, change: (row: DeductionReading) => DeductionReading): void => {
    onReading({
      ...reading,
      deductions: reading.deductions.map((entry) => (entry.field === field ? change(entry) : entry)),
    })
  }

  const setAmount = (
    field: string,
    key: 'employee' | 'employer' | 'basis',
    amount: Money | undefined,
  ): void =>
    editRow(field, (entry) => {
      const next = { ...entry }
      delete next[key]
      return amount === undefined ? next : { ...next, [key]: amount }
    })

  if (rows.length === 0) {
    return <p className="text-ink-secondary">No deduction lines were read off this paycheck.</p>
  }

  return (
    <section className="space-y-2">
      <h2 className="text-caption text-ink-secondary">
        What the paycheck lists, as read. Every figure is the document’s until you type over it; the
        names are yours, and this format keeps them.
      </h2>

      <table className="w-full">
        <thead>
          <tr className="border-b border-hairline text-caption text-ink-secondary">
            <th className="py-1 text-left font-medium">On the paycheck</th>
            <th className="py-1 text-left font-medium">Deduction type</th>
            <th className="py-1 text-right font-medium">From you</th>
            <th className="py-1 text-right font-medium">From the employer</th>
            <th className="py-1 text-right font-medium">Basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.field}
              className="border-b border-hairline"
              // Pointing at a row marks the line it was read off. `onFocus`
              // bubbles in React, so tabbing into the row's picker marks it
              // too — which is the whole of the keyboard equivalent.
              onMouseEnter={() => onLook(row.line)}
              onMouseLeave={() => onLook(undefined)}
              onFocus={() => onLook(row.line)}
              onBlur={() => onLook(undefined)}
            >
              <td className="py-1 pr-3">
                {/*
                  The document's own font says these glyphs are Latin symbols
                  when the shapes are Hebrew (D-144), so an unreadable label is
                  an empty field carrying the row's place rather than a string
                  that says nothing — and a person holding the page can now
                  write what it actually says.

                  **What is typed names the row here; it does not move the
                  anchor.** The format matches on the document's own bytes,
                  which is what finds this line again next month, and those are
                  exactly the bytes nobody can read.
                */}
                <WordField
                  value={row.labelIsReadable ? row.label : undefined}
                  label={`Row ${index + 1} on the paycheck`}
                  placeholder={row.labelIsReadable ? undefined : `Row ${index + 1}, unreadable`}
                  onCommit={(label) =>
                    editRow(row.field, (entry) => ({ ...entry, label: label ?? '' }))
                  }
                />
              </td>
              <td className="py-1 pr-3">
                {/*
                  The picker rather than a label, because this is the one column
                  on the slip no arithmetic can ever check and the only one whose
                  answer has to come from a person (D-138, D-145). Naming it here
                  rather than in the form below means the answer is known while
                  the template is being stored, which is what lets the format
                  keep it — an employer's own wording for a fund never matches a
                  deduction type by name, so without this the same question is
                  asked every month forever.
                */}
                <DeductionTypeSelect
                  groups={groups}
                  value={row.deductionTypeId ?? ''}
                  onChange={(deductionTypeId) => onNameRow(row.field, deductionTypeId)}
                  onCreate={onCreateType}
                />
              </td>
              <Cell
                value={row.employee}
                currency={currency}
                label={`Row ${index + 1}, from you`}
                onCommit={(amount) => setAmount(row.field, 'employee', amount)}
              />
              <Cell
                value={row.employer}
                currency={currency}
                label={`Row ${index + 1}, from the employer`}
                onCommit={(amount) => setAmount(row.field, 'employer', amount)}
              />
              <Cell
                value={row.basis}
                currency={currency}
                label={`Row ${index + 1}, basis`}
                onCommit={(amount) => setAmount(row.field, 'basis', amount)}
              />
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-caption text-ink-tertiary">
        The basis is the salary a line’s percentages were worked out on, and it is not the gross —
        it travels into the form, where it has a column you can correct, and it is the only figure
        here that can be set against the salary your fund’s own deposit table prints.
      </p>
    </section>
  )
}

/**
 * One figure in the table, as a field.
 *
 * **A blank cell is not a zero**: the slip printed a dash there, and committing
 * a zero would turn "this row has no employer side" into "this row's employer
 * paid nothing", which is a claim. The field commits nothing and the sum treats
 * it as absent, exactly as the reading did.
 */
function Cell({
  value,
  currency,
  label,
  onCommit,
}: {
  value: Money | undefined
  currency: CurrencyCode
  label: string
  onCommit: (value: Money | undefined) => void
}) {
  return (
    <td className="py-1 pl-3 text-right">
      <AmountField value={value} currency={currency} label={label} onCommit={onCommit} />
    </td>
  )
}

/** Everything worth a second look, above the button rather than under it. */
function Doubts({
  review,
  attempts,
  notice,
  lines,
  onLook,
  onShow,
}: {
  review: PayslipReview
  attempts: readonly string[]
  notice?: string | undefined
  lines: Readonly<Record<string, number>>
  onLook: (line: number | undefined) => void
  onShow: () => void
}) {
  if (review.doubts.length === 0 && attempts.length === 0 && notice === undefined) {
    return (
      <p className="text-ink-secondary">
        Everything on this paycheck was read, named and checked. Accept it and the form is filled in.
      </p>
    )
  }

  return (
    <section className="space-y-2">
      <h2 className="text-caption text-ink-secondary">Worth a look before you accept</h2>
      {notice !== undefined && <p className="text-ink">{notice}</p>}
      <ul className="space-y-1">
        {review.doubts.map((doubt) => (
          <li key={doubt.field} className="text-ink">
            {/* The doubts are the sentences that name a line number — "taken
                from line 34, beside the line 33 the template names" — so they
                are the first place a person wants the page. */}
            <Look line={lineOf(lines, doubt.field)} onLook={onLook} onShow={onShow}>
              {doubt.message}
            </Look>
          </li>
        ))}
      </ul>

      {attempts.length > 0 && (
        <ul className="space-y-1 pt-2">
          {attempts.map((attempt) => (
            <li key={attempt} className="text-caption text-ink-tertiary">
              {attempt}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
