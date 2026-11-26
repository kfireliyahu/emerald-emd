import { useRef, useState } from 'react'

import { formatMoney } from '@/core/money.ts'
import { parseISODate, toISODate } from '@/core/time.ts'
import {
  NEW_PLACE_KINDS,
  type NewPlaceAnswer,
  type NewPlaceKind,
  type WhereAnswer,
  type WhereChoice,
} from '@/data/repositories/goalWhereRepository.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { useDismiss } from '@/ui/components/useDismiss.ts'
import { Tag } from '@/ui/wealth/parts.tsx'
import { otherGoal, whereDetail, whereName } from '@/ui/wealth/words.ts'

/** `2026-09-30` → `30 Sep`: the day a figure is from, as the list says it, in the language on screen. */
export function dayMonth(iso: string, dates: DateWords): string {
  const date = parseISODate(iso)
  if (date === undefined) return iso
  return dates.dayMonth(date)
}

/** What a choice holds now, as the list says it beside the name. */
function figureText(choice: WhereChoice, t: Translate, dates: DateWords): string | undefined {
  if (choice.followedBy !== undefined) return t('wealth.where.followedBy', { goal: otherGoal(choice.followedBy, t) })
  const figure = choice.figure
  if (figure === undefined) return undefined
  if (figure.kind === 'RECORDED') return t('wealth.where.recorded', { amount: formatMoney(figure.amount) })
  return figure.on === ''
    ? formatMoney(figure.amount)
    : t('wealth.where.on', { amount: formatMoney(figure.amount), day: dayMonth(figure.on, dates) })
}

/** Only what can be locked asks until when. */
const LOCKABLE: ReadonlySet<NewPlaceKind> = new Set(['DEPOSIT', 'FUND'])

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="flex-none text-ink-tertiary">
      <path d={up ? 'M3 7.5l3-3 3 3' : 'M3 4.5l3 3 3-3'} />
    </svg>
  )
}

/**
 * **Where is the money?** (M30 F3, the approved mockup's list) — the bank accounts,
 * then each place with holdings, then what is kept by hand, each by one name
 * with what it holds now; a holding another goal follows is shown and cannot be
 * picked. **+ New…** opens a small form in place for a place without statements,
 * and nothing is written until the goal is: *Use it* only makes it the answer.
 */
export function WherePicker({
  choices,
  value,
  onChange,
  saveWord,
}: {
  choices: readonly WhereChoice[]
  value: WhereAnswer
  onChange: (value: WhereAnswer) => void
  /** The form's own button — Add goal, or Save — which is when a new place is written. */
  saveWord: string
}) {
  const t = useT()
  const dates = useDates()
  const said = (choice: WhereChoice): string | undefined => figureText(choice, t, dates)
  const [open, setOpen] = useState(false)
  const [making, setMaking] = useState<NewPlaceAnswer | undefined>()
  const box = useRef<HTMLDivElement>(null)

  const dismissKey = useDismiss(open, box, () => setOpen(false))

  const chosen = value?.kind === 'HOLDING' ? choices.find((one) => one.holdingId === value.holdingId) : undefined
  const groups: { readonly key: string; readonly label: string; readonly items: WhereChoice[] }[] = []
  for (const choice of choices) {
    const key = choice.group.kind === 'HELD' ? `held:${choice.group.placeId}` : choice.group.kind
    const label =
      choice.group.kind === 'BANK' ? t('wealth.where.bank') : choice.group.kind === 'HELD' ? choice.group.placeName : t('wealth.where.byHand')
    const group = groups.find((one) => one.key === key)
    if (group === undefined) groups.push({ key, label, items: [choice] })
    else group.items.push(choice)
  }

  const pick = (choice: WhereChoice): void => {
    if (choice.followedBy !== undefined) return
    onChange({ kind: 'HOLDING', holdingId: choice.holdingId })
    setMaking(undefined)
    setOpen(false)
  }
  const startNew = (): void =>
    setMaking((current) => current ?? { kind: 'CASH_AT_HOME', name: '', institution: undefined, lockedUntil: undefined })

  return (
    <div ref={box} className="relative" onKeyDown={dismissKey}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('wealth.where.label')}
        onClick={() => setOpen((was) => !was)}
        className={`${FIELD} flex w-full min-w-0 items-center gap-2.5 text-start ${open ? 'border-accent' : ''}`}
      >
        {value === undefined ? (
          <span className="min-w-0 flex-1 truncate text-ink-tertiary">{t('wealth.where.pick')}</span>
        ) : value.kind === 'NEW' ? (
          <>
            <span className="flex min-w-0 flex-1 items-baseline">
              <Bidi className="min-w-0 truncate">{value.place.name}</Bidi>
              {value.place.institution !== undefined && value.place.institution.trim() !== '' && (
                <span className="ms-1.5 shrink-0 text-caption whitespace-nowrap text-ink-secondary">
                  <Phrase text={t('wealth.where.at')} parts={{ place: <Bidi>{value.place.institution}</Bidi> }} />
                </span>
              )}
            </span>
            <Tag tone="dash">{t('wealth.where.new')}</Tag>
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 items-baseline">
              <Bidi className="min-w-0 truncate">{chosen === undefined ? t('wealth.where.gone') : whereName(chosen, t)}</Bidi>
              {chosen?.detail !== undefined && (
                <span className="ms-1.5 text-caption text-ink-secondary">
                  <Bidi>{whereDetail(chosen, t)}</Bidi>
                </span>
              )}
            </span>
            {chosen !== undefined && said(chosen) !== undefined && (
              <span className="text-caption whitespace-nowrap text-ink-secondary tabular-nums">{said(chosen)}</span>
            )}
          </>
        )}
        <Chevron up={open} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('wealth.where.label')}
          className="fc-pop-enter absolute top-full end-0 start-0 z-30 mt-1 max-h-[26rem] overflow-auto border border-hairline-strong bg-elevated py-1 shadow-pop"
        >
          {groups.map((group) => (
            <div key={group.key}>
              <div className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.08em] text-ink-tertiary uppercase">
                <Bidi>{group.label}</Bidi>
              </div>
              {group.items.map((choice) => {
                const taken = choice.followedBy !== undefined
                const on = value?.kind === 'HOLDING' && value.holdingId === choice.holdingId
                return (
                  <button
                    key={choice.holdingId}
                    type="button"
                    role="option"
                    aria-selected={on}
                    aria-disabled={taken}
                    onClick={() => pick(choice)}
                    className={`flex w-full min-w-0 items-baseline gap-2.5 px-3 py-1.5 text-start ${
                      taken ? 'cursor-default text-ink-tertiary' : on ? 'bg-accent-soft' : 'hover:bg-surface'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <Bidi>{whereName(choice, t)}</Bidi>
                      {choice.detail !== undefined && choice.group.kind !== 'HELD' && (
                        <span className="ms-1.5 text-caption text-ink-secondary">
                          <Bidi>{whereDetail(choice, t)}</Bidi>
                        </span>
                      )}
                    </span>
                    {said(choice) !== undefined && (
                      <span className={`text-caption whitespace-nowrap tabular-nums ${taken ? 'text-ink-tertiary' : 'text-ink-secondary'}`}>
                        <Bidi>{said(choice) ?? ''}</Bidi>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="my-1 border-t border-hairline" />
          <button
            type="button"
            onClick={startNew}
            className={`block w-full px-3 py-1.5 text-start font-medium text-accent ${making !== undefined ? 'bg-accent-soft' : 'hover:bg-surface'}`}
          >
            {t('wealth.where.newItem')}
          </button>
          {making !== undefined && (
            <NewPlace
              saveWord={saveWord}
              draft={making}
              onDraft={setMaking}
              onUse={() => {
                onChange({ kind: 'NEW', place: { ...making, name: making.name.trim() } })
                setOpen(false)
              }}
              onCancel={() => setMaking(undefined)}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** The micro form: a place without statements, holding one thing. */
function NewPlace({
  saveWord,
  draft,
  onDraft,
  onUse,
  onCancel,
}: {
  saveWord: string
  draft: NewPlaceAnswer
  onDraft: (draft: NewPlaceAnswer) => void
  onUse: () => void
  onCancel: () => void
}) {
  const t = useT()
  const set = (change: Partial<NewPlaceAnswer>): void => onDraft({ ...draft, ...change })
  const lockable = LOCKABLE.has(draft.kind)
  return (
    <div className="mx-2 mt-1 mb-2 flex flex-col gap-3 border border-hairline bg-surface p-3">
      <span className="text-[13px] font-medium">{t('wealth.where.newTitle')}</span>
      <div role="group" aria-label={t('wealth.where.what')} className="flex flex-wrap">
        {NEW_PLACE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            onClick={() => set({ kind, ...(LOCKABLE.has(kind) ? {} : { lockedUntil: undefined }) })}
            className={`-ms-px h-7 border px-2.5 text-[12px] whitespace-nowrap first:ms-0 ${
              draft.kind === kind
                ? 'relative z-[1] border-accent bg-accent-soft text-ink'
                : 'border-hairline-strong text-ink-secondary'
            }`}
          >
            {t(`wealth.kinds.newPlace.${kind}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.where.name')}</span>
          <input
            className={FIELD}
            autoFocus
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (draft.name.trim() !== '') onUse()
              }
            }}
          />
        </label>
        {draft.kind !== 'CASH_AT_HOME' && (
          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.where.atLabel')}</span>
            <input
              className={FIELD}
              value={draft.institution ?? ''}
              onChange={(event) => set({ institution: event.target.value === '' ? undefined : event.target.value })}
            />
            <span className="text-caption text-ink-tertiary">{t('wealth.where.atHint')}</span>
          </label>
        )}
        {lockable && (
          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.where.locked')}</span>
            <input
              type="date"
              className={FIELD}
              value={draft.lockedUntil === undefined ? '' : toISODate(draft.lockedUntil)}
              onChange={(event) => set({ lockedUntil: parseISODate(event.target.value) ?? undefined })}
            />
            <span className="text-caption text-ink-tertiary">{t('wealth.where.optional')}</span>
          </label>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" disabled={draft.name.trim() === ''} onClick={onUse}>
          {t('wealth.where.use')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('wealth.common.cancel')}
        </Button>
      </div>
      <p className="m-0 text-caption text-ink-secondary">
        {t('wealth.where.nothingUntil', { save: saveWord })}
      </p>
    </div>
  )
}
