import { Link, useLocation } from 'react-router-dom'

import { useT } from '@/i18n/current.ts'
import { activeTab, holdTabs, placeName, tabsFor } from '@/ui/nav.ts'
import { useHeldBack } from '@/ui/heldBack.ts'
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
 * **A section's own views came back here** (M64 U4, D-614, D-615): M28 U4
 * listed them under the section in the rail, and the redesign's rail is an
 * index of places in words, so the strip draws a section's views and a
 * child's alike, whatever width the rail is.
 *
 * **And it is gone while a flow has the window** (D-163). docs/06 calls that
 * shape "outside the tabs" and it turns out to have meant it literally: a strip
 * offering to leave, above a form whose one way out is its own, is two answers
 * to the same question.
 */
export function ViewTabs() {
  const { pathname } = useLocation()
  const taken = useWindowTaken()
  const declared = tabsFor(pathname)
  // A held-back view stays out of the strip as out of the rail (M59 U6, D-582).
  const held = useHeldBack()
  const t = useT()
  const tabs =declared === undefined ? undefined : holdTabs(declared, held, pathname)
  if (taken || declared === undefined || tabs === undefined || tabs.length < 2) return null
  // **A section's views are always this strip** (M64 U4, D-614, D-615): the
  // rail is an index of places, so Home's month and year, Paychecks' deduction
  // types and Categories' rules are tabs here and never rows beneath it.

  const current = activeTab(tabs, pathname)

  return (
    <nav
      aria-label={t('chrome.components.views')}
      className="flex shrink-0 items-center gap-1 border-b border-hairline px-6"
    >
      {tabs.map((tab) => {
        const active = tab.to === current?.to
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            // The tour's anchor, as it was when these were rows in the rail (M33 U2).
            data-tour={`nav${tab.to.replace(/\//g, '-')}`}
            className={[
              'relative -mb-px flex h-8 items-center px-3 text-caption',
              'transition-colors duration-[var(--duration-micro)]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
              active
                ? 'font-medium text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-accent'
                : 'text-ink-secondary hover:text-ink',
            ].join(' ')}
          >
            {placeName(tab, t)}
          </Link>
        )
      })}
    </nav>
  )
}
