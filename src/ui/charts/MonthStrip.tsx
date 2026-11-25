import { useRef, useState, type KeyboardEvent } from 'react'

import { arrowStep } from '@/ui/direction.ts'

import { useWidth } from './useWidth.ts'

export interface StripMonth {
  readonly key: string
  /** Under the column: `Mar`. */
  readonly label: string
  /** For the button's name and the tooltip: `March 2026`. */
  readonly long: string
  /** In major units; nothing where the month has no value. */
  readonly value: number | undefined
  readonly running?: boolean | undefined
  /** A few words a month carries in its tooltip and name: `a statement is missing`. */
  readonly note?: string | undefined
}

/**
 * **The month strip** (M64 U4, D-615, from D-614's B): fourteen months as
 * columns, and the way to page them. Each column is at most 24px, its data
 * end rounded and its baseline square; a negative month hangs below the
 * baseline. The open month is ink and the rest `bar-quiet`, which holds 3:1
 * on both planes (D-614); the running month is drawn hollow. The open month's
 * value is printed above it, every month's is in its tooltip, and each column
 * is a button named by its month and value. The strip is one stop for the
 * keyboard (a roving tab stop): ← → move along the reading order, Home and End
 * jump, Enter or Space opens.
 */
export function MonthStrip({
  months,
  open,
  label,
  empty,
  format,
  onOpen,
}: {
  readonly months: readonly StripMonth[]
  readonly open: number
  /** What the columns are: `Left over, by month`. */
  readonly label: string
  readonly empty: string
  readonly format: (value: number) => string
  readonly onOpen: (index: number) => void
}) {
  const [focus, setFocus] = useState<number | undefined>(undefined)
  const [hover, setHover] = useState<number | undefined>(undefined)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const width = useWidth()
  const values = months.flatMap((month) => (month.value === undefined || !Number.isFinite(month.value) ? [] : [month.value]))
  if (months.length === 0 || values.length === 0) return <p className="m-0 text-ink-secondary">{empty}</p>

  // The scale is the finished months': a running month's partial figure would
  // flatten them (M64 U5). Its column is clipped to the scale, and drawn short
  // on a side the finished months leave empty.
  const finished = months.flatMap((month) => (month.running === true || month.value === undefined || !Number.isFinite(month.value) ? [] : [month.value]))
  const scaled = finished.length > 0 ? finished : values
  const high = Math.max(0, ...scaled)
  const running = months.find((month) => month.running === true)?.value
  const low = Math.min(0, ...scaled, running !== undefined && running < 0 && Math.min(0, ...scaled) === 0 ? -high / 5 : 0)
  const stop = focus ?? open
  const tip = hover ?? focus
  // A month's label needs about 28px; narrower, every second one is said (the
  // open month always), and the rest are in each column's name and tooltip.
  const every = width.value > 0 && width.value / months.length < 28 ? 2 : 1

  const move = (to: number) => {
    const next = Math.max(0, Math.min(months.length - 1, to))
    setFocus(next)
    buttons.current[next]?.focus()
  }
  const onKey = (event: KeyboardEvent, index: number) => {
    const step = arrowStep(event.key)
    if (step !== 0) {
      event.preventDefault()
      move(index + step)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      move(event.key === 'Home' ? 0 : months.length - 1)
    }
  }

  return (
    <div ref={width.ref as React.RefObject<HTMLDivElement>} role="group" aria-label={label} className="relative flex items-stretch" data-block>
      {months.map((month, index) => {
        const value = month.value
        // In percent of its side of the baseline, so the strip has no pixel of its own.
        const side = value === undefined ? 1 : value > 0 ? high : -low
        const height = value === undefined || value === 0 ? 0 : Math.min(100, Math.max(4, (100 * Math.abs(value)) / (side || 1)))
        const on = index === open
        const colour = on ? 'bg-bar' : 'bg-bar-quiet'
        const said = `${month.long}: ${value === undefined ? '—' : format(value)}${month.note === undefined ? '' : `, ${month.note}`}`
        return (
          <button
            key={month.key}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            tabIndex={index === stop ? 0 : -1}
            aria-label={said}
            aria-current={on ? 'date' : undefined}
            onClick={() => onOpen(index)}
            onKeyDown={(event) => onKey(event, index)}
            onFocus={() => setFocus(index)}
            onBlur={() => setFocus(undefined)}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(undefined)}
            className="group relative flex min-w-0 flex-1 flex-col items-center gap-1 pt-5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            {on && value !== undefined && (
              // Held inside the strip: at either end it is anchored to that end,
              // or the last month's value runs past the screen (M64 U5's tour).
              <span className={`absolute top-0 flex gap-1.5 text-caption whitespace-nowrap ${index < 2 ? 'start-0' : index >= months.length - 2 ? 'end-0' : ''}`}>
                <span className="font-semibold tabular-nums" dir="ltr">
                  {format(value)}
                </span>
                {month.note !== undefined && <span className="text-negative">· {month.note}</span>}
              </span>
            )}
            <span aria-hidden className="flex h-20 w-full flex-col items-center">
              <span className="flex w-full min-h-0 flex-col items-center justify-end" style={{ flexGrow: high, flexBasis: 0 }}>
                {value !== undefined && value > 0 && (
                  <span
                    className={`w-full max-w-6 rounded-t-mark ${month.running === true ? 'border-2 border-b-0 border-bar-quiet' : `${colour} group-hover:bg-bar`}`}
                    style={{ height: `${String(height)}%` }}
                  />
                )}
              </span>
              <span className="h-px w-full shrink-0 bg-hairline-strong" />
              <span className="flex w-full min-h-0 flex-col items-center" style={{ flexGrow: -low, flexBasis: 0 }}>
                {value !== undefined && value < 0 && (
                  <span
                    className={`w-full max-w-6 rounded-b-mark ${month.running === true ? 'border-2 border-t-0 border-bar-quiet' : colour}`}
                    style={{ height: `${String(height)}%` }}
                  />
                )}
              </span>
            </span>
            <span aria-hidden className={`text-caption ${on ? 'font-semibold text-ink' : 'font-normal text-ink-secondary'} ${on || index % every === (months.length - 1) % every ? '' : 'invisible'}`}>
              {month.label}
            </span>
            {month.note !== undefined && <span aria-hidden className="size-1.5 rounded-full bg-negative" />}
          </button>
        )
      })}
      {tip !== undefined && months[tip] !== undefined && tip !== open && (
        <div
          role="tooltip"
          className="pointer-events-none absolute -top-10 z-10 flex flex-col border border-hairline-strong bg-elevated px-3 py-1.5 text-caption whitespace-nowrap tabular-nums shadow-[var(--shadow-pop)]"
          style={{ insetInlineStart: `${String(Math.min(80, (100 * tip) / months.length))}%` }}
        >
          <span className="font-semibold">{months[tip]!.long}</span>
          <span dir="ltr">{months[tip]!.value === undefined ? '—' : format(months[tip]!.value!)}</span>
          {months[tip]!.note !== undefined && <span className="text-negative">{months[tip]!.note}</span>}
        </div>
      )}
    </div>
  )
}
