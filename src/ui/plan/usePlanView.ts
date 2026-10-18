import { useState } from 'react'

import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import type { PlanView } from '@/ui/plan/PlanBar.tsx'

const STORAGE_KEY = 'fc-plan-view'

/** Anything but a known value is the bar: a preference gone stale must not break the screen. */
export function parsePlanView(raw: string | null | undefined): PlanView {
  return raw === 'ring' ? 'ring' : 'bar'
}

/**
 * **Which way the plan's money is drawn — a preference of whoever is looking,
 * not a fact about the document** (D-115, D-320). So it is `localStorage`,
 * beside the theme and the sidebar, and every touch of it is allowed to fail:
 * a private window or a blocked store only costs the choice being forgotten.
 */
export function usePlanView(): readonly [PlanView, (next: PlanView) => void] {
  const [view, setView] = useState<PlanView>(() => parsePlanView(readPreference(STORAGE_KEY)))
  const choose = (next: PlanView): void => {
    setView(next)
    writePreference(STORAGE_KEY, next)
  }
  return [view, choose] as const
}
