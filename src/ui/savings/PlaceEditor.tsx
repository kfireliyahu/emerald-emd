import { useState } from 'react'

import { createAccount, type Account, type AccountKind } from '@/data/repositories/accountRepository.ts'
import {
  HOLDING_PLACE_KINDS,
  type Holding,
  type HoldingPlace,
  type HoldingPlaceKind,
} from '@/domain/model/savings.ts'
import { validateHoldingPlace } from '@/domain/savings.ts'
import { useLanguage, useT } from '@/i18n/current.ts'
import { Button } from '@/ui/components/Button.tsx'
import { MENU_MOST, ValueChoice } from '@/ui/components/ChoiceField.tsx'
import { NewByName, SelectOrNew } from '@/ui/components/SelectOrNew.tsx'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'
import { PLACE_KIND_HEBREW } from './labels.ts'

/**
 * One place money sits: a bank, a brokerage, a drawer.
 *
 * **Nothing on this form does arithmetic any more, and that is the point of
 * D-175.** Reachability and the expected return used to be here, because a place
 * was the only record there was to put them on; they are on `HoldingEditor` now,
 * with the thing that is actually reachable and the thing that actually earns.
 * What is left is a location: what it is called, what kind of institution it is,
 * whose it is.
 *
 * A place with no holdings holds nothing, so the money map offers *Add a
 * holding* on the row the moment this form is saved.
 *
 * **It may name the account whose statements show its money** (M30 U1,
 * D-354) — a link, not a merge: a deposit or cash at home names none. The
 * account's own cash is a holding here, new with the link unless one already
 * in the place is picked — the holding goal deposits already land in.
 */
/** What a place can name, as *+ New…* offers it: no card, which holds no money. */
const NEW_ACCOUNT_KINDS = ['BANK', 'CASH', 'HOLDINGS'] as const satisfies readonly AccountKind[]

export interface PlaceAccountChoice {
  readonly accountId: string | undefined
  /** `undefined` makes a new `Cash` holding for the account. */
  readonly cashHoldingId: string | undefined
}

export function PlaceEditor({
  initial,
  isNew,
  accounts,
  holdings,
  problem,
  onSave,
  onCancel,
}: {
  initial: HoldingPlace
  isNew: boolean
  /** The accounts this place may name: no card, and none another place names. */
  accounts: readonly Account[]
  /** What is held in this place already, so one can be the account's cash. */
  holdings: readonly Holding[]
  problem?: string | undefined
  onSave: (place: HoldingPlace, link: PlaceAccountChoice) => void
  onCancel: () => void
}) {
  const t = useT()
  const language = useLanguage()
  const [draft, setDraft] = useState(initial)
  const [cashId, setCashId] = useState<string | undefined>(
    holdings.find((held) => held.accountId !== undefined && held.accountId === initial.accountId)?.id,
  )
  // The cash of the account this place names now is free to be the next
  // one's: a new link releases it (D-354).
  const cashChoices = holdings.filter(
    (held) =>
      held.accountId === undefined ||
      held.accountId === draft.accountId ||
      held.accountId === initial.accountId,
  )

  const set = (change: Partial<HoldingPlace>): void =>
    setDraft((current) => ({ ...current, ...change }))

  const pickAccount = (value: string): void => {
    const accountId = value === '' ? undefined : value
    set({ accountId })
    setCashId(holdings.find((held) => held.accountId !== undefined && held.accountId === accountId)?.id)
  }
  const accountChoices = [
    { value: '', label: t('wealth.placeForm.none') },
    ...accounts.map((account) => ({
      value: account.id,
      label: account.name,
      detail:
        account.kind === 'HOLDINGS'
          ? t('wealth.placeForm.withHoldings')
          : account.kind === 'CASH'
            ? t('wealth.placeForm.cashAccount')
            : undefined,
    })),
  ]

  const problems = validateHoldingPlace(draft)

  return (
    <form
      className="fc-view-enter h-full overflow-auto"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length > 0) return
        onSave(draft, {
          accountId: draft.accountId,
          cashHoldingId: draft.accountId === undefined ? undefined : cashId,
        })
      }}
    >
      <div className="px-6 py-6">
        <h1 className="text-title">{isNew ? t('wealth.placeForm.addTitle') : t('wealth.placeForm.editTitle')}</h1>
        <p className="mt-1 mb-6 max-w-2xl text-caption text-ink-tertiary">{t('wealth.placeForm.lead')}</p>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label={t('wealth.holdingForm.name')}>
            <input
              className={FIELD}
              autoFocus
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>

          {/* The bank's own Hebrew word beside an English kind; a Hebrew screen already says it (M64 F47). */}
          <Field label={t('wealth.holdingForm.kind')} hint={language === 'he' ? undefined : PLACE_KIND_HEBREW[draft.kind]}>
            <ValueChoice
              className={SELECT}
              value={draft.kind}
              choices={HOLDING_PLACE_KINDS.map((kind) => ({ value: kind, label: t(`wealth.kinds.place.${kind}`) }))}
              onChange={(kind) => set({ kind: kind as HoldingPlaceKind })}
            />
          </Field>

          <Field label={t('wealth.placeForm.institution')} hint={t('wealth.placeForm.institutionHint')}>
            <input
              className={FIELD}
              value={draft.institution ?? ''}
              onChange={(event) =>
                set({
                  institution: event.target.value.trim() === '' ? undefined : event.target.value,
                })
              }
            />
          </Field>

          <Field
            label={t('wealth.placeForm.account')}
            hint={
              draft.accountId === undefined
                ? t('wealth.placeForm.accountHintNone')
                : initial.accountId !== undefined
                  ? t('wealth.placeForm.accountHintKept')
                  : t('wealth.placeForm.accountHintNew')
            }
          >
            {initial.accountId === undefined ? (
              // A place that names none yet may make the account it is (M31 U6). One
              // that names one offers only that one, so there is nothing to make.
              <SelectOrNew
                aria-label={t('wealth.placeForm.accountLabel')}
                value={draft.accountId ?? ''}
                onChange={pickAccount}
                newForm={(done) => (
                  <NewByName
                    noun="account"
                    kinds={NEW_ACCOUNT_KINDS.map((kind) => [kind, t(`wealth.placeForm.newKind.${kind}`)] as const)}
                    make={(db, name, kind, now) => createAccount(db, { name, kind: kind ?? 'BANK' }, now).id}
                    done={done}
                  />
                )}
                choices={accountChoices}
              />
            ) : (
              <ValueChoice
                aria-label={t('wealth.placeForm.accountLabel')}
                value={draft.accountId ?? ''}
                choices={accountChoices}
                filter={accountChoices.length > MENU_MOST}
                onChange={pickAccount}
              />
            )}
          </Field>

          {draft.accountId !== undefined && (
            <Field label={t('wealth.placeForm.cash')} hint={t('wealth.placeForm.cashHint')}>
              <ValueChoice
                className={SELECT}
                aria-label={t('wealth.placeForm.cashLabel')}
                value={cashId ?? ''}
                choices={[
                  ...(cashChoices.some((held) => held.accountId === draft.accountId)
                    ? []
                    : [{ value: '', label: t('wealth.placeForm.newCash') }]),
                  ...cashChoices.map((held) => ({ value: held.id, label: held.name })),
                ]}
                filter={cashChoices.length > MENU_MOST}
                onChange={(id) => setCashId(id === '' ? undefined : id)}
              />
            </Field>
          )}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4">
          <Field label={t('wealth.holdingForm.note')}>
            <textarea
              className={`${FIELD_MULTILINE} min-h-8`}
              value={draft.note ?? ''}
              onChange={(event) =>
                set({ note: event.target.value.trim() === '' ? undefined : event.target.value })
              }
            />
          </Field>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
            {isNew ? t('wealth.placeForm.add') : t('wealth.holdingForm.save')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('wealth.common.cancel')}
          </Button>

          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {problems.map((each) => (
              <span key={each}>{t(`wealth.holdingForm.problem.${each}`)}</span>
            ))}
            {problem !== undefined && <span>{problem}</span>}
          </span>
        </div>
      </div>
    </form>
  )
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
