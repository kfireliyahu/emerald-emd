/**
 * Which colour a category is drawn in.
 *
 * docs/11 makes category colours the one exception to the near-monochrome rule,
 * because a donut of grey wedges is a picture of nothing. The palette is eleven
 * richer hues plus a grey for uncategorized, defined as tokens in
 * `theme/tokens.css` with a lifted variant for the dark page — so what travels
 * through this module is a **CSS variable reference, never a hex value**. A hex
 * chosen against the white theme is the wrong colour on the black one, and a
 * chart that hardcoded one would be the first thing in the app to break when the
 * theme is switched.
 *
 * **Nothing relies on colour alone** (docs/11): every segment a colour is chosen
 * for is also named in the list beside the chart. The palette makes the wedges
 * tellable apart; the list is what makes them readable.
 *
 * **What this module cannot do is look at the rest of the chart.**
 * `categoryPalette.ts` resolves a whole taxonomy at once, so two categories
 * never land on the same hue; this file keeps the token reference and the hash
 * it starts from.
 */

import { CATEGORY_COLOR_SLOTS, CATEGORY_COLOR_TOKENS } from '@/domain/categoryColors.ts'

export { CATEGORY_COLOR_SLOTS, CATEGORY_COLOR_TOKENS }

/** Uncategorized: visible, and deliberately not a hue. */
export const UNCATEGORIZED_COLOR_TOKEN = 'category-none'

/**
 * `var(--color-category-3)`, which is what an SVG attribute wants.
 *
 * **Check the variable is actually emitted before reaching for one here.**
 * Tailwind v4 ships only the `@theme` variables it can see used in a class name,
 * so a token nothing references as `text-…` or `stroke-…` is tree-shaken out of
 * the stylesheet and this returns a reference to nothing — silently, and only in
 * whichever theme the value was declared in (D-088). The category palette is
 * declared in plain `:root` rules for exactly that reason. The ink tints are
 * safe because half the app uses them as classes; anything new is not.
 */
export function token(name: string): string {
  return `var(--color-${name})`
}

/**
 * A stable slot from an id.
 *
 * FNV-1a rather than a sum of char codes: the seeded ids are `cat:groceries`,
 * `cat:gas`, `cat:gifts` and so on, and a sum would hand near-identical strings
 * near-identical numbers — which is exactly the case where two adjacent donut
 * segments must not land on the same hue.
 *
 * Exported for `categoryPalette.ts`, which starts its search here: a resolved
 * colour is the hashed one wherever the level leaves it free, so a taxonomy that
 * never collides is drawn exactly as it was before resolution existed.
 */
export function slotOf(id: string): number {
  let hash = 0x81_1c_9d_c5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0
  }
  return hash % CATEGORY_COLOR_SLOTS
}
