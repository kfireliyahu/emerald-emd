import { useEffect, useId, useRef, useState } from 'react'

import { formatMoney, money, type CurrencyCode, type Money } from '@/core/money.ts'
import type { SplitResult } from '@/domain/splitter.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import {
  crossPath,
  easeInOut,
  fractionAt,
  MORPH_MS,
  ringDims,
  segmentPath,
  topPath,
  unwrapFraction,
  type RingDims,
} from '@/ui/plan/ringGeometry.ts'
import { prefersReducedMotion } from '@/ui/useAnimatedNumber.ts'

export type PlanView = 'bar' | 'ring'

/** The ring's side, and the bar's place in the morph's drawing (header 34 + connector 26 above it). */
const RING_SIDE = 280
const BAR_TOP = 60
const BAR_THICK = 64
/** The bar block's height before it has been measured: header, connector, bar, axis. */
const BAR_BLOCK_GUESS = 150

/** One thing drawn on the bar or the ring, in the order it sits (fixed share, buckets, the free money). */
interface Piece {
  readonly key: string
  readonly kind: 'fixed' | 'bucket' | 'free'
  readonly from: number
  readonly to: number
  readonly colour: string
  readonly bucketId?: string
  readonly name: string
  readonly amount: Money
  /** What it got in the month under *Against*, when that is known (M31 U4). */
  readonly got?: Money | undefined
}

/** What the bar tells its screen while a divider is held, and when it is let go. */
export interface Trade {
  /** The allocation to the left of the divider: the one the hand moves. What is to its right gives way. */
  readonly leftId: string
  /** How big the left one should now be, in minor units, before snapping. */
  readonly leftMinor: number
}

/**
 * **The split as one bar, and the dividers on it are the control** (M28 U7,
 * D-319) — what the bar of D-174 became once a plan could hold fixed expenses
 * as well as buckets.
 *
 * Above it, the money's way in: what comes out of net before any of this, and
 * what is left to give a job. The connector between the two is only there so
 * the eye can follow the second down into the first.
 *
 * Each divider is a **slider on the bucket to its left** and a drag moves that
 * bucket only: the difference comes from, or goes to, the buckets to its right
 * and never the ones to its left (F7). The screen previews a drag without writing it (sixty
 * writes a second is the whole page re-rendering under the pointer) and the bar
 * only says where the hand is — what that means for an allocation is
 * `tradedAt`'s, in the domain, so the preview and the commit are one answer.
 *
 * Widths are CSS percentages — display geometry, where a rounding error is a
 * fraction of a pixel. Every figure printed is integer minor units.
 */
export function PlanBar({
  basis,
  netOff,
  result,
  colours,
  got,
  billsGot,
  locked,
  hot,
  onHot,
  tip,
  onTrade,
  onCommit,
  onNudge,
  snap,
  label,
  readOnly = false,
  view = 'bar',
}: {
  basis: Money
  netOff: Money
  result: SplitResult
  colours: ReadonlyMap<string, string>
  /**
   * **What each bucket got in the month under *Against*** (M31 U4), by bucket: the segment fills
   * from the left in its top line's colour up to it, and a bar at its right end says it went over.
   * It replaced the dashed tick of the last three months' average.
   */
  got?: ReadonlyMap<string, Money> | undefined
  /** What the bills in the split were charged in that month: the bills piece fills the same way. */
  billsGot?: Money | undefined
  /** Allocation ids that may not move. */
  locked: ReadonlySet<string>
  hot?: string | undefined
  onHot?: ((bucketId: string | undefined) => void) | undefined
  tip?: { readonly text: string; readonly at: number } | undefined
  onTrade?: ((trade: Trade, at: number) => void) | undefined
  onCommit?: ((trade: Trade) => void) | undefined
  onNudge?: ((trade: Trade) => void) | undefined
  snap: number
  /** Names the bar when more than one is on screen (S2). */
  label?: string | undefined
  readOnly?: boolean
  /** **The same segments, as a bar or as a ring** (D-320); changing it animates one into the other. */
  view?: PlanView
}) {
  const track = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const ringBox = useRef<HTMLDivElement>(null)
  const barBlock = useRef<HTMLDivElement>(null)
  const barHeight = useRef(BAR_BLOCK_GUESS)
  const stageWidth = useRef(0)
  const hatch = useId()
  // 0 is the bar and 1 the ring; between them is the morph. Driven from here
  // because CSS cannot move the points of a path (the reason useAnimatedNumber
  // is JavaScript too), and it reads the reduced-motion query the same way.
  const [t, setT] = useState(view === 'ring' ? 1 : 0)
  const [animating, setAnimating] = useState(false)
  const tNow = useRef(t)

  useEffect(() => {
    const target = view === 'ring' ? 1 : 0
    if (tNow.current === target) return
    const width = stage.current?.offsetWidth ?? 0
    if (prefersReducedMotion() || width === 0 || document.hidden) {
      tNow.current = target
      setT(target)
      setAnimating(false)
      return
    }
    stageWidth.current = width
    const from = tNow.current
    const began = performance.now()
    const duration = MORPH_MS * Math.abs(target - from)
    setAnimating(true)
    let frame = 0
    const step = (now: number): void => {
      const progress = Math.min(1, (now - began) / duration)
      tNow.current = from + (target - from) * easeInOut(progress)
      setT(tNow.current)
      if (progress < 1) {
        frame = requestAnimationFrame(step)
        return
      }
      tNow.current = target
      setT(target)
      setAnimating(false)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [view])

  useEffect(() => {
    if (!animating && t === 0 && barBlock.current !== null) barHeight.current = barBlock.current.offsetHeight
  })

  const currency: CurrencyCode = basis.currency
  const share = result.fixedShare
  const segments = result.allocations.filter((entry) => entry.amount.minor > 0)
  const assigned = segments.reduce((running, entry) => running + entry.amount.minor, 0)
  const free = Math.max(0, result.balance.minor)
  const total = Math.max(result.splittable.minor, assigned + (share?.minor ?? 0))

  if (total <= 0) {
    return (
      <div
        className="flex h-16 items-center justify-center border border-dashed border-hairline-strong text-ink-secondary"
        role="img"
        aria-label="Nothing to split yet"
      >
        Nothing to split yet
      </div>
    )
  }

  const pct = (minor: number): string => `${String((Math.max(0, minor) / total) * 100)}%`
  const keepShare = basis.minor > 0 ? Math.max(0, Math.min(1, result.splittable.minor / basis.minor)) : 1

  // Where each segment starts, left to right, fixed share first.
  let cursor = share?.minor ?? 0
  const placed = segments.map((entry) => {
    const start = cursor
    cursor += entry.amount.minor
    return { entry, start }
  })

  const mode: 'bar' | 'ring' | 'morph' = animating ? 'morph' : t >= 1 ? 'ring' : 'bar'
  const ringShown = mode === 'ring'

  const edgeFor = (event: { readonly clientX: number }): number => {
    const box = track.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return 0
    return Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * total
  }

  const startDrag = (event: React.PointerEvent, index: number): void => {
    if (onTrade === undefined) return
    const here = placed[index]
    if (here === undefined) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    // **The trade is carried here and handed over at the end**, never read back
    // from the screen's state: this closure was made when the pointer went down,
    // and the state it would read is the state of that moment — undefined — so
    // the first drag of every session wrote nothing (the bar of D-174 found it).
    let last: Trade | undefined
    // On the ring the hand is read as an angle, unwrapped against where the
    // divider was so that passing 12 o'clock continues instead of jumping.
    let previous = (here.start + here.entry.amount.minor) / total
    const move = (moved: PointerEvent): void => {
      let edge: number
      let box: DOMRect | undefined
      if (ringShown && ringBox.current !== null) {
        box = ringBox.current.getBoundingClientRect()
        const raw = fractionAt(moved.clientX - (box.left + box.width / 2), moved.clientY - (box.top + box.height / 2))
        previous = Math.min(Math.max(unwrapFraction(raw, previous), 0), 1)
        edge = previous * total
      } else {
        box = track.current?.getBoundingClientRect()
        edge = edgeFor(moved)
      }
      last = { leftId: here.entry.allocation.id, leftMinor: edge - here.start }
      onTrade(last, box === undefined ? 0 : moved.clientX - box.left)
    }
    const stop = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      if (last !== undefined) onCommit?.(last)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  const nudge = (event: React.KeyboardEvent, index: number): void => {
    const here = placed[index]
    if (here === undefined || onNudge === undefined) return
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    onNudge({
      leftId: here.entry.allocation.id,
      // A percentage steps a whole percent (ten with shift), an amount its snap.
      leftMinor:
        here.entry.amount.minor +
        direction * (here.entry.allocation.mode === 'PERCENTAGE' ? result.splittable.minor / 100 : snap) * (event.shiftKey ? 10 : 1),
    })
  }

  const isStuck = (entry: (typeof placed)[number]['entry']): boolean => {
    const next = result.allocations[result.allocations.findIndex((one) => one === entry) + 1]
    return (
      locked.has(entry.allocation.id) || (next === undefined && free === 0)
    )
  }

  /** One divider — a slider between two neighbours — wherever the view puts it. */
  const divider = (
    { entry }: (typeof placed)[number],
    index: number,
    className: string,
    style: React.CSSProperties,
  ) => {
    if (entry.allocation.mode === 'REMAINDER') return null
    const stuck = isStuck(entry)
    return (
      <button
        key={`divider-${entry.allocation.id}`}
        type="button"
        role="slider"
        aria-label={`Divider after ${entry.bucket.name}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={entry.amount.minor}
        aria-valuetext={`${entry.bucket.name} ${formatMoney(entry.amount)}`}
        aria-disabled={stuck || undefined}
        data-divider={index}
        onPointerDown={(event) => {
          if (!stuck) startDrag(event, index)
        }}
        onKeyDown={(event) => {
          if (!stuck) nudge(event, index)
        }}
        className={`group absolute flex items-center justify-center focus-visible:outline-none ${className} ${
          stuck ? 'cursor-not-allowed' : ''
        }`}
        style={style}
      >
        <i
          aria-hidden
          className={`block h-full w-[3px] bg-ink transition-colors group-hover:bg-accent group-focus-visible:bg-accent ${
            stuck ? 'opacity-20' : 'opacity-75 group-hover:opacity-100 group-focus-visible:opacity-100'
          }`}
        />
        <span
          aria-hidden
          className={`absolute top-1/2 -mt-[11px] h-[22px] w-3 border-[1.5px] border-ink bg-background group-hover:border-accent group-hover:bg-accent-soft group-focus-visible:border-accent group-focus-visible:bg-accent-soft ${
            stuck ? 'opacity-35' : ''
          }`}
        />
      </button>
    )
  }

  const pieces: Piece[] = [
    ...(share === undefined
      ? []
      : [
          {
            key: 'fixed',
            kind: 'fixed' as const,
            from: 0,
            to: share.minor / total,
            colour: 'var(--color-ink-tertiary)',
            name: 'Bills',
            amount: share,
            got: billsGot,
          },
        ]),
    ...placed.map(({ entry, start }) => ({
      key: entry.allocation.id,
      kind: 'bucket' as const,
      from: start / total,
      to: (start + entry.amount.minor) / total,
      colour: colours.get(entry.bucket.id) ?? 'var(--color-ink-tertiary)',
      bucketId: entry.bucket.id,
      name: entry.bucket.name,
      amount: entry.amount,
      got: got?.get(entry.bucket.id),
    })),
    ...(free > 0
      ? [
          {
            key: 'free',
            kind: 'free' as const,
            from: cursor / total,
            to: (cursor + free) / total,
            colour: 'var(--color-ink-tertiary)',
            name: 'Not given a job',
            amount: money(free, currency),
          },
        ]
      : []),
  ]

  const summary = pieces.map((piece) => `${piece.name} ${formatMoney(piece.amount)}`).join(', ')

  /** The segments: the same paths at any `at` — 0 the bar, 1 the ring. */
  const drawPieces = (dims: RingDims, at: number) => (
    <>
      <defs>
        <pattern id={hatch} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" style={{ fill: 'var(--color-surface)' }} />
          <line x1="0" y1="0" x2="0" y2="7" style={{ stroke: 'var(--color-hairline)', strokeWidth: 1 }} />
        </pattern>
      </defs>
      {pieces.map((piece) => {
        const lit = piece.bucketId !== undefined && hot === piece.bucketId
        const fill =
          piece.kind === 'fixed'
            ? `url(#${hatch})`
            : piece.kind === 'free'
              ? 'none'
              : `color-mix(in srgb, ${piece.colour} ${lit ? '38%' : '22%'}, var(--color-background))`
        return (
          <g
            key={piece.key}
            onMouseEnter={() => piece.bucketId !== undefined && onHot?.(piece.bucketId)}
            onMouseLeave={() => piece.bucketId !== undefined && onHot?.(undefined)}
          >
            <path
              d={segmentPath(piece.from, piece.to, at, dims)}
              style={{
                fill,
                stroke: piece.kind === 'free' ? 'var(--color-ink-tertiary)' : 'var(--color-background)',
                strokeWidth: piece.kind === 'free' ? 1.5 : 1,
                strokeDasharray: piece.kind === 'free' ? '4 3' : undefined,
              }}
            >
              <title>{titleOf(piece)}</title>
            </path>
            {piece.got !== undefined && piece.kind !== 'free' && piece.amount.minor > 0 && (
              <path
                d={segmentPath(
                  piece.from,
                  piece.from + (piece.to - piece.from) * Math.min(1, piece.got.minor / piece.amount.minor),
                  at,
                  dims,
                )}
                style={{ fill: filled(piece.colour), pointerEvents: 'none' }}
              />
            )}
            {piece.got !== undefined && piece.got.minor > piece.amount.minor && (
              <path
                d={crossPath(piece.to, at, dims)}
                style={{ fill: 'none', stroke: 'var(--color-ink)', strokeWidth: 3, pointerEvents: 'none' }}
              />
            )}
            {piece.kind !== 'free' && (
              <path
                d={topPath(piece.from, piece.to, at, dims)}
                style={{ fill: 'none', stroke: piece.colour, strokeWidth: 3 }}
              />
            )}
          </g>
        )
      })}
    </>
  )

  const centre = (
    <>
      <span className="text-caption text-ink-secondary">To split</span>
      <b className="text-[22px] font-medium tabular-nums">{formatMoney(result.splittable)}</b>
      {netOff.minor > 0 && (
        <span className="text-caption text-ink-secondary tabular-nums">after {formatMoney(netOff)} of bills</span>
      )}
    </>
  )

  const headerBand = (
    <>
        <div className="flex h-[34px] text-caption" aria-hidden>
          {netOff.minor > 0 && (
            <div
              className="flex min-w-0 items-center overflow-hidden border border-r-0 border-hairline-strong px-2.5 whitespace-nowrap text-ink-secondary"
              style={{
                width: `${String((1 - keepShare) * 100)}%`,
                background:
                  'repeating-linear-gradient(135deg, var(--color-surface) 0 6px, var(--color-hairline) 6px 7px)',
              }}
            >
              Bills, out of net · {formatMoney(netOff)}
            </div>
          )}
          <div
            className="flex min-w-0 flex-1 items-center overflow-hidden border border-hairline-strong bg-surface px-2.5 whitespace-nowrap"
          >
            To split · {formatMoney(result.splittable)}
          </div>
        </div>
        <svg className="block h-[26px] w-full" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden>
          <polygon
            points={`${String((1 - keepShare) * 100)},0 100,0 100,26 0,26`}
            style={{ fill: 'var(--color-surface)', stroke: 'var(--color-hairline-strong)', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }}
          />
        </svg>
    </>
  )
  const axisRow = (
        <div className="mt-2 flex justify-between text-[11px] text-ink-tertiary tabular-nums" aria-hidden>
          <span>{formatMoney(money(0, currency))}</span>
          <span>{formatMoney(money(Math.round(total / 2), currency))}</span>
          <span>{formatMoney(money(total, currency))}</span>
        </div>
  )

  const ringDimsShown = ringDims(RING_SIDE, RING_SIDE, BAR_TOP, BAR_THICK)

  let body: React.ReactNode
  if (mode === 'morph') {
    const width = stageWidth.current
    const side = Math.min(RING_SIDE, width)
    const dims = ringDims(side, width, BAR_TOP, BAR_THICK)
    const height = barHeight.current + (side - barHeight.current) * t
    body = (
      <div className="relative overflow-hidden" style={{ height }} aria-hidden>
        <div className="absolute inset-x-0 top-0" style={{ opacity: 1 - t }}>
          {headerBand}
        </div>
        <div className="absolute inset-x-0" style={{ top: BAR_TOP + BAR_THICK, opacity: 1 - t }}>
          {axisRow}
        </div>
        <svg className="absolute inset-0 block" width={width} height={height}>
          {drawPieces(dims, t)}
        </svg>
        <div
          className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: width / 2, top: side / 2, opacity: t * t }}
        >
          {centre}
        </div>
      </div>
    )
  } else if (mode === 'ring') {
    body = (
      <div>
        <div
          ref={ringBox}
          className="relative mx-auto aspect-square w-full touch-none select-none"
          style={{ maxWidth: RING_SIDE }}
        >
          <svg
            className="block h-full w-full"
            viewBox={`0 0 ${String(RING_SIDE)} ${String(RING_SIDE)}`}
            role="img"
            aria-label={summary}
          >
            {drawPieces(ringDimsShown, 1)}
          </svg>
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
            aria-hidden
          >
            {centre}
          </div>
          {!readOnly &&
            placed.map((one, index) => {
              const fraction = (one.start + one.entry.amount.minor) / total
              const angle = -Math.PI / 2 + fraction * 2 * Math.PI
              const middle = (ringDimsShown.outer + ringDimsShown.inner) / 2
              const x = ringDimsShown.cx + middle * Math.cos(angle)
              const y = ringDimsShown.cy + middle * Math.sin(angle)
              return divider(one, index, 'w-4 cursor-grab', {
                left: `${String((x / RING_SIDE) * 100)}%`,
                top: `${String((y / RING_SIDE) * 100)}%`,
                height: ringDimsShown.outer - ringDimsShown.inner + 16,
                transform: `translate(-50%, -50%) rotate(${String(fraction * 360 - 180)}deg)`,
              })
            })}
          {tip !== undefined && (
            <div
              className="pointer-events-none absolute -top-3 z-[4] -translate-x-1/2 -translate-y-full bg-ink px-2 py-0.5 text-caption whitespace-nowrap text-background tabular-nums"
              style={{ left: tip.at }}
            >
              {tip.text}
            </div>
          )}
        </div>
        <ul className="m-0 mt-3 flex list-none flex-wrap justify-center gap-x-4 gap-y-1 p-0 text-caption">
          {pieces.map((piece) => (
            <li
              key={piece.key}
              className="flex items-center gap-1.5"
              onMouseEnter={() => piece.bucketId !== undefined && onHot?.(piece.bucketId)}
              onMouseLeave={() => piece.bucketId !== undefined && onHot?.(undefined)}
            >
              <i
                aria-hidden
                className="block h-2.5 w-2.5 border-t-[3px]"
                style={{
                  borderTopColor: piece.colour,
                  background:
                    piece.kind === 'fixed'
                      ? 'repeating-linear-gradient(135deg, var(--color-surface) 0 3px, var(--color-hairline) 3px 4px)'
                      : piece.kind === 'free'
                        ? 'transparent'
                        : `color-mix(in srgb, ${piece.colour} 22%, var(--color-background))`,
                }}
              />
              <span>{piece.kind === 'bucket' ? <Bidi>{piece.name}</Bidi> : piece.name}</span>
              <span className="tabular-nums text-ink-secondary">{formatMoney(piece.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  } else {
    body = (
      <div ref={barBlock}>
        {headerBand}
        <div className="relative">
        <div
          ref={track}
          className="relative flex h-16 touch-none select-none"
          role="img"
          aria-label={[
            share === undefined ? '' : `Bills ${formatMoney(share)}`,
            ...segments.map((entry) => `${entry.bucket.name} ${formatMoney(entry.amount)}`),
          ]
            .filter((part) => part !== '')
            .join(', ')}
        >
          {share !== undefined && (
            <div
              className="relative flex min-w-0 flex-col justify-center overflow-hidden border-t-[3px] border-t-ink-tertiary px-2.5 text-caption"
              style={{
                width: pct(share.minor),
                background:
                  'repeating-linear-gradient(135deg, var(--color-surface) 0 6px, var(--color-hairline) 6px 7px)',
              }}
              title={`Bills in the split · ${formatMoney(share)}${billsGot === undefined ? '' : `, charged ${formatMoney(billsGot)}`}`}
            >
              <Fill amount={share} got={billsGot} colour="var(--color-ink-tertiary)" />
              {share.minor / total > 0.07 && <b className="relative truncate font-medium">Bills</b>}
              {share.minor / total > 0.05 && <span className="relative truncate tabular-nums text-ink-secondary">{formatMoney(share)}</span>}
            </div>
          )}

          {placed.map(({ entry }) => {
            const colour = colours.get(entry.bucket.id) ?? 'var(--color-ink-tertiary)'
            const bucketGot = got?.get(entry.bucket.id)
            const lit = hot === entry.bucket.id
            return (
              <div
                key={entry.allocation.id}
                className="relative flex min-w-0 flex-col justify-center overflow-hidden border-t-[3px] px-2.5 text-caption"
                style={{
                  width: pct(entry.amount.minor),
                  borderTopColor: colour,
                  background: `color-mix(in srgb, ${colour} ${got === undefined ? (lit ? '38%' : '22%') : lit ? '22%' : '12%'}, var(--color-background))`,
                }}
                title={`${entry.bucket.name} · ${formatMoney(entry.amount)}${bucketGot === undefined ? '' : `, got ${formatMoney(bucketGot)}`}`}
                onMouseEnter={() => onHot?.(entry.bucket.id)}
                onMouseLeave={() => onHot?.(undefined)}
              >
                <Fill amount={entry.amount} got={bucketGot} colour={colour} />
                {entry.amount.minor / total > 0.07 && (
                  <b className="relative flex min-w-0 font-medium">
                    <Bidi className="min-w-0 truncate">{entry.bucket.name}</Bidi>
                  </b>
                )}
                {entry.amount.minor / total > 0.05 && (
                  <span className="relative truncate tabular-nums text-ink-secondary">
                    {formatMoney(entry.amount)}
                    {bucketGot === undefined ? '' : ` · got ${formatMoney(bucketGot)}`}
                  </span>
                )}
              </div>
            )
          })}

          {free > 0 && (
            <div
              className="flex min-w-0 flex-col justify-center overflow-hidden border border-dashed border-ink-tertiary px-2.5 text-caption text-ink-secondary"
              style={{ width: pct(free) }}
              title={`Not given a job · ${formatMoney(money(free, currency))}`}
            >
              {free / total > 0.08 && <b className="truncate font-medium">Not given a job</b>}
              {free / total > 0.05 && <span className="truncate tabular-nums">{formatMoney(money(free, currency))}</span>}
            </div>
          )}

        </div>
          {!readOnly &&
            placed.map((one, index) =>
              divider(one, index, '-top-1.5 h-[76px] w-4 -translate-x-1/2 cursor-ew-resize', {
                left: pct(one.start + one.entry.amount.minor),
              }),
            )}
        {tip !== undefined && (
          <div
            className="pointer-events-none absolute -top-3 z-[4] -translate-x-1/2 -translate-y-full bg-ink px-2 py-0.5 text-caption whitespace-nowrap text-background tabular-nums"
            style={{ left: tip.at }}
          >
            {tip.text}
          </div>
        )}
        </div>
        {axisRow}
      </div>
    )
  }

  return (
    <figure className="m-0 flex flex-col" aria-label={label ?? 'The split'}>
      {label !== undefined && <figcaption className="mb-1 text-caption text-ink-secondary">{label}</figcaption>}

      <div ref={stage}>{body}</div>
    </figure>
  )
}

/** The fill a segment takes up to what it got: its top line's colour, stronger than its ground. */
function filled(colour: string): string {
  return `color-mix(in srgb, ${colour} 45%, var(--color-background))`
}

function titleOf(piece: Piece): string {
  const got = piece.got === undefined ? '' : `, ${piece.kind === 'fixed' ? 'charged' : 'got'} ${formatMoney(piece.got)}`
  return `${piece.name} · ${formatMoney(piece.amount)}${got}`
}

/**
 * **What a segment got, as a fill from its left** (M31 U4): up to the amount, and the whole of it
 * with a bar at the right end when it went over. No colour says over or under — spending over is
 * bad news and saving over is good, and the bar cannot tell which is which.
 */
function Fill({ amount, got, colour }: { amount: Money; got: Money | undefined; colour: string }) {
  if (got === undefined || amount.minor <= 0) return null
  const ratio = Math.min(1, Math.max(0, got.minor / amount.minor))
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0"
        style={{ width: `${(ratio * 100).toFixed(2)}%`, background: filled(colour) }}
      />
      {got.minor > amount.minor && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[3px] bg-ink" />
      )}
    </>
  )
}
