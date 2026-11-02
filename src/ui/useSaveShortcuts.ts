import { useEffect } from 'react'

import { writeSnapshot } from '@/data/storage/crashCache.ts'
import { exportDatabase } from '@/data/db/database.ts'
import { useDocumentStore } from '@/state/documentStore.ts'

const SNAPSHOT_INTERVAL_MS = 30_000

/**
 * Which save a key press asks for: `Ctrl/Cmd+S` saves, and `Ctrl/Cmd+Shift+S`
 * is Save a copy…, as the File menu and the palette both show it (M54 U6) —
 * it used to save in place, because Shift was never looked at.
 */
export function saveShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>): 'save' | 'save-copy' | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return undefined
  return event.shiftKey ? 'save-copy' : 'save'
}

/**
 * The save discipline D-021 calls for: `Ctrl/Cmd+S`, a `beforeunload` guard
 * while there are unsaved changes, and a crash snapshot every 30 seconds.
 *
 * In a document-based app this is not polish — it *is* the data-integrity
 * story, which is why docs/13 refuses to let it be added later.
 */
export function useSaveShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const which = saveShortcut(event)
      if (which === undefined) return
      const { db } = useDocumentStore.getState()
      if (db === undefined) return

      // Only once we know there is a document to save — otherwise let the
      // browser have its own Save Page. Handled here, the shell's menu
      // accelerator for the same keys never fires, so this runs once.
      event.preventDefault()
      if (which === 'save-copy') void useDocumentStore.getState().saveCopyAs()
      else void useDocumentStore.getState().save()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!useDocumentStore.getState().isDirty) return
      event.preventDefault()
      // Browsers show their own wording; a non-empty returnValue is what asks.
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const { db, isDirty, documentName } = useDocumentStore.getState()
      if (db === undefined || !isDirty) return
      writeSnapshot(exportDatabase(db), documentName, Date.now())
    }, SNAPSHOT_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [])
}
