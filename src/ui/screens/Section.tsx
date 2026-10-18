import { Outlet } from 'react-router-dom'

import { ViewTabs } from '@/ui/components/ViewTabs.tsx'

/**
 * A section, which is now only its routing (D-130).
 *
 * `Plan`, `Wealth`, `InsightsShell` and `Settings` were four copies of the
 * same component: a sub-nav across the top and an `<Outlet/>` under it. D-072
 * defended the duplication — "a fourth copy of five lines still beats a shared
 * `<SectionShell>` whose only variable is a list of links" — and that was
 * right while the links were *drawn* four times.
 *
 * The sidebar draws them once, from `src/ui/nav.ts`, so what is left of each
 * shell is the outlet. Four files of nothing but a comment is worse than one
 * file, so they are this. **Every bookmarked hash still lands where it did**
 * (D-031): `/plan`, `/wealth` and `/settings` still redirect to their first
 * child, and `/insights` is a redirect rather than a section now (D-157).
 *
 * The one thing it draws is the tab strip, and only where the path it is on has
 * one: Wealth's three children cover six screens after D-157, and the strip is
 * how you get between the three that are views of another.
 */
export function Section() {
  return (
    <div className="flex h-full flex-col">
      <ViewTabs />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
