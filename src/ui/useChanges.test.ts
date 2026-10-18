import { describe, expect, it } from 'vitest'

import { liveIndex, toneOf } from './formats/tone.ts'
import { changeClass, changesSince } from './useChanges.ts'

describe('changesSince (M27 U8)', () => {
  const none = new Map()

  it('reports nothing on the first render', () => {
    expect(changesSince(undefined, [['M27 U8', 'planned']], none).size).toBe(0)
  })

  it('reports only the key whose signature changed', () => {
    const was = new Map([
      ['M27 U7', 'built'],
      ['M27 U8', 'planned'],
    ])
    const now = changesSince(
      was,
      [
        ['M27 U7', 'built'],
        ['M27 U8', 'in_progress'],
      ],
      none,
    )
    expect([...now.keys()]).toEqual(['M27 U8'])
    expect(now.get('M27 U8')).toEqual({ times: 1, was: 'planned' })
  })

  it('does not call a key it has never seen a change', () => {
    expect(changesSince(new Map([['a', 'x']]), [['b', 'y']], none).size).toBe(0)
  })

  it('counts a second change, so the class alternates and the animation replays', () => {
    const first = changesSince(new Map([['a', 'planned']]), [['a', 'in_progress']], none)
    const second = changesSince(new Map([['a', 'in_progress']]), [['a', 'built']], first)
    expect(changeClass('fc-changed', first.get('a'))).toBe('fc-changed-a')
    expect(changeClass('fc-changed', second.get('a'))).toBe('fc-changed-b')
    expect(changeClass('fc-changed', undefined)).toBe('')
  })

  it('keeps what it found across a render where nothing changed', () => {
    const first = changesSince(new Map([['a', 'x']]), [['a', 'y']], none)
    expect(changesSince(new Map([['a', 'y']]), [['a', 'y']], first)).toBe(first)
  })
})

describe('toneOf and liveIndex (M27 U8)', () => {
  it('reads the development pack’s members', () => {
    expect(['planned', 'in_progress', 'built', 'dropped'].map(toneOf)).toEqual(['waiting', 'live', 'done', 'struck'])
    expect(['planned', 'open', 'closed'].map(toneOf)).toEqual(['waiting', 'live', 'done'])
  })

  it('calls a member it has not heard of waiting, never live', () => {
    expect(toneOf('soaking')).toBe('waiting')
    expect(toneOf(undefined)).toBe('waiting')
  })

  it('puts the line’s break at the live row, else the first not done', () => {
    expect(liveIndex(['done', 'done', 'live', 'waiting'])).toBe(2)
    expect(liveIndex(['done', 'struck', 'waiting'])).toBe(2)
    expect(liveIndex(['done', 'done'])).toBe(2)
  })
})
