import { formatMoney } from '@/core/money.ts'
import type { HoldingPutIn } from '@/data/repositories/goalDepositRepository.ts'
import { Tag } from '@/ui/wealth/parts.tsx'

/**
 * What the holding's rows put in, against the cost basis a reading printed (D-357):
 * proved, failed or unchecked, and the unchecked one says why. On the goal's drawer
 * and under the goal form's answer (M30 F3).
 */
export function CostBasis({ fed }: { fed: HoldingPutIn }) {
  const check = fed.check
  return (
    <p className="m-0 flex flex-wrap items-center gap-1.5 text-caption text-ink-secondary">
      {check.kind === 'PROVED' ? (
        <Tag tone="good">Matches its cost</Tag>
      ) : check.kind === 'FAILED' ? (
        <Tag tone="bad">Off its cost</Tag>
      ) : (
        <Tag tone="dash">Unchecked</Tag>
      )}
      <span>
        {String(fed.rows)} {fed.rows === 1 ? 'row' : 'rows'} put in {formatMoney(fed.putIn)}
        {fed.reading !== undefined && fed.reading.rows !== fed.rows
          ? `, ${formatMoney(fed.reading.putIn)} of it by ${fed.reading.asOf}`
          : ''}
        {check.kind === 'FAILED'
          ? `; the statement says it cost ${formatMoney(check.printed)}, ${formatMoney(check.difference)} apart.`
          : check.kind === 'UNCHECKED'
            ? `. ${check.reason}`
            : ', what the statement says it cost.'}
      </span>
    </p>
  )
}
