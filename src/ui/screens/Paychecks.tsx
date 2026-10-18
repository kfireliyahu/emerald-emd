import { useEffect, useMemo, useRef, useState } from 'react'

import { Link, useLocation, useNavigate } from 'react-router-dom'

import { formatMoney, type CurrencyCode } from '@/core/money.ts'
import {
  addMonths,
  compareYearMonths,
  formatMonthShort,
  formatYearMonth,
  toISODate,
  toYearMonthString,
  yearMonthOf,
  type YearMonth,
  type LocalDate,
} from '@/core/time.ts'
import {
  createDeductionType,
  listDeductionTypes,
} from '@/data/repositories/deductionTypeRepository.ts'
import {
  deletePaycheck,
  listPaychecksWithLines,
  readNoPayMonths,
} from '@/data/repositories/paycheckRepository.ts'
import {
  salaryReconciliation,
  setSalaryDecision,
  slipBankStatus,
} from '@/data/repositories/salaryRepository.ts'
import { syncPayroll } from '@/data/repositories/payrollSyncRepository.ts'
import type { DeductionKind, DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import { salaryQuestions, type SalaryDecision, type SalaryGroup } from '@/domain/bankImport.ts'
import type { SalaryBank } from '@/domain/model/statistics.ts'
import { salaryBankWords } from '@/domain/salaryBank.ts'
import { salaryProblem } from '@/domain/statistics.ts'
import { grossToNetSteps, netTrend, reconciliationDelta, unlinkedSavingTypes } from '@/domain/paycheck.ts'
import {
  blankDraft,
  defaultFlags,
  draftFrom,
  type PaycheckDraft,
} from '@/domain/paycheckEntry.ts'
import { hideRead, useDocumentRead } from '@/state/reading.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Amount } from '@/ui/components/Amount.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { inOrder, neighbour, shownSlip, slipOfMonth, tableRows } from '@/ui/paychecks/months.ts'
import { NetTrend } from '@/ui/paychecks/NetTrend.tsx'
import { WhereItWent } from '@/ui/paychecks/WhereItWent.tsx'
import { PaycheckDetail } from '@/ui/paychecks/PaycheckDetail.tsx'
import { PaycheckEditor } from '@/ui/paychecks/PaycheckEditor.tsx'
import { PayslipIntake } from '@/ui/paychecks/PayslipIntake.tsx'
import { savePaycheckDraft } from '@/ui/paychecks/savePaycheck.ts'
import { today } from '@/ui/today.ts'

/**
 * The paychecks screen, in the frame M28 U4's approved mockup drew: one month
 * open (its slip, and where it went), the net line whose points open a month,
 * and every paycheck below with Read and Add at its head.
 *
 * **Three ways between months, and all three kept**: the arrows in
 * the header (and the arrow keys), a point on the line, a row of the table.
 * They go through `months.ts`, so they agree on what *next* is.
 *
 * The form and the full slip still **replace** the screen: a payslip is a
 * dozen fields being copied off paper, and the waterfall wants the width.
 */
export function Paychecks() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()

  const [editing, setEditing] = useState<Editing | undefined>()
  /**
   * The single slip's confirm surface, shown when a read is in the store and
   * asking to be shown (D-171) — the foot bar's *Check it over*, or a slip a
   * batch opened alone (M28 U3). It is the store's flag rather than this
   * screen's, because neither of those is this screen's child.
   */
  const held = useDocumentRead()
  const showReader = held?.kind === 'payslip' && held.open
  const [viewing, setViewing] = useState<string | undefined>()
  const [confirming, setConfirming] = useState<string | undefined>()
  const [problem, setProblem] = useState<string | undefined>()
  /** The slip open, by id; undefined is the newest (or the one a batch landed on). */
  const [wanted, setWanted] = useState<string | undefined>()
  /** Which side the month just came from, for the swap; `turn` replays it. */
  const [swap, setSwap] = useState<{ side: 'l' | 'r'; turn: number }>({ side: 'r', turn: 0 })
  const landing = useLocation().state as Landing
  // The rows a batch just wrote flash once, on the render that lands here.
  const [arrived] = useState(() => new Set(landing?.arrived ?? []))
  // The arrow keys page while this screen is the one on show and nothing that
  // takes arrows has focus. A ref, so the listener is set once.
  const pageRef = useRef<((step: -1 | 1) => void) | undefined>(undefined)
  const listShown = editing === undefined && viewing === undefined && !showReader
  useEffect(() => {
    if (!listShown) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"]')) return
      event.preventDefault()
      pageRef.current?.(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listShown])

  const entries = useMemo(
    () => (db === undefined ? [] : listPaychecksWithLines(db)),
    [db, revision],
  )
  const types = useMemo(() => (db === undefined ? [] : listDeductionTypes(db)), [db, revision])
  // Months somebody said had no pay are not missing a slip (M31 U1).
  const noPay = useMemo(() => (db === undefined ? new Set<string>() : readNoPayMonths(db)), [db, revision])
  // **Add by hand, from Home's band** (M28 U5): it arrives asking for the form.
  useEffect(() => {
    if (landing?.add !== true) return
    setEditing({ kind: 'new', draft: blankDraft(today(), entries[0]?.paycheck.gross.currency ?? 'ILS') })
    navigate('.', { replace: true, state: null })
    // Once, on the render that landed here.
  }, [])
  // docs/f06's step 12, asked where the payslips are rather than on the import
  // review screen — the other direction, a slip entered after the bank
  // statement, has no review screen open (D-064's argument, which is why the
  // settlement prompt lives on the accounts screen and not there either).
  const salaryGroups = useMemo(
    () => (db === undefined ? [] : salaryReconciliation(db)),
    [db, revision],
  )
  const bank = useMemo(() => (db === undefined ? new Map<string, SalaryBank>() : slipBankStatus(db)), [db, revision])

  if (db === undefined) {
    return <Centered>Open a document, or create one, to record a paycheck.</Centered>
  }

  const currency: CurrencyCode = entries[0]?.paycheck.gross.currency ?? 'ILS'
  const editingId = editing?.kind === 'edit' ? editing.id : undefined

  // The list is newest first, so the first row carries the newest salary month.
  const paychecks = entries.map((entry) => entry.paycheck)
  const newestPeriod = paychecks[0]?.period ?? yearMonthOf(today())

  const write = (work: (database: import('sql.js').Database, now: number) => void): void => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const save = (draft: PaycheckDraft): void => {
    write((database, now) => savePaycheckDraft(database, draft, editingId, now))
    setEditing(undefined)
  }

  /**
   * Add a deduction type from inside the form, and hand back its id so the line
   * being typed can select it. Written immediately rather than on save: a type
   * is a document-level record, and a half-entered slip is not a good enough
   * reason to hold one in memory where a reload loses it.
   */
  const createType = (name: string, kind: DeductionKind): string | undefined => {
    let created: string | undefined
    write((database, now) => {
      created = createDeductionType(database, { name, kind, ...defaultFlags(kind) }, now).id
    })
    return created
  }

  const viewed = entries.find((entry) => entry.paycheck.id === viewing)
  if (viewed !== undefined && editing === undefined) {
    return (
      <PaycheckDetail
        key={viewed.paycheck.id}
        entry={viewed}
        types={types}
        onEdit={() => setEditing({ kind: 'edit', id: viewed.paycheck.id, draft: draftFrom(viewed) })}
        onBack={() => setViewing(undefined)}
      />
    )
  }

  /**
   * Reading a payslip is `PayslipIntake` (D-166) — the reader, the confirm
   * surface, the accept rules and the form it fills — because onboarding reads
   * payslips too, and the accept rules are the part that must not exist twice.
   * What stays here is a slip typed in or corrected by hand.
   */
  if (showReader) {
    return (
      <PayslipIntake
        onLeave={() => {
          // The read keeps running; the foot bar is what says so.
          hideRead()
        }}
        onProblem={setProblem}
      />
    )
  }

  if (editing !== undefined) {
    return (
      <PaycheckEditor
        // Keyed, so opening a different slip starts a new form rather than
        // diffing one payslip's fields into another's.
        key={editing.kind === 'edit' ? editing.id : 'new'}
        initial={editing.draft}
        isNew={editing.kind === 'new'}
        currency={currency}
        types={types}
        // Without the slip being edited: it is the one thing that cannot be a
        // duplicate of itself, and copying a slip into itself is not an offer.
        history={entries.filter((entry) => entry.paycheck.id !== editingId)}
        onSave={save}
        onCancel={() => setEditing(undefined)}
        onCreateType={createType}
      />
    )
  }

  const ordered = inOrder(entries)
  const shown = shownSlip(ordered, wanted ?? landingSlip(ordered, landing))
  const missing = tableRows(ordered, noPay).filter((row) => row.kind === 'missing').length

  const go = (target: PaycheckWithLines | undefined): void => {
    if (target === undefined || shown === undefined || target.paycheck.id === shown.paycheck.id) return
    const later = ordered.indexOf(target) > ordered.indexOf(shown)
    setSwap((current) => ({ side: later ? 'r' : 'l', turn: current.turn + 1 }))
    setConfirming(undefined)
    setWanted(target.paycheck.id)
  }
  pageRef.current = (step) => {
    if (shown !== undefined) go(neighbour(ordered, shown.paycheck.id, step))
  }

  const prev = shown === undefined ? undefined : neighbour(ordered, shown.paycheck.id, -1)
  const next = shown === undefined ? undefined : neighbour(ordered, shown.paycheck.id, 1)
  const readSlips = (files?: readonly File[]): void =>
    void navigate('/paychecks/read', files === undefined ? undefined : { state: { files } })
  const addByHand = (): void => setEditing({ kind: 'new', draft: blankDraft(today(), currency) })

  return (
    <div className="h-full overflow-auto">
      {/* The page takes the width the window gives it, and the month goes two
          columns on the width of *this* box, not the window's: a viewport
          breakpoint counts the rail as room, and a fixed cap left a wide
          window's right half empty (judging U4; M28 F2). */}
      <div className="fc-view-enter @container flex flex-col gap-6 px-8 pt-6 pb-12">
        {/* The page header: where you are, and the way between months. A
            screen's actions sit with what they act on, so Read and Add head the
            list of paychecks below rather than this (judging U3). */}
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-4">
          <div className="flex flex-col gap-1.5">
            <span className="fc-label text-ink-secondary uppercase tabular-nums">
              Paychecks
              {entries.length > 0 && ` · ${entries.length === 1 ? '1 paycheck' : `${String(entries.length)} paychecks`}`}
              {missing > 0 && ` · ${missing === 1 ? '1 month' : `${String(missing)} months`} missing`}
            </span>
            <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">
              {shown === undefined ? 'Paychecks' : formatYearMonth(shown.paycheck.period)}
            </h1>
          </div>
          {shown !== undefined && (
            <nav className="flex items-center gap-1" aria-label="Month">
              <span className="min-w-18 px-1 text-right text-caption text-ink-secondary tabular-nums">
                {prev === undefined ? '' : formatMonthShort(prev.paycheck.period)}
              </span>
              <PageButton label="Previous month" glyph="left" disabled={prev === undefined} onClick={() => go(prev)} />
              <PageButton label="Next month" glyph="right" disabled={next === undefined} onClick={() => go(next)} />
              <span className="min-w-18 px-1 text-caption text-ink-secondary tabular-nums">
                {next === undefined ? 'newest' : formatMonthShort(next.paycheck.period)}
              </span>
            </nav>
          )}
        </header>

        {problem !== undefined && (
          <div className="fc-pop-enter flex items-center gap-4 bg-surface px-4 py-2">
            <span className="text-negative">{problem}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
              Dismiss
            </Button>
          </div>
        )}

        {shown === undefined ? (
          <p className="max-w-prose text-ink-secondary">
            No paychecks yet. Read the paychecks you have, any number at once, or add the last one by hand:
            gross, net, and as much of the middle as you care to type.
          </p>
        ) : (
          <>
            {/* The window ends at the newest slip rather than at this month: a
                salary arrives in arrears, so the month you are standing in is
                normally missing on purpose. It follows a month opened further
                back than it reaches. */}
            <NetTrend
              points={netTrend(paychecks, TREND_MONTHS, trendEnd(shown.paycheck.period, newestPeriod))}
              selected={shown.paycheck.period}
              onPick={(period) => go(slipOfMonth(ordered, period))}
            />

            <div
              key={`${shown.paycheck.id}:${String(swap.turn)}`}
              className={`grid grid-cols-1 gap-8 @[45rem]:grid-cols-2 ${swap.turn === 0 ? '' : `fc-swap-${swap.side}`}`}
            >
              <Slip
                entry={shown}
                bank={bank.get(shown.paycheck.id)}
                types={types}
                confirming={confirming === shown.paycheck.id}
                onEdit={() => setEditing({ kind: 'edit', id: shown.paycheck.id, draft: draftFrom(shown) })}
                onOpen={() => setViewing(shown.paycheck.id)}
                onAskDelete={() => setConfirming(shown.paycheck.id)}
                onKeep={() => setConfirming(undefined)}
                onDelete={() => {
                  setConfirming(undefined)
                  setWanted(undefined)
                  write((database, now) => {
                    deletePaycheck(database, shown.paycheck.id, now)
                    // A deleted slip takes its saving deposits with it: the
                    // payslips no longer claim that money, and a balance still
                    // counting it would be wrong with nothing to explain why.
                    // Same for the debts it was repaying.
                    syncPayroll(database, now)
                  })
                }}
              />
              <WhereItWent period={shown.paycheck.period} />
            </div>
          </>
        )}

        <Unlinked types={unlinkedSavingTypes(types, entries)} />

        <SalaryQueue
          groups={salaryGroups}
          onDecide={(group, decision) => write((database, now) => setSalaryDecision(database, group, decision, now))}
        />

        <section className="mt-2 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 text-heading font-medium">All paychecks</h2>
              {entries.length > 0 && <span className="text-caption text-ink-secondary">A row opens its month above.</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" icon="add" onClick={addByHand}>
                Add by hand
              </Button>
              <Button variant="primary" icon="read" onClick={() => readSlips()}>
                Read paychecks
              </Button>
            </div>
          </div>

          {entries.length > 0 && (
            <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
                  <th className="px-3 py-2 text-left font-medium">Month</th>
                  <th className="px-3 py-2 text-left font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                  <th className="px-3 py-2 text-left font-medium">Itemization</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {tableRows(ordered, noPay).map((row) =>
                  row.kind === 'missing' ? (
                    <tr key={`missing-${toYearMonthString(row.period)}`} className="h-10 border-b border-hairline text-ink-tertiary">
                      <td className="px-3 whitespace-nowrap">{formatYearMonth(row.period)}</td>
                      <td className="px-3" colSpan={4}>
                        No paycheck for this month
                      </td>
                      <td className="px-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => readSlips()}>
                          Read
                        </Button>
                      </td>
                    </tr>
                  ) : (
                    <SlipRow
                      key={row.entry.paycheck.id}
                      entry={row.entry}
                      types={types}
                      on={row.entry.paycheck.id === shown?.paycheck.id}
                      arrived={arrived.has(toYearMonthString(row.entry.paycheck.period))}
                      onOpen={() => {
                        go(row.entry)
                        scrollTop()
                      }}
                      onEdit={() =>
                        setEditing({ kind: 'edit', id: row.entry.paycheck.id, draft: draftFrom(row.entry) })
                      }
                    />
                  ),
                )}
              </tbody>
            </table>
            </div>
          )}

          <Drop onFiles={readSlips} />
        </section>
      </div>
    </div>
  )
}

/** How far back the trend looks: a year and a little, the shape people know. */
const TREND_MONTHS = 14

/**
 * Where the trend ends: at the newest slip, unless the month open is further
 * back than the window reaches, and then a little after it, so it is on the line.
 */
function trendEnd(shown: YearMonth, newest: YearMonth): YearMonth {
  if (compareYearMonths(shown, addMonths(newest, -(TREND_MONTHS - 1))) >= 0) return newest
  const after = addMonths(shown, Math.floor(TREND_MONTHS / 2))
  return compareYearMonths(after, newest) > 0 ? newest : after
}

/** What a batch just written asked to open on: the newest slip of its newest month. */
type Landing = { readonly month?: string; readonly arrived?: readonly string[]; readonly add?: boolean } | null

function landingSlip(ordered: readonly PaycheckWithLines[], landing: Landing): string | undefined {
  if (landing?.month === undefined) return undefined
  return ordered.filter((entry) => toYearMonthString(entry.paycheck.period) === landing.month).at(-1)?.paycheck.id
}

function scrollTop(): void {
  document.querySelector('main')?.scrollTo?.({ top: 0 })
}

function PageButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: 'left' | 'right'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${glyph === 'left' ? '←' : '→'})`}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center border border-transparent text-ink-secondary transition-colors duration-[var(--duration-micro)] hover:border-hairline-strong hover:text-ink disabled:cursor-default disabled:opacity-30 disabled:hover:border-transparent"
    >
      <ActionGlyph name={glyph} />
    </button>
  )
}

/** The slip's verdict, as a chip: it adds up, or how much it does not. */
function Verdict({ entry, types }: { entry: PaycheckWithLines; types: readonly DeductionType[] }) {
  const delta = reconciliationDelta(entry, types)
  return delta.minor === 0 ? (
    <span className="fc-state" data-tone="positive">
      <span className="fc-state-dot" aria-hidden />
      Adds up
    </span>
  ) : (
    <span className="fc-state" data-tone="negative">
      <span className="fc-state-dot" aria-hidden />
      {formatMoney(delta)} unexplained
    </span>
  )
}

/**
 * The slip of the month open: what reached you, how the gross became it, and
 * the actions on it. *Open the slip* is the full waterfall with the employer's
 * side; this is the reading of it.
 */
function Slip({
  entry,
  bank,
  types,
  confirming,
  onEdit,
  onOpen,
  onAskDelete,
  onKeep,
  onDelete,
}: {
  entry: PaycheckWithLines
  bank: SalaryBank | undefined
  types: readonly DeductionType[]
  confirming: boolean
  onEdit: () => void
  onOpen: () => void
  onAskDelete: () => void
  onKeep: () => void
  onDelete: () => void
}) {
  const { paycheck } = entry
  const byId = new Map(types.map((type) => [type.id, type]))
  const steps = grossToNetSteps(entry, types).filter((step) => step.kind === 'DEDUCTION' || step.kind === 'UNEXPLAINED')
  const total = Math.max(1, paycheck.gross.minor)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="fc-label text-ink-secondary uppercase">The paycheck</span>
        <Verdict entry={entry} types={types} />
      </div>
      <div className="text-[32px] leading-[1.1] font-medium tracking-[-0.02em] tabular-nums">
        {formatMoney(paycheck.net)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-ink-secondary">
        <span>
          net, paid <span className="font-mono text-caption">{toISODate(paycheck.paymentDate)}</span>
          {paycheck.employerName !== undefined && (
            <>
              {' '}
              by <Bidi>{paycheck.employerName}</Bidi>
            </>
          )}
        </span>
        {paycheck.isIrregular && <span className="fc-state">Bonus</span>}
      </div>
      <BankLine bank={bank} />
      {/* The gross, as what reached you and what was taken: net in ink, each
          deduction a step lighter. A picture of the lines below, not a chart. */}
      <div className="flex h-2 gap-0.5" aria-hidden>
        <span className="h-full bg-ink" style={{ flex: Math.max(0, paycheck.net.minor) / total }} />
        {steps.map((step, index) => (
          <span
            key={step.lineId ?? `step-${String(index)}`}
            className="h-full"
            style={{
              flex: step.amount.minor / total,
              background: `color-mix(in srgb, var(--color-ink-secondary) ${String(Math.max(20, 70 - index * 8))}%, transparent)`,
            }}
          />
        ))}
      </div>
      <div className="flex flex-col">
        <Line label="Gross" amount={formatMoney(paycheck.gross)} />
        {steps.map((step, index) => {
          const type = step.deductionTypeId === undefined ? undefined : byId.get(step.deductionTypeId)
          return (
            <Line
              key={step.lineId ?? `step-${String(index)}`}
              quiet
              label={
                step.kind === 'UNEXPLAINED' ? (
                  <span className="text-negative">Unexplained</span>
                ) : (
                  <>
                    {type?.name ?? 'A type no longer in the document'}
                    {type?.hebrewName !== undefined && type.hebrewName !== type.name && (
                      <Bidi className="text-caption text-ink-tertiary">{type.hebrewName}</Bidi>
                    )}
                  </>
                )
              }
              amount={`${step.isAddBack ? '+' : '−'}${formatMoney(step.amount)}`}
            />
          )
        })}
        <div className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-ink font-medium">
          <span>Net</span>
          <span className="text-right tabular-nums">{formatMoney(paycheck.net)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {confirming ? (
          <>
            <span className="text-caption text-ink-secondary">Delete {formatYearMonth(paycheck.period)}?</span>
            <Button variant="secondary" size="sm" icon="trash" onClick={onDelete}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={onKeep}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" icon="edit" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onOpen}>
              Open the paycheck
            </Button>
            <span className="flex-1" />
            <IconAction label={`Delete ${formatYearMonth(paycheck.period)}`} tone="negative" onClick={onAskDelete}>
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
            </IconAction>
          </>
        )}
      </div>
    </div>
  )
}

function Line({ label, amount, quiet = false }: { label: React.ReactNode; amount: string; quiet?: boolean }) {
  return (
    <div className="grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline">
      <span className="flex min-w-0 items-center gap-2">{label}</span>
      <span className={`text-right tabular-nums ${quiet ? 'text-ink-secondary' : ''}`}>{amount}</span>
    </div>
  )
}

/** A row of the table: the month is the whole row, and Enter opens it too. */
function SlipRow({
  entry,
  types,
  on,
  arrived,
  onOpen,
  onEdit,
}: {
  entry: PaycheckWithLines
  types: readonly DeductionType[]
  on: boolean
  arrived: boolean
  onOpen: () => void
  onEdit: () => void
}) {
  const { paycheck } = entry
  return (
    <tr
      tabIndex={0}
      aria-current={on ? 'true' : undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button') === null) onOpen()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) onOpen()
      }}
      className={`h-10 cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-micro)] ${
        on ? 'fc-row-on' : 'hover:bg-surface'
      } ${arrived ? 'fc-arrived' : ''}`}
    >
      <td className="px-3 whitespace-nowrap tabular-nums">
        {formatYearMonth(paycheck.period)}
        {paycheck.isIrregular && <span className="fc-state ml-2">Bonus</span>}
      </td>
      <td className="px-3 font-mono text-caption whitespace-nowrap text-ink-secondary">{toISODate(paycheck.paymentDate)}</td>
      <td className="px-3 text-right text-ink-secondary">
        <Amount value={paycheck.gross} />
      </td>
      <td className="px-3 text-right">
        <Amount value={paycheck.net} />
      </td>
      <td className="px-3">
        <Verdict entry={entry} types={types} />
      </td>
      <td className="px-3 text-right">
        <IconAction label={`Edit ${formatYearMonth(paycheck.period)}`} onClick={onEdit}>
          <path d="M4 20l1.5-5L15 5.5l3.5 3.5L9 18.5z" />
        </IconAction>
      </td>
    </tr>
  )
}

/**
 * Where payslips are dropped, any number: they go to the reading screen, which
 * reads each by the reader whose labels it carries. Stops the drop before the
 * window's own, which is the statement mapper (D-227).
 */
function Drop({ onFiles }: { onFiles: (files: readonly File[]) => void }) {
  const [over, setOver] = useState(false)
  return (
    <label
      className={`flex cursor-pointer items-center gap-4 border border-dashed p-4 text-ink-secondary transition-colors duration-[var(--duration-micro)] ${
        over ? 'border-accent bg-accent-soft' : 'border-hairline-strong hover:border-accent hover:bg-accent-soft'
      }`}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) onFiles(files)
      }}
    >
      <ActionGlyph name="read" size={20} />
      <span>
        Drop paychecks here, any number. Each is read by the reader whose labels it carries, and nothing is
        written until you press Write.
      </span>
      <input
        type="file"
        multiple
        accept=".pdf,.txt,application/pdf"
        className="sr-only"
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (chosen.length > 0) onFiles(chosen)
        }}
      />
    </label>
  )
}

type Editing =
  | { readonly kind: 'new'; readonly draft: PaycheckDraft }
  | { readonly kind: 'edit'; readonly id: string; readonly draft: PaycheckDraft }

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}

/**
 * What landed in the bank against what the payslips say — docs/f06's step 12,
 * as a confirmation queue.
 *
 * **The paycheck is authoritative and the deposit is the duplicate**, so what an
 * answer excludes is the bank row. Saying it the other way round would mean
 * throwing away the itemization the user typed in favour of a single figure the
 * bank happened to print.
 *
 * **A disagreement stays on the list after it is answered.** "Do not count this
 * twice" and "these two figures differ" are two questions, and settling the
 * first does not settle the second — docs/f06 says a mismatch usually means the
 * payslip was entered wrong, which is a thing to go and fix rather than a thing
 * to dismiss.
 *
 * Silent when there is nothing to ask, which for most documents is most of the
 * time: no bank statement imported, or every month already answered.
 */
function SalaryQueue({
  groups,
  onDecide,
}: {
  groups: readonly SalaryGroup[]
  onDecide: (group: SalaryGroup, decision: SalaryDecision) => void
}) {
  const questions = salaryQuestions(groups)
  if (questions.length === 0) return null

  const words = { money: formatMoney, date: (day: LocalDate) => toISODate(day) }

  return (
    <section className="border-t border-hairline pt-4">
      <h2 className="fc-label text-ink-secondary uppercase">Paycheck against the bank</h2>
      <p className="mt-1 mb-3 max-w-3xl text-caption text-ink-tertiary">
        The paycheck is the figure, and a deposit that paid it is never counted on top, whichever month
        it landed in. A deposit that agrees needs nothing from you. These do not.
      </p>

      <div className="flex max-w-3xl flex-col gap-2">
        {questions.map((group) => (
          <div
            key={toYearMonthString(group.period)}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline pb-2"
          >
            <span className="w-20 shrink-0 tabular-nums">{formatMonthShort(group.period)}</span>
            {group.verdict === 'NO_PAYCHECK' && <span className="tabular-nums">{formatMoney(group.total)} landed</span>}

            <span className="flex-1 text-caption text-negative">
              {group.verdict === 'DIFFERS' &&
                group.difference !== undefined &&
                group.paycheckPeriod !== undefined &&
                salaryBankWords(
                  {
                    kind: 'DIFFERS',
                    landed: group.total,
                    landedOn: group.rows[group.rows.length - 1]?.date ?? group.rows[0]!.date,
                    count: group.rows.length,
                    difference: group.difference,
                  },
                  words,
                ) + ` · the ${formatYearMonth(group.paycheckPeriod)} paycheck says ${group.net === undefined ? '' : formatMoney(group.net)}`}
              {group.verdict === 'NO_PAYCHECK' && salaryBankWords({ kind: 'NO_SLIP' }, words)}
              {group.rows.length > 1 && <> · {group.rows.length} deposits</>}
            </span>

            {group.verdict === 'DIFFERS' && (
              <span className="flex items-center gap-2 text-caption text-ink-tertiary">
                {group.decision === 'COUNTED' ? 'counted on top of the paycheck' : 'not counted on top of the paycheck'}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDecide(group, group.decision === 'COUNTED' ? 'PENDING' : 'COUNTED')}
                >
                  {group.decision === 'COUNTED' ? 'Change' : 'It is extra, count it'}
                </Button>
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/** What the bank says about the slip open: quiet when it agrees, red when it does not. */
function BankLine({ bank }: { bank: SalaryBank | undefined }) {
  if (bank === undefined) return null
  const words = { money: formatMoney, date: (day: LocalDate) => toISODate(day) }
  const tone = salaryProblem(bank) ? 'text-negative' : bank.kind === 'UNCHECKED' ? 'text-ink-tertiary' : 'text-ink-secondary'
  return <div className={`text-caption ${tone}`}>{salaryBankWords(bank, words)}</div>
}

/**
 * The pension line that pays into nothing — said here, because here is where
 * the slips are (D-170).
 *
 * **A screen that has to be discovered is a screen that has to announce
 * itself.** *Deduction types* is a tab of this screen now rather than the sixth
 * child of Settings, and the tab alone answers "I would never have gone there";
 * this answers the other half, which is *why you would want to*. A saving line
 * with no fund behind it makes every fund surface downstream say "no payslips
 * cover this" — a sentence that reads as a missing document and is a missing
 * link.
 *
 * Nothing when there is nothing to say, which on a well-linked document is
 * always. It is a finding, not furniture.
 */
function Unlinked({ types }: { types: readonly DeductionType[] }) {
  if (types.length === 0) return null

  return (
    <div className="bg-surface p-4">
      <p className="max-w-prose text-ink">
        {types.length === 1 ? 'One deduction on your paychecks' : `${String(types.length)} deductions on your paychecks`}{' '}
        — {types.map((type) => type.name).join(', ')} —{' '}
        {types.length === 1 ? 'does' : 'do'} not say what {types.length === 1 ? 'it' : 'they'} pay
        into, so nothing reaches a fund from {types.length === 1 ? 'it' : 'them'}: the deposit
        check has no paychecks to compare against and says so.{' '}
        <Link
          to="/paychecks/deductions"
          className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover"
        >
          Say which fund on Deduction types
        </Link>
        .
      </p>
    </div>
  )
}
