import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import { createStore } from '@/state/store.ts'

/**
 * Whether the sidebar is collapsed to its icons, remembered across launches
 * (D-130).
 *
 * D-054 rejected collapse-to-icons as "a second design to build and maintain
 * for a window size this app's tables are already uncomfortable in". The
 * window sets its own minimum now, so that size does not exist and this stops
 * being a responsive breakpoint that has to be right unattended: it is a
 * *preference*, for the mapper and the import review, where the width is worth
 * more than the labels.
 *
 * The same plain store as `useTheme`, and for the same reason: one boolean,
 * read from `localStorage`, that both a keyboard shortcut and the shell's View
 * menu have to be able to flip from outside React.
 */

const STORAGE_KEY = 'fc-sidebar-collapsed'

function read(): boolean {
  // Nothing stored, or no storage: expanded, which is the honest default.
  return readPreference(STORAGE_KEY) === 'true'
}

const collapsed = createStore(read())

export function isSidebarCollapsed(): boolean {
  return collapsed.get()
}

export function setSidebarCollapsed(next: boolean): void {
  if (next === collapsed.get()) return
  writePreference(STORAGE_KEY, String(next))
  collapsed.set(next)
}

export function toggleSidebar(): void {
  setSidebarCollapsed(!collapsed.get())
}

export function useSidebarCollapsed(): boolean {
  return collapsed.use()
}
