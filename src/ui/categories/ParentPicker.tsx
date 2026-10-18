import { useEffect, useMemo, useRef, useState } from 'react'

import type { Category } from '@/data/repositories/categoryRepository.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { matchingParents } from '@/ui/categories/parentFilter.ts'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { useDismiss } from '@/ui/components/useDismiss.ts'

/**
 * Where a new category goes: type to filter the parents by path, arrows and
 * Enter to choose (M28 F9); any category with room under it (M28 F29). "Top
 * level" is the first row, always, because it is the default and the answer
 * to most categories. Paths are bidi-isolated.
 *
 * The categories screen's form and the picker's create form both use it (M28
 * F17), so the search is one search. **The keys it handles stop here**: inside
 * the picker it sits in a form whose own Enter creates, and choosing a parent
 * must not create the category on the same keystroke.
 *
 * **Tabbing onto it opens it**, and typing on it starts the search, the way a
 * `ChoiceField` does: the name, Tab, the parent's first letters is the whole
 * form from the keyboard. Choosing hands focus back to the closed button, which
 * does not reopen on that focus; tabbing out of the search closes it.
 */
export function ParentPicker({
  parents,
  value,
  onChange,
  fill = false,
}: {
  parents: readonly Category[]
  value: string
  onChange: (parentId: string) => void
  /** As wide as its container, rather than the form's fixed width. */
  fill?: boolean
}) {
  const width = fill ? 'w-full' : 'w-56'
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Focus coming back to the button after a choice, which must not reopen it.
  const returning = useRef(false)

  const matches = useMemo(() => matchingParents(parents, search), [parents, search])
  // Row 0 is "top level"; the parents follow.
  const rows: readonly (Category | undefined)[] = useMemo(() => [undefined, ...matches], [matches])
  const current = parents.find((parent) => parent.id === value)

  useEffect(() => setHighlighted(0), [search])

  // A press outside closes it, and so does Escape from anywhere (M45 F1); the
  // search input's own Escape still closes and hands focus back to the button.
  const dismissKey = useDismiss(open, containerRef, () => close())

  const close = (refocus = false): void => {
    returning.current = refocus
    setOpen(false)
    setSearch('')
  }

  // The button only exists once the list has closed, so it is focused after the render.
  useEffect(() => {
    if (!open && returning.current) buttonRef.current?.focus()
  }, [open])

  const choose = (parent: Category | undefined): void => {
    onChange(parent?.id ?? '')
    close(true)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      setHighlighted((n) => Math.min(n + 1, rows.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setHighlighted((n) => Math.max(n - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (highlighted < rows.length) choose(rows[highlighted])
    }
  }

  return (
    <div ref={containerRef} className="relative" onKeyDown={dismissKey}>
      {open ? (
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => close()}
          placeholder="Search parent categories…"
          aria-label="Search parent categories"
          dir="auto"
          className={`${FIELD} ${width}`}
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(true)}
          onFocus={() => {
            if (returning.current) returning.current = false
            else setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault()
              setSearch(event.key)
              setOpen(true)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(true)
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={false}
          aria-label="Parent category"
          className={`${FIELD} flex ${width} cursor-pointer items-center text-left`}
        >
          <span className="min-w-0 truncate">
            {current === undefined ? 'top level' : <>under <Bidi>{current.path}</Bidi></>}
          </span>
        </button>
      )}

      {open && (
        <ul
          role="listbox"
          // Keeps focus in the search, so dragging the list's scrollbar does not close it.
          onMouseDown={(event) => event.preventDefault()}
          className={`fc-pop-enter absolute z-40 mt-1 max-h-64 ${width} overflow-auto border border-hairline bg-elevated py-1 shadow-pop`}
        >
          {rows.map((parent, index) => (
            <li key={parent?.id ?? 'top'} role="option" aria-selected={(parent?.id ?? '') === value}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(parent)
                }}
                className={`flex w-full items-center px-3 py-1.5 text-left hover:bg-surface ${
                  index === highlighted ? 'bg-surface' : ''
                }`}
              >
                {parent === undefined ? (
                  <span className="text-ink-secondary">top level</span>
                ) : (
                  <Bidi className="truncate">{parent.path}</Bidi>
                )}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-3 py-1.5 text-caption text-ink-tertiary">No parent matches</li>
          )}
        </ul>
      )}
    </div>
  )
}
