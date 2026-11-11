import { Fragment } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { guideFor } from '@/data/packs/packs.ts'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { EmeraldMark } from '@/ui/EmeraldMark.tsx'
import { openGuide, useGuideOpen } from '@/ui/guide/guideState.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { NavGlyph } from '@/ui/NavGlyph.tsx'
import { useT } from '@/i18n/current.ts'
import { activeTab, childIsActive, holdBack, placeName, railSectionFor, railSections, type NavChild, type NavSection } from '@/ui/nav.ts'
import { useHeldBack } from '@/ui/heldBack.ts'
import { useDocumentTitle } from '@/state/documentTitle.ts'
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
  // **A ledger document holds back what it has nothing in** (M59 U6, D-582):
  // the place you stand on keeps its line, and the palette still lists all.
  const sections = holdBack(railSections(showingOf(kept), useFormatPlaces(), packRails(kept)), useHeldBack(), pathname)
  const current = railSectionFor(sections, pathname)
  const busy = useBusyPlaces()
  const document = useDeclarations()
  // **The title names the document and the screen** (M54 F5, WCAG 2.4.2): the
  // page lit in the rail, else its section — the rail is what knows which it is.
  const pages = current === undefined ? [] : pagesOf(current)
  // In the language the app is in (M60 U1): a place the app names by its word.
  const t = useT()
  const titled = (pages.length > 0 ? lit(pages, pathname) : undefined) ?? current
  useDocumentTitle(titled === undefined ? undefined : placeName(titled, t))

  return (
    <nav
      aria-label={t('chrome.rail.sections')}
      // The probe finds the rail by this, whatever language names it (M60 U5, D-590).
      data-rail
      // The rail's two widths are measures of the layout, not steps (M54 F5).
      className={`flex shrink-0 flex-col border-e border-hairline bg-surface py-2 transition-[width] duration-[var(--duration-base)] ease-[var(--ease-out)] ${
        collapsed ? 'w-[56px]' : 'w-[200px]'
      }`}
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
          <span className={`flex items-center gap-1 ${collapsed ? 'flex-col' : 'ms-auto'}`}>
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
  const t = useT()
  const name = placeName(section, t)
  const litPage = pages.length > 0 ? lit(pages, pathname) : undefined
  // A pack's section links to its first view, so it is lit for any of its
  // places; and `Formats` is not lit for a format a pack took.
  const on = section.glyph === 'pack' ? current : linkActive(section, pathname) && (current || section.to !== '/formats')
  // An open section whose page is lit beneath it is ink, not a plane: the page
  // carries the marker, and two markers is none — nor two `aria-current`s
  // (M54 F5): the one marked is the one that is the page.
  const marked = on && !(expanded && litPage !== undefined)
  return (
    <>
      <Link
        to={section.to}
        // The demo's tour finds a place in the rail by this (M33 U2): `nav-formats`.
        data-tour={`nav${section.to === '/' ? '-home' : section.to.replace(/\//g, '-')}`}
        aria-current={marked ? 'page' : undefined}
        // The label is the tooltip only when it is not also the text: a title
        // on every item makes a tooltip appear over the thing you just read.
        {...(collapsed ? { title: name } : {})}
        // A section arrives like a row (M39 F1): a document opening, or a pack kept.
        className={`fc-row-enter ${item(marked, on || current, collapsed)}`}
      >
        {collapsed && busy ? (
          <Working size={16} label={t('chrome.rail.working', { name })} />
        ) : (
          <NavGlyph glyph={section.glyph} />
        )}
        {!collapsed && <Bidi className="truncate">{name}</Bidi>}
        {/* Work in progress under this section (a batch of slips being read, a
            document being read), shown where the work is, wherever you are. */}
        {!collapsed && busy && (
          <span className="ms-auto flex" title={t('chrome.rail.workingTitle')}>
            <Working size={14} label={t('chrome.rail.working', { name })} />
          </span>
        )}
      </Link>

      {expanded &&
        pages.map((child, index) => (
          <Fragment key={child.to}>
            {/* **A pack's formats under the pack's name** (M33 F3): a heading
                where a group starts, not a link — the pack is not a place. */}
            {child.group !== undefined && child.group !== pages[index - 1]?.group && (
              <span className="fc-row-enter flex h-7 min-w-0 items-end pe-3.5 pb-1 ps-10 text-caption text-ink-secondary">
                <Bidi className="min-w-0 truncate">{child.group}</Bidi>
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
              aria-current={child === litPage ? 'page' : undefined}
              // A page arrives like a row: a section opening, or a format just made (M39 F1).
              className={`fc-row-enter ${childItem(child === litPage, child.group !== undefined)}`}
              // The tour's anchor (M33 U2): `nav-formats-receipt`, as a section's is `nav-formats`.
              data-tour={`nav${child.to.replace(/\//g, '-')}`}
            >
              <Bidi className="truncate">{placeName(child, t)}</Bidi>
            </Link>
            )}
          </Fragment>
        ))}
    </>
  )
}

/**
 * Whether a section's link is active, as `NavLink` judged it: its own path, or
 * one under it unless it ends there. A plain `Link` here, because `NavLink`
 * marks every active link `aria-current`, and the rail marks only the one lit.
 */
function linkActive(section: NavSection, pathname: string): boolean {
  const to = section.to
  const path = pathname.toLowerCase()
  const own = to.toLowerCase()
  return path === own || (section.end !== true && own !== '/' && path.startsWith(`${own.replace(/\/$/, '')}/`))
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
    'relative flex h-8 shrink-0 items-center gap-2.5 px-3.5 text-body',
    collapsed ? 'justify-center' : '',
    'transition-colors duration-[var(--duration-micro)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    marked
      ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent'
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
    `relative flex h-7 items-center pe-3.5 ${grouped ? 'ps-14' : 'ps-10'} text-body`,
    'transition-colors duration-[var(--duration-micro)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    active
      ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent'
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
  const t = useT()
  const open = useGuideOpen() !== undefined
  return (
    <button
      type="button"
      onClick={() => openGuide()}
      aria-pressed={open}
      title={t('chrome.rail.guideMe')}
      className={`fc-icon-action ${open ? 'text-ink' : ''}`}
    >
      <ActionGlyph name="guide" />
      <span className="sr-only">{t('chrome.rail.guideMe')}</span>
    </button>
  )
}

function CollapseButton({ collapsed }: { collapsed: boolean }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      // A stable name, the state in `aria-pressed` (M54 F5): pressed, the sidebar is collapsed.
      aria-pressed={collapsed}
      aria-keyshortcuts="Control+B"
      title={t('chrome.rail.collapseTitle')}
      className="fc-icon-action"
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="h-4 w-4 rtl:-scale-x-100"
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
      <span className="sr-only">{t('chrome.rail.collapse')}</span>
    </button>
  )
}
