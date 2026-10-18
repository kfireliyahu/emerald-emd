import { useState } from 'react'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { tableNameFor } from '@/domain/format/declaration.ts'
import {
  declarationOf,
  moveColumn,
  newColumn,
  suggestedName,
  type DraftProblem,
} from '@/domain/format/draft.ts'
import type { ReconcilePlan } from '@/domain/format/reconcile.ts'
import type { UnitTable } from '@/domain/format/unit.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { AddsUpPlace } from '@/ui/formats/AddsUpPlace.tsx'
import { RowSheet } from '@/ui/formats/RowSheet.tsx'
import type { DocumentCurrency } from '@/ui/formats/ColumnQuestions.tsx'
import { ShapePanel } from '@/ui/formats/ShapePanel.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { openingShape, sheetMark, type Shape } from '@/ui/formats/shape.ts'

const NOTHING = new Map<string, never>()

/**
 * **A new format is the editor on an empty one** — M29 U1, D-331.
 *
 * From a new-user run: *"creating a format is the old view, edit is
 * much better, and can be used instead, i don't think two separate views are
 * needed."* So the walk (T1, D-237) and the blank sheet (M23 U2, D-248) went,
 * and this is the format's own screen before it has a table: its name where
 * the title sits, the sheet's headers with the `+` after the last one, what
 * has to add up as a band of its own, and `ShapePanel` underneath — open the
 * whole time, because there is nothing else here to do yet.
 *
 * **Nothing is written until Create** (D-140), and Create writes through the
 * same `adoptFormat` the editor and the tools use. The entries come after, at
 * the foot of the same sheet, because a row needs a table to be a row of.
 *
 * The title can be Hebrew, and then no table name can be read off it; the
 * name is asked for beside it then and only then, as the walk did.
 *
 * **The name comes first, alone** (M29 F4, D-345). Asked: *"when creating
 * a format, first let the user fill the table name"* — the sheet, the band and
 * the panel all asked at once, and the panel took the cursor from the title.
 * So an unnamed format is one question until it has a name, and the columns
 * come after; a draft that came through a door already named skips it.
 */
export function NewFormat({
  shape,
  others,
  units,
  currency,
  problems,
  waiting,
  plan,
  onShape,
  onCreate,
  onCancel,
  onCopy,
}: {
  shape: Shape
  /** Every format already in the document. */
  others: readonly FormatDeclaration[]
  units: UnitTable
  /** The document's currency, asked beside a money column (M29 F3, D-344). */
  currency?: DocumentCurrency | undefined
  /** The problems worth drawing — `creationOf`'s `shown`. */
  problems: readonly DraftProblem[]
  /** What Create still waits on. */
  waiting: readonly string[]
  plan: ReconcilePlan | undefined
  onShape: (shape: Shape) => void
  onCreate: () => void
  onCancel: () => void
  onCopy: () => void
}) {
  const { draft, focus } = shape
  const [naming, setNaming] = useState(() => draft.title.trim() === '')
  // A column removed from under the panel leaves it open on nothing; the
  // format being made has no *removed* to say, so it moves to the last column,
  // or to a fresh one when none is left.
  const settle = (next: Shape): void => {
    const { focus: at, draft: was } = next
    if (at.kind !== 'COLUMN' || was.columns.some((each) => each.key === at.key)) {
      onShape(next)
      return
    }
    const last = was.columns[was.columns.length - 1]
    onShape(
      last === undefined
        ? openingShape(was)
        : { draft: was, focus: { kind: 'COLUMN', key: last.key, chosen: true } },
    )
  }
  const derived = suggestedName(draft.title)
  const askName = derived === '' && draft.title.trim() !== ''
  const named = draft.columns.filter((each) => each.name.trim() !== '')

  // The sheet draws the columns that have a name, once each: a header is
  // pressed by name, and two columns typed the same are a problem the panel
  // is already drawing.
  const declared = declarationOf(draft)
  const seen = new Set<string>()
  const sheet: FormatDeclaration = {
    ...declared,
    columns: declared.columns.filter((each) => {
      if (each.name === '' || seen.has(each.name)) return false
      seen.add(each.name)
      return true
    }),
    derived: (declared.derived ?? []).filter((each) => each.name !== ''),
  }
  // Each column the sheet draws, by key, under the name it draws it by — the
  // first of a name only, as above — so the header marked is the one the
  // panel is open on (D-345).
  const drawn = new Map<string, string>()
  for (const each of draft.columns) {
    const name = each.name.trim()
    if (name !== '' && ![...drawn.values()].includes(name)) drawn.set(each.key, name)
  }
  // And the other way, for the sheet's motion: a header being typed keeps its
  // draft's key, so a keystroke moves nothing (M39 F1).
  const columnKeys = new Map<string, string>([...drawn].map(([key, name]) => [name, key]))
  for (const each of draft.derived ?? []) {
    const name = each.name.trim()
    if (name !== '' && !columnKeys.has(name)) columnKeys.set(name, each.key)
  }

  // What is wrong with the name itself — the only problems the first question can cause.
  const nameProblems = problems.filter(
    (each) => each.where.kind === 'FORMAT' && (each.where.about === 'TITLE' || each.where.about === 'NAME'),
  )
  const ready = draft.title.trim() !== '' && draft.name.trim() !== '' && nameProblems.length === 0

  const titleField = (first: boolean) => (
    <input
      className={`${FIELD} ${first ? 'w-96 max-w-full' : 'w-72'} font-medium`}
      value={draft.title}
      dir="auto"
      autoFocus={first}
      data-tour={first ? 'format-title' : undefined}
      aria-label="What one of them is called"
      placeholder="What one is: a book, a workout…"
      onChange={(event) => {
        const title = event.target.value
        // The name follows the title only while nobody has touched it.
        const name =
          draft.name === suggestedName(draft.title) ? suggestedName(title) : draft.name
        onShape({ draft: { ...draft, title, name }, focus })
      }}
      onKeyDown={
        first
          ? (event) => {
              if (event.key === 'Enter' && ready) {
                event.preventDefault()
                setNaming(false)
              }
            }
          : undefined
      }
    />
  )
  const nameField = askName ? (
    <input
      className={`${FIELD} w-48 font-mono text-caption`}
      value={draft.name}
      spellCheck={false}
      aria-label="Its table"
      placeholder="its_table_name"
      title="Lower-case letters, digits and underscores — this one cannot be read off the title."
      onChange={(event) => onShape({ draft: { ...draft, name: event.target.value }, focus })}
    />
  ) : (
    draft.name.trim() !== '' && (
      <code className="text-caption text-ink-tertiary">{tableNameFor({ name: draft.name.trim() })}</code>
    )
  )

  // Each step is keyed, so going on to the columns fades it in rather than
  // swapping the same element's contents (M39 F1).
  if (naming) {
    return (
      <div key="naming" className="fc-view-enter flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-4 border-b border-hairline px-6 py-2">
          <span className="font-medium">A new format</span>
          <span className="text-caption text-ink-tertiary">New — not in the document yet</span>
          <span className="ml-auto">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </span>
        </div>
        <section aria-label="Its name" className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-6 py-12">
          <h2 className="font-medium">What is one of them called?</h2>
          <p className="text-caption text-ink-tertiary">
            One of the things this format will hold — a book, a workout, a recipe. Its columns come
            next.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {titleField(true)}
            {nameField}
          </div>
          {nameProblems.map((each) => (
            <p key={each.message} className="text-caption text-negative">
              <Bidi>{each.message}</Bidi>
            </p>
          ))}
          <div>
            <Button variant="primary" size="sm" disabled={!ready} data-tour="add-columns" onClick={() => setNaming(false)}>
              Add its columns
            </Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div key="columns" className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2">
        {titleField(false)}
        {nameField}
        <Chip>{named.length === 1 ? '1 column' : `${String(named.length)} columns`}</Chip>
        <span className="text-caption text-ink-tertiary">New — not in the document yet</span>
        <span className="ml-auto">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </span>
      </div>

      <AddsUpPlace
        identities={draft.identities}
        open={focus.kind === 'ADDS_UP'}
        onOpen={() => onShape({ draft, focus: { kind: 'ADDS_UP' } })}
      />

      <RowSheet
        declaration={sheet}
        rows={[]}
        first={1}
        labels={NOTHING}
        links={NOTHING}
        order={undefined}
        widths={NOTHING}
        foot={undefined}
        onSort={() => undefined}
        onWidth={() => undefined}
        onOpen={undefined}
        onDelete={undefined}
        onShape={(column) => {
          const key = draft.columns.find((each) => each.name.trim() === column)?.key
          if (key !== undefined) onShape({ draft, focus: { kind: 'COLUMN', key, chosen: true } })
        }}
        onShapeDerived={(name) => {
          const key = draft.derived?.find((each) => each.name.trim() === name)?.key
          if (key !== undefined) onShape({ draft, focus: { kind: 'DERIVED', key } })
        }}
        // A header moved (M29 U2, D-332): the panel stays on what it was open
        // on, so the arrows keep the grip.
        onMove={(column, before) => {
          const keyOf = (name: string): string | undefined =>
            draft.columns.find((each) => each.name.trim() === name)?.key
          const key = keyOf(column)
          if (key === undefined) return
          onShape({ draft: moveColumn(draft, key, before === undefined ? undefined : keyOf(before)), focus })
        }}
        marked={sheetMark(shape, drawn, sheet)}
        columnKeys={columnKeys}
        onAddColumn={() => {
          const column = newColumn()
          onShape({
            draft: { ...draft, columns: [...draft.columns, column] },
            focus: { kind: 'COLUMN', key: column.key, chosen: false },
          })
        }}
      />

      <ShapePanel
        draft={draft}
        focus={focus}
        origin={NOTHING}
        others={others}
        units={units}
        currency={currency}
        entries={0}
        problems={problems}
        plan={plan}
        changed
        followed={[]}
        creating={{ waiting }}
        onShape={settle}
        onSave={onCreate}
        onCancel={onCancel}
        onCopy={onCopy}
      />
    </div>
  )
}
