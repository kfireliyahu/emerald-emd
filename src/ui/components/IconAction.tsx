/**
 * **An action as an icon** — M26 U1, D-288 and docs/11's verb list.
 *
 * Square, ghost until hovered, and named twice: `aria-label` for a screen
 * reader and `title` for a pointer that waits, so the word that used to be on
 * the button is still one hover away. `negative` is for the one action that
 * loses something, and it colours the hover only — the icon sits in
 * `ink-secondary` like its neighbours until a pointer is on it. Never `accent`
 * at rest: a row of green glyphs would be the accent spent as decoration.
 *
 * Shared since the style spread to a format's sheet (M26 U2).
 */
export function IconAction({
  label,
  tone = 'ink',
  tour,
  onClick,
  children,
}: {
  label: string
  tone?: 'ink' | 'negative'
  /** The demo tour's anchor (M33 U2), a `data-tour` on the button. */
  tour?: string | undefined
  onClick: (event: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-tone={tone}
      data-tour={tour}
      className="fc-icon-action"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  )
}

/**
 * **A row a person can take out with the keyboard** — M28 F12. Spread onto a
 * queued file on a batch read (Home's Read files, Paychecks, a format's read):
 * focused, `Delete` or `Backspace` removes it, the same as its ×. Focus moves
 * to the row after it (or before, at the end) first, so a run of Deletes walks
 * down the batch. A key pressed inside one of the row's own controls is that
 * control's.
 */
export function removableRow(onRemove: () => void): {
  readonly tabIndex: 0
  readonly className: string
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
} {
  return {
    tabIndex: 0,
    className: 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      event.preventDefault()
      const next = event.currentTarget.nextElementSibling ?? event.currentTarget.previousElementSibling
      if (next instanceof HTMLElement && next.tabIndex >= 0) next.focus()
      onRemove()
    },
  }
}
