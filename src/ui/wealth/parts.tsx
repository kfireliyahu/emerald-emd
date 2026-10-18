import type { ReactNode } from 'react'

/**
 * The pieces Wealth's four pages share, ported from the approved mockup
 * (`docs/mockups/m28-u8/wealth.html`, M28 F10) rather than reinterpreted: the page
 * header, the hero line, a section head, the time switch, the bordered chips, the
 * table cells and the small line under a figure. Each class string is the mockup's
 * CSS rule in tokens; the comment beside it names the rule.
 */

/** `.screen`: the page's frame. No width cap: the page takes the window it is given (F2). */
export function Screen({ children }: { children: ReactNode }) {
  return <div className="fc-view-enter @container flex flex-col gap-5 px-8 pt-6 pb-12">{children}</div>
}

/** `.ph`: the title (and anything under it) on the left, the page's actions on the right. */
export function PageHead({ title, under, actions }: { title: string; under?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-4">
      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 text-[24px] leading-[1.15] font-medium tracking-[-0.01em]">{title}</h1>
        {under}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  )
}

/** `.hero`: figures in one ruled line, four (or three) across, two on a narrow page. */
export function Hero({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 }) {
  return (
    <div
      className={`grid grid-cols-2 border-y border-hairline ${columns === 3 ? '@3xl:grid-cols-3' : '@3xl:grid-cols-4'} [&>div+div]:border-l [&>div+div]:border-hairline [&>div+div]:pl-4`}
    >
      {children}
    </div>
  )
}

/** `.hero > div`: a label, the figure, and one quiet line. */
export function HeroCell({
  label,
  small,
  problem = false,
  children,
}: {
  label: string
  small?: ReactNode
  problem?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-3 pr-4">
      <span className="text-label tracking-[0.08em] text-ink-secondary uppercase">{label}</span>
      <span
        className={`text-[22px] leading-[1.2] font-medium tracking-[-0.01em] tabular-nums ${problem ? 'text-flow-out' : ''}`}
      >
        {children}
      </span>
      {small !== undefined && <small className="text-caption text-ink-secondary">{small}</small>}
    </div>
  )
}

/** `.sect` + `.sh`: a section's heading, its one line, and an action on the right. */
export function Section({
  title,
  sub,
  action,
  label,
  guide,
  children,
}: {
  title: ReactNode
  sub?: ReactNode
  action?: ReactNode
  label?: string
  /** A place the guide can point at (M28 U9, S4): `data-guide`. */
  guide?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={label} data-guide={guide}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="m-0 text-[16px] font-medium">{title}</h2>
          {sub !== undefined && <p className="m-0 mt-0.5 text-caption text-ink-secondary">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * `.vseg`: the time switch. The chosen one is accent-soft with an accent edge and
 * ink text, in both themes; never a dark fill (M28 F10's light-mode fault).
 */
export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="flex" role="group" aria-label={label}>
      {options.map(([option, text], index) => {
        const on = option === value
        return (
          <button
            key={String(option)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option)}
            className={`inline-flex h-8 items-center border px-3.5 text-[13px] transition-colors duration-[var(--duration-micro)] ${
              index === 0 ? '' : '-ml-px'
            } ${
              on
                ? 'relative z-[1] border-accent bg-accent-soft text-ink'
                : 'border-hairline-strong text-ink-secondary hover:text-ink'
            }`}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

export type TagTone = 'plain' | 'good' | 'bad' | 'warn' | 'derived' | 'setAside' | 'already' | 'dash'

const TAG_TONE: Readonly<Record<TagTone, string>> = {
  plain: 'border-hairline-strong text-ink-secondary',
  good: 'border-[color-mix(in_srgb,var(--color-positive)_45%,transparent)] text-positive',
  bad: 'border-[color-mix(in_srgb,var(--color-negative)_45%,transparent)] text-negative',
  warn: 'border-[color-mix(in_srgb,var(--color-flow-tax)_45%,transparent)] text-flow-tax',
  derived: 'border-[color-mix(in_srgb,var(--color-flow-saved)_50%,transparent)] text-flow-saved',
  setAside: 'border-dashed border-flow-saved text-flow-saved',
  already: 'border-hairline-strong text-ink-secondary',
  dash: 'border-dashed border-hairline-strong text-ink-secondary',
}

/** `.chip`: uppercase, bordered, square. The tone says what kind of thing it is. */
export function Tag({ tone = 'plain', children }: { tone?: TagTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-[7px] py-0.5 text-[11px] leading-[1.3] font-medium tracking-[0.06em] whitespace-nowrap uppercase ${TAG_TONE[tone]}`}
    >
      {children}
    </span>
  )
}

/** `.need`: the small line under a figure in a right-aligned cell. */
export function Need({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[3px] flex items-center justify-end gap-1.5 text-[11px] whitespace-nowrap text-ink-secondary">
      {children}
    </div>
  )
}

/** `.need button`: a plain accent word that acts. */
export function NeedButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-b border-transparent text-accent hover:border-accent"
    >
      {children}
    </button>
  )
}

/** `.src`: the quiet line under a name. */
export function Src({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-caption text-ink-secondary ${className}`}>{children}</div>
}

/** `th`, `td`, `.gtable td`: the table cells, as class strings. */
export const TH =
  'border-b border-hairline px-2.5 py-2 text-left text-[11px] font-medium tracking-[0.08em] whitespace-nowrap text-ink-tertiary uppercase'
export const TH_R = `${TH} text-right`
/** A plain row: 38px. */
export const TD = 'h-[38px] border-b border-hairline px-2.5 whitespace-nowrap'
/** A deciding row (`.gtable`): 64px, middle. */
export const GTD = 'h-16 border-b border-hairline px-2.5 align-middle whitespace-nowrap'
export const GTD_R = `${GTD} text-right tabular-nums`

/** `.fld.wide`: the amount field in a deciding row. */
export const AMOUNT_FIELD =
  'h-[30px] w-[120px] border border-hairline-strong bg-background px-2 text-right tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** `.legend`: a row of swatches and names. */
export function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-4 text-caption text-ink-secondary">{children}</div>
}

export function LegendItem({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`inline-block h-2 w-3.5 ${swatch}`} />
      {children}
    </span>
  )
}

/** `.k-d`, `.k-n`, `.k-o`: read from the bank (solid), set aside (hatched), already there (grey). */
export const SWATCH = {
  derived: 'bg-flow-saved',
  setAside:
    'bg-[repeating-linear-gradient(135deg,var(--color-flow-saved)_0_3px,transparent_3px_5px)] outline outline-1 -outline-offset-1 outline-flow-saved',
  already: 'bg-ink-tertiary',
} as const
