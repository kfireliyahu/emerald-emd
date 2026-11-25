import type { ReactNode } from 'react'

import { type Money } from '@/core/money.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'

import { drawn, kitMoney, share, wholeMoney } from './kit.ts'

export interface FlowPart {
  readonly key: string
  readonly label: string
  readonly value: Money
  /** Its colour token: `bar-quiet` by default; a flow's (`flow-saved`) only beside its word. */
  readonly hue?: string | undefined
}

/**
 * **A month's flow** (M64 U4, D-615): one whole and where it went — what came
 * in, divided into what was spent and put aside, and what is left over (or a
 * payslip: gross into deductions and net). The whole is a quiet rule; under it
 * one bar of the parts at the same scale, left over in ink at its end, 2px of
 * page between them; under that, every part with its amount and its share of
 * the whole. When the parts are more than the whole, the bars are drawn to the
 * larger, the whole's rule stops short, and left over keeps its minus sign in
 * ink beside a red dot and the word *over* — the figure itself is never red.
 */
export function MonthFlow({
  whole,
  parts,
  left,
  empty,
  onOpen,
}: {
  readonly whole: { readonly label: string; readonly value: Money }
  readonly parts: readonly FlowPart[]
  /** What the difference is called: `Left over`. */
  readonly left: string
  readonly empty: string
  /**
   * Each figure opens what it is made of, when given (M64 U8): a part by its
   * key, the whole as `whole` and the difference as `left` — a payslip's taxes
   * open their lines, its net where the net went. Without it nothing opens.
   */
  readonly onOpen?: ((key: string) => void) | undefined
}) {
  const t = useT()
  const currency = whole.value.currency
  const came = Math.max(0, drawn(whole.value))
  const spent = parts.reduce((sum, part) => sum + Math.max(0, drawn(part.value)), 0)
  if (came === 0 && spent === 0) return <p className="m-0 text-ink-secondary">{empty}</p>
  const rest = { minor: whole.value.minor - parts.reduce((sum, part) => sum + part.value.minor, 0), currency }
  const over = rest.minor < 0
  const scale = Math.max(came, spent) || 1
  const width = (value: number) => `${String((100 * Math.max(0, value)) / scale)}%`
  const segments = [
    ...parts.map((part) => ({ key: part.key, label: part.label, value: part.value, hue: part.hue ?? 'bar-quiet' })),
    ...(over ? [] : [{ key: 'left', label: left, value: rest, hue: 'bar' }]),
  ]
  return (
    <div className="flex flex-col gap-2">
      {/* The whole, as a rule at 3:1 the parts are measured against: where they
          run past its end is what went past what came in. */}
      <div aria-hidden className="flex h-0.5">
        <span className="h-full bg-bar-quiet" style={{ width: width(came) }} />
      </div>
      <div
        role="img"
        aria-label={`${whole.label} ${kitMoney(whole.value)}: ${segments.map((segment) => `${segment.label} ${kitMoney(segment.value)}`).join(', ')}`}
        className="flex h-2 gap-0.5"
      >
        {segments.map((segment) =>
          drawn(segment.value) > 0 ? (
            <span
              key={segment.key}
              className="h-full rounded-full"
              style={{ width: width(drawn(segment.value)), backgroundColor: `var(--color-${segment.hue})` }}
            />
          ) : null,
        )}
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-2 p-0 pt-1" data-block>
        <li className="flex">
          <Opens id="whole" onOpen={onOpen}>
            <span className="flex items-center gap-1.5 text-caption text-ink-secondary group-hover:text-ink">
              {whole.label}
              {onOpen !== undefined && <OpenArrow />}
            </span>
            <span className="tabular-nums" dir="ltr">{kitMoney(whole.value)}</span>
          </Opens>
        </li>
        {parts.map((part) => (
          <li key={part.key} className="flex">
            <Opens id={part.key} onOpen={onOpen}>
              <span className="flex items-center gap-1.5 text-caption text-ink-secondary group-hover:text-ink">
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: `var(--color-${part.hue ?? 'bar-quiet'})` }} />
                <Bidi>{part.label}</Bidi>
                {came > 0 && part.value.minor > 0 && <span className="tabular-nums">{`${String(share(drawn(part.value), came))}%`}</span>}
                {onOpen !== undefined && <OpenArrow />}
              </span>
              <span className="tabular-nums" dir="ltr">{kitMoney(part.value)}</span>
            </Opens>
          </li>
        ))}
        <li className="flex">
          <Opens id="left" onOpen={onOpen}>
            <span className="flex items-center gap-1.5 text-caption text-ink-secondary group-hover:text-ink">
              <span aria-hidden className={`size-2 rounded-full ${over ? 'bg-negative' : 'bg-bar'}`} />
              {left}
              {onOpen !== undefined && <OpenArrow />}
            </span>
            <span className="font-semibold tabular-nums" dir="ltr">
              {kitMoney(rest)}
            </span>
            {over && (
              <span className="text-caption font-medium text-negative">
                {t('chrome.kit.over', { amount: wholeMoney({ minor: -rest.minor, currency }) })}
              </span>
            )}
          </Opens>
        </li>
      </ul>
    </div>
  )
}

/** One figure of the flow: a button that opens it when the caller asked, else the figure as it is. */
function Opens({ id, onOpen, children }: { readonly id: string; readonly onOpen: ((key: string) => void) | undefined; readonly children: ReactNode }) {
  if (onOpen === undefined) return <span className="flex flex-col">{children}</span>
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className="group flex flex-col text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  )
}

/** The arrow a figure that opens carries beside its name, as `HeadlineFigure`'s tile does. */
function OpenArrow() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3 shrink-0 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  )
}
