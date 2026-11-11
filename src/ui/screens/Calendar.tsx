import { useMemo } from 'react'

import { parseISODate, toISODate } from '@/core/time.ts'
import { chosenWeekStart, documentWeekStart, setDocumentWeekStart } from '@/data/repositories/unitRepository.ts'
import { clockRange, WEEKDAYS } from '@/domain/format/clock.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
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
  const t = useT()
  const dates = useDates()
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
          <span className="fc-label text-ink-secondary uppercase">
            {t('rail.settings')} · {t('rail.calendar')}
          </span>
          <h1 className="m-0 text-title">{t('rail.calendar')}</h1>
          <span className="text-ink-secondary">{t('settings.calendar.lead')}</span>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline py-4">
          <div>
            <label htmlFor="week-start" className="font-medium">
              {t('settings.calendar.weekStart')}
            </label>
            <p className="m-0 mt-0.5 max-w-[60ch] text-ink-secondary">
              <Phrase
                text={t('settings.calendar.names')}
                parts={{ this: <code>this week</code>, last: <code>last week</code>, next: <code>next week</code> }}
              />
              {read.week?.from !== undefined && read.week.through !== undefined && (
                <>
                  {' '}
                  <Phrase
                    text={t('settings.calendar.thisWeek')}
                    parts={{
                      from: <span className="text-ink tabular-nums">{dayLabel(read.week.from, t, dates)}</span>,
                      through: <span className="text-ink tabular-nums">{dayLabel(read.week.through, t, dates)}</span>,
                    }}
                  />
                </>
              )}
            </p>
          </div>
          <ChoiceField
            id="week-start"
            className={`${FIELD} h-7 w-32`}
            readOnly
            filter={false}
            text={weekday(read.chosen ?? 'monday', t)}
            choices={WEEKDAYS.map((day) => ({ value: day, label: weekday(day, t) }))}
            onText={() => undefined}
            onPick={(choice) => mutate((database) => void setDocumentWeekStart(database, choice.value))}
          />
        </div>
      </div>
    </div>
  )
}

/** `2026-10-19` as `Mon 19 Oct`, read as the calendar day it names. */
function dayLabel(date: string, t: Translate, dates: DateWords): string {
  const parsed = parseISODate(date)
  if (parsed === undefined) return date
  const named = WEEKDAYS[(new Date(parsed.year, parsed.month - 1, parsed.day).getDay() + 6) % 7] ?? 'monday'
  return t('settings.calendar.day', { weekday: t(`settings.calendar.short.${named}`), date: dates.dayMonth(parsed) })
}

/** `monday` as `Monday`, as the choice reads. */
function weekday(day: string, t: Translate): string {
  return (WEEKDAYS as readonly string[]).includes(day)
    ? t(`settings.calendar.weekdays.${day as (typeof WEEKDAYS)[number]}`)
    : `${day[0]?.toUpperCase() ?? ''}${day.slice(1)}`
}
