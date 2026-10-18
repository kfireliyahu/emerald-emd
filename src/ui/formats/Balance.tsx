import type { ReactNode } from 'react'

import type { WeighedBalance, WeighedPan } from '@/domain/format/balance.ts'
import {
  figureText,
  toleranceText,
  verdictSentence,
  type IdentityDeclaration,
  type Verdict,
} from '@/domain/format/identity.ts'

/**
 * **The balance** — M20 U4, D-232, and **reading only** since T4, D-236.
 *
 * *These things, weighted, equal that thing.* Two pans with a chip apiece for
 * every weighed column, the `=` between them, and how far apart they may be
 * under it — drawn over what a row actually did, chip by chip.
 *
 * ## The half of this that was built and then taken away
 *
 * U4 drew the same picture twice: a row being judged, and **a person
 * assembling one**. Both were driven and the two halves came back with
 * opposite verdicts — the verdict half was *"okay"*, the builder was
 * *counterintuitive* and the second surface in two milestones to be. **The
 * balance is a good way to read a verdict and a bad way to write one**: reading,
 * you are handed the picture and asked what it says; writing, you are handed two
 * empty pans and asked to assemble algebra.
 *
 * So the builder is gone and `WorkedOut.tsx` asks about one column instead
 * (D-236). Nothing about how a row is judged changed with it, which is what
 * *"must leave the reading half alone"* meant.
 *
 * ## Nothing here is stored, and nothing here proves anything
 *
 * A balance is a view over `IdentityDeclaration.expression`, which is still a
 * string and still the only storage (`balance.ts` argues it, and T4 writes
 * through the same file).
 *
 * The verdict drawn is `evaluateIdentity`'s, arrived at from the equation's own
 * two sides; the chips are a decomposition to read, never a second arithmetic
 * (D-138). **The sentence stays under the picture** for the same reason docs/11
 * pairs every chart with its numbers: take the balance away and nothing is lost.
 */

/* ------------------------------------------------------------ the verdict */

/**
 * What a row did, on the balance it was judged by.
 *
 * **The verdict is a prop and is never taken off the picture.** `weighed`
 * carries one of its own — the same function on the same row, so the same
 * answer — and reading it here would still make this the second place a screen
 * could learn what a row proved. It supplies chips and pan totals and nothing
 * else (D-138).
 */
export function BalanceProof({
  declaration,
  verdict,
  weighed,
  figure = figureText,
}: {
  declaration: IdentityDeclaration
  verdict: Verdict
  weighed: WeighedBalance
  /** How a figure is printed — a check over percents alone prints `55%`, not `0.55` (D-402). */
  figure?: (value: number) => string
}) {
  const unchecked = verdict.kind === 'UNCHECKED'

  return (
    <div className={unchecked ? 'text-ink-tertiary' : undefined}>
      <Scale
        left={<WeighedSide pan={weighed.left} dimmed={unchecked} figure={figure} />}
        right={<WeighedSide pan={weighed.right} dimmed={unchecked} figure={figure} />}
        middle={
          <span className="text-caption text-ink-tertiary">
            {toleranceText(declaration.tolerance, figure)}
          </span>
        }
      />
      <p className={`mt-2 text-caption ${verdictInk(verdict)}`}>
        {verdictSentence(declaration, verdict, figure)}
      </p>
    </div>
  )
}

/**
 * `accent` is nowhere near this: a verdict reports what the app found rather
 * than something to act on, and `accent` colours no figure (D-125). `unchecked`
 * is ordinary ink because it is the common answer on a half-filled row and not
 * a small failure (D-149).
 */
export function verdictInk(verdict: Verdict): string {
  if (verdict.kind === 'PROVED') return 'text-positive'
  if (verdict.kind === 'FAILED') return 'text-negative'
  return 'text-ink-secondary'
}

function WeighedSide({
  pan,
  dimmed,
  figure,
}: {
  pan: WeighedPan
  dimmed: boolean
  figure: (value: number) => string
}) {
  // A pan of one chip already has the pan's figure under the rule, so the chip
  // does not print it twice — `kcal / 62 / 62` is the same number said three
  // times, and the second one reads as arithmetic that went nowhere.
  const alone = pan.terms.length === 1

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex flex-wrap items-stretch justify-center gap-1">
        {pan.terms.map((each, index) => (
          <div key={`${each.text}-${index}`} className="flex items-center gap-1">
            {index > 0 && (
              <span aria-hidden className="text-ink-tertiary">
                {each.sign < 0 ? '−' : '+'}
              </span>
            )}
            <ChipFrame dimmed={dimmed || each.value.kind === 'UNKNOWN'}>
              <span className="font-mono text-caption">
                {each.sign < 0 && index === 0 ? '−' : ''}
                {each.text}
              </span>
              {each.value.kind === 'UNKNOWN' ? (
                <span className="text-caption text-ink-tertiary" title={each.value.reason}>
                  not here
                </span>
              ) : (
                !alone && (
                  <span className="text-body tabular-nums">{figure(each.value.value)}</span>
                )
              )}
            </ChipFrame>
          </div>
        ))}
      </div>

      <span className="h-px w-full bg-hairline-strong" aria-hidden />
      <span className="text-secondary-number tabular-nums">
        {pan.total.kind === 'NUMBER' ? figure(pan.total.value) : '—'}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------- the layout */

/**
 * Two pans and what sits between them.
 *
 * Side by side where there is room and stacked where there is not, because a
 * balance read top to bottom is still two things and an `=`.
 */
function Scale({
  left,
  right,
  middle,
}: {
  left: ReactNode
  right: ReactNode
  middle: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 md:flex-row md:items-center md:justify-center md:gap-4">
      <div className="min-w-0 flex-1">{left}</div>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span aria-hidden className="text-title text-ink-tertiary">
          =
        </span>
        {middle}
      </div>
      <div className="min-w-0 flex-1">{right}</div>
    </div>
  )
}

/**
 * A chip is a hairline box and never a filled pill — docs/11 rules those out,
 * and a row of coloured pills would read as a dashboard rather than as
 * arithmetic.
 */
function ChipFrame({ children, dimmed }: { children: ReactNode; dimmed: boolean }) {
  return (
    <span
      className={`flex flex-col items-center gap-0.5 rounded-md border px-2 py-1 ${
        dimmed ? 'border-hairline text-ink-tertiary' : 'border-hairline-strong'
      }`}
    >
      {children}
    </span>
  )
}
