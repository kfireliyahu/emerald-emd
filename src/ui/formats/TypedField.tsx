import type { CSSProperties } from 'react'

import type { ColumnType } from '@/domain/format/declaration.ts'
import { completionOf, settledText, type Completion } from '@/domain/format/completion.ts'
import { CURRENCIES, currencyOf } from '@/domain/format/currency.ts'
import { ChoiceField, type Choice } from '@/ui/components/ChoiceField.tsx'

/**
 * **What a typed percent or time will be kept as, drawn beside it** — M29 F3,
 * D-344.
 *
 * `87` shows a faint `%` after it, `0.87` shows `→ 87%`, `230pm` shows
 * `→ 14:30` — the engine's own reading (`completionOf`), so what the field
 * promises is what the write keeps. Leaving the field makes it that text
 * (`settle`), so the next look at it reads as it is stored.
 *
 * The hint sits in the field's right padding, which grows to hold it: on a
 * right-aligned figure the `%` lands straight after the digits, and on a time
 * it sits at the field's end.
 */
export function useTyped(type: ColumnType, text: string): {
  readonly completion: Completion | undefined
  readonly style: CSSProperties | undefined
  readonly settle: (text: string) => string
} {
  const completion = completionOf(type, text)
  const shown = hintText(completion)
  return {
    completion,
    style: shown === undefined ? undefined : { paddingRight: `calc(${String(shown.length)}ch + 0.5rem)` },
    settle: (typed) => settledText(type, typed),
  }
}

/** The faint reading itself, placed inside a `relative` box around the field. */
export function TypedHint({ completion }: { completion: Completion | undefined }) {
  const shown = hintText(completion)
  if (shown === undefined) return null
  return (
    <span
      aria-hidden
      data-completion
      className="pointer-events-none absolute inset-y-0 right-2 flex items-center whitespace-nowrap text-ink-tertiary tabular-nums"
    >
      {shown}
    </span>
  )
}

function hintText(completion: Completion | undefined): string | undefined {
  if (completion === undefined) return undefined
  return completion.rest ?? `→ ${completion.kept}`
}

/** Every listed currency as a choice: its code, its sign before it, its name after. */
const CURRENCY_CHOICES: readonly Choice[] = CURRENCIES.map((each) => ({
  value: each.code,
  label: each.code,
  glyph: each.sign,
  detail: each.name,
  search: `${each.sign} ${each.name}`,
}))

/**
 * **A currency, searched and picked** (M29 F3, D-344): the code, the sign and
 * the name, so `shekel`, `₪` and `ils` all find it. Still a text field, so a
 * code the list has not got is typed, and a paste lands on it.
 */
export function CurrencyField({
  value,
  label,
  className = '',
  placeholder = 'ILS',
  onChange,
  onPick = onChange,
  onEnter,
  onBlur,
  tour,
}: {
  value: string
  label: string
  /** The demo tour's anchor (M33 U2). */
  tour?: string | undefined
  className?: string
  placeholder?: string
  /** What is typed, upper-cased — a code, or a search on its way to one. */
  onChange: (code: string) => void
  /** A currency picked from the list; what is typed, unless this is given. */
  onPick?: ((code: string) => void) | undefined
  onEnter?: (() => void) | undefined
  onBlur?: (() => void) | undefined
}) {
  return (
    <ChoiceField
      className={`uppercase ${className}`}
      filter
      spellCheck={false}
      aria-label={label}
      data-tour={tour}
      placeholder={placeholder}
      title={currencyOf(value)?.name}
      text={value}
      choices={CURRENCY_CHOICES}
      onText={(text) => onChange(text.toUpperCase())}
      onPick={(choice) => onPick(choice.value)}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onEnter !== undefined) {
          event.preventDefault()
          onEnter()
        }
      }}
    />
  )
}
