import { useMemo, type ReactNode } from 'react'

import { agendaData, AGENDA_DATE } from '@/data/repositories/formatLinkViewRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { setAgendaDate } from '@/data/repositories/formatViewRepository.ts'
import { toISODate } from '@/core/time.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { FilterBand, useAddressFilter } from '@/ui/formats/FilterBand.tsx'
import { AgendaView } from '@/ui/formats/LinkViews.tsx'
import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { today } from '@/ui/today.ts'

/** The windows the bar offers, in the filter's own words (D-472) — and none, everything ahead. */
const WINDOWS = ['within 7 days', 'within 14 days', 'within 30 days'] as const

/**
 * **The agenda, as a screen** — M49 U3, D-473. Every dated format's rows from
 * today, read on every revision and kept nowhere, on the app's clock.
 *
 * **Its filter is the address's**, as every view's is (M44 U7), in the filter
 * band's words — `?date=within 14 days` holds each format by its own agenda
 * date, any other column the formats that have it — so the band (M37 U3) picks
 * it up when it is built, and `show_format view:agenda` opens here on the
 * same rows. The bar's windows and the search write the same address.
 */
export function Agenda() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const { filter, set, clear } = useAddressFilter()

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const declarations = listFormats(db)
    // The app's clock, read at the edge (D-472).
    const day = toISODate(today())
    const drawn = agendaData(db, declarations, day, filter)
    const filtered = Object.keys(filter.match ?? {}).length > 0 || (filter.search ?? '').trim() !== ''
    const whole = filtered ? agendaData(db, declarations, day) : drawn
    return { drawn, shown: rowsOn(drawn), total: rowsOn(whole) }
    // `revision` is the dependency that matters: every write bumps it.
  }, [db, revision, filter])

  if (db === undefined || data === undefined) return <Centered>Open a document to see what it holds.</Centered>
  const held = filter.match?.[AGENDA_DATE]
  const windowed = (window: string | undefined): RowFilter => {
    const { [AGENDA_DATE]: _was, ...rest } = filter.match ?? {}
    const match = window === undefined ? rest : { ...rest, [AGENDA_DATE]: window }
    return { ...(Object.keys(match).length === 0 ? {} : { match }), ...(filter.search === undefined ? {} : { search: filter.search }) }
  }
  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-6 py-2">
        <span className="font-medium">Agenda</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center" role="group" aria-label="How far ahead">
            {[undefined, ...WINDOWS].map((window) => {
              const on = window === undefined ? held === undefined : held === window
              return (
                <button
                  key={window ?? 'ahead'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set(windowed(window))}
                  className={`h-7 border border-hairline px-2.5 text-caption -ml-px first:ml-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${on ? 'bg-surface text-ink font-medium' : 'text-ink-secondary hover:text-ink'}`}
                >
                  {window === undefined ? 'All ahead' : window.replace('within ', '')}
                </button>
              )
            })}
          </span>
          <input
            className={`${FIELD} w-48`}
            type="search"
            value={filter.search ?? ''}
            onChange={(event) => set({ ...filter, search: event.target.value }, true)}
            placeholder="Search"
            aria-label="Search"
            title="Every column, as it is shown"
          />
        </span>
      </div>
      <FilterBand filter={filter} shown={data.shown} total={data.total} onClear={clear} onChange={set} />
      <AgendaView data={data.drawn} onDate={(format, column) => mutate((database) => setAgendaDate(database, format, column))} />
    </div>
  )
}

/** How many rows an agenda draws: overdue and every day ahead. */
function rowsOn(data: ReturnType<typeof agendaData>): number {
  return data.overdue.length + data.days.reduce((sum, day) => sum + day.rows.length, 0)
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-prose">{children}</p>
    </div>
  )
}
