import { useMemo, useState } from 'react'
import type { Database } from 'sql.js'

import { formatMoney, money } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import { runRollup } from '@/data/repositories/formatRollupRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { figureText, rollupText } from '@/domain/format/rollup.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Chart } from '@/ui/charts/Chart.tsx'
import { drawnValue, type ChartKind } from '@/ui/charts/chart.ts'
import { rollupChart } from '@/ui/formats/rollupChart.ts'
import { today } from '@/ui/today.ts'

/**
 * **A rollup, as a view on its format's page** (M25 E2, D-271) — the screen's
 * half of `format_rollup`.
 *
 * A month per row, the linked row it is per when the sentence says `and`, the
 * figure and how many rows made it. A group that cannot answer says
 * *unchecked* with the reason on hover, as an aggregate's cell does — and only
 * that group: every other month is still the whole of itself.
 *
 * **Above the table, its chart** (M53 U6, D-516): bars by month — or a line —
 * one series per linked row when the rollup groups by a link, drawn by the
 * general chart. The table stays whole beneath it: every figure the chart draws
 * is a cell there, and what it cannot draw is said under it.
 */
export function RollupView({
  db,
  declaration,
  formats,
  name,
  revision,
}: {
  db: Database
  declaration: FormatDeclaration
  formats: readonly FormatDeclaration[]
  name: string
  revision: number
}) {
  const result = useMemo(
    () => runRollup(db, declaration, name, formats, { today: toISODate(today()) }),
    // `revision` is what says the rows moved underneath.
    [db, declaration, name, formats, revision],
  )
  const [kind, setKind] = useState<ChartKind>('bars')
  const chart = useMemo(
    () =>
      result === undefined
        ? undefined
        : rollupChart(result.groups, {
            names: result.labels,
            by: result.rollup.by !== undefined,
            name: result.rollup.name,
            unit: result.rollup.kind === 'COUNT' ? 'rows' : undefined,
          }),
    [result],
  )
  if (result === undefined) return null

  const moneyOf = (minor: number, currency: string): string => formatMoney(money(minor, currency))
  const by = result.rollup.by

  return (
    <div className="fc-view-enter min-h-0 flex-1 overflow-auto">
      <p className="px-6 py-2 text-caption text-ink-secondary">
        <code>{rollupText(result.rollup)}</code>
        {result.rollup.note === '' ? '' : ` — ${result.rollup.note}`}
      </p>
      {chart !== undefined &&
        chart.series.some((each) => each.points.some((one) => drawnValue(one, chart.axis) !== undefined)) && (
        <section className="px-6 pt-2 pb-4" aria-label={`${result.rollup.name} as a chart`}>
          <div className="mb-1 flex items-center gap-1" role="group" aria-label="Draw as">
            {(['bars', 'line'] as const).map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={kind === each}
                onClick={() => setKind(each)}
                className={[
                  'rounded px-2 py-0.5 text-caption',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                  kind === each ? 'bg-surface text-ink' : 'text-ink-tertiary hover:text-ink',
                ].join(' ')}
              >
                {each === 'bars' ? 'Bars' : 'Line'}
              </button>
            ))}
          </div>
          <Chart
            labels={chart.labels}
            ticks={chart.ticks}
            series={chart.series}
            axis={chart.axis}
            kind={kind}
            title={`${result.rollup.name} by month${by === undefined ? '' : ` and ${by}`}`}
            labelHeading="month"
          />
          {chart.left.map((sentence) => (
            <p key={sentence} className="m-0 text-caption text-ink-tertiary">
              {sentence}
            </p>
          ))}
        </section>
      )}
      {result.groups.length === 0 ? (
        <p className="px-6 py-4 text-ink-secondary">No row falls in it yet.</p>
      ) : (
        <table className="min-w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-hairline">
              <th className="px-3 py-2 text-label whitespace-nowrap">month</th>
              {by !== undefined && (
                <th className="px-3 py-2 text-label whitespace-nowrap">{by}</th>
              )}
              <th className="px-3 py-2 text-right text-label whitespace-nowrap">{result.rollup.name}</th>
              <th className="px-3 py-2 text-right text-label whitespace-nowrap">rows</th>
            </tr>
          </thead>
          <tbody>
            {result.groups.map((group) => (
              <tr
                key={`${group.period ?? ''} ${group.by ?? ''}`}
                className="border-b border-hairline"
              >
                <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                  {group.period ?? <span className="text-ink-tertiary">no month</span>}
                </td>
                {by !== undefined && (
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {group.by === undefined ? (
                      <span className="text-ink-tertiary">none</span>
                    ) : (
                      // A linked row's name came from a document, and half of
                      // them are Hebrew.
                      <Bidi>{result.labels.get(group.by) ?? group.by}</Bidi>
                    )}
                  </td>
                )}
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {group.value.kind === 'VALUE' ? (
                    group.value.figures.map((figure) => figureText(figure, moneyOf)).join(' + ')
                  ) : (
                    <span className="text-ink-tertiary" title={group.value.reason}>
                      unchecked
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums text-ink-secondary">
                  {group.rows}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
