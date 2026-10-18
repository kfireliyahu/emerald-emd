import { useEffect, useMemo, useRef, useState } from 'react'

import { createCategory, type Category, type CategoryKind } from '@/data/repositories/categoryRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { inlineCategory, offersCreate, twinOf } from '@/ui/categories/inlineCreate.ts'
import { ParentPicker } from '@/ui/categories/ParentPicker.tsx'
import { eligibleParents } from '@/ui/categories/parentFilter.ts'
import { resolvePalette, type CategoryPalette } from '@/ui/charts/categoryPalette.ts'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { useDismiss } from '@/ui/components/useDismiss.ts'

/**
 * Pick a category — **or make the one you meant** (D-158). Search, arrow keys,
 * Enter to choose, Escape to close.
 *
 * docs/f02 is explicit that this component gets used dozens of times in one
 * import session and must be fast and keyboard-friendly, so it is a combobox
 * rather than a `<select>`: a native select cannot filter, and scrolling forty
 * categories with the mouse for every row is the difference between
 * categorizing a statement and giving up half way.
 *
 * **It writes, which no other component in this folder does.** F02 has said
 * "create-new inline" since M1, and the reason it was never built is that it
 * looks like a prop — and a prop is nine call sites, nine chances to leave it
 * off, and an offer that appears on some rows and not others. The offer is only
 * worth anything if it is always there, so the picker takes `mutate` itself and
 * not one call site changed.
 *
 * **The default is stated, not guessed.** Top level and `expense` are what the
 * form opens on, both as controls you can change before pressing Create, and
 * the kind control disappears the moment a parent is chosen — a subcategory
 * inherits its parent's kind inside `createCategory`, and showing a control
 * that will be overruled is worse than showing none. The parent is any
 * category with room under it, three levels deep (M28 F29).
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  label,
  placeholder = 'Uncategorized',
  outlined = false,
  tour,
}: {
  categories: readonly Category[]
  value: string | undefined
  onChange: (categoryId: string | undefined) => void
  label: string
  /** What the button says while nothing is chosen. */
  placeholder?: string
  /** A bordered button, for a row where the category is the control (M28 F3). */
  outlined?: boolean
  /** The button's `data-tour` anchor, for the demo's tours (M33 U5). */
  tour?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  /** The create form, once asked for. `undefined` while the list is showing. */
  const [draft, setDraft] = useState<Draft | undefined>()
  const [problem, setProblem] = useState<string | undefined>()

  const mutate = useDocumentStore((state) => state.mutate)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The same resolution the charts use, worked out here rather than passed in —
  // for D-158's reason exactly: a prop is nine call sites and nine chances for
  // the picker's dot and the donut's wedge to disagree.
  const palette = useMemo(() => resolvePalette(categories), [categories])

  const wanted = search.trim()

  const matches = useMemo(() => {
    const needle = wanted.toLocaleLowerCase()
    if (needle === '') return categories
    return categories.filter((category) => category.path.toLocaleLowerCase().includes(needle))
  }, [categories, wanted])

  const canCreate = useMemo(() => offersCreate(categories, wanted), [categories, wanted])
  // Nothing typed yet: the same row says **+ New…** and opens the form on an
  // empty name (M31 U6), so making one is never something a person has to know to type for.
  const createRow = canCreate || wanted === ''

  useEffect(() => {
    setHighlighted(0)
  }, [search])

  // Also when the create form closes: cancelling out of it and finding the
  // keyboard nowhere is a dead end in the one component that has to work
  // without a mouse.
  useEffect(() => {
    if (open && draft === undefined) inputRef.current?.focus()
  }, [open, draft])

  // Close on a press anywhere else — without this the list stays open behind
  // the next row the user clicks, which in a long table is maddening — and on
  // Escape from anywhere (M45 F1). The search input and the create form keep
  // their own Escape: the first closes, the second goes back to the list.
  const dismissKey = useDismiss(open, containerRef, () => close())

  const close = (): void => {
    setOpen(false)
    setSearch('')
    setDraft(undefined)
    setProblem(undefined)
  }

  const choose = (categoryId: string | undefined): void => {
    onChange(categoryId)
    close()
  }

  /** Open the form on the name that was typed, at the stated default. */
  const startCreating = (): void => {
    setProblem(undefined)
    setDraft({ name: wanted, parentId: '', kind: 'EXPENSE' })
  }

  const create = (): void => {
    if (draft === undefined) return
    const name = draft.name.trim()
    if (name === '') return

    const parentId = draft.parentId === '' ? undefined : draft.parentId
    // Not an error and not a second copy: the one they meant already exists, so
    // pick it. `createCategory` would happily make the twin.
    const twin = twinOf(categories, name, parentId)
    if (twin !== undefined) {
      choose(twin.id)
      return
    }

    let created: string | undefined
    try {
      mutate((database) => {
        created = createCategory(database, inlineCategory(draft), Date.now())
      })
    } catch (error) {
      // A refusal is information, the way it is on the categories screen — and
      // this picker is inside a table row, where a thrown error is a blank
      // screen behind the boundary (D-116).
      setProblem(error instanceof Error ? error.message : String(error))
      return
    }
    if (created !== undefined) choose(created)
  }

  // The create row is the last row of the list, so it is one more index rather
  // than a special case in the movement.
  const rows = matches.length + (createRow ? 1 : 0)

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((current) => Math.min(current + 1, rows - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (createRow && highlighted === matches.length) {
        startCreating()
        return
      }
      const picked = matches[highlighted]
      if (picked !== undefined) choose(picked.id)
    }
  }

  const current = categories.find((category) => category.id === value)
  const parents = useMemo(() => eligibleParents(categories), [categories])

  // `max-w-full` on the root and the button, so a long name ellipsizes inside
  // the cell it sits in rather than running over the rest of the row (M28
  // F17): an inline-block is as wide as its text otherwise, whatever the cell.
  return (
    <div ref={containerRef} className="relative inline-block max-w-full" onKeyDown={dismissKey}>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        data-tour={tour}
        // The full name on hover, because the cell may only have room for half of it.
        title={
          current === undefined
            ? outlined
              ? 'Change the category (C)'
              : undefined
            : outlined
              ? `${current.path} · change the category (C)`
              : current.path
        }
        className={`group inline-flex max-w-full items-center gap-1.5 text-left transition-colors duration-[var(--duration-micro)] hover:bg-surface ${
          outlined ? 'border border-hairline-strong px-1.5 py-0.5 hover:border-accent' : 'rounded-md px-2 py-0.5'
        } ${current === undefined ? 'text-ink-tertiary' : 'text-ink'}`}
      >
          <>
        {/* Text with a small dot, no pill and no border (docs/11). The dot is
            hollow until a category is chosen, and once one is it wears that
            category's colour — the same hue the donut draws it in — so the
            picker and the chart agree. An icon, where the category has one,
            stands in for the dot rather than sitting beside it: two marks for
            one category is one mark too many at this size. */}
        <Mark category={current} palette={palette} />
        {/* The ellipsis is on the isolated span itself: inside an LTR span
            that truncates, a Hebrew name would lose its start, not its end. */}
        {current === undefined ? (
          <span className="min-w-0 truncate">{placeholder}</span>
        ) : (
          <Bidi className="min-w-0 truncate">{current.path}</Bidi>
        )}
          </>
      </button>

      {open && (
        <div className={`fc-pop-enter absolute z-40 mt-1 w-72 rounded-lg border border-hairline bg-elevated shadow-pop ${outlined ? 'left-0' : ''}`}>
          {draft === undefined ? (
            <>
              <input
                ref={inputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search categories…"
                aria-label="Search categories"
                className="w-full rounded-t-lg border-b border-hairline bg-elevated px-3 py-2 outline-none"
              />

              <ul role="listbox" className="max-h-64 overflow-auto py-1">
                {value !== undefined && (
                  <Option onSelect={() => choose(undefined)} highlighted={false}>
                    {/* The hollow mark, because that is the state this sets. */}
                    <Mark category={undefined} palette={palette} />
                    <span className="text-ink-tertiary">Clear category</span>
                  </Option>
                )}

                {matches.map((category, index) => (
                  <Option
                    key={category.id}
                    onSelect={() => choose(category.id)}
                    highlighted={index === highlighted}
                    selected={category.id === value}
                    title={category.path}
                  >
                    <Mark category={category} palette={palette} />
                    <Bidi className="min-w-0 truncate">{category.path}</Bidi>
                  </Option>
                ))}

                {/* Last, and separated: it is the answer when nothing above is,
                    and it must not be the thing the hand lands on by accident
                    half way down a list of forty. */}
                {createRow && (
                  <Option
                    onSelect={startCreating}
                    highlighted={highlighted === matches.length}
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full border border-dashed border-accent"
                    />
                    {canCreate ? (
                      <>
                        <span className="min-w-0 truncate">
                          Create “<Bidi className="text-ink">{wanted}</Bidi>”
                        </span>
                        <span className="ml-auto shrink-0 text-caption text-ink-tertiary">new</span>
                      </>
                    ) : (
                      <span className="min-w-0 truncate font-medium text-accent">+ New…</span>
                    )}
                  </Option>
                )}
              </ul>
            </>
          ) : (
            <CreateForm
              draft={draft}
              parents={parents}
              problem={problem}
              onChange={setDraft}
              onCancel={() => {
                setDraft(undefined)
                setProblem(undefined)
              }}
              onCreate={create}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** What the create form holds. `parentId` is `''` for the top level, as a select's value must be. */
interface Draft {
  readonly name: string
  readonly parentId: string
  readonly kind: CategoryKind
}

/**
 * Name, parent and kind, in the popover the list was in.
 *
 * The same fields the categories screen's own form has, and in the same
 * order, because they are the same operation and a person who has used one
 * should recognise the other. The difference is only where it happens: here it
 * happens on the row you were standing on, and the category it makes is chosen
 * for that row the moment it exists.
 */
function CreateForm({
  draft,
  parents,
  problem,
  onChange,
  onCancel,
  onCreate,
}: {
  draft: Draft
  parents: readonly Category[]
  problem: string | undefined
  onChange: (next: Draft) => void
  onCancel: () => void
  onCreate: () => void
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const parent = parents.find((candidate) => candidate.id === draft.parentId)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onCreate()
      }}
      // Enter is handled here rather than left to the browser's implicit
      // submission, and Escape goes back to the list rather than out of the
      // picker. Both because of where this form is: a popover inside a table
      // row that has its own keyboard, on a screen that has another one. A
      // create form whose only Enter is the implicit one works until the day
      // something above it decides what Enter means.
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
          return
        }
        // Not on a button: Enter on *Cancel* means cancel.
        if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
          event.preventDefault()
          event.stopPropagation()
          onCreate()
        }
      }}
      className="fc-view-enter flex flex-col gap-2 p-3"
    >
      <input
        ref={nameRef}
        value={draft.name}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
        aria-label="New category name"
        className={`${FIELD} w-full`}
      />

      {/* The categories screen's own parent search (M28 F9), so the two forms
          that make a category look for its parent the same way (M28 F17). */}
      <ParentPicker
        parents={parents}
        value={draft.parentId}
        onChange={(parentId) => onChange({ ...draft, parentId })}
        fill
      />

      {parent === undefined ? (
        <select
          value={draft.kind}
          onChange={(event) => onChange({ ...draft, kind: event.target.value as CategoryKind })}
          aria-label="Category kind"
          className={`${SELECT} w-full`}
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {option.toLowerCase().replace('_', ' ')}
            </option>
          ))}
        </select>
      ) : (
        // Said rather than shown as a control, because `createCategory` takes
        // the parent's kind whatever this form asked for.
        <p className="text-caption text-ink-tertiary">
          {parent.kind.toLowerCase().replace('_', ' ')}, inherited from <Bidi>{parent.path}</Bidi>
        </p>
      )}

      {problem !== undefined && <p className="text-caption text-negative">{problem}</p>}

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" type="submit">
          Create
        </Button>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

const KINDS = ['EXPENSE', 'INCOME', 'TRANSFER', 'SAVING', 'DEBT_PAYMENT'] as const satisfies readonly CategoryKind[]


/**
 * One category's mark: its icon, or a dot in its colour.
 *
 * `undefined` is the hollow dot that means nothing is chosen — an outline rather
 * than the uncategorized grey, because "not chosen yet" and "filed as
 * Uncategorized" are different states and the picker is exactly where the
 * difference matters.
 */
function Mark({
  category,
  palette,
}: {
  category: Category | undefined
  palette: CategoryPalette
}) {
  if (category === undefined) {
    return <span aria-hidden className="size-2 shrink-0 rounded-full border border-hairline-strong" />
  }
  if (category.icon !== undefined) {
    return (
      <span aria-hidden className="w-3 shrink-0 text-center text-[0.6875rem] leading-none">
        {category.icon}
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: palette.colorOf(category.id) }}
    />
  )
}

function Option({
  children,
  onSelect,
  highlighted,
  selected,
  title,
}: {
  children: React.ReactNode
  onSelect: () => void
  highlighted: boolean
  selected?: boolean
  title?: string
}) {
  return (
    <li role="option" aria-selected={selected ?? false}>
      <button
        type="button"
        title={title}
        onMouseDown={(event) => {
          // mousedown, not click: the outside-click handler fires first
          // otherwise and closes the list before the choice registers.
          event.preventDefault()
          onSelect()
        }}
        className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors duration-[var(--duration-micro)] ${
          highlighted ? 'bg-surface' : ''
        } ${selected === true ? 'text-ink' : ''} hover:bg-surface`}
      >
        {children}
      </button>
    </li>
  )
}
