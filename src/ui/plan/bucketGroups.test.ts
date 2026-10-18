import { describe, expect, it } from 'vitest'

import type { BucketShare, SplitBucket } from '@/domain/model/plan.ts'

import { OTHER, sectionBuckets } from './bucketGroups.ts'

const bucket = (id: string, share?: BucketShare): SplitBucket => ({
  id,
  name: id,
  targetKind: 'CATEGORY',
  targetId: id,
  color: undefined,
  sortOrder: 0,
  isBuffer: false,
  share,
})

const names = (sections: ReturnType<typeof sectionBuckets<SplitBucket>>) =>
  sections.map((section) => [section.name, section.rows.map((row) => row.id)])

describe('Plan’s buckets under Needs, Wants and Saving (M31 U4)', () => {
  it('groups by the share each bucket counts as, in the plan’s order inside each', () => {
    const rows = [
      bucket('savings', 'SAVING'),
      bucket('living', 'NEEDS'),
      bucket('hobbies', 'WANTS'),
      bucket('transport', 'NEEDS'),
      bucket('gifts'),
    ]
    expect(names(sectionBuckets(rows, (row) => row))).toEqual([
      ['Needs', ['living', 'transport']],
      ['Wants', ['hobbies']],
      ['Saving', ['savings']],
      [OTHER, ['gifts']],
    ])
  })

  it('draws no heading for a plan made by hand, whose buckets have no share', () => {
    const rows = [bucket('b'), bucket('a')]
    const sections = sectionBuckets(rows, (row) => row)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.share).toBeUndefined()
    expect(sections[0]?.rows.map((row) => row.id)).toEqual(['b', 'a'])
  })

  it('has nothing to draw for no buckets', () => {
    expect(sectionBuckets([], (row: SplitBucket) => row)).toEqual([])
  })
})
