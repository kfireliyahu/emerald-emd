import { describe, expect, it } from 'vitest'

import {
  QUIET_GUIDE,
  FRESH_GUIDE,
  decodeGuideProgress,
  firstOpen,
  forwardLabel,
  move,
  resumeAt,
  stepState,
  type GuideChecks,
  type GuideStep,
} from './guide.ts'

const step = (id: string, where: string, needs?: string): GuideStep => ({
  id,
  route: '/',
  where,
  place: `x.${id}`,
  title: `Do ${id}`,
  body: '',
  test: `${id} exists`,
  ...(needs === undefined ? {} : { needs: { step: needs, until: 'a statement is read' } }),
})

const STEPS = [
  step('read', 'Home › Month'),
  step('merchant', 'Transactions › By merchant', 'read'),
  step('fixed', 'Plan › Bills', 'read'),
  step('split', 'Plan › The split'),
]

const done = (...ids: string[]): GuideChecks =>
  Object.fromEntries(ids.map((id) => [id, { done: true, says: `${id} found` }]))

describe('the guide moves over what is done (choice d, B)', () => {
  it('passes over done steps both ways, and runs off either end', () => {
    const checks = done('merchant')
    expect(move(STEPS, checks, 0, 1)).toBe(2)
    expect(move(STEPS, checks, 2, -1)).toBe(0)
    expect(move(STEPS, checks, 3, 1)).toBe(4)
    expect(move(STEPS, checks, 0, -1)).toBe(-1)
  })

  it('opens on the first step still open, or the first when every one is done', () => {
    expect(firstOpen(STEPS, done('read'))).toBe(1)
    expect(firstOpen(STEPS, done('read', 'merchant', 'fixed', 'split'))).toBe(0)
  })
})

describe('resuming (choice c, B)', () => {
  it('picks up where it stopped, unless that step has been done since', () => {
    const progress = { ...FRESH_GUIDE, step: 'fixed' }
    expect(resumeAt(STEPS, {}, progress)).toBe(2)
    expect(resumeAt(STEPS, done('read', 'fixed'), progress)).toBe(1)
    expect(resumeAt(STEPS, {}, { ...FRESH_GUIDE, step: 'gone' })).toBe(0)
  })

  it('decodes what a document stored, and nothing it should not', () => {
    expect(decodeGuideProgress(undefined)).toBeUndefined()
    expect(decodeGuideProgress({ offered: true, step: 'split', lineAway: 'yes' })).toEqual({
      offered: true,
      started: false,
      step: 'split',
      lineAway: false,
    })
    expect(QUIET_GUIDE).toEqual({ offered: true, started: false, step: undefined, lineAway: true })
  })
})

describe('what a step says', () => {
  it('names what was found when done (S1), waits for a statement (S5), else waits on the screen', () => {
    const merchant = STEPS[1] as GuideStep
    expect(stepState(merchant, done('merchant'))).toEqual({ kind: 'done', says: 'merchant found' })
    expect(stepState(merchant, {})).toEqual({ kind: 'later', until: 'a statement is read' })
    expect(stepState(merchant, done('read'))).toEqual({ kind: 'waiting', test: 'merchant exists' })
  })

  it('labels the forward button as the mockup does', () => {
    expect(forwardLabel(STEPS, {}, 0)).toBe('Skip, go to Transactions')
    expect(forwardLabel(STEPS, done('read'), 0)).toBe('Next: Transactions')
    expect(forwardLabel(STEPS, {}, 2)).toBe('Skip for now')
    expect(forwardLabel(STEPS, done('fixed'), 2)).toBe('Next')
    expect(forwardLabel(STEPS, {}, 3)).toBe('Finish')
  })
})
