import { useMemo } from 'react'

import { toISODate } from '@/core/time.ts'
import { chosenWeekStart, documentWeekStart, setDocumentWeekStart } from '@/data/repositories/unitRepository.ts'
import { clockRange, WEEKDAYS } from '@/domain/format/clock.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { SELECT } from '@/ui/components/fieldLook.ts'
import { today } from '@/ui/today.ts'

/**
 * **Settings › Calendar** — M53 F6 (D-528). The day this document's weeks
 * start on, which is what a filter's `this week`, `last week` and `next week`
 * name.
 *
 * The document's and not this machine's, for the reason its currency is: a
 * conversation and another machine must name the same rows, so the setting
 * travels in the file. `record_units` with `week_starts_on` is the other half
 * (D-227). Monday, ISO's, until one is chosen — and the line under it says
 * which days *this week* is now, so the choice is checked as it is made.
 */
export function Calendar() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const read = useMemo(() => {
    if (db === undefined) return undefined
    const day = toISODate(today())
    const week = clockRange({ kind: 'PERIOD', period: 'week', offset: 0 }, day, documentWeekStart(db))
    return { chosen: chosenWeekStart(db), week }
  }, [db, revision])
  if (db === undefined || read === undefined) return null

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex max-w-4xl flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-col gap-1.5 border-b border-hairline pb-4">
          <span className="fc-label text-ink-secondary uppercase">Settings · Calendar</span>
          <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">Calendar</h1>
          <span className="text-ink-secondary">How this document counts its weeks. It is kept in the file, so every machine and every conversation counts them alike.</span>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline py-4">
          <div>
            <label htmlFor="week-start" className="font-medium">
              Weeks start on
            </label>
            <p className="m-0 mt-0.5 max-w-[60ch] text-ink-secondary">
              What a filter’s <code>this week</code>, <code>last week</code> and <code>next week</code> name.
              {read.week?.from !== undefined && read.week.through !== undefined && (
                <>
                  {' '}
                  This week is <span className="text-ink tabular-nums">{dayLabel(read.week.from)}</span> to{' '}
                  <span className="text-ink tabular-nums">{dayLabel(read.week.through)}</span>.
                </>
              )}
            </p>
          </div>
          <select
            id="week-start"
            value={read.chosen ?? 'monday'}
            onChange={(event) => {
              const typed = event.target.value
              mutate((database) => void setDocumentWeekStart(database, typed))
            }}
            className={`${SELECT} h-7`}
          >
            {WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {day[0]?.toUpperCase()}
                {day.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

/** `2026-10-19` as `Mon 19 Oct`, read as the calendar day it names. */
function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
