import { describe, expect, it } from 'vitest'

import { APP_TITLE, documentTitle } from '@/state/documentTitle.ts'

describe('the window’s title (M54 F5)', () => {
  it('is Emerald with no document open', () => {
    expect(documentTitle(undefined, 'Dashboard')).toBe(APP_TITLE)
  })

  it('names the document, then the screen, then Emerald', () => {
    expect(documentTitle('project.emd', 'Unit board')).toBe('project.emd — Unit board — Emerald')
    expect(documentTitle('project.emd', undefined)).toBe('project.emd — Emerald')
  })

  it('isolates a right-to-left name, and leaves a left-to-right one as it is', () => {
    expect(documentTitle('תקציב.emd', 'Formats')).toBe('⁨תקציב.emd⁩ — Formats — Emerald')
  })
})
