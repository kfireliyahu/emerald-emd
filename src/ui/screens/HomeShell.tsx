import { Outlet } from 'react-router-dom'

import { ViewTabs } from '@/ui/components/ViewTabs.tsx'

/**
 * Home, and the period you are looking at it over (D-157).
 *
 * **Insights is not a section any more.** It was three screens under a heading
 * that named a genre rather than a thing, and its first screen and this one
 * both called `monthlyReport` and both drew the month's headline — the
 * duplication D-071 exists to prevent, on the two screens most likely to be
 * compared. So the month *is* Home, and the year and trends are the same
 * question over a longer window: a period, which is a property of a view and
 * not a place of its own.
 *
 * The strip is `ViewTabs`, drawn from `nav.ts` like every other one, so the
 * palette and the sidebar cannot disagree with it about what exists.
 */
export function HomeShell() {
  return (
    <div className="flex h-full flex-col">
      <ViewTabs />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
