import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { formatMoney, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { listed } from '@/core/text.ts'
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
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { CandidateCard } from '@/ui/fixed/CandidateCard.tsx'
import { today } from '@/ui/today.ts'
import { Legend, LegendItem, Tag } from '@/ui/wealth/parts.tsx'

const MONTH_CHOICES = [1, 2, 3, 4, 6] as const

export type Write = (work: (database: import('sql.js').Database, now: number) => void) => boolean

const GOAL = 'bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-flow-saved)_28%,var(--color-background))_0_4px,color-mix(in_srgb,var(--color-flow-saved)_14%,var(--color-background))_4px_8px)]'
const CASH = 'bg-[color-mix(in_srgb,var(--color-ink-secondary)_30%,var(--color-background))]'
const OVER =
  'border border-negative bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-negative)_30%,transparent)_0_3px,transparent_3px_6px)]'
const SEG = 'flex h-full items-center overflow-hidden px-1.5 text-[11px] whitespace-nowrap [&+div]:border-l [&+div]:border-background'

/**
 * **The whole cushion, on Plan** (M36 U10): what no goal has taken in the
 * accounts it lives in, its target in months of bills and Plan's buckets, which
 * accounts count, and whether it is above it. It was one line under Net worth
 * with the ticks in the table (M36 U08) and a second line on Plan with the months
 * (M31 U5); each goal's part is still a bar inside its account on Net worth.
 */
export function CushionLine({ cushion, write }: { cushion: CushionReading; write: Write }) {
  const { split } = cushion
  const ofText = monthsOf(cushion)
  const left = split.check.kind === 'ADDS_UP' ? split.left : undefined
  return (
    <div className="flex flex-col gap-2 border border-hairline bg-surface px-3.5 py-3" data-testid="cushion-line" data-guide="plan.cushion">
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <span className="text-label tracking-[0.08em] text-ink-secondary uppercase">The cushion</span>
        <span>
          what no goal has taken in the accounts it lives in:{' '}
          <b className="font-medium tabular-nums">
            {left !== undefined ? formatMoney(left) : split.check.kind === 'NO_ACCOUNTS' ? 'none ticked' : 'unchecked'}
          </b>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
        <span>Its target is</span>
        <MonthChoice months={cushion.months} write={write} />
        <span>
          months of {ofText}
          {cushion.target === undefined ? '.' : <>, <span className="tabular-nums">{formatMoney(cushion.target)}</span>.</>}
        </span>
      </div>
      <CountFromPlan cushion={cushion} write={write} />
      <LivesIn cushion={cushion} write={write} />
      {cushion.months !== undefined && cushion.target === undefined && <BillsHere write={write} />}
      {split.check.kind === 'NO_ACCOUNTS' && (
        <p className="m-0 text-caption text-ink-secondary">
          {cushion.accounts.length === 0
            ? 'No bank account yet: reading a statement makes one.'
            : 'Tick the bank accounts the cushion lives in.'}
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
              tag={<Tag>Unchecked</Tag>}
              action={
                <button
                  type="button"
                  className="text-caption text-accent hover:underline"
                  onClick={() =>
                    write((database, now) => setCushionAccounts(database, [{ accountId: account.accountId, counts: false }], now))
                  }
                >
                  Leave it out
                </button>
              }
            >
              <Bidi>{account.name}</Bidi> has no statement balance, so what is in the bank cannot be said.
            </Verdict>
          ))}
      {split.check.kind === 'OVER' && (
        <Verdict tag={<Tag tone="bad">Unchecked</Tag>}>
          {split.short.length === 0 ? (
            'The goals hold more than the ticked accounts, so there is no cushion to measure.'
          ) : (
            <>
              A goal in <Bidi>{split.short.map((one) => one.name).join(', ')}</Bidi> holds more than its statement, so there is
              no cushion to measure.
            </>
          )}
        </Verdict>
      )}
      {split.check.kind === 'ADDS_UP' &&
        split.short.map((short) => (
          <Verdict
            key={short.accountId}
            tag={
              <Tag tone="bad">
                <Bidi>{short.name}</Bidi> off by {formatMoney(short.by)}
              </Tag>
            }
          >
            The goals saved there hold {formatMoney(short.parts)}, and it ends at {formatMoney(short.balance)}.
          </Verdict>
        ))}
      {left !== undefined && cushion.above !== undefined && <AboveVerdict above={cushion.above} />}
    </div>
  )
}

/** What the months are of: bills, and Plan's buckets ticked beside them (M28 F10). */
function monthsOf(cushion: CushionReading): string {
  const of = ['bills', ...cushion.buckets.filter((bucket) => bucket.included).map((bucket) => bucket.name)]
  return listed(of)
}

/** Above or short of its target, in Plan's words — on Plan and under an account it lives in. */
function AboveVerdict({ above }: { above: Money }) {
  return (
    <Verdict tag={<Tag tone={above.minor >= 0 ? 'good' : 'bad'}>{above.minor >= 0 ? 'Above the cushion' : 'Below the cushion'}</Tag>}>
      {above.minor >= 0
        ? `${formatMoney(above)} above its target.`
        : `${formatMoney(money(-above.minor, above.currency))} short of its target.`}
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
  const { split } = cushion
  const left = split.check.kind === 'ADDS_UP' ? split.left : undefined
  const elsewhere = cushion.accounts.filter((account) => account.counts && account.accountId !== accountId)
  const months = cushion.months === undefined ? undefined : `${String(cushion.months)} ${cushion.months === 1 ? 'month' : 'months'}`
  return (
    <div className="flex flex-col gap-1.5" data-testid="cushion-here">
      <p className="m-0">
        What no goal has taken in the accounts it lives in:{' '}
        <b className="font-medium tabular-nums">{left !== undefined ? formatMoney(left) : 'unchecked'}</b>
        {elsewhere.length > 0 && (
          <span className="text-caption text-ink-secondary">
            {' '}
            — here and in <Bidi>{elsewhere.map((account) => account.name).join(', ')}</Bidi>
          </span>
        )}
      </p>
      <p className="m-0 text-caption text-ink-secondary">
        {months === undefined ? (
          'It has no target yet.'
        ) : cushion.target === undefined ? (
          `Its target is ${months} of ${monthsOf(cushion)}, and no bills are known yet.`
        ) : (
          <>
            Its target is {months} of {monthsOf(cushion)}, <span className="tabular-nums">{formatMoney(cushion.target)}</span>.
          </>
        )}{' '}
        <Link to="/plan" className="text-accent hover:underline">
          Set it on Plan
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
  if (cushion.accounts.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="text-caption text-ink-secondary">It lives in:</span>
      {cushion.accounts.map((account) => {
        const blocked = !account.counts && account.balance === undefined
        return (
          <button
            key={account.accountId}
            type="button"
            aria-pressed={account.counts}
            disabled={blocked}
            title={blocked ? 'No statement: the cushion is what a statement says' : undefined}
            onClick={() =>
              write((database, now) => setCushionAccounts(database, [{ accountId: account.accountId, counts: !account.counts }], now))
            }
            className={`h-7 border px-2.5 text-caption whitespace-nowrap disabled:cursor-default disabled:opacity-50 ${
              account.counts ? 'border-accent bg-accent-soft text-ink' : 'border-hairline-strong text-ink-secondary hover:text-ink'
            }`}
          >
            <Bidi>{account.name}</Bidi>
            {account.last4 !== undefined && <span className="ml-1 text-ink-secondary">···{account.last4}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The months, as buttons: Overview's card and Plan's line both set them in place (M31 U5). */
export function MonthChoice({ months, write }: { months: number | undefined; write: Write }) {
  const choices =
    months === undefined || (MONTH_CHOICES as readonly number[]).includes(months)
      ? MONTH_CHOICES
      : [...MONTH_CHOICES, months].sort((a, b) => a - b)
  return (
    <span className="inline-flex" role="group" aria-label="Months of bills">
      {choices.map((choice, index) => (
        <button
          key={choice}
          type="button"
          aria-pressed={months === choice}
          onClick={() => write((database, now) => setCushionMonths(database, choice, now))}
          className={`h-7 border px-2.5 text-caption whitespace-nowrap ${index === 0 ? '' : '-ml-px'} ${
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
  if (cushion.buckets.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="text-caption text-ink-secondary">Count from Plan too:</span>
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
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const candidates = useMemo(
    () => (db === undefined ? [] : billCandidates(db, addMonths(yearMonthOf(today()), -1))),
    [db, revision],
  )
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-caption text-ink-secondary">
        No bills are tracked yet, so there is no amount.{' '}
        {candidates.length === 0 ? (
          <>
            No charge in the statements looks like one yet: add one under Bills, below.
          </>
        ) : (
          `${candidates.length === 1 ? 'This charge looks like one' : 'These charges look like them'}: track ${candidates.length === 1 ? 'it' : 'them'} and the amount follows.`
        )}
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
  const cashName = cushion ? 'The cushion' : 'Cash, not for any goal'
  const goals = statement.parts.reduce((sum, part) => sum + part.amount.minor, 0)
  const over = statement.short !== undefined
  const cash = statement.cash?.minor ?? 0
  const scale = Math.max(1, over ? goals : statement.balance.minor)
  const pc = (minor: number): string => `${String(Math.max(0, Math.min(100, (minor / scale) * 100)))}%`

  return (
    <div className="flex flex-col gap-1.5" data-testid="statement-bar">
      <div className="pt-3.5">
        <div
          className="relative flex h-[22px] w-full bg-hairline"
          role="img"
          aria-label={
            over
              ? `Goals ${formatMoney(money(goals, currency))}, against a statement of ${formatMoney(statement.balance)}`
              : `${formatMoney(statement.balance)} on the statement: ${statement.parts
                  .map((part) => `${part.goalName} ${formatMoney(part.amount)}`)
                  .concat(`${cushion ? 'the cushion' : 'cash, not for any goal'} ${formatMoney(money(cash, currency))}`)
                  .join(', ')}`
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
                className={`pointer-events-none absolute -top-[3px] -bottom-[3px] right-0 ${OVER}`}
                style={{ left: pc(statement.balance.minor) }}
              />
              <span className="absolute -top-[5px] -bottom-[5px] w-0 border-l-[1.5px] border-ink" style={{ left: pc(statement.balance.minor) }}>
                <span className="absolute -top-[17px] -left-px -translate-x-full pr-1 text-[11px] whitespace-nowrap text-ink-secondary">
                  the statement
                </span>
              </span>
            </>
          )}
        </div>
      </div>
      <Legend>
        {statement.parts.length > 0 && <LegendItem swatch={GOAL}>Saved for a goal</LegendItem>}
        {!over && <LegendItem swatch={CASH}>{cushion ? 'The cushion: cash, not for any goal' : 'Cash, not for any goal'}</LegendItem>}
        {over && <LegendItem swatch={OVER}>More than the statement</LegendItem>}
      </Legend>
    </div>
  )
}
