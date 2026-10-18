import type { BucketShare, SplitBucket } from '@/domain/model/plan.ts'

/** One heading of Plan's bucket table, and the buckets under it in the plan's own order. */
export interface BucketSection<T> {
  /** The share the heading is, or undefined for Other; a plan with no shares has one section and no heading. */
  readonly share: BucketShare | undefined
  readonly name: string
  readonly rows: readonly T[]
}

export const SHARE_NAME: Readonly<Record<BucketShare, string>> = {
  NEEDS: 'Needs',
  WANTS: 'Wants',
  SAVING: 'Saving',
}

/** Everything that counts as none of the three shares. */
export const OTHER = 'Other'

/**
 * Plan's buckets **under Needs, Wants and Saving** (M31 U4) — the share each
 * was made for, which the 50/30/20 starter writes and a bucket's *Counts as*
 * changes — then Other, last, for a bucket that is none of them. A plan where
 * no bucket has a share, one made by hand, has one section and no heading.
 *
 * **The plan's order stands, and the table follows the bar.** The starter puts
 * the shares in order and the biggest first inside each, once; after that the
 * order is the split's, and this only cuts it at the headings. It replaced the
 * top of the category tree as the heading (M28 F29), which after M31 U3 was one
 * heading per bucket.
 */
export function sectionBuckets<T>(rows: readonly T[], bucketOf: (row: T) => SplitBucket): readonly BucketSection<T>[] {
  if (!rows.some((row) => bucketOf(row).share !== undefined)) {
    return rows.length === 0 ? [] : [{ share: undefined, name: '', rows }]
  }
  const sections: BucketSection<T>[] = []
  for (const share of ['NEEDS', 'WANTS', 'SAVING', undefined] as const) {
    const found = rows.filter((row) => bucketOf(row).share === share)
    if (found.length > 0) sections.push({ share, name: share === undefined ? OTHER : SHARE_NAME[share], rows: found })
  }
  return sections
}
