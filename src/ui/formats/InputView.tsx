import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { dayOfDefault, type InputShape } from '@/domain/format/inputView.ts'
import { withField, type RowDraft } from '@/domain/format/rowDraft.ts'
import type { UnitTable } from '@/domain/format/unit.ts'
import { entryLabel, entryWayOf, type SavedView } from '@/domain/format/view.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField, type Choice } from '@/ui/components/ChoiceField.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { Flip } from '@/ui/motion/Flip.tsx'

import { Field, NO_LINKED, type LinkChoice } from './EntryView.tsx'
import {
  addsAsWords,
  dayWordOf,
  defaultCellRefusal,
  defaultText,
  fieldsRows,
  inputFormOf,
  lackingSentence,
  withAsked,
  withDefault,
  withMoved,
} from './inputForm.ts'
import { Cell } from './ListView.tsx'
import type { LineCell } from './listView.ts'


/** A problem with the row being added: at its field, or about the row when it names none. */
export interface InputProblem {
  readonly column: string | undefined
  readonly reason: string
}

/** What the form's draft is judged to be: its problems, and the write when there are none. */
export interface InputJudged {
  readonly problems: readonly InputProblem[]
  readonly add?: (() => { readonly id: string } | { readonly refusal: string }) | undefined
}

/** A row just added, as the list draws it: its title, its line, and its failed claims. */
export interface InputLine {
  readonly title: string
  readonly cells: readonly LineCell[]
  readonly failed: readonly string[]
}

/** What saving the view writes: its name, what it asks and sets, and whether Add opens it. */
export interface InputSaving {
  readonly name: string
  readonly shape: InputShape
  readonly isDefault: boolean
}

/** The types whose field is narrow: a day, a figure, a yes or no, a member. */
export const NARROW: ReadonlySet<string> = new Set([
  'date',
  'datetime',
  'time',
  'month',
  'number',
  'integer',
  'money',
  'quantity',
  'percent',
  'duration',
  'boolean',
  'enum',
])

/** What can take focus in the form: never the calendar a date field hides, nor a disabled field. */
export const FOCUSABLE =
  'input:not([type="hidden"]):not([aria-hidden="true"]):not([tabindex="-1"]):not([disabled]), textarea:not([disabled])'

/** *needed: ask it or give it a default* — a required column a view would leave empty. */
const NEEDED = 'needed: ask it or give it a default'

/**
 * **An input view** — M55 U3, D-533, D-535, U1's brief
 * (`docs/mockups/m55-u1/brief.md`): a form that stays open. It is where
 * entry/new opens — beside the format's list, at its own address — and it
 * asks its fields in one wrapping row, in its order, with what it sets but
 * does not ask named on the *Adds as* line. **Add writes through the same
 * write entry/new does**, then the fields go back to their defaults, focus
 * goes to the first, and the row joins *Just added* under the form, with an
 * Undo. A refusal is at its field, every problem at once, and nothing is
 * written.
 *
 * **Made in place**: with no view it is a draft — every required column
 * asked, *Fields* open beside it, Save and Cancel in its bar. *Fields* is the
 * entry's list with *Ask* and *Default* in place of *Shown* and *New entry*.
 * Saved, a change there is saved as it is made, unless it leaves a required
 * column neither asked nor set — then it waits at its row until it does.
 */
export function InputView({
  declaration,
  view,
  shape: savedShape,
  name: suggested,
  units,
  links,
  labels,
  today,
  locked,
  list,
  backLabel,
  prefill,
  startsAt,
  judge,
  lineOf,
  undo,
  save,
  linkGone,
  oneOf,
  onBack,
  onOpen,
}: {
  declaration: FormatDeclaration
  /** The saved input view, or nothing for a new one being made. */
  view: SavedView | undefined
  /** What it asks and sets: the saved view's, or a new one's to start from. */
  shape: InputShape
  /** A new one's name to start from — the format's title, or *Card charge 2*. */
  name: string
  units: UnitTable
  /** The rows each link may name, by the format it targets. */
  links: ReadonlyMap<string, readonly LinkChoice[]>
  labels: ReadonlyMap<string, string>
  today: string
  /** Why no row is written here — a pack's format, the conversation's copy — or nothing. */
  locked: string | undefined
  list: { readonly hidden: boolean; readonly onToggle: () => void } | undefined
  backLabel: string
  /** What quick add had typed when it opened the form, kept for the first row only. */
  prefill: RowDraft | undefined
  /** A new row's draft under this shape: its defaults, a date's word worked out today. */
  startsAt: (shape: InputShape) => RowDraft
  judge: (draft: RowDraft, startsAt: RowDraft) => InputJudged
  lineOf: (id: string) => InputLine | undefined
  /** Delete a row just added, or say why not. */
  undo: (id: string) => string | undefined
  /** Save the view — over the one called `was` — or say why not. */
  save: (next: InputSaving, was: string | undefined) => string | undefined
  /** Whether a link's default names a row that is gone. */
  linkGone: (column: ColumnDeclaration, text: string) => boolean
  /** A link target's one, as *No account is called "Visa"* says it. */
  oneOf: (target: string) => string
  onBack: () => void
  onOpen: (id: string) => void
}) {
  const revision = useDocumentStore((state) => state.revision)
  const writable = locked === undefined
  // A saved view's Fields change waits here while it leaves a required column empty.
  const [pending, setPending] = useState<InputShape | undefined>(view === undefined ? savedShape : undefined)
  const shape = pending ?? savedShape
  const shapeKey = JSON.stringify(shape)
  const form = inputFormOf(declaration, shape)
  const [name, setName] = useState(suggested)
  const [useForAdd, setUseForAdd] = useState(view?.isDefault === true)
  const [fieldsOpen, setFieldsOpen] = useState(view === undefined)
  const [draft, setDraft] = useState<RowDraft>(() => ({ ...startsAt(shape), ...prefill }))
  const [tried, setTried] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saveRefusal, setSaveRefusal] = useState<string | undefined>(undefined)
  // The rows added from here in this visit, newest first; leaving empties it.
  const [added, setAdded] = useState<readonly string[]>([])
  const [kept, setKept] = useState<Readonly<Record<string, string>>>({})
  const [round, setRound] = useState(0)
  const [focusProblem, setFocusProblem] = useState(false)
  const fields = useRef<HTMLDivElement>(null)

  // What it asks or sets changed: the fields start again from the new defaults.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setDraft(startsAt(shape))
    setTried(false)
  }, [shapeKey])
  useEffect(() => {
    if (view !== undefined) setUseForAdd(view.isDefault === true)
  }, [view?.isDefault])
  // **Focus goes to the first field** on opening and after every Add (D-533).
  useEffect(() => {
    fields.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [round])
  useEffect(() => {
    if (!focusProblem) return
    setFocusProblem(false)
    fields.current?.querySelector('.fc-problem')?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  })

  const judged = useMemo(
    () => (tried ? judge(draft, startsAt(shape)) : undefined),
    // `revision` is the dependency that matters: a write elsewhere may settle a link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tried, draft, shapeKey, revision],
  )
  const problems = judged?.problems ?? []
  const drawn = view === undefined ? form.asked : [...form.asked, ...form.lacking]
  const atField = (column: string): string | undefined => problems.find((each) => each.column === column)?.reason
  const fieldProblems = problems.filter((each) => each.column !== undefined && drawn.some((column) => column.name === each.column)).length
  const aboutRow = problems.filter((each) => each.column === undefined || !drawn.some((column) => column.name === each.column))

  /** Add: every problem at once, or the row written and the form ready for the next. */
  const add = (): void => {
    if (!writable || view === undefined) return
    setTried(true)
    const verdict = judge(draft, startsAt(shape))
    if (verdict.problems.length > 0 || verdict.add === undefined) {
      setFocusProblem(true)
      return
    }
    const done = verdict.add()
    if ('refusal' in done) {
      setFailure(done.refusal)
      return
    }
    setAdded((ids) => [done.id, ...ids])
    setDraft(startsAt(shape))
    setTried(false)
    setFailure(undefined)
    setRound((at) => at + 1)
  }

  /** A change to what the view asks or sets: kept in the draft, saved at once on a saved view. */
  const change = (next: InputShape): void => {
    setSaveRefusal(undefined)
    if (view === undefined) {
      setPending(next)
      return
    }
    if (rowRefusals(declaration, next).size > 0) {
      setPending(next)
      return
    }
    const refused = save({ name: view.name, shape: next, isDefault: view.isDefault === true }, view.name)
    if (refused === undefined) setPending(undefined)
    else {
      setPending(next)
      setSaveRefusal(refused)
    }
  }

  const saveDraft = (): void => {
    const refusals = rowRefusals(declaration, shape)
    if (refusals.size > 0) {
      setSaveRefusal(notSaved(declaration, refusals))
      setFieldsOpen(true)
      return
    }
    setSaveRefusal(save({ name, shape, isDefault: useForAdd }, undefined))
  }

  const toggleUseForAdd = (on: boolean): void => {
    setUseForAdd(on)
    if (view === undefined) return
    const refused = save({ name: view.name, shape: savedShape, isDefault: on }, view.name)
    setSaveRefusal(refused)
    if (refused !== undefined) setUseForAdd(!on)
  }

  const undoOne = (id: string): void => {
    const refused = undo(id)
    if (refused === undefined) setAdded((ids) => ids.filter((each) => each !== id))
    else setKept((was) => ({ ...was, [id]: refused }))
  }

  const one = declaration.title.toLowerCase()
  const field = (column: ColumnDeclaration) => {
    const way = entryWayOf(column, undefined, false)
    const word = dayWordOf(column, shape.defaults[column.name])
    const showsWord = word !== undefined && draft[column.name] === dayOfDefault(word, today)
    return (
      <div key={column.name} className={`flex items-end gap-2 ${NARROW.has(column.type) ? 'w-44' : 'w-72'} max-w-full`}>
        <div className="min-w-0 flex-1">
          <Field
            column={column}
            part="text"
            way={way === 'markdown' ? 'line' : way}
            offered={[way]}
            one={one}
            draft={draft}
            units={units}
            top={undefined}
            oneUnit={undefined}
            linked={NO_LINKED}
            today={today}
            choices={column.target === undefined ? [] : (links.get(column.target) ?? [])}
            labels={labels}
            readOnly={!writable}
            fresh
            hint={false}
            marked={false}
            refused={atField(column.name)}
            mover={undefined}
            dimmed={false}
            onChange={(key, text) => {
              setFailure(undefined)
              setDraft((was) => withField(was, key, text))
            }}
            onPick={(key, text) => setDraft((was) => withField(was, key, text))}
            onFocus={() => undefined}
            onLeave={() => undefined}
            onSubmit={view === undefined ? undefined : add}
            onRevert={() => undefined}
            onChoose={() => undefined}
            onOpen={() => undefined}
          />
        </div>
        {/* A day's word after the day it names: `2026-11-03 · today` (U1 §5). */}
        {showsWord && <span className="pb-1.5 text-caption whitespace-nowrap text-ink-secondary">· {word}</span>}
      </div>
    )
  }

  const addsAs =
    form.sets.length === 0 ? null : (
      <span className="min-w-0 text-caption text-ink-secondary" aria-label={`Adds as ${addsAsWords(form.sets)}`}>
        Adds as{' '}
        {form.sets.map((each, at) => {
          const gone = each.column.type === 'link' && each.column.target !== undefined && linkGone(each.column, each.text)
          return (
            <Fragment key={each.column.name}>
              {at > 0 && ' · '}
              <Bidi>{entryLabel(each.column)}</Bidi>{' '}
              {gone ? (
                <>
                  <s className="text-negative">
                    <Bidi>{each.text}</Bidi>
                  </s>{' '}
                  <span className="text-negative">
                    No <Bidi>{oneOf(each.column.target ?? '')}</Bidi> is called “<Bidi>{each.text}</Bidi>” now
                  </span>
                </>
              ) : (
                <span className="text-ink">
                  <Bidi>{each.text}</Bidi>
                </span>
              )}
            </Fragment>
          )
        })}
      </span>
    )

  const shown = added.flatMap((id) => {
    const line = lineOf(id)
    return line === undefined ? [] : [{ id, line }]
  })
  // Keyed by what a row is called, never its id (the rule), made unique.
  const keyed = shown.map((each, at) => ({
    ...each,
    key: `${each.line.title}#${String(shown.slice(at + 1).filter((other) => other.line.title === each.line.title).length)}`,
  }))

  return (
    <div
      className="fc-view-enter flex h-full flex-col"
      onKeyDown={(event) => {
        // Escape discards a new one (U1 §6); an open list or menu took it first.
        if (event.key === 'Escape' && view === undefined && !event.defaultPrevented) {
          event.preventDefault()
          onBack()
        }
      }}
    >
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-hairline px-6 py-1.5">
        {list !== undefined && (
          <button
            type="button"
            onClick={list.onToggle}
            aria-pressed={!list.hidden}
            aria-label={list.hidden ? 'Show the list' : 'Hide the list'}
            title={list.hidden ? 'Show the list' : 'Hide the list'}
            className={`-ms-2 hidden h-7 w-7 items-center justify-center text-ink-secondary hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:inline-flex ${
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
          ← <Bidi>{backLabel}</Bidi>
        </button>
        {view === undefined ? (
          <label className="flex items-center gap-2">
            <span className="fc-label text-ink-secondary">Name</span>
            <input
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value)
                setSaveRefusal(undefined)
              }}
              className="h-7 w-56 border border-hairline-strong bg-background px-2 text-body text-ink outline-none focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            />
          </label>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="font-medium">
              <Bidi>{view.name}</Bidi>
            </span>
            {view.isDefault === true && <span className="text-caption text-ink-secondary">Add</span>}
          </span>
        )}
        {locked !== undefined && <span className="max-w-prose text-caption text-ink-secondary">{locked}</span>}
        {writable && (
          <span className="ms-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-caption text-ink-secondary">
              <input
                type="checkbox"
                className="accent-[var(--color-ink)]"
                checked={useForAdd}
                onChange={(event) => toggleUseForAdd(event.target.checked)}
              />
              Use for Add
            </label>
            <button
              type="button"
              aria-label="Fields: ask, default, order"
              title="Fields: ask, default, order"
              aria-expanded={fieldsOpen}
              onClick={() => setFieldsOpen(!fieldsOpen)}
              className={`fc-icon-action ${fieldsOpen ? 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]' : ''}`}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path d="M2 4h8M2 8h12M2 12h6" />
                <circle cx="12" cy="4" r="1.5" />
                <circle cx="10" cy="12" r="1.5" />
              </svg>
            </button>
          </span>
        )}
      </div>

      <div className="@container min-h-0 flex-1 overflow-auto">
        {/* Fields beside the form where the page is wide enough, under it where not. */}
        <div className={`grid items-start ${fieldsOpen && writable ? '@3xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
          <div className="mx-auto flex w-full max-w-[1120px] min-w-0 flex-col gap-7 px-6 pt-7 pb-16">
            <div className="fc-label">
              <Bidi>{declaration.title}</Bidi>
            </div>
            {view !== undefined &&
              form.lacking.map((column) => (
                <p key={column.name} className="flex flex-wrap items-baseline gap-x-2 text-caption text-ink-secondary" role="note">
                  <span>
                    <Bidi>{lackingSentence(declaration, column)}</Bidi>
                  </span>
                  {writable && (
                    <button
                      type="button"
                      className="text-accent hover:underline hover:underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      onClick={() => change(withAsked(shape, column.name, true))}
                    >
                      Ask it here
                    </button>
                  )}
                </p>
              ))}
            <div
              ref={fields}
              role="group"
              aria-label={view === undefined ? 'The fields it asks' : `Add a ${one}`}
              className="flex max-w-[700px] flex-wrap items-start gap-x-6 gap-y-4"
              onKeyDown={(event) => {
                // **Enter adds** from a one-line field, Ctrl+Enter from any (U1 §6):
                // what a field or an open list took first is theirs.
                if (event.key !== 'Enter' || event.defaultPrevented || event.shiftKey || event.altKey || view === undefined) return
                const target = event.target
                if (target instanceof HTMLElement && target.closest('[data-new-link]') !== null) return
                const oneLine = target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type)
                if (!oneLine && !(event.ctrlKey || event.metaKey)) return
                event.preventDefault()
                add()
              }}
            >
              {drawn.length === 0 ? (
                <p className="text-ink-secondary">It asks nothing yet. Tick Ask on a field in Fields.</p>
              ) : (
                drawn.map(field)
              )}
            </div>

            {keyed.length > 0 && (
              <section aria-label="Just added" className="flex max-w-[860px] flex-col">
                <h2 className="fc-label pb-2">Just added</h2>
                <Flip as="div" role="list" flipKey={keyed.map((each) => each.key).join('|')}>
                  {keyed.map(({ id, line, key }) => (
                    <div
                      key={key}
                      data-motion-key={key}
                      role="listitem"
                      className="flex min-h-10 flex-wrap items-center gap-x-3 border-t border-hairline px-1 hover:bg-surface"
                    >
                      <button
                        type="button"
                        onClick={() => onOpen(id)}
                        className="flex min-w-0 flex-1 text-start decoration-hairline-strong underline-offset-[3px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <Bidi className="min-w-0 truncate">{line.title}</Bidi>
                      </button>
                      {line.failed.map((claim) => (
                        <span key={claim} className="fc-state !text-negative" title={`${claim} failed`}>
                          failed
                        </span>
                      ))}
                      <span className="flex flex-none items-center gap-4 text-caption text-ink-secondary">
                        {line.cells.map((cell) => (
                          <Cell key={cell.column} cell={cell} />
                        ))}
                      </span>
                      {kept[id] !== undefined && (
                        <span className="text-caption text-negative" role="alert">
                          {kept[id]}
                        </span>
                      )}
                      {writable && (
                        <IconAction label={`Undo adding ${line.title}`} onClick={() => undoOne(id)}>
                          <path d="M7.5 4.5 3.75 8.25 7.5 12" />
                          <path d="M3.75 8.25h10.5a5.25 5.25 0 0 1 0 10.5H9" />
                        </IconAction>
                      )}
                    </div>
                  ))}
                </Flip>
              </section>
            )}
          </div>

          {fieldsOpen && writable && (
            <InputFields declaration={declaration} shape={shape} links={links} onChange={change} />
          )}
        </div>
      </div>

      {(writable || addsAs !== null) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline bg-elevated px-6 py-2.5">
          {writable && view !== undefined && (
            <Button variant="primary" icon="add" onClick={add}>
              Add
            </Button>
          )}
          {writable && view === undefined && (
            <>
              <Button variant="primary" icon="write" onClick={saveDraft}>
                Save
              </Button>
              <Button variant="ghost" onClick={onBack}>
                Cancel
              </Button>
            </>
          )}
          {addsAs}
          {saveRefusal !== undefined && (
            <span className="text-caption text-negative" role="alert">
              {saveRefusal}
            </span>
          )}
          {(failure !== undefined || problems.length > 0) && (
            <span className="text-caption text-negative" role="alert">
              {[
                ...(fieldProblems === 0
                  ? []
                  : [`Not added: ${fieldProblems === 1 ? 'one field to put right' : `${String(fieldProblems)} fields to put right`}.`]),
                ...aboutRow.map((each) => each.reason),
                ...(failure === undefined ? [] : [failure]),
              ].join(' ')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** Each column whose row in Fields is refused, and why: a required one left empty, a default it cannot take. */
export function rowRefusals(declaration: FormatDeclaration, shape: InputShape): ReadonlyMap<string, string> {
  const refused = new Map<string, string>()
  for (const column of declaration.columns) {
    const held = defaultText(shape.defaults[column.name])
    const refusal = held === undefined ? undefined : defaultCellRefusal(column, held)
    if (refusal !== undefined) refused.set(column.name, refusal)
    else if (column.required && !shape.fields.includes(column.name) && held === undefined) refused.set(column.name, NEEDED)
  }
  return refused
}

/** Save refused, naming each row: *Not saved: amount needs asking or a default.* */
function notSaved(declaration: FormatDeclaration, refusals: ReadonlyMap<string, string>): string {
  const words = (name: string): string => {
    const column = declaration.columns.find((each) => each.name === name)
    return column === undefined ? name : entryLabel(column)
  }
  const needed = [...refusals].filter(([, why]) => why === NEEDED).map(([name]) => words(name))
  const wrong = [...refusals].filter(([, why]) => why !== NEEDED).map(([name]) => words(name))
  return [
    'Not saved:',
    ...(needed.length === 0 ? [] : [`${needed.join(', ')} ${needed.length === 1 ? 'needs' : 'need'} asking or a default.`]),
    ...(wrong.length === 0 ? [] : [`${wrong.join(', ')}: put the default right at its row.`]),
  ].join(' ')
}

/**
 * **Fields, for an input view** (U1 §6): the entry's Fields list with *Ask*
 * and *Default* in place of *Shown* and *New entry*. The asked rows come
 * first, in the order the form asks them, and are dragged by the grip or
 * moved a step with Alt+Up and Alt+Down; the rest follow in the format's order.
 */
export function InputFields({
  declaration,
  shape,
  links,
  onChange,
}: {
  declaration: FormatDeclaration
  shape: InputShape
  links: ReadonlyMap<string, readonly LinkChoice[]>
  onChange: (next: InputShape) => void
}) {
  const [dragging, setDragging] = useState<string | undefined>(undefined)
  const [over, setOver] = useState<string | undefined>(undefined)
  const [stepped, setStepped] = useState<string | undefined>(undefined)
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    if (stepped === undefined) return
    box.current?.querySelector<HTMLElement>(`[data-field-row="${CSS.escape(stepped)}"]`)?.focus()
    setStepped(undefined)
  })
  const refusals = rowRefusals(declaration, shape)
  const grid = 'grid grid-cols-[20px_minmax(0,1fr)_36px_128px] items-center gap-1.5 px-2.5'
  return (
    <aside
      ref={box}
      aria-label="Fields"
      className="fc-pop-enter border-t border-hairline px-3 pt-5 pb-8 @3xl:sticky @3xl:top-0 @3xl:border-t-0 @3xl:border-s"
    >
      <div className={`${grid} h-6 text-label text-ink-secondary uppercase`} aria-hidden>
        <span />
        <span>Field</span>
        <span className="text-center">Ask</span>
        <span>Default</span>
      </div>
      {fieldsRows(declaration, shape).map((column) => {
        const words = entryLabel(column)
        const asked = shape.fields.indexOf(column.name)
        const held = defaultText(shape.defaults[column.name]) ?? ''
        const refusal = refusals.get(column.name)
        const choices = choicesOf(column, links)
        return (
          <div key={column.name}>
            <div
              data-field-row={column.name}
              draggable={asked >= 0}
              tabIndex={asked >= 0 ? 0 : -1}
              aria-label={asked >= 0 ? `${words}, Alt+Up or Alt+Down moves it` : words}
              className={`${grid} relative h-8 text-body hover:bg-surface focus-visible:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                over === column.name && dragging !== undefined && asked >= 0 ? 'shadow-[inset_0_2px_0_var(--color-accent)]' : ''
              } ${dragging === column.name ? 'opacity-40' : ''}`}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', column.name)
                setDragging(column.name)
              }}
              onDragEnd={() => {
                setDragging(undefined)
                setOver(undefined)
              }}
              onDragOver={(event) => {
                if (dragging === undefined || asked < 0) return
                event.preventDefault()
                setOver(column.name)
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragging !== undefined && asked >= 0) onChange(withMoved(shape, dragging, asked))
                setDragging(undefined)
                setOver(undefined)
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || asked < 0) return
                if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                event.preventDefault()
                onChange(withMoved(shape, column.name, asked + (event.key === 'ArrowUp' ? -1 : 1)))
                setStepped(column.name)
              }}
            >
              <span className={`inline-flex text-ink-tertiary ${asked >= 0 ? 'cursor-grab' : 'invisible'}`} aria-hidden>
                <svg width="12" height="14" viewBox="0 0 12 16" fill="currentColor">
                  <circle cx="4" cy="4" r="1.2" />
                  <circle cx="8" cy="4" r="1.2" />
                  <circle cx="4" cy="8" r="1.2" />
                  <circle cx="8" cy="8" r="1.2" />
                  <circle cx="4" cy="12" r="1.2" />
                  <circle cx="8" cy="12" r="1.2" />
                </svg>
              </span>
              <span className={`flex min-w-0 items-baseline ${asked < 0 ? 'text-ink-secondary' : ''}`}>
                <Bidi className="min-w-0 truncate">{words}</Bidi>
                {column.required && <span className="ms-1.5 shrink-0 text-label text-ink-secondary">needed</span>}
              </span>
              <span className="flex justify-center">
                <input
                  type="checkbox"
                  className="accent-[var(--color-ink)]"
                  checked={asked >= 0}
                  aria-label={`Ask ${words}`}
                  onChange={() => onChange(withAsked(shape, column.name, asked < 0))}
                />
              </span>
              <DefaultCell
                key={held}
                words={words}
                held={held}
                choices={choices}
                refused={refusal !== undefined && refusal !== NEEDED}
                onSet={(text) => onChange(withDefault(shape, column.name, text))}
              />
            </div>
            {refusal !== undefined && (
              <p className="px-2.5 pb-1.5 ps-[34px] text-caption text-negative" role="alert">
                {refusal}
              </p>
            )}
          </div>
        )
      })}
      <p className="mt-1.5 border-t border-hairline px-3 pt-2 text-label text-ink-secondary">
        Drag an asked field to move it. A default set but not asked is on the Adds as line.
      </p>
    </aside>
  )
}

/** The choices a default cell offers: a member, a link's row by its name, yes or no — or nothing, where it is typed. */
export function choicesOf(column: ColumnDeclaration, links: ReadonlyMap<string, readonly LinkChoice[]>): readonly Choice[] | undefined {
  if (column.type === 'enum') return (column.values ?? []).map((member) => ({ value: member, label: member }))
  if (column.type === 'boolean') return [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]
  if (column.type === 'link' && column.target !== undefined) {
    return (links.get(column.target) ?? []).map((each) => ({ value: each.label, label: each.label, detail: each.title, search: each.title }))
  }
  return undefined
}

/** One default, typed as its field is: written when it is left, Enter or a pick. */
function DefaultCell({
  words,
  held,
  choices,
  refused,
  onSet,
}: {
  words: string
  held: string
  choices: readonly Choice[] | undefined
  refused: boolean
  onSet: (text: string) => void
}) {
  const [typed, setTyped] = useState(held)
  const look = `h-7 w-full min-w-0 border bg-background px-2 text-body text-ink outline-none focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
    refused ? 'border-negative' : 'border-hairline-strong'
  }`
  const commit = (text: string): void => {
    if (text.trim() !== held) onSet(text)
  }
  if (choices !== undefined) {
    return (
      <ChoiceField
        text={typed}
        choices={choices}
        filter
        onText={setTyped}
        onPick={(choice) => {
          setTyped(choice.value)
          onSet(choice.value)
        }}
        onBlur={() => commit(typed)}
        aria-label={`Default for ${words}`}
        aria-invalid={refused || undefined}
        className={look}
      />
    )
  }
  return (
    <input
      value={typed}
      onChange={(event) => setTyped(event.target.value)}
      onBlur={() => commit(typed)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit(typed)
        }
      }}
      aria-label={`Default for ${words}`}
      aria-invalid={refused || undefined}
      className={look}
    />
  )
}
