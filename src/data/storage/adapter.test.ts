import { describe, expect, it } from 'vitest'

import { suggestedFileName } from './adapter.ts'

describe('suggestedFileName (M38 F1)', () => {
  it('names a new document untitled, with the month it was made', () => {
    expect(suggestedFileName(new Date(2026, 9, 6))).toBe('untitled-2026-10.emd')
    expect(suggestedFileName(new Date(2027, 0, 31))).toBe('untitled-2027-01.emd')
  })
})
