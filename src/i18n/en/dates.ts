/**
 * **Month names and how a date is written, in English** (M60 U1, D-583):
 * Gregorian only, Western digits. `../dates.ts` formats with these; the
 * patterns say where the parts go, since a language orders them its own way.
 */
export const dates = {
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  /** **July 2026**, and **Jul 2026** with the short name. */
  yearMonth: '{month} {year}',
  /** **3 Oct**: a day of this year. */
  dayMonth: '{day} {month}',
} as const
