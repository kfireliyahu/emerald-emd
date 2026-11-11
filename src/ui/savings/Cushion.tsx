import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { formatMoney, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { addMonths, yearMonthOf } from '@/core/time.ts'
import {
  setCushionAccounts,
  setCushionBuckets,
  setCushionMonths,
  type CushionReading,
} from '@/data/repositories/cushionRepository.ts'
import { billCandidates, confirmCandidate, dismissMerchant } from '@/data/repositories/fixedExpenseRepository.ts'
import { DEFAULT_WINDOW_MONTHS } from '@/domain/fixedExpenses.ts'
import type { StatementPlace } from '@/domain/savings.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { CandidateCard } from '@/ui/fixed/CandidateCard.tsx'
import { today } from '@/ui/today.ts'
import { Legend, LegendItem, Tag } from '@/ui/wealth/parts.tsx'

const MONTH_CHOICES = [1, 2, 3, 4, 6] as const

export type Write = (work: (database: import('sql.js').Database, now: number) => void) => boolean

const GOAL = 'bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-flow-saved)_28%,var(--color-background))_0_4px,color-mix(in_srgb,var(--color-flow-saved)_14%,var(--color-background))_4px_8px)]'
const CASH = 'bg-[color-mix(in_srgb,var(--color-ink-secondary)_30%,var(--color-background))]'
const OVER =
  'border border-negative bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-negative)_30%,transparent)_0_3px,transparent_3px_6px)]'
const SEG = 'flex h-full items-center overflow-hidden px-1.5 text-[11px] whitespace-nowrap [&+div]:border-s [&+div]:border-background'

/**
 * **The whole cushion, on Plan** (M36 U10): what no goal has taken in the
 * accounts it lives in, its target in months of bills and Plan's buckets, which
 * accounts count, and whether it is above it. It was one line under Net worth
 * with the ticks in the table (M36 U08) and a second line on Plan with the months
 * (M31 U5); each goal's part is still a bar inside its account on Net worth.
 */
export function CushionLine({ cushion, write }: { cushion: CushionReading; write: Write }) {
  const t = useT()
  const { split } = cushion
  const ofText = monthsOf(t, cushion)
  const left = split.check.kind === 'ADDS_UP' ? split.left : undefined
  return (
    <div className="flex flex-col gap-2 border border-hairline bg-surface px-3.5 py-3" data-testid="cushion-line" data-guide="plan.cushion">
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <span className="text-label tracking-[0.08em] text-ink-secondary uppercase">{t('plan.cushion.title')}</span>
        <span>
          {t('plan.cushion.left')}{' '}
          <b className="font-medium tabular-nums">
            {left !== undefined
              ? formatMoney(left)
              : split.check.kind === 'NO_ACCOUNTS'
                ? t('plan.cushion.noneTicked')
                : t('plan.cushion.unchecked')}
          </b>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
        <span>{t('plan.cushion.targetIs')}</span>
        <MonthChoice months={cushion.months} write={write} />
        <span>
          {t('plan.cushion.monthsOf', { of: ofText })}
          {cushion.target === undefined ? '.' : <>, <span className="tabular-nums">{formatMoney(cushion.target)}</span>.</>}
        </span>
      </div>
      <CountFromPlan cushion={cushion} write={write} />
      <LivesIn cushion={cushion} write={write} />
      {cushion.months !== undefined && cushion.target === undefined && <BillsHere write={write} />}
      {split.check.kind === 'NO_ACCOUNTS' && (
        <p className="m-0 text-caption text-ink-secondary">
          {cushion.accounts.length === 0 ? t('plan.cushion.noBank') : t('plan.cushion.tickBanks')}
        </p>
      )}
      {/* Every bank account counts until it is unticked (D-371), so a new one with no
          statement makes the cushion unchecked at once: say which, and offer the untick here. */}
      {split.check.kind === 'UNCHECKED' &&
        cushion.accounts
          .filter((account) => account.counts && account.balance === undefined)
          .map((account) => (
            <Verdict
              key={account.accountId}
              tag={<Tag>{t('plan.cushion.uncheckedTag')}</Tag>}
              action={
                <button
                  type="button"
                  className="text-caption text-accent hover:underline"
                  onClick={() =>
                    write((database, now) => setCushionAccounts(database, [{ accountId: account.accountId, counts: false }], now))
                  }
                >
                  {t('plan.cushion.leaveOut')}
                </button>
              }
            >
              <Phrase text={t('plan.cushion.noBalance')} parts={{ name: <Bidi>{account.name}</Bidi> }} />
            </Verdict>
          ))}
      {split.check.kind === 'OVER' && (
        <Verdict tag={<Tag tone="bad">{t('plan.cushion.uncheckedTag')}</Tag>}>
          {split.short.length === 0 ? (
            t('plan.cushion.goalsHoldMore')
          ) : (
            <Phrase
              text={t('plan.cushion.goalInHoldsMore')}
              parts={{ names: <Bidi>{split.short.map((one) => one.name).join(', ')}</Bidi> }}
            />
          )}
        </Verdict>
      )}
      {split.check.kind === 'ADDS_UP' &&
        split.short.map((short) => (
          <Verdict
            key={short.accountId}
            tag={
              <Tag tone="bad">
                <Phrase text={t('plan.cushion.offBy')} parts={{ name: <Bidi>{short.name}</Bidi>, amount: formatMoney(short.by) }} />
              </Tag>
            }
          >
            {t('plan.cushion.goalsSavedThere', { parts: formatMoney(short.parts), balance: formatMoney(short.balance) })}
          </Verdict>
        ))}
      {left !== undefined && cushion.above !== undefined && <AboveVerdict above={cushion.above} />}
    </div>
  )
}

/** What the months are of: bills, and Plan's buckets ticked beside them (M28 F10). */
function monthsOf(t: Translate, cushion: CushionReading): string {
  const of = [t('plan.cushion.bills'), ...cushion.buckets.filter((bucket) => bucket.included).map((bucket) => bucket.name)]
  if (of.length < 2) return of[0] ?? ''
  return t('plan.listed', { rest: of.slice(0, -1).join(', '), last: of.at(-1) ?? '' })
}

/** Above or short of its target, in Plan's words — on Plan and under an account it lives in. */
function AboveVerdict({ above }: { above: Money }) {
  const t = useT()
  return (
    <Verdict
      tag={<Tag tone={above.minor >= 0 ? 'good' : 'bad'}>{above.minor >= 0 ? t('plan.cushion.above') : t('plan.cushion.below')}</Tag>}
    >
      {above.minor >= 0
        ? t('plan.cushion.aboveBy', { amount: formatMoney(above) })
        : t('plan.cushion.shortBy', { amount: formatMoney(money(-above.minor, above.currency)) })}
    </Verdict>
  )
}

/**
 * **The cushion, under a bank account it lives in** (M36 F3, D-393), read-only:
 * the account's own Cash, not for any goal is its part, and this says the whole
 * once — the same `CushionReading` Plan draws, its total, the other accounts it
 * lives in, its target and the verdict — with the way to Plan, where it is set.
 */
export function CushionHere({ cushion, accountId }: { cushion: CushionReading; accountId: string }) {
  const t = useT()
  const { split } = cushion
  const left = split.check.kind === 'ADDS_UP' ? split.left : undefined
  const elsewhere = cushion.accounts.filter((account) => account.counts && account.accountId !== accountId)
  const months =
    cushion.months === undefined
      ? undefined
      : t(cushion.months === 1 ? 'plan.cushion.monthOne' : 'plan.cushion.monthMany', { n: String(cushion.months) })
  return (
    <div className="flex flex-col gap-1.5" data-testid="cushion-here">
      <p className="m-0">
        {t('plan.cushion.here')}{' '}
        <b className="font-medium tabular-nums">{left !== undefined ? formatMoney(left) : t('plan.cushion.unchecked')}</b>
        {elsewhere.length > 0 && (
          <span className="text-caption text-ink-secondary">
            {' '}
            <Phrase
              text={t('plan.cushion.hereAndIn')}
              parts={{ names: <Bidi>{elsewhere.map((account) => account.name).join(', ')}</Bidi> }}
            />
          </span>
        )}
      </p>
      <p className="m-0 text-caption text-ink-secondary">
        {months === undefined ? (
          t('plan.cushion.noTarget')
        ) : cushion.target === undefined ? (
          t('plan.cushion.targetNoBills', { months, of: monthsOf(t, cushion) })
        ) : (
          <Phrase
            text={t('plan.cushion.targetAmount')}
            parts={{
              months,
              of: monthsOf(t, cushion),
              amount: <span className="tabular-nums">{formatMoney(cushion.target)}</span>,
            }}
          />
        )}{' '}
        <Link to="/plan" className="text-accent hover:underline">
          {t('plan.cushion.setOnPlan')}
        </Link>
      </p>
      {left !== undefined && cushion.above !== undefined && <AboveVerdict above={cushion.above} />}
    </div>
  )
}

function Verdict({ tag, action, children }: { tag: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2.5">
      {tag}
      <span className="flex-[1_1_320px] text-caption text-ink-secondary">{children}</span>
      {action}
    </div>
  )
}

/**
 * Which bank accounts the cushion lives in, ticked in place (M36 U10): the Net
 * worth table's first column until then (M36 U08). An account with no statement can be
 * left out but not put in — the cushion is what a statement says.
 */
function LivesIn({ cushion, write }: { cushion: CushionReading; write: Write }) {
  const t = useT()
  if (cushion.accounts.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="text-caption text-ink-secondary">{t('plan.cushion.livesIn')}</span>
      {cushion.accounts.map((account) => {
        const blocked = !account.counts && account.balance === undefined
        return (
          <button
            key={account.accountId}
            type="button"
            aria-pressed={account.counts}
            disabled={blocked}
            title={blocked ? t('plan.cushion.noStatement') : undefined}
            onClick={() =>
              write((database, now) => setCushionAccounts(database, [{ accountId: account.accountId, counts: !account.counts }], now))
            }
            className={`h-7 border px-2.5 text-caption whitespace-nowrap disabled:cursor-default disabled:opacity-50 ${
              account.counts ? 'border-accent bg-accent-soft text-ink' : 'border-hairline-strong text-ink-secondary hover:text-ink'
            }`}
          >
            <Bidi>{account.name}</Bidi>
            {account.last4 !== undefined && <span className="ms-1 text-ink-secondary">···{account.last4}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The months, as buttons: Overview's card and Plan's line both set them in place (M31 U5). */
export function MonthChoice({ months, write }: { months: number | undefined; write: Write }) {
  const t = useT()
  const choices =
    months === undefined || (MONTH_CHOICES as readonly number[]).includes(months)
      ? MONTH_CHOICES
      : [...MONTH_CHOICES, months].sort((a, b) => a - b)
  return (
    <span className="inline-flex" role="group" aria-label={t('plan.cushion.monthsLabel')}>
      {choices.map((choice, index) => (
        <button
          key={choice}
          type="button"
          aria-pressed={months === choice}
          onClick={() => write((database, now) => setCushionMonths(database, choice, now))}
          className={`h-7 border px-2.5 text-caption whitespace-nowrap ${index === 0 ? '' : '-ms-px'} ${
            months === choice
              ? 'relative z-[1] border-accent bg-accent-soft text-ink'
              : 'border-hairline-strong text-ink-secondary hover:text-ink'
          }`}
        >
          {String(choice)}
        </button>
      ))}
    </span>
  )
}

/** Plan's buckets the months count beside the bills (M28 F10), ticked in place. */
export function CountFromPlan({ cushion, write }: { cushion: CushionReading; write: Write }) {
  const t = useT()
  if (cushion.buckets.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="text-caption text-ink-secondary">{t('plan.cushion.countFromPlan')}</span>
      {cushion.buckets.map((bucket) => (
        <button
          key={bucket.bucketId}
          type="button"
          aria-pressed={bucket.included}
          onClick={() =>
            write((database, now) => setCushionBuckets(database, [{ bucketId: bucket.bucketId, included: !bucket.included }], now))
          }
          className={`h-7 border px-2.5 text-caption whitespace-nowrap ${
            bucket.included ? 'border-accent bg-accent-soft text-ink' : 'border-hairline-strong text-ink-secondary hover:text-ink'
          }`}
        >
          <Bidi>{bucket.name}</Bidi> <span className="tabular-nums">{formatMoney(bucket.amount)}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * No bills yet, so no amount: the charges that look like bills, tracked here with
 * the card Home and Plan already answer them with (M31 U5, D-367).
 */
function BillsHere({ write }: { write: Write }) {
  const t = useT()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const candidates = useMemo(
    () => (db === undefined ? [] : billCandidates(db, addMonths(yearMonthOf(today()), -1))),
    [db, revision],
  )
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-caption text-ink-secondary">
        {t('plan.cushion.noBills')}{' '}
        {candidates.length === 0
          ? t('plan.cushion.noCharge')
          : t(candidates.length === 1 ? 'plan.cushion.chargeOne' : 'plan.cushion.chargeMany')}
      </p>
      {candidates.length > 0 && (
        <div className="border-t border-hairline" data-testid="cushion-bills">
          {candidates.map((candidate) => (
            <CandidateCard
              key={`${candidate.merchantNormalized}-${candidate.currency}`}
              candidate={candidate}
              windowMonths={DEFAULT_WINDOW_MONTHS}
              onConfirm={(choice) => write((database, now) => confirmCandidate(database, candidate, choice, now))}
              onDismiss={() => write((database, now) => dismissMerchant(database, candidate.merchantNormalized, now))}
            />
          ))}
        </div>
      )}
    </div>
  )
}


/**
 * **The bar over one account's statement** (M36 U08, a change to the
 * mockup): each goal's part, then Cash, not for any goal — BankSplit's bar (M30
 * U7), drawn for the account an opened row is. When the goals hold more than the
 * statement it is drawn against what they hold, the overflow marked past the
 * statement: never shrunk to fit.
 */
export function StatementBar({
  statement,
  currency,
  cushion = false,
}: {
  statement: StatementPlace
  currency: CurrencyCode
  /** The cushion lives in this account (M36 F3): its cash is the cushion's part. */
  cushion?: boolean
}) {
  const t = useT()
  const cashName = cushion ? t('plan.cushion.bar.cushion') : t('plan.cushion.bar.cash')
  const goals = statement.parts.reduce((sum, part) => sum + part.amount.minor, 0)
  const over = statement.short !== undefined
  const cash = statement.cash?.minor ?? 0
  const scale = Math.max(1, over ? goals : statement.balance.minor)
  const pc = (minor: number): string => `${String(Math.max(0, Math.min(100, (minor / scale) * 100)))}%`

  return (
    <div className="flex flex-col gap-1.5" data-testid="statement-bar">
      <div className="pt-3.5" dir="ltr">
        <div
          className="relative flex h-[22px] w-full bg-hairline"
          role="img"
          aria-label={
            over
              ? t('plan.cushion.bar.over', { goals: formatMoney(money(goals, currency)), balance: formatMoney(statement.balance) })
              : t('plan.cushion.bar.parts', {
                  balance: formatMoney(statement.balance),
                  parts: statement.parts
                    .map((part) => `${part.goalName} ${formatMoney(part.amount)}`)
                    .concat(`${cushion ? t('plan.cushion.bar.cushionLower') : t('plan.cushion.bar.cashLower')} ${formatMoney(money(cash, currency))}`)
                    .join(', '),
                })
          }
        >
          {statement.parts.map((part) => (
            <div key={part.goalId} className={`${SEG} ${GOAL}`} style={{ width: pc(part.amount.minor) }}>
              <span>
                <Bidi>{part.goalName}</Bidi> {formatMoney(part.amount)}
              </span>
            </div>
          ))}
          {!over && cash > 0 && (
            <div className={`${SEG} ${CASH}`} style={{ width: pc(cash) }}>
              {cashName} {formatMoney(money(cash, currency))}
            </div>
          )}
          {over && (
            <>
              <span
                className={`pointer-events-none absolute -top-[3px] -bottom-[3px] end-0 ${OVER}`}
                style={{ left: pc(statement.balance.minor) }}
              />
              <span className="absolute -top-[5px] -bottom-[5px] w-0 border-s-[1.5px] border-ink" style={{ left: pc(statement.balance.minor) }}>
                <span className="absolute -top-[17px] -start-px -translate-x-full pe-1 text-[11px] whitespace-nowrap text-ink-secondary">
                  {t('plan.cushion.bar.statement')}
                </span>
              </span>
            </>
          )}
        </div>
      </div>
      <Legend>
        {statement.parts.length > 0 && <LegendItem swatch={GOAL}>{t('plan.cushion.bar.saved')}</LegendItem>}
        {!over && <LegendItem swatch={CASH}>{cushion ? t('plan.cushion.bar.cushionCash') : t('plan.cushion.bar.cash')}</LegendItem>}
        {over && <LegendItem swatch={OVER}>{t('plan.cushion.bar.more')}</LegendItem>}
      </Legend>
    </div>
  )
}
