import { Link } from 'react-router-dom'

import { Button } from '@/ui/components/Button.tsx'

import { word } from '@/domain/format/aggregate.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { problemsOfAggregate, type DraftProblem, type FormatDraft } from '@/domain/format/draft.ts'
import { formulaNames } from '@/domain/format/formula.ts'
import { IDENTITY_TYPES } from '@/domain/format/identity.ts'
import { isPointType } from '@/domain/format/span.ts'
import { WhatAddsUp } from '@/ui/formats/WorkedOut.tsx'
import { CONNECTIONS_PATH } from '@/ui/nav.ts'

/**
 * **A format's claims, and what it computes** — T4's question (D-236), asked in the
 * one editor a format is made and changed in since M29 U1 (D-331).
 *
 * It was the walk's third step until the walk went: an identity adds no SQL
 * and refuses no row, so it is the one change that loses nothing
 * (`M23 U2 #1`), and the question is the same whether the format exists yet
 * or not.
 */
export function AddsUp({
  draft,
  others,
  problems,
  onChange,
  onAddDerived,
}: {
  draft: FormatDraft
  others: readonly FormatDeclaration[]
  problems: readonly DraftProblem[]
  onChange: (draft: FormatDraft) => void
  /** Add a computed column instead (M29 F5, D-346). */
  onAddDerived?: (() => void) | undefined
}) {
  /**
   * The columns an identity can be *about*, and every number one may name.
   *
   * One hop through each link and this format's own aggregates go in the
   * second list (U4b, D-224): neither is a column of this format, and nobody
   * would guess `ingredient.kcal` was allowed.
   */
  const answerable = [
    ...new Set(
      draft.columns
        .filter(
          (each) =>
            (IDENTITY_TYPES as readonly string[]).includes(each.type) && each.name.trim() !== '',
        )
        .map((each) => each.name.trim()),
    ),
  ]
  // A date, a time or an instant may be one side of `end - start` (D-335).
  const points = new Map(
    draft.columns
      .filter((each) => isPointType(each.type) && each.name.trim() !== '')
      .map((each) => [each.name.trim(), each.type as string] as const),
  )
  const numbers = [
    ...answerable,
    ...points.keys(),
    ...linkedNumbers(draft, others),
    ...draft.aggregates.filter((each) => each.name.trim() !== '').map((each) => each.name.trim()),
  ]

  const titleOf = (name: string): string => others.find((each) => each.name === name)?.title ?? name
  const totals = new Map(
    draft.aggregates
      .filter((each) => each.name.trim() !== '')
      .map((each) => [each.name.trim(), titleOf(each.overFormat)] as const),
  )
  const subject = draft.title.trim() || draft.name.trim() || 'this format'

  return (
    <>
      <WhatAddsUp
        draft={draft}
        numbers={numbers}
        answerable={answerable}
        points={points}
        names={formulaNames(draft, others)}
        totals={totals}
        problems={problems}
        onChange={onChange}
      />

      {/* **Computed, a heading of its own** (M33 U3a): the columns whose value
          is worked out — a value, read-only, never failing, blank where an
          entry cannot answer — apart from the claims, which give a verdict. A
          claim naming one names a column already on the sheet. */}
      <section className="mt-8" data-computed>
      <h2 className="mb-1 font-medium">Computed</h2>
      <div className="mb-3 flex max-w-4xl flex-wrap items-start gap-x-6 gap-y-2">
        <p className="max-w-prose text-caption text-ink-secondary">
          The app works the value out, and nobody types it.{' '}
          <code className="text-ink">hours = end − start</code> — type start and end; hours fills
          itself in, and stays empty where an entry cannot answer.
        </p>
        {onAddDerived !== undefined && (
          <Button size="sm" data-tour="add-computed" onClick={onAddDerived}>
            + A computed column
          </Button>
        )}
      </div>

      {(draft.derived ?? []).some((each) => each.name.trim() !== '') && (
        <ul className="mb-3 space-y-1" data-computed-columns>
          {(draft.derived ?? [])
            .filter((each) => each.name.trim() !== '')
            .map((each) => (
              <li key={each.key} className="max-w-prose text-caption">
                <code className="text-ink">
                  {each.name.trim()} = {each.expression.trim() === '' ? '…' : each.expression}
                </code>{' '}
                <span className="text-ink-tertiary">— a column of the table, changed from its header</span>
              </li>
            ))}
        </ul>
      )}

      {draft.aggregates.length === 0 && (
        /* **Where a total is made, said where one is missed** (M29 F9). One
           was looked for here; it is a fact about two formats and is
           made where both are on the screen. */
        <p className="max-w-prose text-caption text-ink-tertiary" data-totals-pointer>
          A total of another format’s rows — the hours of every work day on its paycheck — is made
          on{' '}
          <Link to={CONNECTIONS_PATH} className="text-accent">
            Connections
          </Link>
          {draft.revising === undefined ? `, once ${subject} is saved` : ''}: drag{' '}
          <em>has many…</em> from {subject} onto the other format.
        </p>
      )}

      {draft.aggregates.length > 0 && (
        /* **Shown here and authored on the graph** (M20 U5, D-233). A fold is a
           fact about *two* formats and this walk can see one — but an edit
           surface that shows part of what it writes is D-138's ninth instance,
           so every one of them is listed. */
        <div className="mt-4">
          <h3 className="mb-1 text-caption font-medium">Totals of other formats’ rows</h3>
          <ul className="space-y-1">
            {draft.aggregates.map((each) => (
              <li key={each.key} className="max-w-prose text-caption">
                <code className="text-ink">{each.name === '' ? '(unnamed)' : each.name}</code>{' '}
                <span className="text-ink-secondary">
                  — the {each.kind === 'COUNT' ? 'count' : word(each.kind)}
                  {each.expression === '' ? '' : ` of ${each.expression}`} over{' '}
                  {/* Every row of it, chosen on Connections (M34 U4, D-397). */}
                  {each.overColumn === ''
                    ? `every ${titleOf(each.overFormat)} row`
                    : `the ${titleOf(each.overFormat)} rows whose ${each.overColumn} names it`}
                  {each.by === '' ? '' : `, by ${each.by}`}
                  {each.unit === '' ? '' : `, in ${each.unit}`}
                </span>
                {problemsOfAggregate(problems, each.key).map((problem) => (
                  <span key={problem.message} className="block text-negative">
                    {problem.message}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="mt-2 max-w-prose text-caption text-ink-tertiary">
            Changed on{' '}
            <Link to={CONNECTIONS_PATH} className="text-accent">
              Connections
            </Link>
            , where both formats are on the screen at once.
          </p>
        </div>
      )}
      </section>
    </>
  )
}

/**
 * The hopped names an identity of this format may use.
 *
 * This format's own links reach the columns of what they point at, and
 * `analogue.kcal` is the cooked-against-dry case the roadmap has carried since
 * U3.
 */
function linkedNumbers(
  draft: FormatDraft,
  others: readonly FormatDeclaration[],
): readonly string[] {
  return draft.columns.flatMap((link) => {
    if (link.type !== 'link' || link.target.trim() === '') return []
    const target = others.find((each) => each.name === link.target.trim())
    return (target?.columns ?? [])
      .filter((each) => (IDENTITY_TYPES as readonly string[]).includes(each.type))
      .map((each) => `${link.name.trim()}.${each.name}`)
  })
}
