import { asNext, doneCount, firstOpen } from '@/domain/guide.ts'
import { Button } from '@/ui/components/Button.tsx'

import { openGuide, useGuideOpen } from './guideState.ts'
import { useGuide } from './useGuide.ts'

/**
 * **Getting started, in one line — and where the guide resumes** (M28 U9,
 * choices a and c, B). Onboarding's checklist line, become the guide's: how far,
 * the next place, and a press to continue from where it stopped. Put away, it
 * stays away; Help › Guide me still opens the guide.
 *
 * Hidden while the guide is open — the dialog is saying the same thing.
 */
export function GuideLine() {
  const open = useGuideOpen()
  const guide = useGuide(open === undefined)
  if (open !== undefined || guide === undefined || guide.progress.lineAway) return null

  const { steps, checks, progress } = guide
  const count = steps.length
  const done = doneCount(steps, checks)
  const meter = (
    <span className="flex gap-[3px]" aria-hidden>
      {steps.map((step) => (
        <i key={step.id} className={`h-1 w-4 ${checks[step.id]?.done === true ? 'bg-ink' : 'bg-hairline-strong'}`} />
      ))}
    </span>
  )

  if (done === count) {
    return (
      <div className="fc-pop-enter flex flex-wrap items-center gap-3 text-[13px] text-ink-secondary" data-guide="home.line">
        {meter}
        <span>Getting started: all {count} places done.</span>
        <Button variant="ghost" size="sm" onClick={() => openGuide(0)}>
          Walk it again
        </Button>
      </div>
    )
  }

  const next = steps[firstOpen(steps, checks)]
  return (
    <div className="fc-pop-enter flex flex-wrap items-center gap-3 text-[13px] text-ink-secondary" data-guide="home.line">
      {meter}
      <span>
        Getting started, {done} of {count} done.{next === undefined ? '' : ` Next: ${asNext(next)}.`}
      </span>
      <Button variant="ghost" size="sm" onClick={() => openGuide()}>
        {done > 0 || progress.started ? 'Continue the guide' : 'Guide me'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => guide.save({ ...progress, lineAway: true })}>
        Put this away
      </Button>
    </div>
  )
}
