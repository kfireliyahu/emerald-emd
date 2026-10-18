import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { formatMoney, type Money } from '@/core/money.ts'
import { correct, judgeSheet, type StatementSheet } from '@/data/importer/statementBatch.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { batchFor, updateStatementBatch, useStatementBatch } from '@/state/statementBatch.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { labelFor, ROLE_LABEL } from '@/ui/import/roleLabel.ts'

/** How many unread rows are offered at once: a file with more needs its mapping looked at. */
const ROWS_SHOWN = 8

/**
 * **The one screen a file can still need** — `#/read/<id>`, M28 U5.
 *
 * Only a file whose own printed total, or whose running balance, disagrees with
 * its rows comes here; everything else is written straight from Read files. It
 * shows **the gap and the rows that cause it, and nothing else**: what the file
 * prints, what its rows come to, how far apart, and each row that did not read
 * with its own cells. Typing what a cell says is a correction to the *cell*, so
 * the mapping reads it like every other row; when the gap closes, the file is
 * ticked and goes back to the batch.
 *
 * *Leave it out* and the other files are still written. *Write anyway* writes it
 * as it is, and the month says what it is short — the same override the balance
 * check always had, offered where the gap is shown.
 */
export function FileGap() {
  const { id } = useParams<{ id: string }>()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const navigate = useNavigate()
  const batch = batchFor(useStatementBatch(), db)
  const file = batch.files.find((each) => each.id === id && each.kind === 'sheet')
  const sheet = file?.kind === 'sheet' ? file.sheet : undefined
  const verdict = useMemo(
    () => (db === undefined || sheet === undefined ? undefined : judgeSheet(db, sheet)),
    [db, revision, sheet],
  )

  if (db === undefined || file === undefined || sheet === undefined || verdict === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-ink-secondary">
        <p>That file is not in the batch any more.</p>
        <Button variant="secondary" onClick={() => navigate('/read')}>
          Back to Read files
        </Button>
      </div>
    )
  }

  const fixed = verdict.state !== 'gap'
  const put = (next: StatementSheet): void =>
    updateStatementBatch(db, (state) => ({
      ...state,
      files: state.files.map((each) => (each.id === file.id && each.kind === 'sheet' ? { ...each, sheet: next } : each)),
    }))
  const back = (tick: boolean | undefined, force = false): void => {
    updateStatementBatch(db, (state) => {
      const ticks = new Map(state.ticks)
      if (tick === undefined) ticks.delete(file.id)
      else ticks.set(file.id, tick)
      const forced = new Set(state.forced)
      if (force) forced.add(file.id)
      else forced.delete(file.id)
      return { ...state, ticks, forced }
    })
    navigate('/read')
  }

  const printed = verdict.printed
  const rowsTotal = verdict.parsedTotals[0]
  const apart: Money | undefined =
    printed === undefined || rowsTotal === undefined
      ? undefined
      : { minor: Math.abs(Math.abs(printed.amount.minor) - rowsTotal.minor), currency: rowsTotal.currency }
  const roles = [...sheet.mapping.columnRoles].sort(([a], [b]) => a - b)
  // A row stays on screen once somebody has typed into it, read or not, so the
  // field they are typing in does not vanish under them when the gap closes.
  const failed = verdict.rows
    .filter((row) => row.outcome.kind === 'error' || sheet.corrections.has(row.rowIndex))
    .slice(0, ROWS_SHOWN)
  const read = verdict.parsed

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-col gap-1.5 border-b border-hairline pb-4">
          <span className="fc-label text-ink-secondary uppercase">
            Read files · <Bidi>{file.fileName}</Bidi>
          </span>
          <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">
            {fixed ? 'It adds up now' : "This file doesn't add up"}
          </h1>
          <span className="text-ink-secondary">
            Only a file whose own total disagrees, or whose running balance does, comes here. Everything else is
            written straight from Read files.
          </span>
        </header>

        {verdict.balance.kind === 'DIVERGED' ? (
          <div className="grid grid-cols-1 border border-hairline sm:grid-cols-3 sm:divide-x sm:divide-hairline">
            <Cell label="The file's balance says" value={formatMoney(verdict.balance.at.stated)}>
              at {verdict.balance.at.ref}
            </Cell>
            <Cell label="Its rows reach" value={formatMoney(verdict.balance.at.expected)}>
              {verdict.balance.at.verifiedBefore} rows agreed before it
            </Cell>
            <Cell label="Apart by" value={formatMoney(verdict.balance.at.difference)} problem>
              <Chip ok={false} />
            </Cell>
          </div>
        ) : (
          <div className="grid grid-cols-1 border border-hairline sm:grid-cols-3 sm:divide-x sm:divide-hairline">
            <Cell
              label="The file prints"
              value={printed === undefined ? '—' : formatMoney({ minor: Math.abs(printed.amount.minor), currency: printed.amount.currency })}
            >
              {printed === undefined ? 'no total of its own' : (
                <>
                  {printed.sourceRowRef}, <Bidi>{printed.text}</Bidi>
                </>
              )}
            </Cell>
            <Cell label="Its rows come to" value={verdict.parsedTotals.map((total) => formatMoney(total)).join(' + ') || '—'}>
              {read} of {read + verdict.failed.length} rows read
            </Cell>
            <Cell label="Apart by" value={apart === undefined ? '—' : formatMoney(apart)} problem={!fixed}>
              <Chip ok={fixed} />
            </Cell>
          </div>
        )}

        {failed.length === 0 && !fixed && (
          <p className="m-0 max-w-prose text-ink-secondary">
            Every row read, and they still do not come to what the file says. That is usually the reader taking
            the wrong column, or a sign turned round — the readers are on Transactions › Readers.
          </p>
        )}

        {failed.map((row) => {
          const fixes = sheet.corrections.get(row.rowIndex)
          const bad = new Set<string>(row.outcome.kind === 'error' ? row.outcome.errors.map((error) => error.role ?? '') : [])
          return (
            <section key={row.rowIndex} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="fc-label m-0 font-medium text-ink-secondary uppercase">
                  Row {row.rowIndex + 1} {row.outcome.kind === 'error' ? 'was not read' : 'reads now, as you typed it'}
                </h2>
                <span className="font-mono text-caption text-ink-tertiary">
                  {row.outcome.kind === 'error' ? row.outcome.errors.map((error) => error.message).join(' · ') : ''}
                </span>
              </div>
              <div className="flex flex-wrap border border-hairline font-mono text-caption">
                {roles.map(([column, role]) => (
                  <Bidi
                    key={column}
                    className={`border-r border-hairline px-2.5 py-1.5 ${bad.has(role) ? 'bg-[color-mix(in_srgb,var(--color-flow-tax)_12%,transparent)] text-flow-tax' : ''}`}
                  >
                    {sheet.table.rows[row.rowIndex]?.[column]?.text ?? ''}
                  </Bidi>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {roles.map(([column, role]) => {
                  const original = sheet.table.rows[row.rowIndex]?.[column]?.text ?? ''
                  const isBad = bad.has(role)
                  const value = fixes?.get(column) ?? (isBad ? '' : original)
                  return (
                    <label key={column} className="flex flex-col gap-1">
                      <span className="fc-label text-ink-secondary uppercase">{labelFor(ROLE_LABEL, role)}</span>
                      <input
                        dir="auto"
                        value={value}
                        placeholder={isBad ? 'type what the cell says' : undefined}
                        onChange={(event) => put(correct(sheet, row.rowIndex, column, event.target.value))}
                        className={`h-8 border bg-background px-2.5 text-ink tabular-nums focus:outline-2 focus:-outline-offset-1 focus:outline-accent ${
                          isBad && fixes?.get(column) === undefined ? 'border-flow-tax' : 'border-hairline-strong'
                        }`}
                      />
                    </label>
                  )
                })}
              </div>
            </section>
          )
        })}

        {verdict.failed.length > ROWS_SHOWN && (
          <p className="m-0 text-ink-secondary">
            And {verdict.failed.length - ROWS_SHOWN} more rows did not read. That many is usually the reader, not the
            rows.
          </p>
        )}

        <div className="flex items-center justify-between border-y border-hairline py-3 text-ink-secondary">
          <span>
            {read} rows read and nothing to decide on them
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
          <span className="text-ink-secondary">
            Leave it out and the other files are still written.
            {fixed ? '' : ` Write anyway and the month says it is ${apart === undefined ? 'short' : `${formatMoney(apart)} short`}.`}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => back(false)}>
              Leave it out
            </Button>
            {!fixed && (
              <Button variant="secondary" onClick={() => back(true, true)}>
                Write anyway
              </Button>
            )}
            <Button variant="primary" icon="check" disabled={!fixed} onClick={() => back(undefined)}>
              Back to Read files
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}

function Cell({
  label,
  value,
  problem = false,
  children,
}: {
  label: string
  value: string
  problem?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5">
      <span className="fc-label text-ink-secondary uppercase">{label}</span>
      <span className={`text-[24px] leading-tight font-medium tabular-nums ${problem ? 'text-negative' : ''}`}>{value}</span>
      <small className="text-caption text-ink-secondary">{children}</small>
    </div>
  )
}

function Chip({ ok }: { ok: boolean }) {
  return (
    <span className="fc-state mt-1 self-start" data-tone={ok ? 'positive' : 'negative'}>
      <span className="fc-state-dot" />
      {ok ? 'Adds up' : 'Does not add up'}
    </span>
  )
}
