import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { formatMoney } from '@/core/money.ts'
import { listFunds } from '@/data/repositories/fundRepository.ts'
import type { FundAccount } from '@/domain/model/funds.ts'
import {
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
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'
import { IconAction, removableRow } from '@/ui/components/IconAction.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { useFilePicker, useReadFiles } from '@/ui/home/parts.tsx'

/**
 * **Read files** — `#/read`, M28 U5: statements, payslips and fund reports
 * dropped on Home, any number, on the payslip batch's pattern (M28 U3).
 *
 * Each statement is read by the saved mapping it fits and **ticked when it adds
 * up**; a row already in the document is left out on its own, so there is
 * nothing to accept. **Only a file whose printed total or running balance
 * disagrees waits**, and *Look* shows it the gap and the rows that cause it
 * (`#/read/<id>`). A new layout goes to the column mapper. A PDF is a payslip
 * or a fund report (M36 U10): payslips go to Paychecks, which reads them, and a
 * fund report to the fund it is about, chosen on its row. Write writes every ticked file in one go and
 * lands on the month, with what was written in one line — the review screen and
 * the "N imported" notice after it are gone (M28 U5).
 */
export function ReadStatements() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()
  const batch = batchFor(useStatementBatch(), db)
  const [problem, setProblem] = useState<string | undefined>()
  const [writing, setWriting] = useState(false)
  const readFiles = useReadFiles()
  const picker = useFilePicker(readFiles)

  // In the batch's order, each sheet against the ones before it (M28 F15): an
  // account a file above is about to make is where a file below can land, and
  // its rows are rows a file below already has.
  const verdicts = useMemo((): ReadonlyMap<string, SheetVerdict> => {
    if (db === undefined) return new Map()
    return judgeBatch(db, sheetsOf(batch), (id, verdict) => writesSheet(batch, id, verdict)).verdicts
  }, [db, revision, batch.files, batch.ticks, batch.forced])

  if (db === undefined) return null

  const ticked = (file: BatchFile): boolean => file.kind === 'sheet' && writesSheet(batch, file.id, verdicts.get(file.id))
  const reading = batch.files.filter((file) => file.kind === 'reading').length
  const total = batch.files.length
  const toWrite = batch.files.filter(ticked)
  const payslips = batch.files.flatMap((file) => (file.kind === 'payslip' ? [file] : []))
  const funds = listFunds(db)

  const setTick = (id: string, on: boolean): void =>
    updateStatementBatch(db, (state) => ({ ...state, ticks: new Map(state.ticks).set(id, on) }))
  const reshape = (id: string, change: (sheet: StatementSheet) => StatementSheet): void =>
    updateStatementBatch(db, (state) => ({
      ...state,
      files: state.files.map((file) => (file.id === id && file.kind === 'sheet' ? { ...file, sheet: change(file.sheet) } : file)),
    }))
  const remove = (ids: ReadonlySet<string>): void =>
    updateStatementBatch(db, (state) => withoutFiles(state, ids))

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
          wrote: `${String(imported)} ${imported === 1 ? 'transaction' : 'transactions'} from ${String(sheets.length)} ${sheets.length === 1 ? 'file' : 'files'}`,
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

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-col gap-1.5 border-b border-hairline pb-4">
          <span className="fc-label text-ink-secondary uppercase">Home · read files</span>
          <h1 className="m-0 flex items-baseline gap-3 text-[24px] leading-tight font-medium tracking-[-0.01em]">
            Read files
            <Link to="/read/readers" className="text-body font-normal text-accent hover:underline">
              Readers
            </Link>
          </h1>
          <span className="text-ink-secondary">
            Card and bank statements, paychecks and fund reports, each by the reader that knows it.
          </span>
        </header>

        <div className="flex items-center gap-5 bg-surface p-5">
          <Working size={56} still={reading === 0} label={reading === 0 ? 'Read' : 'Reading'} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[18px] font-medium tabular-nums">
              {total === 0
                ? 'Nothing to read yet'
                : reading === 0
                  ? `${String(total)} of ${String(total)} read`
                  : `Reading ${String(total - reading + 1)} of ${String(total)}`}
            </span>
            <span className="text-ink-secondary">
              {total === 0
                ? 'Add statements, paychecks or fund reports, any number. Nothing is written until you press Write.'
                : 'A file that adds up is ticked. One that does not, or is new, waits for you and is left out until it does.'}
            </span>
            {total > 0 && (
              <div className="relative mt-2 h-0.5 overflow-hidden bg-hairline">
                <i
                  className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-[var(--duration-base)]"
                  style={{ width: `${String((100 * (total - reading)) / total)}%` }}
                />
              </div>
            )}
          </div>
          <Button variant="secondary" icon="add" onClick={picker.open}>
            Add more
          </Button>
          {picker.input}
        </div>

        {problem !== undefined && (
          <div className="fc-pop-enter flex items-center gap-4 bg-surface px-4 py-2">
            <span className="text-negative">{problem}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
              Dismiss
            </Button>
          </div>
        )}

        {total > 0 && (
          <div className="flex flex-col">
            {batch.files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                verdict={verdicts.get(file.id)}
                ticked={ticked(file)}
                onTick={(on) => setTick(file.id, on)}
                onLook={() => navigate(`/read/${encodeURIComponent(file.id)}`)}
                onMap={() =>
                  file.kind === 'new-layout' && updateStatementBatch(db, (state) => ({ ...state, mapping: file }))
                }
                onPayslips={readPayslips}
                funds={funds}
                onReport={(fundId) => file.kind === 'payslip' && readReport(file.id, file.file, fundId)}
                onRemove={() => remove(new Set([file.id]))}
                onInto={() => {
                  const held = verdicts.get(file.id)?.elsewhere
                  if (held !== undefined) reshape(file.id, (sheet) => pointAt(sheet, held))
                }}
                onApart={() => reshape(file.id, keepApart)}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
          <span className="max-w-[62ch] text-ink-secondary">
            Written in one go, as transactions. Rows a file shares with what is already here are left out on their
            own, so there is nothing to accept. Your rules fill the categories; whatever is left waits on
            Transactions.
          </span>
          <Button
            variant="primary"
            icon="write"
            count={toWrite.length}
            busy={writing ? 'Writing' : undefined}
            disabled={reading > 0 || toWrite.length === 0}
            onClick={write}
            data-tour="write-files"
          >
            Write
          </Button>
        </div>
      </div>
    </div>
  )
}

function sheetId(files: readonly { id: string; sheet: StatementSheet }[], sheet: StatementSheet): string {
  return files.find((file) => file.sheet === sheet)?.id ?? sheet.id
}

/** One file of the batch: what it is, what it came to, and the one thing it may need. */
function FileRow({
  file,
  verdict,
  ticked,
  onTick,
  onLook,
  onMap,
  onPayslips,
  funds,
  onReport,
  onRemove,
  onInto,
  onApart,
}: {
  file: BatchFile
  verdict: SheetVerdict | undefined
  ticked: boolean
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
        ? 'Bank statement'
        : 'Card statement'
      : file.kind === 'payslip'
        ? 'Paycheck or fund report'
        : file.kind === 'new-layout'
          ? 'Statement'
          : file.kind === 'reading'
            ? ' '
            : 'Not read'

  let chip: React.ReactNode
  let figure: React.ReactNode = null
  let action: React.ReactNode = null
  switch (file.kind) {
    case 'reading':
      chip = (
        <span className="fc-state gap-1.5" data-tone="live">
          <Working size={12} />
          Reading
        </span>
      )
      break
    case 'payslip':
      chip = (
        <span className="fc-state" data-tone="wait">
          Waiting
        </span>
      )
      figure = 'a paycheck is read on Paychecks; a fund report into its fund'
      action = (
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon="arrow" onClick={onPayslips}>
            A paycheck
          </Button>
          {funds.length > 0 && (
            <select
              value=""
              onChange={(event) => event.target.value !== '' && onReport(event.target.value)}
              aria-label={`The fund ${file.fileName} is a report of`}
              dir="auto"
              className={`${SELECT} h-7 max-w-44`}
            >
              <option value="" disabled hidden>
                A report of…
              </option>
              {funds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.name}
                </option>
              ))}
            </select>
          )}
        </span>
      )
      break
    case 'new-layout':
      chip = <Tone tone="negative">No reader yet</Tone>
      figure = 'no reader knows these columns yet'
      action = (
        <Button variant="secondary" size="sm" icon="arrow" onClick={onMap}>
          Map its columns
        </Button>
      )
      break
    case 'failed':
      chip = <Tone tone="negative">Not read</Tone>
      figure = file.message
      break
    case 'sheet': {
      if (verdict === undefined) break
      figure = describe(verdict)
      if (verdict.state === 'same') chip = <span className="fc-state">Already written</span>
      else if (verdict.state === 'elsewhere' && verdict.elsewhere !== undefined) {
        // The same bank read by a second reader, about to become a second
        // account (M28 F11): say where its rows already are, and offer that first.
        chip = <Tone tone="warn">Already in another account</Tone>
        figure =
          verdict.elsewhere.accountId === undefined && verdict.elsewhere.madeBy !== undefined ? (
            // An account a file above is about to make (M28 F15): its rows are
            // not written yet, so they are *in that file*, not in the account.
            <>
              {verdict.elsewhere.rows} of {verdict.parsed} rows are also in <Bidi>{verdict.elsewhere.madeBy}</Bidi>
            </>
          ) : (
            <>
              {verdict.elsewhere.rows} of {verdict.parsed} rows are already in <Bidi>{verdict.elsewhere.accountName}</Bidi>
            </>
          )
        action = (
          <span className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onInto}>
              Into <Bidi>{verdict.elsewhere.accountName}</Bidi>
            </Button>
            <Button variant="ghost" size="sm" onClick={onApart}>
              Keep apart
            </Button>
          </span>
        )
      } else if (verdict.state === 'gap' && !ticked) {
        chip = <Tone tone="warn">Doesn't add up</Tone>
        action = (
          <Button variant="secondary" size="sm" icon="arrow" onClick={onLook}>
            Look
          </Button>
        )
      } else if (verdict.reconciles === true || verdict.balance.kind === 'VERIFIED') {
        chip = <Tone tone="positive">Adds up</Tone>
      } else if (verdict.state === 'gap') {
        chip = <Tone tone="warn">Written anyway</Tone>
      } else {
        chip = <span className="fc-state">Nothing to check</span>
      }
      break
    }
  }

  const tickable = file.kind === 'sheet' && verdict !== undefined && verdict.state === 'ok'
  // Every row comes out before Write, whatever it came to (M28 F12): its ×, or
  // Delete with the row focused.
  const removable = removableRow(onRemove)
  return (
    <div
      {...removable}
      data-tour="read-file"
      className={`grid min-h-[52px] grid-cols-[20px_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_auto_auto] items-center gap-4 border-b border-hairline px-1 ${removable.className}`}
    >
      {tickable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={ticked}
          aria-label={`Write ${file.fileName}`}
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
          {file.kind === 'sheet' && file.sheet.table.name !== '' ? ` · ${file.sheet.table.name}` : ''}
          {verdict !== undefined && (
            <>
              {verdict.accountId === undefined && verdict.madeBy === undefined ? ' · into a new account, ' : ' · into '}
              <Bidi>{verdict.accountName}</Bidi>
              {verdict.madeBy !== undefined && (
                <>
                  , new with <Bidi>{verdict.madeBy}</Bidi>
                </>
              )}
            </>
          )}
        </small>
      </span>
      <span>{chip}</span>
      <span className="text-[13px] text-ink-secondary tabular-nums">{figure}</span>
      <span>{action}</span>
      <IconAction label={`Remove ${file.fileName}`} onClick={onRemove}>
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
function describe(verdict: SheetVerdict): string {
  if (verdict.parsed === 0) return 'no row read'
  if (verdict.state === 'same') return `all ${String(verdict.parsed)} rows already here`
  const counts =
    verdict.duplicates === 0
      ? `${String(verdict.newRows)} new`
      : `${String(verdict.newRows)} new, ${String(verdict.duplicates)} already here`
  const parsed = verdict.parsedTotals.map((total) => formatMoney(total)).join(' + ')
  if (verdict.balance.kind === 'DIVERGED') return `${counts} · the running balance stops agreeing at ${verdict.balance.at.ref}`
  if (verdict.printed !== undefined) {
    const printed = formatMoney({ minor: Math.abs(verdict.printed.amount.minor), currency: verdict.printed.amount.currency })
    return verdict.reconciles === true
      ? `${counts} · adds up to the printed ${printed}`
      : `rows ${parsed}, the file prints ${printed}`
  }
  if (verdict.balance.kind === 'VERIFIED') return `${counts} · running balance agrees`
  return `${counts} · ${parsed}, and the file prints no total`
}
