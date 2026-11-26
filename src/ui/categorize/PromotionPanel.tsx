import { useState } from 'react'

import { formatMoney, fromMajorUnits, type Money } from '@/core/money.ts'
import { type LocalDate } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import { debtsClaiming, trackingOffer, type TrackingOffer } from '@/domain/debt.ts'
import type { MerchantBillProposal } from '@/domain/fixedExpenses.ts'
import type { MerchantGroup } from '@/domain/merchantGroups.ts'
import type { Debt } from '@/domain/model/debt.ts'
import { CADENCES, type AmountVariability, type Cadence } from '@/domain/model/fixed.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { MENU_MOST, ValueChoice } from '@/ui/components/ChoiceField.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'

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
 * fills the choice in; where they do not it says **whose answer** the choice
 * holds, because a default that looks like a finding is the failure D-138 keeps
 * turning up.
 *
 * **The debt half writes no payment**, and that is the part worth stating twice.
 * It sets `MERCHANT_PATTERN` tracking and runs discovery, so what appears is a
 * queue of *unconfirmed* payments on the debts screen — they count towards the
 * balance and wait for an answer. docs/f08 requires a debt told to track
 * something to be told that; this is where the sentence goes.
 *
 * **Its words are the catalogue's** (`merchants.promotion`, en and he; M64 F2):
 * a name, a pattern or a category path from the document sits in its sentence
 * through `Phrase`, isolated by `Bidi`.
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
  const t = useT()
  const dates = useDates()
  const [mode, setMode] = useState<'BILL' | 'DEBT'>('BILL')

  // **A form beside the list** (M64 U6, D-617, D-618): several fields, so it
  // opens in the side panel, the merchant its title and the panel's Close
  // (or Esc) the way out; it used to push the list down from above it.
  const waiting = t(countKey('merchants.promotion.waiting', group.count), { count: group.count })
  const kicker =
    proposal !== undefined && proposal.months.length > 0
      ? `${waiting} · ${
          proposal.months.length > 1
            ? t('merchants.promotion.span', { from: dates.monthShort(proposal.firstSeen), to: dates.monthShort(proposal.lastSeen) })
            : dates.monthShort(proposal.firstSeen)
        }`
      : waiting
  return (
    <SidePanel title={<Bidi>{group.merchantRaw}</Bidi>} kicker={kicker} onClose={onDismiss}>
      <div className="flex items-center gap-1" role="group" aria-label={t('merchants.promotion.whatIs', { name: group.merchantRaw })}>
        <Tab active={mode === 'BILL'} onClick={() => setMode('BILL')}>
          {t('merchants.promotion.bill')}
        </Tab>
        <Tab active={mode === 'DEBT'} onClick={() => setMode('DEBT')}>
          {t('merchants.promotion.debt')}
        </Tab>
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
    </SidePanel>
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
 *
 * **Enter saves it** (M64 F2): it is a form, and its button is its submit.
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
  const t = useT()
  const dates = useDates()
  const [name, setName] = useState(group.merchantRaw)
  const [amountText, setAmountText] = useState(
    proposal === undefined ? '' : formatMoney(proposal.medianAmount, { symbol: false }),
  )
  const [cadence, setCadence] = useState<Cadence>(proposal?.cadence ?? 'MONTHLY')
  const [categoryId, setCategoryId] = useState<string | undefined>(suggestedCategoryId)

  if (trackedByExpense !== undefined) {
    return (
      <p className="mt-2 text-ink-secondary">
        <Phrase text={t('merchants.promotion.tracked')} parts={{ name: <Bidi className="text-ink">{trackedByExpense}</Bidi> }} />
      </p>
    )
  }

  if (proposal === undefined) {
    return <p className="mt-2 text-ink-secondary">{t('merchants.promotion.nothingOut')}</p>
  }

  const parsed = parseAmountText(amountText)
  const amount =
    parsed === undefined ? undefined : fromMajorUnits(Math.abs(parsed), proposal.currency)
  const ready = name.trim() !== '' && amount !== undefined && amount.minor > 0
  const seen =
    proposal.months.length === 1
      ? t('merchants.promotion.seenOnce', { month: dates.monthShort(proposal.firstSeen) })
      : [
          t('merchants.promotion.seen', { count: proposal.months.length, median: formatMoney(proposal.medianAmount) }),
          ...(proposal.amountVariability === 'VARIABLE' ? [t('merchants.promotion.moves')] : []),
          proposal.dayOfMonthSpread > 0
            ? t('merchants.promotion.daySpread', { day: proposal.dayOfMonthHint, spread: proposal.dayOfMonthSpread })
            : t('merchants.promotion.day', { day: proposal.dayOfMonthHint }),
          proposal.cadence === undefined
            ? t('merchants.promotion.noCycle')
            : t('merchants.promotion.cycle', { cadence: t(`plan.fixed.cadence.${proposal.cadence}`).toLocaleLowerCase() }),
          t('merchants.promotion.last', { date: dates.dayMonth(proposal.lastSeen) }),
        ].join(' · ')
  const submit = (): void => {
    if (!ready || amount === undefined) return
    onSubmit({
      name: name.trim(),
      expectedAmount: amount,
      amountVariability: proposal.amountVariability,
      cadence,
      dayOfMonthHint: proposal.dayOfMonthHint,
      startedAt: anchorOf(proposal),
      categoryId,
    })
  }

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <p className="m-0 mt-1.5 text-caption text-ink-secondary tabular-nums">{seen}</p>

      {claimedByDebts.length > 0 && (
        <p className="m-0 mt-1 text-caption text-ink-secondary">
          <Phrase text={t('merchants.promotion.claimed')} parts={{ names: <Bidi>{claimedByDebts.map((debt) => debt.name).join(', ')}</Bidi> }} />
        </p>
      )}

      {proposal.otherCurrencies.length > 0 && (
        <p className="m-0 mt-1 text-caption text-ink-secondary">
          {t('merchants.promotion.otherCurrencies', { currency: proposal.currency, others: proposal.otherCurrencies.join(', ') })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-secondary uppercase">{t('merchants.promotion.callIt')}</span>
          <input
            className={`${FIELD} w-56`}
            dir="auto"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-secondary uppercase">{t('merchants.promotion.expect')}</span>
          <input
            className={`${FIELD} w-28 text-end tabular-nums`}
            dir="ltr"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-label={t('merchants.promotion.expectLabel', { currency: proposal.currency })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-secondary uppercase">{t('merchants.promotion.howOften')}</span>
          <ValueChoice
            value={cadence}
            choices={CADENCES.map((one) => ({ value: one, label: t(`plan.fixed.cadence.${one}`) }))}
            onChange={(next) => setCadence(next as Cadence)}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-label text-ink-secondary uppercase">{t('merchants.promotion.category')}</span>
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            label={t('merchants.promotion.categoryLabel', { name: group.merchantRaw })}
          />
        </div>

        <Button variant="primary" size="sm" type="submit" disabled={!ready}>
          {t('merchants.promotion.track')}
        </Button>
      </div>

      <p className="m-0 mt-2 text-caption text-ink-secondary">
        {t('merchants.promotion.joins')}{' '}
        {categoryId === undefined ? (
          t(countKey('merchants.promotion.keepsNone', group.count))
        ) : (
          <Phrase
            text={t(countKey('merchants.promotion.goesInto', group.count), { count: group.count })}
            parts={{ path: <Bidi>{categoryPath(categoryId) ?? t('merchants.promotion.thatCategory')}</Bidi> }}
          />
        )}
      </p>
    </form>
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
 * before the choice is made rather than after the balance moves. Enter saves it.
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
  const t = useT()
  const offers = debts.map((debt) => ({
    debt,
    offer: trackingOffer(debt, group.merchantNormalized),
  }))
  const offerable = offers.filter((one) => one.offer.kind !== 'REFUSED')
  const claiming = offers.filter((one) => one.offer.kind === 'ALREADY')
  const [debtId, setDebtId] = useState(offerable[0]?.debt.id ?? '')

  if (offerable.length === 0) {
    return <p className="mt-2 text-ink-secondary">{debts.length === 0 ? t('merchants.promotion.noDebt') : t('merchants.promotion.allSlices')}</p>
  }

  const chosen = offerable.find((one) => one.debt.id === debtId)
  const ready = chosen !== undefined && chosen.offer.kind !== 'ALREADY'

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSubmit(debtId)
      }}
    >
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-secondary uppercase">{t('merchants.promotion.pays')}</span>
          <ValueChoice
            className={`${SELECT} max-w-xs`}
            dir="auto"
            value={debtId}
            choices={offerable.map((one) => ({ value: one.debt.id, label: one.debt.name }))}
            filter={offerable.length > MENU_MOST}
            onChange={setDebtId}
          />
        </label>

        <Button variant="primary" size="sm" type="submit" disabled={!ready}>
          {t('merchants.promotion.point')}
        </Button>

        {chosen !== undefined && chosen.offer.kind === 'REPLACES' && (
          <Chip>{t('merchants.promotion.replaces', { what: t(`wealth.debtForm.track.${chosen.offer.current.kind}`).toLocaleLowerCase() })}</Chip>
        )}
      </div>

      {chosen !== undefined && (
        <p className="m-0 mt-2 text-ink-secondary">
          <OfferSentence offer={chosen.offer} />
        </p>
      )}

      {claiming.length > 0 && chosen?.offer.kind !== 'ALREADY' && (
        <p className="m-0 mt-1 text-caption text-ink-secondary">
          <Phrase text={t('merchants.promotion.claiming')} parts={{ names: <Bidi>{claiming.map((one) => one.debt.name).join(', ')}</Bidi> }} />
        </p>
      )}

      <p className="m-0 mt-2 text-caption text-ink-secondary">{t('merchants.promotion.nothingPaid')}</p>
    </form>
  )
}

/** What agreeing would do to this debt, in one sentence; a pattern is the document's, isolated. */
function OfferSentence({ offer }: { offer: TrackingOffer }) {
  const t = useT()
  switch (offer.kind) {
    case 'FREE':
      return <>{t('merchants.promotion.offer.FREE')}</>
    case 'ALREADY':
      return <Phrase text={t('merchants.promotion.offer.ALREADY')} parts={{ pattern: <Bidi>{offer.pattern}</Bidi> }} />
    case 'REPLACES':
      return offer.current.kind === 'MERCHANT_PATTERN' ? (
        <Phrase text={t('merchants.promotion.offer.REPLACES_PATTERN')} parts={{ pattern: <Bidi>{offer.current.pattern}</Bidi> }} />
      ) : (
        <>{t('merchants.promotion.offer.REPLACES_CATEGORY')}</>
      )
    case 'REFUSED':
      return <>{offer.reason === 'CLOSED' ? t('merchants.promotion.offer.CLOSED') : t('merchants.promotion.offer.SLICES')}</>
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
      className={`border-b-2 px-2 py-1 text-caption ${
        active ? 'border-accent text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
