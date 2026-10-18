import { useId, useLayoutEffect, useRef, useState } from 'react'

import {
  completed,
  completionAt,
  formulaPieces,
  type FormulaName,
  type FormulaPiece,
} from '@/domain/format/formula.ts'
import { BLANK, FIELD } from '@/ui/components/fieldLook.ts'

/**
 * **A formula field that knows the format's columns** — M29 F5, D-346.
 *
 * Asked: *"when typing the works out new column formula, names of columns
 * should be autofilled and highlighted in green or linked."* So the line is
 * drawn twice: the input a person types in, with its own ink made
 * transparent, over a copy of the same text in which **every name the format
 * knows is in `positive`** — the app reporting what it found, which is what
 * `positive` is for (D-125); `accent` stays on what can be pressed — and every
 * name it does not know is underlined in `negative` before Save is pressed;
 * the sentence saying why is the grammar's, drawn by the panel, once. The word
 * being typed is neither yet.
 *
 * The word under the cursor is offered the names it could become: ↑ ↓ to
 * choose, Enter or Tab to take one, Escape to put the list away (and not the
 * panel). What the line *means* is still the grammar's to say (D-224) —
 * nothing here reads arithmetic.
 */
export function FormulaField({
  value,
  names,
  label,
  tour,
  placeholder,
  autoFocus,
  className = '',
  look: shape = 'field',
  onChange,
}: {
  value: string
  /** Every name the line may use. */
  names: readonly FormulaName[]
  label: string
  /** The demo tour's anchor (M33 U2). */
  tour?: string | undefined
  placeholder?: string | undefined
  autoFocus?: boolean | undefined
  className?: string | undefined
  /**
   * `blank` sits inside a sentence — no box, a hairline underline — and is as
   * wide as what is in it (M29 F10: the connection window's total).
   */
  look?: 'field' | 'blank' | undefined
  onChange: (value: string) => void
}) {
  const box = shape === 'blank' ? BLANK : FIELD
  const input = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLSpanElement>(null)
  const list = useId()
  const [caret, setCaret] = useState<number | undefined>(undefined)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  // Where the cursor goes after a completion, set once React has the new text.
  const landing = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    const at = landing.current
    if (at === undefined || input.current === null) return
    landing.current = undefined
    input.current.setSelectionRange(at, at)
    setCaret(at)
    if (mirror.current !== null) mirror.current.scrollLeft = input.current.scrollLeft
  })

  const known = new Set(names.map((each) => each.name))
  const pieces = formulaPieces(value)
  // The word being typed is not judged until the cursor leaves it.
  const typing = (piece: FormulaPiece): boolean => caret !== undefined && piece.start < caret && caret <= piece.end
  const completion = caret === undefined || dismissed ? undefined : completionAt(value, caret, names)
  const chosen = completion === undefined ? 0 : Math.min(active, completion.options.length - 1)

  const take = (name: string): void => {
    if (completion === undefined) return
    const next = completed(value, completion, name)
    landing.current = next.caret
    setActive(0)
    onChange(next.text)
  }

  const follow = (): void => {
    const field = input.current
    if (field === null) return
    setCaret(field.selectionStart ?? undefined)
    if (mirror.current !== null) mirror.current.scrollLeft = field.scrollLeft
  }

  return (
    <span
      className={shape === 'blank' ? `relative inline-block max-w-full align-bottom font-mono text-[12.5px] ${className}` : `relative block w-full ${className}`}
      style={shape === 'blank' ? { width: `${String(Math.max(12, (value || placeholder || '').length + 2))}ch` } : undefined}
    >
        <span
          ref={mirror}
          aria-hidden
          className={`${box} pointer-events-none absolute inset-0 flex items-center overflow-hidden font-mono whitespace-pre`}
          data-formula-mirror
        >
          {pieces.map((each) => (
            <span
              key={each.start}
              className={look(each, known, typing(each))}
              data-name={each.kind === 'NAME' ? each.text : undefined}
              data-unknown={each.kind === 'NAME' && !known.has(each.text) && !typing(each) ? '' : undefined}
            >
              {each.text}
            </span>
          ))}
        </span>
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          data-tour={tour}
          aria-expanded={completion !== undefined}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={completion === undefined ? undefined : `${list}-${String(chosen)}`}
          className={`${box} relative w-full bg-transparent font-mono text-transparent caret-ink`}
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(event) => {
            setDismissed(false)
            setActive(0)
            onChange(event.target.value)
            setCaret(event.target.selectionStart ?? undefined)
          }}
          onSelect={follow}
          onScroll={follow}
          onFocus={follow}
          onBlur={() => setCaret(undefined)}
          onKeyDown={(event) => {
            if (completion === undefined) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const size = completion.options.length
              setActive((chosen + (event.key === 'ArrowDown' ? 1 : size - 1)) % size)
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              const name = completion.options[chosen]?.name
              if (name === undefined) return
              event.preventDefault()
              take(name)
            } else if (event.key === 'Escape') {
              // The list goes, and the panel underneath stays open.
              event.preventDefault()
              event.stopPropagation()
              setDismissed(true)
            }
          }}
        />
        {completion !== undefined && (
          <ul
            id={list}
            role="listbox"
            aria-label={`Names for ${label}`}
            className="fc-pop-enter absolute top-full left-0 z-30 mt-1 min-w-56 overflow-hidden rounded-md border border-hairline-strong bg-elevated py-1 shadow-lg"
          >
            {completion.options.map((each, at) => (
              <li
                key={each.name}
                id={`${list}-${String(at)}`}
                role="option"
                aria-selected={at === chosen}
                className={`flex cursor-pointer items-baseline justify-between gap-4 px-3 py-1 ${at === chosen ? 'bg-surface' : ''}`}
                // Down, not click: a click would blur the input first and the list with it.
                onMouseDown={(event) => {
                  event.preventDefault()
                  take(each.name)
                }}
                onMouseEnter={() => setActive(at)}
              >
                <span className="font-mono text-positive">{each.name}</span>
                <span className="text-caption text-ink-tertiary">{each.says}</span>
              </li>
            ))}
          </ul>
        )}
    </span>
  )
}

function look(piece: FormulaPiece, known: ReadonlySet<string>, typing: boolean): string {
  switch (piece.kind) {
    case 'NAME':
      if (known.has(piece.text)) return 'text-positive underline decoration-1 underline-offset-4'
      return typing ? 'text-ink' : 'text-negative underline decoration-wavy decoration-1 underline-offset-4'
    case 'WORD':
    case 'UNIT':
      return 'text-ink-secondary'
    case 'OTHER':
      return 'text-ink'
  }
}
