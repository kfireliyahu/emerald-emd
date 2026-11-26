import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { formatMoney, fromMajorUnits, money, type CurrencyCode } from '@/core/money.ts'
import { type LocalDate, parseISODate, toISODate, yearMonthOf } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import { goalFeeds, goalWorth, holdingPutIn } from '@/data/repositories/goalDepositRepository.ts'
import { whereChoices } from '@/data/repositories/goalWhereRepository.ts'
import { settleSetAside, staleSetAside } from '@/data/repositories/goalRhythmRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { addDeposit, findHolding, goalDetail, listHoldings } from '@/data/repositories/savingsRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { originOf, originSplit, sourceKindForOrigin, type DepositOrigin } from '@/domain/goalDeposits.ts'
import type { SavingDeposit, SavingGoal } from '@/domain/model/savings.ts'
import { targetAmountOf } from '@/domain/savings.ts'
import { countKey } from '@/i18n/count.ts'
import type { MessageKey } from '@/i18n/catalogue.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { CostBasis } from '@/ui/savings/CostBasis.tsx'
import { HoldingReadings } from '@/ui/savings/HoldingReadings.tsx'
import { dayMonth } from '@/ui/savings/WherePicker.tsx'
import { useClosePane } from '@/ui/screens/ListDetail.tsx'
import { today } from '@/ui/today.ts'
import { Legend, LegendItem, Src, SWATCH, Tag, type TagTone } from '@/ui/wealth/parts.tsx'
import { whereDetail, whereName } from '@/ui/wealth/words.ts'

/**
 * A goal's drawer, as the approved mockup draws it (M28 U8, rebuilt in F10): what
 * the balance is made of, how its bank deposits are found, and the deposits
 * themselves with the two that are typed by hand. It opens over Goals on a solid
 * surface with a scrim (`ListDetail overlay`); Escape or the cross closes it.
 */
export function GoalDetail() {
  const { goalId } = useParams<{ goalId: string }>()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  const closePane = useClosePane()
  const t = useT()
  const dates = useDates()
  const [problem, setProblem] = useState<string | undefined>()

  const asOf = today()
  const currency: CurrencyCode = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])
  const detail = useMemo(
    () => (db === undefined || goalId === undefined ? undefined : goalDetail(db, goalId, asOf, currency)),
    [db, revision, goalId],
  )
  const holdings = useMemo(() => (db === undefined ? [] : listHoldings(db, { includeArchived: true })), [db, revision])
  // One name per holding (M30 F3): an account's own Cash is called by the account's name.
  const named = useMemo(
    () => new Map(db === undefined ? [] : whereChoices(db, currency).map((one) => [one.holdingId, whereName(one, t)] as const)),
    [db, revision, currency, t],
  )
  const byHolding = useMemo(
    () => db !== undefined && goalId !== undefined && goalFeeds(db).get(goalId)?.kind === 'HOLDING',
    [db, revision, goalId],
  )
  const stale = useMemo(
    () => (db === undefined || goalId === undefined ? [] : (staleSetAside(db, asOf).get(goalId) ?? [])),
    [db, revision, goalId],
  )
  const worth = useMemo(
    () => (db === undefined || goalId === undefined ? undefined : goalWorth(db, goalId, currency)),
    [db, revision, goalId, currency],
  )

  if (db === undefined) return null
  if (detail === undefined) {
    return (
      <div className="px-6 py-6 text-ink-secondary">
        {t('wealth.goalDetail.missing')}{' '}
        <Link to="/wealth/goals" className="text-accent hover:underline">
          {t('wealth.goalDetail.close')}
        </Link>
      </div>
    )
  }

  const write = (work: (database: import('sql.js').Database, now: number) => void): void => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const { goal } = detail
  // The goal form is the list's, and comes back here when it is done (M30 F3).
  const edit = (): void => void navigate(`/wealth/goals?edit=${goal.id}`, { replace: true })
  const target = targetAmountOf(detail.target)
  const split = originSplit(detail.deposits, currency)
  const parts = (
    [
      // A buy is read from the account's own statement, which is not always a bank's.
      ['DERIVED', t(byHolding ? 'wealth.goalDetail.origin.derivedStatement' : 'wealth.goalDetail.origin.derivedBank'), SWATCH.derived],
      ['SET_ASIDE', t('wealth.goalDetail.origin.setAsideInside'), SWATCH.setAside],
      ['ALREADY_THERE', t('wealth.goalDetail.origin.alreadyThere'), SWATCH.already],
      ['GROWTH', t('wealth.goalDetail.origin.growth'), 'bg-transparent outline outline-1 outline-ink-tertiary'],
    ] as const
  ).filter(([origin]) => split[origin].minor !== 0)
  const newest = [...detail.deposits].sort((a, b) => toISODate(b.date).localeCompare(toISODate(a.date)))
  const shown = newest.slice(0, 8)
  const staleTotal = stale.reduce((sum, one) => sum + one.amount.minor, 0)
  const unchecked = detail.unchecked !== undefined
  const summary = [
    unchecked ? t('wealth.goalDetail.unchecked') : formatMoney(detail.balance),
    target === undefined ? undefined : t('wealth.goalDetail.ofTarget', { amount: formatMoney(target) }),
    goal.targetDate === undefined ? undefined : t('wealth.goalDetail.byMonth', { month: dates.monthShort(yearMonthOf(goal.targetDate)) }),
  ]
    .filter((one) => one !== undefined)
    .join(' ')

  return (
    <div className="relative flex h-full flex-col gap-4 overflow-auto px-6 pt-5 pb-10">
      <div className="absolute top-3 end-3 flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={edit}>
          {t('wealth.common.edit')}
        </Button>
        <button
          type="button"
          aria-label={t('wealth.goalDetail.close')}
          onClick={closePane}
          className="inline-flex size-7 items-center justify-center border border-transparent text-ink-secondary hover:border-hairline-strong hover:text-ink"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div>
        <span className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.goalDetail.kicker')}</span>
        <h2 className="m-0 text-title font-medium">
          <Bidi>{goal.name}</Bidi>
        </h2>
        <Src>
          {summary}
          {goal.isClosed ? ` · ${t('wealth.goalDetail.closed')}` : ''}
        </Src>
        {unchecked && <Src>{t('wealth.goalDetail.mixed')}</Src>}
        {worth !== undefined && (
          <Src>
            {t('wealth.goalDetail.worth', {
              worth: formatMoney(worth.worth),
              day: dayMonth(worth.asOf, dates),
              putIn: formatMoney(worth.putIn),
            })}
          </Src>
        )}
      </div>

      <WherePanel goal={goal} deposits={detail.deposits} currency={currency} onEdit={edit} />

      <div>
        <span className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.goalDetail.made')}</span>
        <div className="mt-2 flex flex-col gap-2">
          {parts.map(([origin, label, swatch]) => (
            <div key={origin} className="flex items-center justify-between gap-2">
              <Legend>
                <LegendItem swatch={swatch}>{label}</LegendItem>
              </Legend>
              <b className="font-medium tabular-nums">{formatMoney(split[origin])}</b>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-hairline pt-1.5">
            <span>{t('wealth.goalDetail.balance')}</span>
            <b className="font-medium tabular-nums">
              {unchecked ? t('wealth.goalDetail.unchecked') : formatMoney(detail.balance)}
            </b>
          </div>
        </div>
        {split.SET_ASIDE.minor > 0 && (
          <p className="m-0 mt-2 text-caption text-ink-secondary">{t('wealth.goalDetail.setAsideWhy')}</p>
        )}
      </div>

      <div>
        <span className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.goalDetail.deposits')}</span>
        {staleTotal > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2.5 border border-dashed border-flow-tax px-3 py-2">
            <span className="text-caption">
              {t('wealth.goalDetail.stale', { amount: formatMoney(money(staleTotal, currency)) })}
            </span>
            <Button variant="secondary" size="sm" onClick={() => write((database, now) => void settleSetAside(database, goal.id, 'STILL_THERE', asOf, now))}>
              {t('wealth.goalDetail.stillThere')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => write((database, now) => void settleSetAside(database, goal.id, 'GONE', asOf, now))}>
              {t('wealth.goalDetail.gone')}
            </Button>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="m-0 mt-2 text-ink-secondary">{t('wealth.goalDetail.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-1.5 w-full border-collapse">
              <tbody>
                {shown.map((deposit) => (
                  <DepositRow
                    key={deposit.id}
                    deposit={deposit}
                    holdingName={named.get(deposit.holdingId) ?? holdings.find((one) => one.id === deposit.holdingId)?.name}
                    bought={byHolding}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {newest.length > shown.length && (
          <p className="m-0 mt-1 text-caption text-ink-secondary">{t('wealth.goalDetail.earlier', { count: newest.length - shown.length })}</p>
        )}
        <AddMoney goal={goal} currency={currency} asOf={asOf} write={write} followed={byHolding} onEdit={edit} />
        {problem !== undefined && <p className="m-0 mt-2 text-negative">{problem}</p>}
      </div>
    </div>
  )
}

const KIND: Readonly<Record<DepositOrigin, readonly [TagTone, MessageKey]>> = {
  DERIVED: ['derived', 'wealth.goalDetail.origin.derivedBank'],
  SET_ASIDE: ['setAside', 'wealth.goalDetail.origin.setAside'],
  ALREADY_THERE: ['already', 'wealth.goalDetail.origin.alreadyThere'],
  GROWTH: ['plain', 'wealth.goalDetail.origin.growth'],
}

function DepositRow({
  deposit,
  holdingName,
  bought,
}: {
  deposit: SavingDeposit
  holdingName: string | undefined
  /** The goal is fed by its holding's rows, so a derived deposit is a buy or a sale (D-357). */
  bought: boolean
}) {
  const t = useT()
  const dates = useDates()
  const origin = originOf(deposit.sourceKind)
  // A buy is read from the account's own statement, which is not always a bank's.
  const [tone, label] = bought && origin === 'DERIVED' ? (['derived', 'wealth.goalDetail.origin.derivedStatement'] as const) : KIND[origin]
  const out = deposit.amount.minor < 0
  const said: MessageKey =
    origin === 'DERIVED'
      ? bought
        ? out
          ? 'wealth.goalDetail.what.sold'
          : 'wealth.goalDetail.what.bought'
        : out
          ? 'wealth.goalDetail.what.back'
          : 'wealth.goalDetail.what.transfer'
      : origin === 'SET_ASIDE'
        ? out
          ? 'wealth.goalDetail.what.unset'
          : 'wealth.goalDetail.what.setAside'
        : origin === 'ALREADY_THERE'
          ? 'wealth.goalDetail.what.already'
          : 'wealth.goalDetail.what.growth'
  return (
    <tr>
      <td className="h-auto border-b border-hairline py-2 pe-2.5 align-top text-caption whitespace-nowrap text-ink-secondary tabular-nums">
        {dates.dayMonth(deposit.date)}
      </td>
      <td className="border-b border-hairline px-2.5 py-2 align-top">
        {deposit.note === undefined ? t(said) : <Bidi>{deposit.note}</Bidi>}
        {holdingName !== undefined && (
          <Src>
            <Phrase
              text={t(origin === 'SET_ASIDE' ? 'wealth.goalDetail.inside' : 'wealth.goalDetail.in')}
              parts={{ name: <Bidi>{holdingName}</Bidi> }}
            />
          </Src>
        )}
      </td>
      <td className="border-b border-hairline px-2.5 py-2 align-top">
        <Tag tone={tone}>{t(label)}</Tag>
      </td>
      <td className="border-b border-hairline py-2 ps-2.5 text-end align-top whitespace-nowrap tabular-nums">
        {formatMoney(deposit.amount)}
      </td>
    </tr>
  )
}

/**
 * **Where the money is** (M30 F3): the goal's answer to the form's one question, and
 * what follows from it — an account's balance it sits inside, the rows it follows with
 * their cost check and readings, or a place kept by hand — with the category, when
 * the fold chose one. Changed in Edit, which is the same form; a goal with no answer
 * says so here rather than hiding its add buttons.
 */
function WherePanel({
  goal,
  deposits,
  currency,
  onEdit,
}: {
  goal: SavingGoal
  deposits: readonly SavingDeposit[]
  currency: CurrencyCode
  onEdit: () => void
}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const t = useT()
  const current = useMemo(() => (db === undefined ? undefined : goalFeeds(db).get(goal.id)), [db, revision, goal.id])
  const choice = useMemo(
    () =>
      db === undefined || goal.defaultHoldingId === undefined
        ? undefined
        : whereChoices(db, currency, goal.id).find((one) => one.holdingId === goal.defaultHoldingId),
    [db, revision, goal.id, goal.defaultHoldingId, currency],
  )
  const holding = useMemo(
    () => (db === undefined || goal.defaultHoldingId === undefined ? undefined : findHolding(db, goal.defaultHoldingId)),
    [db, revision, goal.defaultHoldingId],
  )
  const fed = useMemo(
    () => (db === undefined || current?.kind !== 'HOLDING' ? undefined : holdingPutIn(db, current.id, currency)),
    [db, revision, current, currency],
  )
  const categoryPath = useMemo(
    () =>
      db === undefined || current?.kind !== 'CATEGORY'
        ? undefined
        : (listCategories(db, { includeArchived: true }).find((one) => one.id === current.id)?.path ?? current.name),
    [db, revision, current],
  )
  if (db === undefined) return null

  const derived = deposits.filter((deposit) => originOf(deposit.sourceKind) === 'DERIVED')
  const derivedTotal = money(
    derived.reduce((sum, one) => sum + (one.amount.currency === currency ? one.amount.minor : 0), 0),
    currency,
  )

  return (
    <div>
      <span className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.goalDetail.where.title')}</span>
      <div className="mt-2 flex flex-col gap-1.5 border border-hairline-strong bg-background px-3.5 py-3">
        {goal.defaultHoldingId === undefined ? (
          <>
            <b className="font-medium">{t('wealth.goalDetail.where.notSaid')}</b>
            <p className="m-0 text-caption text-ink-secondary">{t('wealth.goalDetail.where.sayWhy')}</p>
            <div>
              <Button variant="secondary" size="sm" onClick={onEdit}>
                {t('wealth.goalDetail.where.say')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <b className="font-medium">
              <Bidi>{choice === undefined ? (holding?.name ?? t('wealth.where.gone')) : whereName(choice, t)}</Bidi>
              {choice?.detail !== undefined && (
                <span className="ms-1.5 text-caption font-normal text-ink-secondary">
                  <Bidi>{whereDetail(choice, t)}</Bidi>
                </span>
              )}
            </b>
            {current?.kind === 'HOLDING' ? (
              <p className="m-0 text-caption text-ink-secondary">
                <Phrase text={t('wealth.goalDetail.where.follows')} parts={{ goal: <Bidi>{goal.name}</Bidi> }} />
              </p>
            ) : choice?.group.kind === 'BANK' ? (
              <p className="m-0 text-caption text-ink-secondary">{t('wealth.goalDetail.where.bank')}</p>
            ) : choice?.group.kind === 'BY_HAND' ? (
              <p className="m-0 text-caption text-ink-secondary">{t('wealth.goalDetail.where.byHand')}</p>
            ) : null}
            {current?.kind === 'TRANSFERS' && (
              <p className="m-0 text-caption text-ink-secondary">
                <Phrase
                  text={t('wealth.goalDetail.where.transfers')}
                  parts={{ account: <Bidi>{current.name}</Bidi>, goal: <Bidi>{goal.name}</Bidi> }}
                />
              </p>
            )}
            {current?.kind === 'CATEGORY' && (
              <p className="m-0 flex flex-wrap items-center gap-1.5 text-caption text-ink-secondary">
                <Tag>{t('wealth.goalDetail.where.moneyMoved')}</Tag>
                <span>
                  <Phrase
                    text={t('wealth.goalDetail.where.category')}
                    parts={{ category: <Bidi>{categoryPath ?? current.name}</Bidi>, goal: <Bidi>{goal.name}</Bidi> }}
                  />
                </span>
              </p>
            )}
            {current !== undefined && (
              <p className="m-0 font-mono text-caption">
                {t(countKey('wealth.goalDetail.where.count', derived.length), { count: derived.length, amount: formatMoney(derivedTotal) })}
              </p>
            )}
            {fed !== undefined && <CostBasis fed={fed} />}
            {current?.kind === 'HOLDING' && <HoldingReadings holdingId={current.id} currency={currency} asOf={today()} />}
          </>
        )}
      </div>
    </div>
  )
}

/** Set money aside, or say it was already there: the two deposits typed by hand. */
function AddMoney({
  goal,
  currency,
  asOf,
  write,
  followed,
  onEdit,
}: {
  goal: SavingGoal
  currency: CurrencyCode
  asOf: LocalDate
  write: (work: (database: import('sql.js').Database, now: number) => void) => void
  /** Its holding's rows are its deposits (D-357), so nothing is typed here. */
  followed: boolean
  onEdit: () => void
}) {
  const [kind, setKind] = useState<'SET_ASIDE' | 'ALREADY_THERE' | undefined>()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toISODate(asOf))
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | undefined>()
  const db = useDocumentStore((state) => state.db)
  const t = useT()
  if (goal.isClosed) return null
  const holdingId = goal.defaultHoldingId

  const save = (): void => {
    if (kind === undefined || holdingId === undefined) return
    const parsed = parseAmountText(amount)
    const when = parseISODate(date)
    if (parsed === undefined || parsed <= 0) return setProblem(t('wealth.goalDetail.add.amountPositive'))
    if (when === undefined) return setProblem(t('wealth.goalDetail.add.dateFormat'))
    setProblem(undefined)
    write((database, now) =>
      addDeposit(
        database,
        {
          goalId: goal.id,
          date: when,
          amount: fromMajorUnits(parsed, currency),
          holdingId,
          sourceKind: sourceKindForOrigin(kind),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
        now,
      ),
    )
    setKind(undefined)
    setAmount('')
    setNote('')
  }

  // No place yet: the card above asks for one, so the buttons say nothing twice.
  if (holdingId === undefined) return null
  if (followed) {
    const holdingName = db === undefined ? undefined : findHolding(db, holdingId)?.name
    return (
      <p className="m-0 mt-2.5 max-w-[52ch] text-caption text-ink-secondary">
        <Phrase
          text={t('wealth.goalDetail.add.followed')}
          parts={{
            holding: <Bidi>{holdingName ?? t('wealth.goalDetail.add.itsHolding')}</Bidi>,
            edit: (
              <button type="button" onClick={onEdit} className="text-accent hover:underline">
                {t('wealth.common.edit')}
              </button>
            ),
          }}
        />
      </p>
    )
  }
  return (
    <>
      <div className="mt-2.5 flex flex-wrap gap-3">
        <Button variant="secondary" size="sm" icon="add" onClick={() => setKind('SET_ASIDE')}>
          {t('wealth.goalDetail.add.setAside')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setKind('ALREADY_THERE')}>
          {t('wealth.goalDetail.add.already')}
        </Button>
      </div>
      {kind !== undefined && (
        <div className="fc-pop-enter mt-3 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <label htmlFor="add-amount">{kind === 'SET_ASIDE' ? t('wealth.goalDetail.add.setAsideLabel') : t('wealth.goalDetail.add.wasThere')}</label>
          <input
            id="add-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="h-8 min-w-0 border border-hairline-strong bg-background px-2 text-end tabular-nums"
          />
          <label htmlFor="add-date">{t('wealth.goalDetail.add.on')}</label>
          <input
            id="add-date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-8 min-w-0 border border-hairline-strong bg-background px-2 tabular-nums"
          />
          <label htmlFor="add-note">{t('wealth.goalDetail.add.note')}</label>
          <input
            id="add-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="h-8 min-w-0 border border-hairline-strong bg-background px-2"
          />
          <span />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="sm" icon="check" onClick={save}>
              {t('wealth.goalDetail.add.save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setKind(undefined)}>
              {t('wealth.common.cancel')}
            </Button>
          </div>
        </div>
      )}
      {problem !== undefined && <p className="m-0 mt-2 text-negative">{problem}</p>}
    </>
  )
}
