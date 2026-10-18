import { useMemo } from 'react'

import type { Category } from '@/data/repositories/categoryRepository.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { resolvePalette, type CategoryPalette } from '@/ui/charts/categoryPalette.ts'

/**
 * A category as a dot and a name (M28 U6, D-314).
 *
 * **A hue and a word, never a coloured background** — docs/11 keeps that line
 * while the hues themselves got richer. The dot is a mark and the name is what
 * says which category it is, so nothing relies on colour alone. A row with no
 * category is the grey `category-none` dot and the words *No category*, which
 * is an absence made visible rather than a category (docs/f10).
 *
 * The palette is resolved over the whole taxonomy by the caller
 * (`useCategoryPalette`), once, for the reason `CategoryPicker` gives: a dot
 * worked out per row is a dot that can disagree with the donut's wedge.
 *
 * **It takes the name as a string and isolates it itself** (M28 F17), because
 * the ellipsis has to be on the element that carries `dir="auto"`: inside an
 * LTR span that truncates, a Hebrew name loses its *start* and shows its tail.
 * The full name is on hover.
 */
export function CategoryMark({
  color,
  children,
  muted = false,
}: {
  /** `palette.colorOf(id)`. */
  readonly color: string
  /** The category's name or path, as it came out of the document. */
  readonly children: string
  readonly muted?: boolean
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${muted ? 'text-ink-secondary' : ''}`}>
      <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span title={children} className="flex min-w-0">
        <Bidi className="min-w-0 truncate">{children}</Bidi>
      </span>
    </span>
  )
}

/** The resolved palette for a taxonomy, memoised on the list. */
export function useCategoryPalette(categories: readonly Category[]): CategoryPalette {
  return useMemo(() => resolvePalette(categories), [categories])
}
