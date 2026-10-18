import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Database } from 'sql.js'

import { formatMoney, fromMajorUnits, money, toDecimalString, type CurrencyCode, type Money } from '@/core/money.ts'
import { formatDayMonth, parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import { setOpeningBalance, type AccountBalance } from '@/data/repositories/accountBalanceRepository.ts'
import type { CushionReading } from '@/data/repositories/cushionRepository.ts'
import { listHoldingReadings } from '@/data/repositories/holdingReadingRepository.ts'
import {
  mergeAccounts,
  mergePreview,
  renameAccount,
  setAccountArchived,
  type Account,
} from '@/data/repositories/accountRepository.ts'
import {
  accountOfWhere,
  accountWhereId,
  confirmHolding,
  createHolding,
  deleteHolding,
  deleteHoldingPlace,
  isBarePlace,
  listHoldingPlaces,
  listHoldings,
  setHoldingArchived,
  setHoldingPlaceArchived,
  setPlaceAccount,
  updateHolding,
  updateHoldingPlace,
} from '@/data/repositories/savingsRepository.ts'
import type { HoldingWorth } from '@/domain/holdingReadings.ts'
import type { Holding } from '@/domain/model/savings.ts'
import { provenanceOf, type HoldingBalance } from '@/domain/savings.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { CushionHere, StatementBar, type Write } from '@/ui/savings/Cushion.tsx'
import { blankHolding, HoldingEditor } from '@/ui/savings/HoldingEditor.tsx'
import { checkedOf } from '@/ui/savings/holdingCheck.ts'
import { HoldingReadings } from '@/ui/savings/HoldingReadings.tsx'
import { HOLDING_KIND_LABEL } from '@/ui/savings/labels.ts'
import { PlaceEditor } from '@/ui/savings/PlaceEditor.tsx'
import { Tag } from '@/ui/wealth/parts.tsx'
import type { NetWorthRow } from '@/ui/wealth/netWorthRows.ts'

/** What an opened row needs from the screen around it. */
export interface Opening {
  readonly db: Database
  readonly currency: CurrencyCode
  readonly asOf: LocalDate
  readonly accounts: readonly Account[]
  readonly worths: ReadonlyMap<string, HoldingWorth>
  /** The cushion as Plan reads it: shown, read-only, under an account it lives in (M36 F3). */
  readonly cushion: CushionReading
  readonly write: Write
  /** The holding whose readings are open beneath it — where Home's New figure lands (M36 U01). */
  readonly reading: string | undefined
  readonly onReading: (holdingId: string) => void
}

const LABEL = 'text-label tracking-[0.08em] text-ink-secondary uppercase font-medium'
const LINE = 'border-t border-hairline py-1.5 pr-2.5 align-baseline [tr:first-child>&]:border-t-0'
const FIG = `${LINE} w-[1%] text-right whitespace-nowrap tabular-nums`
const LINK = 'text-accent hover:underline'

/**
 * **A row of Net worth, opened** (M36 U08, `docs/mockups/m36-u08/net-worth.html`):
 * a bank account's statement and opening balance, the bar over it, each goal's
 * part and Cash, not for any goal (D-376); an account with holdings' holdings with
 * their readings; a place's holdings, checked by hand. The account's actions —
 * add a holding, merge, rename, archive — and a place's are here, on the row.
 */
export function OpenedRow({ row, opening }: { row: Extract<NetWorthRow, { kind: 'ACCOUNT' | 'PLACE' }>; opening: Opening }) {
  const [mode, setMode] = useState<Mode>({ kind: 'LINES' })
  const [confirming, setConfirming] = useState<string | undefined>()
  const place = row.place
  const placeName = row.kind === 'ACCOUNT' ? row.account.name : (place?.place?.name ?? '')
  const close = (): void => setMode({ kind: 'LINES' })
  const { write, db } = opening

  if (mode.kind === 'HOLDING') {
    const { holding, isNew } = mode
    return (
      <Inside>
        <div className="fc-pop-enter border border-hairline-strong bg-elevated">
          <HoldingEditor
            key={holding.id}
            initial={holding}
            placeName={placeName}
            isNew={isNew}
            asOf={opening.asOf}
            onSave={(edited) => {
              const saved = write((database, now) => {
                // Where its figure comes from is read off its readings (M36 U11): a new one
                // has none, and one with none keeps what it was made as.
                const readings = isNew ? [] : listHoldingReadings(database, edited.id)
                const fields = {
                  holdingPlaceId: edited.holdingPlaceId,
                  name: edited.name,
                  kind: edited.kind,
                  provenance: readings.length === 0 ? edited.provenance : provenanceOf(readings),
                  lastConfirmedAt: edited.lastConfirmedAt,
                  isLiquid: edited.isLiquid,
                  expectedReturnBasisPoints: edited.expectedReturn?.basisPoints,
                  expectedReturnBasis: edited.expectedReturn?.basis,
                  termEndDate: edited.termEndDate,
                  feeBasisPoints: edited.feeBasisPoints,
                  note: edited.note,
                }
                if (isNew) createHolding(database, fields, now)
                else updateHolding(database, edited.id, fields, now)
              })
              if (saved) close()
            }}
            onCancel={close}
          />
        </div>
        {!isNew && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => write((database, now) => setHoldingArchived(database, holding.id, !holding.isArchived, now)) && close()}>
              {holding.isArchived ? 'Unarchive this holding' : 'Archive this holding'}
            </Button>
            {confirming === holding.id ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => write((database, now) => deleteHolding(database, holding.id, now)) && close()}>
                  Really delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(undefined)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(holding.id)}>
                Delete this holding
              </Button>
            )}
          </div>
        )}
      </Inside>
    )
  }

  if (mode.kind === 'PLACE' && place?.place !== undefined) {
    const editing = place.place
    const inPlace = listHoldings(db, { placeId: editing.id, includeArchived: true })
    const places = listHoldingPlaces(db, { includeArchived: true })
    // A card holds no money, and an account another place names is that place's
    // (D-354) — so neither is offered, unless it is this one's already (M30 F2).
    const nameable = opening.accounts.filter((account) =>
      editing.accountId !== undefined
        ? account.id === editing.accountId
        : account.kind !== 'CREDIT_CARD' &&
          !account.isArchived &&
          !places.some(
            (other) =>
              other.id !== editing.id &&
              other.accountId === account.id &&
              accountOfWhere(other.id) === undefined &&
              !isBarePlace(db, other.id),
          ),
    )
    return (
      <Inside>
        <div className="fc-pop-enter border border-hairline-strong bg-elevated">
          <PlaceEditor
            key={editing.id}
            initial={editing}
            isNew={false}
            accounts={nameable}
            holdings={inPlace}
            onSave={(edited, link) => {
              const cashNow = inPlace.find((held) => held.accountId !== undefined && held.accountId === editing.accountId)?.id
              const saved = write((database, now) => {
                updateHoldingPlace(database, edited.id, { name: edited.name, kind: edited.kind, institution: edited.institution, note: edited.note }, now)
                // The link is written only when it moved, so saving a name never touches a place's account (D-354).
                const moved = link.accountId !== editing.accountId || (link.accountId !== undefined && link.cashHoldingId !== cashNow)
                if (moved) setPlaceAccount(database, edited.id, link.accountId, now, { cashHoldingId: link.cashHoldingId })
              })
              if (saved) close()
            }}
            onCancel={close}
          />
        </div>
      </Inside>
    )
  }

  // An account with holdings no statement has been read for has no place yet:
  // the account's own id names it, and the first holding makes it (M36 U11).
  const addHoldingTo = place?.holdingPlaceId ?? (row.kind === 'ACCOUNT' ? accountWhereId(row.account.id) : undefined)
  const addHolding = (): void => {
    if (addHoldingTo === undefined) return
    setMode({ kind: 'HOLDING', isNew: true, holding: blankHolding(addHoldingTo) })
  }
  const editHolding = (holding: Holding): void => setMode({ kind: 'HOLDING', isNew: false, holding })

  return (
    <Inside>
      {row.kind === 'ACCOUNT' && row.group === 'BANK' ? (
        <BankInside row={row} opening={opening} onEdit={editHolding} />
      ) : (
        <div className="flex flex-col gap-1">
          <span className={LABEL}>{row.kind === 'ACCOUNT' ? 'What it holds' : 'What is here'}</span>
          {place === undefined || place.holdings.length === 0 ? (
            <p className="m-0 text-caption text-ink-secondary">
              {row.kind === 'ACCOUNT'
                ? 'Nothing is held here yet. A statement of it lists what it holds.'
                : 'Nothing is held here yet. Add what it is: the cash, the deposit, the fund.'}
            </p>
          ) : (
            <Lines>
              {place.holdings.map((held) => (
                <HoldingLine
                  key={held.holdingId}
                  held={held}
                  opening={opening}
                  ownCashOf={row.kind === 'ACCOUNT' && held.holding?.accountId === row.account.id}
                  byHand={row.kind === 'PLACE'}
                  onEdit={editHolding}
                />
              ))}
            </Lines>
          )}
        </div>
      )}

      {mode.kind === 'MERGE' && row.kind === 'ACCOUNT' ? (
        <MergePanel db={db} source={row.account} accounts={opening.accounts} write={write} onDone={close} />
      ) : mode.kind === 'RENAME' && row.kind === 'ACCOUNT' ? (
        <RenamePanel account={row.account} write={write} onDone={close} />
      ) : row.kind === 'ACCOUNT' ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Button variant="secondary" size="sm" onClick={addHolding}>
            {row.group === 'BANK' ? 'Add a holding here' : 'Add a holding'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode({ kind: 'MERGE' })}>
            Merge into…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode({ kind: 'RENAME' })}>
            Rename
          </Button>
          <Button variant="ghost" size="sm" onClick={() => write((database, now) => setAccountArchived(database, row.account.id, !row.account.isArchived, now))}>
            {row.account.isArchived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
      ) : (
        place?.place !== undefined && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Button variant="secondary" size="sm" onClick={addHolding}>
              Add a holding
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMode({ kind: 'PLACE' })}>
              Edit
            </Button>
            {confirming === place.holdingPlaceId ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => write((database, now) => deleteHoldingPlace(database, place.holdingPlaceId, now))}>
                  Really delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(undefined)}>
                  Keep
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => write((database, now) => setHoldingPlaceArchived(database, place.holdingPlaceId, place.place?.isArchived !== true, now))}
                >
                  {place.place.isArchived ? 'Unarchive' : 'Archive'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(place.holdingPlaceId)}>
                  Delete
                </Button>
              </>
            )}
          </div>
        )
      )}
    </Inside>
  )
}

type Mode =
  | { readonly kind: 'LINES' }
  | { readonly kind: 'HOLDING'; readonly isNew: boolean; readonly holding: Holding }
  | { readonly kind: 'PLACE' }
  | { readonly kind: 'MERGE' }
  | { readonly kind: 'RENAME' }

/** `.inside`: what an opened row holds, indented under its name. */
function Inside({ children }: { children: ReactNode }) {
  return <div className="fc-pop-enter flex flex-col gap-3.5 pt-1 pr-[18px] pb-4 pl-10 max-sm:px-2.5">{children}</div>
}

function Lines({ children }: { children: ReactNode }) {
  return (
    <table className="w-full border-collapse">
      <tbody>{children}</tbody>
    </table>
  )
}

/** A bank or cash account: its statement, the bar, and what is in it. */
function BankInside({
  row,
  opening,
  onEdit,
}: {
  row: Extract<NetWorthRow, { kind: 'ACCOUNT' }>
  opening: Opening
  onEdit: (holding: Holding) => void
}) {
  const { account, balance, place } = row
  const statement = place?.statement
  const ends = balance?.statementBalance
  const cash = place?.holdings.find((held) => held.holding?.accountId === account.id)
  const others = place?.holdings.filter((held) => held !== cash) ?? []
  const parts = statement?.parts ?? []
  const held = parts.reduce((sum, part) => sum + part.amount.minor, 0)
  const cashFigure: Money | undefined = statement !== undefined ? statement.cash : cash?.balance
  const day = balance?.balanceTo === undefined ? 'last' : formatDayMonth(balance.balanceTo)
  // The cushion is every ticked account's Cash, not for any goal (D-360), so this
  // account's is its part here; the whole is said once, below (M36 F3, D-393).
  const cushionHere = opening.cushion.accounts.some((one) => one.accountId === account.id && one.counts)

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className={LABEL}>Statement</span>
        {balance !== undefined && ends !== undefined ? (
          <>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <p className="m-0 flex-[1_1_320px]">
                {day} statement, ends at <b className="font-medium tabular-nums">{formatMoney(ends)}</b>.
              </p>
              {balance.check.kind === 'ADDS_UP' && <Tag tone="good">Proved</Tag>}
              {balance.check.kind === 'OFF' && (
                <Tag tone="bad">Off by {formatMoney(money(Math.abs(balance.check.missing.minor), balance.check.missing.currency))}</Tag>
              )}
              {balance.check.kind === 'UNCHECKED' && <Tag>Unchecked</Tag>}
            </div>
            {balance.newerWithoutBalance !== undefined && (
              <p className="m-0 text-caption text-negative">
                Older than the {formatDayMonth(balance.newerWithoutBalance.to)} statement, which has no balance that adds up.
              </p>
            )}
            <OpeningLine balance={balance} opening={opening} />
          </>
        ) : (
          <p className="m-0 text-caption text-ink-secondary">
            No statement read yet, so what is here is what was written down by hand. Reading a statement for <Bidi>{account.name}</Bidi>{' '}
            replaces it with what the statement ends at.
          </p>
        )}
      </div>

      {statement !== undefined && <StatementBar statement={statement} currency={opening.currency} cushion={cushionHere} />}

      <div className="flex flex-col gap-1">
        <span className={LABEL}>What is in it</span>
        <Lines>
          {parts.map((part) => (
            <tr key={part.goalId}>
              <td className={LINE}>
                <Link to={`/wealth/goals/${part.goalId}`} className={LINK}>
                  <Bidi>{part.goalName}</Bidi>
                </Link>{' '}
                <span className="text-caption text-ink-secondary">goal saved here</span>
              </td>
              <td className={FIG}>{formatMoney(part.amount)}</td>
              <td className={`${LINE} w-[1%]`} />
            </tr>
          ))}
          <tr>
            <td className={`${LINE} ${parts.length > 0 ? 'border-hairline-strong font-medium' : ''}`}>
              Cash, not for any goal{' '}
              <span className="text-caption font-normal text-ink-secondary">
                {cushionHere ? "the cushion's part here: " : ''}
                {statement !== undefined
                  ? parts.length > 0
                    ? 'the statement, less the goals here'
                    : 'the statement; no goal is saved here'
                  : 'written down by hand'}
              </span>
            </td>
            <td className={`${FIG} ${parts.length > 0 ? 'border-hairline-strong' : ''}`}>
              {statement?.short !== undefined ? <span className="text-negative">none</span> : formatMoney(cashFigure ?? money(0, opening.currency))}
            </td>
            <td className={`${LINE} w-[1%] ${parts.length > 0 ? 'border-hairline-strong' : ''}`} />
          </tr>
          {others.map((one) => (
            <HoldingLine key={one.holdingId} held={one} opening={opening} ownCashOf={false} byHand={false} onEdit={onEdit} />
          ))}
        </Lines>
        {statement?.short !== undefined && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-2.5">
            <Tag tone="bad">Off by {formatMoney(statement.short)}</Tag>
            <p className="m-0 flex-[1_1_320px] text-caption text-ink-secondary">
              The goals saved here hold <span className="tabular-nums">{formatMoney(money(held, opening.currency))}</span>, and the {day}{' '}
              statement ends at <span className="tabular-nums">{formatMoney(statement.balance)}</span>. Usually money was spent from a
              goal that the goal still counts, or a deposit was recorded that never reached the bank.{' '}
              {parts.map((part, index) => (
                <span key={part.goalId}>
                  {index === 0 ? '' : ' · '}
                  <Link to={`/wealth/goals/${part.goalId}`} className={LINK}>
                    <Bidi>{part.goalName}</Bidi>'s deposits
                  </Link>
                </span>
              ))}
            </p>
          </div>
        )}
      </div>

      {cushionHere && (
        <div className="flex flex-col gap-1">
          <span className={LABEL}>The cushion</span>
          <CushionHere cushion={opening.cushion} accountId={account.id} />
        </div>
      )}
    </>
  )
}

/** The opening balance under a statement, and Change / Set in place (what Balances did). */
function OpeningLine({ balance, opening }: { balance: AccountBalance; opening: Opening }) {
  const [editing, setEditing] = useState(false)
  const [amountText, setAmountText] = useState('')
  const [dateText, setDateText] = useState('')
  const [problem, setProblem] = useState<string | undefined>()

  const start = (): void => {
    setEditing(true)
    setProblem(undefined)
    setAmountText(balance.opening === undefined ? '' : toDecimalString(balance.opening))
    setDateText(balance.openingDate === undefined ? '' : toISODate(balance.openingDate))
  }
  const save = (clear: boolean): void => {
    let set: { amount: Money; date: LocalDate } | undefined
    if (!clear) {
      const parsed = parseAmountText(amountText)
      const date = parseISODate(dateText)
      if (parsed === undefined) return setProblem('That is not an amount.')
      if (date === undefined) return setProblem('Give the date as 2026-01-01.')
      set = { amount: fromMajorUnits(parsed, opening.currency), date }
    }
    if (opening.write((database, now) => setOpeningBalance(database, balance.accountId, set, now))) setEditing(false)
  }

  if (editing) {
    return (
      <div className="fc-pop-enter mt-1 flex flex-col gap-2.5 border border-hairline-strong bg-elevated px-3.5 py-3" role="group" aria-label={`Opening balance of ${balance.name}`}>
        <b className="font-medium">
          <Bidi>{balance.name}</Bidi>, before the statements start
        </b>
        <div className="grid max-w-md grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <label htmlFor="opening-date">As of</label>
          <input
            id="opening-date"
            type="date"
            value={dateText}
            onChange={(event) => setDateText(event.target.value)}
            className="h-[30px] border border-hairline-strong bg-background px-2"
          />
          <label htmlFor="opening-amount">You had</label>
          <input
            id="opening-amount"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save(false)
            }}
            className="h-[30px] border border-hairline-strong bg-background px-2 text-right tabular-nums"
          />
        </div>
        {problem !== undefined && <p className="m-0 text-negative">{problem}</p>}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="sm" icon="check" onClick={() => save(false)}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {balance.opening !== undefined && (
            <Button variant="ghost" size="sm" onClick={() => save(true)}>
              Forget it
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (balance.opening === undefined || balance.openingDate === undefined) {
    return (
      <p className="m-0 text-caption text-ink-secondary">
        Opening balance not set. Say what the account held before its first statement, and the statements are checked against it.{' '}
        <button type="button" className={LINK} onClick={start}>
          Set
        </button>
      </p>
    )
  }
  return (
    <p className="m-0 text-caption text-ink-secondary">
      Opening balance <span className="tabular-nums">{formatMoney(balance.opening)}</span> on {formatDayMonth(balance.openingDate)}{' '}
      {String(balance.openingDate.year)}, and the statements moved{' '}
      <span className="tabular-nums">
        {balance.moved.minor >= 0 ? '+' : ''}
        {formatMoney(balance.moved)}
      </span>{' '}
      since.{' '}
      {balance.check.kind === 'UNCHECKED' && balance.check.reason !== 'NO_OPENING' && (
        <>
          {balance.check.reason === 'MIXED_CURRENCY'
            ? 'The opening balance and the statements are in different currencies. '
            : 'No statement printed a running balance to check against. '}
        </>
      )}
      <button type="button" className={LINK} onClick={start}>
        Change
      </button>
    </p>
  )
}

/** One holding as a line: its figure, where the figure came from, and how to change it. */
function HoldingLine({
  held,
  opening,
  ownCashOf,
  byHand,
  onEdit,
}: {
  held: HoldingBalance
  opening: Opening
  /** It is the account's own cash: read off the statement, not counted by hand. */
  ownCashOf: boolean
  /** A place kept by hand: what it asks is *Checked today*, not a new reading. */
  byHand: boolean
  onEdit: (holding: Holding) => void
}) {
  const holding = held.holding
  const worth = opening.worths.get(held.holdingId)
  const isReading = opening.reading === held.holdingId
  useEffect(() => {
    if (isReading) document.getElementById(`holding-${held.holdingId}`)?.scrollIntoView({ block: 'center' })
  }, [isReading, held.holdingId])

  if (holding === undefined) {
    return (
      <tr>
        <td className={LINE}>
          <span className="text-ink-secondary">A holding this document no longer has</span>
        </td>
        <td className={FIG}>{formatMoney(held.balance)}</td>
        <td className={`${LINE} w-[1%]`} />
      </tr>
    )
  }
  const checked = checkedOf(holding, opening.asOf, worth, false)
  const caption = [
    ownCashOf ? 'its own cash' : holding.name === HOLDING_KIND_LABEL[holding.kind] ? undefined : HOLDING_KIND_LABEL[holding.kind].toLowerCase(),
    holding.isLiquid ? undefined : holding.termEndDate === undefined ? 'locked' : `locked until ${longDay(holding.termEndDate)}`,
    // Where the figure comes from is not said: by hand with no reading, it is what was written down (M36 U11).
    worth === undefined ? checked.phrase : worthPhrase(worth),
    holding.isArchived ? 'archived' : undefined,
  ]
    .filter((one): one is string => one !== undefined)
    .join(' · ')

  return (
    <>
      <tr id={`holding-${holding.id}`}>
        <td className={LINE}>
          <Bidi>{holding.name}</Bidi> {caption !== '' && <span className="text-caption text-ink-secondary">{caption}</span>}
        </td>
        <td className={FIG}>{formatMoney(held.balance)}</td>
        <td className={`${LINE} w-[1%] pl-2 whitespace-nowrap`}>
          <span className="inline-flex gap-3">
            {checked.askable &&
              (byHand ? (
                <button
                  type="button"
                  className={LINK}
                  onClick={() => opening.write((database, now) => confirmHolding(database, holding.id, opening.asOf, now))}
                >
                  Checked today
                </button>
              ) : (
                <button type="button" className={LINK} onClick={() => opening.onReading(holding.id)}>
                  New figure
                </button>
              ))}
            <button type="button" className="text-ink-secondary hover:text-ink" onClick={() => onEdit(holding)}>
              Edit
            </button>
          </span>
        </td>
      </tr>
      {isReading && (
        <tr>
          <td colSpan={3} className="pb-2">
            <HoldingReadings holdingId={holding.id} currency={opening.currency} asOf={opening.asOf} startOpen />
          </td>
        </tr>
      )}
    </>
  )
}

/** Merge one account into another of its kind — the Accounts screen's merge, on the row. */
function MergePanel({
  db,
  source,
  accounts,
  write,
  onDone,
}: {
  db: Database
  source: Account
  accounts: readonly Account[]
  write: Write
  onDone: () => void
}) {
  const targets = accounts.filter((one) => one.id !== source.id && one.kind === source.kind && !one.isArchived)
  const [intoId, setIntoId] = useState('')
  const target = targets.find((one) => one.id === intoId)
  const preview = target === undefined ? undefined : mergePreview(db, source.id, target.id)
  const labelOf = (one: Account): string => (one.last4 === undefined ? one.name : `${one.name} ·${one.last4}`)

  return (
    <div className="fc-pop-enter flex flex-col gap-2 border border-hairline-strong bg-elevated px-3.5 py-3">
      {targets.length === 0 ? (
        <p className="m-0">
          There is nothing to merge <Bidi className="font-medium">{source.name}</Bidi> into: only two accounts of one kind can be merged.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Merge <Bidi className="font-medium">{source.name}</Bidi> into
            </span>
            <ChoiceField
              text={target === undefined ? '' : labelOf(target)}
              choices={targets.map((one) => ({ value: one.id, label: labelOf(one) }))}
              filter={false}
              readOnly
              placeholder="Choose an account…"
              aria-label="Which account it becomes"
              onText={() => undefined}
              onPick={(choice) => setIntoId(choice.value)}
              className={`${FIELD} h-[30px] w-[190px]`}
            />
          </div>
          <p className="m-0 text-caption text-ink-secondary">
            {preview === undefined || target === undefined ? (
              <>
                Everything moves across and <Bidi>{source.name}</Bidi> goes away. Use this when one account was read twice, under two
                names.
              </>
            ) : (
              <>
                <span className="text-ink tabular-nums">{preview.moved}</span> {preview.moved === 1 ? 'transaction moves' : 'transactions move'}{' '}
                into <Bidi className="text-ink">{target.name}</Bidi>
                {preview.duplicates > 0 && (
                  <>
                    , and <span className="text-ink tabular-nums">{preview.duplicates}</span>{' '}
                    {preview.duplicates === 1 ? 'row that is already there is' : 'rows that are already there are'} dropped — the same
                    charge, recorded twice
                  </>
                )}
                . Its goal money and anything held there go with them. Imports and readers follow.
              </>
            )}
          </p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {targets.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            disabled={target === undefined}
            onClick={() => {
              if (target !== undefined && write((database, now) => mergeAccounts(database, source.id, target.id, now))) onDone()
            }}
          >
            Merge
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function RenamePanel({ account, write, onDone }: { account: Account; write: Write; onDone: () => void }) {
  const [name, setName] = useState(account.name)
  const save = (): void => {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === account.name) return onDone()
    if (write((database, now) => renameAccount(database, account.id, trimmed, now))) onDone()
  }
  return (
    <div className="fc-pop-enter flex flex-wrap items-center gap-2">
      <input
        autoFocus
        dir="auto"
        value={name}
        aria-label="The account's name"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save()
          if (event.key === 'Escape') onDone()
        }}
        className={`${FIELD} h-[30px] w-[220px]`}
      />
      <Button variant="primary" size="sm" onClick={save}>
        Save
      </Button>
      <Button variant="ghost" size="sm" onClick={onDone}>
        Cancel
      </Button>
    </div>
  )
}

/** 3 Mar 2027. */
function longDay(date: LocalDate): string {
  return `${formatDayMonth(date)} ${String(date.year)}`
}

/**
 * Where a holding's figure came from, when a reading says (M30 F5): the reading's
 * day, and the growth on what went in — or that what moved since is counted on it.
 */
export function worthPhrase(worth: HoldingWorth): string {
  const day = parseISODate(worth.asOf)
  const read = day === undefined ? worth.asOf : formatDayMonth(day)
  const since = worth.worth.minor === worth.reading.minor ? '' : ', and what moved since'
  if (worth.growth === undefined) return `read ${read}${since}`
  const sign = worth.growth.minor > 0 ? '+' : worth.growth.minor < 0 ? '−' : ''
  return `read ${read}${since} · ${sign}${formatMoney(money(Math.abs(worth.growth.minor), worth.growth.currency))} growth`
}
