/**
 * The rule packs this build ships, and the built-in rules they add up to.
 *
 * Adding a market is adding a JSON file and a line in `SHIPPED`. There is
 * deliberately **no pack picker** in the UI: a chooser for one pack is a control
 * with one option, and what a second pack would need is not knowable until there
 * is one. Every shipped pack is on; that is the whole policy.
 *
 * Packs are **imported**, never fetched. Vite inlines a JSON import into the
 * bundle, so the rules are there before the first frame and no request is made
 * for them — in a shell that would block one anyway (docs/conventions.md).
 */

import type { CategoryRule } from '@/domain/model/rules.ts'
import ilCore from './il-core.json'
import { decodePack, type RulePack } from './packFormat.ts'

/** A pack as written, before anything has checked it. */
export interface ShippedPack {
  /** The file it came from, so a decode failure names something findable. */
  readonly file: string
  readonly raw: unknown
}

export const SHIPPED: readonly ShippedPack[] = [{ file: 'il-core.json', raw: ilCore }]

/**
 * Every shipped pack that decodes.
 *
 * A pack that does not decode is **skipped**, not thrown — a malformed pack is
 * a build-time mistake and `rulepacks.test.ts` fails on it, which is where a
 * mistake in data that ships with the app should be caught. Taking the app down
 * at startup instead would turn a typo in one merchant pattern into a document
 * the user cannot open, which is a much worse trade in an app whose whole
 * promise is that the file is theirs.
 */
export const PACKS: readonly RulePack[] = SHIPPED.flatMap((shipped) => {
  const decoded = decodePack(shipped.raw)
  return decoded.ok ? [decoded.value] : []
})

/**
 * The built-in rule set: every rule of every pack, in one list.
 *
 * Computed once at module load. It is the same for every document — what
 * differs per document is which of them the user switched off, and that is
 * `loadRules`'s job in `ruleSetRepository.ts`, not this list's.
 */
export const BUILT_IN_RULES: readonly CategoryRule[] = PACKS.flatMap((pack) => pack.rules)
