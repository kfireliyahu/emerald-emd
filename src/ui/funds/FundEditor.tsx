import { useState } from 'react'

import { basisPointsText, formatPercent } from '@/core/percent.ts'
import type { Institution } from '@/data/repositories/institutionRepository.ts'
import { feeBenchmark, type FeeComparison } from '@/domain/funds.ts'
import { FUND_STATUSES, FUND_TYPES, type FeeReference, type FundAccount, type FundStatus, type FundType } from '@/domain/model/funds.ts'
import { countKey } from '@/i18n/count.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { ChoiceField, ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { DateInput, FormField, FormGrid, MoreFields, PanelForm, Said } from '@/ui/components/PanelForm.tsx'
import { FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { useWealthWords } from '@/ui/wealth/words.ts'

/**
 * One fund account, added or edited — a `PanelForm` beside the funds (M64 F3,
 * D-629): its name, its kind, who manages it and its two fees first, because
 * the fee is what the Funds screen is for; the rest of what a policy says
 * (status, policy number, track, dates, beneficiaries) only if wanted.
 *
 * **The fee fields are in percent and the model is in basis points.** 0.5 typed
 * here is `50` stored (D-066), and the conversion happens on the way in and out
 * of this form and nowhere else. Text lives in component state and the parsed
 * value lives in the draft (D-050), so a half-typed "0." is not parsed into 0.
 *
 * **The benchmark is said while the fee is typed**, not after saving: a person
 * entering 1.05% on a pension fund should read "above the ceiling" as they type
 * it, because the number copied off a statement is exactly the thing they have
 * never compared against anything.
 *
 * **A manager not in the list is made in place** (*Make it in place*): the
 * field is an autocomplete whose last choice is *+ New "Menora"*.
 *
 * `firstDepositDate` sits apart from `openedDate` with its own hint: a study
 * fund's liquidity date counts from the first deposit, and inferring it from the
 * opening date would be wrong by however long that took.
 */
export function FundEditor({
  initial,
  isNew,
  institutions,
  feeReferences,
  onSave,
  onCreateInstitution,
  onCancel,
}: {
  initial: FundAccount
  isNew: boolean
  institutions: readonly Institution[]
  feeReferences: readonly FeeReference[]
  onSave: (fund: FundAccount) => void
  /** Creates a fund manager on the spot and returns its id. */
  onCreateInstitution: (name: string) => string | undefined
  onCancel: () => void
}) {
  const t = useT()
  const words = useWealthWords()
  const [draft, setDraft] = useState(initial)
  const [accumulationText, setAccumulationText] = useState(() => percentText(initial.fees.onAccumulationBasisPoints))
  const [depositText, setDepositText] = useState(() => percentText(initial.fees.onDepositBasisPoints))
  const [agreedText, setAgreedText] = useState(() => percentText(initial.agreedReturnBasisPoints))
  const [managerText, setManagerText] = useState(() => institutions.find((one) => one.id === initial.institutionId)?.name ?? '')

  const set = (change: Partial<FundAccount>): void => setDraft((current) => ({ ...current, ...change }))
  const setFee = (change: Partial<FundAccount['fees']>): void =>
    setDraft((current) => ({ ...current, fees: { ...current.fees, ...change } }))

  const benchmark = feeBenchmark(draft, feeReferences)
  const nameIsEmpty = draft.name.trim() === ''
  const status = (value: FundStatus): string => t(STATUS[value])
  const more = [
    draft.policyNumber,
    draft.investmentTrack,
    draft.employerName,
    draft.openedDate,
    draft.firstDepositDate,
    draft.feeNegotiatedUntil,
    draft.agreedReturnBasisPoints,
    draft.beneficiaries,
    draft.notes,
  ].filter((value) => value !== undefined).length

  return (
    <PanelForm
      save={isNew ? t('wealth.fundForm.add') : t('wealth.reading.save')}
      canSave={!nameIsEmpty}
      onSave={() => onSave({ ...draft, name: draft.name.trim() })}
      onCancel={onCancel}
      problems={nameIsEmpty && draft.name !== initial.name ? [t('wealth.fundForm.nameIt')] : []}
    >
      <FormGrid>
        <FormField label={t('wealth.fundForm.name')} hint={t('wealth.fundForm.nameHint')} wide>
          <input className={FIELD} value={draft.name} onChange={(event) => set({ name: event.target.value })} />
        </FormField>
        <FormField label={t('wealth.fundForm.type')}>
          <ChoiceMenu
            className={`${FIELD} w-full`}
            text={words.fund[draft.fundType]}
            choices={FUND_TYPES.map((type) => ({ value: type, label: words.fund[type] }))}
            onPick={(choice) => set({ fundType: choice.value as FundType })}
          />
        </FormField>
        <FormField label={t('wealth.fundForm.manager')} hint={t('wealth.fundForm.managerHint')}>
          <ChoiceField
            className={`${FIELD} w-full`}
            filter
            openOnFocus
            text={managerText}
            choices={institutions.map((one) => ({ value: one.id, label: one.name }))}
            onText={(text) => {
              setManagerText(text)
              if (text.trim() === '') set({ institutionId: undefined })
            }}
            onPick={(choice) => {
              setManagerText(choice.label)
              set({ institutionId: choice.value })
            }}
            make={{
              one: t('wealth.fundForm.managerOne'),
              onMake: (name) => {
                const id = onCreateInstitution(name.trim())
                if (id === undefined) return
                setManagerText(name.trim())
                set({ institutionId: id })
              },
            }}
          />
        </FormField>
        <FormField label={t('wealth.fundForm.feeAccumulation')}>
          <PercentInput
            text={accumulationText}
            placeholder="0.5"
            onText={(text) => {
              setAccumulationText(text)
              setFee({ onAccumulationBasisPoints: toBasisPoints(text) })
            }}
          />
        </FormField>
        <FormField label={t('wealth.fundForm.feeDeposit')}>
          <PercentInput
            text={depositText}
            placeholder="6"
            onText={(text) => {
              setDepositText(text)
              setFee({ onDepositBasisPoints: toBasisPoints(text) })
            }}
          />
        </FormField>
      </FormGrid>

      <Said>{feeSaid(benchmark.onAccumulation, benchmark.onDeposit, t)}</Said>
      {benchmark.reference !== undefined && (
        <p className="m-0 text-caption text-ink-secondary">
          {t('wealth.fundForm.ceilings', {
            accumulation: formatPercent(benchmark.reference.capOnAccumulationBasisPoints),
            deposit: formatPercent(benchmark.reference.capOnDepositBasisPoints),
            asOf: `${words.dates.dayMonth(benchmark.reference.asOf)} ${String(benchmark.reference.asOf.year)}`,
          })}
        </p>
      )}

      <MoreFields
        label={t('wealth.fundForm.more')}
        summary={more === 0 ? t('wealth.fundForm.moreSummary') : t(countKey('wealth.fundForm.moreStated', more), { count: more })}
        initiallyOpen={!isNew && more > 0}
      >
        <FormGrid>
          <FormField
            label={t('wealth.fundForm.status')}
            hint={draft.status === 'DORMANT' ? t('wealth.fundForm.dormantHint') : t('wealth.fundForm.statusHint')}
          >
            <ChoiceMenu
              className={`${FIELD} w-full`}
              text={status(draft.status)}
              choices={FUND_STATUSES.map((value) => ({ value, label: status(value) }))}
              onPick={(choice) => set({ status: choice.value as FundStatus })}
            />
          </FormField>
          <FormField label={t('wealth.fundForm.policy')} hint={t('wealth.fundForm.policyHint')}>
            <input className={FIELD} value={draft.policyNumber ?? ''} onChange={(event) => set({ policyNumber: blankToUndefined(event.target.value) })} />
          </FormField>
          <FormField label={t('wealth.fundForm.track')} hint={t('wealth.fundForm.trackHint')}>
            <input className={FIELD} value={draft.investmentTrack ?? ''} onChange={(event) => set({ investmentTrack: blankToUndefined(event.target.value) })} />
          </FormField>
          <FormField label={t('wealth.fundForm.employer')} hint={t('wealth.fundForm.employerHint')}>
            <input className={FIELD} value={draft.employerName ?? ''} onChange={(event) => set({ employerName: blankToUndefined(event.target.value) })} />
          </FormField>
          <FormField label={t('wealth.fundForm.opened')} hint={t('wealth.fundForm.openedHint')}>
            <DateInput value={draft.openedDate} onChange={(date) => set({ openedDate: date })} />
          </FormField>
          <FormField
            label={t('wealth.fundForm.firstDeposit')}
            hint={draft.fundType === 'STUDY_FUND' ? t('wealth.fundForm.firstDepositStudy') : t('wealth.fundForm.firstDepositHint')}
          >
            <DateInput value={draft.firstDepositDate} onChange={(date) => set({ firstDepositDate: date })} />
          </FormField>
          <FormField label={t('wealth.fundForm.feeUntil')} hint={t('wealth.fundForm.feeUntilHint')}>
            <DateInput value={draft.feeNegotiatedUntil} onChange={(date) => set({ feeNegotiatedUntil: date })} />
          </FormField>
          <FormField label={t('wealth.fundForm.agreedReturn')} hint={t('wealth.fundForm.agreedReturnHint')}>
            <PercentInput
              text={agreedText}
              placeholder="4"
              onText={(text) => {
                setAgreedText(text)
                set({ agreedReturnBasisPoints: toBasisPoints(text) })
              }}
            />
          </FormField>
          <FormField label={t('wealth.fundForm.beneficiaries')} hint={t('wealth.fundForm.beneficiariesHint')} wide>
            <input className={FIELD} value={draft.beneficiaries ?? ''} onChange={(event) => set({ beneficiaries: blankToUndefined(event.target.value) })} />
          </FormField>
          <FormField label={t('wealth.fundForm.notes')} wide>
            <textarea
              className={`${FIELD_MULTILINE} min-h-16`}
              value={draft.notes ?? ''}
              onChange={(event) => set({ notes: blankToUndefined(event.target.value) })}
            />
          </FormField>
        </FormGrid>
      </MoreFields>
    </PanelForm>
  )
}

/** A percent, typed: its text kept, the sign after it. */
function PercentInput({ text, placeholder, onText }: { text: string; placeholder: string; onText: (text: string) => void }) {
  return (
    <span className="flex items-center gap-2">
      <input
        className={`${FIELD} min-w-0 flex-1 text-end tabular-nums`}
        inputMode="decimal"
        dir="ltr"
        placeholder={placeholder}
        value={text}
        onChange={(event) => onText(event.target.value)}
      />
      <span className="text-ink-secondary">%</span>
    </span>
  )
}

const STATUS = {
  ACTIVE: 'wealth.fundForm.statusOf.ACTIVE',
  DORMANT: 'wealth.fundForm.statusOf.DORMANT',
  CLOSED: 'wealth.fundForm.statusOf.CLOSED',
} as const satisfies Record<FundStatus, string>

/** A blank fund to open the editor on. */
export function blankFund(): FundAccount {
  return {
    id: 'new',
    name: '',
    fundType: 'PENSION',
    institutionId: undefined,
    policyNumber: undefined,
    investmentTrack: undefined,
    status: 'ACTIVE',
    employerName: undefined,
    openedDate: undefined,
    firstDepositDate: undefined,
    fees: { onAccumulationBasisPoints: undefined, onDepositBasisPoints: undefined },
    feeNegotiatedUntil: undefined,
    agreedReturnBasisPoints: undefined,
    beneficiaries: undefined,
    notes: undefined,
    isArchived: false,
  }
}

/**
 * **The two fees, said against the shipped reference while they are typed.**
 * Deliberately not coloured red: a fee above the ceiling is far more often a
 * transcription slip or an old policy than a scandal, and colour is kept for
 * the one thing on a screen worth acting on.
 */
function feeSaid(accumulation: FeeComparison | undefined, deposit: FeeComparison | undefined, t: Translate): string {
  const one = (comparison: FeeComparison | undefined, which: 'accumulation' | 'deposit'): string | undefined => {
    if (comparison === undefined || comparison.standing === 'NOT_STATED') return undefined
    const fee = which === 'accumulation' ? FEE.accumulation : FEE.deposit
    if (comparison.standing === 'ABOVE_CAP') return t(fee.aboveCap, { cap: formatPercent(comparison.capBasisPoints) })
    if (comparison.standing === 'ABOVE_TYPICAL') return t(fee.aboveTypical, { typical: formatPercent(comparison.typicalBasisPoints) })
    return t(fee.typical, { typical: formatPercent(comparison.typicalBasisPoints) })
  }
  const said = [one(accumulation, 'accumulation'), one(deposit, 'deposit')].filter((each) => each !== undefined)
  return said.length === 0 ? t('wealth.fundForm.fee.none') : said.join(' ')
}

const FEE = {
  accumulation: {
    aboveCap: 'wealth.fundForm.fee.accumulation.aboveCap',
    aboveTypical: 'wealth.fundForm.fee.accumulation.aboveTypical',
    typical: 'wealth.fundForm.fee.accumulation.typical',
  },
  deposit: {
    aboveCap: 'wealth.fundForm.fee.deposit.aboveCap',
    aboveTypical: 'wealth.fundForm.fee.deposit.aboveTypical',
    typical: 'wealth.fundForm.fee.deposit.typical',
  },
} as const

/**
 * A typed percentage as basis points, or nothing.
 *
 * Rounded rather than truncated, and empty stays empty: "I do not know my fee"
 * and "my fee is zero" are different claims, and only the second is a number.
 */
function toBasisPoints(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? Math.round(value * 100) : undefined
}

function percentText(basisPoints: number | undefined): string {
  return basisPoints === undefined ? '' : basisPointsText(basisPoints)
}

function blankToUndefined(text: string): string | undefined {
  return text.trim() === '' ? undefined : text
}
