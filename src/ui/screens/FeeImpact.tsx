import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { formatMoney, fromMajorUnits, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { toISODate } from '@/core/time.ts'
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
import { countKey } from '@/i18n/count.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { CountingAmount } from '@/ui/components/Amount.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { MENU_MOST, ValueChoice } from '@/ui/components/ChoiceField.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'

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
export function FeeImpact({
  embedded = false,
  fundId,
  panel = false,
}: {
  readonly embedded?: boolean
  /** The fund it opens on (M64 U10): the one whose fee was clicked. */
  readonly fundId?: string | undefined
  /** Inside the side panel: no padding of its own, and its columns by the panel's width, not the window's. */
  readonly panel?: boolean
} = {}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const t = useT()

  const entries = useMemo(() => (db === undefined ? [] : listFundsWithLatest(db)), [db, revision])
  const [chosenId, setChosenId] = useState<string | undefined>(fundId)
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
    return <Centered>{t('wealth.feeImpact.noDocument')}</Centered>
  }

  if (selected === undefined) {
    return (
      <Centered>
        <Phrase
          text={t('wealth.feeImpact.noFunds')}
          parts={{
            link: (
              <Link to="/wealth/funds" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
                {t('wealth.feeImpact.addOne')}
              </Link>
            ),
          }}
        />
      </Centered>
    )
  }

  return (
    <div className={`@container ${embedded || panel ? 'flex flex-col' : 'flex h-full flex-col'}`}>
      <div className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline py-2 ${panel ? '' : 'px-6'}`}>
        <label className="flex items-center gap-2 text-ink-secondary">
          {t('wealth.feeImpact.fund')}
          <ValueChoice
            className={`${SELECT} max-w-72`}
            value={selected.fund.id}
            choices={entries.map((entry) => ({ value: entry.fund.id, label: entry.fund.name }))}
            filter={entries.length > MENU_MOST}
            onChange={setChosenId}
          />
        </label>

        <Link
          to={`/wealth/funds/${selected.fund.id}`}
          className="text-ink-secondary underline-offset-4 hover:underline"
        >
          {t('wealth.feeImpact.open')}
        </Link>

        <Button
          variant="ghost"
          size="sm"
          className="ms-auto"
          onClick={() => setAttempt((count) => count + 1)}
        >
          {t('wealth.feeImpact.startOver')}
        </Button>
      </div>

      <div className={panel ? 'py-4' : embedded ? 'px-6 py-4' : 'min-h-0 flex-1 overflow-auto px-6 py-4'}>
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
  const t = useT()
  const dates = useDates()
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
          label={t('wealth.feeImpact.worth')}
          hint={t(countKey('wealth.feeImpact.worthHint', assumptions.years), { count: assumptions.years })}
        >
          {/* Every slider on this screen moves these two, so they count
              (docs/11). The two ends of the range animate independently and
              that is correct: they are two projections, not one figure with a
              width. */}
          <span className="text-hero whitespace-nowrap tabular-nums">
            {low.minor === high.minor ? (
              <CountingAmount value={low} />
            ) : (
              <>
                <CountingAmount value={low} /> – <CountingAmount value={high} />
              </>
            )}
          </span>
        </Figure>

        <Figure label={t(`wealth.kinds.fund.${fund.fundType}`)} hint={fund.employerName ?? ''}>
          <Bidi className="text-heading font-medium">{fund.name}</Bidi>
        </Figure>
      </div>

      <p className="mt-3 max-w-2xl text-caption text-ink-secondary">
        {t('wealth.feeImpact.illustration')}
        {/* A zero here has three different meanings and none of them is "your
            fee costs nothing". Each says which one it is — the same rule the
            rest of F13 follows about a figure with nothing behind it. */}
        {whyThatFigure(assumptions, fund, costly, t) !== undefined && (
          <> {whyThatFigure(assumptions, fund, costly, t)}</>
        )}
      </p>

      <Section title={t('wealth.feeImpact.twoFees')}>
        {fund.fees.onAccumulationBasisPoints === undefined && (
          <p className="mb-3 max-w-2xl text-caption text-ink-secondary">
            <Phrase
              text={t('wealth.feeImpact.noFee')}
              parts={{
                link: (
                  <Link
                    to={`/wealth/funds/${fund.id}`}
                    className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover"
                  >
                    {t('wealth.feeImpact.addFee')}
                  </Link>
                ),
              }}
            />
          </p>
        )}

        <div className="grid max-w-4xl grid-cols-1 gap-x-12 gap-y-5 @lg:grid-cols-2">
          <RateSlider
            label={t('wealth.feeImpact.todayBalance')}
            hint={t('wealth.feeImpact.todayBalanceHint')}
            basisPoints={assumptions.current.onAccumulationBasisPoints ?? 0}
            max={bounds.accumulationFee}
            onChange={(value) =>
              set({ current: { ...assumptions.current, onAccumulationBasisPoints: value } })
            }
          />
          <RateSlider
            label={t('wealth.feeImpact.targetBalance')}
            hint={
              reference === undefined
                ? t('wealth.feeImpact.guess')
                : t('wealth.feeImpact.usually', { percent: formatPercent(reference.typicalOnAccumulationBasisPoints, { digits: 2 }) })
            }
            basisPoints={assumptions.target.onAccumulationBasisPoints ?? 0}
            max={bounds.accumulationFee}
            onChange={(value) =>
              set({ target: { ...assumptions.target, onAccumulationBasisPoints: value } })
            }
          />
          <RateSlider
            label={t('wealth.feeImpact.todayDeposit')}
            hint={t('wealth.feeImpact.todayDepositHint')}
            basisPoints={assumptions.current.onDepositBasisPoints ?? 0}
            max={bounds.depositFee}
            step={5}
            onChange={(value) =>
              set({ current: { ...assumptions.current, onDepositBasisPoints: value } })
            }
          />
          <RateSlider
            label={t('wealth.feeImpact.targetDeposit')}
            hint={
              reference === undefined
                ? t('wealth.feeImpact.guess')
                : t('wealth.feeImpact.usually', { percent: formatPercent(reference.typicalOnDepositBasisPoints, { digits: 2 }) })
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
          <p className="mt-4 max-w-2xl text-caption text-ink-secondary">
            {t('wealth.feeImpact.ceiling', {
              type: t(`wealth.kinds.fund.${fund.fundType}`).toLowerCase(),
              balanceCap: formatPercent(reference.capOnAccumulationBasisPoints, { digits: 2 }),
              depositCap: formatPercent(reference.capOnDepositBasisPoints, { digits: 2 }),
              date: toISODate(reference.asOf),
            })}
          </p>
        )}
      </Section>

      <Section title={t('wealth.feeImpact.against')}>
        <div className="grid max-w-4xl grid-cols-1 gap-x-12 gap-y-5 @lg:grid-cols-2">
          <AmountSlider
            label={t('wealth.feeImpact.start')}
            hint={
              balance === undefined
                ? t('wealth.feeImpact.startNone')
                : t('wealth.feeImpact.startReading', { date: balanceAsOf ?? '' })
            }
            amount={assumptions.openingBalance}
            max={bounds.balance}
            step={step(10_000)}
            onChange={(value) => set({ openingBalance: value })}
          />
          <AmountSlider
            label={t('wealth.feeImpact.paidYear')}
            hint={contributionHint(rate, t, dates)}
            amount={assumptions.annualContribution}
            max={bounds.contribution}
            step={step(1_000)}
            onChange={(value) => set({ annualContribution: value })}
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.feeImpact.howLong')}</span>
              <span className="tabular-nums">
                {t(countKey('wealth.feeImpact.years', assumptions.years), { count: assumptions.years })}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={45}
              step={1}
              value={assumptions.years}
              onChange={(event) => set({ years: Number(event.target.value) })}
              aria-label={t('wealth.feeImpact.yearsLabel')}
              className="w-full accent-[var(--color-ink)]"
            />
            <span className="text-caption text-ink-secondary">
              {t('wealth.feeImpact.howLongHint')}
            </span>
          </div>
        </div>
      </Section>

      <Section title={t('wealth.feeImpact.differenceTitle')}>
        <div className="grid max-w-4xl grid-cols-1 gap-x-12 gap-y-6 @lg:grid-cols-3">
          {result.scenarios.map((scenario, index) => (
            <div key={index} className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-caption font-medium text-ink-secondary uppercase">
                <input
                  type="number"
                  className={`${FIELD} w-20 text-end tabular-nums`}
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
                  aria-label={t('wealth.feeImpact.returnLabel', { n: index + 1 })}
                />
                {t('wealth.feeImpact.returnSuffix')}
              </label>

              {/* This column's own answer, and the third figure a slider moves.
                  The decomposition below it does not count: three more counters
                  under every column is the excess docs/11 warns about, and those
                  lines are read after the drag has stopped rather than during
                  it. */}
              <CountingAmount
                value={scenario.difference}
                className={`text-title font-medium ${
                  scenario.difference.minor < 0 ? 'text-negative' : ''
                }`}
              />

              {/* The bar is the fee, drawn: the full width is what the balance
                  reaches at the lower fee and the gap at the end is what the
                  higher one took. Geometry, so a rounding error is a fraction of
                  a pixel — every figure beside it is integer minor units. */}
              <FeeBar reached={scenario.atCurrentFees} could={scenario.atTargetFees} />

              <span className="text-caption text-ink-secondary tabular-nums">
                {formatMoney(scenario.atCurrentFees)} → {formatMoney(scenario.atTargetFees)}
              </span>

              {/* What the first of those two figures is made of. The fee
                  argument is a comparison, but a comparison of two numbers
                  nobody can decompose is a number to take on trust — and the
                  three parts here are an identity, not three estimates
                  (D-082). */}
              <dl className="mt-2 flex flex-col gap-0.5 border-t border-hairline pt-2 text-caption text-ink-secondary">
                <Part label={t('wealth.feeImpact.youPay')} amount={scenario.paidIn} />
                <Part label={t('wealth.feeImpact.earns')} amount={scenario.grossGrowth} />
                <Part
                  label={t('wealth.feeImpact.feeTakes')}
                  amount={money(-scenario.feesTaken.minor, scenario.feesTaken.currency)}
                />
              </dl>
            </div>
          ))}
        </div>

        {agreed !== undefined && agreedBasisPoints !== undefined && (
          <div className="mt-6 flex max-w-4xl flex-col gap-2 border-t border-hairline pt-4">
            <span className="text-caption font-medium text-ink-secondary uppercase">
              {t('wealth.feeImpact.agreed', { percent: formatPercent(agreedBasisPoints, { digits: 2 }) })}
            </span>
            <span className="text-caption text-ink-secondary">{t('wealth.feeImpact.agreedWhy')}</span>
            <CountingAmount
              value={agreed.difference}
              className={`text-title font-medium ${agreed.difference.minor < 0 ? 'text-negative' : ''}`}
            />
            <span className="text-caption text-ink-secondary tabular-nums">
              {formatMoney(agreed.atCurrentFees)} → {formatMoney(agreed.atTargetFees)}
            </span>
          </div>
        )}

        <p className="mt-5 max-w-2xl text-caption text-ink-secondary">
          {t(countKey('wealth.feeImpact.addsUp', assumptions.years), { count: assumptions.years })}
        </p>

        <p className="mt-5 max-w-2xl text-caption text-ink-secondary">
          {t(countKey('wealth.feeImpact.readAs', assumptions.years), {
            count: assumptions.years,
            balance: formatMoney(assumptions.openingBalance),
            paid: formatMoney(assumptions.annualContribution),
            fromBalance: formatPercent(assumptions.current.onAccumulationBasisPoints, { digits: 2 }),
            toBalance: formatPercent(assumptions.target.onAccumulationBasisPoints, { digits: 2 }),
            fromDeposit: formatPercent(assumptions.current.onDepositBasisPoints, { digits: 2 }),
            toDeposit: formatPercent(assumptions.target.onDepositBasisPoints, { digits: 2 }),
          })}
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
  t: Translate,
): string | undefined {
  const zero = formatMoney(money(0, assumptions.openingBalance.currency))
  if (assumptions.openingBalance.minor === 0 && assumptions.annualContribution.minor === 0) {
    return t('wealth.feeImpact.whyNothing', { zero })
  }

  const identical =
    assumptions.current.onAccumulationBasisPoints ===
      assumptions.target.onAccumulationBasisPoints &&
    assumptions.current.onDepositBasisPoints === assumptions.target.onDepositBasisPoints
  if (identical) {
    return fund.fees.onAccumulationBasisPoints === undefined
      ? t('wealth.feeImpact.whySameNone', { zero })
      : t('wealth.feeImpact.whySame', { zero })
  }

  if (costly) return t('wealth.feeImpact.whyCostly')

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
function contributionHint(rate: ContributionRate | undefined, t: Translate, dates: DateWords): string {
  if (rate === undefined) return t('wealth.feeImpact.contributionNone')
  const from = dates.monthShort(rate.from)
  const to = dates.monthShort(rate.to)
  return rate.monthsCounted >= 12
    ? t('wealth.feeImpact.contributionYear', { from, to })
    : t(countKey('wealth.feeImpact.contributionScaled', rate.monthsCounted), { count: rate.monthsCounted, from, to })
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
        <span className="text-caption font-medium text-ink-secondary uppercase">{label}</span>
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
      <span className="text-caption text-ink-secondary">{hint}</span>
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
        <span className="text-caption font-medium text-ink-secondary uppercase">{label}</span>
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
      <span className="text-caption text-ink-secondary">{hint}</span>
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
  const t = useT()
  const whole = Math.max(Math.abs(reached.minor), Math.abs(could.minor), 1)
  const filled = Math.max(0, Math.min(100, (Math.min(reached.minor, could.minor) / whole) * 100))

  return (
    <div
      className="flex h-2 w-full overflow-hidden bg-surface"
      role="img"
      aria-label={t('wealth.feeImpact.bar', { reached: formatMoney(reached), could: formatMoney(could) })}
    >
      <div className="h-full bg-ink-tertiary" style={{ width: `${String(filled)}%` }} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-4 border-b border-hairline pb-2 text-caption font-medium text-ink-secondary uppercase">
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
      <span className="text-caption font-medium text-ink-secondary uppercase">{label}</span>
      {children}
      {hint !== undefined && hint !== '' && (
        <span className="text-caption text-ink-secondary">{hint}</span>
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
