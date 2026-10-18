import { describe, expect, it } from 'vitest'

import { stringListOf } from './stringList.ts'

describe('stringListOf', () => {
  it('reads a JSON list of strings', () => {
    expect(stringListOf('["a","b c",""]')).toEqual(['a', 'b c', ''])
    expect(stringListOf('[]')).toEqual([])
  })

  it('refuses damaged input rather than coercing it', () => {
    expect(stringListOf('[1,"a"]')).toBeUndefined()
    expect(stringListOf('["a",null]')).toBeUndefined()
    expect(stringListOf('{"a":1}')).toBeUndefined()
    expect(stringListOf('"a"')).toBeUndefined()
    expect(stringListOf('[not json')).toBeUndefined()
    expect(stringListOf('')).toBeUndefined()
    expect(stringListOf(null)).toBeUndefined()
    expect(stringListOf(3)).toBeUndefined()
  })
})
