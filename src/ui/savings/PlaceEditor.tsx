import { useState } from 'react'

import { createAccount, type Account, type AccountKind } from '@/data/repositories/accountRepository.ts'
import {
  HOLDING_PLACE_KINDS,
  type Holding,
  type HoldingPlace,
  type HoldingPlaceKind,
} from '@/domain/model/savings.ts'
import { validateHoldingPlace, type HoldingPlaceProblem } from '@/domain/savings.ts'
import { Button } from '@/ui/components/Button.tsx'
import { NewByName, SelectOrNew } from '@/ui/components/SelectOrNew.tsx'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'
import { PLACE_KIND_HEBREW, PLACE_KIND_LABEL } from './labels.ts'

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
const NEW_ACCOUNT_KINDS: readonly (readonly [AccountKind, string])[] = [
  ['BANK', 'Bank account'],
  ['CASH', 'Cash'],
  ['HOLDINGS', 'Account with holdings'],
]

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
  const accountOptions = (
    <>
      <option value="">None</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
          {account.kind === 'HOLDINGS' ? ' · with holdings' : account.kind === 'CASH' ? ' · cash' : ''}
        </option>
      ))}
    </>
  )

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
        <h1 className="text-title">{isNew ? 'Add a place' : 'Edit place'}</h1>
        <p className="mt-1 mb-6 max-w-2xl text-caption text-ink-tertiary">
          Where money is — the bank, the broker, the drawer. What form it is in there
          is a holding, and a place can have several: the cash and the deposit at one bank are two
          different answers to &ldquo;can I reach this?&rdquo;
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

          <Field label="Kind" hint={PLACE_KIND_HEBREW[draft.kind]}>
            <select
              className={SELECT}
              value={draft.kind}
              onChange={(event) => set({ kind: event.target.value as HoldingPlaceKind })}
            >
              {HOLDING_PLACE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PLACE_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Bank or broker" hint="optional — whose it is">
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
            label="Account"
            hint={
              draft.accountId === undefined
                ? 'optional — the account whose statements show this money. A deposit or cash at home names none'
                : initial.accountId !== undefined
                  ? 'its statements show this place’s money, and its own cash is here. To name another account, choose None and save first'
                  : 'its statements show this place’s money; the account keeps its own cash here'
            }
          >
            {initial.accountId === undefined ? (
              // A place that names none yet may make the account it is (M31 U6). One
              // that names one offers only that one, so there is nothing to make.
              <SelectOrNew
                aria-label="The account this place is"
                value={draft.accountId ?? ''}
                onChange={pickAccount}
                newForm={(done) => (
                  <NewByName
                    noun="account"
                    kinds={NEW_ACCOUNT_KINDS}
                    make={(db, name, kind, now) => createAccount(db, { name, kind: kind ?? 'BANK' }, now).id}
                    done={done}
                  />
                )}
              >
                {accountOptions}
              </SelectOrNew>
            ) : (
              <select
                className={SELECT}
                aria-label="The account this place is"
                value={draft.accountId ?? ''}
                onChange={(event) => pickAccount(event.target.value)}
              >
                {accountOptions}
              </select>
            )}
          </Field>

          {draft.accountId !== undefined && (
            <Field label="Its cash" hint="the holding that is the account’s own cash">
              <select
                className={SELECT}
                aria-label="The holding that is the account’s cash"
                value={cashId ?? ''}
                onChange={(event) => setCashId(event.target.value === '' ? undefined : event.target.value)}
              >
                {!cashChoices.some((held) => held.accountId === draft.accountId) && (
                  <option value="">A new holding, Cash</option>
                )}
                {cashChoices.map((held) => (
                  <option key={held.id} value={held.id}>
                    {held.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="mt-8 grid max-w-3xl grid-cols-1 gap-4">
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

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
            {isNew ? 'Add place' : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>

          <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
            {problems.map((each) => (
              <span key={each}>{PROBLEM_MESSAGE[each]}</span>
            ))}
            {problem !== undefined && <span>{problem}</span>}
          </span>
        </div>
      </div>
    </form>
  )
}

const PROBLEM_MESSAGE: Readonly<Record<HoldingPlaceProblem, string>> = {
  NO_NAME: 'Give it a name',
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
