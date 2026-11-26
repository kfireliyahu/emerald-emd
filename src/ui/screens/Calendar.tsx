import { useMemo } from 'react'

import { parseISODate, toISODate } from '@/core/time.ts'
import { chosenWeekStart, documentWeekStart, setDocumentWeekStart } from '@/data/repositories/unitRepository.ts'
import { clockRange, WEEKDAYS } from '@/domain/format/clock.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SettingRow, SettingsPage } from '@/ui/settings/SettingsPage.tsx'
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
 *
 * **The report** (M64 U12, D-624): that line is the answer, said first — the
 * day weeks start on and which days this week is — and the choice under it.
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

  const starts = weekday(read.chosen ?? 'monday', t)
  const answer =
    read.week?.from !== undefined && read.week.through !== undefined ? (
      <Phrase
        text={t('settings.calendar.answer')}
        parts={{
          day: starts,
          from: <span className="tabular-nums">{dayLabel(read.week.from, t, dates)}</span>,
          through: <span className="tabular-nums">{dayLabel(read.week.through, t, dates)}</span>,
        }}
      />
    ) : (
      t('settings.calendar.answerDay', { day: starts })
    )

  return (
    <SettingsPage title={t('rail.calendar')} answer={answer}>
      <SettingRow
        label={t('settings.calendar.weekStart')}
        htmlFor="week-start"
        hint={
          <>
            <Phrase
              text={t('settings.calendar.names')}
              // What a filter is typed as, in any language: code, each isolated so a Hebrew sentence keeps its order.
              parts={{ this: <Bidi><code>this week</code></Bidi>, last: <Bidi><code>last week</code></Bidi>, next: <Bidi><code>next week</code></Bidi> }}
            />{' '}
            {t('settings.calendar.kept')}
          </>
        }
      >
          <ChoiceField
            id="week-start"
            className={`${FIELD} h-7 w-32`}
            readOnly
            filter={false}
            text={starts}
            choices={WEEKDAYS.map((day) => ({ value: day, label: weekday(day, t) }))}
            onText={() => undefined}
            onPick={(choice) => mutate((database) => void setDocumentWeekStart(database, choice.value))}
          />
      </SettingRow>
    </SettingsPage>
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
