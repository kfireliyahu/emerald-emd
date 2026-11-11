import { describe, expect, it } from 'vitest'

import { translate, type MessageKey } from '@/i18n/catalogue.ts'
import { TOOL_GROUPS } from '@/plugin/catalog.ts'
import { groupKey, toolWords } from './words.ts'

const english = (key: MessageKey, parts?: Record<string, string | number>): string => translate('en', key, parts)
const hebrew = (key: MessageKey, parts?: Record<string, string | number>): string => translate('he', key, parts)

/**
 * **Assistants shows the plugin's catalogue in the app's language** (M60 U5,
 * D-590): the catalogue stays English, a host reads it, and the screen's
 * English must be its own word for word — so a tool added there fails here
 * until it has its words.
 */
describe('the Assistants screen’s words (M60 U5)', () => {
  it('has every tool and group, in English word for word and in Hebrew', () => {
    for (const group of TOOL_GROUPS) {
      const key = `settings.assistants.groups.${groupKey(group)}` as MessageKey
      expect(english(key), key).toBe(group.title)
      expect(hebrew(key), key).toMatch(/[֐-׿]/)
      for (const tool of group.tools) {
        expect(toolWords(tool, english)).toBe(tool.plain)
        expect(toolWords(tool, hebrew), tool.name).toMatch(/[֐-׿]/)
      }
    }
  })
})
