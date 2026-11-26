import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { formatMoney } from '@/core/money.ts'
import { LEFT_OUT } from '@/data/importer/apply.ts'
import { listFunds } from '@/data/repositories/fundRepository.ts'
import type { FundAccount } from '@/domain/model/funds.ts'
import {
  cardsOf,
  judgeBatch,
  keepApart,
  monthsOf,
  pointAt,
  writeSheets,
  type SheetVerdict,
  type StatementSheet,
} from '@/data/importer/statementBatch.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import {
  batchFor,
  sheetsOf,
  updateStatementBatch,
  useStatementBatch,
  withoutFiles,
  writesSheet,
  type BatchFile,
} from '@/state/statementBatch.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph, READ_GLYPH } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'
import { IconAction, removableRow } from '@/ui/components/IconAction.tsx'
import { EmptyState } from '@/ui/components/WaitingList.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { useFilePicker, useReadFiles } from '@/ui/home/parts.tsx'
import { cardsLine } from '@/ui/import/cardsLine.tsx'
import { GapPanel } from '@/ui/import/GapPanel.tsx'
import { countKey } from '@/i18n/count.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'

/**
 * **Read files** — `#/read`, M28 U5; the report since M64 U7 (D-619). One
 * question: *how do I get my statements and payslips in?* Drop a file, see
 * what it was read as, fix what looks wrong, and be done.
 *
 * **It answers first, in words**: what the batch came to — how many files,
 * how many are ready to write and how many wait for you — then the files as
 * one list, in the order they were dropped. Each statement is read by the
 * reader it fits and **ticked when it adds up**; a row already in the document
 * is left out on its own, so there is nothing to accept. The ticked files'
 * action, Write, is in the list's own header row, as a mail client keeps a
 * selection's actions (D-617's addition), and it is the screen's one primary.
 *
 * **Where each thing opens (D-617)**: a file that does not add up opens its gap
 * and the rows that cause it **beside the list** (`GapPanel`; it was a page,
 * `#/read/<id>`, which now opens the same panel); a new layout goes to the
 * column mapper, the one job here that takes a page of its own, with one way
 * back; which account a file goes into, and which fund a PDF reports on, are
 * answered on the file's own line. Removing a file is at once, with
 * *Removed · Undo* where it was (and Ctrl+Z) — never a confirmation.
 *
 * Write writes every ticked file in one go and lands on the month, with what
 * was written in one line.
 */
export function ReadStatements() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  const batch = batchFor(useStatementBatch(), db)
  const [problem, setProblem] = useState<string | undefined>()
  const [writing, setWriting] = useState(false)
  // `#/read/<id>` was the gap's own page; the address still opens it, beside the list.
  const { id: opened } = useParams<{ id?: string }>()
  const [panel, setPanel] = useState<string | undefined>(opened)
  const [removed, setRemoved] = useState<Removed | undefined>()
  const readFiles = useReadFiles()
  const picker = useFilePicker(readFiles)
  const t = useT()

  // In the batch's order, each sheet against the ones before it (M28 F15): an
  // account a file above is about to make is where a file below can land, and
  // its rows are rows a file below already has.
  const verdicts = useMemo((): ReadonlyMap<string, SheetVerdict> => {
    if (db === undefined) return new Map()
    return judgeBatch(db, sheetsOf(batch), (id, verdict) => writesSheet(batch, id, verdict)).verdicts
  }, [db, revision, batch.files, batch.ticks, batch.forced])

  // A file holding two cards or more says so on its first row, before anything
  // is written: `2 cards: ••1234 · 41 rows, ••5678 · 17 rows` (M59 U2, D-578).
  const cardLines = useMemo((): ReadonlyMap<string, React.ReactNode> => {
    const byFile = new Map<string, { first: string; sheets: StatementSheet[] }>()
    for (const file of batch.files) {
      if (file.kind !== 'sheet') continue
      const group = byFile.get(file.sheet.fileHash)
      if (group === undefined) byFile.set(file.sheet.fileHash, { first: file.id, sheets: [file.sheet] })
      else group.sheets.push(file.sheet)
    }
    const lines = new Map<string, React.ReactNode>()
    for (const { first, sheets } of byFile.values()) {
      const line = cardsLine(t, cardsOf(sheets))
      if (line !== undefined) lines.set(first, line)
    }
    return lines
  }, [batch.files, t])

  // Ctrl+Z puts back the file just removed, as it does everywhere (D-617's addition).
  useEffect(() => {
    if (removed === undefined || db === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      event.preventDefault()
      putBack(db, removed)
      setRemoved(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removed, db])

  if (db === undefined) return null

  const ticked = (file: BatchFile): boolean => file.kind === 'sheet' && writesSheet(batch, file.id, verdicts.get(file.id))
  const reading = batch.files.filter((file) => file.kind === 'reading').length
  const total = batch.files.length
  const toWrite = batch.files.filter(ticked)
  const waiting = batch.files.filter((file) => waits(file, verdicts.get(file.id), ticked(file))).length
  const payslips = batch.files.flatMap((file) => (file.kind === 'payslip' ? [file] : []))
  const funds = listFunds(db)

  // Unticking a file written anyway takes back the *Write anyway* too.
  const setTick = (id: string, on: boolean): void =>
    updateStatementBatch(db, (state) => {
      const forced = new Set(state.forced)
      if (!on) forced.delete(id)
      return { ...state, ticks: new Map(state.ticks).set(id, on), forced }
    })
  const reshape = (id: string, change: (sheet: StatementSheet) => StatementSheet): void =>
    updateStatementBatch(db, (state) => ({
      ...state,
      files: state.files.map((file) => (file.id === id && file.kind === 'sheet' ? { ...file, sheet: change(file.sheet) } : file)),
    }))
  const remove = (ids: ReadonlySet<string>): void =>
    updateStatementBatch(db, (state) => withoutFiles(state, ids))
  const closePanel = (): void => {
    setPanel(undefined)
    if (opened !== undefined) navigate('/read', { replace: true })
  }
  // At once, with *Removed · Undo* in the row's place, so nothing below it moves (D-617's addition).
  const removeOne = (file: BatchFile): void => {
    setRemoved({
      file,
      index: batch.files.indexOf(file),
      tick: batch.ticks.get(file.id),
      forced: batch.forced.has(file.id),
    })
    if (panel === file.id) closePanel()
    remove(new Set([file.id]))
  }

  const write = (): void => {
    const sheets = toWrite.flatMap((file) => (file.kind === 'sheet' ? [file] : []))
    if (sheets.length === 0) return
    setProblem(undefined)
    setWriting(true)
    try {
      let imported = 0
      const months = new Set<string>()
      mutate((database) => {
        const written = writeSheets(
          database,
          sheets.map((file) => ({ sheet: file.sheet, force: batch.forced.has(file.id) })),
          Date.now(),
        )
        for (const { sheet, result } of written) {
          imported += result.imported
          if (result.imported > 0) for (const month of monthsOf(verdicts.get(sheetId(sheets, sheet))?.rows ?? [])) months.add(month)
        }
      })
      const done = new Set(
        batch.files
          .filter((file) => ticked(file) || (file.kind === 'sheet' && verdicts.get(file.id)?.state === 'same'))
          .map((file) => file.id),
      )
      remove(done)
      const arrived = [...months].sort()
      navigate('/', {
        state: {
          month: arrived.at(-1),
          arrived,
          wrote: t('reading.files.wrote', {
            transactions: t(countKey('reading.files.transactions', imported), { count: imported }),
            files: t(countKey('reading.files.files', sheets.length), { count: sheets.length }),
          }),
        },
      })
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWriting(false)
    }
  }

  const readPayslips = (): void => {
    remove(new Set(payslips.map((file) => file.id)))
    navigate('/paychecks/read', { state: { files: payslips.map((file) => file.file) } })
  }
  // A fund report is read into one fund, so the row names it and the fund's own reader opens on it.
  const readReport = (id: string, file: File, fundId: string): void => {
    remove(new Set([id]))
    navigate(`/wealth/funds/${encodeURIComponent(fundId)}`, { state: { files: [file] } })
  }

  const files = t(countKey('reading.files.files', total), { count: total })
  const ready = t(countKey('reading.files.ready', toWrite.length), { count: toWrite.length })
  const waitingWords = t(countKey('reading.files.waiting', waiting), { count: waiting })
  const answer =
    reading > 0
      ? t('reading.files.answer.reading', { files })
      : toWrite.length === total
        ? t(countKey('reading.files.answer.allReady', total), { count: total })
        : toWrite.length === 0 && waiting === 0
          ? t('reading.files.answer.nothingNew', { files })
          : toWrite.length === 0
            ? t('reading.files.answer.noneReady', { files, waiting: waitingWords })
            : waiting === 0
              ? t('reading.files.answer.readyOnly', { files, ready })
              : t('reading.files.answer.some', { files, ready, waiting: waitingWords })

  const note = removed !== undefined && !batch.files.some((file) => file.id === removed.file.id) ? removed : undefined
  const rows: React.ReactNode[] = batch.files.map((file) => (
    <FileRow
      key={file.id}
      file={file}
      verdict={verdicts.get(file.id)}
      cards={cardLines.get(file.id)}
      ticked={ticked(file)}
      open={panel === file.id}
      onTick={(on) => setTick(file.id, on)}
      onLook={() => setPanel(file.id)}
      onMap={() => file.kind === 'new-layout' && updateStatementBatch(db, (state) => ({ ...state, mapping: file }))}
      onPayslips={readPayslips}
      t={t}
      funds={funds}
      onReport={(fundId) => file.kind === 'payslip' && readReport(file.id, file.file, fundId)}
      onRemove={() => removeOne(file)}
      onInto={() => {
        const held = verdicts.get(file.id)?.elsewhere
        if (held !== undefined) reshape(file.id, (sheet) => pointAt(sheet, held))
      }}
      onApart={() => reshape(file.id, keepApart)}
    />
  ))
  if (note !== undefined) {
    rows.splice(
      Math.min(note.index, rows.length),
      0,
      <div key="removed" className="fc-pop-enter flex min-h-14 items-center gap-4 border-b border-hairline px-1 text-ink-secondary" aria-live="polite">
        <span className="min-w-0 flex-1 truncate">
          <Phrase text={t('reading.files.removed')} parts={{ file: <Bidi>{note.file.fileName}</Bidi> }} />
        </span>
        <button
          type="button"
          className="fc-text-action"
          onClick={() => {
            putBack(db, note)
            setRemoved(undefined)
          }}
        >
          {t('reading.files.undo')}
        </button>
      </div>,
    )
  }

  const page = (
    <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="m-0 text-title leading-tight font-medium">{t('reading.files.title')}</h1>
        <span className="flex items-center gap-4">
          <Link to="/read/readers" className="fc-text-action">
            {t('reading.files.readers')}
          </Link>
          {/* The next step when nothing is read yet, and only then filled. */}
          <Button variant={total === 0 ? 'primary' : 'secondary'} icon="add" onClick={picker.open}>
            {t('reading.files.addFiles')}
          </Button>
        </span>
        {picker.input}
      </header>

      {total === 0 && note === undefined ? (
        // *An empty state is one sentence*; its action is the header's Add files.
        <EmptyState say={t('reading.files.empty')} />
      ) : (
        <>
          {total > 0 && (
            // Two lines high whatever it says, so a tick never moves the list under the pointer.
            <p className="m-0 flex min-h-[2lh] max-w-[34ch] items-center gap-3 text-lede [text-wrap:balance]" aria-live="polite">
              {reading > 0 && <Working size={24} />}
              <span>{answer}</span>
            </p>
          )}

          <section className="flex flex-col" aria-label={t('reading.files.title')} data-block>
            {/* The list's header row holds what the ticked files do (D-617's addition). */}
            <div className="flex min-h-10 items-center gap-4 border-b border-hairline-strong px-1">
              <span className="min-w-0 flex-1 text-ink-secondary tabular-nums">
                {toWrite.length === 0
                  ? t('reading.files.noneTicked')
                  : t(countKey('reading.files.ticked', toWrite.length), { count: toWrite.length })}
              </span>
              {/* Filled only when it writes something (*One primary action per screen*, M54 F13). */}
              <Button
                variant={reading === 0 && toWrite.length > 0 ? 'primary' : 'secondary'}
                size="sm"
                icon="write"
                count={toWrite.length}
                busy={writing ? t('reading.files.writing') : undefined}
                disabled={reading > 0 || toWrite.length === 0}
                onClick={write}
                data-tour="write-files"
              >
                {t('reading.files.write')}
              </Button>
            </div>
            {problem !== undefined && (
              <div className="fc-pop-enter flex items-center gap-4 border-b border-hairline py-2">
                <span className="text-negative">{problem}</span>
                <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setProblem(undefined)}>
                  {t('reading.files.dismiss')}
                </Button>
              </div>
            )}
            {rows}
            <span className="pt-3 text-caption text-ink-secondary">{t('reading.files.foot')}</span>
          </section>
        </>
      )}
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>
      {panel !== undefined && (
        <GapPanel
          id={panel}
          onClose={closePanel}
          onLeaveOut={() => {
            const file = batch.files.find((each) => each.id === panel)
            if (file !== undefined) removeOne(file)
          }}
        />
      )}
    </div>
  )
}

/** A file just taken out of the batch, kept for its Undo: where it was, and the say it had. */
interface Removed {
  readonly file: BatchFile
  readonly index: number
  readonly tick: boolean | undefined
  readonly forced: boolean
}

/** Puts a removed file back where it was, with its tick and its *Write anyway*. */
function putBack(db: Parameters<typeof updateStatementBatch>[0], removed: Removed): void {
  updateStatementBatch(db, (state) => {
    if (state.files.some((file) => file.id === removed.file.id)) return state
    const files = [...state.files]
    files.splice(Math.min(removed.index, files.length), 0, removed.file)
    const ticks = new Map(state.ticks)
    if (removed.tick !== undefined) ticks.set(removed.file.id, removed.tick)
    const forced = new Set(state.forced)
    if (removed.forced) forced.add(removed.file.id)
    return { ...state, files, ticks, forced }
  })
}

/** Whether a file waits on the person: a gap, a new layout, a PDF to place, an account to choose, or a failure. */
function waits(file: BatchFile, verdict: SheetVerdict | undefined, ticked: boolean): boolean {
  if (file.kind === 'new-layout' || file.kind === 'payslip' || file.kind === 'failed') return true
  if (file.kind !== 'sheet' || verdict === undefined) return false
  return verdict.state === 'elsewhere' || (verdict.state === 'gap' && !ticked)
}

function sheetId(files: readonly { id: string; sheet: StatementSheet }[], sheet: StatementSheet): string {
  return files.find((file) => file.sheet === sheet)?.id ?? sheet.id
}

/** One file of the batch: what it is, what it came to, and the one thing it may need. */
function FileRow({
  file,
  verdict,
  cards,
  ticked,
  open,
  onTick,
  onLook,
  onMap,
  onPayslips,
  funds,
  onReport,
  onRemove,
  onInto,
  onApart,
  t,
}: {
  t: Translate
  file: BatchFile
  verdict: SheetVerdict | undefined
  /** The cards its file holds, on the file's first row, when there are two or more. */
  cards: React.ReactNode | undefined
  ticked: boolean
  /** Its gap is open beside the list. */
  open: boolean
  onTick: (on: boolean) => void
  onLook: () => void
  onMap: () => void
  onPayslips: () => void
  /** The funds a PDF may be a report of. */
  funds: readonly FundAccount[]
  onReport: (fundId: string) => void
  onRemove: () => void
  /** Send a sheet whose rows another account holds into that account. */
  onInto: () => void
  /** Keep it where it was going, overlap and all. */
  onApart: () => void
}) {
  const kind =
    file.kind === 'sheet'
      ? file.sheet.account.kind === 'BANK'
        ? t('reading.kind.bank')
        : t('reading.kind.card')
      : file.kind === 'payslip'
        ? t('reading.kind.payslip')
        : file.kind === 'new-layout'
          ? t('reading.kind.statement')
          : file.kind === 'reading'
            ? ' '
            : t('reading.kind.failed')

  let chip: React.ReactNode
  let figure: React.ReactNode = null
  let action: React.ReactNode = null
  switch (file.kind) {
    case 'reading':
      chip = (
        <span className="fc-state gap-1.5" data-tone="live">
          <Working size={12} />
          {t('reading.chip.reading')}
        </span>
      )
      break
    case 'payslip':
      chip = (
        <span className="fc-state" data-tone="wait">
          {t('reading.chip.waiting')}
        </span>
      )
      figure = t('reading.row.payslip')
      action = (
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={READ_GLYPH.paychecks} onClick={onPayslips}>
            {t('reading.row.aPaycheck')}
          </Button>
          {funds.length > 0 && (
            <ChoiceMenu
              text=""
              placeholder={t('reading.row.reportOf')}
              choices={funds.map((fund) => ({ value: fund.id, label: fund.name }))}
              onPick={(choice) => onReport(choice.value)}
              aria-label={t('reading.row.reportOfLabel', { file: file.fileName })}
              dir="auto"
              className={`${SELECT} h-7 max-w-44`}
            />
          )}
        </span>
      )
      break
    case 'new-layout':
      // Not a problem: a file of a kind not read before waits to be mapped, said once (D-531).
      chip = (
        <span className="fc-state" data-tone="wait">
          {t('reading.chip.noReader')}
        </span>
      )
      figure = t('reading.row.mapped')
      action = (
        <Button variant="secondary" size="sm" icon="arrow" onClick={onMap}>
          {t('reading.row.map')}
        </Button>
      )
      break
    case 'failed':
      chip = <Tone tone="negative">{t('reading.chip.notRead')}</Tone>
      figure = file.message
      break
    case 'sheet': {
      if (verdict === undefined) break
      figure = describe(t, verdict)
      if (verdict.state === 'same') chip = <span className="fc-state">{t('reading.chip.same')}</span>
      else if (verdict.state === 'elsewhere' && verdict.elsewhere !== undefined) {
        // The same bank read by a second reader, about to become a second
        // account (M28 F11): say where its rows already are, and offer that first.
        chip = <Tone tone="warn">{t('reading.chip.elsewhere')}</Tone>
        figure =
          verdict.elsewhere.accountId === undefined && verdict.elsewhere.madeBy !== undefined ? (
            // An account a file above is about to make (M28 F15): its rows are
            // not written yet, so they are *in that file*, not in the account.
            <Phrase text={t('reading.row.alsoIn')} parts={{
              rows: verdict.elsewhere.rows,
              parsed: verdict.parsed,
              name: <Bidi>{verdict.elsewhere.madeBy}</Bidi>,
            }} />
          ) : (
            <Phrase text={t('reading.row.alreadyIn')} parts={{
              rows: verdict.elsewhere.rows,
              parsed: verdict.parsed,
              name: <Bidi>{verdict.elsewhere.accountName}</Bidi>,
            }} />
          )
        action = (
          <span className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onInto}>
              <Phrase text={t('reading.row.into')} parts={{ name: <Bidi>{verdict.elsewhere.accountName}</Bidi> }} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onApart}>
              {t('reading.row.apart')}
            </Button>
          </span>
        )
      } else if (verdict.state === 'gap' && !ticked) {
        chip = <Tone tone="warn">{t('reading.chip.gap')}</Tone>
        action = (
          <Button variant="secondary" size="sm" onClick={onLook}>
            {t('reading.row.look')}
          </Button>
        )
      } else if (verdict.reconciles === true || verdict.balance.kind === 'VERIFIED') {
        chip = <Tone tone="positive">{t('reading.chip.addsUp')}</Tone>
      } else if (verdict.state === 'gap') {
        chip = <Tone tone="warn">{t('reading.chip.anyway')}</Tone>
      } else {
        chip = <span className="fc-state">{t('reading.chip.nothing')}</span>
      }
      break
    }
  }

  // A file written anyway is ticked, and can be unticked like any other.
  const tickable = file.kind === 'sheet' && verdict !== undefined && (verdict.state === 'ok' || ticked)
  // Every row comes out before Write, whatever it came to (M28 F12): its ×, or
  // Delete with the row focused.
  const removable = removableRow(onRemove)
  return (
    <div
      {...removable}
      data-tour="read-file"
      aria-current={open || undefined}
      className={`grid min-h-12 ${open ? 'bg-surface' : ''} grid-cols-[20px_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_auto_auto] items-center gap-4 border-b border-hairline px-1 ${removable.className}`}
    >
      {tickable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={ticked}
          aria-label={t('reading.row.writeFile', { file: file.fileName })}
          onClick={() => onTick(!ticked)}
          className={`inline-flex size-4 items-center justify-center border-[1.5px] ${
            ticked ? 'border-accent bg-accent text-accent-ink' : 'border-hairline-strong'
          }`}
        >
          {ticked && <ActionGlyph name="check" size={12} />}
        </button>
      ) : (
        <span
          aria-hidden
          className={`inline-flex size-4 items-center justify-center border-[1.5px] ${
            ticked ? 'border-accent bg-accent text-accent-ink' : 'border-hairline-strong opacity-40'
          }`}
        >
          {ticked && <ActionGlyph name="check" size={12} />}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <Bidi className="truncate">{file.fileName}</Bidi>
        <small className="text-caption text-ink-secondary">
          {kind}
          {file.kind === 'sheet' && file.sheet.table.name !== '' && (
            <>
              {' · '}
              <Bidi>{file.sheet.table.name}</Bidi>
            </>
          )}
          {verdict !== undefined && (
            <>
              <Phrase text={verdict.accountId === undefined && verdict.madeBy === undefined
                  ? t('reading.row.intoNew')
                  : t('reading.row.intoName')} parts={{ name: <Bidi>{verdict.accountName}</Bidi> }} />
              {verdict.madeBy !== undefined && <Phrase text={t('reading.row.newWith')} parts={{ name: <Bidi>{verdict.madeBy}</Bidi> }} />}
            </>
          )}
        </small>
        {cards !== undefined && <small className="text-caption text-ink-secondary">{cards}</small>}
      </span>
      <span>{chip}</span>
      <span className="text-body text-ink-secondary tabular-nums">{figure}</span>
      <span>{action}</span>
      <IconAction label={t('reading.row.remove', { file: file.fileName })} onClick={onRemove}>
        <path d="M6 6l12 12M18 6 6 18" />
      </IconAction>
    </div>
  )
}

function Tone({ tone, children }: { tone: 'positive' | 'negative' | 'warn'; children: React.ReactNode }) {
  return (
    <span className="fc-state" data-tone={tone}>
      <span className="fc-state-dot" />
      {children}
    </span>
  )
}

/** What a sheet came to, in a line: how many are new, and what its checks said. */
function describe(t: Translate, verdict: SheetVerdict): string {
  if (verdict.parsed === 0) return t('reading.verdict.none')
  if (verdict.state === 'same') return t('reading.verdict.same', { count: verdict.parsed })
  // A row skipped from this read in the mapper is said here too (M55 U9, D-540).
  const skipped = verdict.rows.filter((row) => row.outcome.kind === 'skipped' && row.outcome.reason === LEFT_OUT).length
  const counts =
    (verdict.duplicates === 0
      ? t('reading.verdict.fresh', { count: verdict.newRows })
      : t('reading.verdict.freshAndHere', { fresh: verdict.newRows, here: verdict.duplicates })) +
    (skipped === 0 ? '' : t('reading.verdict.skipped', { count: skipped }))
  const parsed = verdict.parsedTotals.map((total) => formatMoney(total)).join(' + ')
  if (verdict.balance.kind === 'DIVERGED') return t('reading.verdict.diverged', { counts, ref: verdict.balance.at.ref })
  if (verdict.printed !== undefined) {
    const printed = formatMoney({ minor: Math.abs(verdict.printed.amount.minor), currency: verdict.printed.amount.currency })
    return verdict.reconciles === true
      ? t('reading.verdict.addsUp', { counts, printed })
      : t('reading.verdict.disagrees', { parsed, printed })
  }
  if (verdict.balance.kind === 'VERIFIED') return t('reading.verdict.agrees', { counts })
  return t('reading.verdict.noTotal', { counts, parsed })
}
