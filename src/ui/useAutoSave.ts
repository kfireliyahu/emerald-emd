import { useEffect } from 'react'

import { startAutoSave } from '@/state/autoSaveRunner.ts'

/**
 * The app writes the document instead of asking you to (D-155).
 *
 * Mounted once beside `useDiskWatch`, which is its other half: one notices the
 * file changing underneath us, this one writes to it, and they are the same
 * decision seen from two sides — D-127 made the save a
 * write-a-sibling-and-rename over a real path, which is what makes an automatic
 * write safe enough to consider at all.
 *
 * Everything that decides *whether* and *when* is in `startAutoSave`, with no
 * React around it, so it can be driven by a test.
 */
export function useAutoSave(): void {
  useEffect(() => startAutoSave(), [])
}
