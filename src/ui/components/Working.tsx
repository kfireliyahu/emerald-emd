import { useId, type CSSProperties } from 'react'

import { CORE, FACETS, GLINTS } from '@/ui/gem.ts'

/**
 * **The one progress indicator** (M28 U4): the mark, cut into its facets,
 * flying in and assembling, holding, and coming apart again for as long as
 * something is in progress — reading, writing, opening, saving.
 *
 * Every loading or in-progress state in the app is this, at the size of where
 * it sits: 14 in a chip or a button, 16–24 in a row, 56 leading a screen. It
 * does not count. A batch of slips cycles until it is done and the count stays
 * in words beside it, which was chosen over a gem that fills
 * facet by facet.
 *
 * **It is the one idle animation the app allows** (docs/11, amended by this
 * unit's decision): a loading state may run longer than one cycle when it is
 * this, because it stands for work that is genuinely still going. Under reduced
 * motion nothing moves: the facets only light in turn, which `tokens.css` keeps
 * running past the global rule that stops every other animation.
 *
 * `label` names the work for a screen reader; leave it out when a sentence
 * beside the gem already says it, and it is hidden from the reader.
 * `still` is the mark at rest, for a place that shows the gem without work.
 */
export function Working({
  size = 16,
  label,
  still = false,
  className,
}: {
  readonly size?: number
  readonly label?: string | undefined
  readonly still?: boolean
  readonly className?: string
}) {
  const id = `fc-gem-${useId().replace(/:/g, '')}`
  const named = label !== undefined
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`fc-gem ${still ? '' : 'fc-gem-spin'} ${className ?? ''}`}
      {...(named ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-working={still ? undefined : ''}
    >
      <defs>
        <linearGradient id={id} x1="25.448" y1="18.4592" x2="38.9888" y2="45.5408" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8FCF2" />
          <stop offset="1" stopColor="#34D399" />
        </linearGradient>
      </defs>
      {FACETS.map((facet, index) => (
        <path
          key={facet.d}
          className="fc-facet"
          d={facet.d}
          fill={facet.fill}
          style={place(index, facet.dx, facet.dy)}
        />
      ))}
      <g className="fc-facet" style={place(FACETS.length, 0, 0)}>
        <path d={CORE} fill={`url(#${id})`} />
        {GLINTS.map(([d, opacity]) => (
          <path key={d} d={d} fill="white" fillOpacity={opacity} />
        ))}
      </g>
    </svg>
  )
}

function place(index: number, dx: number, dy: number): CSSProperties {
  return { '--i': index, '--dx': `${String(dx)}px`, '--dy': `${String(dy)}px` } as CSSProperties
}
