import { describe, expect, it } from 'vitest'

import { translate } from '@/i18n/catalogue.ts'
import type { Translate } from '@/i18n/current.ts'
import type { ListPicture } from '@/ui/formats/listView.ts'
import { boardAnswer, byMember, joined, listAnswer, readyAnswer } from '@/ui/formats/viewAnswers.ts'

const en: Translate = (key, parts) => translate('en', key, parts)
const he: Translate = (key, parts) => translate('he', key, parts)
/** The answer as read, without the isolation marks round a document's words. */
const plain = (text: string): string => text.replace(/[⁨⁩]/g, '')

/** M64 U14, D-626: every engine view says its answer first, in the catalogue's words. */
describe('what an engine view answers first', () => {
  it('joins parts as a sentence does, in each language', () => {
    expect(joined(en, [])).toBe('')
    expect(joined(en, ['a'])).toBe('a')
    expect(joined(en, ['a', 'b', 'c'])).toBe('a, b and c')
    expect(joined(he, ['א', 'ב'])).toBe('א וב')
  })

  it('counts a board by lane, in the lanes’ order, leaving the empty ones out', () => {
    const lanes = [
      { member: 'planned', rows: [1, 2, 3] },
      { member: 'in_progress', rows: [] },
      { member: 'built', rows: [1, 2, 3, 4] },
    ]
    expect(plain(boardAnswer(en, lanes))).toBe('3 planned and 4 built.')
    expect(boardAnswer(en, [{ member: 'planned', rows: [] }])).toBe('Nothing here yet.')
    expect(plain(byMember(en, [['in_progress', 1]]))).toBe('1 in progress')
  })

  it('says what is open and what is done on a list that ticks, and how many rows on one that does not', () => {
    const line = (ticked: boolean) => ({ ticked }) as unknown as ListPicture['groups'][number]['rows'][number]
    const ticking = { shape: { done: {} }, groups: [{ rows: [line(false), line(true), line(true)] }] } as unknown as ListPicture
    expect(listAnswer(en, ticking)).toBe('1 open and 2 done.')
    const unticked = { shape: {}, groups: [{ rows: [line(false)] }] } as unknown as ListPicture
    expect(listAnswer(en, unticked)).toBe('1 row.')
    expect(listAnswer(en, { shape: {}, groups: [] } as unknown as ListPicture)).toBe('Nothing on this list yet.')
  })

  it('says how many can start and how many are held', () => {
    const ready = (count: number, held: number) =>
      ({ ready: Array.from({ length: count }), held: Array.from({ length: held }) }) as unknown as Parameters<typeof readyAnswer>[1]
    expect(readyAnswer(en, ready(2, 1))).toBe('2 ready to start and 1 held.')
    expect(readyAnswer(en, ready(1, 0))).toBe('1 ready to start.')
    expect(readyAnswer(en, ready(0, 0))).toBe('Nothing is ready to start.')
  })
})
