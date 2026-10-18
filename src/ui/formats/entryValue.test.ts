import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { draftOfMembers } from '@/domain/format/rowDraft.ts'
import { SEEDED_UNITS } from '@/domain/format/unit.ts'
import { SHOW_AS_LABEL, waysFor, type ShowAs } from '@/domain/format/view.ts'
import { instantText, relativeInstant, Shown, type ShownColumn, type ShownProps } from './EntryValue.tsx'

/**
 * **The entry draws each way as the approved mockup does** — M35 U3, D-402.
 *
 * The mockup's own script is the reference: its `shown()`, `waysFor()` and the
 * catalog's examples are read out of `docs/mockups/m35/entry.html` and run, and
 * what each way prints is diffed, as text, against what `Shown` prints for the
 * same value. A difference the build means is listed below with its reason;
 * any other is a failure.
 */

const MOCKUP = fileURLToPath(new URL('../../../docs/mockups/m35/entry.html', import.meta.url))

interface MockColumn {
  readonly key: string
  readonly name: string
  readonly type: string
  readonly values?: readonly string[]
  readonly min?: number
  readonly max?: number
  readonly unit?: string
}

interface Mockup {
  readonly shown: (column: MockColumn, value: unknown, how: string, readOnly: boolean) => string
  readonly waysFor: (column: MockColumn) => readonly (readonly [string, string, string?])[]
  readonly EX: readonly (readonly [string, string, MockColumn, unknown, string?, MockColumn?, unknown?])[]
  readonly ROWS: Readonly<Record<string, { readonly title: string; readonly state?: string; readonly sub?: string }>>
}

/** The mockup's drawing code and catalog, run as it runs in the page. */
function mockup(): Mockup {
  const html = readFileSync(MOCKUP, 'utf8')
  const start = html.indexOf('/* ------------------------------------------------------------ icons')
  const end = html.indexOf('/* the value being edited')
  const catalog = /const EX = \[[\s\S]*?\n {2}\];/.exec(html)
  if (start < 0 || end < 0 || catalog === null) throw new Error('The mockup no longer has the parts this test reads.')
  const code = `const S = { show: {} }; const TODAY = new Date(2026, 9, 6);\n${html.slice(start, end)}\n${catalog[0]}\nreturn { shown, waysFor, EX, ROWS };`
  return new Function(code)() as Mockup
}

/** Markup as the words a person reads, with no spacing to disagree about. */
function words(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, '')
}

const TODAY = '2026-10-06'

/**
 * The differences the build means, by `type.way`: what the mockup prints, what
 * the entry prints, and why.
 */
const MEANT: Readonly<Record<string, string>> = {
  // Money keeps its cents, as the sheet's cell and every other figure of
  // money in the app do; the mockup rounded for room.
  'money.figure': '€1,240.00',
  'money.large': '€1,240.00',
}

describe('Show as, drawn as the mockup draws it', () => {
  const mock = mockup()
  const linked = (id: string) => {
    const row = mock.ROWS[id]
    return row === undefined ? undefined : { name: row.title, state: row.state, lead: row.sub }
  }
  const named = (id: string): string => mock.ROWS[id]?.title ?? id

  /** The example as the form keeps it: `40%`, `6.5` beside `h`, a JSON list of ids. */
  const asDraft = (column: MockColumn, value: unknown): { value: string; beside?: string } => {
    if (Array.isArray(value)) return { value: draftOfMembers(value as string[]) }
    if (typeof value === 'boolean') return { value: value ? 'true' : 'false' }
    if (column.type === 'percent') return { value: `${String(value)}%` }
    if (column.type === 'quantity') return { value: String(value), beside: column.unit ?? '' }
    if (column.type === 'money') return { value: String(value).replace(/,/g, '') + '.00', beside: 'EUR' }
    return { value: String(value) }
  }

  const ours = (column: MockColumn, value: unknown, way: ShowAs): string => {
    const draft = asDraft(column, value)
    const shownColumn: ShownColumn = {
      name: column.name,
      type: column.type,
      values: column.values ?? [],
      minimum: column.min,
      maximum: column.max,
      target: column.type === 'link' || column.type === 'links' ? 'tasks' : undefined,
    }
    const props: ShownProps = {
      column: shownColumn,
      way,
      value: draft.value,
      beside: draft.beside,
      part: 'figure',
      top: column.max,
      oneUnit: column.type === 'quantity' ? 'min' : undefined,
      units: SEEDED_UNITS,
      today: TODAY,
      named,
      linked,
      onOpen: () => undefined,
    }
    return words(renderToStaticMarkup(createElement(Shown, props)))
  }

  for (const [type, , column, value, , column2, value2] of mockup().EX) {
    it(`offers a ${type} the mockup’s ways, in its words`, () => {
      expect(waysFor({ type, minimum: column.min, maximum: column.max }).map((way) => SHOW_AS_LABEL[way])).toEqual(
        mock.waysFor(column).map(([, label]) => label),
      )
    })

    it(`draws a ${type} each way as the mockup’s catalog does`, () => {
      for (const [way] of mock.waysFor(column)) {
        const [shownColumn, shownValue] =
          type === 'text' && way === 'markdown' && column2 !== undefined
            ? [column2, value2]
            : type === 'text' && way === 'mono'
              ? [column, 'letter-2026-q4.md']
              : [column, value]
        const expected = MEANT[`${type}.${way}`] ?? words(mock.shown(shownColumn, shownValue, way, true))
        expect(`${type}.${way}: ${ours(shownColumn, shownValue, way as ShowAs)}`).toBe(`${type}.${way}: ${expected}`)
      }
    })
  }

  // The catalog says these in a sentence rather than drawing them.
  it('draws a month, a moment, a time and several words as the catalog says', () => {
    const draw = (type: string, way: ShowAs, value: string, now?: number): string =>
      words(
        renderToStaticMarkup(
          createElement(Shown, { column: { name: 'x', type, values: [] }, way, value, today: TODAY, now }),
        ),
      )
    expect(draw('month', 'month', '2026-10')).toBe('Oct2026')
    expect(draw('month', 'relative', '2026-10')).toBe('thismonth')
    expect(draw('time', 'clock', '09:30')).toBe('09:30')
    expect(draw('enums', 'chips', draftOfMembers(['red', 'blue']))).toBe('redblue')
    const moment = new Date(2026, 9, 6, 9, 30)
    expect(instantText(moment.toISOString())).toBe('Tue 6 Oct 2026 09:30')
    expect(draw('instant', 'datetime', moment.toISOString())).toBe('Tue6Oct202609:30')
    expect(draw('instant', 'relative', moment.toISOString(), moment.getTime() + 40 * 60_000)).toBe('40minutesago')
    expect(relativeInstant(moment.toISOString(), moment.getTime() - 3 * 3_600_000, TODAY)).toBe('in 3 hours')
  })

  it('says Empty for nothing, and still draws what is pressed to fill it', () => {
    const draw = (type: string, way: ShowAs, onPick?: (text: string) => void): string =>
      words(
        renderToStaticMarkup(
          createElement(Shown, { column: { name: 'x', type, values: ['a', 'b'] }, way, value: '', today: TODAY, onPick }),
        ),
      )
    expect(draw('integer', 'bar')).toBe('Empty')
    expect(draw('enum', 'buttons')).toBe('Empty')
    expect(draw('enum', 'buttons', () => undefined)).toBe('ab')
  })
})
