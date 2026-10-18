import type { ColumnType } from '@/domain/format/declaration.ts'

/**
 * **One glyph per column type** — M20 U3, and three more in M24 U6.
 *
 * Hand-drawn, for the reason `NavGlyph` gives and `docs/11` gives about the
 * charts: an icon set is a package, a build step and a licence for nine paths.
 * One weight, one size, `currentColor`, so a tile that is selected needs no
 * second rule for its glyph.
 *
 * **docs/11 rules out icons decorating list rows, and these are not that.** A
 * glyph here is on the control a person is *operating* — the tile being
 * chosen between, and the button that says what was chosen. It carries the
 * distinction the word alone does not, which is the whole of this unit: the
 * pair that actually costs people is `integer` against `real`, and a staircase
 * beside a curve says *whole steps* against *anywhere along here* faster than
 * either word does.
 *
 * Each says what the type *is about* rather than what it looks like: `text` is
 * a letter, `enum` is a list with one of them chosen, `link` is one thing
 * pointing at another, `quantity` is a vessel with graduations because the unit
 * travels with the figure.
 */
export function TypeGlyph({ type, className }: { type: ColumnType; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className ?? 'h-4 w-4 shrink-0'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[type]}
    </svg>
  )
}

const PATHS: Record<ColumnType, React.ReactNode> = {
  // A letterform. Words, and nothing measured.
  text: (
    <>
      <path d="M3.5 12.5 8 3.5l4.5 9" />
      <path d="M5.4 9.5h5.2" />
    </>
  ),
  // A staircase: whole steps, and nothing between two of them. Its twin is
  // `real` below, and the pair is the one this unit exists for.
  integer: (
    <>
      <path d="M2.5 12.5h3v-3h3v-3h3v-3h2" />
    </>
  ),
  // The same idea made continuous — a smooth run with a point that can sit
  // anywhere along it.
  real: (
    <>
      <path d="M2.5 12.5C6 12.5 10 4 13.5 4" />
      <circle cx="8" cy="8.4" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  // A calendar: a day, and never a time of day.
  date: (
    <>
      <path d="M2.5 4.5h11a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5Z" />
      <path d="M2 7.5h12" />
      <path d="M5.5 2.5v3M10.5 2.5v3" />
      <circle cx="8" cy="10.5" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  // A switch, thrown. Two states and nothing between them.
  boolean: (
    <>
      <rect x="2" y="5" width="12" height="6" rx="3" />
      <circle cx="10.9" cy="8" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  // A list with one of them chosen, which is exactly what the type means.
  enum: (
    <>
      <path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7" />
      <circle cx="3.2" cy="4.5" r="1" />
      <circle cx="3.2" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.2" cy="11.5" r="1" />
    </>
  ),
  // The same list with several chosen, ticked rather than dotted (M34 U5,
  // D-398): boxes take more than one where a radio takes one.
  enums: (
    <>
      <path d="M7 4.5h6.5M7 8h6.5M7 11.5h6.5" />
      <rect x="1.8" y="3.2" width="2.8" height="2.6" rx="0.5" />
      <path d="M2.3 4.5l.7.7 1.3-1.4" />
      <rect x="1.8" y="6.7" width="2.8" height="2.6" rx="0.5" />
      <rect x="1.8" y="10.2" width="2.8" height="2.6" rx="0.5" />
      <path d="M2.3 11.5l.7.7 1.3-1.4" />
    </>
  ),
  // A coin with a stem and two bars — a currency mark that is no currency in
  // particular, because the currency is in the row rather than in the type.
  money: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.6v6.8" />
      <path d="M5.9 6.7h4.2M5.9 9.3h4.2" />
    </>
  ),
  // One thing pointing at another. A link is a relation, not a value.
  link: (
    <>
      <rect x="1.5" y="5.5" width="4.5" height="5" rx="1" />
      <rect x="10" y="5.5" width="4.5" height="5" rx="1" />
      <path d="M6.6 8h2.9" />
      <path d="M8.4 6.9 9.6 8l-1.2 1.1" />
    </>
  ),
  // A link leaving the page (M47 U4, D-461): the source, and an arrow out of
  // the corner of a sheet — the row is in another document.
  elsewhere: (
    <>
      <rect x="1.5" y="5.5" width="4.5" height="5" rx="1" />
      <path d="M9 3.5h3.5V13H9" />
      <path d="M6.6 8h6M10.8 6.2 12.6 8l-1.8 1.8" />
    </>
  ),
  // A sheet with its corner folded (M37 U6): a file, wherever it is.
  file: (
    <>
      <path d="M4 1.5h5.5L12.5 4.5V14.5H4z" />
      <path d="M9.5 1.5v3h3" />
    </>
  ),
  // One thing pointing at several (M27 U2, D-300): the link's source, fanned.
  links: (
    <>
      <rect x="1.5" y="5.5" width="4.5" height="5" rx="1" />
      <rect x="10.5" y="1.5" width="4" height="3.5" rx="0.8" />
      <rect x="10.5" y="6.25" width="4" height="3.5" rx="0.8" />
      <rect x="10.5" y="11" width="4" height="3.5" rx="0.8" />
      <path d="M6.6 8 10 3.3M6.6 8h3.4M6.6 8l3.4 4.7" />
    </>
  ),
  // A vessel with graduations: a figure that carries what it is measured in.
  quantity: (
    <>
      <path d="M4.5 2.5h7" />
      <path d="M5.5 2.5v9.2a1.8 1.8 0 0 0 1.8 1.8h1.4a1.8 1.8 0 0 0 1.8-1.8V2.5" />
      <path d="M5.5 6h1.8M5.5 8.6h1.8M5.5 11.2h1.8" />
    </>
  ),
  // A ruler cut at a fixed step: a figure whose places are declared (D-257).
  decimal: (
    <>
      <path d="M2 11.5h12" />
      <path d="M3 11.5v-3M6.33 11.5v-2M9.67 11.5v-2M13 11.5v-3" />
      <circle cx="8" cy="4.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // The sign itself: a share of something (D-333).
  percent: (
    <>
      <path d="M12.5 3.5l-9 9" />
      <circle cx="4.75" cy="4.75" r="1.75" />
      <circle cx="11.25" cy="11.25" r="1.75" />
    </>
  ),
  // The calendar again, with the whole grid rather than one day in it.
  month: (
    <>
      <path d="M2.5 4.5h11a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5Z" />
      <path d="M2 7.5h12" />
      <path d="M5.5 2.5v3M10.5 2.5v3" />
      <path d="M4.5 10.5h7" />
    </>
  ),
  // A clock face: a moment, where a date is a day.
  instant: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2.2 1.3" />
    </>
  ),
  // A wall clock — the hours marked, no date anywhere (M29 U4, D-335).
  time: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5v1.2M13.5 8h-1.2M8 13.5v-1.2M2.5 8h1.2" />
      <path d="M8 8V5.4M8 8H5.9" />
    </>
  ),
}
