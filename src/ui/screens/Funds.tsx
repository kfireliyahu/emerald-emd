import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { formatMonthShort, toISODate, toYearMonthString, yearMonthOf, type LocalDate } from '@/core/time.ts'
import { DEFAULT_FEE_REFERENCES } from '@/data/reference/fundFeeReference.ts'
import {
  addSnapshot,
  createFund,
  deleteFund,
  fundDepositChecks,
  fundMissingMonths,
  listFundsWithLatest,
  listSnapshots,
  setFundArchived,
  updateFund,
  updateSnapshot,
} from '@/data/repositories/fundRepository.ts'
import {
  createInstitution,
  listInstitutions,
  type Institution,
} from '@/data/repositories/institutionRepository.ts'
import {
  annualFeeCost,
  feeAgreementStatus,
  longTermSavings,
  snapshotFreshness,
  studyFundLiquidity,
  type DepositReconciliation,
  type FundWithLatest,
  type MonthlyDeposit,
  type SnapshotFreshness,
} from '@/domain/funds.ts'
import type { FundAccount, FundBalanceSnapshot } from '@/domain/model/funds.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { blankFund, FundEditor } from '@/ui/funds/FundEditor.tsx'
import { DepositCheck } from '@/ui/screens/DepositCheck.tsx'
import { FeeImpact } from '@/ui/screens/FeeImpact.tsx'
import { DEPOSIT_STATUS_LABEL, FUND_TYPE_LABEL } from '@/ui/funds/labels.ts'
import { blankSnapshot, SnapshotEditor } from '@/ui/funds/SnapshotEditor.tsx'
import { today } from '@/ui/today.ts'
import { GTD, GTD_R, Hero, HeroCell, Need, PageHead, Screen, Tag, TH, TH_R } from '@/ui/wealth/parts.tsx'

/**
 * The funds screen — pension, hishtalmut, gemel and managers' insurance, with
 * what each one holds, what it charges, and whether the deposits arrived.
 *
 * **Dormant funds get their own section with their annual fee cost.** docs/f13
 * says that is half of why the feature is useful: a ₪40,000 balance from a job
 * three years ago is still paying a management fee every year, and nobody has
 * ever seen that number written down. It is the one figure on this screen that
 * exists to make someone pick up the phone.
 *
 * **The as-of date is never quiet.** These balances are transcribed by hand, so
 * one entered a year ago looks exactly as current as one entered this morning —
 * the named risk in docs/08, whose named mitigation is this indicator.
 *
 * **A missing deposit is the only red thing here.** docs/11 reserves colour for
 * the one item on a screen worth acting on, and on this screen that is money the
 * payslips say was deducted and the fund says never arrived.
 *
 * **A card is a way in, not the whole thing.** The name opens the fund's own
 * screen, which is where the balance chart, the fee panel and the readings
 * live (D-071). What stays here is what you compare *across* funds: balance,
 * staleness, fee, and whether the deposits arrived.
 *
 * **The first tab of a section, now that there are three.** Fee impact and the
 * cross-fund deposit check joined it as siblings and `/wealth` became a shell
 * (D-072). The reconciliation behind the deposit check is the same
 * `fundDepositChecks` call this screen's chip reads, so the two cannot disagree.
 */
export function Funds() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [editingFund, setEditingFund] = useState<EditingFund | undefined>()
  const [editingSnapshot, setEditingSnapshot] = useState<EditingSnapshot | undefined>()
  const [confirming, setConfirming] = useState<string | undefined>()
  const [problem, setProblem] = useState<string | undefined>()
  const [showArchived, setShowArchived] = useState(false)
  const [menu, setMenu] = useState<
    { at: { x: number; y: number }; items: MenuItem[]; title: string } | undefined
  >()
  const navigate = useNavigate()

  const entries = useMemo(
    () => (db === undefined ? [] : listFundsWithLatest(db, { includeArchived: showArchived })),
    [db, revision, showArchived],
  )

  const currency: CurrencyCode =
    entries.find((entry) => entry.latest !== undefined)?.latest?.totalBalance.currency ?? 'ILS'

  const checks = useMemo(
    () =>
      db === undefined
        ? new Map<string, DepositReconciliation>()
        : fundDepositChecks(db, currency, { includeArchived: showArchived }),
    [db, revision, currency, showArchived],
  )
  // A month the fund's own table says fell short — a missing employer deposit —
  // fails here on one report, before any window can (D-389).
  const missingMonths = useMemo(
    () => (db === undefined ? new Map<string, readonly MonthlyDeposit[]>() : fundMissingMonths(db, { includeArchived: showArchived })),
    [db, revision, showArchived],
  )

  const institutions = useMemo(
    () =>
      db === undefined
        ? []
        : [
            ...listInstitutions(db, { kind: 'FUND_MANAGER' }),
            ...listInstitutions(db, { kind: 'INVESTMENT_PLATFORM' }),
          ],
    [db, revision],
  )

  if (db === undefined) {
    return <Centered>Open a document, or create one, to track what your pension holds.</Centered>
  }

  const write = (work: (database: import('sql.js').Database, now: number) => void): boolean => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
      return true
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  if (editingFund !== undefined) {
    return (
      <FundEditor
        key={editingFund.fund.id}
        initial={editingFund.fund}
        isNew={editingFund.isNew}
        institutions={institutions}
        feeReferences={DEFAULT_FEE_REFERENCES}
        onCreateInstitution={(name) => addManager(mutate, name)}
        onSave={(fund) => {
          write((database, now) => {
            if (editingFund.isNew) {
              createFund(
                database,
                {
                  name: fund.name,
                  fundType: fund.fundType,
                  institutionId: fund.institutionId,
                  policyNumber: fund.policyNumber,
                  investmentTrack: fund.investmentTrack,
                  status: fund.status,
                  employerName: fund.employerName,
                  openedDate: fund.openedDate,
                  firstDepositDate: fund.firstDepositDate,
                  feeOnAccumulationBasisPoints: fund.fees.onAccumulationBasisPoints,
                  feeOnDepositBasisPoints: fund.fees.onDepositBasisPoints,
                  feeNegotiatedUntil: fund.feeNegotiatedUntil,
                  agreedReturnBasisPoints: fund.agreedReturnBasisPoints,
                  beneficiaries: fund.beneficiaries,
                  notes: fund.notes,
                },
                now,
              )
            } else {
              updateFund(
                database,
                fund.id,
                {
                  name: fund.name,
                  fundType: fund.fundType,
                  institutionId: fund.institutionId,
                  policyNumber: fund.policyNumber,
                  investmentTrack: fund.investmentTrack,
                  status: fund.status,
                  employerName: fund.employerName,
                  openedDate: fund.openedDate,
                  firstDepositDate: fund.firstDepositDate,
                  feeOnAccumulationBasisPoints: fund.fees.onAccumulationBasisPoints,
                  feeOnDepositBasisPoints: fund.fees.onDepositBasisPoints,
                  feeNegotiatedUntil: fund.feeNegotiatedUntil,
                  agreedReturnBasisPoints: fund.agreedReturnBasisPoints,
                  beneficiaries: fund.beneficiaries,
                  notes: fund.notes,
                },
                now,
              )
            }
          })
          setEditingFund(undefined)
        }}
        onCancel={() => setEditingFund(undefined)}
      />
    )
  }

  if (editingSnapshot !== undefined) {
    const owner = entries.find((entry) => entry.fund.id === editingSnapshot.snapshot.fundAccountId)
    return (
      <SnapshotEditor
        key={editingSnapshot.snapshot.id}
        initial={editingSnapshot.snapshot}
        isNew={editingSnapshot.isNew}
        currency={currency}
        existing={listSnapshots(db, editingSnapshot.snapshot.fundAccountId)}
        fundName={owner?.fund.name ?? ''}
        onSave={(snapshot) => {
          const saved = write((database, now) => {
            if (editingSnapshot.isNew) {
              addSnapshot(
                database,
                {
                  fundAccountId: snapshot.fundAccountId,
                  asOfDate: snapshot.asOfDate,
                  totalBalance: snapshot.totalBalance,
                  employeeComponent: snapshot.employeeComponent,
                  employerComponent: snapshot.employerComponent,
                  severanceComponent: snapshot.severanceComponent,
                  depositsSincePrevious: snapshot.depositsSincePrevious,
                  feesChargedSincePrevious: snapshot.feesChargedSincePrevious,
                  returnSincePrevious: snapshot.returnSincePrevious,
                  note: snapshot.note,
                },
                now,
              )
            } else {
              updateSnapshot(database, snapshot.id, snapshot, now)
            }
          })
          if (saved) setEditingSnapshot(undefined)
        }}
        onCancel={() => setEditingSnapshot(undefined)}
      />
    )
  }

  // Which fund the pane beside this list is showing, if any (D-130).
  const { fundId: openId } = useParams<{ fundId: string }>()
  const pathname = useLocation().pathname
  const onFees = pathname.endsWith('/fees')
  const onDeposits = pathname.endsWith('/deposits')

  const totals = longTermSavings(entries, currency)
  const now = today()
  const ordered = [
    ...entries.filter((entry) => entry.fund.status === 'ACTIVE'),
    ...entries.filter((entry) => entry.fund.status === 'DORMANT'),
    ...entries.filter((entry) => entry.fund.status === 'CLOSED'),
  ]
  const confirmingEntry = entries.find((entry) => entry.fund.id === confirming)
  const yearlyFees = entries.reduce(
    (running, entry) =>
      running +
      (entry.latest === undefined
        ? 0
        : (annualFeeCost(entry.latest.totalBalance, entry.fund.fees)?.minor ?? 0)),
    0,
  )
  const needsCall = entries.filter((entry) => {
    const check = checks.get(entry.fund.id)
    return (
      entry.fund.status === 'DORMANT' ||
      missingMonths.has(entry.fund.id) ||
      (check !== undefined && check.kind === 'CHECKED' && check.status === 'DEPOSITS_MISSING')
    )
  }).length

  const rowMenu = (entry: FundWithLatest): MenuItem[] => [
    {
      label: 'Add a reading',
      icon: 'add',
      onChoose: () =>
        setEditingSnapshot({ isNew: true, snapshot: blankSnapshot(entry.fund.id, now, currency) }),
    },
    {
      label: 'Edit',
      icon: 'edit',
      onChoose: () => setEditingFund({ isNew: false, fund: entry.fund }),
    },
    {
      label: entry.fund.isArchived ? 'Unarchive' : 'Archive',
      onChoose: () =>
        write((database, at) =>
          setFundArchived(database, entry.fund.id, !entry.fund.isArchived, at),
        ),
    },
    {
      label: 'Delete',
      icon: 'trash',
      separated: true,
      onChoose: () => setConfirming(entry.fund.id),
    },
  ]

  const pageMenu: MenuItem[] = [
    {
      label: 'Saved readers',
      detail: 'Every reader this document keeps, beside Read files',
      onChoose: () => navigate('/read/readers'),
    },
    {
      label: showArchived ? 'Hide archived funds' : 'Show archived funds',
      separated: true,
      onChoose: () => setShowArchived(!showArchived),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <Screen>
          <PageHead
            title="Funds"
            actions={
              <>
                <Button variant="primary" icon="add" onClick={() => setEditingFund({ isNew: true, fund: blankFund() })}>
                  Add fund
                </Button>
                <button
                  type="button"
                  aria-label="More about funds"
                  title="More"
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect()
                    setMenu({ at: { x: box.left, y: box.bottom }, items: pageMenu, title: 'Funds' })
                  }}
                  className="fc-icon-action"
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
                    <circle cx="3.5" cy="8" r="1.2" />
                    <circle cx="8" cy="8" r="1.2" />
                    <circle cx="12.5" cy="8" r="1.2" />
                  </svg>
                </button>
              </>
            }
          />

          {problem !== undefined && (
            <div className="fc-pop-enter flex items-center gap-4 border border-hairline bg-surface px-4 py-2">
              <span className="text-negative">{problem}</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setProblem(undefined)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {entries.length === 0 ? (
            <Centered>No funds yet. Add fund adds one; the ones from old jobs are worth adding first.</Centered>
          ) : (
            <>
              <Hero columns={3}>
                {/* No reading anywhere is not a balance of zero (docs/f13). */}
                <HeroCell label="In funds" small={savingsHint(totals)}>
                  {totals.withoutSnapshot === totals.funds ? '—' : formatMoney(totals.total)}
                </HeroCell>
                <HeroCell label="Fees, a year" small="Taken from the balances">
                  {formatMoney(money(yearlyFees, currency))}
                </HeroCell>
                <HeroCell label="Needs a call" small="A missing deposit, or a dormant fund" problem={needsCall > 0}>
                  {String(needsCall)}
                </HeroCell>
              </Hero>

              {totals.severance.minor !== 0 && (
                <p className="m-0 text-ink-secondary">
                  {formatMoney(totals.severance)} of it is severance, withdrawn on different terms
                  and taxed differently.
                </p>
              )}

              <section className="flex flex-col gap-3">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={TH}>Fund</th>
                        <th className={TH_R}>Balance</th>
                        <th className={TH_R}>Fee</th>
                        <th className={TH_R}>Fee cost</th>
                        <th className={TH}>Deposits</th>
                        <th className={`${TH} w-9`} aria-label="More" />
                      </tr>
                    </thead>
                    <tbody>
                      {ordered.map((entry) => (
                        <FundTableRow
                          key={entry.fund.id}
                          entry={entry}
                          open={entry.fund.id === openId}
                          check={checks.get(entry.fund.id)}
                          months={missingMonths.get(entry.fund.id) ?? []}
                          institutions={institutions}
                          asOf={now}
                          onMenu={(at) =>
                            setMenu({ at, items: rowMenu(entry), title: entry.fund.name })
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                {confirmingEntry !== undefined && (
                  <div className="fc-pop-enter flex flex-wrap items-center gap-3 border border-hairline bg-surface px-4 py-2">
                    <span>
                      Delete <Bidi>{confirmingEntry.fund.name}</Bidi> and every reading?
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirming(undefined)
                        write((database, at) => deleteFund(database, confirmingEntry.fund.id, at))
                      }}
                    >
                      Delete it
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(undefined)}>
                      Keep it
                    </Button>
                  </div>
                )}
              </section>

              {/* Fee impact, a section of this page (M28 U8, D-327). It was a tab, and what it
                  shows is a question about one of the funds above. */}
              <details className="border border-hairline bg-surface p-3.5" open={onFees}>
                <summary className="cursor-pointer py-1.5 text-accent">What the fee costs over the years</summary>
                <div className="mt-2 border border-hairline bg-background">
                  <FeeImpact embedded />
                </div>
              </details>

              {/* The deposit check, a section of this page as fee impact is (M36 U10): it was a
                  page of its own, reached from the Deposits column, and its path opens this one. */}
              <details className="border border-hairline bg-surface p-3.5" open={onDeposits}>
                <summary className="cursor-pointer py-1.5 text-accent">Did every deposit arrive</summary>
                <div className="mt-2 border border-hairline bg-background">
                  <DepositCheck />
                </div>
              </details>
            </>
          )}
        </Screen>
      </div>
      {menu !== undefined && (
        <ContextMenu
          at={menu.at}
          items={menu.items}
          onClose={() => setMenu(undefined)}
          header={{ title: <Bidi>{menu.title}</Bidi> }}
        />
      )}
    </div>
  )
}

interface EditingFund {
  readonly isNew: boolean
  readonly fund: FundAccount
}

interface EditingSnapshot {
  readonly isNew: boolean
  readonly snapshot: FundBalanceSnapshot
}

/**
 * What the total does and does not cover.
 *
 * The middle case is the one worth spelling out: a total over three funds when
 * a fourth has never been entered is not the household's long-term savings, and
 * a figure that did not say so would be wrong by however much that fund holds.
 */
function savingsHint(totals: ReturnType<typeof longTermSavings>): string {
  if (totals.withoutSnapshot === 0) return `${String(totals.funds)} ${totals.funds === 1 ? 'fund' : 'funds'}`
  if (totals.withoutSnapshot === totals.funds) {
    return totals.funds === 1
      ? 'no reading yet — add one and the balance appears here'
      : 'no readings yet — add one and the balance appears here'
  }
  return totals.withoutSnapshot === 1
    ? '1 fund has no reading yet and is not in this'
    : `${totals.withoutSnapshot} funds have no reading yet and are not in this`
}

/** Creates a fund manager from the editor's own box and hands back its id. */
function addManager(
  mutate: (work: (database: import('sql.js').Database) => void) => void,
  name: string,
): string | undefined {
  let id: string | undefined
  mutate((database) => {
    id = createInstitution(database, { name, kind: 'FUND_MANAGER' }, Date.now()).id
  })
  return id
}

function FundTableRow({
  entry,
  open,
  check,
  months,
  institutions,
  asOf,
  onMenu,
}: {
  entry: FundWithLatest
  /** Its detail is the pane beside this list (D-130). */
  open: boolean
  check: DepositReconciliation | undefined
  months: readonly MonthlyDeposit[]
  institutions: readonly Institution[]
  asOf: LocalDate
  onMenu: (at: { x: number; y: number }) => void
}) {
  const { fund, latest } = entry
  const freshness = snapshotFreshness(latest?.asOfDate, asOf)
  const manager = institutions.find((institution) => institution.id === fund.institutionId)
  const agreement = feeAgreementStatus(fund, asOf)
  const liquidity = studyFundLiquidity(fund)
  const cost = latest === undefined ? undefined : annualFeeCost(latest.totalBalance, fund.fees)

  return (
    <tr className={open ? 'bg-accent-soft' : ''}>
      <td className={`${GTD} min-w-[170px]`}>
        <Link
          to={`/wealth/funds/${fund.id}`}
          className="border-b border-hairline-strong font-medium text-ink hover:border-accent hover:text-accent"
        >
          <Bidi>{fund.name}</Bidi>
        </Link>
        <div className="text-caption text-ink-tertiary">
          {FUND_TYPE_LABEL[fund.fundType]}
          {manager !== undefined && <> · {manager.name}</>}
          {fund.status === 'DORMANT' && <> · dormant</>}
          {fund.status === 'CLOSED' && <> · closed</>}
          {fund.isArchived && <> · archived</>}
        </div>
        {agreement.kind === 'LAPSED' && (
          <div className="text-caption text-negative">
            Fee agreement ended {toISODate(agreement.since)}
          </div>
        )}
        {agreement.kind === 'EXPIRING_SOON' && (
          <div className="text-caption text-ink-tertiary">
            Fee agreement ends {toISODate(agreement.until)}
          </div>
        )}
        {liquidity !== undefined && (
          <div className="text-caption text-ink-tertiary">
            Withdrawable {toISODate(liquidity.liquidAt)}
          </div>
        )}
      </td>
      <td className={GTD_R}>
        {latest === undefined ? '—' : formatMoney(latest.totalBalance)}
        <Need>
          <span className={freshness === 'VERY_STALE' ? 'text-negative' : ''}>{FRESHNESS_NOTE[freshness](latest?.asOfDate)}</span>
        </Need>
      </td>
      <td className={GTD_R}>
        {fund.fees.onAccumulationBasisPoints === undefined
          ? '—'
          : formatPercent(fund.fees.onAccumulationBasisPoints, { digits: 2 })}
      </td>
      <td className={GTD_R}>
        {cost === undefined ? '—' : `${formatMoney(cost)} a year`}
      </td>
      <td className={GTD}>
        <Link to="/wealth/deposits" title="The deposit check in full">
          <DepositChip check={check} dormant={fund.status === 'DORMANT'} months={months} />
        </Link>
      </td>
      <td className={`${GTD} w-9 px-0`}>
        <button
          type="button"
          aria-label={`More for ${fund.name}`}
          title="More"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            onMenu({ x: box.left, y: box.bottom })
          }}
          className="fc-icon-action"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
            <circle cx="3.5" cy="8" r="1.2" />
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="12.5" cy="8" r="1.2" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

/**
 * What the deposit check found, as one line.
 *
 * Every "not enough data" variant says which thing is missing rather than
 * falling silent, because on this screen silence and "everything is fine" would
 * look identical — and the whole feature exists to make a gap visible.
 */
function DepositChip({
  check,
  dormant,
  months,
}: {
  check: DepositReconciliation | undefined
  dormant: boolean
  /** Months the fund's own deposit table says fell short (D-389). */
  months: readonly MonthlyDeposit[]
}) {
  if (dormant) return <Tag tone="warn">Dormant, still charging</Tag>
  if (months.length > 0) {
    const parts = [...new Set(months.flatMap((one) => one.missingParts))]
    return (
      <Tag tone="bad">
        {months.length === 1 ? `${formatMonthShort(months[0]?.period ?? { year: 0, month: 1 })} short` : `${String(months.length)} months short`}
        {parts.length > 0 && <> · no {parts.join(' or ')} part</>}
      </Tag>
    )
  }
  if (check === undefined) return null
  if (check.kind === 'NEEDS_TWO_POINTS') {
    return <Tag>{check.snapshotCount === 0 ? 'No reading yet' : 'One reading: add a second'}</Tag>
  }
  if (check.kind === 'NO_FUND_REPORT') return <Tag>No deposits reported</Tag>
  if (check.kind === 'WINDOW_TOO_SHORT') return <Tag>Readings too close</Tag>
  if (check.kind === 'NO_PAYSLIP_DATA') return <Tag>No paychecks to check</Tag>
  const missing = check.status === 'DEPOSITS_MISSING'
  return (
    <Tag tone={missing ? 'bad' : check.status === 'DEPOSITS_EXCEED_PAYSLIPS' ? 'warn' : 'good'}>
      {DEPOSIT_STATUS_LABEL[check.status]}
      {missing && <> · {formatMoney(check.gap)}</>}
    </Tag>
  )
}

const FRESHNESS_NOTE: Readonly<Record<SnapshotFreshness, (date: LocalDate | undefined) => string>> =
  {
    NONE: () => 'no reading yet',
    FRESH: (date) => (date === undefined ? '' : `as of ${toISODate(date)}`),
    STALE: (date) => (date === undefined ? '' : `as of ${toISODate(date)} — getting old`),
    VERY_STALE: (date) => (date === undefined ? '' : `as of ${toYearMonthString(yearMonthOf(date))} — over a year ago`),
  }

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
