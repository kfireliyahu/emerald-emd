import { useMemo } from 'react'

import type { Money } from '@/core/money.ts'
import { correct, judgeSheet, type StatementSheet } from '@/data/importer/statementBatch.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { batchFor, updateStatementBatch, useStatementBatch } from '@/state/statementBatch.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { formatMoney } from '@/core/money.ts'
import { labelFor, useRoleLabels } from '@/ui/import/roleLabel.ts'

/** How many unread rows are offered at once: a file with more needs its reader looked at. */
const ROWS_SHOWN = 8

/**
 * **A statement that does not add up, beside Read files** — M64 U7, D-619.
 * It was a page of its own (`#/read/<id>`, M28 U5) and is the row's detail now,
 * in the `SidePanel`, so the batch stays where it was (D-617: *reading more
 * about something on the screen opens beside the page*).
 *
 * It shows **the gap and the rows that cause it, and nothing else**: what the
 * file prints, what its rows come to, how far apart, and each row that did not
 * read with its own cells. Typing what a cell says is a correction to the cell,
 * made in place, so the reader reads it like every other row; when the gap
 * closes the file is ticked, and the panel says so. *Leave it out* and *Write
 * anyway* are the two answers when it does not close; Close (or Esc) leaves it
 * as it is.
 */
export function GapPanel({
  id,
  onClose,
  onLeaveOut,
}: {
  readonly id: string
  readonly onClose: () => void
  /** Takes the file out of the batch, with *Removed · Undo* where it was. */
  readonly onLeaveOut: () => void
}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const batch = batchFor(useStatementBatch(), db)
  const t = useT()
  const roleLabels = useRoleLabels()
  const file = batch.files.find((each) => each.id === id && each.kind === 'sheet')
  const sheet = file?.kind === 'sheet' ? file.sheet : undefined
  const verdict = useMemo(
    () => (db === undefined || sheet === undefined ? undefined : judgeSheet(db, sheet)),
    [db, revision, sheet],
  )

  if (db === undefined || file === undefined || sheet === undefined || verdict === undefined) {
    return (
      <SidePanel title={t('reading.gap.doesNot')} onClose={onClose}>
        <p className="m-0 text-ink-secondary">{t('reading.gap.gone')}</p>
      </SidePanel>
    )
  }

  const fixed = verdict.state !== 'gap'
  const put = (next: StatementSheet): void =>
    updateStatementBatch(db, (state) => ({
      ...state,
      files: state.files.map((each) => (each.id === file.id && each.kind === 'sheet' ? { ...each, sheet: next } : each)),
    }))
  const writeAnyway = (): void => {
    updateStatementBatch(db, (state) => ({
      ...state,
      ticks: new Map(state.ticks).set(file.id, true),
      forced: new Set(state.forced).add(file.id),
    }))
    onClose()
  }

  const printed = verdict.printed
  const rowsTotal = verdict.parsedTotals[0]
  const apart: Money | undefined =
    printed === undefined || rowsTotal === undefined
      ? undefined
      : { minor: Math.abs(Math.abs(printed.amount.minor) - rowsTotal.minor), currency: rowsTotal.currency }
  const roles = [...sheet.mapping.columnRoles].sort(([a], [b]) => a - b)
  // A row stays once somebody has typed into it, read or not, so the field
  // being typed in does not vanish when the gap closes.
  const failed = verdict.rows
    .filter((row) => row.outcome.kind === 'error' || sheet.corrections.has(row.rowIndex))
    .slice(0, ROWS_SHOWN)
  const read = verdict.parsed
  const more = verdict.failed.length - ROWS_SHOWN

  return (
    <SidePanel title={<Bidi>{file.fileName}</Bidi>} kicker={fixed ? t('reading.gap.addsUpNow') : t('reading.gap.doesNot')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {verdict.balance.kind === 'DIVERGED' ? (
          <>
            <HeadlineFigure
              label={t('reading.gap.balanceSays')}
              value={verdict.balance.at.stated}
              change={t('reading.gap.atRef', { ref: verdict.balance.at.ref })}
              empty={t('reading.gap.noTotal')}
            />
            <HeadlineFigure
              label={t('reading.gap.rowsReach')}
              value={verdict.balance.at.expected}
              change={t(countKey('reading.gap.agreedBefore', verdict.balance.at.verifiedBefore), {
                count: verdict.balance.at.verifiedBefore,
              })}
              empty={t('reading.gap.noTotal')}
            />
            <HeadlineFigure tone="gap" label={t('reading.gap.apart')} value={verdict.balance.at.difference} empty={t('reading.gap.noTotal')} />
          </>
        ) : (
          <>
            <HeadlineFigure
              label={t('reading.gap.prints')}
              value={printed === undefined ? undefined : { minor: Math.abs(printed.amount.minor), currency: printed.amount.currency }}
              empty={t('reading.gap.noTotal')}
            />
            {printed !== undefined && (
              <span className="-mt-3 text-caption text-ink-secondary">
                <Phrase text={t('reading.gap.printedAt')} parts={{ ref: printed.sourceRowRef, text: <Bidi>{printed.text}</Bidi> }} />
              </span>
            )}
            <HeadlineFigure
              label={t('reading.gap.rowsCome')}
              value={rowsTotal}
              change={t('reading.gap.readOf', { read, total: read + verdict.failed.length })}
              empty={t('reading.verdict.none')}
            />
            <HeadlineFigure tone="gap" label={t('reading.gap.apart')} value={fixed ? undefined : apart} empty={t('reading.gap.addsUpNow')} />
          </>
        )}
      </div>

      {failed.length === 0 && !fixed && <p className="m-0 text-ink-secondary">{t('reading.gap.everyRow')}</p>}

      {failed.map((row) => {
        const fixes = sheet.corrections.get(row.rowIndex)
        const bad = new Set<string>(row.outcome.kind === 'error' ? row.outcome.errors.map((error) => error.role ?? '') : [])
        return (
          <section key={row.rowIndex} className="flex flex-col gap-2 border-t border-hairline pt-3">
            <h3 className="m-0 text-body font-medium">
              {row.outcome.kind === 'error'
                ? t('reading.gap.notRead', { row: row.rowIndex + 1 })
                : t('reading.gap.typed', { row: row.rowIndex + 1 })}
            </h3>
            {row.outcome.kind === 'error' && (
              <span className="text-caption text-ink-secondary">{row.outcome.errors.map((error) => error.message).join(' · ')}</span>
            )}
            {/* The row's own cells, raw and mono, as the mapper shows them. */}
            <div className="flex flex-wrap border border-hairline font-mono text-caption">
              {roles.map(([column, role]) => (
                <Bidi key={column} className={`border-e border-hairline px-2 py-1 ${bad.has(role) ? 'text-negative' : ''}`}>
                  {sheet.table.rows[row.rowIndex]?.[column]?.text ?? ''}
                </Bidi>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {roles.map(([column, role]) => {
                const original = sheet.table.rows[row.rowIndex]?.[column]?.text ?? ''
                const isBad = bad.has(role)
                const value = fixes?.get(column) ?? (isBad ? '' : original)
                return (
                  <label key={column} className="flex flex-col gap-1">
                    <span className="text-label text-ink-secondary uppercase">{labelFor(roleLabels, role)}</span>
                    <input
                      dir="auto"
                      value={value}
                      placeholder={isBad ? t('reading.gap.typeCell') : undefined}
                      onChange={(event) => put(correct(sheet, row.rowIndex, column, event.target.value))}
                      className={`h-8 border bg-background px-2 text-ink tabular-nums focus:outline-2 focus:-outline-offset-1 focus:outline-accent ${
                        isBad && fixes?.get(column) === undefined ? 'border-negative' : 'border-hairline-strong'
                      }`}
                    />
                  </label>
                )
              })}
            </div>
          </section>
        )
      })}

      {more > 0 && <p className="m-0 text-ink-secondary">{t(countKey('reading.gap.more', more), { count: more })}</p>}

      {!fixed && (
        <div className="flex flex-col gap-3 border-t border-hairline pt-3">
          <span className="text-caption text-ink-secondary">
            {apart === undefined ? t('reading.gap.short') : t('reading.gap.shortBy', { amount: formatMoney(apart) })}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={writeAnyway}>
              {t('reading.gap.anyway')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onLeaveOut}>
              {t('reading.gap.leaveOut')}
            </Button>
          </span>
        </div>
      )}
    </SidePanel>
  )
}
