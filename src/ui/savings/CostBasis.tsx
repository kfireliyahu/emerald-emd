import { formatMoney } from '@/core/money.ts'
import { parseISODate } from '@/core/time.ts'
import type { HoldingPutIn } from '@/data/repositories/goalDepositRepository.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { Tag } from '@/ui/wealth/parts.tsx'

/**
 * What the holding's rows put in, against the cost basis a reading printed (D-357):
 * proved, failed or unchecked, and the unchecked one says why. On the goal's drawer
 * and under the goal form's answer (M30 F3). Its words are the catalogue's (M64 F26).
 */
export function CostBasis({ fed }: { fed: HoldingPutIn }) {
  const t = useT()
  const dates = useDates()
  const check = fed.check
  const day = (iso: string): string => {
    const parsed = parseISODate(iso)
    return parsed === undefined ? iso : dates.dayMonth(parsed)
  }
  return (
    <p className="m-0 flex flex-wrap items-center gap-1.5 text-caption text-ink-secondary">
      {check.kind === 'PROVED' ? (
        <Tag tone="good">{t('wealth.costBasis.matches')}</Tag>
      ) : check.kind === 'FAILED' ? (
        <Tag tone="bad">{t('wealth.costBasis.off')}</Tag>
      ) : (
        <Tag tone="dash">{t('wealth.costBasis.unchecked')}</Tag>
      )}
      <span>
        {t(countKey('wealth.costBasis.rows', fed.rows), { count: fed.rows, amount: formatMoney(fed.putIn) })}
        {fed.reading !== undefined && fed.reading.rows !== fed.rows
          ? t('wealth.costBasis.byReading', { amount: formatMoney(fed.reading.putIn), day: day(fed.reading.asOf) })
          : ''}
        {check.kind === 'FAILED'
          ? t('wealth.costBasis.failed', { printed: formatMoney(check.printed), difference: formatMoney(check.difference) })
          : check.kind === 'UNCHECKED'
            ? t('wealth.costBasis.why', { reason: check.reason })
            : t('wealth.costBasis.proved')}
      </span>
    </p>
  )
}
