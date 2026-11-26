import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'

import { currencySymbol, type CurrencyCode } from '@/core/money.ts'
import { parseISODate, parseNumericDate, parseYearMonth, toISODate, toYearMonthString, type LocalDate, type YearMonth } from '@/core/time.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { NativePicker, type PickerHandle } from '@/ui/components/NativePicker.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'

/**
 * **A form with several fields opens in the side panel** (D-617; M64 F3, D-629):
 * the page stays behind it, Enter saves, Esc (the panel's) or Cancel leaves,
 * and saving finishes where it started — the panel closes on the page it was
 * opened from.
 *
 * **The few fields a person types first, the rest only if wanted, said in
 * words as they type** (the maintainer, 2026-11-26, of a fund's reading and a
 * paycheck by hand). So a form is three pieces: the fields everybody fills,
 * `Said` — one sentence of what the figures typed so far mean, under them —
 * and `MoreFields`, the rest, folded until asked for and grown in place.
 *
 * **Its grids follow the form's width, not the window's** (`@container`):
 * inside the 420px panel a grid is one column; the same fields in a page of
 * their own (a fund report read through `FlowFrame`) take two or three.
 *
 * The Save is a secondary button: the page behind the panel keeps its own one
 * primary (*One primary action per screen*), as Accounts' forms do.
 */
export function PanelForm({
  save,
  canSave = true,
  onSave,
  onCancel,
  problems = [],
  children,
}: {
  /** The verb on the button: *Add reading*, *Save*. */
  readonly save: string
  readonly canSave?: boolean
  readonly onSave: () => void
  readonly onCancel: () => void
  /** Why it cannot be saved yet, a sentence each; shown under the buttons. */
  readonly problems?: readonly string[]
  readonly children: ReactNode
}) {
  const t = useT()
  // The first field takes the keyboard once the panel has put it on its Close
  // (`SidePanel` focuses that when it opens, after its children's own effects).
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const later = setTimeout(() => {
      form.current?.querySelector<HTMLElement>('[data-first], input:not([type=hidden]):not([aria-hidden]), textarea')?.focus({ preventScroll: true })
    })
    return () => clearTimeout(later)
  }, [])
  return (
    <form
      ref={form}
      className="@container flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) onSave()
      }}
    >
      {children}
      <div className="flex flex-col gap-2 border-t border-hairline pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" icon="check" type="submit" disabled={!canSave}>
            {save}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('chrome.components.cancel')}
          </Button>
        </div>
        {problems.length > 0 && (
          <ul role="alert" className="m-0 flex list-none flex-col gap-1 p-0 text-caption text-negative">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
    </form>
  )
}

/** A field's label above it and its hint under it, both `ink-secondary`, both isolated (a hint can carry a name). */
export function FormField({
  label,
  hint,
  wide = false,
  children,
}: {
  readonly label: string
  readonly hint?: ReactNode
  /** Across the whole grid, whatever its columns. */
  readonly wide?: boolean
  readonly children: ReactNode
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${wide ? 'col-span-full' : ''}`}>
      <span className="text-label text-ink-secondary uppercase">
        <Bidi>{label}</Bidi>
      </span>
      {children}
      {hint !== undefined && hint !== null && hint !== '' && (
        <span className="text-caption text-ink-secondary">
          <Bidi>{hint}</Bidi>
        </span>
      )}
    </label>
  )
}

/** Fields side by side when the form is wide enough for them, one under the other in the panel. */
export function FormGrid({ columns = 2, children }: { readonly columns?: 2 | 3; readonly children: ReactNode }) {
  return (
    <div className={`grid grid-cols-1 gap-x-6 gap-y-4 @md:grid-cols-2 ${columns === 3 ? '@3xl:grid-cols-3' : ''}`}>{children}</div>
  )
}

/**
 * **What the figures typed so far mean, in one sentence** — under the fields it
 * reads, announced politely as it changes. Never a verdict in colour alone: a
 * problem is a word in `problems`, and this is the sentence.
 */
export function Said({ children }: { readonly children: ReactNode }) {
  return (
    <p aria-live="polite" className="m-0 text-body text-ink-secondary tabular-nums">
      {children}
    </p>
  )
}

/**
 * **The rest of the form, only if wanted** — folded under one quiet verb and
 * grown in place when asked for (*"More" expands in place*; the height by
 * `grid-template-rows`, *Height animates by grid rows*). Folded, what is in it
 * is inert, so Tab walks only what shows.
 */
export function MoreFields({
  label,
  summary,
  initiallyOpen = false,
  children,
}: {
  /** The verb that opens it: *More from the report*. */
  readonly label: string
  /** What is in it, in a few words, said beside the verb while it is folded. */
  readonly summary?: string | undefined
  readonly initiallyOpen?: boolean
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const id = useId()
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="fc-text-action inline-flex items-center gap-2 self-start"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className={`transition-transform duration-[var(--duration-base)] rtl:-scale-x-100 ${open ? 'rotate-90 rtl:-rotate-90' : ''}`}>
          <path d="M3.5 2l3 3-3 3" />
        </svg>
        {label}
      </button>
      {!open && summary !== undefined && <span className="mt-1 text-caption text-ink-secondary">{summary}</span>}
      <div
        id={id}
        className={`grid transition-[grid-template-rows] duration-[var(--duration-base)] ease-[var(--ease-out)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        {...(open ? {} : { inert: '' as unknown as boolean, 'aria-hidden': true })}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-5 pt-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** A group's heading inside a form: a label, `ink-secondary`. */
export function FormGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-3 p-0 text-label text-ink-secondary uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}

/**
 * **The amount is the hero of its input**: no box, large tabular figures, the
 * currency's symbol fixed at the start in `ink-secondary`, one hairline under it
 * that thickens on focus (drawn as an inset shadow, so the figure never moves).
 */
export function AmountInput({
  label,
  currency,
  ...input
}: {
  readonly label: string
  readonly currency: CurrencyCode
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'inputMode'>) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-label text-ink-secondary uppercase">
        <Bidi>{label}</Bidi>
      </span>
      <span className="flex items-baseline gap-2 border-b border-hairline-strong pb-1 focus-within:border-accent focus-within:shadow-[inset_0_-1px_0_var(--color-accent)]">
        <span className="text-heading text-ink-secondary">{currencySymbol(currency)}</span>
        <input
          {...input}
          inputMode="decimal"
          dir="ltr"
          className="min-w-0 flex-1 border-0 bg-transparent text-title font-medium tabular-nums outline-none! placeholder:text-ink-secondary"
        />
      </span>
    </label>
  )
}

/**
 * **A day, typed or picked** — a text field holding the date as `2026-11-26`
 * (and taking `26/11/2026` or `26.11.2026`, the day first, as typed here),
 * whose click opens the platform's calendar under it (`NativePicker`, M29 F2),
 * never the platform's own date box drawn in the page. What is typed is kept
 * while it is not yet a date; leaving the field puts back the date it holds.
 * Emptied, an optional date is cleared.
 */
export function DateInput({
  value,
  onChange,
}: {
  readonly value: LocalDate | undefined
  readonly onChange: (date: LocalDate | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : toISODate(value))
  const picker = useRef<PickerHandle>(null)
  const take = (typed: string): void => {
    setText(typed)
    const trimmed = typed.trim()
    if (trimmed === '') onChange(undefined)
    else {
      const date = parseISODate(trimmed) ?? parseNumericDate(trimmed, 'dmy')
      if (date !== undefined) onChange(date)
    }
  }
  return (
    <span className="relative flex">
      <input
        className={`${FIELD} w-full tabular-nums`}
        dir="ltr"
        inputMode="numeric"
        value={text}
        onChange={(event) => take(event.target.value)}
        onBlur={() => setText(value === undefined ? '' : toISODate(value))}
        onClick={() => picker.current?.open()}
      />
      <NativePicker ref={picker} kind="date" value={text} label="" onPick={take} />
    </span>
  )
}

/**
 * **A month, typed or picked** — `DateInput`'s twin for a month (M64 F14): a
 * text field holding `2026-06` (and taking `06/2026` or `6.2026`, the month
 * first, as typed here), whose click opens the platform's month picker under
 * it. What is typed is kept while it is not yet a month; leaving the field puts
 * back the month it holds.
 */
export function MonthInput({
  value,
  onChange,
  ...input
}: {
  readonly value: YearMonth
  readonly onChange: (month: YearMonth) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>) {
  const [text, setText] = useState(toYearMonthString(value))
  const picker = useRef<PickerHandle>(null)
  const take = (typed: string): void => {
    setText(typed)
    const trimmed = typed.trim()
    const flipped = /^(\d{1,2})[/.-](\d{4})$/.exec(trimmed)
    const month = parseYearMonth(flipped === null ? trimmed : `${flipped[2]!}-${flipped[1]!.padStart(2, '0')}`)
    if (month !== undefined) onChange(month)
  }
  return (
    <span className="relative flex">
      <input
        {...input}
        className={`${FIELD} w-full tabular-nums`}
        dir="ltr"
        inputMode="numeric"
        value={text}
        onChange={(event) => take(event.target.value)}
        onBlur={() => setText(toYearMonthString(value))}
        onClick={() => picker.current?.open()}
      />
      <NativePicker ref={picker} kind="month" value={text} label="" onPick={take} />
    </span>
  )
}
