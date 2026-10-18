import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { formatMoney, sum, type CurrencyCode } from '@/core/money.ts'
import { formatMonthShort, formatYearMonth, toISODate } from '@/core/time.ts'
import {
  acknowledgeDepositGap,
  fundDepositChecks,
  listFundsWithLatest,
} from '@/data/repositories/fundRepository.ts'
import type { DepositReconciliation, FundWithLatest } from '@/domain/funds.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { DEPOSIT_STATUS_LABEL, FUND_TYPE_LABEL } from '@/ui/funds/labels.ts'

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
    return <Centered>Open a document to check what reached your funds.</Centered>
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
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
            Dismiss
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
            label="Unaccounted for"
            hint={headlineHint(checked.length, missing.length, unchecked.length)}
          >
            {checked.length === 0 ? (
              <span className="text-hero text-ink-tertiary">—</span>
            ) : (
              <span className={`text-hero tabular-nums ${missing.length > 0 ? 'text-negative' : ''}`}>
                {formatMoney(unaccounted)}
              </span>
            )}
          </Figure>

          <Figure label="Funds checked" hint={`of ${String(rows.length)} in this document`}>
            <span className="text-secondary-number tabular-nums">{checked.length}</span>
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
            <p className="max-w-3xl px-6 py-4 text-caption text-ink-tertiary">
              Each fund is compared cumulatively over the longest run of readings that state what
              arrived, with the salary months shifted back by the employer's lag. A single month
              never looks right on its own — that is what the lag is for — so the comparison is
              always of totals. The per-window working is on each fund's own screen.
            </p>
          </>
        )}

        {unchecked.length > 0 && (
          <>
            <h2 className="border-b border-hairline px-6 pt-6 pb-2 text-label text-ink-tertiary uppercase">
              Not checkable yet — and what each one needs
            </h2>
            {unchecked.map(({ entry, check }) => (
              <UncheckedRow key={entry.fund.id} entry={entry} check={check} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** The one variant this screen can actually judge. */
type Checked = Extract<DepositReconciliation, { kind: 'CHECKED' }>

function headlineHint(checked: number, missing: number, unchecked: number): string {
  if (checked === 0) {
    return unchecked === 1
      ? 'no fund can be checked yet — see below for what it needs'
      : 'no fund can be checked yet — see below for what each one needs'
  }
  const tail = unchecked === 0 ? '' : `, and ${String(unchecked)} could not be checked`
  if (missing === 0) {
    return `every fund that could be checked adds up${tail}`
  }
  return missing === 1 ? `on one fund${tail}` : `across ${String(missing)} funds${tail}`
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
          <p className="mt-0.5 text-caption text-ink-tertiary tabular-nums">
            {FUND_TYPE_LABEL[fund.fundType]} · {formatMonthShort(check.window.salaryFrom)} to{' '}
            {formatMonthShort(check.window.salaryTo)} · {check.expected.paycheckCount}{' '}
            {check.expected.paycheckCount === 1 ? 'paycheck' : 'paychecks'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
            <Chip problem={missing}>{DEPOSIT_STATUS_LABEL[check.status]}</Chip>
            {fund.isArchived && <Chip>Archived</Chip>}
          </div>
        </div>

        <Figure label="Paychecks say" hint="due over the window">
          <span className="text-secondary-number tabular-nums">
            {formatMoney(check.expected.total)}
          </span>
        </Figure>

        <Figure label="Fund says" hint={`through ${toISODate(check.window.to)}`}>
          <span className="text-secondary-number tabular-nums">{formatMoney(check.reported)}</span>
        </Figure>

        <Figure label="Difference" hint={`tolerance ${formatMoney(check.tolerance)}`}>
          <span className={`text-secondary-number tabular-nums ${missing ? 'text-negative' : ''}`}>
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
              {check.status === 'ACKNOWLEDGED' ? 'Report this again' : 'Chased and explained'}
            </Button>
          </div>
        )}
      </div>

      {missing && (
        <p className="mt-3 max-w-3xl text-caption text-ink-tertiary">
          Ask the fund for a deposit statement for these months and compare it against your
          paychecks. If the employer paid late rather than not at all, the next reading absorbs it —
          mark it chased so this stops asking.
        </p>
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
}: {
  entry: FundWithLatest
  check: DepositReconciliation | undefined
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
      <span className="max-w-2xl flex-[2] text-ink-secondary">{reason(check)}</span>
    </section>
  )
}

function reason(check: DepositReconciliation | undefined): string {
  if (check === undefined) return 'Not checked.'
  if (check.kind === 'NEEDS_TWO_POINTS') {
    return check.snapshotCount === 0
      ? 'No readings yet. Two are what a deposit check compares between.'
      : 'One reading. A second is what makes a comparison possible.'
  }
  if (check.kind === 'NO_FUND_REPORT') {
    return 'No reading says what the fund received — the "הפקדות" figure on the report. Add it to a reading and this fund starts being checked.'
  }
  if (check.kind === 'WINDOW_TOO_SHORT') {
    return `Two readings inside one month (${toISODate(check.from)} to ${toISODate(check.to)}) is too short a window to compare against a monthly payroll.`
  }
  return `The fund reports ${formatMoney(check.reported)} arriving between ${formatYearMonth(
    check.window.salaryFrom,
  )} and ${formatYearMonth(
    check.window.salaryTo,
  )}, and there are no paychecks covering those months to compare it against.`
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
