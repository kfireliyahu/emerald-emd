import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { monthEnd, monthStart, toISODate, type YearMonth } from '@/core/time.ts'
import type { StoredTransaction } from '@/data/repositories/transactionRepository.ts'
import { listTransactions } from '@/data/repositories/transactionRepository.ts'
import type { MonthlyReport } from '@/data/repositories/statisticsRepository.ts'
import type { AttentionItem, AttentionKind } from '@/domain/home.ts'
import { salaryBankWords } from '@/domain/salaryBank.ts'
import { salaryProblem } from '@/domain/statistics.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import type { CategoryPalette } from '@/ui/charts/categoryPalette.ts'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { kitMoney, share, drawn } from '@/ui/charts/kit.ts'
import { PartOfWhole } from '@/ui/charts/PartOfWhole.tsx'
import { RankedBars } from '@/ui/charts/RankedBars.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState } from '@/ui/components/WaitingList.tsx'
import { WaitingAnswer } from '@/ui/home/WaitingList.tsx'
import { UNCATEGORIZED_OPTION } from '@/ui/transactions/FilterBar.tsx'

/** What Home's side panel holds: a flow's breakdown, a category's rows, the folded categories, or a kind's answers. */
export type Panel =
  | { readonly kind: 'in' | 'out' | 'saved' | 'tax' | 'rest' }
  | { readonly kind: 'category'; readonly id: string }
  | { readonly kind: 'waiting'; readonly item: AttentionKind }

/** How many categories Where it went shows before the rest fold into one line. */
export const WHERE_LIMIT = 6

/**
 * **Home's detail, beside the month** (M64 U5, D-616): what moved off the page
 * to sit one click behind what it explains. The panel keeps its kind while the
 * months page, so it always speaks of the month that is open.
 */
export function HomePanel({
  panel,
  period,
  report,
  largest,
  tax,
  attention,
  currency,
  palette,
  onPanel,
  onRead,
  onDrill,
  onClose,
}: {
  readonly panel: Panel
  readonly period: YearMonth
  readonly report: MonthlyReport
  readonly largest: readonly StoredTransaction[]
  readonly tax: Money | undefined
  readonly attention: readonly AttentionItem[]
  readonly currency: CurrencyCode
  readonly palette: CategoryPalette
  readonly onPanel: (next: Panel) => void
  readonly onRead: () => void
  readonly onDrill: (category?: string) => void
  readonly onClose: () => void
}) {
  const t = useT()
  const dates = useDates()
  const kicker = dates.yearMonth(period)
  const went = report.summary?.expenses ?? report.split.expenses

  switch (panel.kind) {
    case 'in':
      return (
        <SidePanel kicker={kicker} title={t('home.flows.cameIn')} onClose={onClose}>
          <HeadlineFigure label={t('home.flows.cameIn')} value={report.summary?.income ?? report.detail.total} change={t('home.month.inCounts')} empty={t('home.month.cameInEmpty')} />
          <CameIn report={report} />
        </SidePanel>
      )
    case 'out':
      return (
        <SidePanel kicker={kicker} title={t('home.flows.wentOut')} onClose={onClose}>
          <HeadlineFigure label={t('home.flows.wentOut')} value={went} change={t('home.month.outCounts')} empty={t('home.month.whereEmpty')} />
          <WentOut report={report} largest={largest} went={went} onDrill={onDrill} />
        </SidePanel>
      )
    case 'saved':
      return (
        <SidePanel kicker={kicker} title={t('home.flows.saved')} onClose={onClose}>
          <HeadlineFigure label={t('home.flows.saved')} value={report.summary?.saved} change={t('home.month.savedCounts')} empty={t('home.month.savedEmpty')} />
          <Saved report={report} currency={currency} palette={palette} onDrill={onDrill} />
        </SidePanel>
      )
    case 'tax':
      return (
        <SidePanel kicker={kicker} title={t('home.flows.taxes')} onClose={onClose}>
          <Taxes tax={tax} />
        </SidePanel>
      )
    case 'rest': {
      const rest = report.categories.slice(WHERE_LIMIT)
      return (
        <SidePanel kicker={kicker} title={t('home.month.theRest')} onClose={onClose}>
          <RankedBars
            rows={rest.map((line) => ({
              key: line.categoryId ?? UNCATEGORIZED_OPTION,
              name: line.name,
              value: line.outflow,
            }))}
            limit={rest.length}
            empty={t('home.month.whereEmpty')}
            onOpen={(id) => onPanel({ kind: 'category', id })}
          />
        </SidePanel>
      )
    }
    case 'category':
      return (
        <Category id={panel.id} period={period} report={report} went={went} kicker={kicker} onDrill={onDrill} onClose={onClose} />
      )
    case 'waiting': {
      const item = attention.find((one) => one.kind === panel.item)
      return (
        <SidePanel kicker={kicker} title={t('home.waiting.title')} onClose={onClose}>
          {item === undefined ? (
            <EmptyState say={t('home.waiting.answered')} />
          ) : (
            <WaitingAnswer item={item} currency={currency} onRead={onRead} />
          )}
        </SidePanel>
      )
    }
  }
}

/** What came in, line by line: each paycheck's net with its bank check, and every other source. */
function CameIn({ report }: { readonly report: MonthlyReport }) {
  const t = useT()
  if (report.detail.lines.length === 0) return <EmptyState say={t('home.month.cameInEmpty')} />
  return (
    <Rows
      total={{ label: t('home.flows.cameIn'), value: report.detail.total }}
      rows={report.detail.lines.map((line) => ({
        key: `${line.kind}:${line.ref}`,
        name: line.name,
        note: (
          <>
            {line.kind === 'PAYSLIP'
              ? t('home.month.netPayLine')
              : line.count > 1
                ? t(countKey('home.month.payments', line.count), { count: line.count })
                : <Bidi>{line.categoryName ?? ''}</Bidi>}
            {line.salary !== undefined && line.salary.kind !== 'UNCHECKED' && (
              <span className={salaryProblem(line.salary) ? 'text-negative' : undefined}>
                {' · '}
                {salaryBankWords(line.salary, { money: kitMoney, date: (day) => toISODate(day) })}
              </span>
            )}
          </>
        ),
        value: line.amount,
      }))}
    />
  )
}

/** What went out is made of: the tracked bills and the rest, then the month's biggest single charges. */
function WentOut({
  report,
  largest,
  went,
  onDrill,
}: {
  readonly report: MonthlyReport
  readonly largest: readonly StoredTransaction[]
  readonly went: Money
  readonly onDrill: (category?: string) => void
}) {
  const t = useT()
  return (
    <>
      <Rows
        total={{ label: t('home.flows.wentOut'), value: went }}
        rows={[
          {
            key: 'bills',
            name: t('home.month.bills'),
            note: t('home.month.billsTracked', { count: report.split.lines.filter((one) => one.status === 'CHARGED').length }),
            value: report.split.fixed,
          },
          { key: 'else', name: t('home.month.everythingElse'), value: report.split.variable },
        ]}
      />
      {largest.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="home-panel-biggest">
          <h3 id="home-panel-biggest" className="m-0 text-body font-medium">
            {t('home.month.biggest')}
          </h3>
          <Charges rows={largest} />
        </section>
      )}
      <p className="m-0">
        <button type="button" className="fc-text-action" onClick={() => onDrill()}>
          {t('home.month.openRows')}
        </button>
      </p>
    </>
  )
}

/** What saved was made of (D-607), each part once, then what came off the paycheck beside it. */
function Saved({
  report,
  currency,
  palette,
  onDrill,
}: {
  readonly report: MonthlyReport
  readonly currency: CurrencyCode
  readonly palette: CategoryPalette
  readonly onDrill: (category?: string) => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const fromEarlier = report.summary?.fromEarlierSavings ?? money(0, currency)
  const parts = [
    ...report.moved.map((line) => ({
      key: `moved-${line.categoryId ?? 'none'}`,
      name: line.name,
      value: money(line.netMinor, currency),
      hue: palette.tokenOf(line.categoryId),
      note: t(countKey('home.month.movedRows', line.transactionCount), { count: line.transactionCount }),
      open: () => onDrill(line.categoryId ?? UNCATEGORIZED_OPTION),
    })),
    ...report.savedFrom.goals.map((line) => ({
      key: `goal-${line.goalId}`,
      name: line.name,
      value: line.amount,
      hue: 'flow-saved',
      note: t(countKey('home.month.intoGoal', line.count), { count: line.count }),
      open: () => void navigate(`/wealth/goals/${line.goalId}`),
    })),
    ...(fromEarlier.minor > 0
      ? [
          {
            key: 'earlier',
            name: t('home.month.fromEarlier'),
            value: money(-fromEarlier.minor, currency),
            hue: 'bar-quiet',
            note: t('home.month.fromEarlierWhy'),
            open: () => onDrill(),
          },
        ]
      : []),
  ]
  return (
    <>
      <PartOfWhole
        parts={parts}
        label={t('home.flows.saved')}
        empty={t('home.month.savedEmpty')}
        onOpen={(key) => parts.find((part) => part.key === key)?.open()}
      />
      {report.savedFrom.slips.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="home-panel-slips">
          <h3 id="home-panel-slips" className="m-0 text-body font-medium">
            {t('home.month.offPaycheck')}
          </h3>
          <p className="m-0 text-ink-secondary">{t('home.month.offPaycheckWhy')}</p>
          <Rows
            rows={report.savedFrom.slips.map((line) => ({ key: `slip-${line.deductionTypeId}`, name: line.name, value: line.amount }))}
          />
          <p className="m-0">
            <button type="button" className="fc-text-action" onClick={() => void navigate('/paychecks')}>
              {t('home.month.openPaychecks')}
            </button>
          </p>
        </section>
      )}
    </>
  )
}

function Taxes({ tax }: { readonly tax: Money | undefined }) {
  const t = useT()
  const navigate = useNavigate()
  return (
    <>
      <HeadlineFigure label={t('home.flows.taxes')} value={tax} change={t('home.month.taxesWhat')} empty={t('home.month.noPaycheck')} />
      <p className="m-0">
        <button type="button" className="fc-text-action" onClick={() => void navigate('/paychecks')}>
          {t('home.month.openPaychecks')}
        </button>
      </p>
    </>
  )
}

/** A category's rows in the month — the rows its line on Where it went counts, read as Transactions reads them. */
function Category({
  id,
  period,
  report,
  went,
  kicker,
  onDrill,
  onClose,
}: {
  readonly id: string
  readonly period: YearMonth
  readonly report: MonthlyReport
  readonly went: Money
  readonly kicker: string
  readonly onDrill: (category?: string) => void
  readonly onClose: () => void
}) {
  const t = useT()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const none = id === UNCATEGORIZED_OPTION
  const line = report.categories.find((one) => (none ? one.categoryId === undefined : one.categoryId === id))
  const rows = useMemo(
    () =>
      db === undefined
        ? []
        : listTransactions(db, {
            from: monthStart(period),
            to: monthEnd(period),
            ...(none ? { uncategorized: true } : { categoryId: id, includeSubcategories: true }),
          }, ROW_LIMIT),
    [db, revision, period, id, none],
  )
  return (
    <SidePanel kicker={kicker} title={<Bidi>{line?.name ?? t('home.flows.uncategorized')}</Bidi>} onClose={onClose}>
      <HeadlineFigure
        label={t('home.flows.wentOut')}
        value={line?.outflow}
        change={
          line === undefined
            ? undefined
            : t(countKey('home.month.categoryShare', line.transactionCount), {
                count: line.transactionCount,
                share: share(drawn(line.outflow), drawn(went)),
              })
        }
        empty={t('home.month.categoryNone')}
      />
      {rows.length > 0 && <Charges rows={rows} />}
      <p className="m-0">
        <button type="button" className="fc-text-action" onClick={() => onDrill(id)}>
          {t('home.month.openRows')}
        </button>
      </p>
    </SidePanel>
  )
}

/** The most rows a category's panel lists before Transactions takes over. */
const ROW_LIMIT = 50

/** Rows of a breakdown: a name with its note, the amount at the end, and the total under a rule. */
function Rows({
  rows,
  total,
}: {
  readonly rows: readonly { readonly key: string; readonly name: string; readonly note?: React.ReactNode; readonly value: Money }[]
  readonly total?: { readonly label: string; readonly value: Money } | undefined
}) {
  return (
    <div className="flex flex-col">
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <li key={row.key} className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline py-2">
            <span className="flex min-w-0 flex-col">
              <Bidi className="min-w-0 truncate">{row.name}</Bidi>
              {row.note !== undefined && <span className="text-caption text-ink-secondary">{row.note}</span>}
            </span>
            <span className="text-end tabular-nums" dir="ltr">
              {kitMoney(row.value)}
            </span>
          </li>
        ))}
      </ul>
      {total !== undefined && (
        <div className="flex justify-between pt-3 font-semibold">
          <span>{total.label}</span>
          <span className="tabular-nums" dir="ltr">
            {kitMoney(total.value)}
          </span>
        </div>
      )}
    </div>
  )
}

/** Charges as a table: the day, the shop, the amount. */
function Charges({ rows }: { readonly rows: readonly StoredTransaction[] }) {
  const dates = useDates()
  return (
    <table className="w-full border-collapse">
      <tbody>
        {rows.map((one) => (
          <tr key={one.id} className="h-10 border-b border-hairline">
            <td className="w-20 pe-3 text-caption text-ink-secondary tabular-nums">{dates.dayMonth(one.transactionDate)}</td>
            <td className="max-w-0 pe-3">
              <Bidi className="block truncate">{one.merchantRaw}</Bidi>
            </td>
            <td className="text-end tabular-nums" dir="ltr">
              {kitMoney(one.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
