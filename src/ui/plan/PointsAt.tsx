import { useRef, useState } from 'react'

import type { SplitBucket, TargetKind } from '@/domain/model/plan.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'
import { FUND_TYPE_LABEL } from '@/ui/funds/labels.ts'
import { FUND_TYPES, type FundType } from '@/domain/model/funds.ts'

type Kind = Exclude<TargetKind, 'FREE'>

/** Everything a bucket can be pointed at, by kind. Open goals and debts only: a closed one takes nothing. */
export interface Pointable {
  readonly SAVING_GOAL: readonly { readonly id: string; readonly name: string }[]
  readonly DEBT: readonly { readonly id: string; readonly name: string }[]
  readonly CATEGORY: readonly { readonly id: string; readonly name: string }[]
  readonly FUND: readonly { readonly id: string; readonly name: string }[]
  readonly ACCOUNT: readonly { readonly id: string; readonly name: string }[]
  /** Where a new goal's money can be kept (M28 F10): without one it can take no deposit. */
  readonly holdings?: readonly { readonly id: string; readonly name: string }[]
  /**
   * The categories a new one can go under (M28 F29), by path, and which tab
   * each is on — a new category takes its parent's kind, so a spending one is
   * offered spending parents. Its bucket lands under that parent's top level.
   */
  readonly parents?: readonly { readonly id: string; readonly name: string; readonly moved: boolean }[]
}

/**
 * What a new thing needs, as the approved mockup's form asks it (M28 U8, F10): a goal's
 * name, target, date and where it is kept; a debt's name and what is left; a fund's kind;
 * an account's kind and last four digits; a category's kind.
 */
export interface NewPointable {
  readonly name: string
  /** A debt: what is left to pay, as typed. A category: SPENDING or MOVED. A fund: its type. An account: its kind. */
  readonly detail: string
  /** A goal: its target as typed, and the month it is wanted by (YYYY-MM). */
  readonly target?: string
  readonly by?: string
  /** A goal: the holding its money sits in. */
  readonly holdingId?: string
  /** An account: its last four digits. */
  readonly last4?: string
  /** A category: the category it goes under (M28 F29); none is the top level. */
  readonly parentId?: string
}

const TABS: readonly (readonly [Kind, string])[] = [
  ['SAVING_GOAL', 'Goal'],
  ['DEBT', 'Debt'],
  ['CATEGORY', 'Category'],
  ['FUND', 'Fund'],
  ['ACCOUNT', 'Account'],
]

const NOUN: Readonly<Record<Kind, string>> = {
  SAVING_GOAL: 'goal',
  DEBT: 'debt',
  CATEGORY: 'category',
  FUND: 'fund',
  ACCOUNT: 'account',
}

const FORM_FIELD = 'h-[30px] min-w-0 border border-hairline-strong bg-background px-2'

/**
 * What a bucket points at (M28 U7, D-319), drawn as the Wealth mockup's popover
 * (F10): one tab per kind, what the document already has of it, and a form to make
 * a new one and point the bucket at it in one go. Escape and a click outside close it.
 */
export function PointsAt({
  bucket,
  at,
  options,
  onPick,
  onCreate,
  onClose,
}: {
  bucket: SplitBucket
  at: { readonly x: number; readonly y: number }
  options: Pointable
  onPick: (kind: TargetKind, id: string | undefined) => void
  /** Make the thing and point the bucket at it. Returns the reason it could not, if so. */
  onCreate: (kind: Kind, draft: NewPointable) => string | undefined
  onClose: () => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const [kind, setKind] = useState<Kind>(bucket.targetKind === 'FREE' ? 'SAVING_GOAL' : bucket.targetKind)
  const [problem, setProblem] = useState<string | undefined>()

  const dismissKey = useDismiss(true, holder, onClose)

  const left = Math.max(8, Math.min(at.x, window.innerWidth - 400))
  const top = Math.max(8, Math.min(at.y + 4, window.innerHeight - 480))

  return (
    <div
      ref={holder}
      onKeyDown={dismissKey}
      role="dialog"
      aria-label={`What ${bucket.name} is for`}
      className="fc-pop-enter fixed z-50 flex max-h-[470px] w-[390px] flex-col border border-hairline-strong bg-elevated pb-3 shadow-pop"
      style={{ left, top }}
    >
      <div className="flex flex-col gap-px border-b border-hairline px-3.5 py-2.5 text-caption text-ink-secondary">
        <b className="truncate font-medium text-ink">
          What is <Bidi>{bucket.name}</Bidi> for?
        </b>
        <span>Pick one, or make a new one here.</span>
      </div>
      <div className="flex border-b border-hairline" role="tablist">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => {
              setKind(value)
              setProblem(undefined)
            }}
            className={`-mb-px h-[34px] flex-1 border-b-2 text-caption ${
              kind === value ? 'border-accent text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="py-1.5">
          {options[kind].map((each) => {
            const on = bucket.targetKind === kind && bucket.targetId === each.id
            return (
              <button
                key={each.id}
                type="button"
                onClick={() => onPick(kind, each.id)}
                className="grid min-h-[30px] w-full grid-cols-[minmax(0,1fr)_18px] items-center gap-2.5 px-3.5 text-left hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none"
              >
                <span className="flex min-w-0">
                  <Bidi className="min-w-0 truncate">{each.name}</Bidi>
                </span>
                {on && <ActionGlyph name="check" size={14} />}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => onPick('FREE', undefined)}
            className="grid min-h-[30px] w-full grid-cols-[minmax(0,1fr)_18px] items-center gap-2.5 px-3.5 text-left text-ink-secondary hover:bg-accent-soft"
          >
            <span>Nothing in particular</span>
            {bucket.targetKind === 'FREE' && <ActionGlyph name="check" size={14} />}
          </button>
        </div>
        <NewForm
          key={kind}
          kind={kind}
          holdings={options.holdings ?? []}
          parents={options.parents ?? []}
          problem={problem}
          onCancel={onClose}
          onCreate={(draft) => setProblem(onCreate(kind, draft))}
        />
      </div>
    </div>
  )
}

const ACCOUNT_KINDS: readonly (readonly [string, string])[] = [
  ['BANK', 'Bank account'],
  ['CREDIT_CARD', 'Credit card'],
  ['CASH', 'Cash'],
  ['HOLDINGS', 'Account with holdings'],
]

/** The mockup's `.newform`: the kind's fields in a label column, and one action. */
function NewForm({
  kind,
  holdings,
  parents,
  problem,
  onCreate,
  onCancel,
}: {
  kind: Kind
  holdings: readonly { readonly id: string; readonly name: string }[]
  parents: readonly { readonly id: string; readonly name: string; readonly moved: boolean }[]
  problem: string | undefined
  onCreate: (draft: NewPointable) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [detail, setDetail] = useState(
    kind === 'CATEGORY' ? 'SPENDING' : kind === 'FUND' ? 'PENSION' : kind === 'ACCOUNT' ? 'BANK' : '',
  )
  const [target, setTarget] = useState('')
  const [by, setBy] = useState('')
  const [holdingId, setHoldingId] = useState(holdings[0]?.id ?? '')
  const [last4, setLast4] = useState('')
  const [parentId, setParentId] = useState('')
  const ready = name.trim() !== '' && (kind !== 'DEBT' || detail.trim() !== '')
  const submit = (): void => {
    if (!ready) return
    onCreate({
      name: name.trim(),
      detail,
      ...(target.trim() === '' ? {} : { target }),
      ...(by === '' ? {} : { by }),
      ...(holdingId === '' ? {} : { holdingId }),
      ...(last4.trim() === '' ? {} : { last4: last4.trim() }),
      ...(kind === 'CATEGORY' && parentId !== '' ? { parentId } : {}),
    })
  }
  const label = (id: string, text: string) => (
    <label htmlFor={id} className="text-ink-secondary">
      {text}
    </label>
  )
  return (
    <div className="flex flex-col gap-2.5 border-t border-hairline px-3.5 pt-2.5">
      <b className="text-[13px] font-medium">New {NOUN[kind]}</b>
      <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        {label('pa-name', 'Name')}
        <input id="pa-name" value={name} onChange={(event) => setName(event.target.value)} className={FORM_FIELD} />
        {kind === 'SAVING_GOAL' && (
          <>
            {label('pa-target', 'Target')}
            <input
              id="pa-target"
              inputMode="decimal"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className={`${FORM_FIELD} text-right tabular-nums`}
            />
            {label('pa-by', 'By')}
            <input id="pa-by" type="month" value={by} onChange={(event) => setBy(event.target.value)} className={FORM_FIELD} />
            {label('pa-kept', 'Where is the money?')}
            <select id="pa-kept" value={holdingId} onChange={(event) => setHoldingId(event.target.value)} className={FORM_FIELD}>
              {holdings.length === 0 && <option value="">Not said yet</option>}
              {holdings.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </>
        )}
        {kind === 'DEBT' && (
          <>
            {label('pa-left', 'Left')}
            <input
              id="pa-left"
              inputMode="decimal"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              className={`${FORM_FIELD} text-right tabular-nums`}
            />
          </>
        )}
        {kind === 'CATEGORY' && (
          <>
            {label('pa-kind', 'Kind')}
            <select
              id="pa-kind"
              value={detail}
              onChange={(event) => {
                setDetail(event.target.value)
                setParentId('')
              }}
              className={FORM_FIELD}
            >
              <option value="SPENDING">Spending</option>
              <option value="MOVED">Money moved</option>
            </select>
            {label('pa-under', 'Under')}
            <select id="pa-under" value={parentId} onChange={(event) => setParentId(event.target.value)} className={FORM_FIELD}>
              <option value="">Top level</option>
              {parents
                .filter((one) => one.moved === (detail === 'MOVED'))
                .map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
            </select>
          </>
        )}
        {kind === 'FUND' && (
          <>
            {label('pa-kind', 'Kind')}
            <select id="pa-kind" value={detail} onChange={(event) => setDetail(event.target.value)} className={FORM_FIELD}>
              {FUND_TYPES.map((one: FundType) => (
                <option key={one} value={one}>
                  {FUND_TYPE_LABEL[one]}
                </option>
              ))}
            </select>
          </>
        )}
        {kind === 'ACCOUNT' && (
          <>
            {label('pa-kind', 'Kind')}
            <select id="pa-kind" value={detail} onChange={(event) => setDetail(event.target.value)} className={FORM_FIELD}>
              {ACCOUNT_KINDS.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            {label('pa-last4', 'Last 4 digits')}
            <input
              id="pa-last4"
              inputMode="numeric"
              maxLength={4}
              value={last4}
              onChange={(event) => setLast4(event.target.value.replace(/\D/g, ''))}
              className={FORM_FIELD}
            />
          </>
        )}
      </div>
      {problem !== undefined && <span className="text-caption text-negative">{problem}</span>}
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" icon="add" disabled={!ready} onClick={submit}>
          Make it and point here
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
