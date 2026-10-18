import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatMoney, type CurrencyCode } from '@/core/money.ts'
import { addMonths, formatYearMonth, yearMonthOf } from '@/core/time.ts'
import { unmatchedSettlements } from '@/data/importer/settlementScan.ts'
import {
  decideAllForCard,
  countCardCharges,
  listSettlementSummaries,
  setSettlementDecision,
} from '@/data/repositories/cardSettlementRepository.ts'
import { setExcludeSettlementsFromStats } from '@/data/repositories/accountRepository.ts'
import { confirmPayment, dismissPayment, paymentReview } from '@/data/repositories/debtRepository.ts'
import { listFundsWithLatest } from '@/data/repositories/fundRepository.ts'
import { billCandidates, confirmCandidate, dismissMerchant } from '@/data/repositories/fixedExpenseRepository.ts'
import { waitingStatements } from '@/data/repositories/homeRepository.ts'
import { setNoPayMonths } from '@/data/repositories/paycheckRepository.ts'
import { confirmHolding, staleHoldings } from '@/data/repositories/savingsRepository.ts'
import { listTransferPairs, setTransferDecisions } from '@/data/repositories/transferPairRepository.ts'
import { DEFAULT_WINDOW_MONTHS } from '@/domain/fixedExpenses.ts'
import { waitingCounts, type AttentionItem } from '@/domain/home.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { PaymentLine } from '@/ui/debts/PaymentReview.tsx'
import { CandidateCard } from '@/ui/fixed/CandidateCard.tsx'
import { BlockHead } from '@/ui/home/parts.tsx'
import { newFigureFor } from '@/ui/savings/holdingCheck.ts'
import { SettlementLine } from '@/ui/import/SettlementPrompt.tsx'
import { TransferLine } from '@/ui/import/TransferPrompt.tsx'
import { today } from '@/ui/today.ts'

/**
 * **Waiting for an answer** — every question the app has, at the top of Home,
 * each answered where it is asked (M31 U1, D-367; the mockup is
 * `docs/mockups/m31-u1/waiting-list.html`).
 *
 * One plain switch over the ten kinds `attention()` ranks. A kind whose answer is
 * a click or two is answered in its row, through the row component its own screen
 * already draws; a kind that needs more — a category per merchant, a figure typed —
 * is one button to the screen that asks it. The queues where each is answered
 * today stay where they are. Nothing here is stored: the rows are read fresh.
 */
export function WaitingList({
  items,
  currency,
  onRead,
}: {
  items: readonly AttentionItem[]
  currency: CurrencyCode
  onRead: () => void
}) {
  const totals = waitingCounts(items).totals
  return (
    <section aria-label="Waiting for an answer" className="flex flex-col">
      <div className="border-b border-hairline-strong pb-2">
        <BlockHead title="Waiting for an answer" aside={totals > 0 ? `${String(totals)} ${totals === 1 ? 'changes' : 'change'} this month’s totals` : undefined} />
      </div>
      {items.length === 0 ? (
        <p className="m-0 flex items-baseline gap-2.5 border-b border-hairline py-2.5 text-ink-secondary">
          <ActionGlyph name="check" />
          Nothing. Every row has a category, every statement and paycheck is here, and nothing the app found is waiting on you.
        </p>
      ) : (
        items.map((item) => <Kind key={item.kind} item={item} currency={currency} onRead={onRead} />)
      )}
    </section>
  )
}

function Kind({ item, currency, onRead }: { item: AttentionItem; currency: CurrencyCode; onRead: () => void }) {
  const navigate = useNavigate()
  const n = item.count
  switch (item.kind) {
    case 'PENDING_SETTLEMENTS':
      return <Settlements count={n} />
    case 'PENDING_TRANSFERS':
      return <Transfers count={n} />
    case 'UNMATCHED_CHARGES':
      return <Unmatched onRead={onRead} />
    case 'MISSING_STATEMENT':
      return <Statements onRead={onRead} />
    case 'UNCATEGORIZED':
      return (
        <Head
          title={`${String(item.rows ?? n)} ${item.rows === 1 ? 'transaction' : 'transactions'} at ${String(n)} ${n === 1 ? 'merchant needs' : 'merchants need'} a category`}
          why="every category total depends on it"
        >
          <Button variant="secondary" size="sm" onClick={() => navigate('/transactions/merchants')} data-tour="choose-categories">
            Choose categories
          </Button>
        </Head>
      )
    case 'UNCONFIRMED_PAYMENTS':
      return <Payments count={n} />
    case 'FIXED_EXPENSE_CANDIDATES':
      return <Bills />
    case 'MISSING_PAYSLIP':
      return <Payslip item={item} onRead={onRead} />
    case 'FUND_WITHOUT_BALANCE':
      return <Funds count={n} />
    case 'UNCONFIRMED_HOLDING':
      return <Holdings currency={currency} />
  }
}

/** The document, its revision and its one write — what every kind below reads and answers through. */
function useLedger() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const write = (work: (database: NonNullable<typeof db>, now: number) => void): void => {
    mutate((database) => work(database, Date.now()))
  }
  return { db, revision, write }
}

function Settlements({ count }: { count: number }) {
  const { db, revision, write } = useLedger()
  const groups = useMemo(() => (db === undefined ? [] : listSettlementSummaries(db, { decision: 'PENDING' })), [db, revision])
  const cards = [...new Set(groups.map((group) => group.cardAccountId))]
  return (
    <Head
      title={`${String(count)} card ${count === 1 ? 'payment' : 'payments'} in your bank statement ${count === 1 ? 'is' : 'are'} the same money as your card statement`}
      why="the month is counted twice until you say"
      bulk={
        groups.length > 1 && (
          // What the accounts screen's bulk answer means: about the card, so remembered for it.
          <Button variant="ghost" size="sm" onClick={() => write((database, now) => {
            for (const id of cards) {
              setExcludeSettlementsFromStats(database, id, true, now)
              decideAllForCard(database, id, 'EXCLUDED', now)
            }
          })}>
            Leave all {groups.length} out
          </Button>
        )
      }
      rows={groups.map((group) => (
        <ul key={`${group.cardAccountId}|${group.billingPeriod ?? ''}`} className="m-0 list-none p-0">
          <SettlementLine
            group={group}
            onDecide={(decision) => write((database, now) => {
              for (const row of group.rows) setSettlementDecision(database, row.linkId, decision, now)
            })}
          />
        </ul>
      ))}
    />
  )
}

function Transfers({ count }: { count: number }) {
  const { db, revision, write } = useLedger()
  const pairs = useMemo(() => (db === undefined ? [] : listTransferPairs(db, { decision: 'PENDING' })), [db, revision])
  return (
    <Head
      title={`${String(count)} ${count === 1 ? 'transfer' : 'transfers'} between your own accounts`}
      why="counted as money in and money out until you say"
      bulk={
        pairs.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => write((database) => setTransferDecisions(database, pairs.map((pair) => ({ pairId: pair.id, decision: 'PAIRED' }))))}>
            {pairs.length === 2 ? 'Both are transfers' : `All ${String(pairs.length)} are transfers`}
          </Button>
        )
      }
      rows={pairs.map((pair) => (
        <ul key={pair.id} className="m-0 list-none p-0">
          <TransferLine pair={pair} onAnswer={(decision) => write((database) => setTransferDecisions(database, [{ pairId: pair.id, decision }]))} />
        </ul>
      ))}
    />
  )
}

function Unmatched({ onRead }: { onRead: () => void }) {
  const { db, revision, write } = useLedger()
  const entries = useMemo(() => (db === undefined ? [] : unmatchedSettlements(db)), [db, revision])
  return entries.map((entry) => (
    <Head
      key={entry.last4 ?? 'unknown'}
      negative
      title={`${formatMoney(entry.chargedTotal)} paid to ${entry.last4 === undefined ? 'a card this document does not have' : `a card ending ${entry.last4}`}, and no statement of it has been read`}
      why="that month’s card spending is missing"
    >
      <Button variant="secondary" size="sm" onClick={onRead}>
        Read its statement…
      </Button>
      <Button variant="ghost" size="sm" onClick={() => write((database, now) => countCardCharges(database, entry.rows.map((row) => row.ref), true, now))}>
        Count the payment as spending
      </Button>
    </Head>
  ))
}

function Statements({ onRead }: { onRead: () => void }) {
  const { db, revision } = useLedger()
  const gaps = useMemo(() => (db === undefined ? [] : waitingStatements(db)), [db, revision])
  return gaps.map((gap) => (
    <Head
      key={gap.accountId}
      negative
      title={`No ${gap.name}${gap.last4 === undefined ? '' : ` ···${gap.last4}`} statement for ${formatYearMonth(gap.period)}`}
      why="so Went out is short"
    >
      <Button variant="secondary" size="sm" onClick={onRead}>
        Read…
      </Button>
    </Head>
  ))
}

function Payments({ count }: { count: number }) {
  const { db, revision, write } = useLedger()
  const navigate = useNavigate()
  const found = useMemo(() => (db === undefined ? [] : paymentReview(db).items), [db, revision])
  return (
    <Head
      title={`${String(count)} debt ${count === 1 ? 'payment was' : 'payments were'} found rather than entered`}
      why="the app guessed these, and they count towards the balance already"
      bulk={
        found.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => write((database, now) => { for (const item of found) confirmPayment(database, item.payment.id, now) })}>
            {found.length === 2 ? 'Accept both' : `Accept all ${String(found.length)}`}
          </Button>
        )
      }
      rows={found.map((item) => (
        <PaymentLine
          key={item.payment.id}
          item={item}
          onConfirm={() => write((database, now) => confirmPayment(database, item.payment.id, now))}
          onEdit={() => navigate(`/wealth/debts/${encodeURIComponent(item.debt.id)}`)}
          onDismiss={() => write((database, now) => dismissPayment(database, item.payment.id, now))}
        />
      ))}
    />
  )
}

/** Each fund with no balance, and a button that opens that fund (M36 U10) — not the list of them. */
function Funds({ count }: { count: number }) {
  const { db, revision } = useLedger()
  const navigate = useNavigate()
  const funds = useMemo(
    () => (db === undefined ? [] : listFundsWithLatest(db, { includeArchived: true }).filter((entry) => entry.latest === undefined)),
    [db, revision],
  )
  return (
    <Head
      title={`${String(count)} ${count === 1 ? 'fund has' : 'funds have'} no balance entered`}
      why="missing from net worth"
      rows={funds.map(({ fund }) => (
        <div key={fund.id} className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline py-1.5">
          <Bidi className="min-w-0 flex-1">{fund.name}</Bidi>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/wealth/funds/${encodeURIComponent(fund.id)}`)}>
            Enter its balance
          </Button>
        </div>
      ))}
    >
      {/* A balance in another currency is missing from the figure too, and has a reading. */}
      {funds.length === 0 && (
        <Button variant="secondary" size="sm" onClick={() => navigate('/wealth/funds')}>
          Enter balances
        </Button>
      )}
    </Head>
  )
}

function Bills() {
  const { db, revision, write } = useLedger()
  const candidates = useMemo(
    () => (db === undefined ? [] : billCandidates(db, addMonths(yearMonthOf(today()), -1))),
    [db, revision],
  )
  const n = candidates.length
  if (n === 0) return null
  return (
    <Head
      title={`${String(n)} ${n === 1 ? 'charge looks like a bill' : 'charges look like bills'}`}
      why="changes what there is to split"
      rows={candidates.map((candidate) => (
        <CandidateCard
          key={`${candidate.merchantNormalized}-${candidate.currency}`}
          candidate={candidate}
          windowMonths={DEFAULT_WINDOW_MONTHS}
          onConfirm={(choice) => write((database, now) => confirmCandidate(database, candidate, choice, now))}
          onDismiss={() => write((database, now) => dismissMerchant(database, candidate.merchantNormalized, now))}
        />
      ))}
    />
  )
}

function Payslip({ item, onRead }: { item: AttentionItem; onRead: () => void }) {
  const { write } = useLedger()
  const navigate = useNavigate()
  const month = item.period
  return (
    <Head title={`No paycheck for ${month === undefined ? 'last month' : formatYearMonth(month)}`} why="the splitter is built on it">
      <Button variant="secondary" size="sm" onClick={onRead}>
        Read…
      </Button>
      <Button variant="ghost" size="sm" onClick={() => navigate('/paychecks', { state: { add: true } })}>
        Add by hand
      </Button>
      {month !== undefined && (
        <Button variant="ghost" size="sm" onClick={() => write((database, now) => setNoPayMonths(database, [month], true, now))}>
          No pay that month
        </Button>
      )}
    </Head>
  )
}

function Holdings({ currency }: { currency: CurrencyCode }) {
  const { db, revision, write } = useLedger()
  const navigate = useNavigate()
  const asOf = today()
  const stale = useMemo(() => (db === undefined ? [] : staleHoldings(db, asOf, currency)), [db, revision, currency])
  const n = stale.length
  return (
    <Head
      title={`${String(n)} ${n === 1 ? 'holding has' : 'holdings have'} money nobody has counted lately`}
      why="counted, and possibly wrong"
      rows={stale.map((one) => (
        <div key={one.holdingId} className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline py-1.5">
          <span className="min-w-0 flex-1">
            <Bidi>{one.holding.name}</Bidi>: is it still <span className="tabular-nums">{formatMoney(one.balance)}</span>?
            <small className="block text-caption text-ink-secondary">
              {one.monthsSince === undefined ? 'never counted' : `counted ${String(one.monthsSince)} months ago`}
            </small>
          </span>
          <Button size="sm" onClick={() => write((database, now) => confirmHolding(database, one.holdingId, asOf, now))}>
            Still right
          </Button>
          <Button variant="ghost" size="sm" onClick={() => {
              const figure = newFigureFor(one.holdingId)
              navigate(figure.to, { state: figure.state })
            }}
          >
            New figure
          </Button>
        </div>
      ))}
    />
  )
}

/**
 * One question: its sentence, why it matters, and either its answers on the
 * same line or its rows beneath — three of them, biggest first, and the rest
 * behind Show more. A layout, not a type: each kind above says its own words.
 */
function Head({
  title,
  why,
  negative = false,
  bulk,
  rows,
  children,
}: {
  title: string
  why: string
  negative?: boolean
  bulk?: ReactNode
  rows?: readonly ReactNode[]
  children?: ReactNode
}) {
  const [all, setAll] = useState(false)
  const shown = rows === undefined || all ? rows : rows.slice(0, 3)
  return (
    <div className="border-b border-hairline">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
        <span aria-hidden className={`size-2 shrink-0 self-start rounded-full mt-[7px] ${negative ? 'bg-negative' : 'bg-ink'}`} />
        <span className={`min-w-0 flex-[1_1_20rem] ${negative ? 'text-negative' : ''}`}>
          {title}
          <small className="block text-caption text-ink-secondary">{why}</small>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {bulk}
          {children}
        </span>
      </div>
      {shown !== undefined && shown.length > 0 && <div className="pl-5">{shown}</div>}
      {rows !== undefined && rows.length > 3 && (
        <div className="pb-2.5 pl-5">
          <Button variant="ghost" size="sm" onClick={() => setAll((current) => !current)}>
            {all ? 'Show fewer' : `Show ${String(rows.length - 3)} more`}
          </Button>
        </div>
      )}
    </div>
  )
}

