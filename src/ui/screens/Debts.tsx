import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { fromMajorUnits, money, type CurrencyCode } from '@/core/money.ts'
import { addMonths, compareYearMonths, type YearMonth } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import { listAccounts } from '@/data/repositories/accountRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import {
  addPayment,
  confirmPayment,
  createDebt,
  declineInstallmentGroup,
  deleteDebt,
  deletePayment,
  dismissAmbiguity,
  dismissPayment,
  installmentCandidates,
  listDebts,
  listPayments,
  paymentReview,
  promoteInstallmentGroup,
  readInstallmentPromotion,
  resolveAmbiguity,
  setDebtClosed,
  setInstallmentOffers,
  setInstallmentThreshold,
  updateDebt,
  updatePayment,
  type DebtRow,
} from '@/data/repositories/debtRepository.ts'
import { listFixedExpenses } from '@/data/repositories/fixedExpenseRepository.ts'
import { debtsPlan, type DebtPlanRow } from '@/data/repositories/debtPlanRepository.ts'
import { setBucketMonthly } from '@/data/repositories/goalPlanRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { leftAfter } from '@/domain/debtPlan.ts'
import type { Debt, DebtPayment } from '@/domain/model/debt.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { kitMoney, wholeMoney } from '@/ui/charts/kit.ts'
import { PlanAgainst } from '@/ui/charts/PlanAgainst.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { editableMoney } from '@/ui/components/moneyText.ts'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { EmptyState, WaitingList, type Waiting } from '@/ui/components/WaitingList.tsx'
import { blankDebt, DebtEditor } from '@/ui/debts/DebtEditor.tsx'
import { blankPayment, PaymentEditor } from '@/ui/debts/PaymentEditor.tsx'
import { PaymentReview } from '@/ui/debts/PaymentReview.tsx'
import { SplitPurchases } from '@/ui/debts/SplitPurchases.tsx'
import { rowKeys } from '@/ui/screens/Funds.tsx'
import { Problem } from '@/ui/screens/Overview.tsx'
import { today } from '@/ui/today.ts'
import { AMOUNT_FIELD, Seg } from '@/ui/wealth/parts.tsx'
import { MoreButton, removeQuestion, type Menu } from '@/ui/wealth/rowMenu.tsx'
import { useWealthWords, type WealthWords } from '@/ui/wealth/words.ts'

/**
 * **Debts, answered first** (M64 U10, D-622): *how much do I still owe, and
 * when is it paid off?* One sentence says what is left, what goes in each
 * month and when the last one ends; what is left is the one display figure;
 * each debt is a meter, paid of what was borrowed. What waits — payments the
 * app found, a purchase split into payments it offers as a debt, a debt
 * nothing goes toward — is one list below, a verb each. Then the debts, one row
 * each, with Plan's extra typed in place.
 *
 * **Every figure comes from one `debtsSummary` call** (D-084), through
 * `debtsPlan`, so the meter, the row and the total cannot disagree. **The review
 * queue and the split purchases are views of this screen** (D-055, D-076): a
 * verb in the waiting list opens them, with one way back.
 */
type View = 'DEBTS' | 'REVIEW' | 'SPLIT'
type Horizon = 6 | 12 | 24

export function Debts() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const t = useT()
  const words = useWealthWords()
  const navigate = useNavigate()

  const [view, setView] = useState<View>('DEBTS')
  const [editingDebt, setEditingDebt] = useState<{ isNew: boolean; debt: Debt } | undefined>()
  const [editingPayment, setEditingPayment] = useState<{ isNew: boolean; payment: DebtPayment } | undefined>()
  const [problem, setProblem] = useState<string | undefined>()
  const [showClosed, setShowClosed] = useState(false)
  const [horizon, setHorizon] = useState<Horizon>(12)
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({})
  const [menu, setMenu] = useState<Menu | undefined>()
  const { debtId: openId } = useParams<{ debtId: string }>()

  const asOf = today()
  const currency: CurrencyCode = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])
  const read = useMemo(() => (db === undefined ? undefined : debtsPlan(db, asOf, currency)), [db, revision])
  const review = useMemo(() => (db === undefined ? undefined : paymentReview(db)), [db, revision])
  const debts = useMemo(() => (db === undefined ? [] : listDebts(db, { includeClosed: true })), [db, revision])
  const accounts = useMemo(() => (db === undefined ? [] : listAccounts(db)), [db, revision])
  const categories = useMemo(() => (db === undefined ? [] : listCategories(db)), [db, revision])
  const expenses = useMemo(() => (db === undefined ? [] : listFixedExpenses(db)), [db, revision])
  const payments = useMemo(() => (db === undefined ? [] : listPayments(db)), [db, revision])
  const candidates = useMemo(() => (db === undefined ? [] : installmentCandidates(db)), [db, revision])
  const promotion = useMemo(() => (db === undefined ? undefined : readInstallmentPromotion(db)), [db, revision])

  if (db === undefined || read === undefined || review === undefined || promotion === undefined) {
    return <Centered>{t('wealth.debts.noDocument')}</Centered>
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

  if (editingDebt !== undefined) {
    return (
      <DebtEditor
        key={editingDebt.debt.id}
        initial={editingDebt.debt}
        isNew={editingDebt.isNew}
        accounts={accounts}
        categories={categories}
        others={debts}
        expenses={expenses}
        currency={currency}
        onSave={(debt) => {
          const saved = write((database, now) => {
            const fields = {
              name: debt.name,
              kind: debt.kind,
              principalAmount: debt.principalAmount,
              openedDate: debt.openedDate,
              expectedEndDate: debt.expectedEndDate,
              monthlyPaymentAmount: debt.monthlyPaymentAmount,
              linkedAccountId: debt.linkedAccountId,
              tracking: debt.tracking,
              note: debt.note,
            }
            if (editingDebt.isNew) createDebt(database, fields, now)
            else updateDebt(database, debt.id, fields, now)
          })
          if (saved) setEditingDebt(undefined)
        }}
        onCancel={() => setEditingDebt(undefined)}
      />
    )
  }

  if (editingPayment !== undefined) {
    return (
      <PaymentEditor
        key={editingPayment.payment.id}
        initial={editingPayment.payment}
        isNew={editingPayment.isNew}
        debts={debts}
        existing={payments}
        currency={currency}
        onSave={(payment) => {
          const saved = write((database, now) => {
            if (editingPayment.isNew) {
              addPayment(database, { debtId: payment.debtId, date: payment.date, amount: payment.amount, interestPortion: payment.interestPortion, note: payment.note }, now)
              return
            }
            updatePayment(
              database,
              payment.id,
              { debtId: payment.debtId, date: payment.date, amount: payment.amount, interestPortion: payment.interestPortion, isConfirmed: true, note: payment.note },
              now,
            )
          })
          if (saved) setEditingPayment(undefined)
        }}
        onCancel={() => setEditingPayment(undefined)}
      />
    )
  }

  const toReview = review.items.length + review.ambiguities.length + review.orphaned.length
  const { rows, plan } = read
  const months = horizon
  const newDebt = (): void => setEditingDebt({ isNew: true, debt: blankDebt(currency, asOf) })
  const openDebt = (id: string): void => void navigate(`/wealth/debts/${id}`)

  /** Plan's own write, the one the tools and Goals use (D-325, M28 F10). */
  const setExtra = (row: DebtPlanRow, minor: number): void => {
    if (plan === undefined) return
    write((database, now) => {
      const result = setBucketMonthly(database, asOf, currency, 'DEBT', row.line.debtId, t('wealth.debts.extraBucket', { name: row.line.name }), minor, now)
      if (result === 'SEVERAL_BUCKETS') throw new Error(t('wealth.debts.severalBuckets', { name: row.line.name }))
    })
  }

  const commit = (row: DebtPlanRow): void => {
    const text = typed[row.line.debtId]
    setTyped((current) => {
      const next = { ...current }
      delete next[row.line.debtId]
      return next
    })
    if (text === undefined) return
    const parsed = parseAmountText(text)
    if (parsed === undefined) return
    const minor = fromMajorUnits(Math.abs(parsed), currency).minor
    if (minor !== row.line.extra.minor) setExtra(row, minor)
  }

  const menuItems = (row: DebtRow, at: Menu['at']): MenuItem[] => [
    ...(row.debt.isClosed
      ? [{ label: t('wealth.debts.menu.reopen'), onChoose: () => write((database, now) => setDebtClosed(database, row.debt.id, false, now)) } satisfies MenuItem]
      : [{ label: t('wealth.debts.menu.addPayment'), icon: 'add', onChoose: () => setEditingPayment({ isNew: true, payment: blankPayment(row.debt, asOf) }) } satisfies MenuItem]),
    { label: t('wealth.common.edit'), icon: 'edit', onChoose: () => setEditingDebt({ isNew: false, debt: row.debt }) },
    ...(row.debt.isClosed
      ? []
      : [
          {
            label: t('wealth.debts.menu.close'),
            detail: row.balance.kind === 'KNOWN' && row.balance.isSettled ? t('wealth.debts.menu.closePaid') : t('wealth.debts.menu.closeWhy'),
            onChoose: () => write((database, now) => setDebtClosed(database, row.debt.id, true, now)),
          } satisfies MenuItem,
        ]),
    {
      label: t('wealth.common.delete'),
      icon: 'trash',
      separated: true,
      onChoose: () =>
        setMenu(
          removeQuestion(at, t('wealth.debts.menu.deleteQuestion', { name: row.debt.name }), t('wealth.debts.menu.deleteCost'), words, () =>
            write((database, now) => deleteDebt(database, row.debt.id, now)),
          ),
        ),
    },
  ]

  const pageMenu: MenuItem[] = [
    ...(debts.some((debt) => !debt.isClosed)
      ? [
          {
            label: t('wealth.debts.menu.recordPayment'),
            icon: 'add',
            onChoose: () => {
              const open = debts.find((debt) => !debt.isClosed)
              if (open !== undefined) setEditingPayment({ isNew: true, payment: blankPayment(open, asOf) })
            },
          } satisfies MenuItem,
        ]
      : []),
    { label: t('wealth.debts.menu.review'), detail: t('wealth.debts.menu.reviewWhy'), onChoose: () => setView('REVIEW') },
    { label: t('wealth.debts.menu.split'), detail: t('wealth.debts.menu.splitWhy'), onChoose: () => setView('SPLIT') },
    { label: showClosed ? t('wealth.debts.menu.hideClosed') : t('wealth.debts.menu.showClosed'), separated: true, onChoose: () => setShowClosed(!showClosed) },
  ]

  if (view !== 'DEBTS') {
    return (
      <div className="h-full overflow-auto">
        <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
          <header className="flex flex-col gap-1">
            <button type="button" className="fc-text-action self-start" onClick={() => setView('DEBTS')}>
              {t('wealth.debts.back')}
            </button>
            <h1 className="m-0 text-title leading-tight font-medium">{view === 'REVIEW' ? t('wealth.debts.review') : t('wealth.debts.split')}</h1>
          </header>
          {problem !== undefined && <Problem text={problem} onDismiss={() => setProblem(undefined)} />}
          {view === 'REVIEW' ? (
            <PaymentReview
              review={review}
              onConfirm={(item) => write((database, now) => confirmPayment(database, item.payment.id, now))}
              onConfirmAll={() =>
                write((database, now) => {
                  for (const item of review.items) confirmPayment(database, item.payment.id, now)
                })
              }
              onDismiss={(item) => write((database, now) => dismissPayment(database, item.payment.id, now))}
              onEdit={(item) => setEditingPayment({ isNew: false, payment: item.payment })}
              onResolve={(index, debtId) =>
                write((database, now) => {
                  const match = review.ambiguities[index]
                  if (match !== undefined) resolveAmbiguity(database, match, debtId, now)
                })
              }
              onDismissAmbiguity={(index) =>
                write((database, now) => {
                  const match = review.ambiguities[index]
                  if (match !== undefined) dismissAmbiguity(database, match.sourceRefId, now)
                })
              }
              onTighten={(debt) => setEditingDebt({ isNew: false, debt })}
              onDeleteOrphan={(item) => write((database, now) => deletePayment(database, item.payment.id, now))}
            />
          ) : (
            <>
              <SplitPurchases
                candidates={candidates}
                threshold={promotion.threshold}
                onPromote={(candidate) => write((database, now) => promoteInstallmentGroup(database, candidate, now))}
                onDecline={(candidate) => write((database, now) => declineInstallmentGroup(database, candidate.groupKey, now))}
                onThreshold={(value) => write((database, now) => setInstallmentThreshold(database, value, now))}
                onStopOffering={() => write((database, now) => setInstallmentOffers(database, false, now))}
              />
              {candidates.length === 0 && <EmptyState say={t('wealth.debts.splitNone')} />}
              {!promotion.isOffered && (
                <EmptyState
                  say={t('wealth.debts.splitOff')}
                  verb={t('wealth.debts.splitOn')}
                  onDo={() => write((database, now) => setInstallmentOffers(database, true, now))}
                />
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // The day the last open debt is paid off, at this rate — the end of the sentence.
  const lastDay = rows.reduce<YearMonth | undefined>(
    (latest, row) => (row.status.kind === 'PAID_OFF' && (latest === undefined || compareYearMonths(row.status.at, latest) > 0) ? row.status.at : latest),
    undefined,
  )
  const neverEnds = rows.some((row) => row.status.kind === 'NO_PAYMENT')
  const monthly = money(read.payment.minor + read.extra.minor, currency)

  const waiting: Waiting[] = [
    ...(toReview > 0
      ? [
          {
            key: 'review',
            say: t(countKey('wealth.debts.waiting.review', toReview), { count: toReview }),
            why: t('wealth.debts.waiting.reviewWhy'),
            verb: t('wealth.debts.waiting.answer'),
            onDo: () => setView('REVIEW'),
          },
        ]
      : []),
    ...(candidates.length > 0 && promotion.isOffered
      ? [
          {
            key: 'split',
            say: t(countKey('wealth.debts.waiting.split', candidates.length), { count: candidates.length }),
            why: t('wealth.debts.waiting.splitWhy'),
            verb: t('wealth.debts.waiting.look'),
            onDo: () => setView('SPLIT'),
          },
        ]
      : []),
    ...rows
      .filter((row) => row.status.kind === 'NO_PAYMENT')
      .map((row) => ({
        key: `${row.line.debtId}:none`,
        say: t('wealth.debts.waiting.noPayment', { name: row.line.name }),
        why: t('wealth.debts.waiting.noPaymentWhy'),
        verb: t('wealth.debts.waiting.open'),
        onDo: () => openDebt(row.line.debtId),
      })),
  ]

  const horizons: readonly (readonly [Horizon, string])[] = [
    [6, t(countKey('wealth.goals.months', 6), { count: 6 })],
    [12, t(countKey('wealth.goals.months', 12), { count: 12 })],
    [24, t(countKey('wealth.goals.months', 24), { count: 24 })],
  ]

  const page = (
    <div className="fc-view-enter flex flex-col gap-8 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="m-0 text-title leading-tight font-medium">{t('wealth.debts.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="primary" icon="add" onClick={newDebt}>
            {t('wealth.debts.add')}
          </Button>
          <PageMenu title={t('wealth.debts.title')} items={pageMenu} />
        </div>
      </header>

      {problem !== undefined && <Problem text={problem} onDismiss={() => setProblem(undefined)} />}

      {rows.length === 0 ? (
        <>
          <EmptyState say={t('wealth.debts.empty')} verb={t('wealth.debts.add')} onDo={newDebt} />
          <WaitingList label={t('wealth.common.waiting')} items={waiting} />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-6">
            <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">
              {lastDay === undefined || neverEnds
                ? t(countKey('wealth.debts.sentenceNoEnd', rows.length), { count: rows.length, left: wholeMoney(read.left), monthly: wholeMoney(monthly) })
                : t(countKey('wealth.debts.sentence', rows.length), {
                    count: rows.length,
                    left: wholeMoney(read.left),
                    monthly: wholeMoney(monthly),
                    month: words.dates.yearMonth(lastDay),
                  })}
            </p>
            <HeadlineFigure
              size="display"
              label={t('wealth.debts.figure')}
              value={read.left}
              change={t('wealth.debts.figureHow', { amount: wholeMoney(monthly) })}
              empty={t('wealth.debts.empty')}
            />
            {/* One hairline between the meters and what waits under them: the last meter draws none. */}
            <div className="[&_li:last-child>*]:border-b-0">
            <PlanAgainst
              lines={rows.map((row) => {
                const borrowed = row.row.debt.principalAmount
                const known = row.row.balance.kind !== 'UNCHECKED' && borrowed.currency === row.line.left.currency
                return {
                  key: row.line.debtId,
                  name: row.line.name,
                  actual: known ? money(Math.max(0, borrowed.minor - row.line.left.minor), currency) : row.line.left,
                  planned: known ? borrowed : undefined,
                  ...(known ? {} : { unknown: t('wealth.debts.unchecked') }),
                }
              })}
              empty={t('wealth.debts.empty')}
              onOpen={openDebt}
            />
            </div>
            {read.otherCurrency > 0 && (
              <p className="m-0 text-caption text-ink-secondary">{t(countKey('wealth.debts.otherCurrency', read.otherCurrency), { count: read.otherCurrency })}</p>
            )}
          </div>

          <WaitingList label={t('wealth.common.waiting')} items={waiting} />

          <section className="flex flex-col gap-3" aria-labelledby="debts-all">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 id="debts-all" className="m-0 text-heading font-medium">
                {t('wealth.debts.list.title')}
              </h2>
              <Seg options={horizons} value={horizon} onChange={setHorizon} label={t('wealth.goals.list.horizon')} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-hairline text-caption text-ink-secondary uppercase">
                    <th className="h-8 pe-3 text-start font-medium">{t('wealth.debts.list.debt')}</th>
                    <th className="h-8 pe-3 text-end font-medium">{t('wealth.debts.list.left')}</th>
                    <th className="h-8 pe-3 text-end font-medium">{t('wealth.debts.list.paid')}</th>
                    <th className="h-8 pe-3 text-end font-medium">{t('wealth.debts.list.extra')}</th>
                    <th className="h-8 pe-3 text-end font-medium">{t(countKey('wealth.goals.list.after', months), { count: months })}</th>
                    <th className="h-8 ps-6 pe-3 text-start font-medium">{t('wealth.debts.list.rate')}</th>
                    <th className="h-8 w-9" aria-label={t('wealth.common.more')} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <DebtTableRow
                      key={row.line.debtId}
                      row={row}
                      months={months}
                      on={row.line.debtId === openId}
                      editable={plan !== undefined}
                      bucket={plan?.buckets.find((bucket) => bucket.id === row.bucketIds[0])?.name}
                      text={typed[row.line.debtId]}
                      words={words}
                      onOpen={() => openDebt(row.line.debtId)}
                      onText={(text) => setTyped((current) => ({ ...current, [row.line.debtId]: text }))}
                      onCommit={() => commit(row)}
                      onMenu={(at) => setMenu({ at, items: menuItems(row.row, at), title: row.line.name })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {showClosed && read.closed.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="debts-closed">
          <h2 id="debts-closed" className="m-0 text-heading font-medium">
            {t('wealth.debts.closed')}
          </h2>
          {read.closed.map((row) => (
            <p key={row.debt.id} className="m-0 flex flex-wrap items-baseline gap-x-4 border-b border-hairline py-2">
              <button type="button" className="text-start hover:text-accent" onClick={() => openDebt(row.debt.id)}>
                <Bidi>{row.debt.name}</Bidi>
              </button>
              <span className="text-ink-secondary tabular-nums">{kitMoney(row.balance.principal)}</span>
              <button type="button" className="fc-text-action" onClick={() => write((database, now) => setDebtClosed(database, row.debt.id, false, now))}>
                {t('wealth.debts.menu.reopen')}
              </button>
            </p>
          ))}
        </section>
      )}
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>
      {menu !== undefined && (
        <ContextMenu
          key={String(menu.title)}
          at={menu.at}
          items={menu.items}
          onClose={() => setMenu(undefined)}
          header={{ title: <Bidi>{menu.title}</Bidi>, ...(menu.sub === undefined ? {} : { sub: menu.sub }) }}
        />
      )}
    </div>
  )
}

/** One debt: the row opens it beside the list; Plan's extra is typed in place. */
function DebtTableRow({
  row,
  months,
  on,
  editable,
  bucket,
  text,
  words,
  onOpen,
  onText,
  onCommit,
  onMenu,
}: {
  readonly row: DebtPlanRow
  readonly months: number
  readonly on: boolean
  readonly editable: boolean
  readonly bucket: string | undefined
  readonly text: string | undefined
  readonly words: WealthWords
  readonly onOpen: () => void
  readonly onText: (text: string) => void
  readonly onCommit: () => void
  readonly onMenu: (at: { x: number; y: number }) => void
}) {
  const { t, dates } = words
  const { line, row: summary } = row
  const { debt, balance } = summary
  const after = leftAfter(line, months)
  const status = row.status
  const cell = `h-10 border-t border-hairline pe-3 align-middle ${on ? 'bg-surface' : 'group-hover:bg-surface'}`

  return (
    <tr
      className="group cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      tabIndex={0}
      aria-current={on ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(event) => rowKeys(event, onOpen)}
    >
      <td className={`${cell} min-w-40 py-2`}>
        <Bidi className="font-medium">{debt.name}</Bidi>
        <span className="block text-caption text-ink-secondary">
          {words.debt[debt.kind]}
          {balance.unconfirmedCount > 0 && <> · {t(countKey('wealth.debts.list.toConfirm', balance.unconfirmedCount), { count: balance.unconfirmedCount })}</>}
        </span>
      </td>
      <td className={`${cell} text-end whitespace-nowrap tabular-nums`} title={balance.kind === 'UNCHECKED' ? balance.reason : undefined}>
        {balance.kind === 'UNCHECKED' ? t('wealth.debts.unchecked') : kitMoney(line.left)}
      </td>
      <td className={`${cell} py-2 text-end whitespace-nowrap tabular-nums`}>
        {line.payment.minor === 0 ? '—' : kitMoney(line.payment)}
        <span className="block text-caption text-ink-secondary">
          {line.paymentSource === 'STANDING_ORDER' ? t('wealth.debts.list.standingOrder') : line.paymentSource === 'OBSERVED' ? t('wealth.debts.list.observed') : t('wealth.debts.list.nothingKnown')}
        </span>
      </td>
      <td className={`${cell} py-2 text-end tabular-nums`} onClick={(event) => event.stopPropagation()}>
        {editable && row.bucketIds.length <= 1 ? (
          <input
            inputMode="decimal"
            aria-label={t('wealth.debts.list.extraFor', { name: line.name })}
            value={text ?? editableMoney(line.extra)}
            placeholder="0"
            onChange={(event) => onText(event.target.value)}
            onBlur={onCommit}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className={AMOUNT_FIELD}
          />
        ) : (
          <span>{kitMoney(line.extra)}</span>
        )}
        <span className="block text-caption text-ink-secondary">
          {row.bucketIds.length > 1
            ? t('wealth.goals.list.severalBuckets', { count: row.bucketIds.length })
            : bucket !== undefined
              ? <Phrase text={t('wealth.debts.list.bucket')} parts={{ name: <Bidi>{bucket}</Bidi> }} />
              : t('wealth.debts.list.noBucket')}
        </span>
      </td>
      <td className={`${cell} text-end whitespace-nowrap tabular-nums`}>
        {kitMoney(after)}
      </td>
      <td className={`${cell} py-2 ps-6 text-caption`}>
        {status.kind === 'PAID' ? (
          <span className="text-ink-secondary">{t('wealth.debts.list.paidOff')}</span>
        ) : status.kind === 'NO_PAYMENT' ? (
          <span className="text-negative">{t('wealth.debts.list.noPayment')}</span>
        ) : (
          <>
            <span className="text-ink">{t('wealth.debts.list.paidOffIn', { month: dates.monthShort(status.at) })}</span>
            <span className="block text-ink-secondary">
              {status.sooner === undefined
                ? line.extra.minor > 0
                  ? t('wealth.debts.list.savesNone')
                  : t('wealth.debts.list.addExtra')
                : t('wealth.debts.list.without', { month: dates.monthShort(addMonths(status.at, status.sooner)) })}
            </span>
          </>
        )}
      </td>
      <td className={`${cell} w-9 pe-0`}>
        <MoreButton label={t('wealth.common.moreFor', { name: line.name })} onMenu={onMenu} />
      </td>
    </tr>
  )
}

function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
