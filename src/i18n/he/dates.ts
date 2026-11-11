import type { Translation } from '../catalogue.ts'

/**
 * **Month names in Hebrew** (M60 U1, D-583): the Gregorian months, never the
 * Hebrew calendar's, and Western digits. A short name ends in a geresh where it
 * is cut, as a Hebrew calendar prints it.
 */
export const dates: Translation<'dates'> = {
  months: ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'],
  monthsShort: ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'],
  yearMonth: '{month} {year}',
  /** **3 באוק׳** — a day *in* a month. */
  dayMonth: '{day} ב{month}',
}
