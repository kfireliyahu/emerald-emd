/** The types of `demo-year.mjs`, for the test that builds the year in-process (M64 U16). */

export interface YearDay {
  readonly year: number
  readonly month: number
  readonly day: number
}

export interface YearMonth {
  readonly index: number
  readonly year: number
  readonly month: number
  readonly period: string
}

export function yearMonths(today: YearDay, count: number): readonly YearMonth[]

export function makeYear(
  target: string,
  source: unknown,
  ask: (name: string, args: Record<string, unknown>) => Promise<string>,
  today: YearDay,
): Promise<void>
