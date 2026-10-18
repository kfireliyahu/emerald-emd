/**
 * The shared look of a text field and a select.
 *
 * Not a component, because the three screens that use these need to add their
 * own width and height and nothing else — wrapping that in a component would be
 * a prop for every utility it forwards. Class strings compose; a component that
 * forwards `className` is the same thing with more moving parts.
 *
 * Promoted here on the third copy (Categories, the mapper's mapping bar, and
 * the mappings screen), which is the point at which they had started to drift.
 */
export const FIELD =
  'h-8 rounded-md border border-hairline-strong bg-elevated px-3 outline-none ' +
  'focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

export const SELECT = `${FIELD} cursor-pointer pr-2`

/**
 * The same look for something that wraps. Not `FIELD` plus an override: two
 * competing heights in one class string resolve by CSS order rather than by the
 * order they are written in, which is a coin toss.
 */
export const FIELD_MULTILINE =
  'rounded-md border border-hairline-strong bg-elevated px-3 py-2 outline-none ' +
  'focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

/**
 * A blank inside a sentence — the amount input's treatment: no box, a hairline
 * underline that turns accent on focus (docs/11). The focus line is drawn as an
 * inset shadow rather than a thicker border, so the text does not move a pixel
 * when it is focused (M29 F10).
 */
export const BLANK =
  'inline-block h-6 min-w-[3ch] border-0 border-b border-hairline-strong bg-transparent px-0.5 align-baseline ' +
  'leading-6 text-ink outline-none focus:border-accent focus:shadow-[inset_0_-1px_0_var(--color-accent)]'
