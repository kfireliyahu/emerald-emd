import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatMoney, fromMajorUnits, type CurrencyCode } from '@/core/money.ts'
import { plural } from '@/core/text.ts'
import { addMonths, formatMonthShort, yearMonthOf } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import { listAccounts } from '@/data/repositories/accountRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import {
  addPayment,
  confirmPayment,
  createDebt,
  debtsSummary,
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
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { editableMoney } from '@/ui/components/moneyText.ts'
import { blankDebt, DebtEditor } from '@/ui/debts/DebtEditor.tsx'
import { DEBT_KIND_LABEL } from '@/ui/debts/labels.ts'
import { blankPayment, PaymentEditor } from '@/ui/debts/PaymentEditor.tsx'
import { PaymentReview } from '@/ui/debts/PaymentReview.tsx'
import { AMOUNT_FIELD, GTD, GTD_R, Need, PageHead, Screen, Section, Seg, Src, Tag, TH, TH_R } from '@/ui/wealth/parts.tsx'
import { SplitPurchases } from '@/ui/debts/SplitPurchases.tsx'
import { today } from '@/ui/today.ts'

/**
 * The debts screen — what is owed, how fast it is going down, and what the app
 * thinks it has spotted paying it.
 *
 * **Every figure comes from one `debtsSummary` call** (D-084), so the ring on a
 * card, the outstanding beside it and the totals above them cannot disagree.
 * The screen does no arithmetic of its own; there is nothing here for a stale
 * balance to be computed by.
 *
 * **The monthly obligation is not the sum of the monthly payments, and the
 * screen says which debts it left out.** A payroll-deducted loan is already out
 * of net, a promoted card purchase is already inside the spending, and a
 * standing order also recorded as a fixed expense has already been subtracted
 * once — `debtObligationBasis` is the one door to that figure (D-083) and it
 * names all three rather than dropping them, because a debt missing from a total
 * is indistinguishable from one the app forgot about.
 *
 * **A split purchase is offered here rather than at the end of the import.** The
 * import notice points at this screen the way it points at the settlement queue
 * (D-064), because the offer needs the debts beside it to be worth answering —
 * and because an offer made once, on a screen the user is passing through, is an
 * offer that gets dismissed by accident.
 *
 * **The review queue is a view of this screen, not a destination** — the call
 * D-055 made about the variance view and D-076 about the deposits list. As a tab
 * of its own it would be read by whoever navigated to it; as a toggle beside a
 * count it is in front of the person already looking at the balances it would
 * change the marks on.
 */
type View = 'DEBTS' | 'REVIEW' | 'SPLIT'
type Horizon = 6 | 12 | 24

export function Debts() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [view, setView] = useState<View>('DEBTS')
  const [editingDebt, setEditingDebt] = useState<{ isNew: boolean; debt: Debt } | undefined>()
  const [editingPayment, setEditingPayment] = useState<
    { isNew: boolean; payment: DebtPayment } | undefined
  >()
  const [confirming, setConfirming] = useState<string | undefined>()
  const [problem, setProblem] = useState<string | undefined>()
  const [showClosed, setShowClosed] = useState(false)
  const [horizon, setHorizon] = useState<Horizon>(12)
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({})
  const [menu, setMenu] = useState<
    { at: { x: number; y: number }; items: MenuItem[]; title: string } | undefined
  >()

  const asOf = today()
  const period = yearMonthOf(asOf)
  const currency: CurrencyCode = useMemo(
    () => (db === undefined ? 'ILS' : documentCurrency(db)),
    [db, revision],
  )

  const summary = useMemo(
    () => (db === undefined ? undefined : debtsSummary(db, period, { currency })),
    [db, revision],
  )
  const read = useMemo(
    () => (db === undefined ? undefined : debtsPlan(db, asOf, currency)),
    [db, revision],
  )
  const review = useMemo(() => (db === undefined ? undefined : paymentReview(db)), [db, revision])
  const debts = useMemo(
    () => (db === undefined ? [] : listDebts(db, { includeClosed: true })),
    [db, revision],
  )
  const accounts = useMemo(() => (db === undefined ? [] : listAccounts(db)), [db, revision])
  const categories = useMemo(() => (db === undefined ? [] : listCategories(db)), [db, revision])
  const expenses = useMemo(() => (db === undefined ? [] : listFixedExpenses(db)), [db, revision])
  const payments = useMemo(() => (db === undefined ? [] : listPayments(db)), [db, revision])
  const candidates = useMemo(
    () => (db === undefined ? [] : installmentCandidates(db)),
    [db, revision],
  )
  const promotion = useMemo(
    () => (db === undefined ? undefined : readInstallmentPromotion(db)),
    [db, revision],
  )

  if (
    db === undefined ||
    summary === undefined ||
    read === undefined ||
    review === undefined ||
    promotion === undefined
  ) {
    return <Centered>Open a document, or create one, to track what you owe.</Centered>
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
              addPayment(
                database,
                {
                  debtId: payment.debtId,
                  date: payment.date,
                  amount: payment.amount,
                  interestPortion: payment.interestPortion,
                  note: payment.note,
                },
                now,
              )
              return
            }
            // Editing a discovered payment confirms it in the same write: the
            // user has just looked at every field on it, which is a stronger
            // answer than clicking accept.
            updatePayment(
              database,
              payment.id,
              {
                debtId: payment.debtId,
                date: payment.date,
                amount: payment.amount,
                interestPortion: payment.interestPortion,
                isConfirmed: true,
                note: payment.note,
              },
              now,
            )
          })
          if (saved) setEditingPayment(undefined)
        }}
        onCancel={() => setEditingPayment(undefined)}
      />
    )
  }

  // Which debt the pane beside this list is showing, if any (D-130).
  const { debtId: openId } = useParams<{ debtId: string }>()

  const waiting = review.items.length + review.ambiguities.length + review.orphaned.length
  const { rows, plan } = read
  const months = horizon
  const noDebts = rows.length === 0 && read.closed.length === 0 && candidates.length === 0

  /** Plan's own write: one function for a typed figure here and a typed figure there. */
  /** Plan's own write, the one the tools and Goals use (D-325, M28 F10). */
  const setExtra = (row: DebtPlanRow, minor: number): void => {
    if (plan === undefined) return
    write((database, now) => {
      const result = setBucketMonthly(database, asOf, currency, 'DEBT', row.line.debtId, `Extra on ${row.line.name}`, minor, now)
      if (result === 'SEVERAL_BUCKETS') {
        throw new Error(`Several of Plan's buckets are for ${row.line.name}. Edit them on Plan: the figure here is their sum.`)
      }
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

  const menuItems = (row: DebtRow): MenuItem[] => [
    ...(row.debt.isClosed
      ? [
          {
            label: 'Reopen',
            onChoose: () =>
              write((database, now) => setDebtClosed(database, row.debt.id, false, now)),
          } satisfies MenuItem,
        ]
      : [
          {
            label: 'Add a payment',
            icon: 'add',
            onChoose: () =>
              setEditingPayment({ isNew: true, payment: blankPayment(row.debt, asOf) }),
          } satisfies MenuItem,
        ]),
    {
      label: 'Edit',
      icon: 'edit',
      onChoose: () => setEditingDebt({ isNew: false, debt: row.debt }),
    },
    ...(row.debt.isClosed
      ? []
      : [
          {
            label: 'Close this debt',
            detail: row.balance.kind === 'KNOWN' && row.balance.isSettled
              ? 'It is paid off'
              : 'History is kept; nothing more is found for it',
            onChoose: () =>
              write((database, now) => setDebtClosed(database, row.debt.id, true, now)),
          } satisfies MenuItem,
        ]),
    { label: 'Delete', icon: 'trash', separated: true, onChoose: () => setConfirming(row.debt.id) },
  ]

  const pageMenu: MenuItem[] = [
    {
      label: waiting > 0 ? `Payments to review (${String(waiting)})` : 'Payments to review',
      detail: 'Payments the app found in your statements, waiting for your yes',
      onChoose: () => setView('REVIEW'),
    },
    {
      label:
        candidates.length > 0
          ? `Split purchases (${String(candidates.length)})`
          : 'Split purchases',
      detail: 'Card purchases paid in slices, offered as debts',
      onChoose: () => setView('SPLIT'),
    },
    {
      label: showClosed ? 'Hide closed debts' : 'Show closed debts',
      separated: true,
      onChoose: () => setShowClosed(!showClosed),
    },
  ]

  const confirmingRow = read.all.find((row) => row.debt.id === confirming)
  const horizons: readonly (readonly [Horizon, string])[] = [
    [6, '6 months'],
    [12, '12 months'],
    [24, '24 months'],
  ]
  const fullMenu: MenuItem[] = [
    ...(debts.some((debt) => !debt.isClosed)
      ? [
          {
            label: 'Record a payment',
            icon: 'add',
            onChoose: () => {
              const open = debts.find((debt) => !debt.isClosed)
              if (open !== undefined) setEditingPayment({ isNew: true, payment: blankPayment(open, asOf) })
            },
          } satisfies MenuItem,
        ]
      : []),
    ...pageMenu,
  ]
  const bucketName = (row: DebtPlanRow): string | undefined =>
    plan?.buckets.find((bucket) => bucket.id === row.bucketIds[0])?.name

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <Screen>
          <PageHead
            title={view === 'REVIEW' ? 'Payments to review' : view === 'SPLIT' ? 'Split purchases' : 'Debts'}
            actions={
              view !== 'DEBTS' ? (
                <Button variant="ghost" onClick={() => setView('DEBTS')}>
                  Back to debts
                </Button>
              ) : rows.length > 0 ? (
                <>
                  <span className="text-caption text-ink-secondary">Where will I be in</span>
                  <Seg options={horizons} value={horizon} onChange={setHorizon} label="Time" />
                </>
              ) : undefined
            }
          />

          {problem !== undefined && (
            <div className="fc-pop-enter flex items-center gap-4 border border-hairline bg-surface px-4 py-2">
              <span className="text-negative">{problem}</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
                Dismiss
              </Button>
            </div>
          )}

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
          ) : view === 'SPLIT' ? (
            <>
              <SplitPurchases
                candidates={candidates}
                threshold={promotion.threshold}
                onPromote={(candidate) => write((database, now) => promoteInstallmentGroup(database, candidate, now))}
                onDecline={(candidate) =>
                  write((database, now) => declineInstallmentGroup(database, candidate.groupKey, now))
                }
                onThreshold={(value) => write((database, now) => setInstallmentThreshold(database, value, now))}
                onStopOffering={() => write((database, now) => setInstallmentOffers(database, false, now))}
              />
              {candidates.length === 0 && (
                <p className="m-0 text-ink-secondary">No purchase split into payments is waiting.</p>
              )}
              {!promotion.isOffered && (
                <p className="m-0 flex flex-wrap items-center gap-x-3 text-caption text-ink-secondary">
                  Purchases split into payments are not offered as debts.
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => write((database, now) => setInstallmentOffers(database, true, now))}
                  >
                    Offer them again
                  </Button>
                </p>
              )}
            </>
          ) : (
            <Section
              title="Debts"
              sub={`The same question the other way round: what goes in each month, and where that leaves you in ${String(months)} months.`}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="add"
                    onClick={() => setEditingDebt({ isNew: true, debt: blankDebt(currency, asOf) })}
                  >
                    New debt
                  </Button>
                  <button
                    type="button"
                    aria-label="More about debts"
                    title="More"
                    onClick={(event) => {
                      const box = event.currentTarget.getBoundingClientRect()
                      setMenu({ at: { x: box.left, y: box.bottom }, items: fullMenu, title: 'Debts' })
                    }}
                    className="fc-icon-action"
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
                      <circle cx="3.5" cy="8" r="1.2" />
                      <circle cx="8" cy="8" r="1.2" />
                      <circle cx="12.5" cy="8" r="1.2" />
                    </svg>
                    {waiting + candidates.length > 0 && (
                      <span className="ml-1 text-caption text-ink-secondary tabular-nums">{waiting + candidates.length}</span>
                    )}
                  </button>
                </div>
              }
            >
              {noDebts || rows.length === 0 ? (
                <p className="m-0 text-ink-secondary">No open debts. New debt adds one.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={TH}>Debt</th>
                        <th className={TH_R}>Left</th>
                        <th className={TH_R}>Paid each month</th>
                        <th className={TH_R}>Extra each month</th>
                        <th className={TH_R}>
                          In {String(months)} months
                        </th>
                        <th className={TH}>At this rate</th>
                        <th className={`${TH} w-9`} aria-label="More" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <DebtTableRow
                          key={row.line.debtId}
                          row={row}
                          months={months}
                          open={row.line.debtId === openId}
                          editable={plan !== undefined}
                          bucket={bucketName(row)}
                          text={typed[row.line.debtId]}
                          onText={(text) => setTyped((current) => ({ ...current, [row.line.debtId]: text }))}
                          onCommit={() => commit(row)}
                          onMenu={(at) => setMenu({ at, items: menuItems(row.row), title: row.line.name })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {read.otherCurrency > 0 && (
                <Src>{plural(read.otherCurrency, 'debt')} in another currency, not counted.</Src>
              )}
              {confirmingRow !== undefined && (
                <div className="fc-pop-enter flex flex-wrap items-center gap-3 border border-hairline bg-surface px-4 py-2">
                  <span>
                    Delete <Bidi>{confirmingRow.debt.name}</Bidi> and its payments?
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setConfirming(undefined)
                      write((database, now) => deleteDebt(database, confirmingRow.debt.id, now))
                    }}
                  >
                    Delete it
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(undefined)}>
                    Keep it
                  </Button>
                </div>
              )}
              {showClosed &&
                read.closed.map((row) => (
                  <div key={row.debt.id} className="flex flex-wrap items-center gap-4 border-b border-hairline py-2">
                    <Link to={`/wealth/debts/${row.debt.id}`} className="hover:text-accent">
                      <Bidi>{row.debt.name}</Bidi>
                    </Link>
                    <Tag>Closed</Tag>
                    <span className="text-ink-secondary tabular-nums">{formatMoney(row.balance.principal)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => write((database, now) => setDebtClosed(database, row.debt.id, false, now))}
                    >
                      Reopen
                    </Button>
                  </div>
                ))}
            </Section>
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

function DebtTableRow({
  row,
  months,
  open,
  editable,
  bucket,
  text,
  onText,
  onCommit,
  onMenu,
}: {
  row: DebtPlanRow
  months: number
  open: boolean
  editable: boolean
  bucket: string | undefined
  text: string | undefined
  onText: (text: string) => void
  onCommit: () => void
  onMenu: (at: { x: number; y: number }) => void
}) {
  const { line, row: summary } = row
  const { debt, balance } = summary
  const after = leftAfter(line, months)
  const status = row.status

  return (
    <tr className={open ? 'bg-accent-soft' : ''}>
      <td className={`${GTD} min-w-[170px]`}>
        <Link
          to={`/wealth/debts/${debt.id}`}
          className="border-b border-hairline-strong font-medium text-ink hover:border-accent hover:text-accent"
        >
          <Bidi>{debt.name}</Bidi>
        </Link>
        <Src>{DEBT_KIND_LABEL[debt.kind]}</Src>
        {balance.unconfirmedCount > 0 && (
          <Src className="text-flow-tax">{plural(balance.unconfirmedCount, 'payment')} to confirm</Src>
        )}
      </td>
      <td className={GTD_R} title={balance.kind === 'UNCHECKED' ? balance.reason : undefined}>
        {balance.kind === 'UNCHECKED' ? 'Unchecked' : formatMoney(line.left)}
      </td>
      <td className={GTD_R}>
        {line.payment.minor === 0 ? '—' : formatMoney(line.payment)}
        <Need>
          {line.paymentSource === 'STANDING_ORDER'
            ? 'standing order'
            : line.paymentSource === 'OBSERVED'
              ? 'what you have paid'
              : 'nothing known'}
        </Need>
      </td>
      <td className={GTD_R}>
        {editable && row.bucketIds.length <= 1 ? (
          <input
            inputMode="decimal"
            aria-label={`Extra each month on ${line.name}`}
            value={text ?? editableMoney(line.extra)}
            placeholder="0"
            onChange={(event) => onText(event.target.value)}
            onBlur={onCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className={AMOUNT_FIELD}
          />
        ) : (
          <span>{formatMoney(line.extra)}</span>
        )}
        <Need>
          {row.bucketIds.length > 1
            ? `${String(row.bucketIds.length)} buckets, edit on Plan`
            : bucket !== undefined
              ? `Plan bucket: ${bucket}`
              : 'Nothing in Plan yet'}
        </Need>
      </td>
      <td className={GTD_R}>
        <b className="font-medium">{formatMoney(after)}</b>
        <Need>{after.minor === 0 ? 'paid off' : 'left'}</Need>
      </td>
      <td className={GTD}>
        {status.kind === 'PAID' ? (
          <Tag tone="good">Paid off</Tag>
        ) : status.kind === 'NO_PAYMENT' ? (
          <>
            <Tag tone="bad">No payment yet</Tag>
            <Src className="mt-[3px]">Nothing goes toward it each month</Src>
          </>
        ) : (
          <>
            Paid off {formatMonthShort(status.at)}
            <Src>
              {status.sooner === undefined
                ? line.extra.minor > 0
                  ? 'The extra saves no month'
                  : 'Add an extra to see how much sooner'
                : `Without the extra: ${formatMonthShort(addMonths(status.at, status.sooner))}`}
            </Src>
          </>
        )}
      </td>
      <td className={`${GTD} w-9 px-0`}>
        <button
          type="button"
          aria-label={`More for ${line.name}`}
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

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
