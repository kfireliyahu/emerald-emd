import { useMemo } from 'react'

import { listFormats } from '@/data/repositories/formatRepository.ts'
import { dashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { DashboardView } from '@/ui/formats/Dashboard.tsx'

/**
 * **The document's dashboard** — M53 U7, D-514, D-521, at `#/dashboard`: the
 * rail's own place, right under the ledger's Home, and what `#/` opens in a
 * document with no ledger. Its blocks may read any format, and each says which
 * under its title.
 */
export function DocumentDashboard() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const name = useDocumentStore((state) => state.documentName)
  const read = useMemo(() => {
    if (db === undefined) return undefined
    const declarations = listFormats(db)
    const reading = [...new Set(dashboardBlocks(db, undefined).map((each) => each.format))]
    return reading.map((format) => declarations.find((each) => each.name === format)?.title ?? format)
    // `revision` is the dependency that matters: every write bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, revision])
  if (db === undefined || read === undefined) return null
  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 items-baseline gap-3.5 px-6 pt-3">
        <h1 className="m-0 text-[20px] font-semibold">Dashboard</h1>
        <span className="text-caption text-ink-secondary">
          <Bidi>{name}</Bidi> · blocks from any format
        </span>
      </div>
      <div className="flex min-h-[37px] shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-hairline px-6 py-2 text-caption text-ink-secondary">
        {read.length > 0 && (
          <span>
            Blocks from <Bidi>{andList(read)}</Bidi>. Each says which format it reads under its title.
          </span>
        )}
      </div>
      <DashboardView dashboard={undefined} />
    </div>
  )
}

/** `Task`, `Task and Book`, `Task, Book and Note`. */
function andList(words: readonly string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`
}
