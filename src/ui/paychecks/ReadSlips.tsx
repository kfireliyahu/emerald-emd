import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { formatMoney, type CurrencyCode } from '@/core/money.ts'
import { compareYearMonths, formatYearMonth, toYearMonthString } from '@/core/time.ts'
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
import { Chip } from '@/ui/components/Chip.tsx'
import { IconAction, removableRow } from '@/ui/components/IconAction.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { openDocumentText } from '@/ui/documents/openDocumentText.ts'
import { DeductionTypeSelect } from '@/ui/paychecks/DeductionTypeSelect.tsx'
import { writeSlipBatch } from '@/ui/paychecks/savePaycheck.ts'
import { today } from '@/ui/today.ts'

/**
 * **A stack of payslips, read in one go** — M28 U3, `#/paychecks/read`.
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
        setProgress(`Reading ${each.name} — ${String(index + 1)} of ${String(chosen.length)}…`)
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
    setProgress('Reading…')
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
        ? { problem: slip.outcome.attempts.join(' ') || 'Nothing could read this paycheck.' }
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

  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-6 py-2">
        <span className="font-medium">Read paychecks</span>
        <span className="text-caption text-ink-secondary">
          {context.templates.length === 0
            ? 'No readers yet'
            : `${String(context.templates.length)} ${context.templates.length === 1 ? 'reader' : 'readers'}`}
          {' · '}
          <Link to="/read/readers" className="text-accent underline-offset-2 hover:underline">
            readers
          </Link>
          {' · '}
          {provider === undefined ? 'no model switched on' : `paychecks with no reader go to ${provider.model}`}
        </span>
        {working && (
          <Button
            variant="secondary"
            size="sm"
            icon="stop"
            className="ml-auto"
            onClick={() => {
              stopSlipBatch()
              cancelDerivation()
            }}
          >
            Stop
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <Picker onFiles={add} empty={slips.length === 0} working={working} />
        {/* The one progress indicator, cycling for as long as the batch reads;
            the count stays in words beside it (M28 U4). */}
        {progress !== undefined && (
          <div className="mt-4 flex items-center gap-4 bg-surface p-4" aria-live="polite">
            <Working size={40} />
            <span className="text-ink-secondary">{progress}</span>
          </div>
        )}
        {problem !== undefined && <p className="mt-2 text-caption text-negative">{problem}</p>}

        {planned.length > 0 && (
          <ul className="mt-4 space-y-2">
            {planned.map((each) => (
              <SlipRow
                key={each.slip.file.id}
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
                onRemove={() => remove(each.slip.file.id)}
                taughtBy={readerSource(slips, each.slip)}
              />
            ))}
          </ul>
        )}

        {planned.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
            <Button
              variant="primary"
              icon="write"
              count={accepted.length}
              aria-label={`Write ${accepted.length === 1 ? '1 paycheck' : `${String(accepted.length)} paychecks`}`}
              disabled={accepted.length === 0 || working}
              onClick={write}
            >
              Write
            </Button>
            <span className="text-caption text-ink-secondary">
              as paychecks, in one go or not at all. A reader is kept only from a paycheck that reconciled.
            </span>
          </div>
        )}
      </div>
    </div>
  )
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

function Picker({
  onFiles,
  empty,
  working,
}: {
  onFiles: (files: readonly File[]) => void
  empty: boolean
  working: boolean
}) {
  const [over, setOver] = useState(false)
  return (
    <label
      className={`flex cursor-pointer flex-col items-start gap-1 border border-dashed px-4 py-3 text-caption transition-colors duration-[var(--duration-micro)] ${
        over ? 'border-ink-tertiary bg-surface' : 'border-hairline-strong'
      } ${working ? 'pointer-events-none opacity-60' : ''}`}
      // The window's own drop is the statement mapper (D-227); a drop here is
      // this screen's, and stops before it gets there.
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
        onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <span className="text-ink">{empty ? 'Choose paychecks, or drop them here' : 'Add paychecks'}</span>
      <span className="text-ink-tertiary">
        PDFs, any number — each is read by the reader whose labels it carries and whose figures add up,
        and nothing is written until you press Write. Nothing leaves this machine.
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

function SlipRow({
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
  const figure = (field: string): string | undefined => {
    const amount = plan.review?.figures.find((each) => each.field === field)?.amount
    return amount === undefined ? undefined : formatMoney(amount)
  }
  const gross = figure('grossLine')
  const net = figure('netLine')
  const month = plan.review?.salaryMonth

  const removable = removableRow(onRemove)
  return (
    <li {...removable} className={`border border-hairline-strong bg-elevated px-4 py-3 ${removable.className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          type="checkbox"
          checked={ticked}
          disabled={!writable}
          onChange={(event) => onTick(event.target.checked)}
          aria-label={`Write ${slip.file.name}`}
        />
        <Bidi className="font-medium">{slip.file.name}</Bidi>
        {month !== undefined && <span className="text-ink-secondary">{formatYearMonth(month)}</span>}
        {plan.reconciles && <Chip>reconciled</Chip>}
        {(gross !== undefined || net !== undefined) && (
          <span className="text-caption text-ink-secondary tabular-nums">
            {gross !== undefined && <>gross {gross}</>}
            {gross !== undefined && net !== undefined && ' · '}
            {net !== undefined && <>net {net}</>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onOpenAlone}>
            Open alone
          </Button>
          <IconAction label="Remove" onClick={onRemove}>
            <path d="M6 6l12 12M18 6 6 18" />
          </IconAction>
        </span>
      </div>

      <p className="mt-1 text-caption text-ink-secondary">
        <FitLine slip={slip} taughtBy={taughtBy} />
      </p>
      {slip.file.notice !== undefined && (
        <p className="mt-1 text-caption text-ink-tertiary">{slip.file.notice}</p>
      )}
      {doubt !== undefined && plan.writable && (
        <p className="mt-1 text-caption text-ink-secondary">
          {doubt.sentence}
          {!doubt.same && ' Not ticked; tick it if it is meant.'}
        </p>
      )}
      {plan.problem !== undefined && slip.outcome.kind === 'read' && (
        <p className="mt-1 text-caption text-ink-secondary">{plan.problem}</p>
      )}

      {plan.unnamed.length > 0 && (
        <ul className="mt-2 space-y-1">
          {plan.unnamed.map((row) => (
            <li key={row.field} className="flex flex-wrap items-center gap-3 text-caption">
              <span className="min-w-40">
                {row.labelIsReadable ? <Bidi>{row.label}</Bidi> : <span className="text-ink-tertiary">line {row.line}</span>}
              </span>
              <span className="tabular-nums text-ink-secondary">
                {row.employee !== undefined ? formatMoney(row.employee) : '—'}
              </span>
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

function FitLine({ slip, taughtBy }: { slip: BatchSlip; taughtBy: string | undefined }) {
  const { fit, outcome } = slip
  switch (fit.kind) {
    case 'fits':
      return (
        <>
          Read by your reader <Bidi>{fit.name}</Bidi>, and its figures add up.
        </>
      )
    case 'new':
      return taughtBy === undefined ? (
        <>Worked out from this paycheck by the model, and its figures add up — a new reader, kept when you write.</>
      ) : (
        <>
          Read by the reader worked out from <Bidi>{taughtBy}</Bidi>, and its figures add up.
        </>
      )
    case 'close':
      return (
        <>
          {fit.name === undefined ? (
            'Read, but its figures do not add up.'
          ) : (
            <>
              Your reader <Bidi>{fit.name}</Bidi> reads this paycheck’s labels, but its figures do not add up.
            </>
          )}{' '}
          Open it alone to check the figures or choose another reader.
        </>
      )
    case 'none':
      return (
        <>
          {outcome.attempts.join(' ') || 'Nothing could read this paycheck.'} Open it alone to enter it by
          hand.
        </>
      )
  }
}
