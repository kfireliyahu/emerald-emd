import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { formatMoney, fromMajorUnits, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { formatMonthShort, toISODate } from '@/core/time.ts'
import { DEFAULT_FEE_REFERENCES } from '@/data/reference/fundFeeReference.ts'
import {
  expectedContributionsFor,
  listFundsWithLatest,
} from '@/data/repositories/fundRepository.ts'
import {
  DEFAULT_GROSS_RETURN_SCENARIOS,
  feeDragIllustration,
  recentContributionRate,
  type ContributionRate,
} from '@/domain/funds.ts'
import type { FeeReference, FundAccount, FundFees } from '@/domain/model/funds.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { CountingAmount } from '@/ui/components/Amount.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { FUND_TYPE_LABEL } from '@/ui/funds/labels.ts'

/**
 * What the management fee costs over a working life — docs/f13's fee-impact
 * screen, and the number the whole feature exists to make someone pick up the
 * phone about.
 *
 * **Every assumption is on the screen and every one of them moves.** That is
 * F13's last acceptance criterion, and it is the reason this is a screen of
 * sliders rather than a report: a projection whose inputs are hidden is a
 * prediction, and this app has no business making one. `feeDragIllustration`
 * hands back every input it was given (D-066) precisely so the screen cannot
 * print an answer without the assumption that produced it.
 *
 * **The answer is a range, never a number.** Three assumed gross returns, each
 * with its own column and its own editable rate. The headline is the spread
 * between the cheapest and dearest of them, because "somewhere between ₪90,000
 * and ₪310,000, depending on what markets do" is the true shape of the answer
 * and a single figure would be a forecast wearing a fee's clothes.
 *
 * **The projected balance is broken into its three parts** (D-082): what you pay
 * in, what that earns, and what the fee takes out of it. Added because the
 * screen was answering "what is the fee worth" without ever answering "what am I
 * projected to have", which is the question a reader has first — and because a
 * fee cost stated beside a balance nobody can decompose is a figure taken on
 * trust. The three are an identity in the domain, not three estimates.
 *
 * **What it starts from is read off the document, and it says so.** The opening
 * balance is the fund's own latest reading, the contribution is a year of
 * payslips annualized, and the current fee is what the user told the app the
 * policy says. Each figure names its source underneath, so a wrong answer can be
 * traced to the wrong input rather than doubted whole.
 */
export function FeeImpact({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)

  const entries = useMemo(() => (db === undefined ? [] : listFundsWithLatest(db)), [db, revision])
  const [chosenId, setChosenId] = useState<string | undefined>()
  // Bumped by "Start over", which is a remount rather than a reset: the sliders
  // hold their own state and re-deriving the defaults is exactly what mounting
  // does.
  const [attempt, setAttempt] = useState(0)

  const selected = entries.find((entry) => entry.fund.id === chosenId) ?? entries[0]
  const currency: CurrencyCode = selected?.latest?.totalBalance.currency ?? 'ILS'

  const rate = useMemo(
    () =>
      db === undefined || selected === undefined
        ? undefined
        : recentContributionRate(expectedContributionsFor(db, selected.fund.id), currency),
    [db, revision, selected?.fund.id, currency],
  )

  if (db === undefined) {
    return <Centered>Open a document to see what a fund's fees cost.</Centered>
  }

  if (selected === undefined) {
    return (
      <Centered>
        No funds yet. <Link to="/wealth/funds" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">Add one</Link>{' '}
        with its management fee, and this screen will show what that fee costs over the years you
        hold it.
      </Centered>
    )
  }

  return (
    <div className={embedded ? 'flex flex-col' : 'flex h-full flex-col'}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2">
        <label className="flex items-center gap-2 text-ink-secondary">
          Fund
          <select
            className={`${SELECT} max-w-72`}
            value={selected.fund.id}
            onChange={(event) => setChosenId(event.target.value)}
          >
            {entries.map((entry) => (
              <option key={entry.fund.id} value={entry.fund.id}>
                {entry.fund.name}
              </option>
            ))}
          </select>
        </label>

        <Link
          to={`/wealth/funds/${selected.fund.id}`}
          className="text-ink-secondary underline-offset-4 hover:underline"
        >
          Open the fund
        </Link>

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setAttempt((count) => count + 1)}
        >
          Start over
        </Button>
      </div>

      <div className={embedded ? 'px-6 py-4' : 'min-h-0 flex-1 overflow-auto px-6 py-4'}>
        <Illustration
          key={`${selected.fund.id}:${String(attempt)}`}
          fund={selected.fund}
          currency={currency}
          balance={selected.latest?.totalBalance}
          balanceAsOf={
            selected.latest === undefined ? undefined : toISODate(selected.latest.asOfDate)
          }
          rate={rate}
          reference={DEFAULT_FEE_REFERENCES.find(
            (one) => one.fundType === selected.fund.fundType,
          )}
        />
      </div>
    </div>
  )
}

/** The default horizon: long enough to compound, short of a whole career. */
const DEFAULT_YEARS = 25

/** 20% a year. Above this the projection stops being an illustration of anything. */
const MAX_RETURN_BASIS_POINTS = 2_000

interface Assumptions {
  readonly openingBalance: Money
  readonly annualContribution: Money
  readonly years: number
  readonly current: FundFees
  readonly target: FundFees
  readonly returns: readonly number[]
}

/**
 * The sliders and what they produce.
 *
 * Mounted with a key, so choosing another fund re-derives every default rather
 * than leaving the last fund's balance under a new fund's name — which would be
 * the most confidently wrong thing this screen could do.
 */
function Illustration({
  fund,
  currency,
  balance,
  balanceAsOf,
  rate,
  reference,
}: {
  fund: FundAccount
  currency: CurrencyCode
  balance: Money | undefined
  balanceAsOf: string | undefined
  rate: ContributionRate | undefined
  reference: FeeReference | undefined
}) {
  const [assumptions, setAssumptions] = useState<Assumptions>(() =>
    defaults(fund, currency, balance, rate, reference),
  )
  const set = (change: Partial<Assumptions>): void =>
    setAssumptions((current) => ({ ...current, ...change }))

  const result = feeDragIllustration({
    openingBalance: assumptions.openingBalance,
    annualContribution: assumptions.annualContribution,
    years: assumptions.years,
    currentFees: assumptions.current,
    targetFees: assumptions.target,
    grossReturnBasisPoints: assumptions.returns,
  })

  // A rate the provider agreed in writing is drawn apart from the three assumed ones (M28 U8, S6):
  // it is a fact about this fund and they are guesses, so it gets its own block and no slider.
  const agreedBasisPoints = fund.agreedReturnBasisPoints
  const agreed =
    agreedBasisPoints === undefined
      ? undefined
      : feeDragIllustration({
          openingBalance: assumptions.openingBalance,
          annualContribution: assumptions.annualContribution,
          years: assumptions.years,
          currentFees: assumptions.current,
          targetFees: assumptions.target,
          grossReturnBasisPoints: [agreedBasisPoints],
        }).scenarios[0]

  const differences = result.scenarios.map((scenario) => scenario.difference.minor)
  const low = money(Math.min(...differences), currency)
  const high = money(Math.max(...differences), currency)
  // A target fee *above* the current one is a legitimate question — "what if my
  // agreement lapses?" — and it turns every figure here negative. The range is
  // printed signed rather than as a magnitude with a reassuring label, because
  // the sign is the whole meaning.
  const costly = high.minor < 0

  const step = (major: number): number => fromMajorUnits(major, currency).minor
  // Every slider's ceiling comes from what the document says, never from the
  // live value: a maximum derived from the current position runs away from the
  // thumb as it is dragged, and one that clamps below the prefill would move a
  // figure the user never touched.
  const bounds = {
    balance: Math.max(step(2_000_000), (balance?.minor ?? 0) * 2),
    contribution: Math.max(step(200_000), (rate?.annual.minor ?? 0) * 2),
    accumulationFee: feeSliderMax(reference?.capOnAccumulationBasisPoints ?? 105, fund.fees.onAccumulationBasisPoints),
    depositFee: feeSliderMax(reference?.capOnDepositBasisPoints ?? 600, fund.fees.onDepositBasisPoints),
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <Figure
          label="What the fee difference is worth"
          hint={`over ${String(assumptions.years)} years, across the three returns below`}
        >
          {/* Every slider on this screen moves these two, so they count
              (docs/11). The two ends of the range animate independently and
              that is correct: they are two projections, not one figure with a
              width. */}
          <span className="text-hero tabular-nums">
            {low.minor === high.minor ? (
              <CountingAmount value={low} />
            ) : (
              <>
                <CountingAmount value={low} /> – <CountingAmount value={high} />
              </>
            )}
          </span>
        </Figure>

        <Figure label={FUND_TYPE_LABEL[fund.fundType]} hint={fund.employerName ?? ''}>
          <Bidi className="text-secondary-number text-ink-secondary">{fund.name}</Bidi>
        </Figure>
      </div>

      <p className="mt-3 max-w-2xl text-caption text-ink-tertiary">
        An illustration, not a prediction. Nothing here forecasts what this fund will earn — it
        compounds the assumptions below and shows what the difference between two fees does to
        them. Every one of those assumptions is yours to change.
        {/* A zero here has three different meanings and none of them is "your
            fee costs nothing". Each says which one it is — the same rule the
            rest of F13 follows about a figure with nothing behind it. */}
        {whyThatFigure(assumptions, fund, costly) !== undefined && (
          <> {whyThatFigure(assumptions, fund, costly)}</>
        )}
      </p>

      <Section title="The two fees">
        {fund.fees.onAccumulationBasisPoints === undefined && (
          <p className="mb-3 max-w-2xl text-caption text-ink-tertiary">
            This fund has no fee recorded, so the "today" figures below start from what is usually
            negotiated rather than from yours.{' '}
            <Link
              to={`/wealth/funds/${fund.id}`}
              className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover"
            >
              Add the fee from your report
            </Link>{' '}
            and this becomes about your own money.
          </p>
        )}

        <div className="grid max-w-4xl grid-cols-1 gap-x-12 gap-y-5 sm:grid-cols-2">
          <RateSlider
            label="Today, on the balance"
            hint="דמי ניהול מהצבירה — taken every year on everything you hold"
            basisPoints={assumptions.current.onAccumulationBasisPoints ?? 0}
            max={bounds.accumulationFee}
            onChange={(value) =>
              set({ current: { ...assumptions.current, onAccumulationBasisPoints: value } })
            }
          />
          <RateSlider
            label="If you negotiated it, on the balance"
            hint={
              reference === undefined
                ? 'the fee you think you could get'
                : `usually negotiated: ${formatPercent(reference.typicalOnAccumulationBasisPoints, { digits: 2 })}`
            }
            basisPoints={assumptions.target.onAccumulationBasisPoints ?? 0}
            max={bounds.accumulationFee}
            onChange={(value) =>
              set({ target: { ...assumptions.target, onAccumulationBasisPoints: value } })
            }
          />
          <RateSlider
            label="Today, on each deposit"
            hint="דמי ניהול מהפקדה — taken before the money is ever invested"
            basisPoints={assumptions.current.onDepositBasisPoints ?? 0}
            max={bounds.depositFee}
            step={5}
            onChange={(value) =>
              set({ current: { ...assumptions.current, onDepositBasisPoints: value } })
            }
          />
          <RateSlider
            label="If you negotiated it, on each deposit"
            hint={
              reference === undefined
                ? 'the fee you think you could get'
                : `usually negotiated: ${formatPercent(reference.typicalOnDepositBasisPoints, { digits: 2 })}`
            }
            basisPoints={assumptions.target.onDepositBasisPoints ?? 0}
            max={bounds.depositFee}
            step={5}
            onChange={(value) =>
              set({ target: { ...assumptions.target, onDepositBasisPoints: value } })
            }
          />
        </div>

        {reference !== undefined && (
          <p className="mt-4 max-w-2xl text-caption text-ink-tertiary">
            The ceiling for a {FUND_TYPE_LABEL[fund.fundType].toLowerCase()} is{' '}
            {formatPercent(reference.capOnAccumulationBasisPoints, { digits: 2 })} on the balance and{' '}
            {formatPercent(reference.capOnDepositBasisPoints, { digits: 2 })} on deposits. Those are
            the app's shipped figures as of {toISODate(reference.asOf)} — check them against the
            regulator before acting on them.
          </p>
        )}
      </Section>

      <Section title="What it is projected against">
        <div className="grid max-w-4xl grid-cols-1 gap-x-12 gap-y-5 sm:grid-cols-2">
          <AmountSlider
            label="Starting balance"
            hint={
              balance === undefined
                ? 'no reading yet — this fund has no balance on record, so it starts at nothing'
                : `your reading of ${balanceAsOf ?? ''}`
            }
            amount={assumptions.openingBalance}
            max={bounds.balance}
            step={step(10_000)}
            onChange={(value) => set({ openingBalance: value })}
          />
          <AmountSlider
            label="Paid in each year"
            hint={contributionHint(rate)}
            amount={assumptions.annualContribution}
            max={bounds.contribution}
            step={step(1_000)}
            onChange={(value) => set({ annualContribution: value })}
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-label text-ink-tertiary uppercase">For how long</span>
              <span className="tabular-nums">
                {assumptions.years} {assumptions.years === 1 ? 'year' : 'years'}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={45}
              step={1}
              value={assumptions.years}
              onChange={(event) => set({ years: Number(event.target.value) })}
              aria-label="Years"
              className="w-full accent-[var(--color-ink)]"
            />
            <span className="text-caption text-ink-tertiary">
              until you draw on it — a pension is decades, a study fund is years
            </span>
          </div>
        </div>
      </Section>

      <Section title="What the difference is worth">
        <div className="grid max-w-4xl grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-3">
          {result.scenarios.map((scenario, index) => (
            <div key={index} className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-label text-ink-tertiary uppercase">
                <input
                  type="number"
                  className={`${FIELD} w-20 text-right tabular-nums`}
                  value={scenario.grossReturnBasisPoints / 100}
                  min={0}
                  max={20}
                  step={0.25}
                  onChange={(event) => {
                    const typed = Number(event.target.value)
                    if (!Number.isFinite(typed)) return
                    // Clamped, and not only for taste: 500% compounded over 45
                    // years leaves the safe-integer range, and `money` throws
                    // rather than quietly rounding — which would take the screen
                    // down over a typo.
                    const clamped = Math.min(MAX_RETURN_BASIS_POINTS, Math.max(0, Math.round(typed * 100)))
                    set({
                      returns: assumptions.returns.map((existing, position) =>
                        position === index ? clamped : existing,
                      ),
                    })
                  }}
                  aria-label={`Assumed gross return ${String(index + 1)}`}
                />
                a year, before fees
              </label>

              {/* This column's own answer, and the third figure a slider moves.
                  The decomposition below it does not count: three more counters
                  under every column is the excess docs/11 warns about, and those
                  lines are read after the drag has stopped rather than during
                  it. */}
              <CountingAmount
                value={scenario.difference}
                className={`text-secondary-number ${
                  scenario.difference.minor < 0 ? 'text-negative' : ''
                }`}
              />

              {/* The bar is the fee, drawn: the full width is what the balance
                  reaches at the lower fee and the gap at the end is what the
                  higher one took. Geometry, so a rounding error is a fraction of
                  a pixel — every figure beside it is integer minor units. */}
              <FeeBar reached={scenario.atCurrentFees} could={scenario.atTargetFees} />

              <span className="text-caption text-ink-tertiary tabular-nums">
                {formatMoney(scenario.atCurrentFees)} → {formatMoney(scenario.atTargetFees)}
              </span>

              {/* What the first of those two figures is made of. The fee
                  argument is a comparison, but a comparison of two numbers
                  nobody can decompose is a number to take on trust — and the
                  three parts here are an identity, not three estimates
                  (D-082). */}
              <dl className="mt-2 flex flex-col gap-0.5 border-t border-hairline pt-2 text-caption text-ink-tertiary">
                <Part label="you pay in" amount={scenario.paidIn} />
                <Part label="it earns" amount={scenario.grossGrowth} />
                <Part
                  label="the fee takes"
                  amount={money(-scenario.feesTaken.minor, scenario.feesTaken.currency)}
                />
              </dl>
            </div>
          ))}
        </div>

        {agreed !== undefined && agreedBasisPoints !== undefined && (
          <div className="mt-6 flex max-w-4xl flex-col gap-2 border-t border-hairline pt-4">
            <span className="text-label text-ink-tertiary uppercase">
              At the return the provider agreed: {formatPercent(agreedBasisPoints, { digits: 2 })} a year,
              before fees
            </span>
            <span className="text-caption text-ink-secondary">
              Written in the contract, not assumed, so it is shown apart from the three above.
            </span>
            <CountingAmount
              value={agreed.difference}
              className={`text-secondary-number ${agreed.difference.minor < 0 ? 'text-negative' : ''}`}
            />
            <span className="text-caption text-ink-tertiary tabular-nums">
              {formatMoney(agreed.atCurrentFees)} → {formatMoney(agreed.atTargetFees)}
            </span>
          </div>
        )}

        <p className="mt-5 max-w-2xl text-caption text-ink-tertiary">
          The three lines under each figure add up to it. What the fee takes is measured against
          the same projection with no fee at all, not against the fee charged — a charge on the
          balance is taken out of money that would have gone on compounding, so what it costs over{' '}
          {assumptions.years} years is a multiple of what appears on any one statement.
        </p>

        <p className="mt-5 max-w-2xl text-caption text-ink-tertiary">
          Read as: with {formatMoney(assumptions.openingBalance)} today and{' '}
          {formatMoney(assumptions.annualContribution)} paid in a year for {assumptions.years}{' '}
          years, moving the fee from{' '}
          {formatPercent(assumptions.current.onAccumulationBasisPoints, { digits: 2 })} to{' '}
          {formatPercent(assumptions.target.onAccumulationBasisPoints, { digits: 2 })} on the
          balance and from{' '}
          {formatPercent(assumptions.current.onDepositBasisPoints, { digits: 2 })} to{' '}
          {formatPercent(assumptions.target.onDepositBasisPoints, { digits: 2 })} on each deposit
          is worth the figures above. Returns are assumed to arrive evenly and are the same in
          every year, which no real fund manages.
        </p>
      </Section>
    </>
  )
}

/** One line of the decomposition: what it is, and how much of the answer it is. */
function Part({ label, amount }: { label: string; amount: Money }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(amount)}</dd>
    </div>
  )
}

/**
 * Why the headline says what it says, when what it says is not self-evident.
 *
 * Three states produce a figure that looks like a non-answer, and they are three
 * different facts: nothing to project against, two fees set to the same number,
 * and a target fee deliberately set higher than today's. Saying nothing would
 * leave all three looking like "your fee costs nothing", which is the one
 * reading that is never true.
 */
function whyThatFigure(
  assumptions: Assumptions,
  fund: FundAccount,
  costly: boolean,
): string | undefined {
  if (assumptions.openingBalance.minor === 0 && assumptions.annualContribution.minor === 0) {
    return 'It is ₪0.00 because there is nothing to project against yet: no balance and nothing paid in a year. Set either one below, or add a reading to the fund.'
  }

  const identical =
    assumptions.current.onAccumulationBasisPoints ===
      assumptions.target.onAccumulationBasisPoints &&
    assumptions.current.onDepositBasisPoints === assumptions.target.onDepositBasisPoints
  if (identical) {
    return fund.fees.onAccumulationBasisPoints === undefined
      ? 'It is ₪0.00 because both fees below start from the same figure, this fund having none recorded. Move one to see what a difference would be worth.'
      : 'It is ₪0.00 because both fees below are the same: this fund is already at or under what is usually negotiated, so there is nothing to compare it against until you move one.'
  }

  if (costly) {
    return 'The figure is negative because the fee you are comparing against is higher than the one you pay today: this is what letting it rise would cost.'
  }

  return undefined
}

/** Where the sliders start: this fund, this document, and the shipped reference. */
function defaults(
  fund: FundAccount,
  currency: CurrencyCode,
  balance: Money | undefined,
  rate: ContributionRate | undefined,
  reference: FeeReference | undefined,
): Assumptions {
  const typicalAccumulation = reference?.typicalOnAccumulationBasisPoints ?? 0
  const typicalDeposit = reference?.typicalOnDepositBasisPoints ?? 0

  // A fee that was never recorded starts at the typical one and the screen says
  // so. Starting from zero would show a saving of nothing; starting from the cap
  // would put a figure in the fund's mouth that no report ever printed.
  const current: FundFees = {
    onAccumulationBasisPoints: fund.fees.onAccumulationBasisPoints ?? typicalAccumulation,
    onDepositBasisPoints: fund.fees.onDepositBasisPoints ?? typicalDeposit,
  }

  // The target is what is usually negotiated — unless the user is already there
  // or better, in which case it starts *at* their fee and the illustration says
  // ₪0 until they move it. Anything else would invent a fee to be impressed by.
  const target: FundFees = {
    onAccumulationBasisPoints: Math.min(
      current.onAccumulationBasisPoints ?? 0,
      typicalAccumulation,
    ),
    onDepositBasisPoints: Math.min(current.onDepositBasisPoints ?? 0, typicalDeposit),
  }

  return {
    openingBalance: balance ?? money(0, currency),
    annualContribution: rate?.annual ?? money(0, currency),
    years: DEFAULT_YEARS,
    current,
    target,
    returns: DEFAULT_GROSS_RETURN_SCENARIOS,
  }
}

/**
 * Where the contribution came from, or that it came from nowhere.
 *
 * A fund with no payslips behind it starts at ₪0 a year and says why, rather
 * than at a plausible-looking number nobody entered (the mistake D-071 found on
 * the fund detail screen, in its other form).
 */
function contributionHint(rate: ContributionRate | undefined): string {
  if (rate === undefined) {
    return 'no paychecks feed this fund, so nothing is assumed — set what you pay in'
  }
  const span = `${formatMonthShort(rate.from)} to ${formatMonthShort(rate.to)}`
  return rate.monthsCounted >= 12
    ? `your paychecks for ${span}`
    : `${String(rate.monthsCounted)} months of paychecks (${span}), scaled to a year`
}

/**
 * Room above the cap, and always above the fee actually recorded.
 *
 * A pre-2013 managers' insurance policy can charge more than today's ceiling
 * (docs/f13), and a slider whose maximum sits below its own value would clamp
 * the fee the user entered — moving a figure they never touched.
 */
function feeSliderMax(cap: number, recorded: number | undefined): number {
  return Math.max(Math.ceil((cap * 1.5) / 25) * 25, recorded ?? 0)
}

/**
 * A money assumption, prefilled exactly and dragged in round numbers.
 *
 * **The rounding is in the handler, not in `step`.** A `step` of ₪10,000 makes
 * the control snap its *own* value to a multiple of it, so a balance of
 * ₪80,543.21 read off a report puts the thumb at ₪80,000 while the figure beside
 * it still says ₪80,543.21 — the slider and the number it is labelled with
 * quietly disagreeing, which is the one thing a control like this must never do.
 * So the input accepts every agora and the drag is quantized on the way out:
 * untouched, it is the reading; touched, it is a round number.
 */
function AmountSlider({
  label,
  hint,
  amount,
  max,
  step,
  onChange,
}: {
  label: string
  hint: string
  amount: Money
  max: number
  /** What a drag rounds to. Not the input's `step`; see above. */
  step: number
  onChange: (amount: Money) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-label text-ink-tertiary uppercase">{label}</span>
        <span className="tabular-nums">{formatMoney(amount)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={amount.minor}
        onChange={(event) =>
          onChange(money(quantize(Number(event.target.value), step), amount.currency))
        }
        aria-label={label}
        className="w-full accent-[var(--color-ink)]"
      />
      <span className="text-caption text-ink-tertiary">{hint}</span>
    </div>
  )
}

/** To the nearest `quantum`, and never below zero. */
function quantize(value: number, quantum: number): number {
  return Math.max(0, Math.round(value / quantum) * quantum)
}

function RateSlider({
  label,
  hint,
  basisPoints,
  max,
  step = 1,
  onChange,
}: {
  label: string
  hint: string
  basisPoints: number
  max: number
  /** What a drag rounds to. Not the input's `step` — see `AmountSlider`. */
  step?: number
  onChange: (basisPoints: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-label text-ink-tertiary uppercase">{label}</span>
        <span className="tabular-nums">{formatPercent(basisPoints, { digits: 2 })}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={basisPoints}
        onChange={(event) => onChange(quantize(Number(event.target.value), step))}
        aria-label={label}
        className="w-full accent-[var(--color-ink)]"
      />
      <span className="text-caption text-ink-tertiary">{hint}</span>
    </div>
  )
}

/**
 * Two balances as one bar: the full width is the larger of them, and the tail is
 * the difference between them.
 *
 * Drawn rather than only stated because the compounding is the point — the tail
 * is a fifth of the bar on a figure that sounds like a rounding error when it is
 * written as a percentage.
 */
function FeeBar({ reached, could }: { reached: Money; could: Money }) {
  const whole = Math.max(Math.abs(reached.minor), Math.abs(could.minor), 1)
  const filled = Math.max(0, Math.min(100, (Math.min(reached.minor, could.minor) / whole) * 100))

  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-surface"
      role="img"
      aria-label={`${formatMoney(reached)} against ${formatMoney(could)}`}
    >
      <div className="h-full bg-ink-tertiary" style={{ width: `${String(filled)}%` }} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-4 border-b border-hairline pb-2 text-label text-ink-tertiary uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Figure({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label text-ink-tertiary uppercase">{label}</span>
      {children}
      {hint !== undefined && hint !== '' && (
        <span className="text-caption text-ink-tertiary">{hint}</span>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
