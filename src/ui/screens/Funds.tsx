import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { money, type CurrencyCode } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { yearMonthOf, type LocalDate } from '@/core/time.ts'
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
import { createInstitution, listInstitutions, type Institution } from '@/data/repositories/institutionRepository.ts'
import {
  annualFeeCost,
  feeAgreementStatus,
  longTermSavings,
  snapshotFreshness,
  studyFundLiquidity,
  type DepositReconciliation,
  type FundWithLatest,
  type MonthlyDeposit,
} from '@/domain/funds.ts'
import type { FundAccount, FundBalanceSnapshot } from '@/domain/model/funds.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { kitMoney, wholeMoney } from '@/ui/charts/kit.ts'
import { Button } from '@/ui/components/Button.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState, WaitingList, type Waiting } from '@/ui/components/WaitingList.tsx'
import { blankFund, FundEditor } from '@/ui/funds/FundEditor.tsx'
import { blankSnapshot, SnapshotEditor } from '@/ui/funds/SnapshotEditor.tsx'
import { DepositCheck } from '@/ui/screens/DepositCheck.tsx'
import { FeeImpact } from '@/ui/screens/FeeImpact.tsx'
import { Problem } from '@/ui/screens/Overview.tsx'
import { today } from '@/ui/today.ts'
import { MoreButton, removeQuestion, type Menu } from '@/ui/wealth/rowMenu.tsx'
import { useWealthWords, type WealthWords } from '@/ui/wealth/words.ts'

/**
 * **Funds, answered first** (M64 U10, D-622): *are my pension and study funds
 * doing what they should, and what do their fees cost me?* One sentence says
 * what they hold and what the fees take a year; the total is the one display
 * figure; what needs a call — a missing deposit, a dormant fund still
 * charging, a fund with no reading, a fee agreement that ended — is one list
 * below it, a verb each. Then the funds, one row each.
 *
 * **What explains a fund opens beside the page** (D-617): the row opens the
 * fund itself (D-130's pane, beside this list); its fee opens what the fee
 * costs over the years (`FeeImpact`), its deposits the deposit check, both in
 * the side panel. `#/wealth/fees` and `#/wealth/deposits` still open this
 * screen with that panel open, as they did (M28 U8, M36 U10).
 *
 * **Dormant funds still say their fee** (docs/f13): a balance from a job three
 * years ago is still paying a management fee every year, and it is the one line
 * here that exists to make someone pick up the phone.
 */
export function Funds() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const t = useT()
  const words = useWealthWords()
  const navigate = useNavigate()
  const pathname = useLocation().pathname
  const landing = useLocation().state as { readonly fund?: string } | null

  const [editingFund, setEditingFund] = useState<EditingFund | undefined>()
  const [editingSnapshot, setEditingSnapshot] = useState<EditingSnapshot | undefined>()
  const [problem, setProblem] = useState<string | undefined>()
  const [showArchived, setShowArchived] = useState(false)
  const [menu, setMenu] = useState<Menu | undefined>()
  // The paths that name a panel open this screen with it open (M28 U8, M36 U10).
  const [panel, setPanel] = useState<Panel | undefined>(() =>
    pathname.endsWith('/fees') ? { kind: 'fees', fund: landing?.fund } : pathname.endsWith('/deposits') ? { kind: 'deposits' } : undefined,
  )
  // Which fund the pane beside this list is showing, if any (D-130).
  const { fundId: openId } = useParams<{ fundId: string }>()

  const entries = useMemo(() => (db === undefined ? [] : listFundsWithLatest(db, { includeArchived: showArchived })), [db, revision, showArchived])
  const currency: CurrencyCode = entries.find((entry) => entry.latest !== undefined)?.latest?.totalBalance.currency ?? 'ILS'
  const checks = useMemo(
    () => (db === undefined ? new Map<string, DepositReconciliation>() : fundDepositChecks(db, currency, { includeArchived: showArchived })),
    [db, revision, currency, showArchived],
  )
  // A month the fund's own table says fell short — a missing employer deposit —
  // fails here on one report, before any window can (D-389).
  const missingMonths = useMemo(
    () => (db === undefined ? new Map<string, readonly MonthlyDeposit[]>() : fundMissingMonths(db, { includeArchived: showArchived })),
    [db, revision, showArchived],
  )
  const institutions = useMemo(
    () => (db === undefined ? [] : [...listInstitutions(db, { kind: 'FUND_MANAGER' }), ...listInstitutions(db, { kind: 'INVESTMENT_PLATFORM' })]),
    [db, revision],
  )

  if (db === undefined) {
    return <Centered>{t('wealth.funds.noDocument')}</Centered>
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
            const fields = {
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
            }
            if (editingFund.isNew) createFund(database, fields, now)
            else updateFund(database, fund.id, fields, now)
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

  const totals = longTermSavings(entries, currency)
  const now = today()
  const ordered = [
    ...entries.filter((entry) => entry.fund.status === 'ACTIVE'),
    ...entries.filter((entry) => entry.fund.status === 'DORMANT'),
    ...entries.filter((entry) => entry.fund.status === 'CLOSED'),
  ]
  const yearly = money(
    entries.reduce((running, entry) => running + (entry.latest === undefined ? 0 : (annualFeeCost(entry.latest.totalBalance, entry.fund.fees)?.minor ?? 0)), 0),
    currency,
  )
  const read = totals.funds - totals.withoutSnapshot

  /** One panel beside the page at a time: opening one puts a fund's pane away, and the other way round. */
  const openPanel = (next: Panel): void => {
    setPanel(next)
    if (openId !== undefined) void navigate('/wealth/funds')
  }
  const openFund = (entry: FundWithLatest): void => {
    setPanel(undefined)
    void navigate(`/wealth/funds/${entry.fund.id}`)
  }
  const addReading = (entry: FundWithLatest): void => setEditingSnapshot({ isNew: true, snapshot: blankSnapshot(entry.fund.id, now, currency) })

  // What needs a call, a line each: money that did not arrive, a fund charging for nothing, a figure missing.
  const waiting: Waiting[] = ordered.flatMap((entry): Waiting[] => {
    const { fund } = entry
    const months = missingMonths.get(fund.id) ?? []
    const check = checks.get(fund.id)
    const lines: Waiting[] = []
    if (months.length > 0) {
      lines.push({
        key: `${fund.id}:short`,
        say: t(countKey('wealth.funds.waiting.short', months.length), { name: fund.name, count: months.length }),
        why: t('wealth.funds.waiting.shortWhy'),
        verb: t('wealth.funds.waiting.check'),
        onDo: () => openPanel({ kind: 'deposits' }),
      })
    } else if (check?.kind === 'CHECKED' && check.status === 'DEPOSITS_MISSING') {
      lines.push({
        key: `${fund.id}:missing`,
        say: t('wealth.funds.waiting.missing', { name: fund.name, amount: kitMoney(check.gap) }),
        why: t('wealth.funds.waiting.missingWhy'),
        verb: t('wealth.funds.waiting.check'),
        onDo: () => openPanel({ kind: 'deposits' }),
      })
    }
    if (fund.status === 'DORMANT') {
      const cost = entry.latest === undefined ? undefined : annualFeeCost(entry.latest.totalBalance, fund.fees)
      lines.push({
        key: `${fund.id}:dormant`,
        say: cost === undefined ? t('wealth.funds.waiting.dormant', { name: fund.name }) : t('wealth.funds.waiting.dormantCost', { name: fund.name, amount: wholeMoney(cost) }),
        why: t('wealth.funds.waiting.dormantWhy'),
        verb: t('wealth.funds.waiting.open'),
        onDo: () => openFund(entry),
      })
    }
    if (entry.latest === undefined && fund.status !== 'CLOSED') {
      lines.push({
        key: `${fund.id}:reading`,
        say: t('wealth.funds.waiting.noReading', { name: fund.name }),
        why: t('wealth.funds.waiting.noReadingWhy'),
        verb: t('wealth.funds.waiting.addReading'),
        onDo: () => addReading(entry),
      })
    }
    const agreement = feeAgreementStatus(fund, now)
    if (agreement.kind === 'LAPSED') {
      lines.push({
        key: `${fund.id}:lapsed`,
        say: t('wealth.funds.waiting.lapsed', { name: fund.name, day: words.dates.dayMonth(agreement.since) }),
        why: t('wealth.funds.waiting.lapsedWhy'),
        verb: t('wealth.funds.waiting.open'),
        onDo: () => openFund(entry),
      })
    }
    return lines
  })

  // Funds whose deposits nothing can check yet, said once, with what each needs one click behind (DepositCheck's *Not checkable yet*).
  const unchecked = ordered.filter((entry) => {
    const check = checks.get(entry.fund.id)
    return entry.fund.status === 'ACTIVE' && (missingMonths.get(entry.fund.id) ?? []).length === 0 && check !== undefined && check.kind !== 'CHECKED'
  }).length
  if (unchecked > 0) {
    waiting.push({
      key: 'unchecked',
      say: t(countKey('wealth.funds.waiting.unchecked', unchecked), { count: unchecked }),
      why: t('wealth.funds.waiting.uncheckedWhy'),
      verb: t('wealth.funds.waiting.why'),
      onDo: () => openPanel({ kind: 'deposits' }),
    })
  }

  const rowMenu = (entry: FundWithLatest, at: { x: number; y: number }): MenuItem[] => [
    { label: t('wealth.funds.menu.addReading'), icon: 'add', onChoose: () => addReading(entry) },
    { label: t('wealth.common.edit'), icon: 'edit', onChoose: () => setEditingFund({ isNew: false, fund: entry.fund }) },
    {
      label: entry.fund.isArchived ? t('wealth.funds.menu.unarchive') : t('wealth.funds.menu.archive'),
      onChoose: () => write((database, stamp) => setFundArchived(database, entry.fund.id, !entry.fund.isArchived, stamp)),
    },
    {
      label: t('wealth.common.delete'),
      icon: 'trash',
      separated: true,
      // Deleting a fund takes its readings and unaims Plan's buckets: nothing to undo it with, so it asks, where the menu was.
      onChoose: () =>
        setMenu(
          removeQuestion(at, t('wealth.funds.menu.deleteQuestion', { name: entry.fund.name }), t('wealth.funds.menu.deleteCost'), words, () =>
            write((database, stamp) => deleteFund(database, entry.fund.id, stamp)),
          ),
        ),
    },
  ]

  const page = (
    <div className="fc-view-enter flex flex-col gap-8 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="m-0 text-title leading-tight font-medium">{t('wealth.funds.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="primary" icon="add" onClick={() => setEditingFund({ isNew: true, fund: blankFund() })}>
            {t('wealth.funds.add')}
          </Button>
          <PageMenu
            title={t('wealth.funds.title')}
            items={[
              { label: t('wealth.funds.menu.readers'), detail: t('wealth.funds.menu.readersWhy'), onChoose: () => navigate('/read/readers') },
              { label: showArchived ? t('wealth.funds.menu.hideArchived') : t('wealth.funds.menu.showArchived'), separated: true, onChoose: () => setShowArchived(!showArchived) },
            ]}
          />
        </div>
      </header>

      {problem !== undefined && <Problem text={problem} onDismiss={() => setProblem(undefined)} />}

      {entries.length === 0 ? (
        <EmptyState say={t('wealth.funds.empty')} verb={t('wealth.funds.add')} onDo={() => setEditingFund({ isNew: true, fund: blankFund() })} />
      ) : (
        <>
          <div className="flex flex-col gap-6">
            <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">
              {read === 0
                ? t(countKey('wealth.funds.sentenceNone', totals.funds), { count: totals.funds })
                : t(countKey('wealth.funds.sentence', read), { count: read, total: wholeMoney(totals.total), fees: wholeMoney(yearly) })}
            </p>
            {/* No reading anywhere is not a balance of zero (docs/f13). */}
            <HeadlineFigure
              size="display"
              label={t('wealth.funds.figure')}
              value={read === 0 ? undefined : totals.total}
              change={
                totals.withoutSnapshot > 0
                  ? t(countKey('wealth.funds.notIn', totals.withoutSnapshot), { count: totals.withoutSnapshot })
                  : totals.severance.minor !== 0
                    ? t('wealth.funds.severance', { amount: wholeMoney(totals.severance) })
                    : t('wealth.funds.figureHow')
              }
              empty={t('wealth.funds.figureEmpty')}
            />
          </div>

          <WaitingList label={t('wealth.common.waiting')} items={waiting} />

          <section className="flex flex-col gap-3" aria-labelledby="funds-all">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 id="funds-all" className="m-0 text-heading font-medium">
                {t('wealth.funds.list.title')}
              </h2>
              <span className="flex flex-wrap gap-x-4">
                <button type="button" className="fc-text-action" onClick={() => openPanel({ kind: 'fees', fund: undefined })}>
                  {t('wealth.funds.list.feesOver')}
                </button>
                <button type="button" className="fc-text-action" onClick={() => openPanel({ kind: 'deposits' })}>
                  {t('wealth.funds.list.depositsArrived')}
                </button>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-hairline text-caption text-ink-secondary uppercase">
                    <th className="h-8 pe-3 text-start font-medium">{t('wealth.funds.list.fund')}</th>
                    <th className="h-8 pe-3 text-end font-medium">{t('wealth.funds.list.balance')}</th>
                    <th className="h-8 pe-3 text-end font-medium">{t('wealth.funds.list.fee')}</th>
                    <th className="h-8 pe-3 text-end font-medium">{t('wealth.funds.list.feeYear')}</th>
                    <th className="h-8 pe-3 text-start font-medium">{t('wealth.funds.list.deposits')}</th>
                    <th className="h-8 w-9" aria-label={t('wealth.common.more')} />
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((entry) => (
                    <FundRow
                      key={entry.fund.id}
                      entry={entry}
                      on={entry.fund.id === openId}
                      check={checks.get(entry.fund.id)}
                      months={missingMonths.get(entry.fund.id) ?? []}
                      institutions={institutions}
                      asOf={now}
                      words={words}
                      onOpen={() => openFund(entry)}
                      onFee={() => openPanel({ kind: 'fees', fund: entry.fund.id })}
                      onDeposits={() => openPanel({ kind: 'deposits' })}
                      onMenu={(at) => setMenu({ at, items: rowMenu(entry, at), title: entry.fund.name })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )

  const feeFund = panel?.kind === 'fees' ? entries.find((entry) => entry.fund.id === panel.fund) : undefined
  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>
      {panel?.kind === 'fees' && (
        <SidePanel
          title={t('wealth.funds.feesPanel')}
          kicker={feeFund === undefined ? t('wealth.funds.title') : feeFund.fund.name}
          onClose={() => setPanel(undefined)}
        >
          <FeeImpact key={panel.fund ?? 'first'} panel fundId={panel.fund} />
        </SidePanel>
      )}
      {panel?.kind === 'deposits' && (
        <SidePanel title={t('wealth.funds.depositsPanel')} kicker={t('wealth.funds.title')} onClose={() => setPanel(undefined)}>
          {/* The check draws its own hairlines edge to edge; the panel's padding is given back to them. */}
          <div className="-mx-6">
            <DepositCheck />
          </div>
        </SidePanel>
      )}
      {menu !== undefined && <ContextMenu key={String(menu.title)} at={menu.at} items={menu.items} onClose={() => setMenu(undefined)} header={{ title: <Bidi>{menu.title}</Bidi>, ...(menu.sub === undefined ? {} : { sub: menu.sub }) }} />}
    </div>
  )
}

/** What the side panel shows: what a fee costs over the years, for one fund, or the deposit check. */
type Panel = { readonly kind: 'fees'; readonly fund: string | undefined } | { readonly kind: 'deposits' }

interface EditingFund {
  readonly isNew: boolean
  readonly fund: FundAccount
}

interface EditingSnapshot {
  readonly isNew: boolean
  readonly snapshot: FundBalanceSnapshot
}

/** Creates a fund manager from the editor's own box and hands back its id. */
function addManager(mutate: (work: (database: import('sql.js').Database) => void) => void, name: string): string | undefined {
  let id: string | undefined
  mutate((database) => {
    id = createInstitution(database, { name, kind: 'FUND_MANAGER' }, Date.now()).id
  })
  return id
}

/**
 * One fund: the whole row opens it beside the list; its fee opens what the fee
 * costs, its deposits the check. Up and Down walk the rows.
 */
function FundRow({
  entry,
  on,
  check,
  months,
  institutions,
  asOf,
  words,
  onOpen,
  onFee,
  onDeposits,
  onMenu,
}: {
  readonly entry: FundWithLatest
  readonly on: boolean
  readonly check: DepositReconciliation | undefined
  readonly months: readonly MonthlyDeposit[]
  readonly institutions: readonly Institution[]
  readonly asOf: LocalDate
  readonly words: WealthWords
  readonly onOpen: () => void
  readonly onFee: () => void
  readonly onDeposits: () => void
  readonly onMenu: (at: { x: number; y: number }) => void
}) {
  const { t, dates } = words
  const { fund, latest } = entry
  const freshness = snapshotFreshness(latest?.asOfDate, asOf)
  const manager = institutions.find((institution) => institution.id === fund.institutionId)
  const liquidity = studyFundLiquidity(fund)
  const cost = latest === undefined ? undefined : annualFeeCost(latest.totalBalance, fund.fees)
  const cell = `h-10 border-t border-hairline pe-3 align-middle ${on ? 'bg-surface' : 'group-hover:bg-surface'}`
  const status = fund.status === 'DORMANT' ? t('wealth.funds.list.dormant') : fund.status === 'CLOSED' ? t('wealth.funds.list.closed') : undefined
  const asOfWords =
    latest === undefined
      ? t('wealth.funds.list.noReading')
      : freshness === 'VERY_STALE'
        ? t('wealth.funds.list.overAYear', { month: dates.monthShort(yearMonthOf(latest.asOfDate)) })
        : freshness === 'STALE'
          ? t('wealth.funds.list.gettingOld', { day: dates.dayMonth(latest.asOfDate) })
          : t('wealth.funds.list.asOf', { day: dates.dayMonth(latest.asOfDate) })

  return (
    <tr
      className="group cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      tabIndex={0}
      aria-current={on ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(event) => rowKeys(event, onOpen)}
    >
      <td className={`${cell} min-w-44 py-2`}>
        <Bidi className="font-medium">{fund.name}</Bidi>
        <span className="block text-caption text-ink-secondary">
          {[words.fund[fund.fundType], status, fund.isArchived ? t('wealth.funds.list.archived') : undefined].filter((one) => one !== undefined).join(' · ')}
          {manager !== undefined && (
            <>
              {' · '}
              <Bidi>{manager.name}</Bidi>
            </>
          )}
          {liquidity !== undefined && <> · {t('wealth.funds.list.withdrawable', { day: dates.dayMonth(liquidity.liquidAt) })}</>}
        </span>
      </td>
      <td className={`${cell} py-2 text-end whitespace-nowrap tabular-nums`}>
        {latest === undefined ? '—' : kitMoney(latest.totalBalance)}
        <span className={`block text-caption ${freshness === 'VERY_STALE' ? 'text-negative' : 'text-ink-secondary'}`}>{asOfWords}</span>
      </td>
      <td className={`${cell} text-end whitespace-nowrap tabular-nums`}>
        {fund.fees.onAccumulationBasisPoints === undefined ? '—' : formatPercent(fund.fees.onAccumulationBasisPoints, { digits: 2 })}
      </td>
      <td className={`${cell} text-end whitespace-nowrap tabular-nums`}>
        <button
          type="button"
          className="tabular-nums underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          title={t('wealth.funds.list.feeYearTitle')}
          onClick={(event) => {
            event.stopPropagation()
            onFee()
          }}
        >
          {cost === undefined ? '—' : kitMoney(cost)}
        </button>
      </td>
      <td className={cell}>
        <button
          type="button"
          className="text-start"
          title={t('wealth.funds.list.depositsTitle')}
          onClick={(event) => {
            event.stopPropagation()
            onDeposits()
          }}
        >
          <DepositWords check={check} dormant={fund.status === 'DORMANT'} months={months} words={words} />
        </button>
      </td>
      <td className={`${cell} w-9 pe-0`}>
        <MoreButton label={t('wealth.common.moreFor', { name: fund.name })} onMenu={onMenu} />
      </td>
    </tr>
  )
}

/** Enter opens the row; Up and Down walk the rows, as in any list. */
export function rowKeys(event: KeyboardEvent<HTMLTableRowElement>, onOpen: () => void): void {
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter') {
    event.preventDefault()
    onOpen()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const next = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling
  if (next instanceof HTMLElement && next.tabIndex === 0) {
    event.preventDefault()
    next.focus()
  }
}

/**
 * What the deposit check found, as a few words and a dot.
 *
 * Every "not enough data" variant says which thing is missing rather than
 * falling silent: on this screen silence and "everything is fine" would look
 * identical, and the whole feature exists to make a gap visible.
 */
function DepositWords({
  check,
  dormant,
  months,
  words,
}: {
  readonly check: DepositReconciliation | undefined
  readonly dormant: boolean
  /** Months the fund's own deposit table says fell short (D-389). */
  readonly months: readonly MonthlyDeposit[]
  readonly words: WealthWords
}) {
  const { t, dates } = words
  if (dormant) return <Said tone="plain">{t('wealth.funds.deposits.dormant')}</Said>
  if (months.length > 0) {
    const first = months[0]
    return (
      <Said tone="bad">
        {months.length === 1 && first !== undefined ? t('wealth.funds.deposits.monthShort', { month: dates.monthShort(first.period) }) : t('wealth.funds.deposits.monthsShort', { count: months.length })}
      </Said>
    )
  }
  if (check === undefined) return null
  if (check.kind === 'NEEDS_TWO_POINTS') return <Said tone="plain">{check.snapshotCount === 0 ? t('wealth.funds.deposits.noReading') : t('wealth.funds.deposits.oneReading')}</Said>
  if (check.kind === 'NO_FUND_REPORT') return <Said tone="plain">{t('wealth.funds.deposits.noReport')}</Said>
  if (check.kind === 'WINDOW_TOO_SHORT') return <Said tone="plain">{t('wealth.funds.deposits.tooClose')}</Said>
  if (check.kind === 'NO_PAYSLIP_DATA') return <Said tone="plain">{t('wealth.funds.deposits.noPaychecks')}</Said>
  const missing = check.status === 'DEPOSITS_MISSING'
  return (
    <Said tone={missing ? 'bad' : 'plain'}>
      {words.deposit[check.status]}
      {missing && <> · {kitMoney(check.gap)}</>}
    </Said>
  )
}

/** A chip is text and a dot, and colour only for a problem. */
function Said({ tone, children }: { readonly tone: 'plain' | 'bad'; readonly children: ReactNode }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 text-caption ${tone === 'bad' ? 'text-negative' : 'text-ink-secondary'}`}>
      <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full ${tone === 'bad' ? 'bg-negative' : 'bg-ink-secondary'}`} />
      <span>{children}</span>
    </span>
  )
}

function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
