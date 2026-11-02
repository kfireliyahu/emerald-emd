import { useEffect } from 'react'

import { useDocumentStore } from '@/state/documentStore.ts'

/**
 * **The window's title names the document and the screen** (M54 F5, WCAG 2.4.2
 * Page Titled). It was always *Emerald*: a browser tab, the taskbar and Alt+Tab
 * could not tell two open documents apart. The shell's window follows the page's
 * `document.title`, so this one line is the tab's and the taskbar's at once.
 *
 * With no document open it is *Emerald*; with one, the document's file name, the
 * screen the rail lights, then *Emerald*. A name that came out of a document is
 * isolated (FSI … PDI) when it holds right-to-left text, so a Hebrew name keeps
 * its own order and the separators stay where they are.
 */
export const APP_TITLE = 'Emerald'

export function documentTitle(documentName: string | undefined, screen: string | undefined): string {
  if (documentName === undefined || documentName === '') return APP_TITLE
  const parts = [documentName, screen].filter((each): each is string => each !== undefined && each !== '')
  return [...parts.map(isolated), APP_TITLE].join(' — ')
}

/** Right-to-left text: Hebrew, Arabic and the scripts beside them. */
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/

function isolated(text: string): string {
  return RTL.test(text) ? `⁨${text}⁩` : text
}

/**
 * Keeps `document.title` on the open document and the screen named, from
 * whatever knows the screen (the rail). Leaving, it gives the title back.
 */
export function useDocumentTitle(screen: string | undefined): void {
  const open = useDocumentStore((state) => state.db !== undefined)
  const name = useDocumentStore((state) => state.documentName)
  const title = documentTitle(open ? name : undefined, screen)
  useEffect(() => {
    document.title = title
  }, [title])
  useEffect(
    () => () => {
      document.title = APP_TITLE
    },
    [],
  )
}
