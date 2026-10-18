import { useMemo } from 'react'

import { formatMoney } from '@/core/money.ts'
import {
  listTransferPairs,
  setTransferDecisions,
  type TransferDecision,
  type TransferPair,
} from '@/data/repositories/transferPairRepository.ts'
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
    <section aria-label="Transfers between your accounts" className="fc-pop-enter border-b border-hairline bg-surface px-6 py-3">
      <p className="text-ink">
        {pending.length} {pending.length === 1 ? 'transfer' : 'transfers'} between your own accounts
      </p>
      <p className="mt-0.5 text-ink-secondary">
        The same amount left one account and arrived in another within a few days. Until you say,
        the row that left counts as spending and the row that arrived as income.
      </p>

      <ul className="mt-2">
        {pending.map((pair) => (
          <TransferLine key={pair.id} pair={pair} onAnswer={(decision) => answer([pair], decision)} />
        ))}
      </ul>

      {pending.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => answer(pending, 'PAIRED')}>
            They are all transfers
          </Button>
          <span className="text-ink-tertiary">
            A transfer is neither income nor spending. Any answer can be changed on the row.
          </span>
        </div>
      )}
    </section>
  )
}

/** One pair, with its two answers — here and in Home's waiting list (M31 U1). */
export function TransferLine({ pair, onAnswer }: { pair: TransferPair; onAnswer: (decision: TransferDecision) => void }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-hairline py-1.5">
      <span className="text-ink tabular-nums">{formatMoney(pair.in.amount)}</span>
      <span className="text-ink-secondary">
        from <Bidi>{pair.out.accountName}</Bidi>{' '}
        <span className="text-ink-tertiary tabular-nums">{pair.out.date}</span> to{' '}
        <Bidi>{pair.in.accountName}</Bidi>{' '}
        <span className="text-ink-tertiary tabular-nums">{pair.in.date}</span>
      </span>
      <span className="ml-auto flex gap-2">
        <Button size="sm" onClick={() => onAnswer('PAIRED')}>
          One transfer
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAnswer('NOT_PAIRED')}>
          Not a transfer
        </Button>
      </span>
    </li>
  )
}
