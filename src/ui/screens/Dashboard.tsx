import { useMemo } from 'react'

import { listFormats } from '@/data/repositories/formatRepository.ts'
import { dashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { DashboardView } from '@/ui/formats/Dashboard.tsx'
import { joined } from '@/ui/formats/viewAnswers.ts'

/**
 * **The document's dashboard** — M53 U7, D-514, D-521, at `#/dashboard`: the
 * rail's own place, right under the ledger's Home, and what `#/` opens in a
 * document with no ledger. Its blocks may read any format, and each says which
 * under its title.
 *
 * **The answer first** (M64 U14, D-626): *What do my numbers add up to?* is
 * answered by the blocks, so the sentence above them says how many there are
 * and which formats they read — or that there are none yet, with the *Add a
 * block* tile as its one action.
 */
export function DocumentDashboard() {
  const t = useT()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const read = useMemo(() => {
    if (db === undefined) return undefined
    const declarations = listFormats(db)
    const blocks = dashboardBlocks(db, undefined)
    const reading = [...new Set(blocks.map((each) => each.format))]
    return { blocks: blocks.length, formats: reading.map((format) => declarations.find((each) => each.name === format)?.title ?? format) }
    // `revision` is the dependency that matters: every write bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, revision])
  if (db === undefined || read === undefined) return null
  return (
    <div className="fc-view-enter flex h-full flex-col">
      <header className="flex shrink-0 flex-col gap-1.5 px-6 pt-5 pb-3">
        <h1 className="m-0 text-title leading-tight font-medium">{t('rail.dashboard')}</h1>
        <p className="m-0 text-lede tabular-nums" aria-live="polite">
          {read.blocks === 0
            ? t('views.dashboard.none')
            : (
              <Phrase
                text={t(countKey('views.dashboard.answer', read.blocks), { count: read.blocks })}
                parts={{ formats: <Bidi>{joined(t, read.formats)}</Bidi> }}
              />
            )}
        </p>
        {/* The line under the answer keeps its place, as on a format's views; the document's name is the title bar's. */}
        <p aria-hidden className="m-0 min-h-6" />
      </header>
      <DashboardView dashboard={undefined} answered />
    </div>
  )
}
