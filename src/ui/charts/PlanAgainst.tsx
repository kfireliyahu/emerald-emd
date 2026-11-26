import { type Money } from '@/core/money.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'

import { barPercent, drawn, wholeMoney } from './kit.ts'

export interface PlanLine {
  readonly key: string
  readonly name: string
  /** What happened: spent, saved, paid. */
  readonly actual: Money
  /** What was planned; nothing when the line has no plan. */
  readonly planned: Money | undefined
  /** A colour token or value for a small mark before the name — what the line is drawn in elsewhere (a plan's bucket on its bar). */
  readonly mark?: string | undefined
  /** Said instead of what is left or over when what happened is not known yet: no fill is drawn and only the plan is printed. */
  readonly unknown?: string | undefined
  /**
   * Said instead of what is left or over when going past the plan is no problem —
   * a goal that has reached its target (M64 U10): the meter is full and never red.
   */
  readonly note?: string | undefined
}

/**
 * **A plan against what happened** (M64 U4, D-615): a meter per line — the
 * name, what happened of what was planned, the fill on its own track, and a
 * line that says what is left or how far over. Over is the one thing in red,
 * and it says *over* in words (*Never colour alone*). One line is a single
 * meter: a ratio against a limit. A line with nothing planned draws no track
 * and says so; a negative actual (money back) draws an empty track.
 */
export function PlanAgainst({
  lines,
  empty,
  onOpen,
}: {
  readonly lines: readonly PlanLine[]
  readonly empty: string
  readonly onOpen?: ((key: string) => void) | undefined
}) {
  const t = useT()
  if (lines.length === 0) return <p className="m-0 text-ink-secondary">{empty}</p>
  return (
    <ul className="m-0 list-none p-0" data-block>
      {lines.map((line) => {
        const actual = drawn(line.actual)
        const planned = line.planned === undefined ? undefined : drawn(line.planned)
        const known = line.unknown === undefined
        const over = known && line.note === undefined && planned !== undefined && actual > planned
        const gap = planned === undefined ? undefined : { minor: Math.abs((line.planned?.minor ?? 0) - line.actual.minor), currency: line.actual.currency }
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-2">
              {line.mark !== undefined && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: line.mark }} />}
              <Bidi className="min-w-0 truncate">{line.name}</Bidi>
            </span>
            <span className="text-end tabular-nums" dir="ltr">
              {known ? wholeMoney(line.actual) : null}
              {line.planned !== undefined && (
                <span className={known ? 'text-ink-secondary' : ''}>
                  {known ? ' / ' : ''}
                  {wholeMoney(line.planned)}
                </span>
              )}
            </span>
            {known && planned !== undefined && planned > 0 && (
              <span aria-hidden className="relative col-span-2 h-2 overflow-hidden rounded-full bg-track">
                <span
                  className={`absolute inset-y-0 start-0 rounded-full ${over ? 'bg-negative' : 'bg-bar'}`}
                  style={{ width: `${String(actual <= 0 ? 0 : barPercent(Math.min(actual, planned), planned))}%` }}
                />
              </span>
            )}
            <span className={`col-span-2 text-caption ${over ? 'font-medium text-negative' : 'text-ink-secondary'}`}>
              {!known
                ? line.unknown
                : line.note !== undefined
                ? line.note
                : gap === undefined
                ? t('chrome.kit.noPlan')
                : over
                  ? t('chrome.kit.over', { amount: wholeMoney(gap) })
                  : t('chrome.kit.left', { amount: wholeMoney(gap) })}
            </span>
          </>
        )
        const grid = 'grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 border-b border-hairline py-3 text-start'
        return (
          <li key={line.key}>
            {onOpen === undefined ? (
              <div className={grid}>{body}</div>
            ) : (
              <button
                type="button"
                onClick={() => onOpen(line.key)}
                className={`${grid} hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`}
              >
                {body}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
