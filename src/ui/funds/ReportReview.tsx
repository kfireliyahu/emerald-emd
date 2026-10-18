import { useState } from 'react'

import { formatMoney, type CurrencyCode, type Money } from '@/core/money.ts'
import { storesTemplate } from '@/data/importer/documentLadder.ts'
import type { ReportRead } from '@/data/importer/fundLadder.ts'
import type { LocalDate } from '@/core/time.ts'
import type { FundReportReading, ReadDeposit } from '@/domain/model/funds.ts'
import type { AccountChange, AccountEdits, ReportReview as Review } from '@/domain/review.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { AmountField, DateField, FIGURE_FIELD } from '@/ui/documents/ReadField.tsx'
import { DocumentPane } from '@/ui/documents/DocumentPane.tsx'
import { Look, lineOf } from '@/ui/documents/Look.tsx'
import type { DocumentSource } from '@/ui/documents/openDocumentText.ts'
import { FlowFrame } from '@/ui/components/FlowFrame.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { FormatPicker } from '@/ui/paychecks/FormatPicker.tsx'

import { DepositRows } from './DepositRows.tsx'

/**
 * What a person is shown before a read fund report becomes a reading — the
 * payslip confirm surface's argument (D-140), for the document F17 says has the
 * weakest verifier of the three.
 *
 * **The layout is the same claim and the strip says a different thing.** A slip
 * proves itself twice over on every slip ever printed, so its strip either
 * vouches for three figures or does not. A report has three possible equations
 * and often prints none of their terms, so the strip has a third state —
 * **nothing here was checked** — and it is drawn as plainly as the other two. That is not a
 * hedge: an unchecked reading that looked like a checked one is precisely the
 * failure D-138 was written about, and the difference between a fee misread by a
 * digit and a fee read correctly compounds for thirty years.
 *
 * **One accept, with the doubts above it** (D-092), and accepting **fills the
 * form** rather than saving anything. The reading lands in the same
 * `SnapshotEditor` a typed one lands in, with the same validation and the same
 * save button, so "nothing is written without a human action" is kept by there
 * being no other way through.
 *
 * **And every figure on it is a field** (M16 U11, D-205). This is the document
 * that most needed it: a report whose proof is `unchecked` had a surface that
 * said so and gave a person nothing to do about it but read the same page
 * through the same template again. Now the fee that was not read is a blank
 * field, typing it in can turn `unchecked` into a period equation that runs,
 * and `restateReport` re-runs all three on every keystroke — so the strip
 * describes the figures the accept will use rather than the ones the template
 * produced.
 */
export function ReportReview({
  outcome,
  review,
  formats,
  currency,
  fundName,
  accountChanges,
  accountEdits,
  onAccountEdit,
  applyToFund,
  onApplyToFund,
  name,
  notice,
  source,
  onName,
  onReading,
  onUseFormat,
  onAccept,
  onDecline,
  onLeave,
  progress,
  onSkip,
  leaveLabel,
}: {
  outcome: ReportRead
  review: Review
  formats: readonly ReportRead['stored'][]
  /** The currency a figure typed into a blank field is in. */
  currency: CurrencyCode
  fundName: string
  /** What the report says about the fund that the document does not (D-152). */
  accountChanges: readonly AccountChange[]
  /** What the user typed over, keyed by field. Empty until they touch one. */
  accountEdits: AccountEdits
  onAccountEdit: (field: AccountChange['field'], value: string) => void
  applyToFund: boolean
  onApplyToFund: (apply: boolean) => void
  /** What this format will be stored as. Only asked when there is nothing stored yet. */
  name: string
  notice?: string | undefined
  /**
   * The PDF this reading came off, when it came off one (D-168) — absent for
   * pasted text, and dropped again the moment the text is edited.
   */
  source?: DocumentSource | undefined
  onName: (name: string) => void
  /**
   * A figure typed over — the reading as it now stands, restated (M16 U11).
   *
   * The edit goes into the reading rather than beside it, for D-205's reason:
   * an overlay would be two versions of every figure with one of them reaching
   * the accept, which is the shape D-138's law says goes wrong.
   */
  onReading: (reading: FundReportReading) => void
  onUseFormat: (id: string) => void
  onAccept: () => void
  onDecline: () => void
  /** Out of the flow entirely, back to the fund. Discard only drops the reading. */
  onLeave: () => void
  /** Where this document sits in a stack being read in one sitting (D-164). */
  progress?: React.ReactNode
  /**
   * Given only inside a batch: this document is not one to keep, take the next.
   *
   * A third verb, and it is not Discard wearing a different word. Discard drops
   * the *reading* and keeps the text, which is how a misread report gets read
   * again with another format; skip drops the *document* and moves on, which is
   * what a person does with the annual summary that turned out to be a duplicate
   * of two quarterlies. Without it the only way past a document you do not want
   * is to leave the flow, which throws away the seven behind it.
   */
  onSkip?: (() => void) | undefined
  /**
   * Where leaving goes, named — `FlowFrame`'s rule, and it stopped being a
   * constant when onboarding gained the same flow (D-166). "Back to the list"
   * is a lie in a wizard step that has no list behind it.
   */
  leaveLabel: string
}) {
  /**
   * Whether accepting also **stores** the template — and a report is where this
   * rule had to be stated rather than inherited.
   *
   * A payslip template is stored only while it reconciles, because a slip that
   * does not add up was read by a map that has never once been right. A report
   * that printed nothing to check is not that: it is a document with no
   * arithmetic, and refusing to remember its format would mean asking a model
   * about the same statement every quarter forever. So `failed` never stores,
   * and `unchecked` stores on the strength of the human action that is this
   * button — which is the milestone's standing rule, not an exception to it.
   */
  const remembers = storesTemplate(outcome) && review.proof !== 'failed'
  const names = remembers && outcome.stored === undefined
  const accept = names
    ? 'Accept and remember this format'
    : remembers
      ? 'Accept and read reports like this one with it'
      : 'Accept'

  // The page, and the line being pointed at (D-168). Off until asked for: a
  // render is work, and a backfill of eight quarterlies under a stored format
  // has no reason to draw eight documents nobody is going to look at.
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
            <>A reader was worked out for this report. You are looking at what it read.</>
          )}
          {outcome.source === 'chosen' && (
            <>
              Read with the reader you picked. If the figures below are right, accepting teaches
              this document to reach for it on a report like this one.
            </>
          )}
        </>
      }
      actions={
        <>
          {progress}
          {source !== undefined && (
            <Button variant="ghost" size="sm" onClick={() => setShowing(!showing)}>
              {showing ? 'Hide the document' : 'Show the document'}
            </Button>
          )}
          <FormatPicker
            formats={formats.filter((format) => format !== undefined)}
            current={outcome.stored?.id}
            onPick={onUseFormat}
          />
        </>
      }
      leaveLabel={leaveLabel}
      onLeave={onLeave}
      // **Pinned, and drawn once.** Accept and Discard used to be at both ends
      // of the surface because it is long enough to scroll past either — which
      // is two copies of two controls, and D-152's whole finding is that the
      // things a person has to *correct* here are in the middle. A footer that
      // does not scroll is the same answer with half the buttons.
      footer={
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-3 px-6 py-3">
          <Button variant="primary" onClick={onAccept}>
            {accept}
          </Button>
          <Button variant="ghost" onClick={onDecline}>
            Discard
          </Button>
          {onSkip !== undefined && (
            <Button variant="ghost" onClick={onSkip}>
              Skip this report
            </Button>
          )}
          <span className="text-caption text-ink-tertiary">
            Accepting fills in the reading form. Nothing is saved until you save it there.
            {storesTemplate(outcome) && review.proof === 'failed' && (
              <> This report does not add up, so the reader that read it is not kept.</>
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
              : 'mx-auto max-w-[900px]'
          }
        >
          <div className="space-y-6">
          <Proof
            reading={outcome.reading}
            review={review}
            fundName={fundName}
            onReading={onReading}
          />

          {names && (
            <label className="flex flex-wrap items-center gap-2 text-ink-secondary">
              Call this format
              <input
                className={`${FIELD} w-64`}
                value={name}
                onChange={(event) => onName(event.target.value)}
                placeholder="e.g. Menora annual statement"
              />
              <span className="text-caption text-ink-tertiary">
                Every later report that looks like this one is read with it, and nothing is asked
                again.
              </span>
            </label>
          )}

          <Figures
            reading={outcome.reading}
            review={review}
            currency={currency}
            lines={lines}
            onReading={onReading}
            onLook={setLook}
            onShow={() => setShowing(true)}
          />

          <DepositRows
            rows={review.deposits}
            addUp={review.depositsAddUp}
            currency={currency}
            onRows={(depositRows: readonly ReadDeposit[]) =>
              onReading({ ...outcome.reading, depositRows })
            }
          />

          <AboutTheFund
            changes={accountChanges}
            edits={accountEdits}
            onEdit={onAccountEdit}
            apply={applyToFund}
            onApply={onApplyToFund}
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
            <div className="fc-pop-enter sticky top-0 space-y-2">
              <p className="text-caption text-ink-tertiary">
                The document, as it was read. Point at a figure and its line is marked on the page.
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
 * What the report says about the **fund**, as opposed to about the period — and
 * the one place on this surface where a person edits rather than accepts.
 *
 * F13's whole premise is that nobody knows what their management fees are, and
 * the quarterly report is the one document that states them. But no equation on
 * the page runs through a fee *rate*, and on the first real report the model
 * took the market average printed beside it and a deposit-table row for the
 * employer — D-138 exactly: **a figure nothing checks needs a person, not a
 * better prompt** (D-152).
 *
 * So these four are typed over, not merely ticked. And the correction does not
 * stay a value: `retargetToValue` finds the line that carries what was typed and
 * moves the template's anchor to it, so next quarter's report reads the right
 * line with no model and no question.
 */
function AboutTheFund({
  changes,
  edits,
  onEdit,
  apply,
  onApply,
}: {
  changes: readonly AccountChange[]
  edits: AccountEdits
  onEdit: (field: AccountChange['field'], value: string) => void
  apply: boolean
  onApply: (apply: boolean) => void
}) {
  if (changes.length === 0) return null

  return (
    <div className="rounded-lg border border-hairline px-4 py-3">
      <p className="text-label text-ink-tertiary uppercase">What this says about the fund</p>

      <ul className="mt-2 space-y-2">
        {changes.map((change) => (
          <li key={change.field} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-40 shrink-0 text-ink-secondary">{change.label}</span>
            {change.from !== undefined && (
              <>
                <Bidi className="text-ink-tertiary line-through">{change.from}</Bidi>
                <span className="text-ink-tertiary">→</span>
              </>
            )}
            <input
              className={`${FIELD} w-48`}
              value={edits[change.field] ?? change.to}
              onChange={(event) => onEdit(change.field, event.target.value)}
              aria-label={change.label}
              dir="auto"
            />
            {change.from === undefined && (
              <span className="text-caption text-ink-tertiary">not recorded until now</span>
            )}
          </li>
        ))}
      </ul>

      <label className="mt-3 flex items-center gap-2 text-caption text-ink-secondary">
        <input
          type="checkbox"
          checked={apply}
          onChange={(event) => onApply(event.target.checked)}
          className="accent-accent"
        />
        Update the fund with {changes.length === 1 ? 'this' : 'these'} when I accept
      </label>

      <p className="mt-1 text-caption text-ink-tertiary">
        Nothing on the report checks these, so read them against the page — the fee especially. A
        report often prints the market average beside your own rate. Correcting one here also
        teaches the format where to look, so the next report gets it right on its own.
      </p>
    </div>
  )
}

/**
 * The strip: what the report proved about itself, in three states.
 *
 * `unchecked` is drawn in the ordinary ink rather than in red — it is not a
 * failure, it is the absence of an opinion, and colouring it as a problem would
 * teach people to ignore the colour on the reports that genuinely do not add up.
 */
function Proof({
  reading,
  review,
  fundName,
  onReading,
}: {
  reading: FundReportReading
  review: Review
  fundName: string
  onReading: (reading: FundReportReading) => void
}) {
  const verdict =
    review.proof === 'proved'
      ? 'The report agrees with itself, so these figures are what it says.'
      : review.proof === 'failed'
        ? 'The report does not agree with itself. Read every figure below against the page.'
        : 'Nothing on this report checks these figures. Read them against the page — that is the only check there is.'

  return (
    <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Bidi className="font-medium">{fundName}</Bidi>
        {/* **The two dates, always drawn** (M16 U11). The as-of date is what
            the reading is filed under and the period start is what D-152's
            double-count doubt is about; a report whose date did not read used
            to say nothing here at all. */}
        <label className="flex items-center gap-2 text-caption text-ink-secondary">
          as of
          <DateField
            value={reading.asOfDate}
            label="The report’s date"
            className={`${FIELD} h-7`}
            onCommit={(asOfDate) => onReading(withDate(reading, 'asOfDate', asOfDate))}
          />
        </label>
        <label className="flex items-center gap-2 text-caption text-ink-secondary">
          covering from
          <DateField
            value={reading.periodStart}
            label="The start of the period"
            className={`${FIELD} h-7`}
            onCommit={(periodStart) => onReading(withDate(reading, 'periodStart', periodStart))}
          />
        </label>
        <span
          className={`ml-auto text-caption ${
            review.proof === 'proved'
              ? 'text-positive'
              : review.proof === 'failed'
                ? 'text-negative'
                : 'text-ink-tertiary'
          }`}
        >
          {review.proof === 'proved'
            ? 'checked'
            : review.proof === 'failed'
              ? 'does not add up'
              : 'nothing checked it'}
        </span>
      </div>

      <p className="mt-2 text-ink-secondary">{verdict}</p>

      <ul className="mt-3 space-y-1 text-caption">
        {review.checks.map((check) => (
          <li key={check.label} className="flex flex-wrap items-baseline gap-x-3">
            <span className="tabular-nums">
              {check.delta === undefined ? (
                <span className="text-ink-tertiary">not printed</span>
              ) : (
                <span className={check.passed ? 'text-positive' : 'text-negative'}>
                  {formatMoney(check.delta)}
                </span>
              )}
            </span>
            <span className="text-ink-tertiary">{check.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A date set or cleared. Deleted rather than set to `undefined`, because
 * `exactOptionalPropertyTypes` keeps "the report printed no date" and "the date
 * is nothing" apart — and D-152's overlap doubt only asks its question where
 * there is a period start to ask it about.
 */
function withDate(
  reading: FundReportReading,
  key: 'asOfDate' | 'periodStart',
  value: LocalDate | undefined,
): FundReportReading {
  const next = { ...reading }
  delete next[key]
  return value === undefined ? next : { ...next, [key]: value }
}

/**
 * Every figure read, with whether an equation runs through it — and each of them
 * a field (M16 U11).
 *
 * **The eight the reading has slots for are drawn whether or not the report
 * printed them**, which is the change that matters here. A management fee that
 * did not read was a doubt with no remedy on the same screen; it is a blank row
 * now, and typing the figure off the page can complete the period equation.
 * Charges and adjustments are drawn only where the report has them, because
 * they are *rows* the movements block produced rather than slots a report
 * either fills or does not.
 */
function Figures({
  reading,
  review,
  currency,
  lines,
  onReading,
  onLook,
  onShow,
}: {
  reading: FundReportReading
  review: Review
  currency: CurrencyCode
  lines: Readonly<Record<string, number>>
  onReading: (reading: FundReportReading) => void
  onLook: (line: number | undefined) => void
  onShow: () => void
}) {
  if (review.figures.length === 0) {
    return (
      <p className="text-ink-secondary">
        No figures were read from this report at all. The reader that read it is looking at the
        wrong page.
      </p>
    )
  }

  /**
   * What one field writes back to.
   *
   * A charge and an adjustment are positions in an array; everything else is a
   * named slot on the reading, and clearing one is `undefined` rather than zero
   * — a report that prints no fee is not a report that charged nothing.
   */
  const commit = (field: string, amount: Money | undefined): void => {
    const list = /^(charge|adjustment)\[(\d+)\]$/.exec(field)
    if (list?.[1] !== undefined && list[2] !== undefined) {
      const key = list[1] === 'charge' ? 'charges' : 'adjustments'
      const at = Number(list[2])
      // A cleared charge leaves the block rather than becoming zero: the row
      // exists because the movements block printed a line, and deleting the
      // figure is saying it did not.
      const next = reading[key].flatMap((entry, index) =>
        index !== at ? [entry] : amount === undefined ? [] : [amount],
      )
      onReading({ ...reading, [key]: next })
      return
    }
    const slot = { ...reading }
    delete slot[field as keyof FundReportReading as 'closingBalance']
    onReading(amount === undefined ? slot : { ...slot, [field]: amount })
  }

  return (
    <div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
            <th className="py-2 text-left font-medium">On the report</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 text-left font-medium">Checked</th>
          </tr>
        </thead>
        <tbody>
          {review.figures.map((figure) => (
            <tr
              key={figure.field}
              className="border-b border-hairline"
              // D-152's finding, made checkable: an insurance cost is not a
              // management fee, and a person comparing this against the page
              // needs to find each line where the page prints it.
              onMouseEnter={() => onLook(lineOf(lines, figure.field))}
              onMouseLeave={() => onLook(undefined)}
              onFocus={() => onLook(lineOf(lines, figure.field))}
              onBlur={() => onLook(undefined)}
              onClick={onShow}
            >
              <td className="py-1">{figure.label}</td>
              <td className="px-3 py-1 text-right">
                <AmountField
                  value={figure.amount}
                  currency={currency}
                  label={figure.label}
                  className={`${FIGURE_FIELD} w-32`}
                  onCommit={(amount) => commit(figure.field, amount)}
                />
              </td>
              <td className="px-3 py-1 text-caption">
                {figure.proved ? (
                  <span className="text-positive">an equation runs through it</span>
                ) : figure.amount === undefined ? (
                  <span className="text-ink-tertiary">not read</span>
                ) : (
                  <span className="text-ink-tertiary">nothing checks it</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-caption text-ink-tertiary">
        A figure nothing checks is not a figure that is wrong — it is one the document gives no way
        to check, and the only check is you. A blank one is a figure the report was not read as
        printing: type it in and whichever equation was waiting for it runs.
      </p>
    </div>
  )
}

/** Everything worth a second look, above the button rather than under it (D-092). */
function Doubts({
  review,
  attempts,
  notice,
  lines,
  onLook,
  onShow,
}: {
  review: Review
  attempts: readonly string[]
  notice: string | undefined
  lines: Readonly<Record<string, number>>
  onLook: (line: number | undefined) => void
  onShow: () => void
}) {
  if (review.doubts.length === 0 && attempts.length === 0 && notice === undefined) return null

  return (
    <div className="rounded-lg border border-hairline px-4 py-3">
      <p className="text-label text-ink-tertiary uppercase">Worth a look before you accept</p>
      <ul className="mt-2 space-y-1.5 text-ink-secondary">
        {notice !== undefined && <li key="notice">{notice}</li>}
        {review.doubts.map((doubt) => (
          <li key={`${doubt.field}:${doubt.message}`}>
            <Look line={lineOf(lines, doubt.field)} onLook={onLook} onShow={onShow}>
              {doubt.message}
            </Look>
          </li>
        ))}
        {attempts.map((attempt) => (
          <li key={attempt} className="text-ink-tertiary">
            {attempt}
          </li>
        ))}
      </ul>
    </div>
  )
}
