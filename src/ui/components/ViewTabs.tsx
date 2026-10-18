import { Link, useLocation } from 'react-router-dom'

import { activeTab, isSectionTabs, tabsFor } from '@/ui/nav.ts'
import { useSidebarCollapsed } from '@/ui/useSidebar.ts'
import { useWindowTaken } from '@/ui/useFullWindow.ts'

/**
 * The views of one screen, as a strip above it (D-157).
 *
 * The sidebar lists *places*; this lists views of the place you are already in
 * — savings and debts, the funds list and what its fees cost you, the month and
 * the year. Wealth had seven sidebar children before this and three after, and
 * the four that left did not become harder to reach: they became tabs, which is
 * what they always were.
 *
 * **It is drawn from `nav.ts` and holds no list of its own** (D-130). Which
 * strip you get is decided by where you are standing, so a screen does not have
 * to declare its own siblings and cannot disagree with the palette about them.
 *
 * **The active tab is an underline, not a plane** — docs/11's "active nav
 * underline", and `accent` on it is exactly what D-125 permits: it marks a
 * thing you can act on, and there is no figure here to colour.
 *
 * **A section's own views moved into the rail** (M28 U4):
 * navigation A lists a section's pages under it, so what is left here is the
 * views of a *child* (Wealth's) until their screens get their own pass, and a
 * section's views while the rail is collapsed.
 *
 * **And it is gone while a flow has the window** (D-163). docs/06 calls that
 * shape "outside the tabs" and it turns out to have meant it literally: a strip
 * offering to leave, above a form whose one way out is its own, is two answers
 * to the same question.
 */
export function ViewTabs() {
  const { pathname } = useLocation()
  const taken = useWindowTaken()
  const tabs = tabsFor(pathname)
  const collapsed = useSidebarCollapsed()
  if (taken || tabs === undefined || tabs.length < 2) return null
  // A section's own views are its pages in the rail (M28 U4, navigation A);
  // the strip stands in for them only while the rail is down to its glyphs.
  if (isSectionTabs(tabs) && !collapsed) return null

  const current = activeTab(tabs, pathname)

  return (
    <nav
      aria-label="Views"
      className="flex shrink-0 items-center gap-1 border-b border-hairline px-6"
    >
      {tabs.map((tab) => {
        const active = tab.to === current?.to
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={[
              'relative -mb-px flex h-8 items-center rounded-t px-3 text-caption',
              'transition-colors duration-[var(--duration-micro)]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
              active
                ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent'
                : 'text-ink-tertiary hover:text-ink',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
