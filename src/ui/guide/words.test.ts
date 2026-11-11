import { describe, expect, it } from 'vitest'

import { LEDGER_GUIDE } from '@/data/packs/ledger/guide.ts'
import { forwardLabel } from '@/domain/guide.ts'
import { translate, type MessageKey } from '@/i18n/catalogue.ts'

import { forwardWords, stepWords } from './stepWords.ts'

const english = (key: string, parts?: Record<string, string | number>): string => translate('en', key as MessageKey, parts)
const hebrew = (key: string, parts?: Record<string, string | number>): string => translate('he', key as MessageKey, parts)

/**
 * **The guide's steps are English in the pack and translated on the screen**
 * (M60 U5, D-590): the catalogue's English must be the step's own word for
 * word, so the two cannot drift, and every step has its Hebrew.
 */
describe('the guide’s words (M60 U5)', () => {
  it('gives every step of the ledger’s guide its English, word for word', () => {
    for (const step of LEDGER_GUIDE) {
      const words = stepWords(step, english)
      expect(words.where).toBe(step.where)
      expect(words.title).toBe(step.title)
      expect(words.asNext).toBe(`${step.title.charAt(0).toLowerCase()}${step.title.slice(1)}`)
      expect(words.body).toBe(step.body)
      expect(words.test).toBe(step.test)
      expect(words.until).toBe(step.needs?.until)
      expect(english(`guide.steps.${step.id}.done`, { says: 'said' })).toBe('said')
    }
  })

  it('gives every step its Hebrew', () => {
    for (const step of LEDGER_GUIDE) {
      for (const part of ['where', 'title', 'asNext', 'body', 'test', 'done', ...(step.needs ? ['until'] : [])]) {
        const key = `guide.steps.${step.id}.${part}`
        expect(hebrew(key), key).not.toBe(english(key))
        expect(hebrew(key), key).toMatch(/[֐-׿]/)
      }
    }
  })

  it('labels the forward button as the domain does, in English', () => {
    for (const done of [false, true]) {
      const checks = Object.fromEntries(LEDGER_GUIDE.map((step) => [step.id, { done }]))
      for (let index = 0; index < LEDGER_GUIDE.length; index++) {
        expect(forwardWords(LEDGER_GUIDE, checks, index, english)).toBe(forwardLabel(LEDGER_GUIDE, checks, index))
      }
    }
  })
})
