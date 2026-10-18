import type { ReactNode } from 'react'

/**
 * Isolates a bidirectional string from the text around it.
 *
 * Hebrew merchant names sit inside an English LTR layout, and most of them
 * contain digits or Latin characters — `שופרסל דיל 344`. Without isolation the
 * bidi algorithm reorders across the boundary and the number visibly jumps to
 * the wrong end of the name. Never render a merchant name, or any cell from a
 * statement file, without this.
 *
 * See docs/conventions.md and docs/11-ui-design-language.md.
 */
export function Bidi({
  children,
  className,
}: {
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <span dir="auto" className={className === undefined ? 'bidi' : `bidi ${className}`}>
      {children}
    </span>
  )
}
