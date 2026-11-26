import { useState } from 'react'

import { zero, type CurrencyCode } from '@/core/money.ts'
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
  type PaycheckDraft,
} from '@/domain/paycheckEntry.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FlowFrame } from '@/ui/components/FlowFrame.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { AmountInput, DateInput, FormField, FormGrid, FormGroup, MonthInput, MoreFields, PanelForm } from '@/ui/components/PanelForm.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { editableMoney, moneyFromText } from '@/ui/components/moneyText.ts'
import { DeductionTypeSelect } from '@/ui/paychecks/DeductionTypeSelect.tsx'
import { ReconciliationSaid } from '@/ui/paychecks/ReconciliationStrip.tsx'
import { today } from '@/ui/today.ts'

/**
 * **Adding a paycheck by hand is easy** (M64 F14, D-630). The maintainer,
 * 2026-11-26: *"adding paychecks by hand is still the old ui? could it be maybe
 * easier?"* — so it takes the shape of Wealth's fund reading (D-629): **the few
 * fields a person must type first** (the salary month, the employer, gross and
 * net), whether the slip adds up **said in words as they are typed**, the slip's
 * lines **added only if wanted**, a line at a time, and the rest (the day it was
 * paid, a bonus, a note) folded under one verb that grows in place.
 *
 * Typed by hand it is a `PanelForm` beside Paychecks (`PaycheckForm`, D-617):
 * the page stays behind it, Enter saves, Esc or Cancel leaves, and it closes on
 * the screen it opened from. **Confirming a read slip is the same form**
 * (`PaycheckEditor`, U7's reading flow): the same fields on a page of their own
 * with one way back, whose grids widen with the page.
 *
 * **Text lives here, numbers live in the draft.** Every amount field keeps what
 * was typed as a string and hands the parsed `Money` to the draft, the way the
 * rule editor keeps its bound text. That is what lets `₪1,234.56` pasted
 * straight off a slip work, and it is read by `parseAmountText` — the same
 * reader the importer uses on statement cells, rather than a second one that
 * could disagree about a trailing minus.
 *
 * Everything the form decides, it asks the domain: `draftProblems` for what
 * cannot be saved, `draftDelta` for the sentence. The form has no opinion of
 * its own about a payslip.
 */
export interface PaycheckFormProps {
  readonly initial: PaycheckDraft
  readonly isNew: boolean
  readonly currency: CurrencyCode
  readonly types: readonly DeductionType[]
  /** Every slip already entered: the copy offer, the employers and the picker's recents come from it. */
  readonly history: readonly PaycheckWithLines[]
  readonly onSave: (draft: PaycheckDraft) => void
  readonly onCancel: () => void
  readonly onCreateType: (name: string, kind: DeductionKind) => string | undefined
}

/** The form in the side panel, beside Paychecks. */
export function PaycheckForm(props: PaycheckFormProps) {
  const t = useT()
  const state = usePaycheckDraft(props.initial, props.currency, props.types)
  return (
    <PanelForm
      save={props.isNew ? t('paychecks.entry.add') : t('paychecks.entry.save')}
      canSave={state.problems.length === 0}
      onSave={() => props.onSave(state.draft)}
      onCancel={props.onCancel}
      problems={state.problems}
    >
      <PaycheckFields key={state.loaded} state={state} {...props} />
    </PanelForm>
  )
}

/**
 * The same form on a page of its own: a read slip confirmed in the reading
 * flow (D-166, M64 U7), where it is a step of a job with one way back.
 */
export function PaycheckEditor({
  leaveLabel,
  ...props
}: PaycheckFormProps & {
  /**
   * Where leaving goes, named — `FlowFrame`'s rule, and it stopped being a
   * constant when onboarding gained the same flow (D-166). "Back to the list"
   * is a lie in a wizard step that has no list behind it.
   */
  readonly leaveLabel?: string | undefined
}) {
  const t = useT()
  const state = usePaycheckDraft(props.initial, props.currency, props.types)
  return (
    <FlowFrame
      title={props.isNew ? t('paychecks.entry.newTitle') : t('paychecks.entry.editTitle')}
      leaveLabel={leaveLabel ?? t('paychecks.entry.back')}
      onLeave={props.onCancel}
      onSubmit={() => {
        if (state.problems.length === 0) props.onSave(state.draft)
      }}
      footer={
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <Button variant="primary" size="sm" type="submit" disabled={state.problems.length > 0}>
            {props.isNew ? t('paychecks.entry.add') : t('paychecks.entry.save')}
          </Button>
          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {state.problems.map((problem) => (
              <span key={problem}>{problem}</span>
            ))}
          </span>
        </div>
      }
    >
      <div className="@container max-w-3xl px-6 py-6">
        <div className="flex flex-col gap-5">
          <PaycheckFields key={state.loaded} state={state} {...props} />
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

interface PaycheckState {
  readonly draft: PaycheckDraft
  readonly grossText: string
  readonly netText: string
  readonly lineText: Readonly<Record<string, LineText>>
  /** What stops it saving, a sentence each. */
  readonly problems: readonly string[]
  /** Counts each `load`, so the fields that keep their own text start again from it. */
  readonly loaded: number
  /** The line just removed, for its Undo. */
  readonly removed: { readonly line: DraftLine; readonly at: number; readonly text: LineText } | undefined
  readonly set: (change: Partial<PaycheckDraft>) => void
  readonly setGross: (text: string) => void
  readonly setNet: (text: string) => void
  readonly load: (next: PaycheckDraft) => void
  readonly setLine: (key: string, change: Partial<DraftLine>) => void
  readonly setLineAmount: (key: string, field: keyof LineText, text: string) => void
  readonly addLine: () => void
  readonly removeLine: (key: string) => void
  readonly undoRemove: () => void
  readonly addDifference: (deductionTypeId: string) => void
}

function usePaycheckDraft(initial: PaycheckDraft, currency: CurrencyCode, types: readonly DeductionType[]): PaycheckState {
  const t = useT()
  const [draft, setDraft] = useState(initial)
  const [grossText, setGrossText] = useState(() => editableMoney(initial.gross))
  const [netText, setNetText] = useState(() => editableMoney(initial.net))
  const [lineText, setLineText] = useState<Readonly<Record<string, LineText>>>(() => textsFor(initial))
  const [loaded, setLoaded] = useState(0)
  const [removed, setRemoved] = useState<PaycheckState['removed']>()

  const setLine = (key: string, change: Partial<DraftLine>): void =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...change } : line)),
    }))

  const problems = [
    ...draftProblems(draft).map((problem) => t(`paychecks.entry.problems.${problem}`)),
    ...(unreadable(grossText) ? [t('paychecks.entry.problems.grossNotNumber')] : []),
    ...(unreadable(netText) ? [t('paychecks.entry.problems.netNotNumber')] : []),
  ]

  return {
    draft,
    grossText,
    netText,
    lineText,
    problems,
    loaded,
    removed,
    set: (change) => setDraft((current) => ({ ...current, ...change })),
    setGross: (text) => {
      setGrossText(text)
      setDraft((current) => ({ ...current, gross: moneyFromText(text, currency, { magnitude: true }) ?? zero(currency) }))
    },
    setNet: (text) => {
      setNetText(text)
      setDraft((current) => ({ ...current, net: moneyFromText(text, currency, { magnitude: true }) ?? zero(currency) }))
    },
    /** Replace everything at once — what "copy last month's" does. */
    load: (next) => {
      setDraft(next)
      setGrossText(editableMoney(next.gross))
      setNetText(editableMoney(next.net))
      setLineText(textsFor(next))
      setRemoved(undefined)
      setLoaded((count) => count + 1)
    },
    setLine,
    setLineAmount: (key, field, text) => {
      setLineText((current) => ({ ...current, [key]: { ...(current[key] ?? BLANK_TEXT), [field]: text } }))
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
    },
    addLine: () => {
      const line = blankLine(currency)
      setLineText((current) => ({ ...current, [line.key]: BLANK_TEXT }))
      setDraft((current) => ({ ...current, lines: [...current.lines, line] }))
      setRemoved(undefined)
    },
    /** Gone at once, with an Undo where it was (D-617's *deleting deletes*). */
    removeLine: (key) => {
      const at = draft.lines.findIndex((line) => line.key === key)
      const line = draft.lines[at]
      if (line === undefined) return
      setRemoved({ line, at, text: lineText[key] ?? BLANK_TEXT })
      setDraft((current) => ({ ...current, lines: current.lines.filter((each) => each.key !== key) }))
    },
    undoRemove: () => {
      if (removed === undefined) return
      setLineText((current) => ({ ...current, [removed.line.key]: removed.text }))
      setDraft((current) => ({
        ...current,
        lines: [...current.lines.slice(0, removed.at), removed.line, ...current.lines.slice(removed.at)],
      }))
      setRemoved(undefined)
    },
    /**
     * The sentence's one-tap fix. It appends rather than reloading the form: a
     * reload would reformat `25000` into `25,000.00` under a cursor that is
     * still in the field, which is the app editing what the user is typing.
     */
    addDifference: (deductionTypeId) => {
      const next = withDifferenceAsLine(draft, deductionTypeId, types)
      const added = next.lines.at(-1)
      if (next === draft || added === undefined) return
      setLineText((current) => ({ ...current, [added.key]: { employee: editableMoney(added.employee), employer: '', basis: '' } }))
      setDraft(next)
    },
  }
}

function PaycheckFields({
  state,
  isNew,
  currency,
  types,
  history,
  onCreateType,
}: PaycheckFormProps & { readonly state: PaycheckState }) {
  const t = useT()
  const dates = useDates()
  const { draft } = state
  const [noting, setNoting] = useState<ReadonlySet<string>>(new Set())

  const entry = draftEntry(draft)
  const other = types.find((type) => type.kind === 'OTHER_DEDUCTION')
  const groups = pickerGroups(types, recentTypeIds(history))
  // Offered only while it is still an offer: once the form has lines, filling
  // them from last month would throw away what has been typed.
  const previous = isNew && draft.lines.length === 0 ? history[0] : undefined
  // The employers already on a slip, so the second job is one pick away.
  const employers = [...new Set(history.map((each) => (each.paycheck.employerName ?? '').trim()).filter((name) => name !== ''))].map((name) => ({ value: name, label: name }))
  /**
   * A slip already recorded for this month — the note that stands in for the
   * uniqueness constraint the schema deliberately does not have (D-048). It
   * says so and does nothing else: a 13th salary and a second job both put two
   * slips in one month legitimately, and the app cannot tell those apart from
   * entering June twice; the person can.
   */
  const alreadyEntered = history.filter(
    (each) => each.paycheck.period.year === draft.period.year && each.paycheck.period.month === draft.period.month,
  ).length
  const removedName = state.removed === undefined ? undefined : types.find((type) => type.id === state.removed?.line.deductionTypeId)?.name

  return (
    <>
      {previous !== undefined && (
        <p className="m-0">
          <button type="button" className="fc-text-action" onClick={() => state.load(copiedFrom(previous, today()))}>
            {t('paychecks.entry.copy', { month: dates.monthName(previous.paycheck.period) })}
          </button>
        </p>
      )}

      <FormGrid>
        <FormField label={t('paychecks.entry.month')} hint={t('paychecks.entry.monthHint', { month: dates.yearMonth(draft.period) })}>
          <MonthInput value={draft.period} onChange={(period) => state.set({ period })} aria-label={t('paychecks.entry.month')} />
        </FormField>
        <FormField label={t('paychecks.entry.employer')} hint={t('paychecks.entry.employerHint')}>
          <ChoiceField
            text={draft.employerName}
            choices={employers}
            filter
            onText={(employerName) => state.set({ employerName })}
            onPick={(choice) => state.set({ employerName: choice.value })}
            aria-label={t('paychecks.entry.employer')}
            dir="auto"
            className={`${FIELD} w-full`}
          />
        </FormField>
        <AmountInput label={t('paychecks.entry.gross')} currency={currency} placeholder="0" value={state.grossText} onChange={(event) => state.setGross(event.target.value)} />
        <AmountInput label={t('paychecks.entry.net')} currency={currency} placeholder="0" value={state.netText} onChange={(event) => state.setNet(event.target.value)} />
      </FormGrid>

      {alreadyEntered > 0 && (
        <p className="m-0 text-caption text-ink-secondary">
          {t(countKey('paychecks.entry.already', alreadyEntered), { month: dates.yearMonth(draft.period), count: alreadyEntered })}
        </p>
      )}

      <ReconciliationSaid
        delta={draftDelta(draft, types)}
        grossToNet={grossToNet(draft)}
        itemized={netReducingTotal(entry, types)}
        idle={draft.gross.minor === 0 && draft.net.minor === 0}
        lines={draft.lines.length}
        onAddDifference={other === undefined ? undefined : () => state.addDifference(other.id)}
      />

      <div className="flex flex-col gap-3">
        {draft.lines.length > 0 && (
          <FormGroup title={t('paychecks.entry.lines')}>
            {draft.lines.map((line) => {
              const text = state.lineText[line.key] ?? BLANK_TEXT
              return (
                <div key={line.key} className="fc-pop-enter flex flex-col gap-2 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <DeductionTypeSelect
                        groups={groups}
                        value={line.deductionTypeId}
                        onChange={(deductionTypeId) => state.setLine(line.key, { deductionTypeId })}
                        onCreate={onCreateType}
                      />
                    </div>
                    <IconAction label={t('paychecks.entry.remove')} tone="negative" onClick={() => state.removeLine(line.key)}>
                      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                    </IconAction>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <LineAmount label={t('paychecks.entry.you')} name={t('paychecks.entry.youLabel')} placeholder="0" value={text.employee} onText={(value) => state.setLineAmount(line.key, 'employee', value)} />
                    <LineAmount label={t('paychecks.entry.employerSide')} name={t('paychecks.entry.employerLabel')} placeholder="—" value={text.employer} onText={(value) => state.setLineAmount(line.key, 'employer', value)} />
                    {/* The base the percentages were computed on — a pensionable
                        salary, not the gross. Stored because the fund's own
                        deposit table prints the same figure and nothing could
                        compare the two without it (D-169). */}
                    <LineAmount label={t('paychecks.entry.base')} name={t('paychecks.entry.baseLabel')} placeholder="—" value={text.basis} onText={(value) => state.setLineAmount(line.key, 'basis', value)} />
                  </div>
                  {line.note !== '' || noting.has(line.key) ? (
                    <input
                      autoFocus={line.note === ''}
                      value={line.note}
                      onChange={(event) => state.setLine(line.key, { note: event.target.value })}
                      aria-label={t('paychecks.entry.lineNote')}
                      placeholder={t('paychecks.entry.lineNote')}
                      dir="auto"
                      className={`${FIELD} w-full`}
                    />
                  ) : (
                    <button type="button" className="fc-text-action self-start text-caption" onClick={() => setNoting(new Set([...noting, line.key]))}>
                      {t('paychecks.entry.addNote')}
                    </button>
                  )}
                </div>
              )
            })}
          </FormGroup>
        )}
        {state.removed !== undefined && (
          <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-caption text-ink-secondary" role="status">
            {removedName === undefined ? (
              t('paychecks.entry.removedBlank')
            ) : (
              <Phrase text={t('paychecks.entry.removed')} parts={{ name: <Bidi>{removedName}</Bidi> }} />
            )}
            <button type="button" className="fc-text-action" onClick={state.undoRemove}>
              {t('paychecks.entry.undo')}
            </button>
          </p>
        )}
        <button type="button" className="fc-text-action self-start" onClick={state.addLine}>
          {t('paychecks.entry.addLine')}
        </button>
      </div>

      <MoreFields
        label={t('paychecks.entry.more')}
        summary={t('paychecks.entry.moreSummary')}
        initiallyOpen={!isNew && (draft.note !== '' || draft.isIrregular)}
      >
        <FormGrid>
          <FormField label={t('paychecks.entry.paid')} hint={t('paychecks.entry.paidHint')}>
            <DateInput value={draft.paymentDate} onChange={(paymentDate) => state.set({ paymentDate: paymentDate ?? draft.paymentDate })} />
          </FormField>
        </FormGrid>
        <label className="flex items-center gap-2 text-ink-secondary select-none">
          <input type="checkbox" checked={draft.isIrregular} onChange={(event) => state.set({ isIrregular: event.target.checked })} />
          {t('paychecks.entry.bonus')}
        </label>
        <FormField label={t('paychecks.entry.note')}>
          <textarea
            className={`${FIELD_MULTILINE} min-h-16`}
            dir="auto"
            value={draft.note}
            onChange={(event) => state.set({ note: event.target.value })}
          />
        </FormField>
      </MoreFields>
    </>
  )
}

/** One of a line's amounts: a small label over a plain field, tabular, its text kept as typed. */
function LineAmount({
  label,
  name,
  placeholder,
  value,
  onText,
}: {
  readonly label: string
  readonly name: string
  readonly placeholder: string
  readonly value: string
  readonly onText: (text: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-label text-ink-secondary uppercase">{label}</span>
      <input
        className={`${FIELD} min-w-0 text-end tabular-nums`}
        inputMode="decimal"
        dir="ltr"
        aria-label={name}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onText(event.target.value)}
      />
    </label>
  )
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
