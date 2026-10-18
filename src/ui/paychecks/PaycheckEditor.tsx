import { useState } from 'react'

import { zero, type CurrencyCode } from '@/core/money.ts'
import { formatYearMonth, parseISODate, parseYearMonth, toISODate, toYearMonthString } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { DeductionKind, DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import { netReducingTotal } from '@/domain/paycheck.ts'
import {
  blankLine,
  copiedFrom,
  draftDelta,
  draftEntry,
  draftProblems,
  grossToNet,
  pickerGroups,
  recentTypeIds,
  withDifferenceAsLine,
  type DraftLine,
  type DraftProblem,
  type PaycheckDraft,
} from '@/domain/paycheckEntry.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { FlowFrame } from '@/ui/components/FlowFrame.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'
import { DeductionTypeSelect } from '@/ui/paychecks/DeductionTypeSelect.tsx'
import { ReconciliationStrip } from '@/ui/paychecks/ReconciliationStrip.tsx'
import { today } from '@/ui/today.ts'

/**
 * Entering one payslip — F04's entry flow, in the order the slip is read:
 * which month, what it paid, then where the difference went.
 *
 * **Text lives here, numbers live in the draft.** Every amount field keeps what
 * was typed as a string and hands the parsed `Money` to the draft, the way the
 * rule editor keeps its bound text. That is what lets `₪1,234.56` pasted
 * straight off a slip work, and it is read by `parseAmountText` — the same
 * reader the importer uses on statement cells, rather than a second one that
 * could disagree about a trailing minus.
 *
 * Everything the form decides, it asks the domain: `draftProblems` for what
 * cannot be saved, `draftDelta` for the strip. The editor has no opinion of its
 * own about a payslip.
 */
export function PaycheckEditor({
  initial,
  isNew,
  currency,
  types,
  history,
  onSave,
  onCancel,
  onCreateType,
  leaveLabel,
}: {
  initial: PaycheckDraft
  isNew: boolean
  currency: CurrencyCode
  types: readonly DeductionType[]
  /** Every slip already entered: the copy offer and the picker's recents come from it. */
  history: readonly PaycheckWithLines[]
  onSave: (draft: PaycheckDraft) => void
  onCancel: () => void
  onCreateType: (name: string, kind: DeductionKind) => string | undefined
  /**
   * Where leaving goes, named — `FlowFrame`'s rule, and it stopped being a
   * constant when onboarding gained the same flow (D-166). "Back to the list"
   * is a lie in a wizard step that has no list behind it.
   */
  leaveLabel?: string | undefined
}) {
  const [draft, setDraft] = useState(initial)
  const [grossText, setGrossText] = useState(() => editableMoney(initial.gross))
  const [netText, setNetText] = useState(() => editableMoney(initial.net))
  const [lineText, setLineText] = useState<Readonly<Record<string, LineText>>>(() =>
    textsFor(initial),
  )
  const [periodText, setPeriodText] = useState(() => toYearMonthString(initial.period))
  const [dateText, setDateText] = useState(() => toISODate(initial.paymentDate))

  /** Replace everything at once — what "copy from last month" does. */
  const load = (next: PaycheckDraft): void => {
    setDraft(next)
    setGrossText(editableMoney(next.gross))
    setNetText(editableMoney(next.net))
    setLineText(textsFor(next))
    setPeriodText(toYearMonthString(next.period))
    setDateText(toISODate(next.paymentDate))
  }

  const setLine = (key: string, change: Partial<DraftLine>): void =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...change } : line)),
    }))

  const setLineAmount = (key: string, field: keyof LineText, text: string): void => {
    setLineText((current) => ({
      ...current,
      [key]: { ...(current[key] ?? BLANK_TEXT), [field]: text },
    }))
    const parsed = moneyFromText(text, currency, { magnitude: true })
    const blank = text.trim() === ''
    setLine(
      key,
      field === 'employee'
        ? { employee: parsed ?? zero(currency) }
        : // An empty employer field is not an employer share of zero: it is a
          // deduction with no employer side at all (D-048). A blank base is the
          // same shape and the commoner case — most slips print one on the
          // pension row and nowhere else.
          field === 'employer'
          ? { employer: blank ? undefined : parsed }
          : { basis: blank ? undefined : parsed },
    )
  }

  const addLine = (): void => {
    const line = blankLine(currency)
    setLineText((current) => ({ ...current, [line.key]: BLANK_TEXT }))
    setDraft((current) => ({ ...current, lines: [...current.lines, line] }))
  }

  const removeLine = (key: string): void =>
    setDraft((current) => ({ ...current, lines: current.lines.filter((line) => line.key !== key) }))

  /**
   * The strip's one-tap fix. It appends rather than reloading the form: a
   * reload would reformat `25000` into `25,000.00` under a cursor that is still
   * in the field, which is the app editing what the user is typing.
   */
  const addDifference = (deductionTypeId: string): void => {
    const next = withDifferenceAsLine(draft, deductionTypeId, types)
    const added = next.lines.at(-1)
    if (next === draft || added === undefined) return

    setLineText((current) => ({
      ...current,
      [added.key]: { employee: editableMoney(added.employee), employer: '', basis: '' },
    }))
    setDraft(next)
  }

  const entry = draftEntry(draft)
  const problems = draftProblems(draft)
  const delta = draftDelta(draft, types)
  const other = types.find((type) => type.kind === 'OTHER_DEDUCTION')
  const groups = pickerGroups(types, recentTypeIds(history))

  // Offered only while it is still an offer: once the form has lines, filling
  // them from last month would throw away what has been typed.
  const previous = isNew && draft.lines.length === 0 ? history[0] : undefined

  /**
   * A slip already recorded for this month — the warning that stands in for the
   * uniqueness constraint the schema deliberately does not have (D-048).
   *
   * It says so and does nothing else. A 13th salary and a second job both put
   * two slips in one month legitimately, and the app cannot tell those apart
   * from entering June twice; the user can.
   */
  const alreadyEntered = history.filter(
    (entry) =>
      entry.paycheck.period.year === draft.period.year &&
      entry.paycheck.period.month === draft.period.month,
  )

  return (
    <FlowFrame
      title={isNew ? 'New paycheck' : 'Edit paycheck'}
      leaveLabel={leaveLabel ?? 'Back to the list'}
      onLeave={onCancel}
      onSubmit={() => {
        if (problems.length === 0) onSave(draft)
      }}
      actions={
        previous === undefined ? undefined : (
          <Button variant="secondary" size="sm" onClick={() => load(copiedFrom(previous, today()))}>
            Copy {formatYearMonth(previous.paycheck.period)}
          </Button>
        )
      }
      footer={
        /* Pinned, because it is the number being watched while the lines are
           typed (F04). */
        <div className="bg-surface px-6 py-3">
          <ReconciliationStrip
            delta={delta}
            grossToNet={grossToNet(draft)}
            itemized={netReducingTotal(entry, types)}
            idle={draft.gross.minor === 0 && draft.net.minor === 0}
            onAddDifference={other === undefined ? undefined : () => addDifference(other.id)}
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
              {isNew ? 'Add paycheck' : 'Save'}
            </Button>

            <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
              {problems.map((problem) => (
                <span key={problem}>{PROBLEM_MESSAGE[problem]}</span>
              ))}
              {unreadable(grossText) && <span>Gross is not a number</span>}
              {unreadable(netText) && <span>Net is not a number</span>}
            </span>

            <span className="ml-auto text-caption text-ink-tertiary">
              Nothing is written to your document until you save it.
            </span>
          </div>
        </div>
      }
    >
      <div className="px-6 py-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Field label="Salary month" hint="not the month it was paid in">
            <input
              // Degrades to a plain text field where `type="month"` is not
              // supported, and `YYYY-MM` is exactly what this reads back.
              type="month"
              value={periodText}
              onChange={(event) => {
                setPeriodText(event.target.value)
                const period = parseYearMonth(event.target.value)
                if (period !== undefined) setDraft((current) => ({ ...current, period }))
              }}
              placeholder="2026-06"
              aria-label="Salary month"
              className={`${FIELD} w-40 tabular-nums`}
            />
          </Field>


          <Field label="Payment date" hint="when it landed">
            <input
              type="date"
              value={dateText}
              onChange={(event) => {
                setDateText(event.target.value)
                const paymentDate = parseISODate(event.target.value)
                if (paymentDate !== undefined) setDraft((current) => ({ ...current, paymentDate }))
              }}
              aria-label="Payment date"
              className={`${FIELD} w-44 tabular-nums`}
            />
          </Field>

          <Field label="Employer" hint="only if there is more than one">
            <input
              value={draft.employerName}
              onChange={(event) =>
                setDraft((current) => ({ ...current, employerName: event.target.value }))
              }
              placeholder="optional"
              aria-label="Employer"
              dir="auto"
              className={`${FIELD} w-52`}
            />
          </Field>
        </div>

        {/* Its own line rather than a fourth field: it is about the month
            above, and squeezing it into that row pushes the payment date onto a
            second line every time it appears. */}
        {alreadyEntered.length > 0 && (
          <p className="mt-2 text-caption text-ink-secondary">
            {formatYearMonth(draft.period)} already has{' '}
            {alreadyEntered.length === 1 ? 'a paycheck' : `${alreadyEntered.length} paychecks`}. A
            bonus paycheck or a second job belongs here too — this is a note, not a refusal.
          </p>
        )}

        {/* The two numbers the user can always read off the slip, given the
            room that says so. Everything below is optional detail. */}
        <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
          <Field label="Gross" hint="before anything came out">
            <input
              autoFocus
              value={grossText}
              onChange={(event) => {
                setGrossText(event.target.value)
                setDraft((current) => ({
                  ...current,
                  gross: moneyFromText(event.target.value, currency, { magnitude: true }) ?? zero(currency),
                }))
              }}
              placeholder="0.00"
              aria-label="Gross amount"
              className={`${FIELD} h-10 w-44 text-secondary-number tabular-nums`}
            />
          </Field>

          <Field label="Net" hint="what reached the bank — never computed">
            <input
              value={netText}
              onChange={(event) => {
                setNetText(event.target.value)
                setDraft((current) => ({
                  ...current,
                  net: moneyFromText(event.target.value, currency, { magnitude: true }) ?? zero(currency),
                }))
              }}
              placeholder="0.00"
              aria-label="Net amount"
              className={`${FIELD} h-10 w-44 text-secondary-number tabular-nums`}
            />
          </Field>

          <label className="flex items-center gap-2 pb-1 text-ink-secondary select-none">
            <input
              type="checkbox"
              checked={draft.isIrregular}
              onChange={(event) =>
                setDraft((current) => ({ ...current, isIrregular: event.target.checked }))
              }
            />
            Bonus or 13th salary
            <span className="text-caption text-ink-tertiary">(averages leave it out)</span>
          </label>
        </div>

        {/* No header over no rows: an empty table of column names is furniture,
            and the sentence beside "Add a deduction" says more. */}
        <table className={`mt-6 w-full ${draft.lines.length === 0 ? 'hidden' : ''}`}>
          <thead>
            <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
              <th className="w-56 py-1 text-left font-medium">Deduction</th>
              <th className="w-36 py-1 pr-3 text-right font-medium">Employee</th>
              <th className="w-36 py-1 pr-3 text-right font-medium">Employer</th>
              {/* The base the percentages were computed on — a pensionable
                  salary, not the gross. Shown because it is stored, and stored
                  because the fund's own deposit table prints the same figure
                  and nothing could compare the two (D-169). */}
              <th className="w-36 py-1 pr-3 text-right font-medium">Base</th>
              <th className="py-1 text-left font-medium">Note</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((line) => (
              <tr key={line.key} className="border-b border-hairline">
                <td className="py-1 pr-3">
                  <DeductionTypeSelect
                    groups={groups}
                    value={line.deductionTypeId}
                    onChange={(deductionTypeId) => setLine(line.key, { deductionTypeId })}
                    onCreate={onCreateType}
                  />
                </td>
                <td className="py-1 pr-3 text-right">
                  <input
                    value={lineText[line.key]?.employee ?? ''}
                    onChange={(event) => setLineAmount(line.key, 'employee', event.target.value)}
                    placeholder="0.00"
                    aria-label="Amount deducted from the employee"
                    className={`${FIELD} h-7 w-32 text-right tabular-nums`}
                  />
                </td>
                <td className="py-1 pr-3 text-right">
                  <input
                    value={lineText[line.key]?.employer ?? ''}
                    onChange={(event) => setLineAmount(line.key, 'employer', event.target.value)}
                    placeholder="—"
                    aria-label="Employer's side of this deduction"
                    className={`${FIELD} h-7 w-32 text-right tabular-nums`}
                  />
                </td>
                <td className="py-1 pr-3 text-right">
                  <input
                    value={lineText[line.key]?.basis ?? ''}
                    onChange={(event) => setLineAmount(line.key, 'basis', event.target.value)}
                    placeholder="—"
                    aria-label="The salary this deduction was computed on"
                    className={`${FIELD} h-7 w-32 text-right tabular-nums`}
                  />
                </td>
                <td className="py-1 pr-3">
                  <input
                    value={line.note}
                    onChange={(event) => setLine(line.key, { note: event.target.value })}
                    aria-label="Note on this line"
                    dir="auto"
                    className={`${FIELD} h-7 w-full min-w-32`}
                  />
                </td>
                <td className="py-1 text-right">
                  <Button variant="ghost" size="sm" onClick={() => removeLine(line.key)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 flex items-center gap-4">
          <Button variant="secondary" size="sm" onClick={addLine}>
            Add a deduction
          </Button>
          {draft.lines.length === 0 && (
            <span className="text-caption text-ink-tertiary">
              A paycheck with no itemization is still a paycheck — gross and net are enough to save.
            </span>
          )}
        </div>

        <div className="mt-6 max-w-xl">
          <Field label="Note" hint="anything worth remembering about this month">
            <input
              value={draft.note}
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
              aria-label="Note"
              dir="auto"
              className={`${FIELD} w-full`}
            />
          </Field>
        </div>
      </div>

    </FlowFrame>
  )
}

interface LineText {
  readonly employee: string
  readonly employer: string
  readonly basis: string
}

const BLANK_TEXT: LineText = { employee: '', employer: '', basis: '' }

const PROBLEM_MESSAGE: Readonly<Record<DraftProblem, string>> = {
  NEGATIVE_NET: 'Net cannot be negative — check the sign',
  NEGATIVE_GROSS: 'Gross cannot be negative',
  NET_ABOVE_GROSS: 'Net is above gross — are the two swapped?',
  NEGATIVE_LINE: 'A deduction line is negative; enter what was taken, without the minus',
  MIXED_CURRENCY: 'Every amount on a paycheck has to be in one currency',
  LINE_WITHOUT_TYPE: 'One line has no deduction chosen',
}

function textsFor(draft: PaycheckDraft): Record<string, LineText> {
  const texts: Record<string, LineText> = {}
  for (const line of draft.lines) {
    texts[line.key] = {
      employee: editableMoney(line.employee),
      employer: editableMoney(line.employer),
      basis: editableMoney(line.basis),
    }
  }
  return texts
}

/** Typed, but not a number — as opposed to left empty, which means nothing yet. */
function unreadable(text: string): boolean {
  return text.trim() !== '' && parseAmountText(text) === undefined
}
