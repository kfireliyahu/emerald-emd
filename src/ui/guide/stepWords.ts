import type { MessageKey } from '@/i18n/catalogue.ts'
import type { Translate } from '@/i18n/current.ts'
import { asNext, isDone, move, type GuideChecks, type GuideStep } from '@/domain/guide.ts'

/**
 * **A guide step's words, in the language now** — M60 U5 (D-590). The steps
 * are a pack's list (`src/data/packs/ledger/guide.ts`) and stay English there,
 * for the plugin reads them too; the screen asks the catalogue by step id
 * (`guide.steps.<id>`), and a step the catalogue has no words for — another
 * pack's — keeps its own.
 */
export interface StepWords {
  readonly where: string
  readonly title: string
  readonly asNext: string
  readonly body: string
  readonly test: string
  readonly until: string | undefined
}

export function stepWords(step: GuideStep, t: Translate): StepWords {
  const word = (part: string, own: string): string => {
    const key = `guide.steps.${step.id}.${part}`
    const found = t(key as MessageKey)
    return found === key ? own : found
  }
  return {
    where: word('where', step.where),
    title: word('title', step.title),
    asNext: word('asNext', asNext(step)),
    body: word('body', step.body),
    test: word('test', step.test),
    until: step.needs === undefined ? undefined : word('until', step.needs.until),
  }
}

/** A done step's sentence: the document's own in English (`{says}`), a fixed one where those words are not. */
export function doneWords(step: GuideStep, says: string, t: Translate): string {
  const key = `guide.steps.${step.id}.done`
  const found = t(key as MessageKey, { says })
  return found === key ? says : found
}

/** The first word of a step's `where`, in the language now: the screen it stands on. */
function screenOf(step: GuideStep, t: Translate): string {
  const where = stepWords(step, t).where
  return where.split(' › ')[0] ?? where
}

/**
 * The step's forward button — `forwardLabel` in `domain/guide.ts`, with the
 * screens' names in the language now: `Next`, `Next: Plan`, `Finish`, and while
 * a step is not done `Skip for now` or `Skip, go to Plan`.
 */
export function forwardWords(steps: readonly GuideStep[], checks: GuideChecks, index: number, t: Translate): string {
  const step = steps[index]
  if (step === undefined) return t('guide.forward.finish')
  const target = steps[move(steps, checks, index, 1)]
  if (target === undefined) return t('guide.forward.finish')
  const screen = screenOf(target, t)
  const otherScreen = screen !== screenOf(step, t)
  if (isDone(checks, step.id)) return otherScreen ? t('guide.forward.nextTo', { screen }) : t('guide.forward.next')
  return otherScreen ? t('guide.forward.skipTo', { screen }) : t('guide.forward.skip')
}
