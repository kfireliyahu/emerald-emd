import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { listCategories, type Category } from '@/data/repositories/categoryRepository.ts'
import { CATEGORY_COLOR_SLOTS, CATEGORY_COLOR_TOKENS, slotOf } from './categoryColor.ts'
import { resolvePalette } from './categoryPalette.ts'

/** A category with only the fields the palette reads. */
function category(id: string, over: Partial<Category> = {}): Category {
  return {
    id,
    name: id,
    parentId: undefined,
    depth: 1,
    kind: 'EXPENSE',
    isSystem: false,
    isArchived: false,
    color: undefined,
    icon: undefined,
    path: id,
    ...over,
  }
}

/** Ids that all hash to the same slot, so a collision is arranged rather than hoped for. */
function idsOnSlot(slot: number, count: number): string[] {
  const found: string[] = []
  for (let n = 0; found.length < count; n += 1) {
    const id = `cat:${n}`
    if (slotOf(id) === slot) found.push(id)
  }
  return found
}

describe('resolvePalette', () => {
  it('leaves a taxonomy that does not collide exactly where the hash put it', () => {
    // One category per slot: nothing to displace, so every one keeps its hash
    // and the app looks the same as it did before resolution existed.
    const ids = Array.from({ length: CATEGORY_COLOR_SLOTS }, (_, slot) => idsOnSlot(slot, 1)[0] ?? '')
    const palette = resolvePalette(ids.map((id) => category(id)))

    for (const id of ids) {
      expect(palette.tokenOf(id)).toBe(CATEGORY_COLOR_TOKENS[slotOf(id)])
    }
  })

  it('displaces siblings off a shared slot', () => {
    const [first, second, third] = idsOnSlot(3, 3)
    const palette = resolvePalette([first, second, third].map((id) => category(id ?? '')))

    const worn = [first, second, third].map((id) => palette.tokenOf(id))
    expect(new Set(worn).size).toBe(3)
    // Exactly one of them keeps the hash; only the two that would have
    // collided with it move.
    expect(worn.filter((slot) => slot === CATEGORY_COLOR_TOKENS[3])).toHaveLength(1)
  })

  it('does not displace across levels — two children of different parents may share', () => {
    const [a, b] = idsOnSlot(5, 2)
    const palette = resolvePalette([
      category('cat:p1'),
      category('cat:p2'),
      category(a ?? '', { parentId: 'cat:p1' }),
      category(b ?? '', { parentId: 'cat:p2' }),
    ])

    expect(palette.tokenOf(a)).toBe(palette.tokenOf(b))
    expect(palette.tokenOf(a)).toBe(CATEGORY_COLOR_TOKENS[5])
  })

  it("never moves a colour the user chose, and moves automatics out of its way", () => {
    // Two categories deliberately share a colour the user picked, and it is not
    // the slot the automatic one hashes to.
    const mine = CATEGORY_COLOR_TOKENS[5] ?? ''
    const [a, b] = idsOnSlot(2, 2)
    const palette = resolvePalette([
      category(a ?? '', { color: mine }),
      category(b ?? ''),
      category('cat:mine', { color: mine }),
    ])

    expect(palette.tokenOf(a)).toBe(mine)
    expect(palette.tokenOf('cat:mine')).toBe(mine)
    // The automatic one hashed to a slot nobody took, so it stays there.
    expect(palette.tokenOf(b)).toBe(CATEGORY_COLOR_TOKENS[2])
  })

  it('spreads a level evenly once there are more categories than hues', () => {
    // Thirty-three categories all hashing to one slot: eleven hues cannot make
    // them distinct, and what resolution promises above eleven is only that the
    // load is even rather than lumpy.
    const ids = idsOnSlot(0, 33)
    const palette = resolvePalette(ids.map((id) => category(id)))

    const counts = new Map<string, number>()
    for (const id of ids) {
      const slot = palette.tokenOf(id)
      counts.set(slot, (counts.get(slot) ?? 0) + 1)
    }
    expect(counts.size).toBe(CATEGORY_COLOR_SLOTS)
    expect([...counts.values()]).toEqual(Array.from({ length: CATEGORY_COLOR_SLOTS }, () => 3))
  })

  it('is the same answer however the caller sorted the list', () => {
    const ids = idsOnSlot(1, 12)
    const forward = resolvePalette(ids.map((id) => category(id)))
    const reversed = resolvePalette([...ids].reverse().map((id) => category(id)))

    for (const id of ids) expect(reversed.tokenOf(id)).toBe(forward.tokenOf(id))
  })

  it('gives an archived category an answer without letting it take a slot', () => {
    const [live, archived] = idsOnSlot(4, 2)
    const palette = resolvePalette([
      category(live ?? ''),
      category(archived ?? '', { isArchived: true }),
    ])

    // Both on their hash: the archived one did not push the live one along, and
    // it did not lose its own colour either.
    expect(palette.tokenOf(live)).toBe(CATEGORY_COLOR_TOKENS[4])
    expect(palette.tokenOf(archived)).toBe(CATEGORY_COLOR_TOKENS[4])
    expect(palette.peersWearing(live ?? '', CATEGORY_COLOR_TOKENS[4] ?? '')).toEqual([])
  })

  it('names the peers wearing a slot, and says when a level cannot be made distinct', () => {
    const ids = idsOnSlot(6, 12)
    const palette = resolvePalette(
      ids.map((id, index) => category(id, { name: `n${index}`, color: 'category-1' })),
    )

    expect(palette.levelSize(ids[0] ?? '')).toBe(12)
    expect(palette.crowded(ids[0] ?? '')).toBe(true)
    // Everybody chose category-1, so everybody else is wearing it.
    expect(palette.peersWearing(ids[0] ?? '', 'category-1')).toHaveLength(11)
    expect(palette.peersWearing(ids[0] ?? '', 'category-2')).toEqual([])
  })

  it('answers "no category at all" with the grey, which is not a hue', () => {
    const palette = resolvePalette([])
    expect(palette.tokenOf(undefined)).toBe('category-none')
    expect(palette.colorOf(undefined)).toBe('var(--color-category-none)')
  })
})

/**
 * The seed set is the taxonomy almost every document will actually have, so it
 * is the one the resolution has to be right about — synthetic ids prove the
 * algorithm and this proves the app.
 */
describe('the seeded taxonomy', () => {
  it('gives every set of siblings distinct hues, and spreads the top level evenly', async () => {
    const db = await createLedgerDatabase()
    const categories = listCategories(db, { includeArchived: true })
    const palette = resolvePalette(categories)

    const levels = new Map<string, Category[]>()
    for (const category of categories) {
      const key = category.parentId ?? ''
      levels.set(key, [...(levels.get(key) ?? []), category])
    }

    for (const [key, members] of levels) {
      const worn = members.map((one) => palette.tokenOf(one.id))
      if (members.length <= CATEGORY_COLOR_SLOTS) {
        // Every child level in the seed set is small, and small means distinct.
        expect(new Set(worn).size, `level ${key || 'top'}`).toBe(members.length)
        continue
      }

      // The top level has far more categories than there are hues, so the
      // promise is evenness rather than distinctness: no hue carries more than
      // one extra. Before resolution the hash alone left some slots with six
      // and others with two.
      const counts = new Map<string, number>()
      for (const slot of worn) counts.set(slot, (counts.get(slot) ?? 0) + 1)
      expect(counts.size).toBe(CATEGORY_COLOR_SLOTS)
      const load = [...counts.values()]
      expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(1)
    }
  })
})
