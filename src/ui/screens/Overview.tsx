import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { money, type CurrencyCode } from '@/core/money.ts'
import { parseISODate, toISODate } from '@/core/time.ts'
import { rescanSettlements } from '@/data/importer/settlementScan.ts'
import { createAccount, type AccountKind } from '@/data/repositories/accountRepository.ts'
import { cushionReading } from '@/data/repositories/cushionRepository.ts'
import { MADE_AS, NEW_PLACE_KINDS, type NewPlaceAnswer } from '@/data/repositories/goalWhereRepository.ts'
import { createHolding, createHoldingPlace } from '@/data/repositories/savingsRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { suggestTransfers } from '@/data/repositories/transferPairRepository.ts'
import type { HoldingWorth } from '@/domain/holdingReadings.ts'
import type { PlaceBalance } from '@/domain/savings.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { kitMoney, wholeMoney } from '@/ui/charts/kit.ts'
import { PartOfWhole } from '@/ui/charts/PartOfWhole.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState, WaitingList, type Waiting } from '@/ui/components/WaitingList.tsx'
import type { Write } from '@/ui/savings/Cushion.tsx'
import { readingWanted } from '@/ui/savings/holdingCheck.ts'
import { today } from '@/ui/today.ts'
import { OpenedRow, type Opening } from '@/ui/wealth/NetWorthOpened.tsx'
import { NET_WORTH_GROUPS, netWorthTable, type NetWorthRow } from '@/ui/wealth/netWorthRows.ts'
import { useWealthWords, type WealthWords } from '@/ui/wealth/words.ts'

/**
 * **Net worth, answered first** (M64 U10, D-622; M36 U08 made it one table).
 *
 * The screen asks *what do I own, all together?* and says so in a sentence:
 * everything owned, less what is owed, is the one display figure, and what it
 * is made of — the bank, the accounts with holdings, what is locked — is one
 * thin bar under it. Then the table: one row per account or place, then the
 * funds and the debts, adding up to `netWorth` (D-383), the figure Home and the
 * savings tool read.
 *
 * **A row opens beside the page** (D-617): an account's statement, its opening
 * balance, its goals' parts and its holdings in the side panel, the table
 * staying where it was; a fund or a debt opens its own detail beside its list.
 * Adding an account or a place is a form in the same panel.
 */
export function Overview() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  const t = useT()
  const words = useWealthWords()
  const [panel, setPanel] = useState<Panel | undefined>()
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
    if (row !== undefined) setPanel({ kind: 'row', key: row.key })
    // Only when a navigation names a holding, not on every write.
  }, [wanted])

  if (db === undefined || read === undefined) {
    return <Centered>{t('wealth.worth.noDocument')}</Centered>
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
  const open = (row: NetWorthRow): void => {
    if (row.kind === 'FUND') {
      void navigate(`/wealth/funds/${row.fund.fundId}`)
      return
    }
    if (row.kind === 'DEBT') {
      void navigate(`/wealth/debts/${row.debt.id}`)
      return
    }
    setPanel((was) => (was?.kind === 'row' && was.key === row.key ? undefined : { kind: 'row', key: row.key }))
  }
  const owed = money(now.liabilities.minor, currency)
  const owned = money(now.worth.minor + now.liabilities.minor, currency)
  const reachable = money(now.inBank.minor + now.held.minor, currency)
  const locked = money(now.locked.minor + now.funds.minor, currency)
  const opened = panel?.kind === 'row' ? rows.find((row) => row.key === panel.key) : undefined
  // What waits on the person, below the answer: a balance older than a statement read since, goals an account cannot cover.
  const waiting: Waiting[] = rows.flatMap((row): Waiting[] => {
    if (row.kind !== 'ACCOUNT' || row.group !== 'BANK') return []
    const lines: Waiting[] = []
    const newer = row.balance?.newerWithoutBalance
    if (newer !== undefined) {
      lines.push({
        key: `${row.key}:older`,
        say: t('wealth.worth.waiting.older', { name: row.account.name, day: words.dates.dayMonth(newer.to) }),
        why: t('wealth.worth.waiting.olderWhy'),
        verb: t('wealth.worth.waiting.open'),
        onDo: () => setPanel({ kind: 'row', key: row.key }),
      })
    }
    const short = row.place?.statement?.short
    if (short !== undefined) {
      lines.push({
        key: `${row.key}:short`,
        say: t('wealth.worth.waiting.short', { name: row.account.name, amount: kitMoney(short) }),
        why: t('wealth.worth.waiting.shortWhy'),
        verb: t('wealth.worth.waiting.open'),
        onDo: () => setPanel({ kind: 'row', key: row.key }),
      })
    }
    return lines
  })

  const page = (
    <div className="fc-view-enter flex flex-col gap-8 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="m-0 text-title leading-tight font-medium">{t('wealth.worth.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon="add" onClick={() => setPanel({ kind: 'account' })}>
            {t('wealth.worth.addAccount')}
          </Button>
          <PageMenu
            title={t('wealth.worth.title')}
            items={[
              { label: t('wealth.worth.addPlace'), icon: 'add', onChoose: () => setPanel({ kind: 'place' }) },
              {
                label: showArchived ? t('wealth.worth.hideArchived') : t('wealth.worth.showArchived'),
                ...(hasArchived ? {} : { detail: t('wealth.worth.nothingArchived') }),
                disabled: !hasArchived && !showArchived,
                separated: true,
                onChoose: () => setShowArchived(!showArchived),
              },
            ]}
          />
        </div>
      </header>

      {problem !== undefined && <Problem text={problem} onDismiss={() => setProblem(undefined)} />}

      {table.rows.length === 0 ? (
        <EmptyState say={t('wealth.worth.empty')} verb={t('wealth.worth.addAccount')} onDo={() => setPanel({ kind: 'account' })} />
      ) : (
        <>
          <div className="flex flex-col gap-6">
            {/* The amounts are part of the sentence, not figures of their own: one display figure a screen. */}
            <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">
              {owed.minor === 0
                ? t('wealth.worth.sentenceNoDebt', { worth: wholeMoney(now.worth) })
                : t('wealth.worth.sentence', { owned: wholeMoney(owned), owed: wholeMoney(owed), worth: wholeMoney(now.worth) })}
            </p>
            <HeadlineFigure size="display" tone="sign" label={t('wealth.worth.figure')} value={now.worth} change={t('wealth.worth.figureHow')} empty={t('wealth.worth.empty')} />
            <PartOfWhole
              label={t('wealth.worth.owned')}
              empty={t('wealth.worth.ownedEmpty')}
              parts={[
                // By reach, the table's own column: what can be reached now, and what is locked away.
                { key: 'reachable', name: t('wealth.kinds.reach.reachable'), value: reachable, hue: 'bar' },
                { key: 'locked', name: t('wealth.kinds.reach.locked'), value: locked, hue: 'bar-quiet' },
              ].filter((part) => part.value.minor !== 0)}
            />
            {now.gaps.length > 0 && (
              <p className="m-0 text-caption text-ink-secondary">{t('wealth.worth.notCounted', { gaps: now.gaps.map(words.gap).join('; ') })}</p>
            )}
          </div>

          <WaitingList label={t('wealth.common.waiting')} items={waiting} />

          <section className="flex flex-col gap-3" aria-labelledby="worth-rows" data-guide="wealth.opening">
            <h2 id="worth-rows" className="m-0 text-heading font-medium">
              {t('wealth.worth.rows')}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" data-testid="net-worth">
                <thead>
                  <tr className="border-b border-hairline text-caption text-ink-secondary uppercase">
                    <th className="h-8 pe-3 text-start font-medium">{t('wealth.worth.colName')}</th>
                    <th className={`h-8 pe-3 text-start font-medium ${NARROW}`}>{t('wealth.worth.colIn')}</th>
                    <th className={`h-8 pe-3 text-start font-medium ${NARROW}`}>{t('wealth.worth.colReach')}</th>
                    <th className="h-8 text-end font-medium">{t('wealth.worth.colWorth')}</th>
                  </tr>
                </thead>
                <tbody>
                  {NET_WORTH_GROUPS.map((group) => {
                    const members = rows.filter((row) => row.group === group)
                    if (members.length === 0) return null
                    return [
                      <tr key={group}>
                        <td colSpan={4} className="pt-5 pb-1 text-caption text-ink-secondary">
                          {words.group[group]}
                        </td>
                      </tr>,
                      ...members.map((row) => (
                        <Row
                          key={row.key}
                          row={row}
                          on={opened?.key === row.key}
                          worths={table.map.worths}
                          words={words}
                          onOpen={() => open(row)}
                        />
                      )),
                    ]
                  })}
                  <tr>
                    <td colSpan={3} className="h-10 border-t border-ink pe-3 font-medium">
                      {t('wealth.worth.figure')}
                    </td>
                    <td className="h-10 border-t border-ink text-end font-medium whitespace-nowrap tabular-nums">{kitMoney(now.worth)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>
      {panel?.kind === 'account' && (
        <SidePanel title={t('wealth.worth.newAccount')} kicker={t('wealth.worth.title')} onClose={() => setPanel(undefined)}>
          <AddAccount write={write} onDone={() => setPanel(undefined)} />
        </SidePanel>
      )}
      {panel?.kind === 'place' && (
        <SidePanel title={t('wealth.worth.newPlace')} kicker={t('wealth.worth.title')} onClose={() => setPanel(undefined)}>
          <AddPlace write={write} onDone={() => setPanel(undefined)} />
        </SidePanel>
      )}
      {opened !== undefined && (opened.kind === 'ACCOUNT' || opened.kind === 'PLACE') && (
        <SidePanel title={<Bidi>{nameOf(opened, words)}</Bidi>} kicker={words.group[opened.group]} onClose={() => setPanel(undefined)}>
          <p className="m-0 flex items-baseline justify-between gap-3">
            <span className="text-ink-secondary">{subOf(opened, table.map.worths, words)}</span>
            <span className="text-heading font-medium whitespace-nowrap tabular-nums">
              {opened.figure === undefined ? t('wealth.worth.unchecked') : kitMoney(opened.figure)}
            </span>
          </p>
          <OpenedRow key={opened.key} row={opened} opening={opening} />
        </SidePanel>
      )}
    </div>
  )
}

/** What the side panel shows: a row's contents, or the form for a new account or place. */
type Panel = { readonly kind: 'row'; readonly key: string } | { readonly kind: 'account' } | { readonly kind: 'place' }

const NARROW = 'max-[760px]:hidden'

function archived(row: NetWorthRow): boolean {
  if (row.kind === 'ACCOUNT') return row.account.isArchived
  if (row.kind === 'PLACE') return row.place.place?.isArchived === true
  return false
}

/** A write that failed, where it failed: a word and a way to put it away. */
export function Problem({ text, onDismiss }: { readonly text: string; readonly onDismiss: () => void }) {
  const t = useT()
  return (
    <p className="fc-pop-enter m-0 flex flex-wrap items-baseline gap-x-3 text-ink-secondary">
      <span aria-hidden className="inline-block size-2 rounded-full bg-negative" />
      <span className="text-ink">{text}</span>
      <button type="button" className="fc-text-action" onClick={onDismiss}>
        {t('wealth.common.dismiss')}
      </button>
    </p>
  )
}

/** One row of the table: the whole row opens what is in it, beside the page. Up and Down walk the rows. */
function Row({
  row,
  on,
  worths,
  words,
  onOpen,
}: {
  readonly row: NetWorthRow
  readonly on: boolean
  readonly worths: ReadonlyMap<string, HoldingWorth>
  readonly words: WealthWords
  readonly onOpen: () => void
}) {
  const t = useT()
  const plane = `h-10 border-t border-hairline align-middle ${on ? 'bg-surface' : 'group-hover:bg-surface'}`
  const cell = `${plane} pe-3`
  const onKey = (event: KeyboardEvent<HTMLTableRowElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    let next = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling
    while (next !== null && !(next instanceof HTMLElement && next.tabIndex === 0)) {
      next = event.key === 'ArrowDown' ? next.nextElementSibling : next.previousElementSibling
    }
    if (next instanceof HTMLElement) {
      event.preventDefault()
      next.focus()
    }
  }
  return (
    <tr
      className="group cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      tabIndex={0}
      aria-current={on ? 'true' : undefined}
      data-row={row.key}
      onClick={onOpen}
      onKeyDown={onKey}
    >
      <td className={`${cell} py-2`}>
        <span className="font-medium">
          <Bidi>{nameOf(row, words)}</Bidi>
          {row.kind === 'ACCOUNT' && row.account.last4 !== undefined && (
            <span className="ms-1.5 text-caption font-normal text-ink-secondary">···{row.account.last4}</span>
          )}
        </span>
        <span className="block text-caption text-ink-secondary">{subOf(row, worths, words)}</span>
      </td>
      <td className={`${cell} ${NARROW} text-caption text-ink-secondary`}>{inItOf(row, words)}</td>
      <td className={`${cell} ${NARROW} text-caption text-ink-secondary`}>
        {row.kind === 'ACCOUNT' || row.kind === 'PLACE' ? words.reach(row.reach) : row.kind === 'FUND' ? words.t('wealth.kinds.reach.locked') : ''}
      </td>
      <td className={`${plane} text-end font-medium whitespace-nowrap tabular-nums`}>
        {row.figure === undefined ? <span className="font-normal text-ink-secondary">{t('wealth.worth.unchecked')}</span> : kitMoney(row.figure)}
      </td>
    </tr>
  )
}

function nameOf(row: NetWorthRow, words: WealthWords): string {
  switch (row.kind) {
    case 'ACCOUNT':
      return row.account.name
    case 'PLACE':
      return row.place.place?.name ?? words.t('wealth.worth.gone')
    case 'FUND':
      return row.fund.name
    case 'DEBT':
      return row.debt.name
  }
}

/** The line under a row's name: which statement, or how the figure is known. */
function subOf(row: NetWorthRow, worths: ReadonlyMap<string, HoldingWorth>, words: WealthWords): ReactNode {
  const { t, dates } = words
  switch (row.kind) {
    case 'ACCOUNT': {
      const parts: ReactNode[] = []
      if (row.group === 'BANK') {
        const balance = row.balance
        parts.push(
          balance?.statementBalance === undefined
            ? t('wealth.worth.noStatement')
            : balance.balanceTo === undefined
              ? t('wealth.worth.lastStatement')
              : t('wealth.worth.statementOf', { day: dates.dayMonth(balance.balanceTo) }),
        )
        if (balance?.newerWithoutBalance !== undefined) {
          parts.push(t('wealth.worth.olderThan', { day: dates.dayMonth(balance.newerWithoutBalance.to) }))
        }
        const short = row.place?.statement?.short
        if (short !== undefined) parts.push(t('wealth.worth.goalsHoldMore', { amount: kitMoney(short) }))
      } else {
        const last = latestReading(row.place, worths)
        parts.push(last === undefined ? t('wealth.worth.noStatement') : t('wealth.worth.statementOf', { day: dates.dayMonth(last) }))
      }
      if (row.account.isArchived) parts.push(t('wealth.worth.archived'))
      return joined(parts)
    }
    case 'PLACE': {
      const place = row.place.place
      if (place === undefined) return t('wealth.worth.goneWhy')
      return joined([words.place[place.kind], place.institution === undefined ? undefined : <Bidi>{place.institution}</Bidi>, place.isArchived ? t('wealth.worth.archived') : undefined])
    }
    case 'FUND':
      return joined([
        row.fund.institution === undefined ? undefined : <Bidi>{row.fund.institution}</Bidi>,
        row.fund.asOf === undefined ? t('wealth.worth.noReport') : t('wealth.worth.reportOf', { day: dates.dayMonth(row.fund.asOf) }),
      ])
    case 'DEBT':
      return joined([
        words.debt[row.debt.kind],
        row.debt.isClosed ? t('wealth.worth.closed') : undefined,
        row.figure === undefined ? t('wealth.worth.notOneFigure') : undefined,
      ])
  }
}

/** The newest reading among an account's holdings — the day its statement printed. */
function latestReading(place: PlaceBalance | undefined, worths: ReadonlyMap<string, HoldingWorth>) {
  const days = (place?.holdings ?? []).flatMap((held) => {
    const worth = worths.get(held.holdingId)
    return worth === undefined ? [] : [worth.asOf]
  })
  return parseISODate(days.sort().at(-1) ?? '') ?? undefined
}

/** What is in a row, in a few words. */
function inItOf(row: NetWorthRow, words: WealthWords): string {
  const { t } = words
  switch (row.kind) {
    case 'ACCOUNT': {
      if (row.group === 'HOLDINGS') {
        const count = row.place?.holdings.length ?? 0
        return count === 0 ? t('wealth.worth.nothingYet') : t(countKey('wealth.worth.holdings', count), { count })
      }
      const goals = row.place?.statement?.parts.length ?? 0
      const others = (row.place?.holdings ?? []).filter((held) => held.holding?.accountId !== row.account.id)
      const parts = [
        goals === 0 ? undefined : t(countKey('wealth.worth.goals', goals), { count: goals }),
        others.length === 0 ? undefined : others.length === 1 ? words.holdingKind(others[0]) : t(countKey('wealth.worth.holdings', others.length), { count: others.length }),
        t('wealth.worth.cash'),
      ].filter((one): one is string => one !== undefined)
      return parts.join(t('wealth.common.listSeparator'))
    }
    case 'PLACE': {
      const holdings = row.place.holdings
      if (holdings.length === 0) return t('wealth.worth.nothingYet')
      if (holdings.every((held) => held.holding?.provenance === 'RECORDED')) return t('wealth.worth.byHand')
      return holdings.length === 1 ? words.holdingKind(holdings[0]) : t(countKey('wealth.worth.holdings', holdings.length), { count: holdings.length })
    }
    case 'FUND':
      return row.fundType === undefined ? t('wealth.worth.aFund') : words.fund[row.fundType]
    case 'DEBT':
      return t('wealth.worth.aLoan')
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

/** A new account, in the side panel: a row at once, with nothing in it until a statement is read. */
function AddAccount({ write, onDone }: { readonly write: Write; readonly onDone: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('BANK')
  const kinds: readonly { readonly value: AccountKind; readonly label: string }[] = [
    { value: 'BANK', label: t('wealth.worth.kindBank') },
    { value: 'CASH', label: t('wealth.worth.kindCash') },
    { value: 'HOLDINGS', label: t('wealth.worth.kindHoldings') },
  ]
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
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-secondary">{t('wealth.worth.accountName')}</span>
        <input autoFocus dir="auto" value={name} onChange={(event) => setName(event.target.value)} className={FIELD} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-secondary">{t('wealth.worth.accountKind')}</span>
        <ChoiceField
          text={kinds.find((one) => one.value === kind)?.label ?? ''}
          choices={kinds}
          filter={false}
          readOnly
          aria-label={t('wealth.worth.accountKind')}
          onText={() => undefined}
          onPick={(choice) => setKind(choice.value as AccountKind)}
          className={FIELD}
        />
      </label>
      <p className="m-0 text-caption text-ink-secondary">{t('wealth.worth.accountHow')}</p>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" disabled={name.trim() === ''}>
          {t('wealth.common.add')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('wealth.common.cancel')}
        </Button>
      </div>
    </form>
  )
}

/** Only what can be locked asks until when. */
const LOCKABLE: ReadonlySet<string> = new Set(['DEPOSIT', 'FUND'])

/** A new place — money with no statement of its own — asking the four kinds the goal form's + New… asks (D-363). */
function AddPlace({ write, onDone }: { readonly write: Write; readonly onDone: () => void }) {
  const t = useT()
  const words = useWealthWords()
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
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
    >
      <div role="group" aria-label={t('wealth.worth.placeKind')} className="flex flex-wrap">
        {NEW_PLACE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            onClick={() => set({ kind, ...(LOCKABLE.has(kind) ? {} : { lockedUntil: undefined }) })}
            className={`-ms-px h-8 border px-2.5 text-caption whitespace-nowrap first:ms-0 ${
              draft.kind === kind ? 'relative z-[1] border-accent bg-accent-soft text-ink' : 'border-hairline-strong text-ink-secondary'
            }`}
          >
            {words.newPlace[kind]}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-secondary">{t('wealth.worth.placeName')}</span>
        <input autoFocus dir="auto" value={draft.name} onChange={(event) => set({ name: event.target.value })} className={FIELD} />
      </label>
      {draft.kind !== 'CASH_AT_HOME' && (
        <label className="flex flex-col gap-1">
          <span className="text-caption text-ink-secondary">{t('wealth.worth.placeAt')}</span>
          <input
            dir="auto"
            value={draft.institution ?? ''}
            onChange={(event) => set({ institution: event.target.value === '' ? undefined : event.target.value })}
            className={FIELD}
          />
        </label>
      )}
      {LOCKABLE.has(draft.kind) && (
        <label className="flex flex-col gap-1">
          <span className="text-caption text-ink-secondary">{t('wealth.worth.lockedUntil')}</span>
          <input
            type="date"
            value={draft.lockedUntil === undefined ? '' : toISODate(draft.lockedUntil)}
            onChange={(event) => set({ lockedUntil: parseISODate(event.target.value) ?? undefined })}
            className={FIELD}
          />
        </label>
      )}
      <p className="m-0 text-caption text-ink-secondary">{t('wealth.worth.placeHow')}</p>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" disabled={draft.name.trim() === ''}>
          {t('wealth.common.add')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('wealth.common.cancel')}
        </Button>
      </div>
    </form>
  )
}

function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
