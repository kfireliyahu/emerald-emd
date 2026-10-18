import {
  addMonths,
  formatMonthAbbrev,
  formatYearMonth,
  toYearMonthString,
  type YearMonth,
} from '@/core/time.ts'
import { Bidi } from '@/ui/Bidi.tsx'

/**
 * **Months on this plan** (M31 U4): twelve checkboxes, six months back and five ahead of the month
 * on screen, and under each the plan the month is on when it is not this one — so the row answers
 * which month has which plan as well as giving one in a click. A checkbox, not a menu per month:
 * one click, and the answer is visible rather than behind a closed menu.
 *
 * **The default covers every month nobody gave another plan**, so on the default its boxes are
 * ticked for those months and cannot be unticked there: a month comes off the default by being
 * ticked on another plan. Ticking a month another plan has puts it on this one.
 */
export function MonthRow({
  planId,
  planName,
  isDefault,
  defaultName,
  month,
  given,
  names,
  onChange,
}: {
  planId: string
  planName: string
  isDefault: boolean
  defaultName: string
  /** The month on screen: the row is centred on it and marks it. */
  month: YearMonth
  /** `YYYY-MM` to the plan the month was given; a month that is not here is on the default. */
  given: ReadonlyMap<string, string>
  /** Plan names by id. */
  names: ReadonlyMap<string, string>
  onChange: (month: YearMonth, on: boolean) => void
}) {
  const months = Array.from({ length: 12 }, (_, index) => addMonths(month, index - 6))
  const here = toYearMonthString(month)
  const own = [...given.values()].some((id) => id === planId)
  const hereGiven = given.get(here)

  return (
    <section className="flex flex-col gap-2" aria-label="Months on this plan">
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <span className="fc-label text-ink-secondary uppercase">Months on this plan</span>
        <span className="text-caption text-ink-secondary">
          {isDefault ? (
            <>
              A month you have not given another plan is on <Bidi>{planName}</Bidi>, the default.
            </>
          ) : own ? (
            <>
              Tick the months this plan is for. A month you leave is on <Bidi>{defaultName}</Bidi>, the default.
            </>
          ) : (
            <>
              No month is on <Bidi>{planName}</Bidi> yet. Tick the months it is for.
            </>
          )}
        </span>
      </div>
      <div className="grid grid-cols-6 border-y border-hairline @[48rem]:grid-cols-12">
        {months.map((one) => {
          const key = toYearMonthString(one)
          const owner = given.get(key)
          const on = isDefault ? owner === undefined || owner === planId : owner === planId
          const locked = isDefault && on
          const other = on ? undefined : owner === undefined ? `${defaultName} · default` : (names.get(owner) ?? '')
          return (
            <label
              key={key}
              title={locked ? `To take ${formatYearMonth(one)} off the default, tick it on another plan.` : undefined}
              className={`flex min-w-0 cursor-pointer flex-col gap-0.5 border-l border-hairline px-2 py-2 first:border-l-0 ${
                key === here ? 'shadow-[inset_0_-2px_0_var(--color-ink)]' : ''
              } ${locked ? 'cursor-default' : ''}`}
            >
              <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px]">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={(event) => onChange(one, event.target.checked)}
                  className="size-3.5 accent-ink"
                />
                <span className={key === here ? 'font-medium' : ''}>
                  {formatMonthAbbrev(one)}
                  {one.month === 1 || key === toYearMonthString(months[0] ?? one) ? (
                    <span className="ml-1 text-[10px] text-ink-tertiary">{String(one.year)}</span>
                  ) : null}
                </span>
              </span>
              <span className="min-h-[14px] truncate text-[11px] leading-tight text-ink-tertiary">
                {other === undefined ? '' : <Bidi>{other}</Bidi>}
              </span>
            </label>
          )
        })}
      </div>
      {!isDefault && hereGiven === undefined && (
        <p className="m-0 text-caption text-ink-secondary">
          {formatYearMonth(month)} has no plan of its own, so <Bidi>{defaultName}</Bidi>, the default, is its plan.
        </p>
      )}
    </section>
  )
}
