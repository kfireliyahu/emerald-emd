import { useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import type { Database } from 'sql.js'

import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'

/** The value the last option holds; no id the document makes looks like it. */
export const NEW_CHOICE = '\u0000new'

/**
 * **A form makes what it needs in place** (M31 U6): a select whose last option is
 * *+ New…*. Choosing it opens the small form the caller supplies under the select,
 * and what that form makes comes back chosen — so no form has to say *make one
 * elsewhere first*. One piece, not a framework: the caller says what the thing is
 * by the form it hands over, and the form writes through the create function the
 * screens already use.
 */
export function SelectOrNew({
  value,
  onChange,
  newForm,
  placeholder,
  className = SELECT,
  children,
  ...select
}: {
  value: string
  onChange: (id: string) => void
  /** The small form; it calls `done` with what it made, or with nothing to cancel. */
  newForm: (done: (id: string | undefined) => void) => ReactNode
  /** Shown while nothing is chosen, so *+ New…* is never what the select shows by default. */
  placeholder?: string
  children: ReactNode
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'>) {
  const [making, setMaking] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <select
        {...select}
        className={className}
        value={making ? NEW_CHOICE : value}
        onChange={(event) => {
          const next = event.target.value
          setMaking(next === NEW_CHOICE)
          if (next !== NEW_CHOICE) onChange(next)
        }}
      >
        {placeholder !== undefined && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {children}
        <option value={NEW_CHOICE}>+ New…</option>
      </select>
      {making &&
        newForm((id) => {
          setMaking(false)
          if (id !== undefined) onChange(id)
        })}
    </div>
  )
}

/**
 * The small form most things need: a name, and the one choice the thing cannot
 * exist without when it has one (`kinds`). **It writes on Create**, as the
 * category picker's own create does (D-158), and a refusal is said here rather
 * than thrown at the screen.
 */
export function NewByName<Kind extends string>({
  noun,
  kinds,
  make,
  done,
}: {
  /** What is being made, in a sentence: `holding`, `account`. */
  noun: string
  /** The choice it cannot exist without, first is the default: `[value, label]`. */
  kinds?: readonly (readonly [Kind, string])[]
  /** Make it and return its id. Throw to refuse; the message is shown. */
  make: (db: Database, name: string, kind: Kind | undefined, now: number) => string
  /** What it made and the name it was given, or nothing when cancelled. */
  done: (id: string | undefined, name?: string) => void
}) {
  const mutate = useDocumentStore((state) => state.mutate)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind | undefined>(kinds?.[0]?.[0])
  const [problem, setProblem] = useState<string | undefined>()

  const create = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    let id: string | undefined
    try {
      mutate((db) => {
        id = make(db, trimmed, kind, Date.now())
      })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return
    }
    done(id, trimmed)
  }

  return (
    <div role="group" aria-label={`A new ${noun}`} className="fc-pop-enter flex flex-col gap-2.5 border border-hairline bg-surface p-3">
      {kinds !== undefined && (
        <div role="group" aria-label={`What kind of ${noun}`} className="flex flex-wrap">
          {kinds.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={`-ml-px h-7 border px-2.5 text-[12px] whitespace-nowrap first:ml-0 ${
                kind === value ? 'relative z-[1] border-accent bg-accent-soft text-ink' : 'border-hairline-strong text-ink-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <input
        className={FIELD}
        autoFocus
        aria-label={`New ${noun} name`}
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        // Inside another form: Enter makes this thing, not the form around it.
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            create()
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            done(undefined)
          }
        }}
      />
      {problem !== undefined && <p className="m-0 text-caption text-negative">{problem}</p>}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={name.trim() === ''} onClick={create}>
          Create
        </Button>
        <Button variant="ghost" size="sm" onClick={() => done(undefined)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
