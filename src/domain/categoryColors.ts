/**
 * The category palette's names, which is all the engine and the plugin need to
 * know about it: the hues themselves are CSS tokens in `ui/theme/tokens.css`
 * (D-088), and what a colour *is* is the screen's business.
 *
 * Eleven since M28 U6 (D-314); the colour a category was given is stored as one
 * of these token names, so the older eight keep their names and their meaning.
 */

/** How many hues there are. */
export const CATEGORY_COLOR_SLOTS = 11

/** The token names, in the order the picker offers them. */
export const CATEGORY_COLOR_TOKENS: readonly string[] = Array.from(
  { length: CATEGORY_COLOR_SLOTS },
  (_, index) => `category-${index + 1}`,
)
