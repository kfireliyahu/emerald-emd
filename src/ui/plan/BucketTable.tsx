import { Fragment, useState, type ReactNode } from 'react'

import { formatMoney, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { basisPointsText, formatPercent } from '@/core/percent.ts'
import { formatYearMonth } from '@/core/time.ts'
import type { BucketReading } from '@/data/repositories/planMonthRepository.ts'
import { ALLOCATION_MODES, type AllocationMode, type SplitBucket } from '@/domain/model/plan.ts'
import type { ComputedAllocation, VarianceLine } from '@/domain/splitter.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { CountingAmount } from '@/ui/components/Amount.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import type { BucketSection } from '@/ui/plan/bucketGroups.ts'
import { KIND_LABEL } from '@/ui/plan/planLook.ts'

const MODE_WORDS: Readonly<Record<AllocationMode, string>> = {
  PERCENTAGE: 'Percent',
  FIXED_AMOUNT: 'Fixed amount',
  REMAINDER: 'What’s left',
}

/** What one row needs from the screen. */
export interface BucketRowProps {
  readonly entry: ComputedAllocation
  readonly colour: string
  readonly reading: BucketReading | undefined
  /** What it got in the month under *Against* (M31 U4); undefined when the plan has no line for it. */
  readonly line: VarianceLine | undefined
  readonly targetName: string | undefined
  readonly orphaned: boolean
  readonly hot: boolean
  readonly currency: CurrencyCode
  readonly amountText: string
  readonly percentText: string | undefined
  readonly renaming: boolean
}

/**
 * The buckets under the bar (M28 U7, D-319): what each is, what it points at,
 * how it is sized, what it comes to, and what it got in the month under
 * *Against* (M31 U4) — the comparison, always on the screen, in the bar's order.
 *
 * **Says plainly what it points at**, because that was the question the old
 * kind-select answered badly: a button naming the kind and the thing, and a
 * dashed one when it names nothing. The suggestions that live here — when a
 * goal is reached at this rate (S4) and money with no job to do (S5) — are
 * sentences, never colour. Over and under are words too: spending over is bad
 * news and saving over is good, and the table cannot tell which is which.
 */
export function BucketTable({
  sections,
  gotIn,
  measured,
  onHot,
  onPointsAt,
  onMenu,
  onMode,
  onPercentage,
  onPercentText,
  onAmountText,
  onAmountCommit,
  onRename,
  onCancelRename,
  below,
}: {
  /** The buckets under their groups' headings (M28 F25, `sectionBuckets`); one section draws no heading. */
  sections: readonly BucketSection<BucketRowProps>[]
  /** The month under *Against*, as the column says it: `September`. */
  gotIn: string
  /** Whether a statement has been read for that month; without one, spending is unknown. */
  measured: boolean
  onHot: (bucketId: string | undefined) => void
  onPointsAt: (bucket: SplitBucket, at: { x: number; y: number }) => void
  onMenu: (bucket: SplitBucket, at: { x: number; y: number }) => void
  onMode: (allocationId: string, mode: AllocationMode) => void
  onPercentage: (allocationId: string, basisPoints: number) => void
  onPercentText: (bucketId: string, text: string | undefined) => void
  onAmountText: (allocationId: string, bucketId: string, text: string) => void
  onAmountCommit: (allocationId: string, bucketId: string) => void
  onRename: (bucketId: string, name: string) => void
  onCancelRename: () => void
  /** Drawn right under a bucket's row: the remove confirm sits at the bucket it removes (M28 F10). */
  below?: ((bucketId: string) => ReactNode) | undefined
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div className={`grid ${COLUMNS} gap-x-3.5 py-1.5 text-label text-ink-tertiary uppercase`}>
          <span>Bucket</span>
          <span>For</span>
          <span>How much</span>
          <span className="text-right">Planned</span>
          <span className="text-right">Got in {gotIn}</span>
          <span />
        </div>
        {sections.map((section, index) => (
          <Fragment key={`${String(index)}:${section.name}`}>
            {section.name !== '' && <Heading section={section} sections={sections} />}
            {section.rows.map(renderRow)}
          </Fragment>
        ))}
      </div>
    </div>
  )

  function renderRow(row: BucketRowProps): ReactNode {
          const { entry, reading } = row
          const { allocation, bucket, amount } = entry
          const basisPoints = allocation.basisPoints ?? 0
          const pointer = bucket.targetKind === 'FREE' || row.orphaned
          return (
            <Fragment key={bucket.id}>
            <div
              data-bucket={bucket.id}
              onMouseEnter={() => onHot(bucket.id)}
              onMouseLeave={() => onHot(undefined)}
              className={`grid ${COLUMNS} items-center gap-x-3.5 border-b border-hairline py-3 ${
                row.hot ? 'bg-accent-soft' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden className="h-[30px] w-2 shrink-0" style={{ backgroundColor: row.colour }} />
                <div className="min-w-0">
                  {row.renaming ? (
                    <Rename
                      name={bucket.name}
                      onDone={(name) => onRename(bucket.id, name)}
                      onCancel={onCancelRename}
                    />
                  ) : (
                    <b className="flex min-w-0 font-medium">
                      <Bidi className="min-w-0 truncate">{bucket.name}</Bidi>
                    </b>
                  )}
                  {(allocation.isLocked || bucket.isBuffer) && (
                    <small className="block text-caption text-ink-secondary">
                      {[allocation.isLocked ? 'keeps this size' : '', bucket.isBuffer ? 'takes the rounding' : '']
                        .filter((part) => part !== '')
                        .join(' · ')}
                    </small>
                  )}
                </div>
              </div>

              <div className="flex min-w-0 flex-col items-start gap-1">
                <button
                  type="button"
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect()
                    onPointsAt(bucket, { x: box.left, y: box.bottom })
                  }}
                  className={`inline-flex h-8 max-w-full items-center gap-2 border bg-background px-2.5 hover:border-accent ${
                    pointer ? 'border-dashed border-hairline-strong text-ink-secondary' : 'border-hairline-strong'
                  }`}
                >
                  {!pointer && <span className="shrink-0 text-label text-ink-secondary uppercase">{KIND_LABEL[bucket.targetKind]}</span>}
                  <span className="truncate font-medium">
                    {pointer ? (row.orphaned ? 'Its target is gone' : 'Nothing in particular') : <Bidi>{row.targetName ?? ''}</Bidi>}
                  </span>
                </button>
                {reading?.reach !== undefined && (
                  <small className="text-caption text-ink-secondary">
                    {reading.reach.kind === 'reached'
                      ? 'goal reached'
                      : `reached ${formatYearMonth(reading.reach.period)} at this rate`}
                  </small>
                )}
                {reading?.noTarget === true && (
                  <small className="border border-dashed border-flow-tax px-1.5 text-caption text-flow-tax">
                    money with no job to do
                  </small>
                )}
              </div>

              <div className="flex flex-col items-start gap-1.5">
                <div role="radiogroup" aria-label={`How ${bucket.name} is sized`} className="inline-flex">
                  {ALLOCATION_MODES.map((mode, index) => {
                    const on = allocation.mode === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onMode(allocation.id, mode)}
                        className={`h-[26px] border px-2 text-[11px] whitespace-nowrap ${index === 0 ? '' : '-ml-px'} ${
                          on
                            ? 'relative z-[1] border-accent bg-accent-soft text-ink'
                            : 'border-hairline-strong text-ink-secondary hover:text-ink'
                        }`}
                      >
                        {MODE_WORDS[mode]}
                      </button>
                    )
                  })}
                </div>
                {allocation.mode === 'PERCENTAGE' ? (
                  <span className="flex min-h-[30px] items-center gap-1.5">
                    <input
                      value={row.percentText ?? storedPercent(basisPoints)}
                      disabled={allocation.isLocked}
                      onChange={(event) => onPercentText(bucket.id, event.target.value)}
                      onBlur={(event) => {
                        const typed = Number(event.target.value.replace(/[^\d.]/g, ''))
                        // An unreadable entry drops back to what is stored: clearing
                        // a bucket is a thing you do on purpose.
                        if (event.target.value.trim() !== '' && Number.isFinite(typed)) {
                          onPercentage(allocation.id, Math.round(typed * 100))
                        }
                        onPercentText(bucket.id, undefined)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                        if (event.key === 'Escape') onPercentText(bucket.id, undefined)
                      }}
                      aria-label={`${bucket.name} percentage`}
                      className={`${FIELD} w-20 text-right tabular-nums disabled:opacity-40`}
                    />
                    <span className="text-ink-secondary">% of the split</span>
                  </span>
                ) : allocation.mode === 'FIXED_AMOUNT' ? (
                  <span className="flex min-h-[30px] items-center gap-1.5">
                    <input
                      value={row.amountText}
                      disabled={allocation.isLocked}
                      onChange={(event) => onAmountText(allocation.id, bucket.id, event.target.value)}
                      onBlur={() => onAmountCommit(allocation.id, bucket.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                      placeholder="0.00"
                      aria-label={`${bucket.name} amount`}
                      className={`${FIELD} w-28 text-right tabular-nums disabled:opacity-40`}
                    />
                    <span className="text-ink-secondary">a month</span>
                  </span>
                ) : (
                  <span className="flex min-h-[30px] items-center text-ink-secondary">
                    {amount.minor < 0 ? 'Nothing is left for it' : 'Whatever is left over'}
                  </span>
                )}
              </div>

              <div className="text-right tabular-nums">
                <CountingAmount value={amount} className="block text-[15px] font-medium" />
                <small className="block text-caption text-ink-secondary">
                  {formatPercent(entry.shareBasisPoints, { digits: 1 })} of the split
                </small>
              </div>

              <Got line={row.line} bucket={bucket} measured={measured} />

              <button
                type="button"
                aria-label={`More for ${bucket.name}`}
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  onMenu(bucket, { x: box.left, y: box.bottom })
                }}
                className="size-8 text-ink-secondary hover:text-ink"
              >
                ⋯
              </button>
            </div>
            {below?.(bucket.id)}
            </Fragment>
          )
  }
}

const COLUMNS = 'grid-cols-[minmax(0,1.15fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_120px_150px_36px]'

/** A share's heading: its name, its part of the split, and what it planned and got (M31 U4). */
function Heading({
  section,
  sections,
}: {
  section: BucketSection<BucketRowProps>
  sections: readonly BucketSection<BucketRowProps>[]
}) {
  const currency = section.rows[0]?.currency ?? 'ILS'
  const planned = section.rows.reduce((sum, row) => sum + row.entry.amount.minor, 0)
  const all = sections.flatMap((one) => one.rows).reduce((sum, row) => sum + row.entry.amount.minor, 0)
  const lines = section.rows.map((row) => row.line?.actual)
  const got = lines.every((one) => one !== undefined)
    ? money(lines.reduce((sum, one) => sum + (one?.minor ?? 0), 0), currency)
    : undefined
  return (
    <div className="grid h-10 grid-cols-[minmax(0,1fr)_120px_150px_36px] items-end gap-x-3.5 border-b border-hairline-strong pb-1.5">
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className="fc-label text-ink uppercase">
          <Bidi>{section.name}</Bidi>
        </span>
        {all > 0 && (
          <span className="text-caption text-ink-secondary">
            {formatPercent(Math.round((planned / all) * 10000), { digits: 0 })} of the split
          </span>
        )}
      </span>
      <span className="text-right text-[13px] text-ink-secondary tabular-nums">{formatMoney(money(planned, currency))}</span>
      <span className="text-right text-[13px] text-ink-secondary tabular-nums">{got === undefined ? '' : formatMoney(got)}</span>
      <span />
    </div>
  )
}

/**
 * What a bucket got in the month under *Against*, and how that stands against
 * the plan, in words. A bucket nothing records says so instead of a zero.
 */
function Got({ line, bucket, measured }: { line: VarianceLine | undefined; bucket: SplitBucket; measured: boolean }) {
  const actual: Money | undefined = line?.actual
  if (line === undefined || actual === undefined) {
    return (
      <div className="text-right text-caption text-ink-tertiary">
        {bucket.targetKind === 'CATEGORY' && !measured ? 'unknown' : 'not measured'}
      </div>
    )
  }
  const variance = actual.minor - line.planned.minor
  return (
    <div className="text-right tabular-nums">
      <span className="block">{formatMoney(actual)}</span>
      <small className="block text-caption text-ink-secondary">
        {bucket.targetKind === 'SAVING_GOAL' && actual.minor === 0
          ? 'no deposit recorded'
          : variance === 0
            ? 'on plan'
            : `${formatMoney(money(Math.abs(variance), actual.currency))} ${variance > 0 ? 'over' : 'under'}`}
      </small>
    </div>
  )
}

function Rename({
  name,
  onDone,
  onCancel,
}: {
  name: string
  onDone: (name: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(name)
  return (
    <input
      autoFocus
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => (text.trim() === '' ? onCancel() : onDone(text.trim()))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') onCancel()
      }}
      aria-label="Bucket name"
      className={`${FIELD} w-full`}
    />
  )
}

/** Basis points as the field shows them: `50`, and `12.5` when it has a fraction. */
function storedPercent(basisPoints: number): string {
  return basisPointsText(basisPoints)
}
