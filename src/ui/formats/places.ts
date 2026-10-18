import { useMemo } from 'react'
import type { Database } from 'sql.js'

import { listFormats } from '@/data/repositories/formatRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import type { FormatPlace } from '@/ui/nav.ts'

/**
 * The declared formats, as places in the rail — M20 U1 (D-227).
 *
 * **A format's name is a place, which is the line the milestone is drawn on.**
 * `nav.ts` is a static list and has to stay one: it is the navigation *as data*,
 * and a list that read a database would be a list nothing could test. So the
 * document's own formats are handed to `railSections` from here, and the two
 * surfaces that draw a rail — the sidebar and the palette — take the same list
 * from the same function, which is the whole reason `nav.ts` exists (D-130).
 */
export function formatPlacesOf(db: Database | undefined): readonly FormatPlace[] {
  if (db === undefined) return []
  return listFormats(db).map((format) => ({
    name: format.name,
    title: format.title,
    dated: format.columns.some((column) => column.type === 'date'),
  }))
}

/** The same, recomputed whenever the document changes under us. */
export function useFormatPlaces(): readonly FormatPlace[] {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  // `revision` is the dependency that matters: every mutation bumps it, and
  // declaring a format is a mutation, so a new one appears in the rail without
  // anything here knowing that is what happened.
  return useMemo(() => formatPlacesOf(db), [db, revision])
}
