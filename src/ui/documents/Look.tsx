import type { ReactNode } from 'react'

/**
 * Something read off a document, pointing at the line it came from (D-168).
 *
 * **The gesture is pointing, so there is nothing to pin.** Hovering or tabbing
 * onto a figure marks its line on the page beside it, and leaving unmarks it —
 * no selected state to get out of step with the page, and no third thing to
 * clear. Clicking opens the document if it is not open, which is the one
 * *action* here and the reason this is a real button: `accent`'s focus ring
 * marks something you can act on (D-125), and "show me this on the page" is.
 *
 * A field with no line behind it — a figure the template never resolved —
 * renders as plain content rather than as a button that would do nothing.
 */
export function Look({
  line,
  onLook,
  onShow,
  className,
  children,
}: {
  /** 1-based, the way a template numbers lines. Undefined means nothing to point at. */
  readonly line: number | undefined
  readonly onLook: (line: number | undefined) => void
  /** Open the document, for a click. Omitted where it is already open or absent. */
  readonly onShow?: (() => void) | undefined
  readonly className?: string | undefined
  readonly children: ReactNode
}) {
  if (line === undefined) {
    return <div className={className}>{children}</div>
  }

  return (
    <button
      type="button"
      className={`block rounded-sm text-left ${className ?? ''}`}
      onMouseEnter={() => onLook(line)}
      onMouseLeave={() => onLook(undefined)}
      onFocus={() => onLook(line)}
      onBlur={() => onLook(undefined)}
      onClick={onShow}
      title={`Read off line ${line} of the document`}
    >
      {children}
    </button>
  )
}

/**
 * The line a reading took a field off, by whatever name the surface knows it.
 *
 * Three spellings meet here and none of them is worth changing upstream. A
 * payslip's review names the template field outright (`grossLine`); a fund
 * report's names the *reading* key (`closingBalance`) and the template calls
 * that line `closingBalanceLine`; and a doubt about a borrowed figure appends
 * its own suffix (`grossLine:borrowed`). Pointing at a page is not a reason to
 * renumber any of that, so the translation lives in the one place that needs
 * it.
 */
export function lineOf(
  lines: Readonly<Record<string, number>>,
  field: string,
): number | undefined {
  const base = field.split(':')[0] ?? field
  return lines[base] ?? lines[`${base}Line`]
}
