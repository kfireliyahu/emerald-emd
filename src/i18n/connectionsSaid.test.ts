import { describe, expect, it } from 'vitest'

import { CONNECTION_SAID_ENGLISH } from '@/domain/format/connections.ts'

import { connections } from './en/connections.ts'

/**
 * **The connections' sentences say one English** (M64 F35): the engine builds
 * them by key for a screen and in English for a conversation, so the
 * catalogue's English and the engine's must be the same words.
 */
describe('the connections’ sentences (M64 F35)', () => {
  it('are the same English in the catalogue and in the engine', () => {
    expect(connections.said).toEqual(CONNECTION_SAID_ENGLISH)
  })
})
