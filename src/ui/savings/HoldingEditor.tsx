import { useState } from 'react'

import { basisPointsText } from '@/core/percent.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { HOLDING_KINDS, type Holding, type HoldingKind } from '@/domain/model/savings.ts'
import { reachableOf, validateHolding, type HoldingProblem } from '@/domain/savings.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'
import { HOLDING_KIND_HEBREW, HOLDING_KIND_LABEL } from './labels.ts'

/**
 * One holding: the cash in a current account, the פק"מ beside it, the index
 * fund at the broker.
 *
 * **Name, kind and an optional fee — the rest is worked out** (M36 U11). It used
 * to ask four things the document already knows:
 *
 * - **Reachable** follows from the kind and the term (`reachableOf`): a deposit
 *   asks when its term ends, and a term not yet ended locks it. An existing
 *   holding keeps the answer it has unless its kind or term changes, so nothing
 *   moves across the liquid line on a save that only renames it.
 * - **Where the figure comes from** is read off its readings when it is saved
 *   (`provenanceOf`): a new holding has none, so it is what somebody wrote down.
 * - **Last checked** is what *Checked today* on its line and a new reading say.
 * - **What it is expected to earn** fed the scenario projection, which no screen
 *   showed and M45 U2 removed.
 *
 * A holding that already has a note shows it, so a save never hides one.
 */
export function HoldingEditor({
  initial,
  placeName,
  isNew,
  asOf,
  onSave,
  onCancel,
}: {
  initial: Holding
  placeName: string
  isNew: boolean
  asOf: LocalDate
  onSave: (holding: Holding) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [feeText, setFeeText] = useState(() =>
    initial.feeBasisPoints === undefined ? '' : basisPointsText(initial.feeBasisPoints),
  )

  const set = (change: Partial<Holding>): void =>
    setDraft((current) => ({ ...current, ...change }))

  const setFee = (text: string): void => {
    setFeeText(text)
    const parsed = Number(text.replace(',', '.'))
    set({
      feeBasisPoints:
        text.trim() === '' || !Number.isFinite(parsed) ? undefined : Math.round(parsed * 100),
    })
  }

  const problems = validateHolding(draft)
  // Only what can be locked asks until when — or one that has a term already.
  const asksTerm = draft.kind === 'DEPOSIT' || draft.termEndDate !== undefined
  const termOf = asksTerm ? draft.termEndDate : undefined
  const moved = isNew || draft.kind !== initial.kind || toISODate(termOf ?? asOf) !== toISODate(initial.termEndDate ?? asOf)

  return (
    <form
      className="fc-view-enter h-full overflow-auto"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length > 0) return
        onSave({
          ...draft,
          termEndDate: termOf,
          isLiquid: moved ? reachableOf(draft.kind, termOf, asOf) : initial.isLiquid,
        })
      }}
    >
      <div className="px-6 py-6">
        <h1 className="text-title">{isNew ? 'Add a holding' : 'Edit holding'}</h1>
        <p className="mt-1 mb-6 max-w-2xl text-caption text-ink-tertiary">
          What form the money is in at <Bidi>{placeName}</Bidi>. A place can hold several — the cash
          and the deposit at one bank are two holdings.
        </p>

        <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={FIELD}
              autoFocus
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>

          <Field label="Kind" hint={HOLDING_KIND_HEBREW[draft.kind]}>
            <select
              className={SELECT}
              value={draft.kind}
              onChange={(event) => set({ kind: event.target.value as HoldingKind })}
            >
              {HOLDING_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {HOLDING_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </Field>

          {asksTerm && (
            <Field label="Term ends" hint="optional — until then it is locked">
              <input
                className={FIELD}
                type="date"
                value={draft.termEndDate === undefined ? '' : toISODate(draft.termEndDate)}
                onChange={(event) =>
                  set({
                    termEndDate:
                      event.target.value === '' ? undefined : parseISODate(event.target.value),
                  })
                }
              />
            </Field>
          )}

          <Field label="What it charges a year" hint="optional — the management fee, if it has one">
            <div className="flex items-center gap-2">
              <input
                className={`${FIELD} w-24`}
                inputMode="decimal"
                value={feeText}
                onChange={(event) => setFee(event.target.value)}
              />
              <span className="text-ink-tertiary">%</span>
            </div>
          </Field>
        </div>

        {initial.note !== undefined && (
          <div className="mt-6 grid max-w-3xl grid-cols-1 gap-4">
            <Field label="Note">
              <textarea
                className={`${FIELD_MULTILINE} min-h-8`}
                value={draft.note ?? ''}
                onChange={(event) =>
                  set({ note: event.target.value.trim() === '' ? undefined : event.target.value })
                }
              />
            </Field>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
            {isNew ? 'Add holding' : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>

          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {problems.map((problem) => (
              <span key={problem}>{PROBLEM_MESSAGE[problem]}</span>
            ))}
          </span>
        </div>
      </div>
    </form>
  )
}

/**
 * A blank holding to open the editor on.
 *
 * `CASH` and `RECORDED` because that is the holding somebody adds without being
 * asked to — the amount kept aside in a current account — and because those two
 * are the pair that claims the least: nothing will confirm it, and the app says
 * so rather than implying a statement exists.
 */
export function blankHolding(holdingPlaceId: string): Holding {
  return {
    id: 'new',
    holdingPlaceId,
    name: '',
    kind: 'CASH',
    provenance: 'RECORDED',
    lastConfirmedAt: undefined,
    isLiquid: true,
    expectedReturn: undefined,
    termEndDate: undefined,
    feeBasisPoints: undefined,
    note: undefined,
    isArchived: false,
  }
}

const PROBLEM_MESSAGE: Readonly<Record<HoldingProblem, string>> = {
  NO_NAME: 'Give it a name',
  RETURN_OUT_OF_RANGE: 'A rate over 20% a year is almost certainly a typo',
  FEE_OUT_OF_RANGE: 'A fee over 20% a year is almost certainly a typo',
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string | undefined
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label text-ink-tertiary uppercase">{label}</span>
      {children}
      {hint !== undefined && hint !== '' && (
        <span className="text-caption text-ink-tertiary">{hint}</span>
      )}
    </label>
  )
}
