import { useEffect } from 'react'

import type { ShellDocumentState } from '../../electron/bridge.ts'
import { shellDocuments } from '@/data/storage/desktop.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { openAbout } from '@/ui/About.tsx'
import { openCommandPalette } from '@/ui/commands.ts'
import { openEarlierCopies } from '@/ui/EarlierCopies.tsx'
import { openGuide } from '@/ui/guide/guideState.ts'
import { openDocumentKeptPacks } from '@/ui/packs.ts'
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
          // File › Save as… (D-531): a new file, and the window carries on in it.
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
   * The name is what that question names, and the rest is what the menu greys
   * out by: Save with no document, Guide me with no ledger (M54 F7).
   */
  useEffect(() => {
    const shell = shellDocuments()
    if (shell === undefined) return

    let sent = ''
    const push = (): void => {
      const next = shellState()
      const text = JSON.stringify(next)
      if (text === sent) return
      sent = text
      shell.setState(next)
    }
    push()
    return useDocumentStore.subscribe((state, previous) => {
      // Only what the answer reads: whether a ledger is kept is a query, and the
      // store moves for many things that change none of it.
      const same =
        state.db === previous.db &&
        state.revision === previous.revision &&
        state.documentName === previous.documentName &&
        state.isDirty === previous.isDirty
      if (!same) push()
    })
  }, [])
}

/** The window's document, as the shell is told it. */
function shellState(): ShellDocumentState {
  const { db, documentName, isDirty } = useDocumentStore.getState()
  if (db === undefined) return { unsaved: false, guide: false }
  return { name: documentName, unsaved: isDirty, guide: openDocumentKeptPacks().has('ledger') }
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
