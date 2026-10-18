import { useMemo } from 'react'
import type { Database } from 'sql.js'

import { equals, formatMoney } from '@/core/money.ts'
import { unmatchedSettlements } from '@/data/importer/settlementScan.ts'
import { setExcludeSettlementsFromStats } from '@/data/repositories/accountRepository.ts'
import {
  decideAllForCard,
  listSettlementSummaries,
  setSettlementDecision,
  type SettlementSummary,
} from '@/data/repositories/cardSettlementRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'

/**
 * The card-settlement prompt — docs/f06's "3 credit-card charges found".
 *
 * **Not on the review screen, which is where docs/f06 draws it.** That placement
 * only covers the direction where the bank statement is the file being reviewed.
 * The other direction has no review screen open at all: a card statement
 * committed today turns a bank row imported six weeks ago into a settlement
 * (D-062), and there is nothing to hang a prompt on. One queue reachable from
 * the account it is about covers both, and it is the shape D-058 already chose
 * for applying a plan — a list of suggestions that writes nothing until one is
 * accepted.
 *
 * Three answers, exactly as docs/f06 asks: exclude them all, keep them all, or
 * decide one at a time. "Decide individually" is not a mode here — the per-group
 * buttons are always there, and the two bulk buttons are a shortcut over them
 * rather than a different screen.
 */
export function SettlementPrompt({ cardAccountId }: { cardAccountId?: string | undefined }) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const data = useMemo(() => {
    if (db === undefined) return undefined
    return {
      pending: listSettlementSummaries(db, { decision: 'PENDING', ...(cardAccountId !== undefined ? { cardAccountId } : {}) }),
      unmatched: cardAccountId === undefined ? unmatchedSettlements(db) : [],
    }
  }, [db, revision, cardAccountId])

  if (data === undefined) return null
  const { pending, unmatched } = data
  if (pending.length === 0 && unmatched.length === 0) return null

  const write = (work: (database: Database, now: number) => void): void => {
    mutate((database) => work(database, Date.now()))
  }

  const cards = [...new Set(pending.map((group) => group.cardAccountId))]

  return (
    <section className="fc-pop-enter border-b border-hairline bg-surface px-6 py-3">
      {pending.length > 0 && (
        <>
          <p className="text-ink">
            {pending.length} card {pending.length === 1 ? 'payment' : 'payments'} found in your
            bank statement
          </p>
          <p className="mt-0.5 text-ink-secondary">
            These look like the monthly payments for cards whose statements you already imported.
            Counting them as well would double your spending.
          </p>

          <ul className="mt-2">
            {pending.map((group) => (
              <SettlementLine
                key={`${group.cardAccountId}|${group.billingPeriod ?? ''}`}
                group={group}
                onDecide={(decision) =>
                  write((database, now) => {
                    for (const row of group.rows) setSettlementDecision(database, row.linkId, decision, now)
                  })
                }
              />
            ))}
          </ul>

          {/* The bulk answers also set the per-card memory, because that is what
              they mean: a user answering "exclude these" is answering about the
              card, not about this month. Answering one group on its own does
              not — a single decision is about a single charge. docs/f06. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                write((database, now) => {
                  for (const id of cards) {
                    setExcludeSettlementsFromStats(database, id, true, now)
                    decideAllForCard(database, id, 'EXCLUDED', now)
                  }
                })
              }
            >
              Leave them out of totals
            </Button>
            <Button
              size="sm"
              onClick={() =>
                write((database, now) => {
                  for (const id of cards) {
                    setExcludeSettlementsFromStats(database, id, false, now)
                    decideAllForCard(database, id, 'KEPT', now)
                  }
                })
              }
            >
              Keep them
            </Button>
            <span className="text-ink-tertiary">
              Either answer is remembered for these cards and can be changed here later.
            </span>
          </div>
        </>
      )}

      {unmatched.map((entry) => (
        <p key={entry.last4 ?? 'unknown'} className="mt-3 flex items-center gap-2 text-negative">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-negative" />
          <span className="tabular-nums">
            {formatMoney(entry.chargedTotal)} paid to a card
            {entry.last4 === undefined ? ' this document does not have' : ` ending ${entry.last4}`},
            but no statement has been imported for it — that month of card spending is missing from
            the ledger.
          </span>
        </p>
      ))}
    </section>
  )
}

/** One card's payment for one month, with Leave out and Keep — here and in Home's waiting list (M31 U1). */
export function SettlementLine({
  group,
  onDecide,
}: {
  group: SettlementSummary
  onDecide: (decision: 'EXCLUDED' | 'KEPT') => void
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-hairline py-1.5">
      <Bidi className="text-ink">{group.cardAccountName}</Bidi>
      {group.last4 !== undefined && <span className="text-ink-tertiary">···{group.last4}</span>}
      <span className="text-ink tabular-nums">{formatMoney(group.chargedTotal)}</span>
      <span className="text-ink-tertiary tabular-nums">
        {group.rows.length === 1 ? group.rows[0]?.date : `${group.rows.length} payments`}
      </span>

      <Corroboration group={group} />

      <span className="ml-auto flex gap-2">
        <Button size="sm" onClick={() => onDecide('EXCLUDED')}>
          Leave out
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDecide('KEPT')}>
          Keep
        </Button>
      </span>
    </li>
  )
}

/**
 * What the app is actually claiming, in numbers the user can check against the
 * statement in front of them.
 *
 * A prompt that says "this looks like a card charge" and nothing else asks for
 * trust it has not earned. Saying "matches 63 transactions totalling ₪4,210.55"
 * is a claim that can be wrong in a visible way, which is the only kind worth
 * making.
 */
function Corroboration({ group }: { group: SettlementSummary }) {
  if (group.statementTotal === undefined) {
    return (
      <span className="text-ink-tertiary">
        matched by the card number; no statement of ours adds up to it
      </span>
    )
  }

  const agrees = equals(group.statementTotal, group.chargedTotal)
  return (
    <span className={agrees ? 'text-ink-secondary tabular-nums' : 'text-negative tabular-nums'}>
      {agrees ? 'matches' : 'does not match'} {group.statementRowCount} transaction
      {group.statementRowCount === 1 ? '' : 's'} totalling {formatMoney(group.statementTotal)}
      {group.billingPeriod !== undefined && ` in ${group.billingPeriod}`}
    </span>
  )
}
