import { useState } from 'react'

import { formatMoney, fromMajorUnits, type Money } from '@/core/money.ts'
import { formatMonthShort, toISODate, type LocalDate } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import { debtsClaiming, trackingOffer, type TrackingOffer } from '@/domain/debt.ts'
import type { MerchantBillProposal } from '@/domain/fixedExpenses.ts'
import type { MerchantGroup } from '@/domain/merchantGroups.ts'
import type { Debt } from '@/domain/model/debt.ts'
import { CADENCES, type AmountVariability, type Cadence } from '@/domain/model/fixed.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { TRACK_KIND_LABEL } from '@/ui/debts/labels.ts'
import { CADENCE_LABEL } from '@/ui/fixed/labels.ts'

/** What confirming the bill half would write. The screen turns this into a row. */
export interface BillPromotion {
  readonly name: string
  readonly expectedAmount: Money
  readonly amountVariability: AmountVariability
  readonly cadence: Cadence
  readonly dayOfMonthHint: number
  /** The first of the earliest month seen — the cadence anchor, never the charge's day. */
  readonly startedAt: LocalDate | undefined
  readonly categoryId: string | undefined
}

/**
 * "What is this?" for one name in the labeling queue — docs/f06's two
 * promotions, which have been prose since M5.
 *
 * The queue's whole premise is **one decision per counterparty, covering every
 * past and future occurrence**, and both promotions keep it. A bill is a
 * `FixedExpense` matched on this merchant, so next month's charge is the same
 * bill without anyone saying so again. A debt payment points a debt's tracking
 * at the name and lets discovery find the charges — past ones now, future ones
 * at every import. Neither writes a payment or a category behind the user's
 * back, and both say what they did.
 *
 * **The bill half is the user adding one by hand, seeded** — not a detection.
 * `detectFixedExpenses` refuses a single occurrence on purpose, because every
 * one-off purchase in the ledger looks exactly like one; here the user has
 * already answered that question, so what is left is arithmetic over the charges
 * offered as a proposal. Where the gaps read as a cadence the panel says so and
 * fills the select in; where they do not it says **whose answer** the select
 * holds, because a default that looks like a finding is the failure D-138 keeps
 * turning up.
 *
 * **The debt half writes no payment**, and that is the part worth stating twice.
 * It sets `MERCHANT_PATTERN` tracking and runs discovery, so what appears is a
 * queue of *unconfirmed* payments on the debts screen — they count towards the
 * balance and wait for an answer. docs/f08 requires a debt told to track
 * something to be told that; this is where the sentence goes.
 */
export function PromotionPanel({
  group,
  proposal,
  categories,
  categoryPath,
  debts,
  trackedByExpense,
  suggestedCategoryId,
  onBill,
  onDebt,
  onDismiss,
}: {
  group: MerchantGroup
  /** What the ledger says about this name. Absent when nothing outgoing is left. */
  proposal: MerchantBillProposal | undefined
  categories: readonly Category[]
  categoryPath: (categoryId: string) => string | undefined
  /** The open debts. Closed ones take no new payments and are not offered. */
  debts: readonly Debt[]
  /** A live fixed expense already matching this merchant, if there is one. */
  trackedByExpense: string | undefined
  /** What the row already proposes — the dominant or suggested category. */
  suggestedCategoryId: string | undefined
  onBill: (promotion: BillPromotion) => void
  onDebt: (debtId: string) => void
  onDismiss: () => void
}) {
  const [mode, setMode] = useState<'BILL' | 'DEBT'>('BILL')

  return (
    <section
      aria-label={`What is ${group.merchantRaw}`}
      className="fc-pop-enter shrink-0 border-b border-hairline bg-surface px-6 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Bidi className="font-medium">{group.merchantRaw}</Bidi>
        <span className="text-caption text-ink-tertiary tabular-nums">
          {group.count} {group.count === 1 ? 'charge waiting' : 'charges waiting'}
          {proposal !== undefined && proposal.months.length > 0 && (
            <>
              {' · '}
              {formatMonthShort(proposal.firstSeen)}
              {proposal.months.length > 1 && <> → {formatMonthShort(proposal.lastSeen)}</>}
            </>
          )}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Tab active={mode === 'BILL'} onClick={() => setMode('BILL')}>
            A bill that repeats
          </Tab>
          <Tab active={mode === 'DEBT'} onClick={() => setMode('DEBT')}>
            A payment on a debt
          </Tab>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Close
          </Button>
        </div>
      </div>

      {mode === 'BILL' ? (
        <BillForm
          group={group}
          proposal={proposal}
          categories={categories}
          categoryPath={categoryPath}
          trackedByExpense={trackedByExpense}
          claimedByDebts={debtsClaiming(debts, group.merchantNormalized)}
          suggestedCategoryId={suggestedCategoryId}
          onSubmit={onBill}
        />
      ) : (
        <DebtForm group={group} debts={debts} onSubmit={onDebt} />
      )}
    </section>
  )
}

/**
 * The bill half.
 *
 * Amount and cadence are editable before anything is written, for the reason
 * `CandidateCard` gives: the median is a proposal, and the moment the user knows
 * it is wrong is while they are looking at the months it came from.
 *
 * The category is **optional and consequential**, so the panel says which. Left
 * empty, the charges stay uncategorized and this name is still in the queue
 * tomorrow — a fixed expense is a bill the app watches for, not a filing
 * decision, and pretending one implies the other would put rows in a category
 * nobody chose (D-009).
 *
 * A name a debt already claims gets the double-count warning here rather than
 * only on the debts screen. `debtFixedExpenseOverlaps` catches the state after
 * the fact and prints it beside the monthly figure; this panel is where the two
 * answers are now **one click apart**, so it says so before the second click
 * rather than after.
 */
function BillForm({
  group,
  proposal,
  categories,
  categoryPath,
  trackedByExpense,
  claimedByDebts,
  suggestedCategoryId,
  onSubmit,
}: {
  group: MerchantGroup
  proposal: MerchantBillProposal | undefined
  categories: readonly Category[]
  categoryPath: (categoryId: string) => string | undefined
  trackedByExpense: string | undefined
  /** Debts whose tracking already turns these charges into repayments. */
  claimedByDebts: readonly Debt[]
  suggestedCategoryId: string | undefined
  onSubmit: (promotion: BillPromotion) => void
}) {
  const [name, setName] = useState(group.merchantRaw)
  const [amountText, setAmountText] = useState(
    proposal === undefined ? '' : formatMoney(proposal.medianAmount, { symbol: false }),
  )
  const [cadence, setCadence] = useState<Cadence>(proposal?.cadence ?? 'MONTHLY')
  const [categoryId, setCategoryId] = useState<string | undefined>(suggestedCategoryId)

  if (trackedByExpense !== undefined) {
    return (
      <p className="mt-2 text-ink-secondary">
        <span className="text-ink">{trackedByExpense}</span> already watches this name on Plan’s
        bills, so there is nothing to add. Giving these charges a category is still worth doing —
        a bill does not file them.
      </p>
    )
  }

  if (proposal === undefined) {
    return (
      <p className="mt-2 text-ink-secondary">
        Nothing outgoing under this name, so there is no amount to propose. A refund or a credit is
        not a bill; add one by hand on Plan’s bills if you know one is coming.
      </p>
    )
  }

  const parsed = parseAmountText(amountText)
  const amount =
    parsed === undefined ? undefined : fromMajorUnits(Math.abs(parsed), proposal.currency)
  const ready = name.trim() !== '' && amount !== undefined && amount.minor > 0

  return (
    <>
      <p className="mt-1.5 text-caption text-ink-tertiary tabular-nums">
        {proposal.months.length === 1 ? (
          <>
            Seen once, in {formatMonthShort(proposal.firstSeen)} — so{' '}
            <span className="text-ink-secondary">how often is your answer, not the app's</span>.
          </>
        ) : (
          <>
            {proposal.months.length} months · median {formatMoney(proposal.medianAmount)}
            {proposal.amountVariability === 'VARIABLE' && <> · the amount moves</>} · usually the{' '}
            {proposal.dayOfMonthHint}
            {ordinal(proposal.dayOfMonthHint)}
            {proposal.dayOfMonthSpread > 0 && <> ± {proposal.dayOfMonthSpread}d</>}
            {' · '}
            {proposal.cadence === undefined ? (
              <span className="text-ink-secondary">
                the gaps do not read as a cycle, so how often is your answer
              </span>
            ) : (
              <>the gaps read as {CADENCE_LABEL[proposal.cadence].toLocaleLowerCase()}</>
            )}
            {' · last '}
            {toISODate(proposal.lastSeen)}
          </>
        )}
      </p>

      {claimedByDebts.length > 0 && (
        <p className="mt-1 text-caption text-ink-tertiary">
          {claimedByDebts.map((debt) => debt.name).join(', ')} already counts these charges as
          repayments. Tracking them as a bill as well subtracts the same money twice — the debts
          screen leaves such a debt out of its monthly figure and says why, and this is the same
          money seen from the other side.
        </p>
      )}

      {proposal.otherCurrencies.length > 0 && (
        <p className="mt-1 text-caption text-ink-tertiary">
          Only the {proposal.currency} charges are counted. This name also bills in{' '}
          {proposal.otherCurrencies.join(', ')}, and there is no rate in this document to add them
          together with.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">Call it</span>
          <input
            className={`${FIELD} w-56`}
            dir="auto"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">Expect</span>
          <input
            className={`${FIELD} w-28 text-right tabular-nums`}
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-label={`Expected amount in ${proposal.currency}`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">How often</span>
          <select
            className={`${SELECT} text-body`}
            value={cadence}
            onChange={(event) => setCadence(event.target.value as Cadence)}
          >
            {CADENCES.map((one) => (
              <option key={one} value={one}>
                {CADENCE_LABEL[one]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">
            Category <span className="normal-case">(optional)</span>
          </span>
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            label={`Category for all ${group.count} charges at ${group.merchantRaw}`}
          />
        </div>

        <Button
          variant="primary"
          size="sm"
          disabled={!ready}
          onClick={() => {
            if (amount === undefined) return
            onSubmit({
              name: name.trim(),
              expectedAmount: amount,
              amountVariability: proposal.amountVariability,
              cadence,
              dayOfMonthHint: proposal.dayOfMonthHint,
              startedAt: anchorOf(proposal),
              categoryId,
            })
          }}
        >
          Track it as a bill
        </Button>
      </div>

      <p className="mt-2 text-caption text-ink-tertiary">
        It joins the bills, matched on this merchant, and the plan counts it against net.
        {categoryId === undefined ? (
          <>
            {' '}
            The {group.count === 1 ? 'charge keeps' : 'charges keep'} no category, so this name is
            still in the queue afterwards.
          </>
        ) : (
          <>
            {' '}
            The {group.count === 1 ? 'charge goes' : `${group.count} charges go`} into{' '}
            {categoryPath(categoryId) ?? 'that category'} at the same time.
          </>
        )}
      </p>
    </>
  )
}

/**
 * The debt half.
 *
 * A debt is chosen, never created: docs/f08 refuses a payment naming a debt that
 * does not exist rather than inventing one, and the same refusal is right here —
 * a debt has a principal and an opened date that no charge can supply.
 *
 * Each debt carries the sentence `trackingOffer` produced, because pointing a
 * debt at a name can take a live mechanism away, and the moment to say so is
 * before the select is used rather than after the balance moves.
 */
function DebtForm({
  group,
  debts,
  onSubmit,
}: {
  group: MerchantGroup
  debts: readonly Debt[]
  onSubmit: (debtId: string) => void
}) {
  const offers = debts.map((debt) => ({
    debt,
    offer: trackingOffer(debt, group.merchantNormalized),
  }))
  const offerable = offers.filter((one) => one.offer.kind !== 'REFUSED')
  const claiming = offers.filter((one) => one.offer.kind === 'ALREADY')
  const [debtId, setDebtId] = useState(offerable[0]?.debt.id ?? '')

  if (offerable.length === 0) {
    return (
      <p className="mt-2 text-ink-secondary">
        {debts.length === 0
          ? 'No open debt to point this at. Create one on Debts first — a charge cannot say what was borrowed, or when.'
          : 'Every open debt here tracks the slices of a split purchase, and replacing that would orphan the slices already found. Add a debt for this loan on Debts.'}
      </p>
    )
  }

  const chosen = offerable.find((one) => one.debt.id === debtId)

  return (
    <>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">Pays</span>
          <select
            className={`${SELECT} max-w-xs text-body`}
            value={debtId}
            onChange={(event) => setDebtId(event.target.value)}
          >
            {offerable.map((one) => (
              <option key={one.debt.id} value={one.debt.id}>
                {one.debt.name}
              </option>
            ))}
          </select>
        </label>

        <Button
          variant="primary"
          size="sm"
          disabled={chosen === undefined || chosen.offer.kind === 'ALREADY'}
          onClick={() => onSubmit(debtId)}
        >
          Point it at this name
        </Button>

        {chosen !== undefined && chosen.offer.kind === 'REPLACES' && (
          <Chip>replaces {TRACK_KIND_LABEL[chosen.offer.current.kind].toLocaleLowerCase()}</Chip>
        )}
      </div>

      {chosen !== undefined && <p className="mt-2 text-ink-secondary">{sentence(chosen.offer)}</p>}

      {claiming.length > 0 && chosen?.offer.kind !== 'ALREADY' && (
        <p className="mt-1 text-caption text-ink-tertiary">
          {claiming.map((one) => one.debt.name).join(', ')} already covers these charges. A second
          debt pointed at the same name turns every one of them into a question rather than a
          payment — the app will not guess between two debts.
        </p>
      )}

      <p className="mt-2 text-caption text-ink-tertiary">
        Nothing is paid off by this. It sets what the debt watches for; discovery then runs now and
        at every import, and what it finds waits{' '}
        <span className="text-ink-secondary">unconfirmed</span> in the review queue on Debts —
        counting towards the balance until you answer it.
      </p>
    </>
  )
}

/** What agreeing would do to this debt, in one sentence. */
function sentence(offer: TrackingOffer): string {
  switch (offer.kind) {
    case 'FREE':
      return 'This debt watches for nothing at the moment, so nothing is taken away.'
    case 'ALREADY':
      return `This debt already matches “${offer.pattern}”, which covers these charges — they are found already, or waiting in its review queue.`
    case 'REPLACES':
      return offer.current.kind === 'MERCHANT_PATTERN'
        ? `It watches for “${offer.current.pattern}” today. That goes, and charges under this name take its place — payments already found stay where they are.`
        : 'It watches a category today. That goes, and charges under this name take its place — payments already found stay where they are.'
    case 'REFUSED':
      return offer.reason === 'CLOSED'
        ? 'This debt is closed and takes no new payments.'
        : 'This debt tracks the slices of one split purchase, and those slices would stop being found.'
  }
}

/**
 * The cadence anchor: the first of the earliest month seen, never the charge's
 * own day — which months a non-monthly bill lands in is counted from it, and the
 * day it lands on is `dayOfMonthHint`. The call `confirmCandidate` makes.
 */
function anchorOf(proposal: MerchantBillProposal): LocalDate | undefined {
  const first = proposal.months[0]
  return first === undefined
    ? undefined
    : { year: first.period.year, month: first.period.month, day: 1 }
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-caption ${
        active ? 'bg-elevated text-ink' : 'text-ink-tertiary hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th'
  return { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th'
}
