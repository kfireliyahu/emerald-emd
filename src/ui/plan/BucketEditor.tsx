import { useState, type ReactNode } from 'react'

import { fromMajorUnits, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { basisPointsText, formatPercent } from '@/core/percent.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { BucketReading } from '@/data/repositories/planMonthRepository.ts'
import { ALLOCATION_MODES, type AllocationMode, type BucketShare, type SplitBucket } from '@/domain/model/plan.ts'
import type { ComputedAllocation, VarianceLine } from '@/domain/splitter.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { kitMoney } from '@/ui/charts/kit.ts'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { editableMoney } from '@/ui/components/moneyText.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { startEdge } from '@/ui/direction.ts'
import { SHARE_NAME } from '@/ui/plan/bucketGroups.ts'
import { KIND_LABEL } from '@/ui/plan/planLook.ts'

/** The 50 / 30 / 20 choices of a bucket's *Counts as*, and none of them (M31 U4). */
const SHARE_CHOICES: readonly (BucketShare | undefined)[] = ['NEEDS', 'WANTS', 'SAVING', undefined]

/**
 * **One bucket, beside the plan** (M64 U9, D-621): what was the buckets
 * table's row and its menu, now the side panel a bucket's line opens — the
 * bar and the planned and got figures stay on the page. Every change is
 * written as it is made, as the table's were; a typed size lands when its
 * field is left or Enter is pressed, and Esc puts back what is stored.
 *
 * Removing asks first, at the button that asked and naming the bucket: a
 * removed bucket's share moves to its neighbour and no undo puts it back.
 */
export function BucketEditor({
  entry,
  reading,
  line,
  targetName,
  orphaned,
  measured,
  gotIn,
  currency,
  shares,
  canUp,
  canDown,
  next,
  planName,
  onRename,
  onPointsAt,
  onMode,
  onPercent,
  onAmount,
  onLock,
  onShare,
  onUp,
  onDown,
  onSplit,
  onRemove,
}: {
  readonly entry: ComputedAllocation
  readonly reading: BucketReading | undefined
  readonly line: VarianceLine | undefined
  readonly targetName: string | undefined
  readonly orphaned: boolean
  /** Whether a statement has been read for the month it is held against. */
  readonly measured: boolean
  /** That month, as the page says it: `September`. */
  readonly gotIn: string
  readonly currency: CurrencyCode
  /** Whether the plan's buckets count as Needs, Wants and Saving. */
  readonly shares: boolean
  readonly canUp: boolean
  readonly canDown: boolean
  /** What takes its share once it is removed: the next bucket's name, or the money with no job. */
  readonly next: ReactNode
  readonly planName: string
  readonly onRename: (name: string) => void
  readonly onPointsAt: (at: { x: number; y: number }) => void
  readonly onMode: (mode: AllocationMode) => void
  readonly onPercent: (basisPoints: number) => void
  readonly onAmount: (minor: number) => void
  readonly onLock: (locked: boolean) => void
  readonly onShare: (share: BucketShare | undefined) => void
  readonly onUp: () => void
  readonly onDown: () => void
  readonly onSplit: () => void
  readonly onRemove: () => void
}) {
  const t = useT()
  const { allocation, bucket, amount } = entry
  const [name, setName] = useState(bucket.name)
  const [percent, setPercent] = useState<string | undefined>()
  const [amountText, setAmountText] = useState<string | undefined>()
  const [removing, setRemoving] = useState(false)
  const pointer = bucket.targetKind === 'FREE' || orphaned
  const shareName = (share: BucketShare | undefined): string => (share === undefined ? t('plan.screen.menu.noneOfThem') : SHARE_NAME[share])

  return (
    <>
      <HeadlineFigure
        label={t('plan.bucket.column.planned')}
        value={amount}
        change={t('plan.ofTheSplit', { percent: formatPercent(entry.shareBasisPoints, { digits: 1 }) })}
        empty={t('plan.bucket.nothingLeft')}
      />
      <Got line={line} bucket={bucket} measured={measured} gotIn={gotIn} />

      <Row label={t('plan.bucket.nameLabel')}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const typed = name.trim()
            if (typed === '') setName(bucket.name)
            else if (typed !== bucket.name) onRename(typed)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              setName(bucket.name)
            }
          }}
          aria-label={t('plan.bucket.nameLabel')}
          className={`${FIELD} w-full`}
        />
      </Row>

      <Row label={t('plan.bucket.column.for')}>
        <button
          type="button"
          onClick={(event) => onPointsAt(startEdge(event.currentTarget.getBoundingClientRect()))}
          className={`inline-flex h-8 max-w-full items-center gap-2 border bg-background px-2.5 hover:border-accent ${
            pointer ? 'border-dashed border-hairline-strong text-ink-secondary' : 'border-hairline-strong'
          }`}
        >
          {!pointer && <span className="shrink-0 text-caption text-ink-secondary">{KIND_LABEL[bucket.targetKind]}</span>}
          {pointer ? (
            <span className="truncate font-medium">{orphaned ? t('plan.bucket.targetGone') : t('plan.kind.FREE')}</span>
          ) : (
            <Bidi className="min-w-0 truncate font-medium">{targetName ?? ''}</Bidi>
          )}
        </button>
        {reading?.reach !== undefined && <Reach reading={reading} />}
        {reading?.noTarget === true && <span className="text-caption text-ink-secondary">{t('plan.bucket.noJob')}</span>}
      </Row>

      <Row label={t('plan.bucket.column.howMuch')}>
        <div role="radiogroup" aria-label={t('plan.bucket.sizedLabel', { name: bucket.name })} className="inline-flex">
          {ALLOCATION_MODES.map((mode, index) => {
            const on = allocation.mode === mode
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onMode(mode)}
                className={`h-8 border px-2.5 text-caption whitespace-nowrap ${index === 0 ? '' : '-ms-px'} ${
                  on ? 'relative z-[1] border-accent bg-accent-soft text-ink' : 'border-hairline-strong text-ink-secondary hover:text-ink'
                }`}
              >
                {t(`plan.bucket.mode.${mode}`)}
              </button>
            )
          })}
        </div>
        {allocation.mode === 'PERCENTAGE' ? (
          <span className="flex items-center gap-2">
            <input
              value={percent ?? basisPointsText(allocation.basisPoints ?? 0)}
              disabled={allocation.isLocked}
              onChange={(event) => setPercent(event.target.value)}
              onBlur={(event) => {
                const typed = Number(event.target.value.replace(/[^\d.]/g, ''))
                if (event.target.value.trim() !== '' && Number.isFinite(typed)) onPercent(Math.round(typed * 100))
                setPercent(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setPercent(undefined)
                }
              }}
              aria-label={t('plan.bucket.percentLabel', { name: bucket.name })}
              className={`${FIELD} w-20 text-end tabular-nums disabled:opacity-40`}
            />
            <span className="text-ink-secondary">{t('plan.bucket.percentOfSplit')}</span>
          </span>
        ) : allocation.mode === 'FIXED_AMOUNT' ? (
          <span className="flex items-center gap-2">
            <input
              value={amountText ?? editableMoney(allocation.amount === undefined ? undefined : { minor: allocation.amount.minor, currency })}
              disabled={allocation.isLocked}
              onChange={(event) => setAmountText(event.target.value)}
              onBlur={() => {
                const parsed = amountText === undefined ? undefined : parseAmountText(amountText)
                if (parsed !== undefined) onAmount(fromMajorUnits(Math.abs(parsed), currency).minor)
                setAmountText(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setAmountText(undefined)
                }
              }}
              placeholder="0.00"
              aria-label={t('plan.bucket.amountLabel', { name: bucket.name })}
              className={`${FIELD} w-28 text-end tabular-nums disabled:opacity-40`}
            />
            <span className="text-ink-secondary">{t('plan.aMonth')}</span>
          </span>
        ) : (
          <span className="text-ink-secondary">{amount.minor < 0 ? t('plan.bucket.nothingLeft') : t('plan.bucket.whateverLeft')}</span>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allocation.isLocked} onChange={(event) => onLock(event.target.checked)} className="size-3.5 accent-ink" />
          <span>{t('plan.screen.menu.lock')}</span>
          <span className="text-caption text-ink-secondary">{t('plan.screen.menu.lockDetail')}</span>
        </label>
      </Row>

      {shares && (
        <Row label={t('plan.screen.menu.countsAs')}>
          <ChoiceMenu
            text={shareName(bucket.share)}
            choices={SHARE_CHOICES.map((share) => ({ value: share ?? '', label: shareName(share) }))}
            onPick={(choice) => onShare(choice.value === '' ? undefined : (choice.value as BucketShare))}
            aria-label={t('plan.screen.menu.countsAs')}
          />
        </Row>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-4">
        <button type="button" className="fc-text-action" disabled={!canUp} onClick={onUp}>
          {t('plan.screen.menu.moveUp')}
        </button>
        <button type="button" className="fc-text-action" disabled={!canDown} onClick={onDown}>
          {t('plan.screen.menu.moveDown')}
        </button>
        {allocation.mode !== 'REMAINDER' && (
          <button type="button" className="fc-text-action" title={t('plan.screen.menu.splitDetail')} onClick={onSplit}>
            {t('plan.screen.menu.split')}
          </button>
        )}
        <button type="button" className="fc-text-action ms-auto" aria-expanded={removing} onClick={() => setRemoving(true)}>
          {t('plan.screen.removeBucket')}
        </button>
      </div>
      {removing && (
        <div role="alertdialog" aria-label={t('plan.screen.removeBucket')} className="fc-pop-enter flex flex-col gap-3 border border-hairline-strong px-4 py-3"
          onKeyDown={(event) => {
            // Esc takes back the question, never the panel it was asked in.
            if (event.key === 'Escape') {
              event.preventDefault()
              setRemoving(false)
            }
          }}
        >
          <span>
            <Phrase text={t('plan.screen.removeAsk')} parts={{ name: <Bidi>{bucket.name}</Bidi>, plan: <Bidi>{planName}</Bidi>, next }} />
          </span>
          <span className="flex gap-3">
            <Button variant="secondary" size="sm" onClick={onRemove}>
              {t('plan.screen.removeBucket')}
            </Button>
            <Button variant="ghost" size="sm" autoFocus onClick={() => setRemoving(false)}>
              {t('plan.keep')}
            </Button>
          </span>
        </div>
      )}
    </>
  )
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="text-caption text-ink-secondary">{label}</span>
      {children}
    </div>
  )
}

function Reach({ reading }: { readonly reading: BucketReading }) {
  const t = useT()
  const dates = useDates()
  const reach = reading.reach
  if (reach === undefined) return null
  return (
    <span className="text-caption text-ink-secondary">
      {reach.kind === 'reached' ? t('plan.bucket.goalReached') : t('plan.bucket.reachedAt', { month: dates.yearMonth(reach.period) })}
    </span>
  )
}

/** What the bucket got in the month it is held against, and how that stands against the plan, in words. */
function Got({
  line,
  bucket,
  measured,
  gotIn,
}: {
  readonly line: VarianceLine | undefined
  readonly bucket: SplitBucket
  readonly measured: boolean
  readonly gotIn: string
}) {
  const t = useT()
  const actual: Money | undefined = line?.actual
  const label = t('plan.bucket.column.gotIn', { month: gotIn })
  if (line === undefined || actual === undefined) {
    return (
      <p className="m-0 text-ink-secondary">
        {label}: {bucket.targetKind === 'CATEGORY' && !measured ? t('plan.bucket.unknown') : t('plan.bucket.notMeasured')}
      </p>
    )
  }
  const variance = actual.minor - line.planned.minor
  return (
    <p className="m-0">
      {label}: <span className="font-medium tabular-nums" dir="ltr">{kitMoney(actual)}</span>{' '}
      <span className="text-ink-secondary">
        {bucket.targetKind === 'SAVING_GOAL' && actual.minor === 0
          ? t('plan.bucket.noDeposit')
          : variance === 0
            ? t('plan.bucket.onPlan')
            : t(variance > 0 ? 'plan.bucket.over' : 'plan.bucket.under', { amount: kitMoney(money(Math.abs(variance), actual.currency)) })}
      </span>
    </p>
  )
}
