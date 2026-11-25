import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { formatMoney, type CurrencyCode } from '@/core/money.ts'
import { compareYearMonths, toYearMonthString } from '@/core/time.ts'
import { hashBytes } from '@/data/importer/naturalKey.ts'
import {
  batchDoubts,
  namingKey,
  planSlip,
  readSlipBatch,
  type BatchSlip,
  type SlipDoubt,
  type SlipFile,
  type SlipPlan,
} from '@/data/importer/slipBatch.ts'
import { createDeductionType, listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import { readableTemplates } from '@/data/repositories/documentTemplateRepository.ts'
import {
  findPaychecksForPeriod,
  listPaychecksWithLines,
} from '@/data/repositories/paycheckRepository.ts'
import { cancelDerivation, derivePayslipLines } from '@/data/runtime/derive.ts'
import { readChosenProvider } from '@/data/runtime/provider.ts'
import type { DeductionKind } from '@/domain/model/paycheck.ts'
import { isPayslipTemplate } from '@/domain/model/templates.ts'
import { defaultFlags, pickerGroups, recentTypeIds, type TypeGroup } from '@/domain/paycheckEntry.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { finishRead, startRead } from '@/state/reading.ts'
import {
  clearSlipBatch,
  resumeSlipBatch,
  slipBatchNow,
  slipBatchStopping,
  stopSlipBatch,
  updateSlipBatch,
  useSlipBatch,
  type SlipBatchState,
} from '@/state/slipBatch.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { IconAction, removableRow } from '@/ui/components/IconAction.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { EmptyState } from '@/ui/components/WaitingList.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { openDocumentText } from '@/ui/documents/openDocumentText.ts'
import { DeductionTypeSelect } from '@/ui/paychecks/DeductionTypeSelect.tsx'
import { writeSlipBatch } from '@/ui/paychecks/savePaycheck.ts'
import { today } from '@/ui/today.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'

/**
 * **A stack of payslips, read in one go** — M28 U3, `#/paychecks/read`; the
 * report since M64 U7 (D-619): the answer first — how many slips, how many
 * ready to write, how many wait — then the slips as one list whose header row
 * holds Write, the screen's one primary. A drop anywhere on the screen reads
 * here; a slip removed says *Removed · Undo* where it was (and Ctrl+Z); a row
 * the reader cannot name is named in place, on its line (D-617).
 *
 * Bulk reading was expected on the paychecks screen, and existed only on
 * declared formats and only for spreadsheets. This is `ReadFiles`' bargain
 * (D-292) for the document with no header row: every PDF goes through F17's
 * ladder — a stored reader first, the model if one is switched on, nothing
 * otherwise — and each slip is **ticked when its own arithmetic closes**.
 * Nothing is written until Write, and Write writes the ticked slips in one
 * transaction.
 *
 * What fits a slip, with no header to compare, is `slipBatch.ts`'s account: the
 * labels choose the reader and the arithmetic proves it. A row the reader cannot
 * name is asked here, once per reader — naming *income tax* on January's slip
 * names it on every slip that reader read. A slip that needs more than that (a
 * figure typed over, another reader chosen) is **opened alone**, in the single
 * slip's confirm surface, which is unchanged.
 *
 * **The batch is the store's, not this screen's** (M28 F1): leaving the screen
 * mid-batch keeps every slip read and the reading going, the foot bar says so
 * and offers the way back and a Stop, and coming back finds it where it was.
 */
export function ReadSlips() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  const location = useLocation()
  // Payslips dropped on Paychecks arrive here in the navigation's state (M28
  // U4), and are added once this screen can read them.
  const addRef = useRef<((files: readonly File[]) => void) | undefined>(undefined)
  const dropped = (location.state as { files?: readonly File[] } | null)?.files

  const batch = useSlipBatch()
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [removed, setRemoved] = useState<RemovedSlip | undefined>()
  // A batch read against another document is not this one's to show.
  const { slips, named, ticks, progress, problem } = batch.owner === db ? batch : EMPTY_VIEW
  useEffect(() => {
    if (db !== undefined && batch.owner !== undefined && batch.owner !== db) clearSlipBatch()
  }, [batch.owner, db])

  const change = (update: (state: SlipBatchState) => SlipBatchState): void =>
    updateSlipBatch((state) => update(state.owner === db ? state : { ...EMPTY_VIEW, owner: db }))
  const setProblem = (value: string | undefined): void => change((state) => ({ ...state, problem: value }))
  const setTicks = (update: (ticks: ReadonlyMap<string, boolean>) => ReadonlyMap<string, boolean>): void =>
    change((state) => ({ ...state, ticks: update(state.ticks) }))

  const provider = useMemo(() => readChosenProvider(), [])

  const context = useMemo(() => {
    if (db === undefined) return undefined
    const entries = listPaychecksWithLines(db)
    const types = listDeductionTypes(db)
    return {
      types,
      groups: pickerGroups(types, recentTypeIds(entries)),
      templates: readableTemplates(db, 'PAYSLIP').filter(isPayslipTemplate),
      currency: (entries[0]?.paycheck.gross.currency ?? 'ILS') as CurrencyCode,
    }
  }, [db, revision])

  const planned = useMemo(() => {
    if (db === undefined || context === undefined) return []
    const date = today()
    const plans = slips.map((slip) => ({
      slip,
      plan: planSlip(slip, {
        types: context.types,
        currency: context.currency,
        named: named.get(namingKey(slip)) ?? new Map(),
        today: date,
      }),
    }))
    const doubts = batchDoubts(
      plans.map(({ slip, plan }) => ({ id: slip.file.id, hash: slip.file.hash, period: plan.review?.salaryMonth })),
      (period) => findPaychecksForPeriod(db, period).length,
    )
    return plans.map((each) => ({ ...each, doubt: doubts.get(each.slip.file.id) }))
  }, [context, db, named, slips, revision])

  const ready = db !== undefined && context !== undefined
  useEffect(() => {
    if (!ready || dropped === undefined || dropped.length === 0) return
    addRef.current?.(dropped)
    navigate('.', { replace: true, state: null })
  }, [ready, dropped, navigate])

  // Ctrl+Z puts back the slip just removed, as it does everywhere (D-617's addition).
  const undoRef = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (undoRef.current === undefined) return
      event.preventDefault()
      undoRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (db === undefined || context === undefined) return null

  type Planned = (typeof planned)[number]
  const writable = (each: Planned): boolean => each.plan.writable && each.doubt?.same !== true
  const isTicked = (each: Planned): boolean =>
    writable(each) && (ticks.get(each.slip.file.id) ?? (each.plan.reconciles && each.doubt === undefined))
  const accepted = planned.filter(isTicked)
  const working = progress !== undefined

  const add = (chosen: readonly File[]): void => {
    if (chosen.length === 0 || working) return
    change((state) => ({ ...state, problem: undefined }))
    resumeSlipBatch()
    const taught = slips.flatMap((slip) => (slip.taught === undefined ? [] : [slip.taught]))
    // Into the store rather than into this screen, which may be gone by the time
    // a slip lands; and into nothing at all once another document is open.
    const owner = db
    const land = (slip: BatchSlip): void =>
      updateSlipBatch((state) => (state.owner === owner ? { ...state, slips: [...state.slips, slip] } : state))
    const setProgress = (value: string | undefined): void =>
      updateSlipBatch((state) => (state.owner === owner ? { ...state, progress: value } : state))

    const run = async (): Promise<void> => {
      for (const [index, each] of chosen.entries()) {
        if (slipBatchStopping() || slipBatchNow().owner !== owner) break
        setProgress(t('reading.slips.progress', { name: each.name, n: index + 1, total: chosen.length }))
        const bytes = new Uint8Array(await each.arrayBuffer())
        // Hashed before pdf.js sees the bytes: it may take the buffer with it.
        const hash = await hashBytes(bytes.slice())
        const id = `${each.name}-${hash.slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}`
        const opened = await openDocumentText(each)
        const file: SlipFile =
          opened.kind === 'problem'
            ? { id, name: each.name, hash, text: '' }
            : { id, name: each.name, hash, text: opened.text, notice: opened.notice }

        if (opened.kind === 'problem') {
          const unread: BatchSlip = {
            file,
            outcome: { kind: 'unread', signature: '', attempts: [opened.problem] },
            reader: undefined,
            fit: { kind: 'none' },
            taught: undefined,
          }
          land(unread)
          continue
        }

        const [slip] = await readSlipBatch({
          files: [file],
          templates: [...taught, ...context.templates],
          currency: context.currency,
          derive: provider === undefined ? undefined : (text) => derivePayslipLines(provider, text),
        })
        if (slip === undefined) continue
        if (slip.taught !== undefined) taught.unshift(slip.taught)
        land(slip)
      }
    }

    // Working from before the first await, so a second drop cannot start a
    // second run beside this one.
    setProgress(t('reading.slips.starting'))
    void run()
      .catch((error: unknown) =>
        updateSlipBatch((state) =>
          state.owner === owner
            ? { ...state, problem: error instanceof Error ? error.message : String(error) }
            : state,
        ),
      )
      .finally(() => setProgress(undefined))
  }
  addRef.current = add

  const remove = (id: string): void => {
    change((state) => {
      const next = new Map(state.ticks)
      next.delete(id)
      return { ...state, slips: state.slips.filter((slip) => slip.file.id !== id), ticks: next }
    })
  }

  // At once, with *Removed · Undo* in the row's place (D-617's addition).
  const removeOne = (slip: BatchSlip): void => {
    setRemoved({ slip, index: slips.indexOf(slip), tick: ticks.get(slip.file.id) })
    remove(slip.file.id)
  }
  const putBack = (back: RemovedSlip): void => {
    change((state) => {
      if (state.slips.some((slip) => slip.file.id === back.slip.file.id)) return state
      const next = [...state.slips]
      next.splice(Math.min(back.index, next.length), 0, back.slip)
      const marks = new Map(state.ticks)
      if (back.tick !== undefined) marks.set(back.slip.file.id, back.tick)
      return { ...state, slips: next, ticks: marks }
    })
    setRemoved(undefined)
  }

  const nameRow = (key: string, field: string, typeId: string): void => {
    change((state) => {
      const next = new Map(state.named)
      next.set(key, new Map(state.named.get(key) ?? []).set(field, typeId))
      return { ...state, named: next }
    })
  }

  const createType = (name: string, kind: DeductionKind): string | undefined => {
    let created: string | undefined
    try {
      mutate((database) => {
        created = createDeductionType(database, { name, kind, ...defaultFlags(kind) }, Date.now()).id
      })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
    return created
  }

  /** The single slip's confirm surface, with this slip's reading already in it. */
  const openAlone = (slip: BatchSlip): void => {
    const id = startRead({ kind: 'payslip', label: slip.file.name })
    finishRead(id, {
      value: {
        text: slip.file.text,
        notice: slip.file.notice,
        source: undefined,
        attempts: slip.outcome.attempts,
        outcome: slip.outcome.kind === 'read' ? slip.outcome : undefined,
      },
      ...(slip.outcome.kind === 'unread'
        ? { problem: slip.outcome.attempts.join(' ') || t('reading.slips.nothing') }
        : {}),
    })
    remove(slip.file.id)
    navigate('/paychecks')
  }

  const write = (): void => {
    if (accepted.length === 0) return
    setProblem(undefined)
    try {
      mutate((database) => {
        writeSlipBatch(
          database,
          accepted.flatMap(({ slip, plan }) =>
            plan.draft === undefined
              ? []
              : [
                  {
                    slip,
                    draft: plan.draft,
                    reconciles: plan.reconciles,
                    named: named.get(namingKey(slip)) ?? new Map(),
                  },
                ],
          ),
          Date.now(),
        )
      })
      // Written: the batch is done, and Paychecks opens on the newest slip it
      // made, with the rows it wrote flashing once (M28 U4).
      const periods = accepted.flatMap(({ plan }) => (plan.draft === undefined ? [] : [plan.draft.period]))
      const newest = [...periods].sort(compareYearMonths).at(-1)
      change(() => ({ ...EMPTY_VIEW, owner: db }))
      navigate('/paychecks', {
        state: {
          month: newest === undefined ? undefined : toYearMonthString(newest),
          arrived: periods.map(toYearMonthString),
        },
      })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  undoRef.current =
    removed !== undefined && !slips.some((slip) => slip.file.id === removed.slip.file.id) ? () => putBack(removed) : undefined

  const total = planned.length
  const waiting = planned.filter((each) => !isTicked(each)).length
  const slipsWord = t(countKey('reading.slips.count', total), { count: total })
  const readyWord = t(countKey('reading.files.ready', accepted.length), { count: accepted.length })
  const waitingWord = t(countKey('reading.files.waiting', waiting), { count: waiting })
  const answer = working
    ? t('reading.slips.answer.reading', { slips: slipsWord })
    : accepted.length === total
      ? t(countKey('reading.slips.answer.allReady', total), { count: total })
      : accepted.length === 0
        ? t('reading.slips.answer.noneReady', { slips: slipsWord, waiting: waitingWord })
        : t('reading.slips.answer.some', { slips: slipsWord, ready: readyWord, waiting: waitingWord })

  const note = removed !== undefined && !slips.some((slip) => slip.file.id === removed.slip.file.id) ? removed : undefined
  const rows: React.ReactNode[] = planned.map((each) => (
    <SlipRow
      key={each.slip.file.id}
      t={t}
      slip={each.slip}
      plan={each.plan}
      doubt={each.doubt}
      writable={writable(each)}
      ticked={isTicked(each)}
      groups={context.groups}
      named={named.get(namingKey(each.slip)) ?? new Map()}
      onTick={(value) => setTicks((current) => new Map(current).set(each.slip.file.id, value))}
      onName={(field, typeId) => nameRow(namingKey(each.slip), field, typeId)}
      onCreateType={createType}
      onOpenAlone={() => openAlone(each.slip)}
      onRemove={() => removeOne(each.slip)}
      taughtBy={readerSource(slips, each.slip)}
    />
  ))
  if (note !== undefined) {
    rows.splice(
      Math.min(note.index, rows.length),
      0,
      <li key="removed" className="fc-pop-enter flex min-h-14 items-center gap-4 border-b border-hairline text-ink-secondary" aria-live="polite">
        <span className="min-w-0 flex-1 truncate">
          <Phrase text={t('reading.files.removed')} parts={{ file: <Bidi>{note.slip.file.name}</Bidi> }} />
        </span>
        <button type="button" className="fc-text-action" onClick={() => putBack(note)}>
          {t('reading.files.undo')}
        </button>
      </li>,
    )
  }

  return (
    <div
      className={`fc-view-enter h-full overflow-auto ${over ? 'bg-surface' : ''}`}
      // A drop anywhere on this screen is a paycheck to read here; it stops
      // before the window's own drop, which reads statements (D-227).
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        add(Array.from(event.dataTransfer.files))
      }}
    >
      <div className="flex flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h1 className="m-0 text-title leading-tight font-medium">{t('reading.slips.title')}</h1>
          <span className="flex items-center gap-4">
            {context.templates.length > 0 && (
              <Link to="/read/readers" className="fc-text-action">
                {t('reading.files.readers')}
              </Link>
            )}
            {working && (
              <Button
                variant="secondary"
                icon="stop"
                onClick={() => {
                  stopSlipBatch()
                  cancelDerivation()
                }}
              >
                {t('reading.slips.stop')}
              </Button>
            )}
            {/* The next step when nothing is read yet, and only then filled. */}
            <Button variant={total === 0 && !working ? 'primary' : 'secondary'} icon="add" disabled={working} onClick={() => input.current?.click()}>
              {t('reading.slips.add')}
            </Button>
          </span>
          <input
            ref={input}
            type="file"
            multiple
            accept=".pdf,.txt,application/pdf"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (chosen.length > 0) add(chosen)
            }}
          />
        </header>

        {total === 0 && !working && note === undefined ? (
          <EmptyState say={t('reading.slips.empty')} />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="m-0 flex min-h-[2lh] max-w-[34ch] items-center gap-3 text-lede [text-wrap:balance]" aria-live="polite">
                {working && <Working size={24} />}
                <span>{answer}</span>
              </p>
              <span className="text-ink-secondary">
                {progress ?? (provider === undefined ? t('reading.slips.noModel') : t('reading.slips.model', { model: provider.model }))}
              </span>
            </div>

            <section className="flex flex-col" aria-label={t('reading.slips.title')} data-block>
              {/* The list's header row holds what the ticked slips do (D-617's addition). */}
              <div className="flex min-h-10 items-center gap-4 border-b border-hairline-strong">
                <span className="min-w-0 flex-1 text-ink-secondary tabular-nums">
                  {accepted.length === 0
                    ? t('reading.files.noneTicked')
                    : t(countKey('reading.files.ticked', accepted.length), { count: accepted.length })}
                </span>
                <Button
                  variant={accepted.length > 0 && !working ? 'primary' : 'secondary'}
                  size="sm"
                  icon="write"
                  count={accepted.length}
                  aria-label={t(countKey('reading.slips.writeCount', accepted.length), { count: accepted.length })}
                  disabled={accepted.length === 0 || working}
                  onClick={write}
                >
                  {t('reading.slips.write')}
                </Button>
              </div>
              {problem !== undefined && <p className="m-0 border-b border-hairline py-2 text-negative">{problem}</p>}
              <ul className="m-0 list-none p-0">{rows}</ul>
              <span className="pt-3 text-caption text-ink-secondary">{t('reading.slips.foot')}</span>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

/** A slip just taken out of the batch, kept for its Undo. */
interface RemovedSlip {
  readonly slip: BatchSlip
  readonly index: number
  readonly tick: boolean | undefined
}

/** What this screen shows of a batch that is not this document's: nothing. */
const EMPTY_VIEW: Omit<SlipBatchState, 'owner'> = {
  slips: [],
  named: new Map(),
  ticks: new Map(),
  progress: undefined,
  problem: undefined,
}

/** The file that taught a reader this batch learned, for the sentence on the slips it read. */
function readerSource(slips: readonly BatchSlip[], slip: BatchSlip): string | undefined {
  if (slip.fit.kind !== 'new' || slip.taught !== undefined) return undefined
  return slips.find((each) => each.taught?.id === slip.reader)?.file.name
}

/** One slip: ticked when its own arithmetic closes; a row the reader cannot name is named in place. */
function SlipRow({
  t,
  slip,
  plan,
  doubt,
  writable,
  ticked,
  groups,
  named,
  taughtBy,
  onTick,
  onName,
  onCreateType,
  onOpenAlone,
  onRemove,
}: {
  t: Translate
  slip: BatchSlip
  plan: SlipPlan
  doubt: SlipDoubt | undefined
  writable: boolean
  ticked: boolean
  groups: readonly TypeGroup[]
  named: ReadonlyMap<string, string>
  taughtBy: string | undefined
  onTick: (value: boolean) => void
  onName: (field: string, typeId: string) => void
  onCreateType: (name: string, kind: DeductionKind) => string | undefined
  onOpenAlone: () => void
  onRemove: () => void
}) {
  const dates = useDates()
  const figure = (field: string): string | undefined => {
    const amount = plan.review?.figures.find((each) => each.field === field)?.amount
    return amount === undefined ? undefined : formatMoney(amount)
  }
  const gross = figure('grossLine')
  const net = figure('netLine')
  const month = plan.review?.salaryMonth

  const removable = removableRow(onRemove)
  return (
    <li {...removable} className={`flex flex-col gap-1 border-b border-hairline py-3 ${removable.className}`}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
        <input
          type="checkbox"
          checked={ticked}
          disabled={!writable}
          onChange={(event) => onTick(event.target.checked)}
          aria-label={t('reading.slips.writeSlip', { file: slip.file.name })}
        />
        <Bidi className="min-w-0 truncate font-medium">{slip.file.name}</Bidi>
        {month !== undefined && <span className="text-ink-secondary">{dates.yearMonth(month)}</span>}
        {plan.reconciles && (
          <span className="fc-state" data-tone="positive">
            <span className="fc-state-dot" />
            {t('reading.slips.addsUp')}
          </span>
        )}
        {gross !== undefined && <span className="text-ink-secondary tabular-nums">{t('reading.slips.gross', { amount: gross })}</span>}
        {net !== undefined && <span className="text-ink-secondary tabular-nums">{t('reading.slips.net', { amount: net })}</span>}
        <span className="ms-auto flex items-center gap-2">
          <button type="button" className="fc-text-action" onClick={onOpenAlone}>
            {t('reading.slips.openAlone')}
          </button>
          <IconAction label={t('reading.slips.remove', { file: slip.file.name })} onClick={onRemove}>
            <path d="M6 6l12 12M18 6 6 18" />
          </IconAction>
        </span>
      </div>

      <span className="text-caption text-ink-secondary">
        <FitLine t={t} slip={slip} taughtBy={taughtBy} />
      </span>
      {slip.file.notice !== undefined && <span className="text-caption text-ink-secondary">{slip.file.notice}</span>}
      {doubt !== undefined && plan.writable && (
        <span className="text-caption text-ink-secondary">
          {doubt.sentence}
          {!doubt.same && ` ${t('reading.slips.notTicked')}`}
        </span>
      )}
      {plan.problem !== undefined && slip.outcome.kind === 'read' && (
        <span className="text-caption text-ink-secondary">{plan.problem}</span>
      )}

      {plan.unnamed.length > 0 && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
          {plan.unnamed.map((row) => (
            <li key={row.field} className="flex flex-wrap items-center gap-4 text-caption">
              <span className="min-w-40">
                {row.labelIsReadable ? <Bidi>{row.label}</Bidi> : <span className="text-ink-secondary">{t('reading.slips.line', { n: row.line })}</span>}
              </span>
              <span className="text-ink-secondary tabular-nums">{row.employee !== undefined ? formatMoney(row.employee) : '—'}</span>
              <DeductionTypeSelect
                groups={groups}
                value={named.get(row.field) ?? ''}
                onChange={(id) => onName(row.field, id)}
                onCreate={onCreateType}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** How the slip was read, in a sentence: by a reader it fits, a new one, close, or nothing. */
function FitLine({ t, slip, taughtBy }: { t: Translate; slip: BatchSlip; taughtBy: string | undefined }) {
  const { fit, outcome } = slip
  switch (fit.kind) {
    case 'fits':
      return <Phrase text={t('reading.slips.fits')} parts={{ name: <Bidi>{fit.name}</Bidi> }} />
    case 'new':
      return taughtBy === undefined ? (
        <>{t('reading.slips.newByModel')}</>
      ) : (
        <Phrase text={t('reading.slips.newFrom')} parts={{ name: <Bidi>{taughtBy}</Bidi> }} />
      )
    case 'close':
      return fit.name === undefined ? (
        <>{t('reading.slips.closeNoName')}</>
      ) : (
        <Phrase text={t('reading.slips.closeName')} parts={{ name: <Bidi>{fit.name}</Bidi> }} />
      )
    case 'none':
      return (
        <>
          {outcome.attempts.join(' ') || t('reading.slips.nothing')} {t('reading.slips.byHand')}
        </>
      )
  }
}
