import type { Category } from '@/data/repositories/categoryRepository.ts'

import { CATEGORY_COLOR_SLOTS, CATEGORY_COLOR_TOKENS, slotOf, token, UNCATEGORIZED_COLOR_TOKEN } from './categoryColor.ts'

/**
 * Which colour each category is drawn in, resolved **against the categories it
 * is drawn beside** rather than one at a time.
 *
 * A colour for one category at a time cannot do better than this: a hash
 * over the id is stable, which is the property that matters most, but it knows
 * nothing about what else is on the chart. So two categories in one donut could
 * land on the same hue and nothing anywhere checked — the gap M13 names. This
 * module is the check, and it is a *resolution* rather than a warning: an
 * automatic colour is displaced off a taken slot before anyone sees it.
 *
 * **The peer set is a level of the taxonomy, not a month.** Which categories
 * appear in one donut changes with the month and with the *show every category
 * on its own* toggle; which categories are siblings changes only when the user
 * edits the taxonomy. Resolving against the level is what keeps the guarantee
 * the hash was chosen for — a category is the same colour in January
 * and in June — while still spreading the hues. The top level is one such level;
 * each parent's children are another.
 *
 * **Eight hues do not cover forty-six categories and this module does not
 * pretend otherwise.** The seed set alone has thirty-three top-level
 * categories. What resolution buys above eleven is an *even* spread instead of a
 * lumpy one, and `crowded` is how the appearance popover says out loud that
 * some sharing is arithmetic rather than an oversight.
 */
export interface CategoryPalette {
  /** The token name — `category-3`, or `category-none` for "no category at all". */
  tokenOf: (id: string | undefined) => string
  /** The same, as something a `fill`, a `stroke` or a `backgroundColor` can take. */
  colorOf: (id: string | undefined) => string
  /** Peers at this category's level already wearing that slot, by name, in order. */
  peersWearing: (id: string, slot: string) => readonly string[]
  /** True when this category's level has more members than there are hues. */
  crowded: (id: string) => boolean
  /** How many categories share this category's level, itself included. */
  levelSize: (id: string) => number
}

/**
 * Resolve the whole taxonomy at once.
 *
 * **Archived categories take no slot.** Every chart reads the live taxonomy, and
 * the categories screen is the one place that asks for archived ones as well —
 * if they consumed slots there, the same category would be one colour on that
 * screen and another in the donut. They still get an answer from `tokenOf`;
 * they just do not push anybody else along.
 */
export function resolvePalette(categories: readonly Category[]): CategoryPalette {
  const live = categories.filter((category) => !category.isArchived)

  /** Level key: a parent's id, or `''` for the top level. */
  const levelKey = (category: { readonly parentId: string | undefined }): string =>
    category.parentId ?? ''

  const levels = new Map<string, Category[]>()
  for (const category of live) {
    const key = levelKey(category)
    const existing = levels.get(key)
    if (existing === undefined) levels.set(key, [category])
    else existing.push(category)
  }

  const chosen = new Map<string, string>()
  const levelOfId = new Map<string, string>()

  for (const [key, members] of levels) {
    // How many members already sit on each slot. An explicit choice counts
    // first and in full: the user's colour is never displaced, only respected.
    const load = new Array<number>(CATEGORY_COLOR_SLOTS).fill(0)
    const indexOfToken = new Map(CATEGORY_COLOR_TOKENS.map((name, index) => [name, index]))

    for (const member of members) {
      levelOfId.set(member.id, key)
      const explicit = member.color === undefined ? undefined : indexOfToken.get(member.color)
      if (explicit !== undefined) {
        chosen.set(member.id, CATEGORY_COLOR_TOKENS[explicit] ?? '')
        load[explicit] = (load[explicit] ?? 0) + 1
      }
    }

    // Then the automatic ones. Each takes the **least loaded** slot, walking
    // forward from its hash, so an uncrowded level reduces to "the hash unless
    // somebody is already there" and a crowded one spreads four-and-four rather
    // than six-and-two.
    //
    // **By id, not by the order the caller happened to pass.** Displacement is
    // order-dependent by nature — somebody has to keep the hash and somebody has
    // to move — and sorting here is what stops that from being the caller's
    // business. It also means reordering the taxonomy with the arrow keys does
    // not repaint it: `sort_order` moves and ids do not.
    for (const member of [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (chosen.has(member.id)) continue
      const start = slotOf(member.id)
      let best = start
      for (let step = 0; step < CATEGORY_COLOR_SLOTS; step += 1) {
        const candidate = (start + step) % CATEGORY_COLOR_SLOTS
        if ((load[candidate] ?? 0) < (load[best] ?? 0)) best = candidate
      }
      load[best] = (load[best] ?? 0) + 1
      chosen.set(member.id, CATEGORY_COLOR_TOKENS[best] ?? '')
    }
  }

  // Everyone the list mentions but the levels did not place — archived
  // categories, and nothing else today — keeps the single-category answer:
  // their own colour if they chose one, their hash if they did not. Resolved
  // here rather than on lookup because `tokenOf` is called once per row per
  // render and a scan of the taxonomy inside it is a scan per row.
  for (const category of categories) {
    if (chosen.has(category.id)) continue
    const own = category.color
    chosen.set(
      category.id,
      own !== undefined && CATEGORY_COLOR_TOKENS.includes(own)
        ? own
        : (CATEGORY_COLOR_TOKENS[slotOf(category.id)] ?? CATEGORY_COLOR_TOKENS[0] ?? ''),
    )
  }

  const tokenOf = (id: string | undefined): string => {
    if (id === undefined) return UNCATEGORIZED_COLOR_TOKEN
    return (
      chosen.get(id) ?? CATEGORY_COLOR_TOKENS[slotOf(id)] ?? CATEGORY_COLOR_TOKENS[0] ?? ''
    )
  }

  const membersAt = (id: string): readonly Category[] => {
    const key = levelOfId.get(id)
    if (key === undefined) return []
    return levels.get(key) ?? []
  }

  return {
    tokenOf,
    colorOf: (id) => token(tokenOf(id)),
    peersWearing: (id, slot) =>
      membersAt(id)
        .filter((peer) => peer.id !== id && chosen.get(peer.id) === slot)
        .map((peer) => peer.name),
    crowded: (id) => membersAt(id).length > CATEGORY_COLOR_SLOTS,
    levelSize: (id) => membersAt(id).length,
  }
}
