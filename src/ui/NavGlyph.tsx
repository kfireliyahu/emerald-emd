import type { NavGlyph as Glyph } from '@/ui/nav.ts'

/**
 * A glyph per place, hand-drawn, for the sidebar collapsed to icons (D-130).
 *
 * Hand-drawn rather than a dependency for the reason
 * [11 UI Design Language](../../docs/11-ui-design-language.md) gives about the
 * charts: an icon set is a package, a build step and a licence for nine
 * paths. They are one weight, one size and one colour — `currentColor`, so the
 * active and inactive states of a nav item need no second rule for the icon.
 *
 * Each one says what its section *is about* rather than what it looks like: a
 * ledger is lines with marks, a payslip is a sheet with a figure on it, a plan
 * is one thing becoming three, wealth is a stack.
 *
 * The trend glyph retired with the Insights section (D-157): the month is Home,
 * and Home already had a roof.
 */
export function NavGlyph({ glyph }: { glyph: Glyph }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[glyph]}
    </svg>
  )
}

const PATHS: Record<Glyph, React.ReactNode> = {
  // A roof over a door.
  home: (
    <>
      <path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5h-3v-4H6v4H3a.5.5 0 0 1-.5-.5Z" />
    </>
  ),
  // A ledger: lines, each with an amount at the end.
  transactions: (
    <>
      <path d="M2.5 4h7M2.5 8h7M2.5 12h7" />
      <path d="M12 4h1.5M12 8h1.5M12 12h1.5" />
    </>
  ),
  // One paycheck becoming three allocations — the splitter, which is what the
  // section is for.
  plan: (
    <>
      <path d="M2.5 8h4" />
      <path d="M6.5 8 10 3.5M6.5 8 10 8M6.5 8 10 12.5" />
      <circle cx="12" cy="3.5" r="1.4" />
      <circle cx="12" cy="8" r="1.4" />
      <circle cx="12" cy="12.5" r="1.4" />
    </>
  ),
  // A stack that grows: what you have put away.
  wealth: (
    <>
      <path d="M2.5 13.5h11" />
      <rect x="3" y="9" width="3" height="4.5" rx="0.6" />
      <rect x="6.75" y="6" width="3" height="7.5" rx="0.6" />
      <rect x="10.5" y="3" width="3" height="10.5" rx="0.6" />
    </>
  ),
  // A payslip: a sheet, its lines, and the one figure at the foot that the
  // whole page exists to arrive at.
  paychecks: (
    <>
      <path d="M3.5 2.5h9a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" />
      <path d="M5.5 5.5h5M5.5 8h5" />
      <path d="M8.5 10.75h2" />
    </>
  ),
  // A tag, which is what a category is.
  categories: (
    <>
      <path d="M8.2 2.5H13a.5.5 0 0 1 .5.5v4.8a1 1 0 0 1-.3.7l-5 5a1 1 0 0 1-1.4 0L2.5 9.2a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 .7-.3Z" />
      <circle cx="10.75" cy="5.25" r="0.9" />
    </>
  ),
  // A table with a header row: a format is columns, and a declared one is a
  // real table. The header is what separates it from the ledger glyph above —
  // that one is rows of money, this one is a shape somebody declared.
  formats: (
    <>
      <path d="M2.5 3.5h11a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" />
      <path d="M2 6.5h12" />
      <path d="M6.5 6.5v6M10 6.5v6" />
    </>
  ),
  // A box with its lid tied: a pack is a set of formats that came together,
  // and the rail draws one section per pack a document keeps (M27 U7).
  pack: (
    <>
      <path d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3Z" />
      <path d="M2.5 5.5 8 8.5l5.5-3M8 8.5v5" />
    </>
  ),
  // Two things joined: a connection is one row naming another, which is the
  // whole of what this screen is about. Deliberately not a chain — a chain is
  // about strength and this is about a pointer.
  connections: (
    <>
      <circle cx="4" cy="4.5" r="2" />
      <circle cx="12" cy="11.5" r="2" />
      <path d="M5.4 6.1 10.6 9.9" />
      <circle cx="12" cy="4.5" r="2" />
    </>
  ),
  // A page of a calendar, its rings and a day marked: what is on, day by day.
  agenda: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
      <path d="M5.5 2v3M10.5 2v3M2.5 7h11" />
      <path d="M5 10h2" />
    </>
  ),
  // A plug: something outside the app connects here.
  mcp: (
    <>
      <path d="M6 2.5v3M10 2.5v3" />
      <path d="M4 5.5h8v2.5a4 4 0 0 1-8 0Z" />
      <path d="M8 12v1.5" />
    </>
  ),
  // Sliders, not a gear: settings here are choices you set, not machinery.
  settings: (
    <>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.5" />
      <circle cx="10.5" cy="8" r="1.5" />
      <circle cx="5" cy="11.5" r="1.5" />
    </>
  ),
}
