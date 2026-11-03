import type { ColumnDeclaration } from '@/domain/format/declaration.ts'
import { boundedWidth } from '@/domain/format/view.ts'

/**
 * **A column's width is dragged wherever its columns are drawn** (M55 F1,
 * D-558): the format's table, its saved table tab and a saved table placed
 * on a dashboard all wear this handle, and all of them write the one width
 * the format keeps for the column (`format_column_view`, D-289). The drag
 * handle on a header's trailing edge, and a separator a keyboard can move:
 * arrows by 16px, double-click or Delete back to the type's width.
 */
export function ResizeHandle({
  column,
  width,
  onDrag,
  onDone,
}: {
  column: string
  width: number
  onDrag: (width: number) => void
  onDone: (width: number | undefined) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Width of ${column}`}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none transition-colors duration-[var(--duration-micro)] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const start = event.clientX
        const target = event.currentTarget
        target.setPointerCapture(event.pointerId)
        let last = width
        const move = (each: PointerEvent): void => {
          // Right-to-left, the trailing edge is on the left and a drag right narrows.
          const sign = getComputedStyle(target).direction === 'rtl' ? -1 : 1
          last = boundedWidth(width + sign * (each.clientX - start))
          onDrag(last)
        }
        const up = (): void => {
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
          target.removeEventListener('pointercancel', up)
          onDone(last)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
        target.addEventListener('pointercancel', up)
      }}
      onDoubleClick={() => onDone(undefined)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          onDone(boundedWidth(width + (event.key === 'ArrowRight' ? 16 : -16)))
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          onDone(undefined)
        }
      }}
    />
  )
}
/** A column nobody has sized, by what it holds. */
export function defaultWidth(column: ColumnDeclaration): number {
  switch (column.type) {
    case 'text':
    case 'links':
    case 'enums':
      return 200
    case 'link':
    case 'elsewhere':
    case 'file':
    case 'instant':
      return 180
    case 'enum':
    case 'money':
      return 140
    case 'quantity':
    case 'date':
      return 120
    case 'time':
      return 80
    case 'integer':
    case 'real':
    case 'decimal':
    case 'percent':
    case 'month':
      return 100
    case 'boolean':
      return 72
  }
}