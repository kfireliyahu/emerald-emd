import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { formatMoney, toDecimalString } from '@/core/money.ts'
import type { RowDerived } from '@/data/repositories/formatDerivedRepository.ts'
import type { RowAggregate } from '@/data/repositories/formatJoinRepository.ts'
import type { EntryLinks } from '@/data/repositories/formatLinkViewRepository.ts'
import { aggregateFigure, aggregateSentence } from '@/domain/format/aggregate.ts'
import type { Finding } from '@/domain/format/audit.ts'
import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { weighIdentity } from '@/domain/format/balance.ts'
import type { DerivedValue } from '@/domain/format/derived.ts'
import {
  columnsNamedBy,
  figureIn,
  figureText,
  parseIdentity,
  percentText,
  verdictSentence,
  type IdentityInputs,
} from '@/domain/format/identity.ts'
import { currencyKeyOf, isList, unitKeyOf, type ReadValue, type RowVerdict } from '@/domain/format/row.ts'
import { draftOfMembers, withField, type RowDraft } from '@/domain/format/rowDraft.ts'
import { PERCENT_PLACES, readPercent } from '@/domain/format/percent.ts'
import type { UnitTable } from '@/domain/format/unit.ts'
import {
  SHOW_AS_HINT,
  SHOW_AS_LABEL,
  entryLabel,
  entryLayout,
  entryOrder,
  entryShown,
  entryWayOf,
  movedWithin,
  printsAsPercent,
  relativeDay,
  wayOf,
  waysFor,
  workedOutType,
  type ShowAs,
} from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { membersOfDraft } from '@/domain/format/rowDraft.ts'
import { AddMember, isPercentFigure, Markdown, MARKED, PickMenu, Shown, type Part, type ShownColumn } from './EntryValue.tsx'
import { FileField, FileLink } from './FileLink.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'
import { MembersField } from './MembersField.tsx'
import { Reveal } from '@/ui/motion/Reveal.tsx'
import { useMark } from '@/ui/motion/useMark.ts'
import { useChanges } from '@/ui/useChanges.ts'
import { BalanceProof, verdictInk } from '@/ui/formats/Balance.tsx'
import { NamedBy, type LinkedRow } from '@/ui/formats/LinkViews.tsx'
import { StateChip } from '@/ui/formats/StateChip.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField, type Choice } from '@/ui/components/ChoiceField.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { NativePicker, type PickerHandle } from '@/ui/components/NativePicker.tsx'
import { CurrencyField, TypedHint, useTyped } from '@/ui/formats/TypedField.tsx'
import { parseMarkdown } from '@/ui/formats/markdown.ts'

/** A row of another format, as something to pick from a list. */
export interface LinkChoice {
  readonly id: string
  readonly label: string
}

/** Where this entry is in the list it was opened from — the sheet's order and search. */
export interface EntryPager {
  readonly at: number
  readonly of: number
  readonly previous: string | undefined
  readonly next: string | undefined
}

/**
 * **One entry, the one view of a row** — M35 U2, D-401, direction A of the
 * approved mockup (`docs/mockups/m35/entry.html`). It was `RowEditor` (M20 U1,
 * D-227), then a page of headings over inputs (M26 U6, D-294) beside a
 * read-only page of links (M27 U4, D-302); those were two views of one row,
 * each with half of it, and this is both.
 *
 * **The page's shape is the format's** (`entryLayout`): the title, then the
 * header line — every word, day, yes-or-no and single link — then the figures
 * as a grid with what they have to add up to under them, then the long texts,
 * and on the right the columns naming several rows above what names this one.
 * Nothing is on it a column did not put there (D-294); what a person arranges
 * is each column's place (D-296) and how it is drawn, chosen on the field
 * itself from the glyph beside its name.
 *
 * **A field writes when it is left** — the sheet's way — and a pick writes when
 * it is picked. No draft, no Save: a value the format refuses stays in its field
 * with the sentence, and nothing is written. Esc puts a field back. **A new
 * entry is a draft until Add**, because a row with a required column empty
 * cannot be written.
 *
 * **The page checks nothing of its own.** Every field collects a string, the
 * draft goes through `coerceRow` — the same function `record_format_rows`
 * calls (D-217) — and what is drawn is whatever sentence came back.
 *
 * **A pack's entry is read here and not written** (D-269): the same view, every
 * value as its text, and the sentence saying where it is written in the bar.
 *
 * `accent` marks what can be acted on and colours no figure (D-125).
 */
export function EntryView({
  declaration,
  draft,
  units,
  links,
  labels,
  chosen,
  places,
  headers,
  hidden,
  asked,
  long,
  largest,
  oneUnit,
  linked,
  today,
  problem,
  refused,
  inputs,
  verdicts,
  aggregates,
  derived,
  named,
  findings,
  existing,
  locked,
  pager,
  list,
  written,
  below,
  onChange,
  onCommit,
  onRevert,
  onChoose,
  onOrder,
  onHide,
  onAsk,
  onBack,
  backLabel,
  onAdd,
  onDelete,
  onOpen,
}: {
  declaration: FormatDeclaration
  draft: RowDraft
  units: UnitTable
  /** The rows each `link` column may point at, by the format it targets. */
  links: ReadonlyMap<string, readonly LinkChoice[]>
  /** What every id this row's links hold is called, past the lists above. */
  labels: ReadonlyMap<string, string>
  /** How each column — a worked-out one too — was given to be shown on this format's entry, if it was. */
  chosen: ReadonlyMap<string, ShowAs>
  /** Where each column was put on this format's entry, if it was (D-296). */
  places: ReadonlyMap<string, number>
  /** The columns the view puts in the header line beyond their type's. */
  headers: ReadonlySet<string>
  /** The columns this entry view keeps off the page (M53 U2) — never the title or a required one. */
  hidden: ReadonlySet<string>
  /** The columns a new entry asks for beside the required ones (M53 U2; U3 reads it). */
  asked: ReadonlySet<string>
  /** The text columns that read as markdown by default (`readsAsMarkdown`). */
  long: ReadonlySet<string>
  /** The largest figure of each number column on the page, which a bar is measured against. */
  largest: ReadonlyMap<string, number>
  /** The unit each quantity column is shown in, *in one unit*. */
  oneUnit: ReadonlyMap<string, string>
  /** The rows this row's links name, as a card or a list draws them. */
  linked: ReadonlyMap<string, LinkedRow>
  /** Today, `YYYY-MM-DD`, for a day said against it. */
  today: string
  /** Why the draft is not yet a row — said at the foot of a new one. */
  problem: string | undefined
  /** A field left with a value the format refused: which, and the sentence. */
  refused: { readonly column: string; readonly text: string } | undefined
  /** The row as numbers, for the picture beside each verdict. */
  inputs: IdentityInputs | undefined
  /** What the row proves. */
  verdicts: readonly RowVerdict[]
  /** What folds across a link for this row. Only ever for a row that exists. */
  aggregates: readonly RowAggregate[]
  /** The row's worked-out columns (D-334). */
  derived: readonly RowDerived[]
  /** What names this row, one hop. Nothing for a row being added. */
  named: EntryLinks | undefined
  /** What looks wrong about this row, without being asked (D-396). */
  findings: readonly Finding[]
  /** The id being shown, or nothing for a row being added. */
  existing: string | undefined
  /** Why this entry cannot be written here — a pack's (D-269) — or nothing. */
  locked: string | undefined
  pager: EntryPager | undefined
  /**
   * The format's list beside the entry (M37 U2b, D-475): whether the viewer
   * hid it, and the bar's button that does. Shown, it holds the count, and the
   * pager goes from the bar — unless the window is too narrow to show it.
   */
  list?: { readonly hidden: boolean; readonly onToggle: () => void } | undefined
  /** When this visit last wrote, as `09:41`. */
  written: string | undefined
  /** The delete question, when it is being asked. */
  below?: ReactNode
  /** Typing: the draft as it stands, written by nothing yet. */
  onChange: (next: RowDraft) => void
  /** A field left or a pick made: the draft to write, if it is a row that exists. */
  onCommit: (column: string, next?: RowDraft) => void
  /** Esc: the field as it is stored. */
  onRevert: (column: ColumnDeclaration) => void
  /** Show a column another way, or its type's default back. */
  onChoose: (column: string, way: ShowAs | undefined) => void
  /** Put the view's columns in this order, or — given nothing — the declaration's back. */
  onOrder: (columns: readonly string[] | undefined) => void
  /** Keep a column off this entry view, or show it again. */
  onHide: (column: string, hidden: boolean) => void
  /** Have a new entry ask for a column, or not. */
  onAsk: (column: string, asked: boolean) => void
  onBack: () => void
  /** What the back link says: the view the entry was opened from — `List`, `Board` — or the format's title for its table (M53 U5). */
  backLabel?: string | undefined
  onAdd: () => void
  onDelete: (() => void) | undefined
  /** Open a row of a format in this same view. */
  onOpen: (format: string, id: string) => void
}) {
  // The Fields list (M53 U2): this view's order, what it shows, and what a new
  // entry asks for — where the Arrange mode was.
  const [fieldsOpen, setFieldsOpen] = useState(false)
  // "N hidden" pressed: the hidden fields drawn in place, dimmed, until the
  // entry is left — the view is keyed per entry, so leaving it forgets this.
  const [revealed, setRevealed] = useState(false)
  const ordered = entryOrder(declaration.columns, places)
  const names = ordered.map((column) => column.name)
  const wayOfColumn = (column: ColumnDeclaration): ShowAs =>
    entryWayOf(column, chosen.get(column.name), long.has(column.name))
  const layout = entryLayout(ordered, wayOfColumn, headers)
  // **The title and a required column are drawn whatever the view says** —
  // a hand-edited `hidden` on one is read as nothing.
  const hideable = (column: ColumnDeclaration): boolean => column.required !== true && column !== layout.title
  const isHidden = (column: ColumnDeclaration): boolean => hidden.has(column.name) && hideable(column)
  // **The fields opened from the Empty line, or being typed in** (M53 U3): drawn
  // until they are left empty, when they fold back into the line.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  // The field just opened from the Empty line — or a new entry's title — focused once it is drawn.
  const [focusing, setFocusing] = useState<string | undefined>(() =>
    existing === undefined && locked === undefined ? layout.title?.name : undefined,
  )
  const page = useRef<HTMLDivElement>(null)
  const open = (name: string, focus: boolean): void => {
    setOpened((now) => (now.has(name) ? now : new Set([...now, name])))
    if (focus) setFocusing(name)
  }
  useLayoutEffect(() => {
    if (focusing === undefined) return
    setFocusing(undefined)
    const at = page.current?.querySelector(`[data-field="${CSS.escape(focusing)}"]`)
    const control = at?.querySelector<HTMLElement>('input, textarea, select, button:not([aria-label$=": more"]), [tabindex="0"]')
    if (control === null || control === undefined) return
    control.focus()
    // A menu, or a way drawn until pressed, opens as the mockup's field does.
    if (control instanceof HTMLButtonElement && (control.getAttribute('aria-haspopup') === 'menu' || control.getAttribute('aria-label')?.endsWith(': change') === true)) {
      control.click()
    }
  }, [focusing])
  // "Add" pressed on a new entry: only then is what is missing said (U1's choice d).
  const [tried, setTried] = useState(false)
  // A field moves within its part, as the order always worked (D-296): the
  // part comes from the column's type, so a move across parts would change
  // nothing a person could see.
  const parts = [layout.header, layout.figures, layout.texts, layout.links]
  const partOf = (name: string): readonly string[] =>
    (parts.find((part) => part.some((column) => column.name === name)) ?? []).map((column) => column.name)
  const reorder = (next: readonly string[]): void => {
    if (next === names) return
    // The declaration's own order is kept as nothing, so a view put back by
    // hand is a view nobody arranged.
    const declared = declaration.columns.every((column, at) => next[at] === column.name)
    onOrder(declared ? undefined : next)
  }
  const step = (name: string, by: -1 | 1): void => {
    const part = partOf(name)
    const at = part.indexOf(name)
    reorder(movedWithin(names, part, at, at + by))
  }
  const dropOn = (name: string, target: string): void => {
    const part = partOf(name)
    if (!part.includes(target)) return
    reorder(movedWithin(names, part, part.indexOf(name), part.indexOf(target)))
  }
  // What a bar is measured against: the bound declared, or the largest on the
  // page — and for a percent never less than the whole.
  const topOf = (column: ColumnDeclaration): number | undefined =>
    column.maximum ?? (column.type === 'percent' ? Math.max(100, largest.get(column.name) ?? 0) : largest.get(column.name))
  // "For every task": the format's one, as the Show as list says it.
  const one = declaration.title.toLowerCase()
  const fresh = existing === undefined
  const readOnly = locked !== undefined
  // The column being dragged — by its label on the page or its row in Fields —
  // and the one it would land on.
  const [dragging, setDragging] = useState<string | undefined>(undefined)
  const [over, setOver] = useState<string | undefined>(undefined)
  const settle = (): void => {
    setDragging(undefined)
    setOver(undefined)
  }
  const drag: Drag = {
    dragging,
    over,
    accepts: (name) => dragging !== undefined && dragging !== name && partOf(dragging).includes(name),
    start: setDragging,
    hover: setOver,
    drop: (name) => {
      if (dragging !== undefined) dropOn(dragging, name)
      settle()
    },
    end: settle,
  }
  const mover = (column: ColumnDeclaration): Mover | undefined => {
    if (readOnly || column === layout.title) return undefined
    const part = partOf(column.name)
    const at = part.indexOf(column.name)
    return {
      first: at <= 0,
      last: at === part.length - 1,
      hideable: hideable(column),
      hidden: isHidden(column),
      drag,
      onUp: () => step(column.name, -1),
      onDown: () => step(column.name, 1),
      onHide: () => onHide(column.name, !isHidden(column)),
    }
  }

  // **A field is written once it is left**, after the render its last
  // keystroke — or a figure settling to `14:30` on blur — made, so what is
  // written is what the field shows.
  const [leaving, setLeaving] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (leaving === undefined) return
    setLeaving(undefined)
    onCommit(leaving)
    // Left empty, a field opened from the Empty line folds back into it.
    const column = declaration.columns.find((each) => each.name === leaving)
    if (column !== undefined && !holds(column)) {
      setOpened((now) => (now.has(leaving) ? new Set([...now].filter((name) => name !== leaving)) : now))
    }
  }, [leaving])

  // A failed check underlines, in red, every figure it names (S4).
  const failing = new Set(
    verdicts
      .filter((each) => each.verdict.kind === 'FAILED')
      .flatMap((each) => {
        const equation = parseIdentity(each.identity.expression)
        return 'problem' in equation ? [] : columnsNamedBy(equation)
      }),
  )

  const field = (column: ColumnDeclaration, part: Part) => (
    <Field
      key={column.name}
      column={column}
      part={part}
      way={wayOfColumn(column)}
      offered={waysFor(column)}
      one={one}
      draft={draft}
      units={units}
      top={topOf(column)}
      oneUnit={oneUnit.get(column.name)}
      linked={linked}
      today={today}
      choices={column.target === undefined ? [] : (links.get(column.target) ?? [])}
      labels={labels}
      readOnly={readOnly}
      fresh={fresh}
      marked={failing.has(column.name)}
      refused={refused?.column === column.name ? refused.text : undefined}
      mover={mover(column)}
      dimmed={isHidden(column)}
      onChange={(key, text) => onChange(withField(draft, key, text))}
      onPick={(key, text) => onCommit(column.name, withField(draft, key, text))}
      onFocus={() => open(column.name, false)}
      onLeave={() => setLeaving(column.name)}
      onSubmit={fresh && part === 'title' ? add : undefined}
      onRevert={() => onRevert(column)}
      onChoose={(next) => onChoose(column.name, next === waysFor(column)[0] ? undefined : next)}
      onOpen={onOpen}
    />
  )

  // "holds a value": what the entry draws, and what the Fields list says.
  const holds = (column: ColumnDeclaration): boolean => {
    const text = (draft[column.name] ?? '').trim()
    return text !== '' && text !== '[]'
  }
  // **A worked-out figure is drawn when it has a value**, as a typed one is
  // (M53 U3); a check always is, since "unchecked" is its verdict, not nothing.
  const workedOut = derived.filter((each) => each.value.kind !== 'EMPTY')
  const folded = aggregates.filter((each) => each.value.kind !== 'UNCHECKED')
  // What is drawn, and what the Empty line offers instead (`entryShown`).
  const shown = entryShown(ordered, layout, {
    holds,
    hidden: isHidden,
    opened: refused === undefined ? opened : new Set([...opened, refused.column]),
    asked: fresh ? asked : undefined,
    revealed,
    grid: (drawnFigures) =>
      verdicts.length > 0 ||
      workedOut.length > 0 ||
      folded.length > 0 ||
      drawnFigures.some((column) => !IN_LINE.has(wayOfColumn(column))),
  })
  const header = shown.header
  const figures = shown.figures
  const texts = shown.texts
  const linkColumns = shown.links
  const hasFigures = figures.length > 0 || workedOut.length > 0 || folded.length > 0 || verdicts.length > 0
  // **Add says what is missing only once it is pressed**, and Enter in a new
  // entry's title presses it.
  const add = (): void => {
    setTried(true)
    if (problem === undefined) onAdd()
  }
  // The foot's line (U1's choice a): the names to fill, and "N hidden" at its end.
  const emptyLine = (!readOnly && shown.empty.length > 0) || shown.hidden > 0
  // The column on the right: the links drawn, and what names a row that exists.
  const aside = !fresh || linkColumns.length > 0

  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex min-h-[41px] shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-hairline px-6 py-1.5">
        {list !== undefined && (
          <button
            type="button"
            onClick={list.onToggle}
            aria-pressed={!list.hidden}
            aria-label={list.hidden ? 'Show the list' : 'Hide the list'}
            title={list.hidden ? 'Show the list' : 'Hide the list'}
            className={`-ml-2 hidden h-7 w-7 items-center justify-center text-ink-secondary hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:inline-flex ${
              list.hidden ? '' : 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]'
            }`}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="5" width="18" height="14" />
              <path d="M9 5v14" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="text-caption text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onBack}
        >
          ← <Bidi>{backLabel ?? declaration.title}</Bidi>
        </button>
        {fresh ? (
          <span className="font-medium">
            A new <Bidi>{one}</Bidi>
          </span>
        ) : (
          pager !== undefined && (
            <span
              className={`inline-flex items-center gap-0.5 text-caption text-ink-secondary ${
                list !== undefined && !list.hidden ? 'lg:hidden' : ''
              }`}
            >
              <PagerStep label="Previous" to={pager.previous} onOpen={(id) => onOpen(declaration.name, id)}>
                <path d="m15 18-6-6 6-6" />
              </PagerStep>
              <span className="tabular-nums">
                {pager.at} of {pager.of}
              </span>
              <PagerStep label="Next" to={pager.next} onOpen={(id) => onOpen(declaration.name, id)}>
                <path d="m9 18 6-6-6-6" />
              </PagerStep>
            </span>
          )
        )}
        {locked !== undefined && (
          <span className="max-w-prose text-caption text-ink-secondary">{locked}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {written !== undefined && <span className="text-caption text-ink-tertiary">Written {written}</span>}
          {!readOnly && ordered.some((column) => column !== layout.title) && (
            <FieldsList
              open={fieldsOpen}
              setOpen={setFieldsOpen}
              sections={[
                { label: 'Line under the title', columns: layout.header },
                { label: 'Figures', columns: layout.figures },
                { label: 'Text', columns: layout.texts },
                { label: 'Links', columns: layout.links },
              ]}
              isHidden={isHidden}
              hideable={hideable}
              asked={asked}
              holds={holds}
              drag={drag}
              arranged={places.size > 0}
              onStep={step}
              onHide={(column) => onHide(column.name, !isHidden(column))}
              onAsk={(column) => onAsk(column.name, !asked.has(column.name))}
              onReset={() => onOrder(undefined)}
            />
          )}
          {onDelete !== undefined && (
            <IconAction label="Delete" tone="negative" onClick={onDelete}>
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </IconAction>
          )}
        </span>
      </div>

      <div ref={page} className="@container min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-7 px-6 pt-7 pb-16">
          <header className="flex flex-col gap-2.5 border-b border-hairline pb-5">
            <div className="fc-label">
              <Bidi>{declaration.title}</Bidi>
            </div>
            {layout.title !== undefined && field(layout.title, 'title')}
            {header.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5">
                {header.map((column) => field(column, 'header'))}
              </div>
            )}
          </header>

          <div className={`grid items-start gap-11 ${aside ? '@3xl:grid-cols-[minmax(0,1fr)_280px]' : ''}`}>
            <div className="flex min-w-0 max-w-[700px] flex-col gap-7">
              {findings.length > 0 && existing !== undefined && (
                <Concerns findings={findings} id={existing} onOpen={(id) => onOpen(declaration.name, id)} />
              )}
              {hasFigures && (
                <section className="flex flex-col gap-3.5" aria-label="Figures">
                  {(figures.length > 0 || workedOut.length > 0 || folded.length > 0) && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-[22px] gap-y-3.5">
                      {figures.map((column) => field(column, 'figure'))}
                      {workedOut.map((each) => (
                        <WorkedOut
                          key={each.compiled.declaration.name}
                          each={each}
                          columns={declaration.columns}
                          chosen={chosen.get(each.compiled.declaration.name)}
                          largest={largest.get(each.compiled.declaration.name)}
                          one={one}
                          today={today}
                          readOnly={readOnly}
                          marked={failing.has(each.compiled.declaration.name)}
                          onChoose={(way, offered) =>
                            onChoose(each.compiled.declaration.name, way === offered[0] ? undefined : way)
                          }
                        />
                      ))}
                      {folded.map((each) => (
                        <Folded key={each.aggregate.name} each={each} marked={failing.has(each.aggregate.name)} />
                      ))}
                    </div>
                  )}
                  {verdicts.length > 0 && (
                    <Verdicts verdicts={verdicts} inputs={inputs} units={units} columns={declaration.columns} />
                  )}
                </section>
              )}
              {texts.map((column) => field(column, 'text'))}
              {emptyLine && (
                // **The Empty line** (M53 U3, U1's choice a): one line of names at
                // the foot, after a hairline — each opens its field where it
                // belongs, focused — and "N hidden" at its end (U2).
                <div className="flex flex-wrap items-center gap-1 border-t border-hairline pt-3.5" aria-label="Empty">
                  {!readOnly && shown.empty.length > 0 && (
                    <>
                      <span className="fc-label me-2 text-ink-tertiary">Empty</span>
                      {shown.empty.map((column) => (
                        <button
                          key={column.name}
                          type="button"
                          data-tour={`empty-${column.name}`}
                          aria-label={`Fill ${entryLabel(column)}`}
                          title={describe(column)}
                          className="inline-flex h-6 items-center gap-1 px-2 text-caption text-ink-secondary hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          onClick={() => open(column.name, true)}
                        >
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-ink-tertiary" aria-hidden>
                            <path d="M8 3v10M3 8h10" />
                          </svg>
                          <Bidi>{entryLabel(column)}</Bidi>
                        </button>
                      ))}
                    </>
                  )}
                  {shown.hidden > 0 && (
                    <button
                      type="button"
                      className="ms-auto h-6 px-2 text-caption text-ink-tertiary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      aria-pressed={revealed}
                      onClick={() => setRevealed(!revealed)}
                    >
                      {revealed ? 'Hide again' : `${String(shown.hidden)} hidden`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {aside && (
              <aside className="flex flex-col gap-[22px]" aria-label="Links">
                {linkColumns.map((column) => field(column, 'links'))}
                {/* A new entry has no "Links here": nothing names it yet (U1's choice d). */}
                {!fresh && (
                  <>
                    <NamedBy
                      groups={named?.namedBy ?? []}
                      title={declaration.title}
                      fresh={fresh}
                      labels={named?.labels ?? labels}
                    />
                    <p className="border-t border-hairline pt-2.5 text-caption text-ink-secondary" role="note">
                      One hop each way. A name opens that row here.
                    </p>
                  </>
                )}
              </aside>
            )}
          </div>
        </div>
      </div>

      {/* A panel under the entry makes its room (M39, src/ui/motion/Reveal.tsx). */}
      <Reveal>{below}</Reveal>
      {fresh && !readOnly && below === undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline bg-elevated px-6 py-2.5">
          <Button variant="primary" icon="add" onClick={add}>
            Add
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Cancel
          </Button>
          {tried && problem !== undefined && (
            <span className="text-caption text-negative" role="alert">
              {problem}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** One step of the pager, there and quiet when there is nowhere to go. */
function PagerStep({
  label,
  to,
  onOpen,
  children,
}: {
  label: string
  to: string | undefined
  onOpen: (id: string) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={to === undefined}
      className="inline-flex h-6 w-6 items-center justify-center text-ink-secondary hover:bg-surface hover:text-ink disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => {
        if (to !== undefined) onOpen(to)
      }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

/**
 * The look of a field on the page: no box until it is pointed at or typed in,
 * so a filled entry reads as text. The sheet's `FIELD` with its border and
 * plane taken away, rather than a second look of its own.
 */
const SEAMLESS =
  'min-h-8 -mx-[7px] border border-transparent bg-transparent px-1.5 py-0.5 outline-none ' +
  'hover:border-hairline focus:border-accent focus:bg-elevated ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

/**
 * **One column on the entry**: its name over its value — or beside it, in the
 * header line — with no box until the value is pointed at (D-294). The glyph
 * beside the name, on hover, is how the column is shown (M35 U2's pick: on the
 * field, not in Arrange; M35 U3, D-402: Show as).
 */
function Field({
  column,
  part,
  way,
  offered,
  one,
  draft,
  units,
  top,
  oneUnit,
  linked,
  today,
  choices,
  labels,
  readOnly,
  fresh,
  marked,
  refused,
  mover,
  dimmed,
  onChange,
  onPick,
  onFocus,
  onLeave,
  onSubmit,
  onRevert,
  onChoose,
  onOpen,
}: {
  column: ColumnDeclaration
  part: Part
  way: ShowAs
  offered: readonly ShowAs[]
  /** The format's one, as "For every task" says it. */
  one: string
  draft: RowDraft
  units: UnitTable
  top: number | undefined
  oneUnit: string | undefined
  linked: ReadonlyMap<string, LinkedRow>
  today: string
  choices: readonly LinkChoice[]
  labels: ReadonlyMap<string, string>
  readOnly: boolean
  fresh: boolean
  marked: boolean
  refused: string | undefined
  mover: Mover | undefined
  /** A hidden field drawn because "N hidden" was pressed: dimmed, and tagged so. */
  dimmed: boolean
  onChange: (key: string, text: string) => void
  onPick: (key: string, text: string) => void
  /** Focus came into the field: it stays drawn until it is left (M53 U3). */
  onFocus: () => void
  onLeave: () => void
  /** Enter in a new entry's title: Add (M53 U3). */
  onSubmit: (() => void) | undefined
  onRevert: () => void
  onChoose: (way: ShowAs) => void
  onOpen: (format: string, id: string) => void
}) {
  const [focused, setFocused] = useState(false)
  // The label as words (M53 U3): `done_on` reads "done on", `estimate_h` "estimate".
  const label = entryLabel(column)
  const empty = (draft[column.name] ?? '').trim() === '' || draft[column.name] === '[]'
  const [menu, setMenu] = useState(false)
  const showAs = !readOnly && (offered.length > 1 || mover !== undefined) && (
    <ShowAsMenu
      name={column.name}
      way={way}
      offered={offered}
      one={one}
      open={menu}
      setOpen={setMenu}
      onChoose={onChoose}
      mover={mover}
    />
  )
  const drag = mover?.drag
  // **A shown field is dragged by its label** (M53 U2), within its part; the
  // value under it stays typable, since only the label drags.
  const grabbed = (label: ReactNode) =>
    drag === undefined ? (
      label
    ) : (
      <span
        draggable
        className="cursor-grab active:cursor-grabbing"
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', column.name)
          drag.start(column.name)
        }}
        onDragEnd={drag.end}
      >
        {label}
      </span>
    )
  const hiddenTag = dimmed && (
    <span className="border border-dashed border-hairline-strong px-[5px] text-[10px] tracking-[.06em] text-ink-tertiary uppercase">
      hidden
    </span>
  )
  const name = (
    <span className="flex min-h-[18px] items-center gap-1.5">
      {grabbed(
        <span
          className={`fc-label ${part === 'header' ? 'text-ink-tertiary' : ''}`}
          title={describe(column)}
        >
          <Bidi>{label}</Bidi>
          {column.required && empty && <span className="ms-1 text-ink-tertiary normal-case">needed</span>}
        </span>,
      )}
      {hiddenTag}
      {showAs}
    </span>
  )
  const control = (
    <Control
      column={column}
      way={way}
      part={part}
      draft={draft}
      units={units}
      top={top}
      oneUnit={oneUnit}
      linked={linked}
      today={today}
      choices={choices}
      labels={labels}
      readOnly={readOnly}
      marked={marked}
      onChange={onChange}
      onPick={onPick}
      onEnter={() => {
        // Enter in a new entry's title adds it (U1's choice d).
        if (onSubmit !== undefined) {
          onSubmit()
          return
        }
        // Enter writes the field, as its hint says, and does not wait for the
        // blur to: a page without focus — the demo's frame — gets none (M33 U6).
        // The blur that follows sets the same field leaving in the same batch.
        if (!readOnly) onLeave()
        const active = document.activeElement
        if (active instanceof HTMLElement) active.blur()
      }}
      onOpen={onOpen}
    />
  )
  const hint =
    focused && !readOnly && TYPED.has(way) && column.type !== 'boolean' ? (
      <span className="text-label text-ink-tertiary">
        {fresh ? 'Kept as typed until Add' : 'Enter or leaving the field writes it · Esc puts it back'}
      </span>
    ) : null

  return (
    <section
      className={`group/field relative flex min-w-0 ${part === 'header' ? 'flex-row items-center gap-2' : 'flex-col gap-1'} border-t-2 ${drag !== undefined && drag.over === column.name && drag.accepts(column.name) ? 'border-accent' : 'border-transparent'} ${drag?.dragging === column.name ? 'opacity-50' : dimmed ? 'opacity-[.55]' : ''}`}
      aria-label={column.name}
      data-field={column.name}
      onFocus={() => {
        setFocused(true)
        onFocus()
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setFocused(false)
        if (!readOnly) onLeave()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !readOnly && !fresh && !menu) {
          event.preventDefault()
          onRevert()
        }
      }}
      onDragOver={
        drag === undefined
          ? undefined
          : (event) => {
              // A field takes a drop only from its own part.
              if (!drag.accepts(column.name)) return
              event.preventDefault()
              drag.hover(column.name)
            }
      }
      onDrop={
        drag === undefined
          ? undefined
          : (event) => {
              event.preventDefault()
              drag.drop(column.name)
            }
      }
    >
      {part !== 'title' && part !== 'links' && name}
      {part === 'links' && (
        <h3 className="flex items-center gap-1.5 pb-1">
          {grabbed(
            <span className="fc-label">
              <Bidi>{label}</Bidi>
            </span>,
          )}
          {hiddenTag}
          {showAs}
        </h3>
      )}
      {control}
      {hint}
      {refused !== undefined && <p className="max-w-prose text-caption text-negative">{refused}</p>}
    </section>
  )
}

/** The ways a value is typed into, so the hint about leaving the field means something. */
const TYPED: ReadonlySet<ShowAs> = new Set<ShowAs>([
  'line',
  'mono',
  'figure',
  'large',
  'written',
  'unit',
  'bar',
  'ring',
  'slider',
  'date',
  'relative',
  'both',
  'month',
  'datetime',
  'clock',
])

/**
 * The ways a figure keeps in the line under the title (M53 U3): a figure
 * written as it is. A large figure, a bar, a ring and a slider claim the room
 * of the figures part.
 */
const IN_LINE: ReadonlySet<ShowAs> = new Set<ShowAs>(['figure', 'written', 'unit'])

/** The ways that open a field when pressed, and are drawn until then (D-402). */
const PRESSED_OPEN: ReadonlySet<ShowAs> = new Set<ShowAs>(['bar', 'ring', 'unit', 'relative'])

/**
 * **A field's ⋯** — how a column is shown, picked on the field (M35 U2's pick
 * 3; M35 U3, D-402), and since M53 U2 where Move up, Move down and Hide are
 * too. How it is shown is kept per format beside the declaration, so it holds
 * for every entry; it never reaches the sheet's cells or the board's cards
 * (pick 4). A worked-out column's has Show as alone.
 */
function ShowAsMenu({
  name,
  way,
  offered,
  one,
  open,
  setOpen,
  onChoose,
  mover,
}: {
  name: string
  way: ShowAs
  offered: readonly ShowAs[]
  one: string
  open: boolean
  setOpen: (open: boolean) => void
  onChoose: (way: ShowAs) => void
  mover?: Mover | undefined
}) {
  const box = useRef<HTMLSpanElement>(null)
  const dismissKey = useDismiss(open, box, () => setOpen(false))
  const label = mover === undefined ? `Show ${name} as` : `${name}: more`
  const ways = offered.length > 1
  const act = (then: () => void) => () => {
    setOpen(false)
    then()
  }
  const item =
    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body hover:bg-accent-soft disabled:opacity-35 disabled:hover:bg-transparent'
  return (
    <span ref={box} className="relative inline-flex" onKeyDown={dismissKey}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        className={`inline-flex h-5 w-5 items-center justify-center text-ink-tertiary hover:text-ink focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${open ? 'opacity-100' : 'opacity-0 group-hover/field:opacity-100 group-hover/worked:opacity-100'}`}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
          <circle cx="3.5" cy="8" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="12.5" cy="8" r="1.3" />
        </svg>
      </button>
      {open && (
        <span
          role="menu"
          className="fc-pop-enter absolute top-[22px] left-0 z-20 flex min-w-[220px] flex-col border border-hairline-strong bg-elevated py-1 shadow-[var(--shadow-pop)]"
        >
          {ways && (
            <span className="fc-label px-3 pt-1.5 pb-1 text-ink-tertiary">
              Show <Bidi>{name}</Bidi> as
            </span>
          )}
          {ways && offered.map((each) => (
            <button
              key={each}
              type="button"
              role="menuitemradio"
              aria-checked={each === way}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-body hover:bg-accent-soft"
              onClick={() => {
                setOpen(false)
                onChoose(each)
              }}
            >
              <span className="w-3.5 text-accent">{each === way ? '✓' : ''}</span>
              {SHOW_AS_LABEL[each]}
              {SHOW_AS_HINT[each] !== undefined && (
                <span className="ms-auto ps-3 text-caption text-ink-tertiary">{SHOW_AS_HINT[each]}</span>
              )}
            </button>
          ))}
          {ways && (
            <span className="mt-1 max-w-[260px] border-t border-hairline px-3 pt-2 pb-1 text-label text-ink-tertiary normal-case">
              For every <Bidi>{one}</Bidi>, in this view. Kept beside the declaration.
            </span>
          )}
          {mover !== undefined && (
            <>
              {ways && <span className="my-1 h-px bg-hairline" role="separator" />}
              <button type="button" role="menuitem" className={item} disabled={mover.first} onClick={act(mover.onUp)}>
                <span className="w-3.5" />
                Move up
              </button>
              <button type="button" role="menuitem" className={item} disabled={mover.last} onClick={act(mover.onDown)}>
                <span className="w-3.5" />
                Move down
              </button>
              {mover.hideable && (
                <button type="button" role="menuitem" className={item} onClick={act(mover.onHide)}>
                  <span className="inline-flex w-3.5 text-accent">{mover.hidden ? <EyeGlyph /> : <EyeGlyph off />}</span>
                  {mover.hidden ? 'Show' : 'Hide'}
                  <span className="ms-auto ps-3 text-caption text-ink-tertiary">on this entry view</span>
                </button>
              )}
            </>
          )}
        </span>
      )}
    </span>
  )
}

/**
 * **A worked-out column** (D-334): a figure nobody types, marked so, with what
 * it is worked out from on hover — shown by the ways of the type it works out
 * to, and never edited (D-402). A worked-out figure made of percents alone is a
 * percent, and says so rather than printing its fraction.
 */
function WorkedOut({
  each,
  columns,
  chosen,
  largest,
  one,
  today,
  readOnly,
  marked,
  onChoose,
}: {
  each: RowDerived
  columns: readonly ColumnDeclaration[]
  chosen: ShowAs | undefined
  largest: number | undefined
  one: string
  today: string
  readOnly: boolean
  marked: boolean
  onChoose: (way: ShowAs, offered: readonly ShowAs[]) => void
}) {
  const [menu, setMenu] = useState(false)
  const { name, expression } = each.compiled.declaration
  const percent = isPercentFigure(each, columns)
  const type = workedOutType(each.compiled.type.kind, percent)
  const offered = waysFor(type)
  const way = wayOf(type, chosen)
  const value = each.value
  const shown = workedOutText(value, percent)
  const column: ShownColumn = {
    name,
    type: type.type,
    values: [],
    unit: value.kind === 'NUMBER' ? value.unit : undefined,
  }
  const figureWay = way === 'figure' || way === 'large'
  return (
    <section className="group/worked flex min-w-0 flex-col gap-1" aria-label={name}>
      <span className="flex min-h-[18px] items-center gap-1.5">
        <span className="fc-label">
          <Bidi>{name}</Bidi>
        </span>
        {!readOnly && offered.length > 1 && (
          <ShowAsMenu
            name={name}
            way={way}
            offered={offered}
            one={one}
            open={menu}
            setOpen={setMenu}
            onChoose={(next) => onChoose(next, offered)}
          />
        )}
      </span>
      {value.kind === 'EMPTY' ? (
        <span className="flex min-h-8 items-baseline" title={`Empty: ${value.reason}`}>
          <span className="text-[20px] font-medium text-ink-tertiary">—</span>
          <span className="ms-1 text-label text-ink-tertiary normal-case">computed</span>
        </span>
      ) : (
        <span className={`flex min-w-0 ${figureWay ? 'items-baseline' : 'items-center gap-1'}`} title={`= ${expression}`}>
          <Shown
            column={column}
            way={way}
            value={shown.value}
            beside={shown.beside}
            part="figure"
            top={percent ? Math.max(100, largest ?? 0) : largest}
            today={today}
            marked={marked}
            worked={figureWay ? expression : undefined}
          />
          {!figureWay && <span className="text-label text-ink-tertiary normal-case">computed</span>}
        </span>
      )}
    </section>
  )
}

/** A worked-out value as the form would keep it, for `Shown`: `55%`, `12.90` beside `EUR`. */
function workedOutText(value: DerivedValue, percent: boolean): { readonly value: string; readonly beside?: string | undefined } {
  if (value.kind === 'EMPTY') return { value: '' }
  if (value.kind === 'MONEY') {
    return value.currency === undefined
      ? { value: figureText(value.minor / 100) }
      : { value: toDecimalString({ minor: value.minor, currency: value.currency }), beside: value.currency }
  }
  if (value.kind === 'DATE') return { value: value.date }
  return { value: percent ? `${figureText(value.value * 100)}%` : figureText(value.value) }
}

/** A total over the rows naming this one (D-397): worked out too, with its sentence on hover. */
function Folded({ each, marked }: { each: RowAggregate; marked: boolean }) {
  const { aggregate, value } = each
  return (
    <section className="flex min-w-0 flex-col gap-1" aria-label={aggregate.name}>
      <span className="fc-label">
        <Bidi>{aggregate.name}</Bidi>
      </span>
      <span className="flex min-h-8 items-baseline" title={aggregateSentence(aggregate, value)}>
        <span className={`text-[20px] font-medium tabular-nums ${marked ? MARKED : ''}`}>
          {value.kind === 'UNCHECKED' ? <span className="text-ink-tertiary">—</span> : aggregateFigure(value)}
        </span>
        <span className="ms-1 text-label text-ink-tertiary normal-case">computed</span>
      </span>
    </section>
  )
}

/**
 * **What the row has to add up to**, under the figures it is about (S4): each
 * check by name with its verdict, the balance it was weighed on (D-232), and
 * the sentence.
 */
function Verdicts({
  verdicts,
  inputs,
  units,
  columns,
}: {
  verdicts: readonly RowVerdict[]
  inputs: IdentityInputs | undefined
  units: UnitTable
  columns: readonly ColumnDeclaration[]
}) {
  // M39: a claim whose verdict changed while this entry is open is marked
  // once, keyed by the claim's name (src/ui/motion/useMark.ts).
  const changes = useChanges(
    verdicts.map((each) => [each.identity.name, each.verdict.kind] as const),
  )
  return (
    <div className="flex flex-col gap-2.5" aria-label="Claims">
      {verdicts.map((each) => {
        const weighed = inputs === undefined ? undefined : weighIdentity(each.identity, inputs, units)
        // A check over percents alone is said in percents (D-402): the row
        // holds 55%, and the check weighs its fraction.
        const equation = parseIdentity(each.identity.expression)
        // A check over money is said in money (M33 U2): its figures are minor units.
        // One that cannot answer has no currency of its own, so it takes the
        // currency of a figure it names (M33 U7): `gross` is ₪870.00, never 87000.
        const named = 'problem' in equation ? [] : columnsNamedBy(equation)
        const figure = printsAsPercent(named, columns)
          ? percentText
          : figureIn(
              each.verdict.kind === 'UNCHECKED'
                ? named.map((name) => inputs?.currencies.get(name)).find((code) => code !== undefined)
                : each.verdict.currency,
            )
        const kind = each.verdict.kind
        const tone = kind === 'PROVED' ? 'text-positive border-positive' : kind === 'FAILED' ? 'text-negative border-negative' : 'text-ink-secondary border-hairline-strong'
        return (
          <div
            key={each.identity.name}
            className="grid grid-cols-[14px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1"
            data-tour={`verdict-${each.identity.name}`}
          >
            <span
              className={`mt-[5px] h-2 w-2 rounded-full ${kind === 'PROVED' ? 'bg-positive' : kind === 'FAILED' ? 'bg-negative' : 'bg-hairline-strong'}`}
              aria-hidden
            />
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <b className="font-medium">
                <Bidi>{each.identity.name}</Bidi>
              </b>
              <VerdictChip kind={kind} tone={tone} marked={changes.get(each.identity.name)?.times} />
            </div>
            <div className="col-start-2">
              {weighed === undefined ? (
                <p className={`text-caption ${verdictInk(each.verdict)}`}>
                  {verdictSentence(each.identity, each.verdict, figure)}
                </p>
              ) : (
                <BalanceProof declaration={each.identity} verdict={each.verdict} weighed={weighed} figure={figure} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** A claim's verdict, as a chip — marked once when it changes (M39). */
function VerdictChip({ kind, tone, marked }: { kind: RowVerdict['verdict']['kind']; tone: string; marked: number | undefined }) {
  const mark = useMark<HTMLSpanElement>(marked, kind === 'FAILED' ? 'negative' : kind === 'PROVED' ? 'positive' : 'neutral')
  return (
    <span ref={mark} className={`inline-flex h-5 items-center border px-[7px] text-label font-medium ${tone}`}>
      {kind === 'PROVED' ? 'proved' : kind === 'FAILED' ? 'failed' : 'unchecked'}
    </span>
  )
}

/**
 * **What looks wrong about this row**, said without being asked (D-396): a link
 * most rows fill, empty here, and the rows this one repeats. A failed check is
 * already its verdict under the figures, so it is not said twice.
 */
function Concerns({
  findings,
  id,
  onOpen,
}: {
  findings: readonly Finding[]
  id: string
  onOpen: (id: string) => void
}) {
  const lines = findings.flatMap((finding, at): ReactNode[] => {
    switch (finding.kind) {
      case 'LINK_GAP':
        return [
          <li key={at}>
            <code>{finding.column}</code> is empty here, where {finding.filled}{' '}
            {finding.filled === 1 ? 'entry names' : 'entries name'} a <Bidi>{finding.target}</Bidi>.
          </li>,
        ]
      case 'DUPLICATE': {
        const others = finding.rows.filter((row) => row.id !== id)
        return [
          <li key={at}>
            The same in every column as{' '}
            {others.map((row, index) => (
              <span key={row.id}>
                {index > 0 && ', '}
                <button type="button" className="text-accent hover:underline" onClick={() => onOpen(row.id)}>
                  <Bidi>{row.name}</Bidi>
                </button>
              </span>
            ))}
            .
          </li>,
        ]
      }
      default:
        return []
    }
  })
  if (lines.length === 0) return null
  return (
    <section aria-label="What looks wrong" className="fc-pop-enter flex flex-col gap-1">
      <span className="text-label text-negative uppercase">What looks wrong</span>
      <ul className="space-y-0.5 text-caption text-ink">{lines}</ul>
    </section>
  )
}

/**
 * **A drag in progress** (M53 U2) — of a field by its label on the page, or of
 * its row in the Fields list. One for the whole entry, so a row dragged in the
 * list and a label dragged on the page are the same move.
 */
interface Drag {
  readonly dragging: string | undefined
  readonly over: string | undefined
  /** Whether a column takes the one being dragged: another column of its part. */
  readonly accepts: (name: string) => boolean
  readonly start: (name: string) => void
  readonly hover: (name: string) => void
  readonly drop: (name: string) => void
  readonly end: () => void
}

/** What a field needs to be moved and hidden from the page (D-296, M53 U2). Never the title's. */
interface Mover {
  /** First or last of its part, where a step that way goes nowhere. */
  readonly first: boolean
  readonly last: boolean
  /** Not the title and not required. */
  readonly hideable: boolean
  readonly hidden: boolean
  readonly drag: Drag
  readonly onUp: () => void
  readonly onDown: () => void
  readonly onHide: () => void
}

/** The eye of Shown, or struck through for hidden — the mockup's two glyphs. */
function EyeGlyph({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      {off ? (
        <path d="M2 2l12 12M6.5 4C7 3.7 7.5 3.5 8 3.5c4 0 6.5 4.5 6.5 4.5a12 12 0 0 1-2 2.5M4 5.2A12 12 0 0 0 1.5 8S4 12.5 8 12.5c1 0 1.8-.2 2.6-.6" />
      ) : (
        <>
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
        </>
      )}
    </svg>
  )
}

/**
 * **The Fields list** — M53 U2, U1's approved mockup
 * (`docs/mockups/m53-u1/tasks.html`). It replaced *Arrange this view*: every
 * column but the title, in this view's order and sectioned by the part of the
 * page it sits in, each a grip, its name, whether it is needed or holds a
 * value, an eye (Shown) and a *New entry* tick. A row is dragged within its
 * section, or moved a step with Alt+Up and Alt+Down while it has focus — the
 * list is where a field that is not on the page (hidden, or empty) is moved.
 */
function FieldsList({
  open,
  setOpen,
  sections,
  isHidden,
  hideable,
  asked,
  holds,
  drag,
  arranged,
  onStep,
  onHide,
  onAsk,
  onReset,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  sections: readonly { readonly label: string; readonly columns: readonly ColumnDeclaration[] }[]
  isHidden: (column: ColumnDeclaration) => boolean
  hideable: (column: ColumnDeclaration) => boolean
  asked: ReadonlySet<string>
  holds: (column: ColumnDeclaration) => boolean
  drag: Drag
  /** Whether somebody moved a column, so the declaration's order can be had back. */
  arranged: boolean
  onStep: (name: string, by: -1 | 1) => void
  onHide: (column: ColumnDeclaration) => void
  onAsk: (column: ColumnDeclaration) => void
  onReset: () => void
}) {
  const box = useRef<HTMLSpanElement>(null)
  const dismissKey = useDismiss(open, box, () => setOpen(false))
  // The row Alt+Up or Alt+Down just moved, focused again once it is drawn in its new place.
  const [stepped, setStepped] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (stepped === undefined) return
    box.current?.querySelector<HTMLElement>(`[data-field-row="${CSS.escape(stepped)}"]`)?.focus()
    setStepped(undefined)
  })
  const label = 'Fields: order, shown, new entry'
  const grid = 'grid grid-cols-[20px_minmax(0,1fr)_28px_56px] items-center gap-1.5 px-2.5'
  return (
    <span ref={box} className="relative inline-flex" onKeyDown={dismissKey}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`fc-icon-action ${open ? 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]' : ''}`}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path d="M2 4h8M2 8h12M2 12h6" />
          <circle cx="12" cy="4" r="1.5" />
          <circle cx="10" cy="12" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Fields"
          className="fc-pop-enter absolute top-[34px] right-0 z-30 w-[340px] max-w-[calc(100vw-32px)] border border-hairline-strong bg-elevated pt-1 pb-2 shadow-[var(--shadow-pop)]"
        >
          <div className={`${grid} h-6 text-[10px] tracking-[.06em] text-ink-tertiary uppercase`} aria-hidden>
            <span />
            <span>Field</span>
            <span>Shown</span>
            <span className="text-center">New entry</span>
          </div>
          {sections
            .filter((section) => section.columns.length > 0)
            .map((section) => (
              <div key={section.label} role="group" aria-label={section.label}>
                <div className="fc-label px-3 pt-2 pb-0.5">{section.label}</div>
                {section.columns.map((column) => {
                  const off = isHidden(column)
                  const words = entryLabel(column)
                  const needed = column.required === true
                  return (
                    <div
                      key={column.name}
                      data-field-row={column.name}
                      draggable
                      tabIndex={0}
                      aria-label={`${words}, Alt+Up or Alt+Down moves it`}
                      className={`${grid} relative h-8 text-body hover:bg-surface focus-visible:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                        drag.over === column.name && drag.accepts(column.name) ? 'shadow-[inset_0_2px_0_var(--color-accent)]' : ''
                      } ${drag.dragging === column.name ? 'opacity-40' : ''}`}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', column.name)
                        drag.start(column.name)
                      }}
                      onDragEnd={drag.end}
                      onDragOver={(event) => {
                        if (!drag.accepts(column.name)) return
                        event.preventDefault()
                        drag.hover(column.name)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        drag.drop(column.name)
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return
                        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                        event.preventDefault()
                        onStep(column.name, event.key === 'ArrowUp' ? -1 : 1)
                        setStepped(column.name)
                      }}
                    >
                      <span className="inline-flex cursor-grab text-ink-tertiary" aria-hidden>
                        <svg width="12" height="14" viewBox="0 0 12 16" fill="currentColor">
                          <circle cx="4" cy="4" r="1.2" />
                          <circle cx="8" cy="4" r="1.2" />
                          <circle cx="4" cy="8" r="1.2" />
                          <circle cx="8" cy="8" r="1.2" />
                          <circle cx="4" cy="12" r="1.2" />
                          <circle cx="8" cy="12" r="1.2" />
                        </svg>
                      </span>
                      <span className={`flex min-w-0 items-baseline ${off ? 'text-ink-tertiary' : ''}`}>
                        <Bidi className="min-w-0 truncate">{words}</Bidi>
                        {needed ? (
                          <span className="ms-1.5 shrink-0 text-label text-ink-tertiary">needed</span>
                        ) : (
                          holds(column) && <span className="ms-1.5 shrink-0 text-label text-ink-tertiary">holds a value</span>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={!hideable(column)}
                        aria-label={`${off ? 'Show' : 'Hide'} ${words}`}
                        title={
                          !hideable(column)
                            ? needed
                              ? 'A needed field is always shown'
                              : 'The title is always shown'
                            : off
                              ? 'Hidden: click to show'
                              : 'Shown: click to hide'
                        }
                        className="inline-flex h-7 w-7 items-center justify-center text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35"
                        onClick={() => onHide(column)}
                      >
                        <EyeGlyph off={off} />
                      </button>
                      <span className="flex justify-center">
                        <input
                          type="checkbox"
                          className="accent-[var(--color-ink)]"
                          checked={needed || asked.has(column.name)}
                          disabled={needed}
                          aria-label={`Ask for ${words} on a new entry`}
                          onChange={() => onAsk(column)}
                        />
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline px-3 pt-2 text-label text-ink-tertiary">
            <span className="min-w-0 flex-1">
              Drag a field within its part to move it. A hidden field stays in the table and every tool.
            </span>
            {arranged && (
              <button type="button" className="text-accent hover:underline" onClick={onReset}>
                The declaration’s order
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  )
}

/** What a column is, said when its name is pointed at rather than printed beside every field. */
function describe(column: ColumnDeclaration): string {
  return [
    column.type,
    column.unit === undefined ? '' : ` · ${column.unit}`,
    column.per === undefined ? '' : ` per ${column.per}`,
    column.required ? ' · required' : '',
    column.note === '' ? '' : ` — ${column.note}`,
  ].join('')
}

/**
 * **The control a column's way deserves, where it sits** (M35 U3, D-402).
 * Editing follows from the way: a figure is typed where it stands; a bar, a
 * ring, a quantity in one unit and a relative day are drawn until pressed, and
 * then are their field; a slider drags; a chip or a menu opens the members;
 * buttons, steps and a tick are pressed; a link's name opens its row and the
 * pencil beside it names another.
 *
 * The two types that store as two cells get two controls side by side, named by
 * the same two words the tool takes — `price` beside `price_currency` — so the
 * word a person types here and the word a conversation types are one word.
 *
 * A pick — a menu's word, a button, a row found, a chip — writes as it is
 * picked (`onPick`); everything typed writes when its field is left.
 */
function Control({
  column,
  way,
  part,
  draft,
  units,
  top,
  oneUnit,
  linked,
  today,
  choices,
  labels,
  readOnly,
  marked,
  onChange,
  onPick,
  onEnter,
  onOpen,
}: {
  column: ColumnDeclaration
  way: ShowAs
  part: Part
  draft: RowDraft
  units: UnitTable
  top: number | undefined
  oneUnit: string | undefined
  linked: ReadonlyMap<string, LinkedRow>
  today: string
  choices: readonly LinkChoice[]
  labels: ReadonlyMap<string, string>
  readOnly: boolean
  marked: boolean
  onChange: (key: string, text: string) => void
  onPick: (key: string, text: string) => void
  onEnter: () => void
  onOpen: (format: string, id: string) => void
}) {
  // A way drawn until it is pressed, open on its field.
  const [open, setOpen] = useState(false)
  const value = draft[column.name] ?? ''
  const set = (text: string): void => onChange(column.name, text)
  const pick = (text: string): void => onPick(column.name, text)
  const figure = part === 'figure'
  const big = figure ? `${way === 'large' ? 'text-[28px]' : 'text-[20px]'} font-medium ${marked ? MARKED : ''}` : ''
  const named = (id: string): string =>
    choices.find((each) => each.id === id)?.label ?? labels.get(id) ?? id
  const target = column.target
  const openRow = target === undefined ? undefined : (id: string) => onOpen(target, id)
  const beside =
    column.type === 'money'
      ? draft[currencyKeyOf(column)]
      : column.type === 'quantity'
        ? draft[unitKeyOf(column)]
        : undefined
  const enter = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onEnter()
    }
  }
  const shown = (more: { onPick?: (text: string) => void; onTakeOut?: (id: string) => void } = {}) => (
    <Shown
      column={column}
      way={way}
      value={value}
      beside={beside}
      part={part}
      top={top}
      oneUnit={oneUnit}
      units={units}
      today={today}
      named={named}
      linked={(id) => linked.get(id)}
      marked={marked}
      onOpen={openRow}
      {...more}
    />
  )

  if (way === 'markdown') {
    return <MarkdownField value={value} readOnly={readOnly} label={column.name} onChange={set} />
  }

  // **A file is opened from where it stands** (M37 U6), read-only or not.
  if (column.type === 'file') {
    if (readOnly) return value === '' ? shown() : <FileLink value={value} />
    return (
      <FileField
        label={column.name}
        value={value}
        className={`${SEAMLESS} w-full font-mono text-caption`}
        onChange={set}
        onPick={pick}
      />
    )
  }

  // **A pack's entry is read here and not written** (D-269): every way drawn.
  if (readOnly) return shown()

  // The field a value is typed into, by its type — what a figure is, and what
  // a bar, a ring or a relative day opens to when pressed.
  const typed = (auto: boolean): ReactNode => {
    switch (column.type) {
      case 'money':
        return (
          <span className="flex gap-2" onKeyDown={enter}>
            <input
              className={`${SEAMLESS} ${way === 'large' ? 'w-44' : figure ? 'w-32' : 'w-40'} text-right tabular-nums ${big}`}
              inputMode="decimal"
              aria-label={column.name}
              autoFocus={auto}
              value={value}
              onChange={(event) => set(event.target.value)}
              placeholder="12.90"
            />
            {/* Searched and picked, with each one's sign (M29 F3, D-344). */}
            <CurrencyField
              className={`${SEAMLESS} w-24`}
              value={draft[currencyKeyOf(column)] ?? ''}
              label={currencyKeyOf(column)}
              onChange={(code) => onChange(currencyKeyOf(column), code)}
            />
          </span>
        )
      case 'quantity':
        return (
          <span className="flex gap-1" onKeyDown={enter}>
            <input
              className={`${SEAMLESS} ${figure ? 'w-24' : 'w-40'} text-right tabular-nums ${big}`}
              inputMode="decimal"
              aria-label={column.name}
              autoFocus={auto}
              value={value}
              onChange={(event) => set(event.target.value)}
              placeholder="150"
            />
            {/* **The document's units, not the build's** (D-223). Somebody who
                corrected `tbsp` to 20 ml picks their own answer here. */}
            <ChoiceField
              className={`${SEAMLESS} w-20 text-ink-secondary`}
              filter
              spellCheck={false}
              aria-label={unitKeyOf(column)}
              text={draft[unitKeyOf(column)] ?? ''}
              choices={units.map((unit) => ({ value: unit.symbol, label: unit.symbol }))}
              onText={(text) => onChange(unitKeyOf(column), text)}
              onPick={(choice) => onChange(unitKeyOf(column), choice.value)}
            />
          </span>
        )
      case 'time':
        // **Typed, plainly** (M29 U4, D-335): `9`, `9:30`, `21:00`, `9pm` —
        // and shown back as `09:30` once it is saved.
        return (
          <span onKeyDown={enter}>
            <TimeField label={column.name} value={value} onChange={set} />
          </span>
        )
      case 'date':
      case 'month':
        return (
          <input
            className={`${SEAMLESS} w-44 tabular-nums`}
            type={column.type}
            aria-label={column.name}
            autoFocus={auto}
            value={value}
            onChange={(event) => set(event.target.value)}
            onKeyDown={enter}
            // **The whole field opens the calendar** (M29 F2), empty or filled —
            // not only the small glyph at its end.
            onClick={(event) => {
              try {
                event.currentTarget.showPicker()
              } catch {
                // Not here, or not now; the field still takes a typed date.
              }
            }}
          />
        )
      case 'instant':
        return (
          <input
            className={`${SEAMLESS} w-56 tabular-nums`}
            aria-label={column.name}
            autoFocus={auto}
            spellCheck={false}
            value={value}
            onChange={(event) => set(event.target.value)}
            onKeyDown={enter}
            placeholder="2026-09-23T14:05:00Z"
          />
        )
      default:
        return (
          <span className="flex items-baseline gap-1" onKeyDown={enter}>
            <FigureField
              label={column.name}
              type={column.type}
              value={value}
              placeholder={bounds(column)}
              autoFocus={auto}
              className={`${figure ? 'w-32' : 'w-40'} ${big}`}
              onChange={set}
            />
            {column.unit !== undefined && <span className="text-caption text-ink-secondary">{column.unit}</span>}
          </span>
        )
    }
  }

  // **Drawn until pressed** — a bar, a ring, a quantity in one unit, a day said
  // against today — and then its field, until focus leaves it.
  if (PRESSED_OPEN.has(way)) {
    if (!open) {
      return (
        <button
          type="button"
          aria-label={`${column.name}: change`}
          className="-mx-[7px] flex w-[calc(100%+14px)] min-w-0 border border-transparent px-1.5 text-left hover:border-hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => setOpen(true)}
        >
          {shown()}
        </button>
      )
    }
    return (
      <span
        className="flex"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
        }}
      >
        {typed(true)}
      </span>
    )
  }

  switch (way) {
    case 'line':
    case 'mono':
      // Text, and it wraps: the prose somebody writes about one of these is
      // half the reason the vault this engine came from was worth keeping
      // (D-210). `dir="auto"` because it is as likely to be Hebrew. Mono is
      // the same field in the code face — a reference, a file, a key.
      return (
        <GrowingText
          className={`${SEAMLESS} resize-none ${way === 'mono' ? 'font-mono text-caption' : ''} ${part === 'title' ? 'w-full text-title font-semibold' : part === 'header' ? 'w-48' : 'w-full'}`}
          label={column.name}
          placeholder={part === 'title' ? column.name : ''}
          value={value}
          onChange={set}
          onKeyDown={enter}
        />
      )
    case 'figure':
    case 'large':
    case 'written':
    case 'date':
    case 'month':
    case 'datetime':
    case 'clock':
      return typed(false)
    case 'both':
      return (
        <span className="flex items-baseline gap-2">
          {typed(false)}
          <span className="text-caption text-ink-secondary">{relativeDay(value, today) ?? ''}</span>
        </span>
      )
    case 'slider':
      return <Slider column={column} value={value} onChange={set} />
    case 'menu':
      /* **A handful of words is a menu** (M26 U3) — drawn by the app, not
         the platform's dark one. Nothing is typed into it. */
      return (
        <ChoiceField
          className={`${SEAMLESS} ${part === 'header' ? 'w-36' : 'w-full max-w-sm'}`}
          readOnly
          filter={false}
          aria-label={column.name}
          text={labelOf(menuOf(column), value)}
          choices={menuOf(column)}
          onText={() => undefined}
          onPick={(choice) => pick(choice.value)}
        />
      )
    case 'chip':
      // **The state as its chip, pressed for the members** — the header
      // line's look, and a pick that writes as it is made.
      return (
        <PickMenu label={column.name} value={value} choices={menuOf(column)} tour={`field-${column.name}`} onPick={pick}>
          {value === '' ? <span className="text-ink-tertiary">Empty</span> : <StateChip member={value} />}
        </PickMenu>
      )
    case 'word':
      return (
        <PickMenu label={column.name} value={value} choices={menuOf(column)} onPick={pick}>
          {value === '' ? <span className="text-ink-tertiary">Empty</span> : <span>{value === 'true' ? 'Yes' : 'No'}</span>}
        </PickMenu>
      )
    case 'buttons':
    case 'steps':
    case 'tick':
      // **Pressed where they stand.** A button pressed again goes back to nothing.
      return shown({ onPick: pick })
    case 'name':
    case 'card':
      return (
        <LinkField
          column={column}
          value={value}
          choices={choices}
          named={named}
          card={way === 'card' ? shown() : undefined}
          onPick={pick}
          onOpen={onOpen}
        />
      )
    case 'chips':
      // **Several rows, each by its name** (M27 U2, D-300) — or several of a
      // list, each a word of it (M34 U5, D-398). Each name opens its row.
      return (
        <MembersField
          value={value}
          label={column.name}
          choices={
            column.type === 'enums'
              ? column.values.map((each) => ({ value: each, label: each }))
              : [
                  ...choices.map((each) => ({ value: each.id, label: each.label })),
                  // A member past the list of choices is still called by its name.
                  ...(membersOfDraft(value) ?? [])
                    .filter((id) => !choices.some((each) => each.id === id))
                    .map((id) => ({ value: id, label: named(id) })),
                ]
          }
          onChange={pick}
          onOpen={column.type === 'links' ? openRow : undefined}
        />
      )
    case 'list':
    case 'cards': {
      // **Several rows as a list or as cards**, each with its × and an Add
      // that finds one more by name, the way a link's field does.
      const members = membersOfDraft(value) ?? (value.trim() === '' ? [] : [value])
      return (
        <div className="flex w-full flex-col gap-1.5">
          {members.length > 0 && shown({ onTakeOut: (id) => pick(draftOfMembers(members.filter((each) => each !== id))) })}
          <AddMember
            label={column.name}
            choices={choices.filter((each) => !members.includes(each.id)).map((each) => ({ value: each.id, label: each.label }))}
            onAdd={(id) => {
              if (!members.includes(id)) pick(draftOfMembers([...members, id]))
            }}
          />
        </div>
      )
    }
    default:
      return shown()
  }
}

/**
 * **A row of another format, by its name** — which opens that row in this same
 * view — and a pencil beside it to name another (M35 U2). Shown as a card, the
 * name sits on the row's card with its state and line (M35 U3, D-402). A row to
 * point at is typed and narrowed, not scrolled for: the format it names may
 * have two hundred. What is shown is the row's name; what is kept is its id.
 */
function LinkField({
  column,
  value,
  choices,
  named,
  card,
  onPick,
  onOpen,
}: {
  column: ColumnDeclaration
  value: string
  choices: readonly LinkChoice[]
  named: (id: string) => string
  /** The row as its card, when the link is shown as one. */
  card: ReactNode
  onPick: (text: string) => void
  onOpen: (format: string, id: string) => void
}) {
  const [changing, setChanging] = useState(false)
  const [typed, setTyped] = useState<string | undefined>(undefined)
  const target = column.target
  if (value !== '' && !changing && target !== undefined) {
    const pencil = (
      <IconAction label={`Change ${column.name}`} onClick={() => setChanging(true)}>
        <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      </IconAction>
    )
    if (card !== undefined && card !== null) {
      return (
        <span className="flex w-full min-w-0 items-start gap-1">
          {card}
          {pencil}
        </span>
      )
    }
    return (
      <span className="inline-flex min-h-8 items-center gap-1">
        <button
          type="button"
          className="text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          data-tour={`link-${column.name}`}
          onClick={() => onOpen(target, value)}
        >
          <Bidi>{named(value)}</Bidi>
        </button>
        {pencil}
      </span>
    )
  }
  const all = choices.map((each) => ({ value: each.id, label: each.label }))
  return (
    <ChoiceField
      className={`${SEAMLESS} w-56`}
      filter
      dir="auto"
      autoFocus={changing}
      aria-label={column.name}
      data-tour={`field-${column.name}`}
      placeholder="Type to find one"
      text={typed ?? (value === '' ? '' : named(value))}
      choices={all}
      onText={setTyped}
      onPick={(choice) => {
        setTyped(undefined)
        setChanging(false)
        onPick(choice.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setTyped(undefined)
          setChanging(false)
        }
        if (event.key === 'Enter' && typed !== undefined) {
          event.preventDefault()
          // A name typed whole is that row; anything else is kept as typed,
          // and the write resolves it by name or refuses it, naming it.
          const exact = choices.filter((each) => each.label === typed.trim())
          setTyped(undefined)
          setChanging(false)
          onPick(exact.length === 1 && exact[0] !== undefined ? exact[0].id : typed.trim())
        }
      }}
      onBlur={() => {
        if (typed === undefined) setChanging(false)
      }}
    />
  )
}

/**
 * A time of day, **typed, plainly** (M29 U4, D-335): `9`, `9:30`, `21:00`,
 * `9pm` — and shown back as `09:30` once it is saved. A click opens the
 * platform's clock as well (M29 F2), which writes `HH:MM` into the field.
 */
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (text: string) => void
}) {
  const picker = useRef<PickerHandle>(null)
  // `1430`, `2:30pm` — shown as `14:30` while typed, and that once left (D-344).
  const typed = useTyped('time', value)
  return (
    <span className="relative inline-flex">
      <input
        className={`${SEAMLESS} w-32 tabular-nums`}
        style={typed.style}
        aria-label={label}
        // The demo tour's anchor (M33 U7): `field-end`, as a text field's is.
        data-tour={`field-${label}`}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => {
          const settled = typed.settle(event.target.value)
          if (settled !== event.target.value) onChange(settled)
        }}
        onClick={() => picker.current?.open()}
        placeholder="09:00"
      />
      <TypedHint completion={typed.completion} />
      <NativePicker ref={picker} kind="time" value={value} label={label} onPick={onChange} />
    </span>
  )
}

/**
 * A figure typed into its field — and for a percent, what it will be kept as
 * beside it while it is typed (`87` shows its `%`, `0.87` shows `→ 87%`), and
 * that once the field is left (M29 F3, D-344).
 */
function FigureField({
  label,
  type,
  value,
  placeholder,
  className = 'w-40',
  autoFocus = false,
  onChange,
}: {
  label: string
  type: ColumnDeclaration['type']
  value: string
  placeholder: string
  className?: string
  autoFocus?: boolean
  onChange: (text: string) => void
}) {
  const typed = useTyped(type, value)
  return (
    <span className="relative inline-flex">
      <input
        className={`${SEAMLESS} ${className} text-right tabular-nums`}
        style={typed.style}
        inputMode="decimal"
        aria-label={label}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => {
          const settled = typed.settle(event.target.value)
          if (settled !== event.target.value) onChange(settled)
        }}
        placeholder={placeholder}
      />
      <TypedHint completion={typed.completion} />
    </span>
  )
}

/**
 * A figure between its two declared bounds, dragged — with the figure itself
 * beside it, typed, since a slider is a poor way to say exactly 37.
 */
function Slider({
  column,
  value,
  onChange,
}: {
  column: ColumnDeclaration
  value: string
  onChange: (text: string) => void
}) {
  const minimum = column.minimum ?? 0
  const maximum = column.maximum ?? 100
  const step =
    column.type === 'integer'
      ? 1
      : column.type === 'decimal' && column.scale !== undefined
        ? 10 ** -column.scale
        : column.type === 'percent'
          ? 10 ** -PERCENT_PLACES
          : 'any'
  // A percent's field reads `12.5%` or `0.125`, and the slider wants the
  // figure the engine would keep (D-333, D-344).
  const read = column.type === 'percent' ? readPercent(value) : undefined
  const number = read === undefined ? Number(value) : read.ok ? read.value / 10 ** PERCENT_PLACES : Number.NaN
  return (
    <span className="flex items-center gap-3 py-1">
      <input
        type="range"
        className="w-64 accent-[var(--color-ink)]"
        aria-label={column.name}
        min={minimum}
        max={maximum}
        step={step}
        value={value === '' || !Number.isFinite(number) ? minimum : number}
        // A percent's slider writes its sign: a bare `0.5` is read as a
        // fraction, 50% (D-344), and the slider meant half a percent.
        onChange={(event) => onChange(column.type === 'percent' ? `${event.target.value}%` : event.target.value)}
      />
      <FigureField
        label={`${column.name}, typed`}
        type={column.type}
        value={value}
        placeholder="—"
        className="w-28"
        onChange={onChange}
      />
    </span>
  )
}

/** A textarea as tall as what is in it, so a page of prose is not a page of scrolling boxes. */
function GrowingText({
  className,
  label,
  placeholder,
  value,
  autoFocus = false,
  onChange,
  onBlur,
  onKeyDown,
}: {
  className: string
  label: string
  placeholder: string
  value: string
  autoFocus?: boolean
  onChange: (text: string) => void
  onBlur?: () => void
  onKeyDown?: (event: React.KeyboardEvent) => void
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = area.current
    if (element === null) return
    element.style.height = 'auto'
    element.style.height = `${String(element.scrollHeight + 2)}px`
  }, [value])
  return (
    <textarea
      ref={area}
      className={className}
      rows={1}
      dir="auto"
      aria-label={label}
      // The demo tour's anchor (M33 U6): `field-taken_by`, as a link's is.
      data-tour={`field-${label}`}
      placeholder={placeholder}
      autoFocus={autoFocus}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  )
}

/**
 * A text read as markdown, and written as it.
 *
 * Read until it is pressed, then the text itself until focus leaves — the
 * shape of an `.md` note, which is read far more than it is written.
 */
function MarkdownField({
  value,
  readOnly,
  label,
  onChange,
}: {
  value: string
  readOnly: boolean
  label: string
  onChange: (text: string) => void
}) {
  const [writing, setWriting] = useState(false)
  const blocks = parseMarkdown(value)
  // A pack's entry, or a field put back to nothing by an undo elsewhere.
  useEffect(() => {
    if (readOnly) setWriting(false)
  }, [readOnly])

  if (writing && !readOnly) {
    return (
      <GrowingText
        className={`${SEAMLESS} w-full resize-none font-mono text-caption leading-relaxed`}
        label={label}
        placeholder="Markdown: # a heading, - a list, **bold**"
        value={value}
        autoFocus
        onChange={onChange}
        onBlur={() => setWriting(false)}
      />
    )
  }

  return (
    <div
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      aria-label={readOnly ? undefined : `Write ${label}`}
      className={`rounded-md border border-transparent px-2 py-1 ${readOnly ? '' : 'cursor-text hover:border-hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'}`}
      onClick={() => setWriting(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setWriting(true)
        }
      }}
    >
      {blocks.length === 0 ? (
        <p className="text-ink-tertiary">{readOnly ? '—' : 'Nothing written yet.'}</p>
      ) : (
        <Markdown blocks={blocks} />
      )}
    </div>
  )
}

/** What a bounded number may be, as the placeholder rather than as a warning. */
function bounds(column: ColumnDeclaration): string {
  if (column.minimum !== undefined && column.maximum !== undefined) {
    return `${String(column.minimum)} to ${String(column.maximum)}`
  }
  if (column.minimum !== undefined) return `${String(column.minimum)} or more`
  if (column.maximum !== undefined) return `${String(column.maximum)} or less`
  return '—'
}

/**
 * One stored value as the table prints it.
 *
 * Money keeps its symbol and **a quantity keeps its unit** (D-225): 150 beside
 * 200 where one is grams and the other millilitres is the reading that type
 * exists to prevent, and a column of bare figures is exactly where it would
 * happen.
 */
export function cellText(value: ReadValue): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  // A list's ids; a surface that has the names prints those instead (M27 U2).
  if (isList(value)) return value.join(', ')
  if ('minor' in value) return formatMoney(value)
  return `${String(value.amount)} ${value.unit}`
}

/** An enum's members or yes/no, with a way back to nothing. */
function menuOf(column: ColumnDeclaration): readonly Choice[] {
  const none = { value: '', label: '—' }
  if (column.type === 'boolean') {
    return [none, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
  }
  return [none, ...column.values.map((each) => ({ value: each, label: each }))]
}

/** What a stored value reads as among its choices — itself, if it is none of them. */
function labelOf(choices: readonly Choice[], value: string): string {
  if (value === '') return ''
  return choices.find((each) => each.value === value)?.label ?? value
}
