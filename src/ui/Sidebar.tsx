import { Fragment } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

import { guideFor } from '@/data/packs/packs.ts'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { EmeraldMark } from '@/ui/EmeraldMark.tsx'
import { openGuide, useGuideOpen } from '@/ui/guide/guideState.ts'
import { NavGlyph } from '@/ui/NavGlyph.tsx'
import { activeTab, childIsActive, railSectionFor, railSections, type NavChild, type NavSection } from '@/ui/nav.ts'
import { useDocumentRead } from '@/state/reading.ts'
import { useSlipBatch } from '@/state/slipBatch.ts'
import { Working } from '@/ui/components/Working.tsx'
import { useFormatPlaces } from '@/ui/formats/places.ts'
import { packRails, showingOf, useKeptPacks } from '@/ui/packs.ts'
import { RailFolder, useDeclarations } from '@/ui/RailFolder.tsx'
import { ThemeCycleButton, ThemeToggle } from '@/ui/components/ThemeToggle.tsx'
import { toggleSidebar, useSidebarCollapsed } from '@/ui/useSidebar.ts'

/**
 * The navigation, down the left side (D-130, reversing D-054).
 *
 * D-054 rejected this on width and it was right about a browser tab: a
 * permanent 200px column is a permanent tax on a viewport the app does not
 * control. The app owns the window now, so the column replaces a row — and the
 * row it replaces was taller than the column is wide, because four sections
 * were each drawing a *second* navigation row of their own. Those are gone:
 * `Plan`, `Wealth`, `Insights` and `Settings` keep their routes and their
 * children appear here instead.
 *
 * **A child is active for its own tabs too** (D-157). Wealth's *Savings &
 * debts* is one place with three views, so standing on the money map lights the
 * child it is a view of — the alternative is a rail with nothing marked on it,
 * which is how the seven-child version read whenever you drilled anywhere.
 *
 * **Sections expand in place, and by route rather than by click.** You are in
 * a section or you are not; there is no third state to remember, no disclosure
 * triangle, and a drill-through that lands deep in `/wealth` opens the same
 * section a click on Wealth would have. **A format is the one exception** (M37
 * U2, D-475): it is a folder of its entries with an arrow of its own, opened by
 * hand and kept per viewer (`RailFolder`), because a folder you cannot open
 * without leaving where you are is not one.
 *
 * **D-125 is the rule this screen is most likely to break**, because a sidebar
 * is mostly active states: `accent` marks the item you are on — a bar at the
 * inline start and a tinted plane — and it colours no figure, because there
 * are none here.
 *
 * `navigable` is false during onboarding and while an import is in progress:
 * navigating mid-review would strand staged rows behind a screen with no way
 * back, and onboarding is a flow with its own way out (docs/06). The *bar*
 * stays either way, narrowed to its icons — the theme control lived in the
 * header before this, and an onboarding flow you cannot change the theme from
 * is a state the header never had.
 */
export function Sidebar({ navigable }: { navigable: boolean }) {
  const preference = useSidebarCollapsed()
  const collapsed = preference || !navigable
  const { pathname } = useLocation()
  // **Off the filtered list, and the active section off the whole one** (M20
  // U0, D-227). A staged place still expands and still marks its child when a
  // bookmark lands you in it; what it does not do is take a line in the rail.
  // A kept pack that declares views is drawn from them (M27 U7), and the
  // section a path is in is asked of the rail first: `/formats/unit/board` is
  // the development pack's, not `Formats`'.
  const kept = useKeptPacks()
  const sections = railSections(showingOf(kept), useFormatPlaces(), packRails(kept))
  const current = railSectionFor(sections, pathname)
  const busy = useBusyPlaces()
  const document = useDeclarations()

  return (
    <nav
      aria-label="Sections"
      className="flex shrink-0 flex-col border-r border-hairline bg-surface py-2 transition-[width] duration-[var(--duration-base)] ease-[var(--ease-out)]"
      style={{ width: collapsed ? 56 : 200 }}
    >
      <span
        className="mb-2 flex h-8 items-center gap-2 overflow-hidden px-3.5 font-medium tracking-tight"
        title="Emerald"
      >
        <EmeraldMark />
        {!collapsed && 'Emerald'}
      </span>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {navigable &&
          sections.map((section, index) => (
            <Fragment key={section.to}>
              {/* The engine's places after the ones a pack draws, past a hairline. */}
              {section.pack === undefined && index > 0 && sections[index - 1]?.pack !== undefined && (
                <div className="mx-3.5 my-2 h-px bg-hairline" aria-hidden />
              )}
              <Section
                section={section}
                pathname={pathname}
                collapsed={collapsed}
                current={current?.to === section.to}
                expanded={!collapsed && current?.to === section.to}
                busy={busy.some((path) => path === section.to || path.startsWith(`${section.to}/`))}
                document={document}
              />
            </Fragment>
          ))}
      </div>

      <div
        className={`mt-2 flex items-center gap-2 border-t border-hairline px-3 pt-3 ${
          collapsed ? 'flex-col' : ''
        }`}
      >
        {collapsed ? <ThemeCycleButton /> : <ThemeToggle />}
        {/* Nothing to collapse when there is nothing in the list. */}
        {navigable && (
          <span className={`flex items-center gap-1 ${collapsed ? 'flex-col' : 'ml-auto'}`}>
            {guideFor(kept) !== undefined && <GuideButton />}
            <CollapseButton collapsed={preference} />
          </span>
        )}
      </div>
    </nav>
  )
}

function Section({
  section,
  pathname,
  collapsed,
  current,
  expanded,
  busy,
  document,
}: {
  section: NavSection
  pathname: string
  collapsed: boolean
  current: boolean
  expanded: boolean
  busy: boolean
  document: ReturnType<typeof useDeclarations>
}) {
  // **A section's pages sit under it** (M28 U4, navigation A): its
  // children, or, for a section that has none, the views that were a tab strip
  // above the screen. Either way no strip sits over a screen whose pages the
  // rail already lists.
  const pages = pagesOf(section)
  const litPage = pages.length > 0 ? lit(pages, pathname) : undefined
  return (
    <>
      <NavLink
        to={section.to}
        // The demo's tour finds a place in the rail by this (M33 U2): `nav-formats`.
        data-tour={`nav${section.to === '/' ? '-home' : section.to.replace(/\//g, '-')}`}
        // Spread rather than a literal `undefined`: `exactOptionalPropertyTypes`
        // is on, and an absent prop is not the same as one set to nothing.
        {...(section.end === true ? { end: true } : {})}
        // The label is the tooltip only when it is not also the text: a title
        // on every item makes a tooltip appear over the thing you just read.
        {...(collapsed ? { title: section.label } : {})}
        // A pack's section links to its first view, so it is lit for any of
        // its places; and `Formats` is not lit for a format a pack took.
        className={({ isActive }) => {
          const on = section.glyph === 'pack' ? current : isActive && (current || section.to !== '/formats')
          // An open section whose page is lit beneath it is ink, not a plane:
          // the page carries the marker, and two markers is none.
          // A section arrives like a row (M39 F1): a document opening, or a pack kept.
          return `fc-row-enter ${item(on && !(expanded && litPage !== undefined), on || current, collapsed)}`
        }}
      >
        {collapsed && busy ? (
          <Working size={16} label={`${section.label}: working`} />
        ) : (
          <NavGlyph glyph={section.glyph} />
        )}
        {!collapsed && <span className="truncate">{section.label}</span>}
        {/* Work in progress under this section (a batch of slips being read, a
            document being read), shown where the work is, wherever you are. */}
        {!collapsed && busy && (
          <span className="ml-auto flex" title="Working">
            <Working size={14} label={`${section.label}: working`} />
          </span>
        )}
      </NavLink>

      {expanded &&
        pages.map((child, index) => (
          <Fragment key={child.to}>
            {/* **A pack's formats under the pack's name** (M33 F3): a heading
                where a group starts, not a link — the pack is not a place. */}
            {child.group !== undefined && child.group !== pages[index - 1]?.group && (
              <span className="fc-row-enter flex h-7 items-end truncate pr-3.5 pb-1 pl-10 text-caption text-ink-tertiary">
                {child.group}
              </span>
            )}
            {/* **A format is a folder of its entries** (M37 U2, D-475): an arrow
                beside its name, which amends this file's no-disclosure rule for
                formats only — the sections still expand by route. */}
            {child.format !== undefined ? (
              <RailFolder
                child={child}
                name={child.format}
                lit={child === litPage}
                pathname={pathname}
                db={document.db}
                declarations={document.declarations}
              />
            ) : (
            /* A plain `Link`: `NavLink`'s own match is the child's path, and a
                child is also active for every tab of it (D-157). Only the deepest
                is lit: a pack's `Unit board` is inside its `Unit` (M27 U7). */
            <Link
              to={child.to}
              // A page arrives like a row: a section opening, or a format just made (M39 F1).
              className={`fc-row-enter ${childItem(child === litPage, child.group !== undefined)}`}
              // The tour's anchor (M33 U2): `nav-formats-receipt`, as a section's is `nav-formats`.
              data-tour={`nav${child.to.replace(/\//g, '-')}`}
            >
              <span className="truncate">{child.label}</span>
            </Link>
            )}
          </Fragment>
        ))}
    </>
  )
}

/** A section's pages: its children, or its own views when it has none. */
function pagesOf(section: NavSection): readonly NavChild[] {
  return section.children ?? (section.tabs !== undefined && section.tabs.length > 1 ? section.tabs : [])
}

/**
 * Which places have work running under them: the batch of payslips being read,
 * and a single document being read, at the path it was started from.
 */
function useBusyPlaces(): readonly string[] {
  const batch = useSlipBatch()
  const read = useDocumentRead()
  const places: string[] = []
  if (batch.progress !== undefined) places.push('/paychecks')
  if (read?.working === true) places.push(read.at.replace(/^#/, ''))
  return places
}

/** The page a path is on: the deepest, when one page's path holds another's. */
function lit(pages: readonly NavChild[], pathname: string): NavChild | undefined {
  let best: NavChild | undefined
  for (const child of pages) {
    const hit = child.to === '/' ? pathname === '/' : childIsActive(child, pathname)
    if (hit && (best === undefined || child.to.length > best.to.length)) best = child
  }
  return best ?? activeTab(pages, pathname)
}

/**
 * The active marker: a 2px `accent` bar at the inline start over an
 * `accent-soft` plane, square and full width (M28 U4), the sidebar's form of
 * the underline the top nav used (D-125: `accent` marks what you can act on).
 */
function item(marked: boolean, inked: boolean, collapsed: boolean): string {
  return [
    'relative flex h-8 shrink-0 items-center gap-2.5 px-3.5 text-[13px]',
    collapsed ? 'justify-center' : '',
    'transition-colors duration-[var(--duration-micro)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    marked
      ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent'
      : inked
        ? 'text-ink'
        : 'text-ink-secondary hover:text-ink',
  ].join(' ')
}

/**
 * A page, indented under its section, 28px, and lit the way a section is — and
 * once more under a pack's name when it is one of the pack's formats (M33 F3).
 */
function childItem(active: boolean, grouped: boolean): string {
  return [
    `relative flex h-7 items-center pr-3.5 ${grouped ? 'pl-14' : 'pl-10'} text-[13px]`,
    'transition-colors duration-[var(--duration-micro)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    active
      ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent'
      : 'text-ink-secondary hover:text-ink',
  ].join(' ')
}

/**
 * **Guide me, in the chrome** (M28 F16). Help › Guide me and the palette are
 * out of sight, and Home's line can be put away, so the guide had no place you
 * could see from every screen. The compass is the dialog's own mark; the look
 * is the collapse button's beside it. It only opens the guide, where it stopped.
 */
function GuideButton() {
  const open = useGuideOpen() !== undefined
  return (
    <button
      type="button"
      onClick={() => openGuide()}
      aria-pressed={open}
      title="Guide me"
      className={`${CHROME_ICON} ${open ? 'text-ink' : 'text-ink-tertiary'}`}
    >
      <ActionGlyph name="guide" />
      <span className="sr-only">Guide me</span>
    </button>
  )
}

const CHROME_ICON =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors duration-[var(--duration-micro)] hover:bg-background hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function CollapseButton({ collapsed }: { collapsed: boolean }) {
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-pressed={collapsed}
      title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
      className={`${CHROME_ICON} text-ink-tertiary`}
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <path d="M6.5 3v10" />
        {/* The chevron points where the panel is going, not where it is. */}
        <path d={collapsed ? 'M9.5 6.5 11 8l-1.5 1.5' : 'M11.5 6.5 10 8l1.5 1.5'} />
      </svg>
      <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
    </button>
  )
}
