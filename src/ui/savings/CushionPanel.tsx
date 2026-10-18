import { useMemo } from 'react'

import type { CurrencyCode } from '@/core/money.ts'
import { cushionReading } from '@/data/repositories/cushionRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { today } from '@/ui/today.ts'
import { CushionLine, type Write } from '@/ui/savings/Cushion.tsx'

/**
 * The cushion on Plan, whole (M36 U10): its months, Plan's buckets it counts and
 * the accounts it lives in are all set here, in `CushionLine`. It was split —
 * the months here (M31 U5, D-371) and the accounts ticked on Net worth (M36 U08).
 */
export function CushionPanel() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const currency: CurrencyCode = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])
  const cushion = useMemo(
    () => (db === undefined ? undefined : cushionReading(db, today(), currency)),
    [db, revision, currency],
  )
  if (cushion === undefined) return null
  const write: Write = (work) => {
    mutate((database) => work(database, Date.now()))
    return true
  }
  return <CushionLine cushion={cushion} write={write} />
}
