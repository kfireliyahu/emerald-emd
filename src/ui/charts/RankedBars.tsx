import { type Money } from '@/core/money.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'

import { barPercent, drawn, kitMoney } from './kit.ts'
import { Sparkline } from './Sparkline.tsx'

export interface RankedRow {
  readonly key: string
  readonly name: string
  readonly value: Money
  /** A category's colour token (`category-3`) for the dot beside its name. */
  readonly hue?: string | undefined
  /** A few words after the name: `· 4 rows`. */
  readonly note?: string | undefined
  /** A tour's anchor on the row (`went-cat:groceries`), for the demo's tours. */
  readonly tour?: string | undefined
  /** The months behind the row, as a `Sparkline` at the end of its name: how it moved (Year, M64 U11). */
  readonly trend?: readonly (number | undefined)[] | undefined
}

/**
 * **Ranked bars** (M64 U4, D-615): a part of a whole read as a ranked list —
 * where it went. Rows are 40px: the name with its category's dot, an ink bar
 * as long as its share of the largest (data end rounded, baseline square), the
 * amount at the end. Past `limit`, the rest fold into one quiet line, which
 * opens them when `onMore` is given. A negative row (refunds past what was
 * spent) draws its length on the quiet track and keeps its minus sign.
 * The caller sorts; the display never reorders what it was given.
 */
export function RankedBars({
  rows,
  limit = 6,
  empty,
  total,
  onOpen,
  onMore,
}: {
  readonly rows: readonly RankedRow[]
  readonly limit?: number
  readonly empty: string
  readonly total?: { readonly label: string; readonly value: Money } | undefined
  readonly onOpen?: ((key: string) => void) | undefined
  readonly onMore?: (() => void) | undefined
}) {
  const t = useT()
  if (rows.length === 0) return <p className="m-0 text-ink-secondary">{empty}</p>
  const shown = rows.length > limit + 1 ? rows.slice(0, limit) : rows
  const rest = rows.slice(shown.length)
  const widest = Math.max(...rows.map((row) => Math.abs(drawn(row.value))))
  const restValue = rest.length === 0 ? undefined : { minor: rest.reduce((sum, row) => sum + row.value.minor, 0), currency: rows[0]!.value.currency }
  return (
    <div className="flex flex-col">
      <ul className="m-0 list-none p-0" data-block>
        {shown.map((row) => (
          <li key={row.key}>
            <Line row={row} widest={widest} onOpen={onOpen === undefined ? undefined : () => onOpen(row.key)} />
          </li>
        ))}
        {restValue !== undefined && (
          <li>
            <Line
              row={{ key: 'rest', name: t('chrome.kit.more', { n: rest.length }), value: restValue }}
              widest={widest}
              quiet
              onOpen={onMore}
            />
          </li>
        )}
      </ul>
      {total !== undefined && (
        <div className="flex justify-between pt-3 font-semibold">
          <span>{total.label}</span>
          <span className="tabular-nums" dir="ltr">{kitMoney(total.value)}</span>
        </div>
      )}
    </div>
  )
}

function Line({
  row,
  widest,
  quiet = false,
  onOpen,
}: {
  readonly row: RankedRow
  readonly widest: number
  readonly quiet?: boolean
  readonly onOpen?: (() => void) | undefined
}) {
  const value = drawn(row.value)
  const negative = value < 0
  const inner = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {row.hue !== undefined && (
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-${row.hue})` }} />
        )}
        <Bidi className={`truncate ${quiet ? 'text-ink-secondary' : ''}`}>{row.name}</Bidi>
        {row.note !== undefined && <span className="shrink-0 text-caption text-ink-secondary">{row.note}</span>}
        {row.trend !== undefined && (
          <span className="ms-auto flex shrink-0">
            <Sparkline values={row.trend} width={72} height={20} />
          </span>
        )}
      </span>
      <span aria-hidden className="flex h-2 items-center">
        <span
          className={`h-2 rounded-e-mark ${negative || quiet ? 'bg-bar-quiet' : 'bg-bar'}`}
          style={{ width: `${String(barPercent(value, widest))}%` }}
        />
      </span>
      <span className="text-end tabular-nums" dir="ltr">
        {kitMoney(row.value)}
      </span>
    </>
  )
  const grid = 'grid h-10 w-full grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(6rem,auto)] items-center gap-3 border-b border-hairline text-start'
  return onOpen === undefined ? (
    <div className={grid} data-tour={row.tour}>{inner}</div>
  ) : (
    <button
      type="button"
      data-tour={row.tour}
      onClick={onOpen}
      className={`${grid} hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`}
    >
      {inner}
    </button>
  )
}
