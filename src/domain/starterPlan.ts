/**
 * **50/30/20, onto the person's own categories** (M31 U3).
 *
 * The starter used to make three buckets called Needs, Wants and Saving that
 * pointed at nothing — and a budget is a bucket that points at a category
 * (D-327), so a first plan gave Home no *Against the budget* at all. A bucket
 * points at one category, so the starter makes one per top-level category: the
 * half that is needs is shared among the headings that are needs, by what went
 * out under each, and the same for wants and saving.
 *
 * **It knows the seeded headings and the kinds, and asks about the rest.** A
 * heading the person made themselves is not something code can sort into needs
 * or wants; the screen asks once, for all of them together, and an answer of
 * *not in the plan* leaves it out.
 *
 * Pure: headings in, buckets out.
 */

import { distribute } from '@/core/percent.ts'

export type StarterShare = 'NEEDS' | 'WANTS' | 'SAVING'

/** What a heading is to the starter: a share, or no part of a split at all. */
export type StarterAnswer = StarterShare | 'NONE'

export const STARTER_SHARES: readonly { readonly share: StarterShare; readonly name: string; readonly basisPoints: number }[] = [
  { share: 'NEEDS', name: 'Needs', basisPoints: 5000 },
  { share: 'WANTS', name: 'Wants', basisPoints: 3000 },
  { share: 'SAVING', name: 'Saving', basisPoints: 2000 },
]

/** The seeded top-level categories, by the id every document is created with. */
const SEEDED: ReadonlyMap<string, StarterShare> = new Map([
  ['cat:living', 'NEEDS'],
  ['cat:transport', 'NEEDS'],
  ['cat:health', 'NEEDS'],
  ['cat:family', 'NEEDS'],
  ['cat:obligations', 'NEEDS'],
  ['cat:lifestyle', 'WANTS'],
  ['cat:savings', 'SAVING'],
])

export interface StarterHeading {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly isSystem: boolean
  /** What went out under it, children included, over the months read. Minor units. */
  readonly spentMinor: number
}

export interface StarterBucket {
  /** The share it was made for: the heading it is under on Plan (M31 U4). */
  readonly share: StarterShare
  readonly name: string
  /** The category it points at; undefined for a share no heading answered to. */
  readonly categoryId: string | undefined
  readonly basisPoints: number
}

/** Its share, `NONE` when it has no place in a split, and undefined when the person has to say. */
export function starterShareOf(heading: StarterHeading): StarterAnswer | undefined {
  if (heading.isSystem || heading.kind === 'INCOME' || heading.kind === 'TRANSFER') return 'NONE'
  const seeded = SEEDED.get(heading.id)
  if (seeded !== undefined) return seeded
  if (heading.kind === 'SAVING') return 'SAVING'
  if (heading.kind === 'DEBT_PAYMENT') return 'NEEDS'
  return undefined
}

/** The headings the starter cannot place by itself — what the screen asks about. */
export function unplacedHeadings(headings: readonly StarterHeading[]): readonly StarterHeading[] {
  return headings.filter((heading) => starterShareOf(heading) === undefined)
}

/**
 * The starter's buckets, in the shares' order and each share's headings the
 * biggest first, ties in the person's order (M31 U4). **Each share adds up to its whole** — 5000, 3000 and 2000
 * basis points — divided by what went out under its headings, or evenly when
 * none of them has spent anything yet. A heading that spent nothing beside one
 * that did gets no bucket: a bucket of nothing is no budget. A share no heading
 * answers to is one bucket in its own name, pointing at nothing, as before.
 *
 * A heading the person was asked about and did not answer is left out.
 */
export function starterBuckets(
  headings: readonly StarterHeading[],
  answers: ReadonlyMap<string, StarterAnswer>,
): readonly StarterBucket[] {
  const buckets: StarterBucket[] = []
  for (const { share, name, basisPoints } of STARTER_SHARES) {
    const members = headings.filter((heading) => (starterShareOf(heading) ?? answers.get(heading.id)) === share)
    const spending = members.filter((heading) => heading.spentMinor > 0)
    const chosen = spending.length > 0 ? spending : members
    if (chosen.length === 0) {
      buckets.push({ share, name, categoryId: undefined, basisPoints })
      continue
    }
    const weights = chosen.map((heading) => (spending.length > 0 ? heading.spentMinor : 1))
    const made: StarterBucket[] = []
    distribute(basisPoints, weights).forEach((points, index) => {
      const heading = chosen[index]
      if (heading !== undefined && points > 0) made.push({ share, name: heading.name, categoryId: heading.id, basisPoints: points })
    })
    // The biggest first inside a share, once, here: after this the order is the plan's (M31 U4).
    buckets.push(...made.sort((a, b) => b.basisPoints - a.basisPoints))
  }
  return buckets
}

