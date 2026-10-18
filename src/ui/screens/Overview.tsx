import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import { listed } from '@/core/text.ts'
import { formatDayMonth, parseISODate, toISODate } from '@/core/time.ts'
import { rescanSettlements } from '@/data/importer/settlementScan.ts'
import { createAccount, type AccountKind } from '@/data/repositories/accountRepository.ts'
import { cushionReading } from '@/data/repositories/cushionRepository.ts'
import { MADE_AS, NEW_PLACE_KINDS, type NewPlaceAnswer } from '@/data/repositories/goalWhereRepository.ts'
import { createHolding, createHoldingPlace } from '@/data/repositories/savingsRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { suggestTransfers } from '@/data/repositories/transferPairRepository.ts'
import type { HoldingWorth } from '@/domain/holdingReadings.ts'
import { describeGap } from '@/domain/netWorth.ts'
import type { PlaceBalance } from '@/domain/savings.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { DEBT_KIND_LABEL } from '@/ui/debts/labels.ts'
import { FUND_TYPE_LABEL } from '@/ui/funds/labels.ts'
import type { Write } from '@/ui/savings/Cushion.tsx'
import { readingWanted } from '@/ui/savings/holdingCheck.ts'
import { PLACE_KIND_LABEL } from '@/ui/savings/labels.ts'
import { NEW_KIND_LABEL } from '@/ui/savings/WherePicker.tsx'
import { today } from '@/ui/today.ts'
import { OpenedRow, type Opening } from '@/ui/wealth/NetWorthOpened.tsx'
import { GROUP_LABEL, NET_WORTH_GROUPS, netWorthTable, type NetWorthRow } from '@/ui/wealth/netWorthRows.ts'
import { Screen, Src } from '@/ui/wealth/parts.tsx'

/**
 * **Net worth is one table** (M36 U08, `docs/mockups/m36-u08/net-worth.html`).
 *
 * Wealth used to show a bank account three or four times — the hero, Balances,
 * the bank's split with its ticks, *Where the rest is*, and the money map folded
 * under it, where every bank account also had a place. Now there is one row per
 * account or place, then the funds and the debts, and the rows add up to the
 * table's last line, **`netWorth`** (D-383): the figure the top of the screen,
 * Home and the savings tool read. A row opens to what is in it — a bank
 * account's statement and opening balance, the bar over it, each goal's part and
 * Cash, not for any goal (D-376); a broker's holdings; a place's. The cushion,
 * its ticks included, is set on Plan since M36 U10, and shown read-only under an
 * account it lives in (M36 F3).
 * Adding an account or a place, and merging two accounts, happen here.
 */
export function Overview() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  const [open, setOpen] = useState<string | undefined>()
  const [adding, setAdding] = useState<'ACCOUNT' | 'PLACE' | undefined>()
  const [showArchived, setShowArchived] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()
  // Home's New figure names the holding it is about (M36 U01): its row opens, with the form.
  const wanted = readingWanted(useLocation().state)
  const [reading, setReading] = useState<string | undefined>(wanted)

  const asOf = today()
  const currency: CurrencyCode = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])
  const read = useMemo(() => {
    if (db === undefined) return undefined
    return { table: netWorthTable(db, asOf, currency), cushion: cushionReading(db, asOf, currency) }
  }, [db, revision, currency])

  useEffect(() => {
    if (wanted === undefined || read === undefined) return
    setReading(wanted)
    const row = read.table.rows.find(
      (one) => (one.kind === 'ACCOUNT' || one.kind === 'PLACE') && one.place?.holdings.some((held) => held.holdingId === wanted),
    )
    if (row !== undefined) setOpen(row.key)
    // Only when a navigation names a holding, not on every write.
  }, [wanted])

  if (db === undefined || read === undefined) {
    return <Centered>Open a document, or create one, to see what it adds up to.</Centered>
  }

  const write: Write = (work) => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
      return true
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const { table } = read
  const now = table.worth
  // Archived rows stay while they hold something: net worth still counts them.
  const rows = table.rows.filter((row) => showArchived || !archived(row) || (row.figure !== undefined && row.figure.minor !== 0))
  const hasArchived = table.rows.some(archived)
  const opening: Opening = {
    db,
    currency,
    asOf,
    accounts: table.accounts,
    worths: table.map.worths,
    cushion: read.cushion,
    write,
    reading,
    onReading: (holdingId) => setReading((was) => (was === holdingId ? undefined : holdingId)),
  }
  const toggle = (row: NetWorthRow): void => {
    if (row.kind === 'FUND') {
      void navigate(`/wealth/funds/${row.fund.fundId}`)
      return
    }
    if (row.kind === 'DEBT') {
      void navigate(`/wealth/debts/${row.debt.id}`)
      return
    }
    setOpen((was) => (was === row.key ? undefined : row.key))
  }
  const owed = money(-now.liabilities.minor, currency)

  return (
    <div className="h-full overflow-auto">
      <Screen>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="m-0 text-[24px] leading-[1.15] font-medium tracking-[-0.01em]">Net worth</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon="add" onClick={() => setAdding('ACCOUNT')}>
              Add an account
            </Button>
            <Button variant="ghost" onClick={() => setAdding('PLACE')}>
              Add a place
            </Button>
            <PageMenu
              title="Net worth"
              items={[
                {
                  label: showArchived ? 'Hide archived accounts and places' : 'Show archived accounts and places',
                  ...(hasArchived ? {} : { detail: 'Nothing is archived' }),
                  disabled: !hasArchived && !showArchived,
                  onChoose: () => setShowArchived(!showArchived),
                },
              ]}
            />
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-x-9 gap-y-2.5 border-b border-hairline pb-[18px]">
          <div className="flex flex-col gap-0.5">
            <span className={LABEL}>Net worth</span>
            <span className="text-[34px] leading-[1.1] font-medium tracking-[-0.015em] whitespace-nowrap tabular-nums">
              {formatMoney(now.worth)}
            </span>
            <span className="text-caption text-ink-secondary">Everything you own, each once, less what you owe.</span>
          </div>
          <div className="flex flex-wrap gap-x-7 gap-y-1.5">
            <Part label="In the bank">{formatMoney(now.inBank)}</Part>
            <Part label="In accounts with holdings">{formatMoney(now.held)}</Part>
            <Part label="Locked">{formatMoney(money(now.locked.minor + now.funds.minor, currency))}</Part>
            <Part label="Owed">{formatMoney(owed)}</Part>
          </div>
        </div>
        {now.gaps.length > 0 && <Src>Not counted: {now.gaps.map(describeGap).join('; ')}.</Src>}
        {problem !== undefined && <p className="m-0 text-negative">{problem}</p>}

        {table.rows.length === 0 && adding === 'ACCOUNT' ? (
          <AddAccount write={write} onDone={() => setAdding(undefined)} />
        ) : table.rows.length === 0 && adding === 'PLACE' ? (
          <AddPlace write={write} onDone={() => setAdding(undefined)} />
        ) : table.rows.length === 0 ? (
          <div className="flex flex-col items-start gap-2 py-3 text-ink-secondary">
            <p className="m-0">
              Nothing here yet. Reading a bank statement makes its account; money with no statement — cash at home, a deposit — is a
              place.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon="add" onClick={() => setAdding('ACCOUNT')}>
                Add an account
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding('PLACE')}>
                Add a place
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto" data-guide="wealth.opening">
            <table className="w-full border-collapse" data-testid="net-worth">
              <thead>
                <tr>
                  <th className={TH}>Account or place</th>
                  <th className={`${TH} ${NARROW}`}>In it</th>
                  <th className={`${TH} ${NARROW}`}>Reach</th>
                  <th className={`${TH} text-right`}>Worth</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {NET_WORTH_GROUPS.map((group, index) => {
                  const members = rows.filter((row) => row.group === group)
                  if (members.length === 0) return null
                  return [
                    <tr key={group}>
                      <td colSpan={5} className={index === 0 ? 'pt-1.5 pb-1' : 'pt-[18px] pb-1'}>
                        <span className={LABEL}>{GROUP_LABEL[group]}</span>
                      </td>
                    </tr>,
                    ...members.flatMap((row) => {
                      const isOpen = open === row.key && (row.kind === 'ACCOUNT' || row.kind === 'PLACE')
                      return [
                        <Row key={row.key} row={row} isOpen={isOpen} worths={table.map.worths} onToggle={() => toggle(row)} />,
                        ...(isOpen && (row.kind === 'ACCOUNT' || row.kind === 'PLACE')
                          ? [
                              <tr key={`${row.key}:open`}>
                                <td colSpan={5} className="bg-surface p-0">
                                  <OpenedRow row={row} opening={opening} />
                                </td>
                              </tr>,
                            ]
                          : []),
                      ]
                    }),
                  ]
                })}
                <tr>
                  <td colSpan={3} className="border-t border-ink pt-2.5 pr-2.5 font-semibold">
                    Net worth
                  </td>
                  <td className="border-t border-ink pt-2.5 pr-2.5 text-right text-[16px] font-semibold whitespace-nowrap tabular-nums">
                    {formatMoney(now.worth)}
                  </td>
                  <td className="border-t border-ink" />
                </tr>
                {adding !== undefined && (
                  <tr>
                    <td colSpan={5} className="pt-1.5">
                      {adding === 'ACCOUNT' ? (
                        <AddAccount write={write} onDone={() => setAdding(undefined)} />
                      ) : (
                        <AddPlace write={write} onDone={() => setAdding(undefined)} />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

      </Screen>
    </div>
  )
}

const LABEL = 'text-label tracking-[0.08em] text-ink-secondary uppercase font-medium'
const TH = 'border-b border-hairline-strong pr-2.5 pb-1.5 text-left text-label font-medium tracking-[0.08em] whitespace-nowrap text-ink-secondary uppercase'
const TD = 'border-t border-hairline py-[9px] pr-2.5 align-middle'
const NARROW = 'max-[760px]:hidden'

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className={LABEL}>{label}</span>
      <span className="text-[16px] font-medium whitespace-nowrap tabular-nums">{children}</span>
    </div>
  )
}

function archived(row: NetWorthRow): boolean {
  if (row.kind === 'ACCOUNT') return row.account.isArchived
  if (row.kind === 'PLACE') return row.place.place?.isArchived === true
  return false
}

function Row({
  row,
  isOpen,
  worths,
  onToggle,
}: {
  row: NetWorthRow
  isOpen: boolean
  worths: ReadonlyMap<string, HoldingWorth>
  onToggle: () => void
}) {
  const opens = row.kind === 'ACCOUNT' || row.kind === 'PLACE'
  const cell = `${TD} ${isOpen ? 'border-t-hairline-strong bg-surface' : 'group-hover:bg-surface'}`
  const onKey = (event: KeyboardEvent<HTMLTableRowElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle()
    }
  }
  return (
    <tr
      className="group cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      tabIndex={0}
      aria-expanded={opens ? isOpen : undefined}
      data-row={row.key}
      onClick={onToggle}
      onKeyDown={onKey}
    >
      <td className={cell}>
        <span className="font-medium">
          <Bidi>{nameOf(row)}</Bidi>
          {row.kind === 'ACCOUNT' && row.account.last4 !== undefined && (
            <small className="ml-1.5 text-[12px] font-normal text-ink-secondary">···{row.account.last4}</small>
          )}
        </span>
        <span className="block text-caption text-ink-secondary">{subOf(row, worths)}</span>
      </td>
      <td className={`${cell} ${NARROW} text-caption text-ink-secondary`}>{inItOf(row)}</td>
      <td className={`${cell} ${NARROW} text-caption text-ink-secondary`}>{row.kind === 'ACCOUNT' || row.kind === 'PLACE' ? row.reach : row.kind === 'FUND' ? 'Locked' : ''}</td>
      <td className={`${cell} text-right font-medium whitespace-nowrap tabular-nums ${row.figure !== undefined && row.figure.minor < 0 ? 'text-negative' : ''}`}>
        {row.figure === undefined ? <span className="font-normal text-ink-secondary">unchecked</span> : formatMoney(row.figure)}
      </td>
      <td className={`${cell} w-[26px] text-center text-ink-tertiary`} title={opens ? undefined : 'Opens on its own page'}>
        <Chevron down={isOpen} />
      </td>
    </tr>
  )
}

function Chevron({ down }: { down: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="inline-block">
      <path d={down ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3'} />
    </svg>
  )
}

function nameOf(row: NetWorthRow): string {
  switch (row.kind) {
    case 'ACCOUNT':
      return row.account.name
    case 'PLACE':
      return row.place.place?.name ?? 'Somewhere this document no longer has'
    case 'FUND':
      return row.fund.name
    case 'DEBT':
      return row.debt.name
  }
}

/** The line under a row's name: which statement, or how the figure is known. */
function subOf(row: NetWorthRow, worths: ReadonlyMap<string, HoldingWorth>): ReactNode {
  switch (row.kind) {
    case 'ACCOUNT': {
      const parts: ReactNode[] = []
      if (row.group === 'BANK') {
        const balance = row.balance
        parts.push(
          balance?.statementBalance === undefined
            ? 'no statement read yet'
            : balance.balanceTo === undefined
              ? 'last statement'
              : `${formatDayMonth(balance.balanceTo)} statement`,
        )
        if (balance?.newerWithoutBalance !== undefined) {
          parts.push(<span className="text-negative">older than the {formatDayMonth(balance.newerWithoutBalance.to)} statement</span>)
        }
        const short = row.place?.statement?.short
        if (short !== undefined) parts.push(<span className="text-negative">the goals hold {formatMoney(short)} more</span>)
      } else {
        const last = latestReading(row.place, worths)
        parts.push(last === undefined ? 'no statement read yet' : `${last} statement`)
      }
      if (row.account.isArchived) parts.push('archived')
      return joined(parts)
    }
    case 'PLACE': {
      const place = row.place.place
      if (place === undefined) return 'money in a holding that has been deleted, counted as locked'
      return joined([PLACE_KIND_LABEL[place.kind], place.institution === undefined ? undefined : <Bidi>{place.institution}</Bidi>, place.isArchived ? 'archived' : undefined])
    }
    case 'FUND':
      return joined([
        row.fund.institution === undefined ? undefined : <Bidi>{row.fund.institution}</Bidi>,
        row.fund.asOf === undefined ? 'no report yet' : `${formatDayMonth(row.fund.asOf)} report`,
      ])
    case 'DEBT':
      return joined([DEBT_KIND_LABEL[row.debt.kind], row.debt.isClosed ? 'closed' : undefined, row.figure === undefined ? 'not one figure in this currency' : undefined])
  }
}

/** The newest reading among an account's holdings — the day its statement printed. */
function latestReading(place: PlaceBalance | undefined, worths: ReadonlyMap<string, HoldingWorth>): string | undefined {
  const days = (place?.holdings ?? []).flatMap((held) => {
    const worth = worths.get(held.holdingId)
    return worth === undefined ? [] : [worth.asOf]
  })
  const latest = parseISODate(days.sort().at(-1) ?? '')
  return latest === undefined ? undefined : formatDayMonth(latest)
}

/** What is in a row, in a few words. */
function inItOf(row: NetWorthRow): string {
  switch (row.kind) {
    case 'ACCOUNT': {
      if (row.group === 'HOLDINGS') {
        const count = row.place?.holdings.length ?? 0
        return count === 0 ? 'nothing yet' : count === 1 ? '1 holding' : `${String(count)} holdings`
      }
      const goals = row.place?.statement?.parts.length ?? 0
      const others = (row.place?.holdings ?? []).filter((held) => held.holding?.accountId !== row.account.id)
      const words = [
        goals === 0 ? undefined : goals === 1 ? 'a goal' : `${String(goals)} goals`,
        others.length === 0 ? undefined : others.length === 1 ? `a ${kindWord(others[0])}` : `${String(others.length)} holdings`,
        'cash',
      ].filter((one): one is string => one !== undefined)
      return listed(words)
    }
    case 'PLACE': {
      const holdings = row.place.holdings
      if (holdings.length === 0) return 'nothing yet'
      if (holdings.every((held) => held.holding?.provenance === 'RECORDED')) return 'written down by hand'
      return holdings.length === 1 ? `a ${kindWord(holdings[0])}` : `${String(holdings.length)} holdings`
    }
    case 'FUND':
      return row.fundType === undefined ? 'fund' : FUND_TYPE_LABEL[row.fundType].toLowerCase()
    case 'DEBT':
      return 'loan'
  }
}

function kindWord(held: { readonly holding?: { readonly kind: string } | undefined } | undefined): string {
  switch (held?.holding?.kind) {
    case 'DEPOSIT':
      return 'deposit'
    case 'FUND':
      return 'fund'
    case 'CASH':
      return 'cash holding'
    default:
      return 'holding'
  }
}

function joined(parts: readonly ReactNode[]): ReactNode {
  const shown = parts.filter((one) => one !== undefined && one !== '')
  return shown.map((one, index) => (
    <span key={index}>
      {index === 0 ? '' : ' · '}
      {one}
    </span>
  ))
}

const ACCOUNT_KINDS: readonly { readonly value: AccountKind; readonly label: string }[] = [
  { value: 'BANK', label: 'Bank account' },
  { value: 'CASH', label: 'Cash' },
  { value: 'HOLDINGS', label: 'Account with holdings' },
]

/** A new account, in place under the table: a row at once, with nothing in it until a statement is read. */
function AddAccount({ write, onDone }: { write: Write; onDone: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('BANK')
  const add = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    const made = write((database, now) => {
      createAccount(database, { name: trimmed, kind }, now)
      // As the Accounts screen does: which rows are bank rows has just changed (D-060, D-160).
      rescanSettlements(database, now)
      suggestTransfers(database)
    })
    if (made) onDone()
  }
  return (
    <div className="fc-pop-enter flex flex-col gap-2 border border-hairline-strong bg-elevated px-3.5 py-3">
      <span className={LABEL}>A new account</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          dir="auto"
          value={name}
          placeholder="Name, as the bank calls it"
          aria-label="New account name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
            if (event.key === 'Escape') onDone()
          }}
          className={`${FIELD} h-[30px] w-[220px]`}
        />
        <ChoiceField
          text={ACCOUNT_KINDS.find((one) => one.value === kind)?.label ?? ''}
          choices={ACCOUNT_KINDS}
          filter={false}
          readOnly
          aria-label="What kind of account"
          onText={() => undefined}
          onPick={(choice) => setKind(choice.value as AccountKind)}
          className={`${FIELD} h-[30px] w-[190px]`}
        />
        <Button variant="primary" size="sm" disabled={name.trim() === ''} onClick={add}>
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <p className="m-0 text-caption text-ink-secondary">
        It is a row at once, with nothing in it until a statement is read for it. A card is added on the Accounts screen: it holds no
        money of its own.
      </p>
    </div>
  )
}

/** Only what can be locked asks until when. */
const LOCKABLE: ReadonlySet<string> = new Set(['DEPOSIT', 'FUND'])

/** A new place — money with no statement of its own — asking the four kinds the goal form's + New… asks (D-363). */
function AddPlace({ write, onDone }: { write: Write; onDone: () => void }) {
  const [draft, setDraft] = useState<NewPlaceAnswer>({ kind: 'CASH_AT_HOME', name: '' })
  const set = (change: Partial<NewPlaceAnswer>): void => setDraft((was) => ({ ...was, ...change }))
  const add = (): void => {
    if (draft.name.trim() === '') return
    const name = draft.name.trim()
    const institution = draft.institution?.trim()
    const made = MADE_AS[draft.kind]
    // What + New… makes (makePlace, D-363): the place, and the one thing held in it.
    const added = write((database, now) => {
      const place = createHoldingPlace(database, { name, kind: made.place, ...(institution === undefined || institution === '' ? {} : { institution }) }, now)
      createHolding(
        database,
        {
          holdingPlaceId: place.id,
          name,
          kind: made.holding,
          provenance: made.provenance,
          isLiquid: draft.lockedUntil === undefined,
          ...(draft.lockedUntil === undefined ? {} : { termEndDate: draft.lockedUntil }),
        },
        now,
      )
    })
    if (added) onDone()
  }
  return (
    <div className="fc-pop-enter flex flex-col gap-2 border border-hairline-strong bg-elevated px-3.5 py-3">
      <span className={LABEL}>A new place</span>
      <div role="group" aria-label="What is it" className="flex flex-wrap">
        {NEW_PLACE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            onClick={() => set({ kind, ...(LOCKABLE.has(kind) ? {} : { lockedUntil: undefined }) })}
            className={`-ml-px h-[26px] border px-[9px] text-[12px] whitespace-nowrap first:ml-0 ${
              draft.kind === kind ? 'relative z-[1] border-accent bg-accent-soft text-ink' : 'border-hairline-strong text-ink-secondary'
            }`}
          >
            {NEW_KIND_LABEL[kind]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-col gap-[3px]">
          <span className="text-caption text-ink-secondary">Name</span>
          <input
            autoFocus
            dir="auto"
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
              if (event.key === 'Escape') onDone()
            }}
            className={`${FIELD} h-[30px] w-[200px]`}
          />
        </label>
        {draft.kind !== 'CASH_AT_HOME' && (
          <label className="flex flex-col gap-[3px]">
            <span className="text-caption text-ink-secondary">At</span>
            <input
              dir="auto"
              value={draft.institution ?? ''}
              onChange={(event) => set({ institution: event.target.value === '' ? undefined : event.target.value })}
              className={`${FIELD} h-[30px] w-[150px]`}
            />
          </label>
        )}
        {LOCKABLE.has(draft.kind) && (
          <label className="flex flex-col gap-[3px]">
            <span className="text-caption text-ink-secondary">Locked until</span>
            <input
              type="date"
              value={draft.lockedUntil === undefined ? '' : toISODate(draft.lockedUntil)}
              onChange={(event) => set({ lockedUntil: parseISODate(event.target.value) ?? undefined })}
              className={`${FIELD} h-[30px] w-[150px]`}
            />
          </label>
        )}
      </div>
      <p className="m-0 text-caption text-ink-secondary">
        Money with no statement of its own. A place an account's statement shows is that account's row.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={draft.name.trim() === ''} onClick={add}>
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
