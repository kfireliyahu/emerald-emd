import { forwardRef, useImperativeHandle, useRef } from 'react'

/** What a picker chooses: a calendar day, a month, or a time of day. */
export type PickerKind = 'date' | 'month' | 'time'

/** The shape each kind's picker hands back, and takes as where to open. */
const SHAPE: Record<PickerKind, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  month: /^\d{4}-\d{2}$/,
  time: /^\d{2}:\d{2}$/,
}

/** The kind of picker a declared column's type has, if it has one. */
export function pickerOf(type: string): PickerKind | undefined {
  return type === 'date' || type === 'month' || type === 'time' ? type : undefined
}

export interface PickerHandle {
  /** Open the platform's picker, on the value the field holds when it reads as one. */
  open(): void
}

/**
 * **The platform's own calendar or clock, for a field that stays text** (M29
 * F2): *"when clicking on an empty cell for date it doesn't open the date
 * dialog why?"* A sheet's cell and a time on the entry page are typed — `9`,
 * `17:30`, a pasted column of dates — so they are text fields, and a text field
 * has no picker. This is one, out of sight under the field: the field opens it
 * on a click, empty or filled alike, and what it picks is written into the
 * field as if it had been typed.
 *
 * Opened only from a click, never on focus, so tabbing in and typing is
 * untouched. `showPicker` refuses outside a user gesture and in some frames;
 * a field that cannot open one is still a field.
 */
export const NativePicker = forwardRef<
  PickerHandle,
  { kind: PickerKind; value: string; label: string; onPick: (value: string) => void }
>(function NativePicker({ kind, value, label, onPick }, ref) {
  const input = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => ({
    open() {
      try {
        input.current?.showPicker()
      } catch {
        // Not here, or not now — the field is still there to type in.
      }
    },
  }))
  return (
    <input
      ref={input}
      type={kind}
      tabIndex={-1}
      aria-hidden
      aria-label={`${label}, picked`}
      className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      value={SHAPE[kind].test(value) ? value : ''}
      onChange={(event) => {
        if (event.target.value !== '') onPick(event.target.value)
      }}
    />
  )
})
