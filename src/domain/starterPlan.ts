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
 * **And it shows every placement before it makes anything** (M59 U4, D-580): a
 * person who saw only the finished plan could not tell why Transport was a need
 * or why Health got nothing. `starterProposal` is every heading with its share,
 * its part and why; an answer changes any heading the starter placed by itself
 * too, not only the ones it asked about.
 *
 * Pure: headings in, buckets out.
 */

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import { distribute } from '@/core/percent.ts'
import { formatMonthAbbrev, formatMonthShort, formatYearMonth, type YearMonth } from '@/core/time.ts'

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
  return starterPlacement(heading, NO_ANSWERS).answer
}

const NO_ANSWERS: ReadonlyMap<string, StarterAnswer> = new Map()

/**
 * Why a heading is where it is: one of the headings every document starts with (`DEFAULT`), its
 * kind — a saving or a debt-payment category (`KIND`) — the person's say (`CHOSEN`), no part of a
 * split at all — income, a transfer, a heading the app keeps (`NOT_SPLIT`) — or nothing yet (`ASK`).
 */
export type StarterPlacedBy = 'DEFAULT' | 'KIND' | 'CHOSEN' | 'NOT_SPLIT' | 'ASK'

/** Where a heading goes and why. An answer overrides the starter's own placing, never `NOT_SPLIT`. */
export function starterPlacement(
  heading: StarterHeading,
  answers: ReadonlyMap<string, StarterAnswer>,
): { readonly answer: StarterAnswer | undefined; readonly by: StarterPlacedBy } {
  if (heading.isSystem || heading.kind === 'INCOME' || heading.kind === 'TRANSFER') return { answer: 'NONE', by: 'NOT_SPLIT' }
  const chosen = answers.get(heading.id)
  if (chosen !== undefined) return { answer: chosen, by: 'CHOSEN' }
  const seeded = SEEDED.get(heading.id)
  if (seeded !== undefined) return { answer: seeded, by: 'DEFAULT' }
  if (heading.kind === 'SAVING') return { answer: 'SAVING', by: 'KIND' }
  if (heading.kind === 'DEBT_PAYMENT') return { answer: 'NEEDS', by: 'KIND' }
  return { answer: undefined, by: 'ASK' }
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
    const members = headings.filter((heading) => starterPlacement(heading, answers).answer === share)
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

/** How a heading's part of its share was sized. */
export type StarterSizedBy =
  /** By what went out under it, beside the others of its share. */
  | 'SPENT'
  /** Evenly: nothing went out under any heading of its share. */
  | 'EVENLY'
  /** The only heading of its share: it takes the whole of it. */
  | 'WHOLE'
  /** Nothing went out under it while something did under another of its share: no bucket. */
  | 'NOTHING_OUT'

export interface StarterLine {
  readonly heading: StarterHeading
  /** Its share, `NONE` left out, undefined while the person has still to say. */
  readonly answer: StarterAnswer | undefined
  readonly placedBy: StarterPlacedBy
  /** Its part of the whole plan; 0 with no bucket. */
  readonly basisPoints: number
  /** Undefined when it is in no share. */
  readonly sizedBy: StarterSizedBy | undefined
}

export interface StarterProposal {
  /** Every heading, in the order given. */
  readonly lines: readonly StarterLine[]
  /** What making it writes: `starterBuckets` of the same answers. */
  readonly buckets: readonly StarterBucket[]
  /** The headings still waiting for an answer; nothing is made while any is. */
  readonly unanswered: readonly StarterHeading[]
}

/**
 * **The starter before it is made** (M59 U4, D-580): every heading, its share, its part and why —
 * the same arithmetic `starterBuckets` writes, so what the screen and a conversation show is what
 * Make plan makes.
 */
export function starterProposal(
  headings: readonly StarterHeading[],
  answers: ReadonlyMap<string, StarterAnswer>,
): StarterProposal {
  const buckets = starterBuckets(headings, answers)
  const points = new Map(buckets.flatMap((one) => (one.categoryId === undefined ? [] : [[one.categoryId, one.basisPoints] as const])))
  const lines = headings.map((heading): StarterLine => {
    const { answer, by } = starterPlacement(heading, answers)
    if (answer === undefined || answer === 'NONE') {
      return { heading, answer, placedBy: by, basisPoints: 0, sizedBy: undefined }
    }
    const share = headings.filter((other) => starterPlacement(other, answers).answer === answer)
    const spending = share.some((other) => other.spentMinor > 0)
    const sizedBy: StarterSizedBy =
      share.length === 1 ? 'WHOLE' : heading.spentMinor > 0 ? 'SPENT' : spending ? 'NOTHING_OUT' : 'EVENLY'
    return { heading, answer, placedBy: by, basisPoints: points.get(heading.id) ?? 0, sizedBy }
  })
  return { lines, buckets, unanswered: lines.filter((one) => one.answer === undefined).map((one) => one.heading) }
}

// --- the words, one set for the screen and for `start_plan` -------------------------------------

/** A share's name as the starter says it. */
export const STARTER_ANSWER_NAME: Readonly<Record<StarterAnswer, string>> = {
  NEEDS: 'Needs',
  WANTS: 'Wants',
  SAVING: 'Saving',
  NONE: 'Left out',
}

/** The months what went out was read over, said once: *Aug to Oct 2026*, *Oct 2026*; undefined with none. */
export function starterWindow(months: readonly YearMonth[]): string | undefined {
  const first = months[0]
  const last = months.at(-1)
  if (first === undefined || last === undefined) return undefined
  if (months.length === 1) return formatYearMonth(last)
  const from = first.year === last.year ? formatMonthAbbrev(first) : formatMonthShort(first)
  return `${from} to ${formatMonthShort(last)}`
}

/** Why a heading is in its share, in a few words. */
export function starterPlacedWhy(line: StarterLine): string {
  const { heading, answer, placedBy } = line
  switch (placedBy) {
    case 'DEFAULT':
      return `${STARTER_ANSWER_NAME[answer ?? 'NONE']} by default`
    case 'KIND':
      return heading.kind === 'SAVING' ? 'A saving category' : 'Debt payments are needs'
    case 'CHOSEN':
      return 'You chose'
    case 'NOT_SPLIT':
      return heading.kind === 'INCOME'
        ? 'Income is what is split'
        : heading.kind === 'TRANSFER'
          ? 'Money moved, not spent'
          : 'Waiting to be sorted'
    case 'ASK':
      return 'Choose one'
  }
}

/** How its part was sized, in a few words; undefined when it is in no share. */
export function starterSizedWhy(line: StarterLine, months: number, currency: CurrencyCode): string | undefined {
  switch (line.sizedBy) {
    case 'SPENT':
      return `${formatMoney(money(Math.round(line.heading.spentMinor / Math.max(1, months)), currency))} a month went out`
    case 'EVENLY':
      return 'Nothing went out in its share yet, so an even part'
    case 'WHOLE':
      return `The only one in ${STARTER_ANSWER_NAME[line.answer ?? 'NONE'].toLowerCase()}, so all of it`
    case 'NOTHING_OUT':
      return 'Nothing went out, so no bucket'
    case undefined:
      return undefined
  }
}

/** The whole why, as one line: *Needs by default · ₪1,200.00 a month went out*. */
export function starterWhy(
  line: StarterLine,
  months: number,
  currency: CurrencyCode,
  keptBucket: string | undefined,
): string {
  return [
    starterPlacedWhy(line),
    starterSizedWhy(line, months, currency),
    keptBucket === undefined || line.basisPoints === 0 ? undefined : `keeps its bucket ${keptBucket}`,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
}
