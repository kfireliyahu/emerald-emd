import { err, ok, type Result } from '@/core/result.ts'
import { aggregate, AGGREGATE_KINDS, type AggregateKind } from '@/domain/format/aggregate.ts'
import { column, COLUMN_TYPES, DECLARATION_LANGUAGE, type ColumnType, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { derived } from '@/domain/format/derived.ts'
import { parseFoundBy } from '@/domain/format/foundBy.ts'
import { identity } from '@/domain/format/identity.ts'

/**
 * **What a tour's declaring `write` writes** (M33 U7): a format, as a
 * conversation hands it to `declare_format` and `extend_format` — the same
 * words, a subset of them. A format the document holds is **added to**, never
 * changed (`extend_format`'s *it only adds*), which is how a person's total and
 * claim go onto a pack's paycheck without touching one of its columns; one it
 * does not hold is made, and then it needs a title and a column.
 *
 * Plain values in, a declaration out: the demo's handle judges it as the
 * screens do — the declaration's own rules, a pack's lock, the reconciler's
 * plan — and writes it with `adoptFormat` (`src/demo/main.tsx`).
 */
export interface TourDeclare {
  readonly format: string
  readonly title?: string
  readonly notes?: string
  readonly columns?: readonly {
    readonly name: string
    readonly type: string
    readonly required?: boolean
    readonly target?: string
    /** `date in period`: the link fills itself from this row's date (D-350). */
    readonly found_by?: string
    readonly note?: string
  }[]
  readonly computed?: readonly { readonly name: string; readonly works_out: string; readonly note?: string }[]
  readonly aggregates?: readonly {
    readonly name: string
    readonly of: string
    readonly over_format: string
    readonly over_column: string
    readonly works_out: string
    readonly note?: string
  }[]
  readonly claims?: readonly { readonly name: string; readonly expression: string; readonly note?: string }[]
  /**
   * Its sheet's widths, column to pixels, as `arrange_views` sets them —
   * presentation, so never part of the declaration: what lets a sheet of seven
   * columns fit beside the conversation without scrolling sideways (M33 F1).
   */
  readonly widths?: Readonly<Record<string, number>>
}

/** The declaration `input` asks for, over what the document holds of it — or why not. */
export function declarationFrom(input: TourDeclare, held: FormatDeclaration | undefined): Result<FormatDeclaration, string> {
  const columns = []
  for (const each of input.columns ?? []) {
    if (!(COLUMN_TYPES as readonly string[]).includes(each.type)) return err(`${each.name}: ${each.type} is not a type.`)
    const found = each.found_by === undefined ? undefined : parseFoundBy(each.found_by)
    if (found !== undefined && !found.ok) return found
    columns.push(
      column(each.name, each.type as ColumnType, {
        required: each.required ?? false,
        ...(each.target === undefined ? {} : { target: each.target }),
        ...(found === undefined ? {} : { foundBy: found.value }),
        note: each.note ?? '',
      }),
    )
  }
  const aggregates = []
  for (const each of input.aggregates ?? []) {
    const kind = each.of.toUpperCase()
    if (!(AGGREGATE_KINDS as readonly string[]).includes(kind)) return err(`${each.name}: ${each.of} is not a total.`)
    aggregates.push(
      aggregate(each.name, kind as AggregateKind, { format: each.over_format, column: each.over_column }, {
        expression: each.works_out,
        note: each.note ?? '',
      }),
    )
  }
  const computed = (input.computed ?? []).map((each) => derived(each.name, each.works_out, each.note ?? ''))
  const claims = (input.claims ?? []).map((each) => identity(each.name, each.expression, { note: each.note ?? '' }))

  if (held !== undefined) {
    return ok({
      ...held,
      columns: [...held.columns, ...columns],
      aggregates: [...held.aggregates, ...aggregates],
      identities: [...held.identities, ...claims],
      nothingMustHold: held.identities.length + claims.length === 0,
      ...(computed.length === 0 ? {} : { derived: [...(held.derived ?? []), ...computed] }),
    })
  }
  if (input.title === undefined || columns.length === 0) {
    return err(`${input.format} is not in the document, so it needs a title and its columns.`)
  }
  return ok({
    language: DECLARATION_LANGUAGE,
    name: input.format,
    title: input.title,
    notes: input.notes ?? '',
    columns,
    identities: claims,
    aggregates,
    nothingMustHold: claims.length === 0,
    ...(computed.length === 0 ? {} : { derived: computed }),
  })
}
