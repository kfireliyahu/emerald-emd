import { useEffect } from 'react'

import { shellDocuments } from '@/data/storage/desktop.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { openAbout } from '@/ui/About.tsx'
import { openCommandPalette } from '@/ui/commands.ts'
import { openEarlierCopies } from '@/ui/EarlierCopies.tsx'
import { openGuide } from '@/ui/guide/guideState.ts'
import { toggleSidebar } from '@/ui/useSidebar.ts'

/**
 * The File menu, a double-clicked document, and the question the window asks
 * before it closes (D-128).
 *
 * All of it lands in the document store, which is the point: the menu and the
 * operating system are second ways to reach the actions the header already
 * has, never a second implementation of them. Outside the shell this hook does
 * nothing at all — there is no bridge to listen to.
 */
export function useShellCommands(): void {
  useEffect(() => {
    const shell = shellDocuments()
    if (shell === undefined) return

    const stop = shell.onCommand((command) => {
      const store = useDocumentStore.getState()
      switch (command.kind) {
        case 'new':
          // `requestNew`, not `createNew`: unsaved work is never discarded silently.
          void store.requestNew()
          return
        case 'open':
          // `requestOpenFile`: unsaved work is asked about before the picker (M38 U3).
          void store.requestOpenFile()
          return
        case 'save':
          void store.save()
          return
        case 'save-as':
          void store.saveCopyAs()
          return
        case 'open-path':
          // Guarded: unsaved work is never thrown away by a document arriving.
          void store.requestOpen(command.path)
          return
        case 'save-and-close':
          void saveAndClose()
          return
        case 'toggle-sidebar':
          // Not the document store: the sidebar is a view preference, and the
          // menu is a second way to reach `Ctrl+B` rather than a second
          // implementation of it (D-130).
          toggleSidebar()
          return
        case 'command-palette':
          openCommandPalette()
          return
        case 'earlier-copies':
          // File › Earlier copies of this document (M45 U4, D-455). The dialog
          // says so itself when no document is open from a file.
          openEarlierCopies()
          return
        case 'about':
          // Help › About Emerald (M45 F3, D-457): the page's, with the folder of earlier copies.
          openAbout()
          return
        case 'guide':
          // Help › Guide me: where it stopped (M28 U9). A document that keeps
          // no ledger has no guide yet, and the dialog shows nothing.
          openGuide()
          return
      }
    })

    // Only now: a document handed to the app at launch is waiting in the shell,
    // and anything sent before this line would have arrived at nobody.
    shell.ready()
    return stop
  }, [])

  /**
   * What the shell cannot see for itself. Pushed on every change rather than
   * asked for on close, because the close handler in `electron/main.ts` runs
   * synchronously and there is no way to ask the page a question from inside it.
   */
  useEffect(() => {
    const shell = shellDocuments()
    if (shell === undefined) return

    shell.setUnsaved(useDocumentStore.getState().isDirty)
    return useDocumentStore.subscribe((state, previous) => {
      if (state.isDirty !== previous.isDirty) shell.setUnsaved(state.isDirty)
    })
  }, [])
}

/**
 * The window is closing and the user chose Save first.
 *
 * The close only happens if the save actually landed: a save that refuses
 * because the file changed underneath us (D-092) leaves the window open with
 * the conflict bar on screen, which is the only answer that loses nothing.
 */
async function saveAndClose(): Promise<void> {
  await useDocumentStore.getState().save()
  if (useDocumentStore.getState().isDirty) return
  shellDocuments()?.closeWindow()
}
