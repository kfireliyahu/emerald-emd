import { useMemo } from 'react'
import type { Database } from 'sql.js'

import { ledgerHolds } from '@/data/repositories/railRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { formatPlacesOf } from '@/ui/formats/places.ts'
import { groupByPack, heldPlaces } from '@/ui/nav.ts'
import { keptPacks, packRails } from '@/ui/packs.ts'

/**
 * **The places this document holds back from the rail** — M59 U6 (D-582).
 * Only a document that keeps the ledger holds any back; asked of the document
 * each time it changes, never remembered. The sidebar and the views strip read
 * it; the palette does not, because it lists every place.
 */
export function heldBackOf(db: Database | undefined): ReadonlySet<string> {
  if (db === undefined) return new Set()
  const kept = keptPacks(db)
  if (!kept.has('ledger')) return new Set()
  const own = groupByPack(formatPlacesOf(db), packRails(kept), (format) => format.name).own
  return heldPlaces(ledgerHolds(db), {
    ledgerOnly: kept.size === 1,
    own: own.length > 0,
    ownDated: own.some((format) => format.dated === true),
  })
}

export function useHeldBack(): ReadonlySet<string> {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  // `revision` moves on every write, which is when a place can come back.
  return useMemo(() => heldBackOf(db), [db, revision])
}
