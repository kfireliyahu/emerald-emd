import { Link } from 'react-router-dom'

import { asNext, doneCount, firstOpen } from '@/domain/guide.ts'
import { useT } from '@/i18n/current.ts'
import { fillNodes } from '@/i18n/nodes.tsx'
import { Button } from '@/ui/components/Button.tsx'

import { openGuide, useGuideOpen } from './guideState.ts'
import { useGuide } from './useGuide.ts'

/**
 * **Getting started, in one line — and where the guide resumes** (M28 U9,
 * choices a and c, B). Onboarding's checklist line, become the guide's: how far,
 * the next place, and a press to continue from where it stopped. Its steps tick
 * themselves from what the document holds. **Dismiss** hides it for this
 * document — kept in the document, so it holds on every machine (M59 U5,
 * D-581) — and Help › Guide me, the palette and the rail still open the guide.
 * It is the only thing on Home that opens the guide, and only when pressed.
 *
 * Hidden while the guide is open — the dialog is saying the same thing.
 */
export function GuideLine() {
  const t = useT()
  const open = useGuideOpen()
  const guide = useGuide(open === undefined)
  if (open !== undefined || guide === undefined || guide.progress.lineAway) return null

  const { steps, checks, progress } = guide
  const dismiss = (
    <Button variant="ghost" size="sm" onClick={() => guide.save({ ...progress, lineAway: true })}>
      {t('home.guide.dismiss')}
    </Button>
  )
  const count = steps.length
  const done = doneCount(steps, checks)
  const meter = (
    <span className="flex gap-1" aria-hidden>
      {steps.map((step) => (
        <i key={step.id} className={`h-1 w-4 ${checks[step.id]?.done === true ? 'bg-ink' : 'bg-hairline-strong'}`} />
      ))}
    </span>
  )

  if (done === count) {
    return (
      <div className="fc-pop-enter flex flex-wrap items-center gap-3 text-ink-secondary" data-guide="home.line">
        {meter}
        <span>{t('home.guide.allDone', { count })}</span>
        <Button variant="ghost" size="sm" onClick={() => openGuide(0)}>
          {t('home.guide.again')}
        </Button>
        {dismiss}
      </div>
    )
  }

  const next = steps[firstOpen(steps, checks)]
  return (
    <div className="fc-pop-enter flex flex-wrap items-center gap-3 text-ink-secondary" data-guide="home.line">
      {meter}
      <span>
        {t('home.guide.progress', { done, count })}
        {next !== undefined && (
          <>
            {' '}
            {/* **The step it names is a link to its place** (M59 U6, D-582): the
                screen, without the guide — so a place the rail holds back is
                one click from here. Home's own step is the band just above. */}
            {fillNodes(t('home.guide.next'), {
              step:
                next.route === '/' ? (
                  asNext(next)
                ) : (
                  <Link to={next.route} className="text-accent underline underline-offset-4 hover:text-accent-hover">
                    {asNext(next)}
                  </Link>
                ),
            })}
          </>
        )}
      </span>
      <Button variant="ghost" size="sm" onClick={() => openGuide()}>
        {done > 0 || progress.started ? t('home.guide.continue') : t('home.guide.start')}
      </Button>
      {dismiss}
    </div>
  )
}
