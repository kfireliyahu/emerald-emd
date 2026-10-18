import type { AuditRow, FormatAudit, Finding } from '@/domain/format/audit.ts'
import { Bidi } from '@/ui/Bidi.tsx'

/**
 * **What looks wrong, said without being asked** — M34 U3, D-396.
 *
 * A band of its own under *What has to add up*, drawn only when the engine sees
 * something: a link left empty where most entries fill it, entries the same in
 * every column, a check that failed — each naming the entries, which open. The
 * same `auditFormat` the conversation's `format_problems` reads, so the two say
 * the same thing (D-227).
 *
 * **An unchecked identity stays a count** — the band above already gives it,
 * and an entry with an empty column is the common case, not a fault (D-149).
 * The conversation is told the names; the screen says less (T9).
 */
export function WhatLooksWrong({
  audits,
  onOpen,
  framed = true,
}: {
  audits: readonly FormatAudit[]
  /** Opens an entry; without it the names are plain — rows not written yet. */
  onOpen?: ((format: string, row: string) => void) | undefined
  /** A band under a toolbar, or a list inside a page that has its own frame. */
  framed?: boolean
}) {
  const shown = audits.flatMap((audit) =>
    audit.findings
      .filter((finding) => finding.kind !== 'UNCHECKED')
      .map((finding) => ({ audit, finding })),
  )
  if (shown.length === 0) return null
  const several = new Set(shown.map((each) => each.audit.format)).size > 1

  return (
    <section
      aria-label="What looks wrong"
      className={
        framed
          ? 'fc-pop-enter flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-6 py-2'
          : 'fc-pop-enter mb-3 space-y-1'
      }
    >
      <span className="text-label text-negative uppercase">What looks wrong</span>
      <ul className="min-w-0 space-y-0.5 text-caption text-ink">
        {shown.map(({ audit, finding }, at) => (
          <li key={at}>
            {several && (
              <span className="text-ink-secondary">
                <Bidi>{audit.title}</Bidi>:{' '}
              </span>
            )}
            <Sentence finding={finding} open={onOpen === undefined ? undefined : (row) => onOpen(audit.format, row)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Entries a sentence names before it says how many more. */
const NAMED = 5

function entries(n: number): string {
  return n === 1 ? '1 entry' : `${String(n)} entries`
}

type Open = ((row: string) => void) | undefined

function Sentence({ finding, open }: { finding: Finding; open: Open }) {
  switch (finding.kind) {
    case 'LINK_GAP':
      return (
        <>
          <code>{finding.column}</code> is empty on {entries(finding.empty.length)} where{' '}
          {finding.filled} name a <Bidi>{finding.target}</Bidi>: <Names rows={finding.empty} open={open} />
        </>
      )
    case 'DUPLICATE':
      return (
        <>
          {entries(finding.rows.length)} the same in every column: <Names rows={finding.rows} open={open} />
        </>
      )
    case 'FAILED':
      return (
        <>
          <code>{finding.identity}</code> fails on {entries(finding.rows.length)}:{' '}
          <Names rows={finding.rows} open={open} />
        </>
      )
    case 'UNCHECKED':
      return null
  }
}

function Names({ rows, open }: { rows: readonly AuditRow[]; open: Open }) {
  return (
    <>
      {rows.slice(0, NAMED).map((row, at) => (
        <span key={row.id}>
          {at > 0 && ', '}
          {open === undefined ? (
            <Bidi>{row.name}</Bidi>
          ) : (
            <button type="button" className="text-accent hover:underline" onClick={() => open(row.id)}>
              <Bidi>{row.name}</Bidi>
            </button>
          )}
          {/* Both figures, beside the row they are about (M34 U4, D-397). */}
          {row.says !== undefined && <span className="text-ink-secondary"> ({row.says})</span>}
        </span>
      ))}
      {rows.length > NAMED && ` and ${String(rows.length - NAMED)} more`}
    </>
  )
}
