import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * **The ui rule rows a reviewed surface keeps** (M54 U1): the plain breaches a
 * design review fixed in place, held here so they do not come back. Each M54
 * unit that reviews a surface adds its files to `REVIEWED`.
 *
 * - *Choices are ChoiceField*: no platform `<select>` or `<datalist>`.
 * - *Every value is a token*: no type size written in pixels where the ramp in
 *   `tokens.css` has a step of that size (`text-caption` is 12px, `text-body`
 *   14px, `text-heading` 16px, `text-secondary-number` 20px, `text-title` 24px,
 *   `text-hero` 40px). Sizes the ramp has no step for are a review entry, not
 *   this test's.
 */
const REVIEWED = [
  'src/ui/screens/DeclaredFormats.tsx',
  'src/ui/screens/Formats.tsx',
  'src/ui/screens/FormatRows.tsx',
  'src/ui/screens/FormatLinkViews.tsx',
  'src/ui/formats/NewFormat.tsx',
  'src/ui/formats/EntryView.tsx',
  'src/ui/formats/EntryValue.tsx',
  'src/ui/formats/EntryList.tsx',
  'src/ui/formats/RowSheet.tsx',
  'src/ui/formats/TypedField.tsx',
  'src/ui/formats/MembersField.tsx',
  'src/ui/formats/FormulaField.tsx',
  'src/ui/formats/BoardView.tsx',
  'src/ui/formats/ListView.tsx',
  'src/ui/formats/LinkViews.tsx',
  // M54 U2: views and dashboards.
  'src/ui/formats/Dashboard.tsx',
  'src/ui/formats/MakeBlock.tsx',
  'src/ui/formats/RollupView.tsx',
  'src/ui/formats/FilterBand.tsx',
  'src/ui/formats/ConnectionGraph.tsx',
  'src/ui/formats/ConnectionPanel.tsx',
  'src/ui/screens/Dashboard.tsx',
  'src/ui/screens/Connections.tsx',
  'src/ui/screens/Agenda.tsx',
  'src/ui/screens/Calendar.tsx',
  'src/ui/charts/Chart.tsx',
]

const RAMP_SIZES = ['12', '14', '16', '20', '24', '40']

/**
 * *Keyboard first*: `outline-none` only beside what replaces it — the 2px
 * `accent` ring, an `accent` border or plane — in the same class string or the
 * lines that continue it. A `surface` tint is not one: it is 1.07:1 against the
 * page in both themes (M54 U1).
 */
const REPLACEMENTS = ['focus-visible:outline-2', 'focus-visible:bg-accent', 'focus:border-accent']

/** Where the ring is drawn by what holds the field, not the field itself. */
const HELD_ELSEWHERE = [
  // The entry list's search: its label draws the ring (`has-[:focus-visible]`).
  'p-0 text-[13px] text-ink outline-none placeholder:text-ink-tertiary',
  // The entry list's scroll box, which is not a stop of its own.
  'relative min-h-0 flex-1 overflow-auto outline-none',
  // Quick add: its label draws the accent rule inside it on focus-within.
  'h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none',
  // A dashboard block's resize edges: the 2px `accent` rule inside them shows on focus.
  'group/edge absolute top-0 -right-[5px] z-10 flex h-full w-[9px] cursor-ew-resize',
  'group/edge absolute -bottom-[5px] left-0 z-10 flex h-[9px] w-full cursor-ns-resize',
  // Its corner turns its glyph `accent` on focus (M54 U2 recorded whether that is enough).
  'cursor-nwse-resize items-end justify-end p-[3px] text-ink-tertiary',
]

describe('a reviewed surface keeps the ui rule rows', () => {
  for (const path of REVIEWED) {
    const source = readFileSync(path, 'utf8')

    it(`${path} draws every choice with ChoiceField`, () => {
      expect(source).not.toMatch(/<(select|datalist)[\s>]/)
    })

    it(`${path} sizes type from the ramp where the ramp has the size`, () => {
      const literal = new RegExp(`text-\\[(${RAMP_SIZES.join('|')})px\\]`, 'g')
      expect(source.match(literal) ?? []).toEqual([])
    })

    it(`${path} replaces every outline it takes away`, () => {
      const lines = source.split('\n')
      const bare = lines.flatMap((line, at) => {
        if (!line.includes('outline-none')) return []
        if (HELD_ELSEWHERE.some((each) => line.includes(each))) return []
        const string = lines.slice(at, at + 3).join(' ')
        return REPLACEMENTS.some((each) => string.includes(each)) ? [] : [`${path}:${String(at + 1)}`]
      })
      expect(bare).toEqual([])
    })
  }
})
