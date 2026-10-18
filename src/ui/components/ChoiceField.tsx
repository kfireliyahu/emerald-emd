import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'

import { Bidi } from '@/ui/Bidi.tsx'

/** One thing a field can be set to: what is stored, and what a person reads. */
export interface Choice {
  readonly value: string
  readonly label: string
  /** Drawn before the label in the list — a currency's sign (M29 F3, D-344). */
  readonly glyph?: string | undefined
  /** Drawn after the label, quieter — a currency's name. */
  readonly detail?: string | undefined
  /** What else a filter finds it by, beyond its label: `shekel` and `₪` find ILS. */
  readonly search?: string | undefined
  /**
   * The heading it is listed under, indented below it — the pack a format came
   * from (M33 F3). Choices that share one are given together; one without is
   * listed at the top.
   */
  readonly group?: string | undefined
}

/**
 * **A field with its choices under it** — M26 U3.
 *
 * From a review of the sheet: *"menus for the cells are dark and don't look
 * that well … i think it should have a auto complete instead of a menu, unless
 * the specific column type is one that fits a menu."* The cells were a
 * `<datalist>` and the editor's were `<select>`s, and both are drawn by the
 * platform: dark, in a font and a shape that are not this app's.
 *
 * So one control, two behaviours, decided by the caller from the column's type:
 *
 * - **`filter`** — an autocomplete. Typing narrows the list to what contains
 *   it, which is what a `link` over a format of two hundred rows needs.
 * - **otherwise a menu** — every choice, the current one marked. An enum's
 *   members and yes/no are a handful, and filtering five words is a step.
 *
 * **It stays a text field either way.** A sheet's foot is a row of fields a
 * pasted block lands across (D-289), so a cell that became a button would be a
 * cell a paste skips. A caller that wants a menu nothing can be typed into —
 * the entry editor's enum — passes `readOnly`.
 *
 * The list is fixed to the viewport, under the field: a sheet scrolls inside
 * its own box, and a list drawn inside it would be cut off at the box's edge.
 * It closes when anything outside it scrolls, rather than drifting away from
 * the field it is about. `accent-soft` marks the choice the keys are on — what
 * Enter would pick — and no figure (D-125).
 */
export function ChoiceField({
  text,
  choices,
  filter,
  onText,
  onPick,
  onKeyDown,
  className = '',
  ...input
}: {
  text: string
  choices: readonly Choice[]
  /** Narrow the list by what is typed — an autocomplete rather than a menu. */
  filter: boolean
  onText: (text: string) => void
  onPick: (choice: Choice) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | undefined>()
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()

  const needle = text.trim().toLocaleLowerCase()
  // A field already holding one of the choices exactly shows them all: it was
  // picked, and opening it again is asking what else there is.
  const exact = choices.some((each) => each.label.toLocaleLowerCase() === needle)
  const shown =
    filter && needle !== '' && !exact
      ? choices.filter(
          (each) =>
            each.label.toLocaleLowerCase().includes(needle) ||
            (each.search?.toLocaleLowerCase().includes(needle) ?? false),
        )
      : choices

  useLayoutEffect(() => {
    if (!open || field.current === null) return
    const box = field.current.getBoundingClientRect()
    setPlace({ top: box.bottom, left: box.left, width: box.width })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onScroll = (event: Event): void => {
      if (list.current !== null && event.target instanceof Node && list.current.contains(event.target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  // The keys' choice follows the list as it narrows, and starts on the one
  // the field already holds.
  useEffect(() => {
    const at = shown.findIndex((each) => each.label.toLocaleLowerCase() === needle)
    setActive(at === -1 ? 0 : at)
    // `shown` is derived from these two; listing it would re-run every render.
  }, [needle, choices])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${String(active)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (choice: Choice): void => {
    onPick(choice)
    setOpen(false)
  }

  return (
    <>
      <input
        {...input}
        ref={field}
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete={filter ? 'list' : 'none'}
        autoComplete="off"
        className={`${className} ${input.readOnly === true ? 'cursor-pointer' : ''}`}
        value={text}
        onChange={(event) => {
          onText(event.target.value)
          setOpen(true)
        }}
        onFocus={(event) => {
          if (!filter || input.readOnly === true) setOpen(true)
          input.onFocus?.(event)
        }}
        onClick={(event) => {
          setOpen(true)
          input.onClick?.(event)
        }}
        onBlur={(event) => {
          setOpen(false)
          input.onBlur?.(event)
        }}
        onKeyDown={(event) => {
          if (open && shown.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActive((at) => Math.min(Math.max(at + step, 0), shown.length - 1))
              return
            }
            if (event.key === 'Enter') {
              const choice = shown[active]
              // Enter on what is already there is the caller's Enter — on the
              // sheet, *write this row and move down*.
              if (choice !== undefined && choice.label !== text) {
                event.preventDefault()
                pick(choice)
                return
              }
            }
          }
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            return
          }
          if (!open && event.key === 'ArrowDown' && event.altKey) {
            event.preventDefault()
            setOpen(true)
            return
          }
          if (!open && input.readOnly === true && (event.key === ' ' || event.key === 'ArrowDown')) {
            event.preventDefault()
            setOpen(true)
            return
          }
          onKeyDown?.(event)
        }}
      />
      {open && place !== undefined && shown.length > 0 && (
        <ul
          ref={list}
          id={id}
          role="listbox"
          className="fc-pop-enter fixed z-50 max-h-64 overflow-auto border border-hairline-strong bg-elevated py-1 text-body text-ink shadow-pop"
          style={{ top: place.top + 2, left: place.left, minWidth: Math.max(place.width, 160) }}
          // A press on the list would blur the field first and close it.
          onMouseDown={(event) => event.preventDefault()}
        >
          {shown.map((choice, index) => (
            <Fragment key={`${choice.value}-${String(index)}`}>
            {/* A group's heading is no choice: the keys and a tour's `choice:` pass it. */}
            {choice.group !== undefined && choice.group !== shown[index - 1]?.group && (
              <li role="presentation" className="truncate px-3 pt-2 pb-0.5 text-caption text-ink-tertiary">
                {choice.group}
              </li>
            )}
            <li
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={`flex cursor-pointer items-center gap-2 py-1 pr-3 whitespace-nowrap ${
                choice.group === undefined ? 'pl-3' : 'pl-6'
              } ${index === active ? 'bg-accent-soft' : 'hover:bg-surface'}`}
              onMouseEnter={() => setActive(index)}
              // Not passed on: a list drawn inside a `<label>` would otherwise
              // click its field again, and the list would open straight back up.
              onClick={(event) => {
                event.preventDefault()
                pick(choice)
              }}
            >
              {choice.glyph !== undefined && (
                <span aria-hidden className="w-8 shrink-0 text-center text-ink-secondary">
                  {choice.glyph}
                </span>
              )}
              <Bidi className="truncate">{choice.label}</Bidi>
              {choice.detail !== undefined && (
                <Bidi className="truncate text-caption text-ink-tertiary">{choice.detail}</Bidi>
              )}
              {choice.label.toLocaleLowerCase() === needle && (
                <span aria-hidden className="ml-auto pl-3 text-caption text-ink-tertiary">
                  ✓
                </span>
              )}
            </li>
            </Fragment>
          ))}
        </ul>
      )}
    </>
  )
}
