import { useMemo, useState } from 'react'
import type { Database } from 'sql.js'

import { formatMoney, money } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import { runRollup } from '@/data/repositories/formatRollupRepository.ts'
import { nounOf, pluralOf } from '@/domain/format/connections.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { figureText } from '@/domain/format/rollup.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { Chart } from '@/ui/charts/Chart.tsx'
import { drawnValue, type ChartKind } from '@/ui/charts/chart.ts'
import { rollupSentence, rollupWords } from '@/ui/formats/dashboard.ts'
import { rollupChart } from '@/ui/formats/rollupChart.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { changeRollup, rollupDeleted } from '@/ui/formats/rollupInPlace.ts'
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
 *
 * **Deleted on its own tab** (M53 F3), as in the rail: asked once, and a
 * dashboard's chart of it goes with it. The format then opens on its table.
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
  const t = useT()
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
            name: rollupWords(result.rollup.name),
            // A count in the format's own word: `1 unit`, `2 units` (M54 F3).
            count: result.rollup.kind === 'COUNT' ? { one: nounOf(declaration.title), many: pluralOf(declaration.title) } : undefined,
          }),
    [result, declaration.title],
  )
  if (result === undefined) return null

  const moneyOf = (minor: number, currency: string): string => formatMoney(money(minor, currency))
  const by = result.rollup.by
  // In words, as the rail and the tab say it (M55 U7): the name stays the declaration's.
  const said = rollupWords(result.rollup.name)
  const sentence = rollupSentence(result.rollup, declaration)

  return (
    <div className="fc-view-enter min-h-0 flex-1 overflow-auto">
      <div className="flex items-baseline gap-3 px-6 py-2 text-caption text-ink-secondary">
        <p className="m-0 min-w-0 flex-1">
          {sentence}
          {result.rollup.note === '' ? '.' : <> — <Bidi>{result.rollup.note}</Bidi></>}
        </p>
        <DeleteChart format={declaration.name} name={result.rollup.name} said={said} />
      </div>
      {chart !== undefined &&
        chart.series.some((each) => each.points.some((one) => drawnValue(one, chart.axis) !== undefined)) && (
        <section className="px-6 pt-2 pb-4" aria-label={t('dashboards.rollup.asChart', { name: said })}>
          <div className="mb-1 flex items-center gap-1" role="group" aria-label={t('dashboards.rollup.drawAs')}>
            {(['bars', 'line'] as const).map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={kind === each}
                onClick={() => setKind(each)}
                className={[
                  'px-2 py-0.5 text-caption',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                  kind === each ? 'bg-surface text-ink' : 'text-ink-secondary hover:text-ink',
                ].join(' ')}
              >
                {t(each === 'bars' ? 'dashboards.rollup.bars' : 'dashboards.rollup.line')}
              </button>
            ))}
          </div>
          <Chart
            labels={chart.labels}
            ticks={chart.ticks}
            series={chart.series}
            axis={chart.axis}
            kind={kind}
            title={sentence}
            labelHeading={t('dashboards.rollup.month')}
            // Its table is the tab's own, beneath: every figure the chart draws is a cell there.
            figures="elsewhere"
          />
          {chart.left.map((sentence) => (
            <p key={sentence} className="m-0 text-caption text-ink-secondary">
              {sentence}
            </p>
          ))}
        </section>
      )}
      {result.groups.length === 0 ? (
        <p className="px-6 py-4 text-ink-secondary">{t('dashboards.body.empty')}</p>
      ) : (
        <table className="min-w-full border-collapse text-start">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-hairline">
              <th className="px-3 py-2 text-label whitespace-nowrap">{t('dashboards.rollup.month')}</th>
              {by !== undefined && (
                <th className="px-3 py-2 text-label whitespace-nowrap"><Bidi>{by.replace(/_/g, ' ')}</Bidi></th>
              )}
              <th className="px-3 py-2 text-end text-label whitespace-nowrap"><Bidi>{said}</Bidi></th>
              <th className="px-3 py-2 text-end text-label whitespace-nowrap">{t('dashboards.rollup.rows')}</th>
            </tr>
          </thead>
          <tbody>
            {result.groups.map((group) => (
              <tr
                key={`${group.period ?? ''} ${group.by ?? ''}`}
                className="border-b border-hairline"
              >
                <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                  {group.period ?? <span className="text-ink-secondary">{t('dashboards.rollup.noMonth')}</span>}
                </td>
                {by !== undefined && (
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {group.by === undefined ? (
                      <span className="text-ink-secondary">{t('dashboards.rollup.none')}</span>
                    ) : (
                      // A linked row's name came from a document, and half of
                      // them are Hebrew.
                      <Bidi>{result.labels.get(group.by) ?? group.by}</Bidi>
                    )}
                  </td>
                )}
                <td className="px-3 py-1.5 text-end whitespace-nowrap tabular-nums">
                  {group.value.kind === 'VALUE' ? (
                    group.value.figures.map((figure) => figureText(figure, moneyOf)).join(' + ')
                  ) : (
                    <span className="text-ink-secondary" title={group.value.reason}>
                      {t('dashboards.rollup.unchecked')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-end whitespace-nowrap tabular-nums text-ink-secondary">
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

/** *Delete chart*, asking once where it stands; a refusal (a pack's own rollup) is said beside it. */
function DeleteChart({ format, name, said }: { format: string; name: string; said: string }) {
  const t = useT()
  const mutate = useDocumentStore((state) => state.mutate)
  const [asking, setAsking] = useState(false)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const quiet = 'text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
  if (!asking) {
    return (
      <button type="button" className={`flex-none ${quiet}`} onClick={() => setAsking(true)}>
        {t('dashboards.rollup.delete')}
      </button>
    )
  }
  return (
    <span className="flex flex-none items-baseline gap-2" role="group" aria-label={t('dashboards.rollup.deleteOf', { name: said })}>
      {refusal === undefined ? (
        <span>
          <Phrase text={t('dashboards.rollup.question')} parts={{ name: <Bidi>{said}</Bidi> }} />
        </span>
      ) : (
        <span className="text-negative" role="alert">
          {refusal}
        </span>
      )}
      {refusal === undefined && (
        <button
          type="button"
          className="text-negative hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => {
            try {
              mutate((db) => {
                const judged = rollupDeleted(db, listFormats(db), format, name)
                if (!judged.ok) throw new Error(judged.error)
                changeRollup(db, judged.value)
              })
            } catch (error) {
              setRefusal(error instanceof Error ? error.message : String(error))
            }
          }}
        >
          {t('dashboards.rollup.confirm')}
        </button>
      )}
      <button
        type="button"
        className={quiet}
        onClick={() => {
          setAsking(false)
          setRefusal(undefined)
        }}
      >
        {t('dashboards.rollup.keep')}
      </button>
    </span>
  )
}
