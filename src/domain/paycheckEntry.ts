/**
 * A payslip while it is being typed — F04's entry flow, as pure functions.
 *
 * The form's shape lives here rather than inside the component for the reason
 * `ruleEditing.ts` gives: a thing being typed has to become the real record
 * before anything can say whether it is sayable, and `validatePaycheck` must be
 * the only opinion about that. `draftEntry` is that conversion, so the editor
 * checks the same object it saves and the reconciliation strip runs the same
 * `reconciliationDelta` the paycheck detail will.
 *
 * **Amounts arrive already parsed.** Reading `₪1,234.56` off a typed field is
 * the screen's job — it holds the text, this holds the number — exactly as the
 * rule editor keeps its bound text in the component and its `Money` in the
 * draft. No React, no sql.js, no DOM (docs/conventions.md).
 */

import { newId } from '@/core/id.ts'
import { abs, subtract, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import { addMonths, yearMonthOf, type LocalDate, type YearMonth } from '@/core/time.ts'
import type {
  DeductionKind,
  DeductionType,
  Paycheck,
  PaycheckWithLines,
} from '@/domain/model/paycheck.ts'
import { reconciliationDelta, validatePaycheck, type PaycheckProblem } from '@/domain/paycheck.ts'
import type { PayslipReview } from '@/domain/review.ts'

/**
 * One line of the form.
 *
 * `key` is the line's identity while it is being edited and nothing more — a
 * saved line's id is the database's. Without one, deleting the third of eight
 * lines would leave React re-labelling the rows underneath it.
 *
 * `employer` is undefined when the field is empty, which is the same
 * distinction the stored column makes: no employer side at all, rather than an
 * employer side of nothing.
 */
export interface DraftLine {
  readonly key: string
  readonly deductionTypeId: string
  readonly employee: Money
  readonly employer: Money | undefined
  /**
   * The salary base the line's percentages were computed on, where the slip
   * prints one — and it is **not the gross** (D-169).
   *
   * Carried now, where four milestones deliberately dropped it. The old
   * argument was right about the danger and wrong about the remedy: a figure no
   * equation runs through, stored where nobody can see or correct it, is worse
   * than one not stored at all (D-138). The answer is the column in the form,
   * not the silence — because this is the one figure on the slip that can be
   * set against the base the fund's own deposit table prints, and without it
   * that check cannot be made at all.
   */
  readonly basis: Money | undefined
  readonly note: string
}

export interface PaycheckDraft {
  readonly period: YearMonth
  readonly paymentDate: LocalDate
  readonly employerName: string
  readonly gross: Money
  readonly net: Money
  readonly note: string
  readonly isIrregular: boolean
  readonly lines: readonly DraftLine[]
}

/**
 * A new slip, for the month before the one we are standing in.
 *
 * F04 defaults the period to the previous month because that is the slip that
 * has just arrived: salaries are paid in arrears, and a user opening this form
 * on 9 July is holding June's payslip. The payment date defaults to today for
 * the same reason — they are entering it because it landed.
 */
export function blankDraft(today: LocalDate, currency: CurrencyCode): PaycheckDraft {
  return {
    period: addMonths(yearMonthOf(today), -1),
    paymentDate: today,
    employerName: '',
    gross: zero(currency),
    net: zero(currency),
    note: '',
    isIrregular: false,
    lines: [],
  }
}

export function blankLine(currency: CurrencyCode, deductionTypeId = ''): DraftLine {
  return {
    key: newId(),
    deductionTypeId,
    employee: zero(currency),
    employer: undefined,
    basis: undefined,
    note: '',
  }
}

/** A saved slip, opened for editing. */
export function draftFrom(entry: PaycheckWithLines): PaycheckDraft {
  const { paycheck } = entry
  return {
    period: paycheck.period,
    paymentDate: paycheck.paymentDate,
    employerName: paycheck.employerName ?? '',
    gross: paycheck.gross,
    net: paycheck.net,
    note: paycheck.note ?? '',
    isIrregular: paycheck.isIrregular,
    lines: entry.lines.map((line) => ({
      key: line.id,
      deductionTypeId: line.deductionTypeId,
      employee: line.employeeAmount,
      employer: line.employerAmount,
      basis: line.basisAmount,
      note: line.note ?? '',
    })),
  }
}

/**
 * **Copy from last month** — F04's single biggest usability win, and the reason
 * entering a slip is a two-field task in the common case.
 *
 * Every line comes across with its amounts, because "the same as last month" is
 * true of most of them and the ones that moved are the ones the user is here to
 * change. What does **not** come across is the month, the payment date, and the
 * irregular flag: the period steps forward by one, the payment date is today,
 * and a bonus month is emphatically not a template for the next one.
 *
 * The note does not come across either. Last month's "13th salary" or "includes
 * back pay" is a fact about last month, and a note the user did not write is
 * worse than no note.
 */
export function copiedFrom(previous: PaycheckWithLines, today: LocalDate): PaycheckDraft {
  const copied = draftFrom(previous)
  return {
    ...copied,
    period: addMonths(previous.paycheck.period, 1),
    paymentDate: today,
    note: '',
    isIrregular: false,
    // New keys: these are new lines that happen to start with last month's
    // numbers, and reusing the saved ids would make two records claim one.
    lines: copied.lines.map((line) => ({ ...line, key: newId() })),
  }
}

/**
 * A read payslip as a form to check over — the accept at the end of the confirm
 * surface, and the only thing that happens when it is pressed.
 *
 * **It fills the form. It does not save anything.** The slip arrives where a
 * typed one arrives, in the editor, with the same validation, the same
 * reconciliation strip and the same save button — which is the milestone's
 * standing rule kept structurally rather than remembered: nothing is written
 * without a human action, and the human action is the one that was already
 * there.
 *
 * **A row the review could not name arrives with no type and the slip's own
 * words in its note.** `draftProblems` then reports `LINE_WITHOUT_TYPE` and the
 * editor will not save until a person has named it — which is D-132's line held
 * at the last possible moment: the template said where the deduction is, and
 * naming it is the user's.
 *
 * **The basis amounts are carried now** (D-169), where four milestones dropped
 * them. The old rule — read them, show them, do not store them — was right that
 * a figure no equation runs through must never be stored somewhere nobody can
 * see or correct it (D-138), and wrong that the remedy was silence: the form
 * has a column for the base, so it is visible and correctable exactly like the
 * employer's side beside it. What that buys is the only comparison this app can
 * make against a fund's own salary column. The plugin has always written
 * `basis_amount`; the app's editor now does too.
 */
export function draftFromSlip(
  review: PayslipReview,
  currency: CurrencyCode,
  today: LocalDate,
): PaycheckDraft {
  const amountOf = (field: string): Money =>
    review.figures.find((figure) => figure.field === field)?.amount ?? zero(currency)

  return {
    // A month nothing read is the month a blank form would have offered, and
    // the surface has already said it could not read one.
    period: review.salaryMonth ?? addMonths(yearMonthOf(today), -1),
    paymentDate: review.payDate ?? today,
    // Nothing reads an employer name off a slip: it is on the page, but no task
    // asks for it and no template field holds it. The user types it or leaves it.
    employerName: '',
    gross: amountOf('grossLine'),
    net: amountOf('netLine'),
    note: '',
    isIrregular: false,
    lines: review.rows.map((row) => ({
      key: newId(),
      deductionTypeId: row.deductionTypeId ?? '',
      // A dash in the employee column is an employer-only line — severance, on
      // every real slip — and zero is how the form already holds one.
      employee: row.employee ?? zero(currency),
      employer: row.employer,
      basis: row.basis,
      // The slip's own words, for a row the review could not name — unless the
      // words are not words, in which case the note would carry the same
      // nonsense into the saved record (D-144).
      note: row.deductionTypeId === undefined && row.labelIsReadable ? row.label : '',
    })),
  }
}

/**
 * The draft as the record it will become, so every figure in `paycheck.ts` can
 * be asked about it while it is still being typed.
 *
 * The ids are placeholders — a draft has no identity until it is saved — and
 * nothing that reads an entry reads them. Lines with no type chosen are left
 * in: an empty row the user has not filled in yet must not silently change the
 * delta by disappearing from it.
 */
export function draftEntry(draft: PaycheckDraft, id = 'draft'): PaycheckWithLines {
  const paycheck: Paycheck = {
    id,
    period: draft.period,
    paymentDate: draft.paymentDate,
    employerName: draft.employerName.trim() === '' ? undefined : draft.employerName.trim(),
    gross: draft.gross,
    net: draft.net,
    depositedToAccountId: undefined,
    note: draft.note.trim() === '' ? undefined : draft.note.trim(),
    sourceKind: 'MANUAL',
    attachmentRef: undefined,
    isIrregular: draft.isIrregular,
  }

  return {
    paycheck,
    lines: draft.lines.map((line, position) => ({
      id: line.key,
      paycheckId: id,
      deductionTypeId: line.deductionTypeId,
      employeeAmount: line.employee,
      employerAmount: line.employer,
      basisAmount: line.basis,
      note: line.note.trim() === '' ? undefined : line.note.trim(),
      sortOrder: position * 10,
    })),
  }
}

export type DraftProblem = PaycheckProblem | 'LINE_WITHOUT_TYPE'

/**
 * What stops this draft being saved — and deliberately not much.
 *
 * `validatePaycheck` is the whole of the money side, so the editor cannot
 * develop a second opinion about what a payslip may say. The one thing added
 * here belongs to the form rather than to the record: a line with no deduction
 * type chosen has nothing to be a line *of*.
 *
 * A non-zero reconciliation delta is not here and never will be. It is
 * information, and blocking on it would be the app arguing with the slip.
 */
export function draftProblems(draft: PaycheckDraft): readonly DraftProblem[] {
  const problems: DraftProblem[] = [...validatePaycheck(draftEntry(draft))]
  if (draft.lines.some((line) => line.deductionTypeId === '')) problems.push('LINE_WITHOUT_TYPE')
  return problems
}

/**
 * The one-tap fix beside the reconciliation strip: whatever is unaccounted for,
 * as a single line of the type given.
 *
 * The amount is the delta's **magnitude**, because a line holds a magnitude
 * (D-048). A negative delta means more has been itemized than the difference
 * allows, and adding another deduction would take it further from zero — so
 * there is nothing to offer, and this returns the draft untouched. The screen
 * only shows the button when the delta is positive.
 */
export function withDifferenceAsLine(
  draft: PaycheckDraft,
  deductionTypeId: string,
  types: readonly DeductionType[],
): PaycheckDraft {
  const delta = reconciliationDelta(draftEntry(draft), types)
  if (delta.minor <= 0) return draft

  return {
    ...draft,
    lines: [...draft.lines, { ...blankLine(delta.currency, deductionTypeId), employee: abs(delta) }],
  }
}

/**
 * How far the itemization is from the net, as the amount the strip shows.
 *
 * A thin pass-through so the screen has one import for the number it lives on,
 * and so the strip and the paycheck detail cannot end up calling different
 * things.
 */
export function draftDelta(draft: PaycheckDraft, types: readonly DeductionType[]): Money {
  return reconciliationDelta(draftEntry(draft), types)
}

/** What is left of the slip's own arithmetic: `gross − net`, the difference to be explained. */
export function grossToNet(draft: PaycheckDraft): Money {
  return subtract(draft.gross, draft.net)
}

/**
 * The types the user actually uses, most recent first.
 *
 * F04 wants the picker to lead with recents, and the honest source for "recent"
 * is the slips already entered: the types on the newest paycheck are the ones
 * this month's will almost certainly repeat. Ordered by the newest slip a type
 * appears on, so a type used once last year sits below one used last month.
 */
export function recentTypeIds(
  entries: readonly PaycheckWithLines[],
  limit = 12,
): readonly string[] {
  const newestFirst = [...entries].sort(
    (a, b) =>
      b.paycheck.period.year - a.paycheck.period.year ||
      b.paycheck.period.month - a.paycheck.period.month,
  )

  const seen: string[] = []
  for (const entry of newestFirst) {
    for (const line of entry.lines) {
      if (!seen.includes(line.deductionTypeId)) seen.push(line.deductionTypeId)
    }
    if (seen.length >= limit) break
  }

  return seen.slice(0, limit)
}

export interface TypeGroup {
  readonly label: string
  readonly types: readonly DeductionType[]
}

/** How the picker names each kind. English UI copy over Hebrew payroll terms. */
export const KIND_LABEL: Readonly<Record<DeductionKind, string>> = {
  TAX: 'Tax',
  SOCIAL_INSURANCE: 'National insurance',
  HEALTH: 'Health',
  PENSION: 'Pension',
  STUDY_FUND: 'Study fund',
  SEVERANCE: 'Severance',
  LOAN_REPAYMENT: 'Loan repayment',
  UNION: 'Union',
  BENEFIT_IN_KIND: 'Benefit in kind',
  OTHER_DEDUCTION: 'Other deduction',
  ADDITION: 'Addition',
}

/**
 * The picker's contents: recents first, then everything else grouped by kind.
 *
 * A type in the recents group is **not** repeated below it. Two copies of
 * "Pension" in one dropdown is a picker that looks broken, and the second one
 * teaches nothing the first did not.
 */
export function pickerGroups(
  types: readonly DeductionType[],
  recentIds: readonly string[],
): readonly TypeGroup[] {
  const byId = new Map(types.map((type) => [type.id, type]))
  const recents: DeductionType[] = []
  for (const id of recentIds) {
    const type = byId.get(id)
    if (type !== undefined) recents.push(type)
  }

  // Insertion-ordered, so the kinds appear in the order the vocabulary is
  // sorted in rather than in the order the enum happens to be written.
  const byKind = new Map<DeductionKind, DeductionType[]>()
  for (const type of types) {
    if (recentIds.includes(type.id)) continue
    const existing = byKind.get(type.kind)
    if (existing === undefined) byKind.set(type.kind, [type])
    else existing.push(type)
  }

  const groups: TypeGroup[] = [...byKind].map(([kind, members]) => ({
    label: KIND_LABEL[kind],
    types: members,
  }))

  return recents.length === 0 ? groups : [{ label: 'Recently used', types: recents }, ...groups]
}

/**
 * What a new type of a given kind starts as.
 *
 * The two flags are the whole reason F04 exists, and a user adding "Parking" in
 * the middle of entering a slip should not have to answer a question about
 * take-home pay to get on with it. The defaults are the truth for every kind:
 * employer-side and notional items do not reduce net, and the three wealth kinds
 * count as saving. Correcting one is what the deduction types screen is for.
 */
export function defaultFlags(kind: DeductionKind): {
  readonly reducesNet: boolean
  readonly countsAsSaving: boolean
} {
  switch (kind) {
    case 'PENSION':
    case 'STUDY_FUND':
      return { reducesNet: true, countsAsSaving: true }
    case 'SEVERANCE':
      // Employer-side money that accrues to the user without ever touching net.
      return { reducesNet: false, countsAsSaving: true }
    case 'BENEFIT_IN_KIND':
    case 'ADDITION':
      // Notional: inflates gross for tax without being cash.
      return { reducesNet: false, countsAsSaving: false }
    default:
      return { reducesNet: true, countsAsSaving: false }
  }
}

/** Whether a type's two flags are still what its kind guesses: nobody has said otherwise (M36 U11). */
export function flagsAsGuessed(type: Pick<DeductionType, 'kind' | 'reducesNet' | 'countsAsSaving'>): boolean {
  const guess = defaultFlags(type.kind)
  return guess.reducesNet === type.reducesNet && guess.countsAsSaving === type.countsAsSaving
}

/**
 * The two flags in words — the *Counts as* answer the deduction types screen shows
 * and `set_deduction_types` takes (M36 U11, M36 F1): what the kind guessed, or what
 * a person said instead.
 */
export function countsAsWords(type: Pick<DeductionType, 'reducesNet' | 'countsAsSaving'>): string {
  if (type.reducesNet && type.countsAsSaving) return 'Out of net, saving'
  if (type.reducesNet) return 'Out of net'
  if (type.countsAsSaving) return 'Saving, not out of net'
  return 'Not cash'
}

/**
 * **A kind change carries the flags with it** (M36 U11) — when they were still the
 * old kind's guess. Flags somebody set by hand stay as they are: a user override
 * wins over a guess, and the kind is only ever a guess about them.
 */
export function kindChange(
  type: Pick<DeductionType, 'kind' | 'reducesNet' | 'countsAsSaving'>,
  kind: DeductionKind,
): { readonly kind: DeductionKind; readonly reducesNet?: boolean; readonly countsAsSaving?: boolean } {
  return flagsAsGuessed(type) ? { kind, ...defaultFlags(kind) } : { kind }
}

/** The fund types a saving line of each kind lands in. */
const FUNDS_FOR: Partial<Record<DeductionKind, readonly string[]>> = {
  PENSION: ['PENSION', 'MANAGERS_INSURANCE'],
  SEVERANCE: ['PENSION', 'MANAGERS_INSURANCE'],
  STUDY_FUND: ['STUDY_FUND'],
}

/**
 * **What an unlinked line most likely pays into, to confirm rather than to ask**
 * (M36 U11): the one open fund its kind lands in, or the one open payroll loan a
 * repayment line pays off. Two candidates, or none, is no guess — a guess that
 * picked between two would be the app choosing quietly.
 */
export function guessDestination(
  type: Pick<DeductionType, 'kind' | 'countsAsSaving'>,
  funds: readonly { readonly id: string; readonly fundType: string; readonly isArchived: boolean }[],
  debts: readonly { readonly id: string; readonly kind: string; readonly isClosed: boolean }[],
): { readonly kind: 'fund' | 'debt'; readonly id: string } | undefined {
  if (type.kind === 'LOAN_REPAYMENT') {
    const open = debts.filter((debt) => !debt.isClosed && debt.kind === 'PAYROLL_LOAN')
    return open.length === 1 && open[0] !== undefined ? { kind: 'debt', id: open[0].id } : undefined
  }
  const types = FUNDS_FOR[type.kind]
  if (!type.countsAsSaving || types === undefined) return undefined
  const open = funds.filter((fund) => !fund.isArchived && types.includes(fund.fundType))
  return open.length === 1 && open[0] !== undefined ? { kind: 'fund', id: open[0].id } : undefined
}
