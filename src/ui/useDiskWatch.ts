import { useEffect } from 'react'

import { useDocumentStore } from '@/state/documentStore.ts'

/**
 * How often a browser tab asks the file whether it changed, while the tab is
 * visible. A mark is a stat — `lastModified` and `size` — not a read, so this
 * costs nothing a person would notice.
 */
export const POLL_MS = 2_000

/**
 * Notice that the file changed underneath us — and, when nothing here is
 * unsaved, **take the change without asking** (M27 U6).
 *
 * The other half of D-092's answer to two writers, one file: `save()` checks
 * before it writes, and this checks between saves. With unsaved work the app
 * still offers to reload rather than choosing for the user. With none, the file
 * on disk holds everything this window holds and more, so the offer was a
 * question with one answer: the window re-reads it, and the roadmap a session
 * is writing to moves as it writes.
 *
 * **Three triggers for one question.** In the shell the storage adapter is told
 * by the operating system (D-127), so a plugin's write is noticed as it happens.
 * In a browser tab nothing pushes — the File System Access API has no change
 * events — so a visible tab asks every `POLL_MS`; until M27 U6 it asked only on
 * focus, because polling a file nobody is looking at bought nothing, and a
 * roadmap left open to watch a session work is exactly somebody looking at it.
 * Focus is kept in both, because a watch that quietly failed to start should
 * not leave the app with no answer at all.
 */
export function useDiskWatch(): void {
  useEffect(() => {
    let checking = false
    const check = (): void => {
      const { db, busy } = useDocumentStore.getState()
      // Mid-save the mark is about to move on its own, and a check would race
      // the write it is meant to protect.
      if (db === undefined || busy !== undefined || checking) return
      checking = true
      void useDocumentStore.getState().followDisk().finally(() => {
        checking = false
      })
    }

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') check()
    }

    const { adapter } = useDocumentStore.getState()
    const unwatch = adapter.watch?.(check)
    const poll =
      adapter.watch === undefined
        ? window.setInterval(() => {
            if (document.visibilityState === 'visible') check()
          }, POLL_MS)
        : undefined

    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unwatch?.()
      if (poll !== undefined) window.clearInterval(poll)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
