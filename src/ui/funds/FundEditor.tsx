import { useState } from 'react'

import { basisPointsText, formatPercent } from '@/core/percent.ts'
import { parseISODate, toISODate } from '@/core/time.ts'
import type { Institution } from '@/data/repositories/institutionRepository.ts'
import { feeBenchmark, type FeeComparison } from '@/domain/funds.ts'
import {
  FUND_STATUSES,
  FUND_TYPES,
  type FeeReference,
  type FundAccount,
  type FundStatus,
  type FundType,
} from '@/domain/model/funds.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'
import { FUND_STATUS_LABEL, FUND_TYPE_HEBREW, FUND_TYPE_LABEL } from '@/ui/funds/labels.ts'

/**
 * One fund account, added or edited.
 *
 * **The fee fields are in percent and the model is in basis points.** 0.5 typed
 * here is `50` stored (D-066), and the conversion happens on the way in and out
 * of this form and nowhere else. Text lives in component state and the parsed
 * value lives in the draft, the split D-050 made in the paycheck editor — so a
 * half-typed "0." is not repeatedly parsed into 0.
 *
 * **The benchmark is shown while the fee is being typed**, not after saving.
 * That is the whole point of shipping reference data: a user entering 1.05% on a
 * pension fund should see "at the ceiling" as they type it, because the number
 * they are copying off a statement is exactly the thing they have never
 * compared against anything.
 *
 * `firstDepositDate` sits apart from `openedDate` with its own hint, because
 * the two look interchangeable and are not: a study fund's liquidity date counts
 * from the first deposit, and inferring it from the opening date would be wrong
 * by however long that took.
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
  const [draft, setDraft] = useState(initial)
  const [accumulationText, setAccumulationText] = useState(() =>
    percentText(initial.fees.onAccumulationBasisPoints),
  )
  const [depositText, setDepositText] = useState(() =>
    percentText(initial.fees.onDepositBasisPoints),
  )
  const [agreedText, setAgreedText] = useState(() => percentText(initial.agreedReturnBasisPoints))
  const [newInstitution, setNewInstitution] = useState('')

  const set = (change: Partial<FundAccount>): void =>
    setDraft((current) => ({ ...current, ...change }))

  const setFee = (change: Partial<FundAccount['fees']>): void =>
    setDraft((current) => ({ ...current, fees: { ...current.fees, ...change } }))

  const benchmark = feeBenchmark(draft, feeReferences)
  const nameIsEmpty = draft.name.trim() === ''

  return (
    <form
      className="fc-view-enter h-full overflow-auto"
      onSubmit={(event) => {
        event.preventDefault()
        if (nameIsEmpty) return
        onSave({ ...draft, name: draft.name.trim() })
      }}
    >
      <div className="px-6 py-6">
        <h1 className="mb-6 text-title">{isNew ? 'Add a fund' : draft.name}</h1>

        <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Name" hint="what you call it, not what the policy calls it">
            <input
              className={FIELD}
              value={draft.name}
              autoFocus
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>

          <Field label="Type" hint={FUND_TYPE_HEBREW[draft.fundType]}>
            <select
              className={SELECT}
              value={draft.fundType}
              onChange={(event) => set({ fundType: event.target.value as FundType })}
            >
              {FUND_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FUND_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Managed by"
            hint={
              institutions.length === 0
                ? 'no fund managers yet — type one below'
                : 'the company that sends the report'
            }
          >
            <select
              className={SELECT}
              value={draft.institutionId ?? ''}
              onChange={(event) =>
                set({ institutionId: event.target.value === '' ? undefined : event.target.value })
              }
            >
              <option value="">Not set</option>
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Add a manager" hint="only if it is not in the list">
            <div className="flex gap-2">
              <input
                className={`${FIELD} min-w-0 flex-1`}
                value={newInstitution}
                placeholder="Menora, Altshuler…"
                onChange={(event) => setNewInstitution(event.target.value)}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={newInstitution.trim() === ''}
                onClick={() => {
                  const id = onCreateInstitution(newInstitution.trim())
                  if (id !== undefined) set({ institutionId: id })
                  setNewInstitution('')
                }}
              >
                Add
              </Button>
            </div>
          </Field>

          <Field label="Policy number" hint="what the report is headed with">
            <input
              className={FIELD}
              value={draft.policyNumber ?? ''}
              onChange={(event) =>
                set({ policyNumber: blankToUndefined(event.target.value) })
              }
            />
          </Field>

          <Field label="Investment track" hint="e.g. up to 50 / general / stocks">
            <input
              className={FIELD}
              value={draft.investmentTrack ?? ''}
              onChange={(event) =>
                set({ investmentTrack: blankToUndefined(event.target.value) })
              }
            />
          </Field>

          <Field
            label="Status"
            hint={
              draft.status === 'DORMANT'
                ? 'no new deposits — and still charging fees'
                : 'dormant means an old job you no longer pay into'
            }
          >
            <select
              className={SELECT}
              value={draft.status}
              onChange={(event) => set({ status: event.target.value as FundStatus })}
            >
              {FUND_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {FUND_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Employer" hint="which job it belongs to">
            <input
              className={FIELD}
              value={draft.employerName ?? ''}
              onChange={(event) => set({ employerName: blankToUndefined(event.target.value) })}
            />
          </Field>

          <Field label="Opened" hint="when the account was opened">
            <input
              type="date"
              className={FIELD}
              value={draft.openedDate === undefined ? '' : toISODate(draft.openedDate)}
              onChange={(event) => set({ openedDate: parseISODate(event.target.value) })}
            />
          </Field>

          <Field
            label="First deposit"
            hint={
              draft.fundType === 'STUDY_FUND'
                ? 'the liquidity date counts from here, not from the opening date'
                : 'not the same as the opening date'
            }
          >
            <input
              type="date"
              className={FIELD}
              value={
                draft.firstDepositDate === undefined ? '' : toISODate(draft.firstDepositDate)
              }
              onChange={(event) => set({ firstDepositDate: parseISODate(event.target.value) })}
            />
          </Field>

          <Field label="Fee on accumulation %" hint={standingHint(benchmark.onAccumulation)}>
            <input
              className={FIELD}
              inputMode="decimal"
              placeholder="0.5"
              value={accumulationText}
              onChange={(event) => {
                setAccumulationText(event.target.value)
                setFee({ onAccumulationBasisPoints: toBasisPoints(event.target.value) })
              }}
            />
          </Field>

          <Field label="Fee on deposit %" hint={standingHint(benchmark.onDeposit)}>
            <input
              className={FIELD}
              inputMode="decimal"
              placeholder="6"
              value={depositText}
              onChange={(event) => {
                setDepositText(event.target.value)
                setFee({ onDepositBasisPoints: toBasisPoints(event.target.value) })
              }}
            />
          </Field>

          <Field label="Fee agreed until" hint="agreements expire and revert without telling you">
            <input
              type="date"
              className={FIELD}
              value={
                draft.feeNegotiatedUntil === undefined ? '' : toISODate(draft.feeNegotiatedUntil)
              }
              onChange={(event) => set({ feeNegotiatedUntil: parseISODate(event.target.value) })}
            />
          </Field>

          <Field
            label="Return agreed in writing %"
            hint="only a rate the provider agreed to; an expected return is an assumption and goes in Fee impact"
          >
            <input
              className={FIELD}
              inputMode="decimal"
              placeholder="4"
              value={agreedText}
              onChange={(event) => {
                setAgreedText(event.target.value)
                set({ agreedReturnBasisPoints: toBasisPoints(event.target.value) })
              }}
            />
          </Field>

          <Field label="Beneficiaries" hint="rarely updated after a marriage or a child">
            <input
              className={FIELD}
              value={draft.beneficiaries ?? ''}
              onChange={(event) => set({ beneficiaries: blankToUndefined(event.target.value) })}
            />
          </Field>
        </div>

        <div className="mt-4 max-w-3xl">
          <Field label="Notes">
            <textarea
              className={`${FIELD_MULTILINE} min-h-16`}
              value={draft.notes ?? ''}
              onChange={(event) => set({ notes: blankToUndefined(event.target.value) })}
            />
          </Field>
        </div>

        {benchmark.reference !== undefined && (
          <p className="mt-3 max-w-2xl text-caption text-ink-tertiary">
            Compared against a ceiling of{' '}
            {formatPercent(benchmark.reference.capOnAccumulationBasisPoints)} on accumulation
            and {formatPercent(benchmark.reference.capOnDepositBasisPoints)} on deposits, as of{' '}
            {toISODate(benchmark.reference.asOf)}. These are the app's shipped figures — check them
            against your fund's own statement before acting on them.
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" type="submit" disabled={nameIsEmpty}>
            {isNew ? 'Add fund' : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {nameIsEmpty && <span className="text-caption text-negative">Give it a name</span>}
        </div>
      </div>
    </form>
  )
}

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
 * What the fee the user is typing looks like against the shipped reference.
 *
 * Deliberately not coloured red: a fee above the ceiling is far more often a
 * transcription slip or an old policy than a scandal, and docs/11 reserves
 * colour for the one thing on a screen worth acting on.
 */
function standingHint(comparison: FeeComparison | undefined): string {
  if (comparison === undefined || comparison.standing === 'NOT_STATED') {
    return 'from your fund statement'
  }
  if (comparison.standing === 'ABOVE_CAP') {
    return `above the ${formatPercent(comparison.capBasisPoints)} ceiling — worth re-reading the statement`
  }
  if (comparison.standing === 'ABOVE_TYPICAL') {
    return `higher than the ${formatPercent(comparison.typicalBasisPoints)} usually negotiated`
  }
  return `at or below the ${formatPercent(comparison.typicalBasisPoints)} usually negotiated`
}


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

