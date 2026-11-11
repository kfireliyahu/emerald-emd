import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatMoney, type CurrencyCode } from '@/core/money.ts'
import { addMonths, yearMonthOf } from '@/core/time.ts'
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
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { fillNodes } from '@/i18n/nodes.tsx'
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
  const t = useT()
  const totals = waitingCounts(items).totals
  return (
    <section aria-label={t('home.waiting.title')} className="flex flex-col">
      <div className="border-b border-hairline-strong pb-2">
        <BlockHead
          title={t('home.waiting.title')}
          aside={totals > 0 ? t(countKey('home.waiting.changesTotals', totals), { count: totals }) : undefined}
        />
      </div>
      {items.length === 0 ? (
        <p className="m-0 flex items-baseline gap-2.5 border-b border-hairline py-2.5 text-ink-secondary">
          <ActionGlyph name="check" />
          {t('home.waiting.nothing')}
        </p>
      ) : (
        items.map((item) => <Kind key={item.kind} item={item} currency={currency} onRead={onRead} />)
      )}
    </section>
  )
}

function Kind({ item, currency, onRead }: { item: AttentionItem; currency: CurrencyCode; onRead: () => void }) {
  const navigate = useNavigate()
  const t = useT()
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
          title={t(countKey('home.waiting.uncategorized.merchants', n), {
            rows: t(countKey('home.waiting.uncategorized.rows', item.rows ?? n), { count: item.rows ?? n }),
            count: n,
          })}
          why={t('home.waiting.uncategorized.why')}
        >
          <Button variant="secondary" size="sm" onClick={() => navigate('/transactions/merchants')} data-tour="choose-categories">
            {t('home.waiting.uncategorized.action')}
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
  const t = useT()
  const groups = useMemo(() => (db === undefined ? [] : listSettlementSummaries(db, { decision: 'PENDING' })), [db, revision])
  const cards = [...new Set(groups.map((group) => group.cardAccountId))]
  return (
    <Head
      title={t(countKey('home.waiting.settlements.title', count), { count })}
      why={t('home.waiting.settlements.why')}
      bulk={
        groups.length > 1 && (
          // What the accounts screen's bulk answer means: about the card, so remembered for it.
          <Button variant="ghost" size="sm" onClick={() => write((database, now) => {
            for (const id of cards) {
              setExcludeSettlementsFromStats(database, id, true, now)
              decideAllForCard(database, id, 'EXCLUDED', now)
            }
          })}>
            {t('home.waiting.settlements.leaveAll', { count: groups.length })}
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
  const t = useT()
  const pairs = useMemo(() => (db === undefined ? [] : listTransferPairs(db, { decision: 'PENDING' })), [db, revision])
  return (
    <Head
      title={t(countKey('home.waiting.transfers.title', count), { count })}
      why={t('home.waiting.transfers.why')}
      bulk={
        pairs.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => write((database) => setTransferDecisions(database, pairs.map((pair) => ({ pairId: pair.id, decision: 'PAIRED' }))))}>
            {pairs.length === 2 ? t('home.waiting.transfers.both') : t('home.waiting.transfers.all', { count: pairs.length })}
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
  const t = useT()
  const entries = useMemo(() => (db === undefined ? [] : unmatchedSettlements(db)), [db, revision])
  return entries.map((entry) => (
    <Head
      key={entry.last4 ?? 'unknown'}
      negative
      title={t('home.waiting.unmatched.title', {
        amount: formatMoney(entry.chargedTotal),
        card:
          entry.last4 === undefined
            ? t('home.waiting.unmatched.unknownCard')
            : t('home.waiting.unmatched.card', { last4: entry.last4 }),
      })}
      why={t('home.waiting.unmatched.why')}
    >
      <Button variant="secondary" size="sm" onClick={onRead}>
        {t('home.waiting.unmatched.read')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => write((database, now) => countCardCharges(database, entry.rows.map((row) => row.ref), true, now))}>
        {t('home.waiting.unmatched.count')}
      </Button>
    </Head>
  ))
}

function Statements({ onRead }: { onRead: () => void }) {
  const { db, revision } = useLedger()
  const t = useT()
  const dates = useDates()
  const gaps = useMemo(() => (db === undefined ? [] : waitingStatements(db)), [db, revision])
  return gaps.map((gap) => (
    <Head
      key={gap.accountId}
      negative
      title={fillNodes(t('home.waiting.statements.title'), {
        account: <Bidi>{gap.last4 === undefined ? gap.name : `${gap.name} ···${gap.last4}`}</Bidi>,
        month: dates.yearMonth(gap.period),
      })}
      why={t('home.waiting.statements.why')}
    >
      <Button variant="secondary" size="sm" onClick={onRead}>
        {t('home.waiting.statements.read')}
      </Button>
    </Head>
  ))
}

function Payments({ count }: { count: number }) {
  const { db, revision, write } = useLedger()
  const navigate = useNavigate()
  const t = useT()
  const found = useMemo(() => (db === undefined ? [] : paymentReview(db).items), [db, revision])
  return (
    <Head
      title={t(countKey('home.waiting.payments.title', count), { count })}
      why={t('home.waiting.payments.why')}
      bulk={
        found.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => write((database, now) => { for (const item of found) confirmPayment(database, item.payment.id, now) })}>
            {found.length === 2 ? t('home.waiting.payments.both') : t('home.waiting.payments.all', { count: found.length })}
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
  const t = useT()
  const funds = useMemo(
    () => (db === undefined ? [] : listFundsWithLatest(db, { includeArchived: true }).filter((entry) => entry.latest === undefined)),
    [db, revision],
  )
  return (
    <Head
      title={t(countKey('home.waiting.funds.title', count), { count })}
      why={t('home.waiting.funds.why')}
      rows={funds.map(({ fund }) => (
        <div key={fund.id} className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline py-1.5">
          <Bidi className="min-w-0 flex-1">{fund.name}</Bidi>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/wealth/funds/${encodeURIComponent(fund.id)}`)}>
            {t('home.waiting.funds.enter')}
          </Button>
        </div>
      ))}
    >
      {/* A balance in another currency is missing from the figure too, and has a reading. */}
      {funds.length === 0 && (
        <Button variant="secondary" size="sm" onClick={() => navigate('/wealth/funds')}>
          {t('home.waiting.funds.enterAll')}
        </Button>
      )}
    </Head>
  )
}

function Bills() {
  const { db, revision, write } = useLedger()
  const t = useT()
  const candidates = useMemo(
    () => (db === undefined ? [] : billCandidates(db, addMonths(yearMonthOf(today()), -1))),
    [db, revision],
  )
  const n = candidates.length
  if (n === 0) return null
  return (
    <Head
      title={t(countKey('home.waiting.bills.title', n), { count: n })}
      why={t('home.waiting.bills.why')}
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
  const t = useT()
  const dates = useDates()
  const month = item.period
  // Its Add a paycheck is the band's above, the one Home has (M54 F13, M59 U6).
  return (
    <Head
      title={t('home.waiting.payslip.title', {
        month: month === undefined ? t('home.waiting.payslip.lastMonth') : dates.yearMonth(month),
      })}
      why={t('home.waiting.payslip.why')}
    >
      <Button variant="secondary" size="sm" onClick={onRead}>
        {t('home.waiting.payslip.read')}
      </Button>
      {month !== undefined && (
        <Button variant="ghost" size="sm" onClick={() => write((database, now) => setNoPayMonths(database, [month], true, now))}>
          {t('home.waiting.payslip.noPay')}
        </Button>
      )}
    </Head>
  )
}

function Holdings({ currency }: { currency: CurrencyCode }) {
  const { db, revision, write } = useLedger()
  const navigate = useNavigate()
  const t = useT()
  const asOf = today()
  const stale = useMemo(() => (db === undefined ? [] : staleHoldings(db, asOf, currency)), [db, revision, currency])
  const n = stale.length
  return (
    <Head
      title={t(countKey('home.waiting.holdings.title', n), { count: n })}
      why={t('home.waiting.holdings.why')}
      rows={stale.map((one) => (
        <div key={one.holdingId} className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline py-1.5">
          <span className="min-w-0 flex-1">
            {fillNodes(t('home.waiting.holdings.still'), {
              name: <Bidi>{one.holding.name}</Bidi>,
              amount: <span className="tabular-nums">{formatMoney(one.balance)}</span>,
            })}
            <small className="block text-caption text-ink-secondary">
              {one.monthsSince === undefined
                ? t('home.waiting.holdings.never')
                : t(countKey('home.waiting.holdings.monthsAgo', one.monthsSince), { count: one.monthsSince })}
            </small>
          </span>
          <Button size="sm" onClick={() => write((database, now) => confirmHolding(database, one.holdingId, asOf, now))}>
            {t('home.waiting.holdings.right')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => {
              const figure = newFigureFor(one.holdingId)
              navigate(figure.to, { state: figure.state })
            }}
          >
            {t('home.waiting.holdings.newFigure')}
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
  title: ReactNode
  why: string
  negative?: boolean
  bulk?: ReactNode
  rows?: readonly ReactNode[]
  children?: ReactNode
}) {
  const t = useT()
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
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {bulk}
          {children}
        </span>
      </div>
      {shown !== undefined && shown.length > 0 && <div className="ps-5">{shown}</div>}
      {rows !== undefined && rows.length > 3 && (
        <div className="pb-2.5 ps-5">
          <Button variant="ghost" size="sm" onClick={() => setAll((current) => !current)}>
            {all ? t('home.waiting.fewer') : t('home.waiting.more', { count: rows.length - 3 })}
          </Button>
        </div>
      )}
    </div>
  )
}

