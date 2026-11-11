import { useMemo } from 'react'

import { formatMoney } from '@/core/money.ts'
import {
  listTransferPairs,
  setTransferDecisions,
  type TransferDecision,
  type TransferPair,
} from '@/data/repositories/transferPairRepository.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { fillNodes } from '@/i18n/nodes.tsx'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'

/**
 * The transfers an import found between two of the person's own accounts
 * (M30 U3, D-356) — a row leaving one and the same amount arriving in another
 * within a few days, waiting on one answer each.
 *
 * Beside the card-settlement prompt and shaped like it, for its reason
 * (D-064): the second statement of a pair may land weeks after the first, with
 * no review screen open to ask on. The notice on every screen points here.
 */
export function TransferPrompt() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const t = useT()
  const pending = useMemo(
    () => (db === undefined ? [] : listTransferPairs(db, { decision: 'PENDING' })),
    [db, revision],
  )
  if (pending.length === 0) return null

  const answer = (pairs: readonly TransferPair[], decision: TransferDecision): void => {
    mutate((database) => {
      setTransferDecisions(database, pairs.map((pair) => ({ pairId: pair.id, decision })))
    })
  }

  return (
    <section aria-label={t('reading.transfer.label')} className="fc-pop-enter border-b border-hairline bg-surface px-6 py-3">
      <p className="text-ink">
        {t(countKey('reading.transfer.count', pending.length), { count: pending.length })}
      </p>
      <p className="mt-0.5 text-ink-secondary">{t('reading.transfer.lead')}</p>

      <ul className="mt-2">
        {pending.map((pair) => (
          <TransferLine key={pair.id} pair={pair} onAnswer={(decision) => answer([pair], decision)} />
        ))}
      </ul>

      {pending.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => answer(pending, 'PAIRED')}>
            {t('reading.transfer.all')}
          </Button>
          <span className="text-ink-tertiary">{t('reading.transfer.neither')}</span>
        </div>
      )}
    </section>
  )
}

/** One pair, with its two answers — here and in Home's waiting list (M31 U1). */
export function TransferLine({ pair, onAnswer }: { pair: TransferPair; onAnswer: (decision: TransferDecision) => void }) {
  const t = useT()
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-hairline py-1.5">
      <span className="text-ink tabular-nums">{formatMoney(pair.in.amount)}</span>
      <span className="text-ink-secondary">
        {fillNodes(t('reading.transfer.fromTo'), {
          from: <Bidi>{pair.out.accountName}</Bidi>,
          fromDate: <span className="text-ink-tertiary tabular-nums">{pair.out.date}</span>,
          to: <Bidi>{pair.in.accountName}</Bidi>,
          toDate: <span className="text-ink-tertiary tabular-nums">{pair.in.date}</span>,
        })}
      </span>
      <span className="ms-auto flex gap-2">
        <Button size="sm" onClick={() => onAnswer('PAIRED')}>
          {t('reading.transfer.one')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAnswer('NOT_PAIRED')}>
          {t('reading.transfer.not')}
        </Button>
      </span>
    </li>
  )
}
