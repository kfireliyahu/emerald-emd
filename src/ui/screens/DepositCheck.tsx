import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { formatMoney, sum, type CurrencyCode } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import {
  acknowledgeDepositGap,
  fundDepositChecks,
  listFundsWithLatest,
} from '@/data/repositories/fundRepository.ts'
import type { DepositReconciliation, FundWithLatest } from '@/domain/funds.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'

/**
 * Every fund's deposits against every payslip — docs/f13's cross-fund check, and
 * the screen it calls "where a missing-deposit problem gets discovered".
 *
 * **The gap is the screen.** Employers depositing late, partially or not at all
 * is the second of docs/f13's four failures and the highest-value thing this
 * feature does; the funds screen shows it as a chip on a card among other cards,
 * and the fund detail shows it for one fund at a time. Neither answers "is
 * anything wrong anywhere", which is the question someone asks twice a year and
 * cannot afford to answer by clicking through eight funds.
 *
 * **What cannot be checked is listed, not omitted.** A fund with one reading and
 * a fund whose deposits reconcile look identical in silence, and silence here
 * would be read as "fine". So the funds that could not be checked sit under
 * their own heading with the specific thing each one is missing, which is also
 * the shortest path to fixing it.
 *
 * **No figure is computed here.** `fundDepositChecks` reconciles every fund in
 * one pass over the payslips (D-068) and the verdicts on this screen are the
 * ones the chip and the fund detail already read — the same call, so three
 * screens cannot disagree about whether money is missing.
 *
 * **A section of Funds since M36 U10**, as fee impact is: it was a page of its
 * own at `#/wealth/deposits`, and that path opens Funds with this section open.
 */
export function DepositCheck() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const t = useT()
  const dates = useDates()

  const [problem, setProblem] = useState<string | undefined>()

  const entries = useMemo(
    () => (db === undefined ? [] : listFundsWithLatest(db, { includeArchived: true })),
    [db, revision],
  )

  const currency: CurrencyCode =
    entries.find((entry) => entry.latest !== undefined)?.latest?.totalBalance.currency ?? 'ILS'

  const checks = useMemo(
    () =>
      db === undefined
        ? new Map<string, DepositReconciliation>()
        : fundDepositChecks(db, currency, { includeArchived: true }),
    [db, revision, currency],
  )

  if (db === undefined) {
    return <Centered>{t('wealth.depositCheck.noDocument')}</Centered>
  }

  // Funds says *no funds yet* itself, above where this section would be.
  if (entries.length === 0) return null

  const rows = entries.map((entry) => ({ entry, check: checks.get(entry.fund.id) }))
  const checked = rows.filter(
    (row): row is { entry: FundWithLatest; check: Checked } => row.check?.kind === 'CHECKED',
  )
  const missing = checked.filter((row) => row.check.status === 'DEPOSITS_MISSING')
  const unchecked = rows.filter((row) => row.check === undefined || row.check.kind !== 'CHECKED')

  const unaccounted = sum(
    missing.map((row) => row.check.gap),
    currency,
  )

  const acknowledge = (snapshotId: string, acknowledged: boolean): void => {
    setProblem(undefined)
    try {
      mutate((database) => acknowledgeDepositGap(database, snapshotId, acknowledged, Date.now()))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="flex flex-col">
      {problem !== undefined && (
        <div className="flex shrink-0 items-center gap-4 border-b border-hairline bg-surface px-6 py-2">
          <span className="text-negative">{problem}</span>
          <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setProblem(undefined)}>
            {t('wealth.common.dismiss')}
          </Button>
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-hairline px-6 py-4">
          {/* **Nothing to check is not "nothing missing".** A document with no
              comparable fund would otherwise show a confident ₪0.00 over funds
              the app has never been able to look at — the misleading zero
              docs/f13 forbids and docs/08 keeps as a standing rule. */}
          <Figure
            label={t('wealth.depositCheck.unaccounted')}
            hint={headlineHint(checked.length, missing.length, unchecked.length, t)}
          >
            {checked.length === 0 ? (
              <span className="text-hero text-ink-secondary">—</span>
            ) : (
              <span className={`text-hero tabular-nums ${missing.length > 0 ? 'text-negative' : ''}`}>
                {formatMoney(unaccounted)}
              </span>
            )}
          </Figure>

          <Figure label={t('wealth.depositCheck.checked')} hint={t('wealth.depositCheck.checkedOf', { count: rows.length })}>
            <span className="text-heading font-medium tabular-nums">{checked.length}</span>
          </Figure>
        </div>

        {checked.length > 0 && (
          <>
            {checked.map(({ entry, check }) => (
              <CheckedRow
                key={entry.fund.id}
                entry={entry}
                check={check}
                onAcknowledge={(acknowledged) =>
                  acknowledge(check.window.closingSnapshotId, acknowledged)
                }
              />
            ))}
            <p className="max-w-3xl px-6 py-4 text-caption text-ink-secondary">{t('wealth.depositCheck.how')}</p>
          </>
        )}

        {unchecked.length > 0 && (
          <>
            <h2 className="border-b border-hairline px-6 pt-6 pb-2 text-caption font-medium text-ink-secondary uppercase">
              {t('wealth.depositCheck.notYet')}
            </h2>
            {unchecked.map(({ entry, check }) => (
              <UncheckedRow key={entry.fund.id} entry={entry} check={check} t={t} dates={dates} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** The one variant this screen can actually judge. */
type Checked = Extract<DepositReconciliation, { kind: 'CHECKED' }>

function headlineHint(checked: number, missing: number, unchecked: number, t: Translate): string {
  if (checked === 0) {
    return unchecked === 1 ? t('wealth.depositCheck.noneOne') : t('wealth.depositCheck.noneMany')
  }
  const tail = unchecked === 0 ? '' : t(countKey('wealth.depositCheck.tail', unchecked), { count: unchecked })
  if (missing === 0) return t('wealth.depositCheck.allAdd', { tail })
  return missing === 1 ? t('wealth.depositCheck.oneFund', { tail }) : t('wealth.depositCheck.manyFunds', { count: missing, tail })
}

function CheckedRow({
  entry,
  check,
  onAcknowledge,
}: {
  entry: FundWithLatest
  check: Checked
  onAcknowledge: (acknowledged: boolean) => void
}) {
  const { fund } = entry
  const missing = check.status === 'DEPOSITS_MISSING'
  const t = useT()
  const dates = useDates()

  return (
    <section className="border-b border-hairline px-6 py-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="min-w-56 flex-1">
          <Link
            to={`/wealth/funds/${fund.id}`}
            className="text-heading underline-offset-4 hover:underline"
          >
            <Bidi>{fund.name}</Bidi>
          </Link>
          <p className="mt-0.5 text-caption text-ink-secondary tabular-nums">
            {t(countKey('wealth.depositCheck.window', check.expected.paycheckCount), {
              type: t(`wealth.kinds.fund.${fund.fundType}`),
              from: dates.monthShort(check.window.salaryFrom),
              to: dates.monthShort(check.window.salaryTo),
              count: check.expected.paycheckCount,
            })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
            <Chip problem={missing}>{t(`wealth.kinds.deposit.${check.status}`)}</Chip>
            {fund.isArchived && <Chip>{t('wealth.depositCheck.archived')}</Chip>}
          </div>
        </div>

        <Figure label={t('wealth.depositCheck.paychecksSay')} hint={t('wealth.depositCheck.paychecksSayHint')}>
          <span className="text-heading font-medium tabular-nums">
            {formatMoney(check.expected.total)}
          </span>
        </Figure>

        <Figure label={t('wealth.depositCheck.fundSays')} hint={t('wealth.depositCheck.through', { date: toISODate(check.window.to) })}>
          <span className="text-heading font-medium tabular-nums">{formatMoney(check.reported)}</span>
        </Figure>

        <Figure label={t('wealth.depositCheck.difference')} hint={t('wealth.depositCheck.tolerance', { amount: formatMoney(check.tolerance) })}>
          <span className={`text-title font-medium tabular-nums ${missing ? 'text-negative' : ''}`}>
            {formatMoney(check.gap)}
          </span>
        </Figure>

        {/* The acknowledgement the fund detail screen already offers, on the
            screen where the gap is actually found. It writes to the snapshot
            that closes the window (D-066), which is why it is the same fact
            either way and not a second one. */}
        {check.status !== 'WITHIN_TOLERANCE' && (
          <div className="flex items-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onAcknowledge(check.status !== 'ACKNOWLEDGED')}
            >
              {check.status === 'ACKNOWLEDGED' ? t('wealth.depositCheck.again') : t('wealth.depositCheck.chased')}
            </Button>
          </div>
        )}
      </div>

      {missing && (
        <p className="mt-3 max-w-3xl text-caption text-ink-secondary">{t('wealth.depositCheck.missingHow')}</p>
      )}
    </section>
  )
}

/**
 * A fund that could not be checked, and the specific thing standing in the way.
 *
 * Never "no data": each variant names what is missing and, where the app can,
 * where to go and add it. The four ways of having no answer are four different
 * sentences (D-066) and this is the screen where that pays off.
 */
function UncheckedRow({
  entry,
  check,
  t,
  dates,
}: {
  entry: FundWithLatest
  check: DepositReconciliation | undefined
  t: Translate
  dates: DateWords
}) {
  const { fund } = entry

  return (
    <section className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-3">
      <Link
        to={`/wealth/funds/${fund.id}`}
        className="min-w-56 flex-1 underline-offset-4 hover:underline"
      >
        <Bidi>{fund.name}</Bidi>
      </Link>
      <span className="max-w-2xl flex-[2] text-ink-secondary">{reason(check, t, dates)}</span>
    </section>
  )
}

function reason(check: DepositReconciliation | undefined, t: Translate, dates: DateWords): string {
  if (check === undefined) return t('wealth.depositCheck.reason.none')
  if (check.kind === 'NEEDS_TWO_POINTS') {
    return check.snapshotCount === 0 ? t('wealth.depositCheck.reason.noReadings') : t('wealth.depositCheck.reason.oneReading')
  }
  if (check.kind === 'NO_FUND_REPORT') return t('wealth.depositCheck.reason.noReport')
  if (check.kind === 'WINDOW_TOO_SHORT') {
    return t('wealth.depositCheck.reason.tooShort', { from: toISODate(check.from), to: toISODate(check.to) })
  }
  return t('wealth.depositCheck.reason.noPayslips', {
    amount: formatMoney(check.reported),
    from: dates.yearMonth(check.window.salaryFrom),
    to: dates.yearMonth(check.window.salaryTo),
  })
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
    <div className="flex flex-col items-start gap-0.5">
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
