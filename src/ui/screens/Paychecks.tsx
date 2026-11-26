import { useEffect, useMemo, useRef, useState } from 'react'

import { useLocation, useNavigate } from 'react-router-dom'

import { minorUnitDigits, money, type CurrencyCode } from '@/core/money.ts'
import { addMonths, compareYearMonths, toYearMonthString, yearMonthOf, type YearMonth } from '@/core/time.ts'
import { createDeductionType, listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import { deletePaycheck, listPaychecksWithLines, readNoPayMonths } from '@/data/repositories/paycheckRepository.ts'
import { salaryReconciliation, setSalaryDecision, slipBankStatus } from '@/data/repositories/salaryRepository.ts'
import { syncPayroll } from '@/data/repositories/payrollSyncRepository.ts'
import { salaryQuestions } from '@/domain/bankImport.ts'
import type { DeductionKind, DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import type { SalaryBank } from '@/domain/model/statistics.ts'
import { netTrend, reconciliationDelta, slipParts, taxTotal, unlinkedSavingTypes } from '@/domain/paycheck.ts'
import { blankDraft, defaultFlags, draftFrom, type PaycheckDraft } from '@/domain/paycheckEntry.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { hideRead, useDocumentRead } from '@/state/reading.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { drawn, kitMoney, wholeMoney } from '@/ui/charts/kit.ts'
import { MonthFlow } from '@/ui/charts/MonthFlow.tsx'
import { MonthStrip } from '@/ui/charts/MonthStrip.tsx'
import { READ_GLYPH } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState, WaitingList, type Waiting } from '@/ui/components/WaitingList.tsx'
import { arrowStep } from '@/ui/direction.ts'
import { Pager } from '@/ui/home/parts.tsx'
import { signedPercent, taxVersusAverage } from '@/ui/home/months.ts'
import { inOrder, neighbour, shownSlip, slipOfMonth, tableRows, type TableRow } from '@/ui/paychecks/months.ts'
import { PaycheckForm } from '@/ui/paychecks/PaycheckEditor.tsx'
import { PaychecksPanel, type PaycheckPanel } from '@/ui/paychecks/PaychecksPanel.tsx'
import { PayslipIntake } from '@/ui/paychecks/PayslipIntake.tsx'
import { savePaycheckDraft } from '@/ui/paychecks/savePaycheck.ts'
import { today } from '@/ui/today.ts'

/**
 * **Paychecks** — the report (M64 U8, D-620; the direction D-614, the language
 * D-615, where things open D-617). One question: *what did my paycheck pay, and
 * where did it go?*
 *
 * **It answers first, in words**: the month's paycheck said as one sentence,
 * then net pay as the screen's one display figure, and under it the gross
 * divided into taxes, funds, the rest and the net (`MonthFlow`). What waits on
 * the person — a slip that does not add up, a deduction that pays into
 * nothing, the bank disagreeing, a month with no slip — is one strip below the
 * answer. Then net pay by month as the pager, and every paycheck in a table.
 *
 * **Detail opens beside the page** (`PaychecksPanel`), never on a page of its
 * own: each part of the flow its lines (taxes by deduction type, the funds and
 * where they pay into), the net where it went, a row of the table the slip in
 * full. The panel stays open while the months page. **Adding or editing a
 * paycheck by hand is a form in the same panel** (M64 F14, D-630, replacing
 * D-620's page of its own): the few fields first, whether it adds up said as
 * they are typed, the slip's lines only if wanted; saving closes it on the
 * screen, back to the panel it was opened from. A read slip is confirmed in the
 * same fields on the reading flow's page.
 *
 * **Deleting deletes at once** and says so where it happened, with Undo
 * (Ctrl+Z too): the note in the panel, and in the table where the row was.
 */
export function Paychecks() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  const t = useT()
  const dates = useDates()

  const [editing, setEditing] = useState<Editing | undefined>()
  /**
   * The single slip's confirm surface, shown when a read is in the store and
   * asking to be shown (D-171) — the foot bar's *Check it over*, or a slip a
   * batch opened alone (M28 U3).
   */
  const held = useDocumentRead()
  const showReader = held?.kind === 'payslip' && held.open
  const [problem, setProblem] = useState<string | undefined>()
  const landing = useLocation().state as Landing
  /** The slip open: by id, or `month:YYYY-MM` for the newest slip of a month; undefined is the newest. */
  const [wanted, setWanted] = useState<string | undefined>(() =>
    landing?.month === undefined ? undefined : `month:${landing.month}`,
  )
  const [panel, setPanel] = useState<PaycheckPanel | undefined>(() =>
    landing?.panel === undefined ? undefined : { kind: landing.panel },
  )
  /** The slip just deleted, for its Undo. */
  const [deleted, setDeleted] = useState<PaycheckWithLines | undefined>()
  /** Which side the month just came from, for the swap; `turn` replays it. */
  const [swap, setSwap] = useState<{ side: 'l' | 'r'; turn: number }>({ side: 'r', turn: 0 })
  const [arrived] = useState(() => new Set(landing?.arrived ?? []))
  const [over, setOver] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  // The arrow keys page while this screen is the one on show and nothing that
  // takes arrows has focus; Ctrl+Z undoes a delete. Refs, so the listener is set once.
  const pageRef = useRef<((step: -1 | 1) => void) | undefined>(undefined)
  const undoRef = useRef<(() => void) | undefined>(undefined)
  const listShown = !showReader
  useEffect(() => {
    if (!listShown) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"]')) return
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && undoRef.current !== undefined) {
        event.preventDefault()
        undoRef.current()
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
      if (target?.closest('[role="group"], tr, aside')) return
      event.preventDefault()
      pageRef.current?.(arrowStep(event.key) === 1 ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listShown])

  const entries = useMemo(() => (db === undefined ? [] : listPaychecksWithLines(db)), [db, revision])
  const types = useMemo(() => (db === undefined ? [] : listDeductionTypes(db)), [db, revision])
  // Months somebody said had no pay are not missing a slip (M31 U1).
  const noPay = useMemo(() => (db === undefined ? new Set<string>() : readNoPayMonths(db)), [db, revision])
  // **Add by hand, from Home's band** (M28 U5): it arrives asking for the form.
  useEffect(() => {
    if (landing?.add !== true) return
    setEditing({
      kind: 'new',
      draft: blankDraft(today(), entries[0]?.paycheck.gross.currency ?? 'ILS', entries.map((entry) => entry.paycheck.period)),
    })
    navigate('.', { replace: true, state: null })
    // Once, on the render that landed here.
  }, [])
  const salaryGroups = useMemo(() => (db === undefined ? [] : salaryReconciliation(db)), [db, revision])
  const bank = useMemo(() => (db === undefined ? new Map<string, SalaryBank>() : slipBankStatus(db)), [db, revision])

  if (db === undefined) {
    return <Centered>{t('paychecks.month.noDocument')}</Centered>
  }

  const currency: CurrencyCode = entries[0]?.paycheck.gross.currency ?? 'ILS'
  const editingId = editing?.kind === 'edit' ? editing.id : undefined
  const paychecks = entries.map((entry) => entry.paycheck)

  const write = (work: (database: import('sql.js').Database, now: number) => void, keepUndo = false): void => {
    setProblem(undefined)
    // Undo is for the last thing done: any other write after a delete takes it away.
    if (!keepUndo) setDeleted(undefined)
    try {
      mutate((database) => work(database, Date.now()))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }
  const edit = (next: Editing): void => {
    setEditing(next)
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

  /**
   * Reading a payslip is `PayslipIntake` (D-166) — the reader, the confirm
   * surface, the accept rules and the form it fills.
   */
  if (showReader) {
    return <PayslipIntake onLeave={() => hideRead()} onProblem={setProblem} />
  }

  const ordered = inOrder(entries)
  const shown = wanted?.startsWith('month:') === true
    ? (ordered.filter((entry) => toYearMonthString(entry.paycheck.period) === wanted.slice('month:'.length)).at(-1) ?? shownSlip(ordered, undefined))
    : shownSlip(ordered, wanted)
  const run = tableRows(ordered, noPay)
  const missing = run.filter((row) => row.kind === 'missing').length
  // A slip just deleted at either end of the run leaves no gap row; its Undo still sits where it was.
  const rows =
    deleted === undefined || run.some((row) => row.kind === 'missing' && compareYearMonths(row.period, deleted.paycheck.period) === 0)
      ? run
      : [
          ...run.filter((row) => compareYearMonths(periodOf(row), deleted.paycheck.period) >= 0),
          { kind: 'missing' as const, period: deleted.paycheck.period },
          ...run.filter((row) => compareYearMonths(periodOf(row), deleted.paycheck.period) < 0),
        ]

  const go = (target: PaycheckWithLines | undefined): void => {
    if (target === undefined || shown === undefined || target.paycheck.id === shown.paycheck.id) return
    const later = ordered.indexOf(target) > ordered.indexOf(shown)
    setSwap((current) => ({ side: later ? 'r' : 'l', turn: current.turn + 1 }))
    setWanted(target.paycheck.id)
  }
  pageRef.current = (step) => {
    if (shown !== undefined) go(neighbour(ordered, shown.paycheck.id, step))
  }
  const prev = shown === undefined ? undefined : neighbour(ordered, shown.paycheck.id, -1)
  const next = shown === undefined ? undefined : neighbour(ordered, shown.paycheck.id, 1)
  const readSlips = (files?: readonly File[]): void =>
    void navigate('/paychecks/read', files === undefined ? undefined : { state: { files } })
  const addByHand = (): void =>
    edit({ kind: 'new', draft: blankDraft(today(), currency, paychecks.map((paycheck) => paycheck.period)) })

  /** Deletes at once — the paycheck and what it set off — and keeps it for Undo. */
  const remove = (entry: PaycheckWithLines): void => {
    const stay = neighbour(ordered, entry.paycheck.id, -1) ?? neighbour(ordered, entry.paycheck.id, 1)
    write((database, now) => {
      deletePaycheck(database, entry.paycheck.id, now)
      // A deleted slip takes its saving deposits and its debt payments with it.
      syncPayroll(database, now)
    }, true)
    setDeleted(entry)
    // The page and the panel move only when what they show is what went.
    if (entry.paycheck.id === shown?.paycheck.id) {
      setWanted(stay?.paycheck.id)
      if (panel !== undefined && panel.kind !== 'bank') setPanel({ kind: 'deleted', period: entry.paycheck.period })
    }
  }
  const undo = (): void => {
    if (deleted === undefined) return
    const back = deleted
    write((database, now) => savePaycheckDraft(database, draftFrom(back), undefined, now))
    setDeleted(undefined)
    setWanted(`month:${toYearMonthString(back.paycheck.period)}`)
    if (panel?.kind === 'deleted') setPanel({ kind: 'slip' })
  }
  undoRef.current = deleted === undefined ? undefined : undo

  const waiting: Waiting[] = []
  // Every slip that does not add up, not only the one open: the strip does not change as the months page.
  const unexplained = [...ordered].reverse().filter((entry) => reconciliationDelta(entry, types).minor !== 0)
  const first = unexplained[0]
  if (first !== undefined) {
    const delta = reconciliationDelta(first, types)
    const month = dates.monthName(first.paycheck.period)
    waiting.push({
      key: 'unexplained',
      say:
        unexplained.length > 1
          ? t('paychecks.waiting.notAddingUp', { count: unexplained.length })
          : delta.minor > 0
            ? t('paychecks.waiting.unexplained', { amount: kitMoney(delta), month })
            : t('paychecks.waiting.overItemized', { amount: kitMoney({ ...delta, minor: -delta.minor }), month }),
      why: delta.minor > 0 || unexplained.length > 1 ? t('paychecks.waiting.unexplainedWhy') : t('paychecks.waiting.overItemizedWhy'),
      verb: t('paychecks.waiting.edit'),
      onDo: () => edit({ kind: 'edit', id: first.paycheck.id, draft: draftFrom(first) }),
    })
  }
  const unlinked = unlinkedSavingTypes(types, entries)
  if (unlinked.length > 0) {
    waiting.push({
      key: 'unlinked',
      say: t(countKey('paychecks.waiting.unlinked', unlinked.length), { names: unlinked.map((type) => type.name).join(', ') }),
      why: t('paychecks.waiting.unlinkedWhy'),
      verb: t('paychecks.waiting.link'),
      onDo: () => void navigate('/paychecks/deductions', { state: { open: unlinked[0]!.id } }),
    })
  }
  const questions = salaryQuestions(salaryGroups).length
  if (questions > 0) {
    waiting.push({
      key: 'bank',
      say: t(countKey('paychecks.waiting.bank', questions), { count: questions }),
      why: t('paychecks.waiting.bankWhy'),
      verb: t('paychecks.waiting.answer'),
      onDo: () => setPanel({ kind: 'bank' }),
    })
  }
  if (missing > 0) {
    waiting.push({
      key: 'missing',
      say: t(countKey('paychecks.waiting.missing', missing), { count: missing }),
      why: t('paychecks.waiting.missingWhy'),
      verb: t('paychecks.month.read'),
      onDo: () => readSlips(),
    })
  }

  const parts = shown === undefined ? undefined : slipParts(shown, types)
  // Net by month, the window ending at the newest slip unless the one open is further back.
  const points = shown === undefined ? [] : netTrend(paychecks, TREND_MONTHS, trendEnd(shown.paycheck.period, ordered.at(-1)!.paycheck.period))
  const nets = new Map(points.flatMap((point) => (point.net === undefined ? [] : [[toYearMonthString(point.period), point.net] as const])))
  const versus = shown === undefined ? undefined : taxVersusAverage(nets, shown.paycheck.period, currency)

  const page = (
    <div
      className={`fc-view-enter @container flex flex-col gap-8 px-8 pt-6 pb-12 ${over ? 'outline-2 -outline-offset-2 outline-accent outline-dashed' : ''}`}
      // Payslips dropped anywhere on the screen go to the reading screen, before the window's own drop (D-227).
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) readSlips(files)
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="m-0 text-title leading-tight font-medium" aria-live="polite">
            {shown === undefined ? t('paychecks.month.title') : dates.yearMonth(shown.paycheck.period)}
          </h1>
          {shown !== undefined && (
            <Pager
              label={t('paychecks.month.pager')}
              prev={prev === undefined ? undefined : dates.monthShort(prev.paycheck.period)}
              next={next === undefined ? undefined : dates.monthShort(next.paycheck.period)}
              onPrev={() => go(prev)}
              onNext={() => go(next)}
            />
          )}
        </div>
        <Button variant="primary" icon={READ_GLYPH.paychecks} onClick={() => readSlips()} title={t('paychecks.month.readTitle')}>
          {t('paychecks.month.read')}
        </Button>
      </header>

      {problem !== undefined && (
        <p className="fc-pop-enter m-0 flex flex-wrap items-baseline gap-x-3 text-ink-secondary">
          <span aria-hidden className="inline-block size-2 rounded-full bg-negative" />
          <span className="text-ink">{problem}</span>
          <button type="button" className="fc-text-action" onClick={() => setProblem(undefined)}>
            {t('paychecks.month.dismiss')}
          </button>
        </p>
      )}

      {shown === undefined || parts === undefined ? (
        <>
          <EmptyState say={t('paychecks.month.empty')} verb={t('paychecks.month.addByHand')} onDo={addByHand} />
          <WaitingList label={t('paychecks.waiting.title')} items={waiting} />
        </>
      ) : (
        <>
          <div
            key={`${shown.paycheck.id}:${String(swap.turn)}`}
            className={`flex flex-col gap-6 ${swap.turn === 0 ? '' : `fc-swap-${swap.side}`}`}
          >
            {/* The amounts are part of the sentence, not figures of their own: one display figure a screen. */}
            <p className="m-0 max-w-[36ch] text-lede [text-wrap:balance]">
              {t(parts.tax.minor === 0 && parts.saved.minor === 0 ? 'paychecks.month.sentenceShort' : 'paychecks.month.sentence', {
                month: dates.monthName(shown.paycheck.period),
                net: wholeMoney(parts.net),
                gross: wholeMoney(parts.gross),
                tax: wholeMoney(parts.tax),
                saved: wholeMoney(parts.saved),
              })}
            </p>
            <HeadlineFigure
              size="display"
              label={t('paychecks.month.net')}
              value={shown.paycheck.net}
              change={versus === undefined ? t('paychecks.month.netHow') : versus === 0 ? t('paychecks.month.versusSame') : t('paychecks.month.versus', { percent: signedPercent(versus) })}
              empty={t('paychecks.month.flowEmpty')}
              onOpen={() => setPanel({ kind: 'net' })}
            />
            <MonthFlow
              whole={{ label: t('paychecks.parts.gross'), value: parts.gross }}
              parts={[
                { key: 'tax', label: t('paychecks.parts.tax'), value: parts.tax, hue: 'flow-tax' },
                { key: 'saved', label: t('paychecks.parts.saved'), value: parts.saved, hue: 'flow-saved' },
                ...(parts.other.minor === 0 ? [] : [{ key: 'other', label: t('paychecks.parts.other'), value: parts.other }]),
              ]}
              left={t('paychecks.parts.net')}
              empty={t('paychecks.month.flowEmpty')}
              onOpen={(key) => setPanel({ kind: key === 'whole' ? 'slip' : key === 'left' ? 'net' : (key as 'tax' | 'saved' | 'other') })}
            />
          </div>

          <WaitingList label={t('paychecks.waiting.title')} items={waiting} />

          <section className="flex flex-col gap-3" aria-label={t('paychecks.month.strip')}>
            <p className="m-0 text-ink-secondary">{t('paychecks.month.strip')}</p>
            <MonthStrip
              months={points.map((point) => ({
                key: toYearMonthString(point.period),
                label: dates.monthAbbrev(point.period),
                long: dates.yearMonth(point.period),
                value: point.net === undefined ? undefined : drawn(point.net),
                running: compareYearMonths(point.period, yearMonthOf(today())) === 0,
                note: point.net === undefined && !noPay.has(toYearMonthString(point.period)) ? t('paychecks.month.stripMissing') : undefined,
              }))}
              open={points.findIndex((point) => compareYearMonths(point.period, shown.paycheck.period) === 0)}
              label={t('paychecks.month.strip')}
              empty={t('paychecks.month.stripEmpty')}
              format={(value) => wholeMoney(money(Math.round(value * 10 ** minorUnitDigits(currency)), currency))}
              onOpen={(index) => {
                const point = points[index]
                if (point !== undefined) go(slipOfMonth(ordered, point.period))
              }}
            />
          </section>
        </>
      )}

      {rows.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="paychecks-all">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id="paychecks-all" className="m-0 text-heading font-medium">
              {t('paychecks.list.title')}
            </h2>
            <button type="button" className="fc-text-action" onClick={addByHand}>
              {t('paychecks.month.addByHand')}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-hairline text-caption text-ink-secondary uppercase">
                  <th className="h-8 px-3 text-start font-medium">{t('paychecks.list.month')}</th>
                  <th className="h-8 px-3 text-start font-medium">{t('paychecks.list.paid')}</th>
                  <th className="h-8 px-3 text-end font-medium">{t('paychecks.list.gross')}</th>
                  <th className="h-8 px-3 text-end font-medium">{t('paychecks.list.taxes')}</th>
                  <th className="h-8 px-3 text-end font-medium">{t('paychecks.list.net')}</th>
                  <th className="h-8 px-3 text-start font-medium">{t('paychecks.list.check')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) =>
                  row.kind === 'missing' ? (
                    <MissingRow
                      key={`missing-${toYearMonthString(row.period)}`}
                      period={row.period}
                      deleted={deleted !== undefined && compareYearMonths(deleted.paycheck.period, row.period) === 0}
                      onRead={() => readSlips()}
                      onUndo={undo}
                    />
                  ) : (
                    <SlipRow
                      key={row.entry.paycheck.id}
                      entry={row.entry}
                      types={types}
                      on={row.entry.paycheck.id === shown?.paycheck.id}
                      arrived={arrived.has(toYearMonthString(row.entry.paycheck.period))}
                      onOpen={() => {
                        go(row.entry)
                        setPanel({ kind: 'slip' })
                      }}
                      onDelete={() => remove(row.entry)}
                    />
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )

  return (
    <div className="flex h-full">
      <div ref={scroller} className="h-full min-w-0 flex-1 overflow-auto">
        {page}
      </div>
      {editing !== undefined ? (
        // One panel at a time: the form takes the panel's place, and saving or
        // leaving gives it back to what was open before (D-617).
        <SidePanel
          title={editing.kind === 'new' ? t('paychecks.entry.newTitle') : t('paychecks.entry.editTitle')}
          kicker={editing.kind === 'new' ? undefined : dates.yearMonth(editing.draft.period)}
          onClose={() => setEditing(undefined)}
        >
          <PaycheckForm
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
            onSave={(draft: PaycheckDraft) => {
              write((database, now) => savePaycheckDraft(database, draft, editingId, now))
              if (editing.kind === 'new') setWanted(`month:${toYearMonthString(draft.period)}`)
              setEditing(undefined)
            }}
            onCancel={() => setEditing(undefined)}
            onCreateType={createType}
          />
        </SidePanel>
      ) : panel !== undefined && (
        <PaychecksPanel
          panel={panel}
          entry={shown}
          entries={entries}
          types={types}
          bank={shown === undefined ? undefined : bank.get(shown.paycheck.id)}
          groups={salaryGroups}
          currency={currency}
          onEdit={() => {
            if (shown !== undefined) edit({ kind: 'edit', id: shown.paycheck.id, draft: draftFrom(shown) })
          }}
          onDelete={() => {
            if (shown !== undefined) remove(shown)
          }}
          onUndo={undo}
          onDecide={(group, decision) => write((database, now) => setSalaryDecision(database, group, decision, now))}
          onClose={() => setPanel(undefined)}
        />
      )}
    </div>
  )
}

/** How far back net pay by month looks: a year and a little, the shape people know. */
const TREND_MONTHS = 14

/**
 * Where the months end: at the newest slip, unless the month open is further
 * back than the window reaches, and then a little after it, so it is on the strip.
 */
function trendEnd(shown: YearMonth, newest: YearMonth): YearMonth {
  if (compareYearMonths(shown, addMonths(newest, -(TREND_MONTHS - 1))) >= 0) return newest
  const after = addMonths(shown, Math.floor(TREND_MONTHS / 2))
  return compareYearMonths(after, newest) > 0 ? newest : after
}

/**
 * What a visit asked to open on: a batch's newest month and the rows it wrote,
 * Home's *Add a paycheck*, or a month and a panel — Home's Taxes, opening the
 * taxes by deduction type (`{ month, panel: 'tax' }`).
 */
type Landing = {
  readonly month?: string
  readonly arrived?: readonly string[]
  readonly add?: boolean
  readonly panel?: 'slip' | 'tax' | 'saved' | 'other' | 'net' | 'bank'
} | null

/** Up and Down walk the table's rows, as in any list; the row holds the focus. */
function walk(event: React.KeyboardEvent<HTMLTableRowElement>): boolean {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false
  const next = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling
  if (next instanceof HTMLElement) {
    event.preventDefault()
    next.focus()
  }
  return true
}

/** The slip's check: it adds up, or how much it does not. */
function Verdict({ entry, types }: { readonly entry: PaycheckWithLines; readonly types: readonly DeductionType[] }) {
  const t = useT()
  const delta = reconciliationDelta(entry, types)
  // Said in words at the caption step: a problem has its red dot and its amount; a slip that adds up says so quietly.
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 text-caption text-ink-secondary">
      {delta.minor === 0 ? (
        <span>{t('paychecks.list.addsUp')}</span>
      ) : (
        <span className="text-ink">
          <span aria-hidden className="me-1.5 inline-block size-2 rounded-full bg-negative" />
          {t('paychecks.list.notItemized', { amount: kitMoney(delta) })}
        </span>
      )}
      {entry.paycheck.isIrregular && <span>{t('paychecks.list.bonus')}</span>}
    </span>
  )
}

/**
 * A row of the table: the whole row opens the slip in the panel, Enter too;
 * Up and Down walk the rows and Delete deletes it, with Undo where it was. The
 * month cell holds the month and nothing else — a tour finds the row by it.
 */
function SlipRow({
  entry,
  types,
  on,
  arrived,
  onOpen,
  onDelete,
}: {
  readonly entry: PaycheckWithLines
  readonly types: readonly DeductionType[]
  readonly on: boolean
  readonly arrived: boolean
  readonly onOpen: () => void
  readonly onDelete: () => void
}) {
  const dates = useDates()
  const { paycheck } = entry
  return (
    <tr
      // One stop in the tab order for the table — the open row; the arrows walk the rest.
      tabIndex={on ? 0 : -1}
      aria-current={on ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || walk(event)) return
        if (event.key === 'Enter') onOpen()
        if (event.key === 'Delete') {
          event.preventDefault()
          // Focus stays in the list: on the row after, or the one before at the end.
          const after = event.currentTarget.nextElementSibling ?? event.currentTarget.previousElementSibling
          onDelete()
          if (after instanceof HTMLElement) after.focus()
        }
      }}
      className={`h-10 cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-micro)] ${
        on ? 'fc-row-on' : 'hover:bg-surface'
      } ${arrived ? 'fc-arrived' : ''}`}
    >
      <td className="px-3 whitespace-nowrap">{dates.yearMonth(paycheck.period)}</td>
      <td className="px-3 whitespace-nowrap text-ink-secondary tabular-nums">{dates.dayMonth(paycheck.paymentDate)}</td>
      <td className="px-3 text-end text-ink-secondary tabular-nums"><span dir="ltr">{kitMoney(paycheck.gross)}</span></td>
      <td className="px-3 text-end text-ink-secondary tabular-nums"><span dir="ltr">{kitMoney(taxTotal(entry, types))}</span></td>
      <td className="px-3 text-end tabular-nums"><span dir="ltr">{kitMoney(paycheck.net)}</span></td>
      <td className="px-3">
        <Verdict entry={entry} types={types} />
      </td>
    </tr>
  )
}

function periodOf(row: TableRow): YearMonth {
  return row.kind === 'slip' ? row.entry.paycheck.period : row.period
}

/** A month with no slip, inside the run: read it — or, just deleted, undo it here. */
function MissingRow({
  period,
  deleted,
  onRead,
  onUndo,
}: {
  readonly period: YearMonth
  readonly deleted: boolean
  readonly onRead: () => void
  readonly onUndo: () => void
}) {
  const t = useT()
  const dates = useDates()
  return (
    <tr tabIndex={-1} className="h-10 border-b border-hairline text-ink-secondary">
      <td className="px-3 whitespace-nowrap">{dates.yearMonth(period)}</td>
      <td className="px-3" colSpan={4}>
        {deleted ? t('paychecks.list.deleted') : t('paychecks.list.missing')}
      </td>
      <td className="px-3">
        {deleted ? (
          <button type="button" className="fc-text-action" onClick={onUndo} title={t('paychecks.list.undoTitle')}>
            {t('paychecks.list.undo')}
          </button>
        ) : (
          <button type="button" className="fc-text-action" onClick={onRead}>
            {t('paychecks.list.read')}
          </button>
        )}
      </td>
    </tr>
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
