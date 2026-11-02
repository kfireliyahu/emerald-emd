import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { contrast, parseColour } from '@/frame/hostStyle.ts'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'

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
 *   this test's. And no colour written in a component: no hex, no `rgb()` or
 *   `rgba()`, no Tailwind `white` or `black` (M54 U3).
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
  // M54 U3: intake — reading a file onto a format, the mapper, the document pane, readers.
  'src/ui/screens/ReadFiles.tsx',
  'src/ui/import/ReadFilesBar.tsx',
  'src/ui/formats/IntakePanel.tsx',
  'src/ui/formats/ReadersLine.tsx',
  'src/ui/import/MapperScreen.tsx',
  'src/ui/import/MappingBar.tsx',
  'src/ui/import/PreviewStrip.tsx',
  'src/ui/import/SheetGrid.tsx',
  'src/ui/import/StageBar.tsx',
  'src/ui/documents/DocumentPane.tsx',
  'src/ui/documents/DocumentTextInput.tsx',
  'src/ui/documents/ReadField.tsx',
  'src/ui/documents/Look.tsx',
  'src/ui/screens/Readers.tsx',
  'src/ui/screens/Mappings.tsx',
  'src/ui/screens/LocalModel.tsx',
  // M54 U4: the document's own screens — home, the rail, the document bar, the palette, notices, the guide, settings.
  'src/ui/Sidebar.tsx',
  'src/ui/RailFolder.tsx',
  'src/ui/NavGlyph.tsx',
  'src/ui/DocumentBar.tsx',
  'src/ui/TitleBar.tsx',
  'src/ui/HistoryArrows.tsx',
  'src/ui/EarlierCopies.tsx',
  'src/ui/CommandPalette.tsx',
  'src/ui/Notices.tsx',
  'src/ui/About.tsx',
  'src/ui/guide/Guide.tsx',
  'src/ui/guide/GuideLine.tsx',
  'src/ui/screens/Home.tsx',
  'src/ui/screens/HomeShell.tsx',
  'src/ui/screens/Overview.tsx',
  'src/ui/screens/NoLedger.tsx',
  'src/ui/screens/Mcp.tsx',
  'src/ui/screens/Packs.tsx',
  'src/ui/screens/Export.tsx',
  'src/ui/screens/Section.tsx',
  'src/ui/home/WaitingList.tsx',
  'src/demo/tour/Frame.tsx',
  'src/ui/home/parts.tsx',
]

/**
 * *Hebrew needs bidi isolation* (M54 U4): the names that come out of a
 * document — its file name, a format's title, a pack's group, a page's label
 * in the rail — are rendered inside `Bidi`, never as a bare child. Where it
 * truncates, the ellipsis is the `Bidi`'s own (`<Bidi className="min-w-0
 * truncate">` in a `flex min-w-0` box), never its wrapper's:
 * `src/ui/bidiTruncation.test.ts` holds that half.
 */
const DOCUMENT_STRINGS = ['documentName', 'fileName(pendingOpen)', 'child.label', 'child.group', 'section.label', 'format.title', 'command.label', 'line.chat', 'shown.now', 'shown.was']

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
  'p-0 text-body text-ink outline-none placeholder:text-ink-secondary',
  // The entry list's scroll box, which is not a stop of its own.
  'relative min-h-0 flex-1 overflow-auto outline-none',
  // Quick add: its label draws the accent rule inside it on focus-within.
  'h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none',
  // A dashboard block's resize edges: the 2px `accent` rule inside them shows on focus.
  // Its corner draws the ring every other stop does (M54 F3), so it is not here.
  'group/edge absolute top-0 -right-1 z-10 flex h-full w-2 cursor-ew-resize',
  'group/edge absolute -bottom-1 left-0 z-10 flex h-2 w-full cursor-ns-resize',
  // A rail folder's filter: its label turns its rule `accent` on focus-within (M54 U4).
  'w-full min-w-0 border-0 bg-transparent p-0 text-caption text-ink outline-none placeholder:text-ink-tertiary',
  // A rail entry being renamed: the field exists only while it has focus, and its rule is `accent` throughout.
  'h-6 w-full min-w-0 border-0 border-b border-accent bg-transparent p-0 text-[12.5px] text-ink outline-none',
  // A saved view's tab being renamed (M54 F2): as the rail's, its rule is `accent` throughout.
  'h-6 w-40 min-w-0 border-0 border-b border-accent bg-transparent p-0 text-body text-ink outline-none',
  // A dialog's own box (About, Earlier copies): focused by script so Esc reaches it, never a Tab stop.
  'flex-col overflow-hidden rounded-lg border border-hairline-strong bg-elevated shadow-pop outline-none',
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

    it(`${path} takes every colour from the tokens`, () => {
      const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\b(bg|text|border|fill|stroke)-(white|black)\b/g
      expect(source.match(literal) ?? []).toEqual([])
    })

    it(`${path} rings what holds a hidden input`, () => {
      // A visually hidden input takes focus where nobody can see it, so what
      // holds it draws the ring on focus-within (*Keyboard first*, M54 U3).
      const lines = source.split('\n')
      const unringed = lines.flatMap((line, at) => {
        if (!line.includes('className="sr-only"')) return []
        const before = lines.slice(Math.max(0, at - 8), at)
        if (!before.some((each) => each.includes('<input'))) return []
        // One that never takes focus (a picker opened by a button) needs no ring.
        if (lines.slice(at, at + 3).some((each) => each.includes('tabIndex={-1}'))) return []
        return before.some((each) => each.includes('focus-within:outline')) ? [] : [`${path}:${String(at + 1)}`]
      })
      expect(unringed).toEqual([])
    })

    it(`${path} isolates every name a document gave it`, () => {
      const names = DOCUMENT_STRINGS.map((each) => each.replace(/[.()]/g, '\\$&')).join('|')
      const bare = [...source.matchAll(new RegExp(`(?<![$=])\\{(${names})\\}`, 'g'))].flatMap((found) =>
        /<Bidi(\s[^>]*)?>\s*$/.test(source.slice(0, found.index)) ? [] : [`${path}: ${found[0]}`],
      )
      expect(bare).toEqual([])
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

describe('raw cells keep the bundled type', () => {
  it('falls back from Plex Mono to the bundled Hebrew, which carries ₪ (M54 U3)', () => {
    const tokens = readFileSync('src/ui/theme/tokens.css', 'utf8')
    expect(tokens).toMatch(/--font-mono: "IBM Plex Mono", "IBM Plex Sans Hebrew",/)
  })
})

describe('the title bar leaves the caption buttons their room', () => {
  // *The app draws the title bar*: without `min-w-0` the document's row is as wide as its
  // name, and a long one pushed Save, New, Open… and Open recent under the platform's
  // caption buttons at the default size (M54 U6).
  it('lets the document row shrink, so the name truncates instead', () => {
    const bar = readFileSync('src/ui/DocumentBar.tsx', 'utf8')
    expect(bar).toMatch(/key="open" className="[^"]*\bmin-w-0\b/)
  })
})

describe('an empty state is ink-secondary', () => {
  // *An empty state is one sentence* in `ink-secondary`; `ink-tertiary` read 2.6:1 on the
  // light dialog and 3.4:1 on the dark one (M54 U6). The shell's dialogs, checked by name.
  it.each(['src/ui/EarlierCopies.tsx'])('%s', (path) => {
    const empties = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => /None yet|Open a document from a file/.test(line))
    expect(empties.length).toBeGreaterThan(0)
    expect(empties.filter((line) => line.includes('text-ink-tertiary'))).toEqual([])
  })
})

describe('Emerald’s page respects the reader’s font size', () => {
  // *rem for type*: the page's root was `font-size: 16px`, which overrode a reader's own
  // setting for every rem on the page (M54 U7). A percentage keeps 16px as the default.
  it('sizes its root in a percentage, never in pixels', () => {
    const page = readFileSync('src/demo/page/page.css', 'utf8')
    const root = /\nhtml \{([^}]*)\}/.exec(page)?.[1] ?? ''
    expect(root).toMatch(/font-size: 100%;/)
    expect(page).not.toMatch(/font-size:\s*[\d.]+px/)
  })
})

describe('the page’s reel holds still under reduced motion', () => {
  // *Reduced motion runs none of it*: a picked step un-paused the reel, so after one pick
  // the pictures advanced every 6 s under reduced motion (M54 U7). Only Play starts it there.
  it('un-pauses on a picked step only when motion is on', () => {
    const reel = readFileSync('src/demo/page/reel.ts', 'utf8')
    const pick = /step\.addEventListener\('click', \(\) => \{([^}]*)\}\)/.exec(reel)?.[1] ?? ''
    expect(pick).toContain('if (!reduced.matches) paused = false')
    expect(pick.replace('if (!reduced.matches) paused = false', '')).not.toMatch(/paused = false/)
  })
})

describe('an earlier copy keeps its label’s start', () => {
  // *Hebrew needs bidi isolation*: the ellipsis on the Bidi span, never on the box around
  // "named · before …" (M54 U6). bidiTruncation.test.ts sees only a box that opens onto <Bidi>.
  it('truncates the Bidi span itself', () => {
    const copies = readFileSync('src/ui/EarlierCopies.tsx', 'utf8')
    expect(copies).toContain('<Bidi className="min-w-0 truncate">{copy.before}</Bidi>')
  })
})

describe('the tour sizes its type from the ramp', () => {
  // *Every value is a token*: frame.css wrote 12, 14 and 20px where the ramp has
  // `--text-caption`, `--text-body` and `--text-secondary-number` (M54 U8). Its 11, 13
  // and 17px have no step, and are a review entry.
  it('names the ramp’s step wherever the ramp has the size', () => {
    const frame = readFileSync('src/demo/tour/frame.css', 'utf8')
    const literal = new RegExp(`font-size:\\s*(${RAMP_SIZES.join('|')})px`, 'g')
    expect(frame.match(literal) ?? []).toEqual([])
  })
})

describe('the tour asks for reduced motion when it moves', () => {
  // *Reduced motion runs none of it*: the player read the OS once, when the frame
  // mounted, so asking for less motion mid-tour left the ring travelling and the
  // typing typed (M54 U8). It is a getter now, read at each travel and each type.
  it('reads the preference at the moment, never once at mount', () => {
    const frame = readFileSync('src/demo/tour/Frame.tsx', 'utf8')
    expect(frame).toMatch(/get reduced\(\) \{\s*return reducedMotion\(\)/)
    expect(frame).not.toMatch(/reduced: window\.matchMedia/)
  })
})

describe('the tour’s play button casts no shadow', () => {
  // *No gradients, no shadows*: `--shadow-pop` belongs to the rooms that float, and
  // Watch the tour is a control (M54 U8). The receipt's and the chat card's shadows
  // are a question for the maintainer, recorded.
  it('keeps --shadow-pop off .tour-play', () => {
    const frame = readFileSync('src/demo/tour/frame.css', 'utf8')
    const play = /\n\.tour-play \{([^}]*)\}/.exec(frame)?.[1] ?? ''
    expect(play).toContain('background: var(--color-accent)')
    expect(play).not.toMatch(/box-shadow/)
  })
})

describe('the shared looks every screen spends (M54 F1)', () => {
  const tokens = readFileSync('src/ui/theme/tokens.css', 'utf8')

  // *A chip is text and a dot* (D-531): `.fc-state` loses its border app-wide, and
  // its fill with it; the tone is the text's colour and the dot's.
  it('draws a chip as text and a dot, with no border and no fill', () => {
    const rules = [...tokens.matchAll(/\n\s*(\.fc-state[^{,]*)\{([^}]*)\}/g)]
    const boxed = rules.flatMap(([, selector = '', body = '']) =>
      selector.includes('::before') || selector.includes('-dot') ? [] : /\b(border|background)\b/.test(body) ? [selector.trim()] : [],
    )
    expect(rules.length).toBeGreaterThan(4)
    expect(boxed).toEqual([])
    expect(tokens).toMatch(/\.fc-state:not\(:has\(> \.fc-state-dot, > svg\)\)::before \{/)
  })

  // *Square by spending the radius tokens*: a field is square like a button and a menu.
  it('squares every field by spending --radius-control', () => {
    for (const look of [FIELD, SELECT, FIELD_MULTILINE]) {
      expect(look).not.toMatch(/\brounded-(sm|md|lg|xl|full)\b/)
      expect(look).toMatch(/\brounded-control\b/)
    }
  })

  // *Contrast 4.5:1 for text*: a live chip, a flow and a negative figure on a selected
  // row's plane, in both themes (accent 4.43:1 light, flow-saved 4.16:1 dark before).
  it('keeps every tone that sits on a selected row at AA', () => {
    const value = (token: string, theme: 'light' | 'dark') => {
      const blocks = theme === 'light' ? [tokens.slice(tokens.indexOf('@theme {'))] : tokens.split(':root[data-theme="dark"] {').slice(1)
      for (const block of blocks) {
        const found = new RegExp(`${token}:\\s*(#[0-9a-fA-F]+);`).exec(block.slice(0, block.indexOf('\n}')))?.[1]
        if (found !== undefined) return parseColour(found)!
      }
      throw new Error(`${token} has no ${theme} value`)
    }
    const short = (['light', 'dark'] as const).flatMap((theme) =>
      ['accent', 'negative', 'positive', 'flow-in', 'flow-out', 'flow-saved', 'flow-tax', 'ink-secondary'].flatMap((tone) => {
        const ratio = contrast(value(`--color-${tone}`, theme), value('--color-accent-soft', theme))
        return ratio >= 4.5 ? [] : [`${theme} ${tone} ${ratio.toFixed(2)}`]
      }),
    )
    expect(short).toEqual([])
  })
})

describe('the formats and rows surface, swept (M54 F2)', () => {
  // *Every value is a token* and *Nothing between the spacing steps* (D-531): no
  // type size in pixels at all — 13px moves onto 12 or 14, 11px onto the label or
  // the caption — and no spacing or height between the steps. A layout width
  // (`max-w-[1120px]`, a lane's `min-w-[200px]`) is a measure, not a step.
  const SWEPT = [
    'src/ui/screens/Formats.tsx',
    'src/ui/screens/DeclaredFormats.tsx',
    'src/ui/screens/FormatRows.tsx',
    'src/ui/formats/BoardView.tsx',
    'src/ui/formats/EntryView.tsx',
    'src/ui/formats/EntryValue.tsx',
    'src/ui/formats/EntryList.tsx',
    'src/ui/formats/ListView.tsx',
    'src/ui/formats/FormatDoors.tsx',
    'src/ui/formats/SavedTab.tsx',
  ]
  it.each(SWEPT)('%s sizes type from the ramp and spaces on the steps', (path) => {
    const source = readFileSync(path, 'utf8')
    expect(source.match(/\btext-\[[0-9.]+px\]|\btracking-\[|\bleading-\[/g) ?? []).toEqual([])
    const between = /(?<![\w-])-?(?:m|p|[mp][xytblrse]|gap|gap-[xy]|space-[xy]|inset|inset-[xy]|top|left|right|bottom|h|min-h)-\[[0-9.]+px\]/g
    expect(source.match(between) ?? []).toEqual([])
  })

  // *One level of tabs* (D-531): every tab's label is ink-secondary, and the open one ink.
  it('labels the format’s tabs in ink-secondary', () => {
    const tabs = readFileSync('src/ui/formats/SavedTab.tsx', 'utf8')
    expect(tabs).toMatch(/TAB_OFF =\s*'text-ink-secondary /)
    const rows = readFileSync('src/ui/screens/FormatRows.tsx', 'utf8')
    expect(rows).toContain('${tab.on ? TAB_ON : TAB_OFF}')
    expect(rows).not.toMatch(/text-ink-tertiary shadow-\[inset_0_-2px_0_transparent\]/)
  })

  // *A screen names itself with a heading* (WCAG 2.4.6), and *Words name the rule*:
  // a format's table name is machinery, never on its page or its card.
  it('heads a format’s page with its title, and shows no table name', () => {
    for (const path of ['src/ui/screens/FormatRows.tsx', 'src/ui/screens/DeclaredFormats.tsx']) {
      const source = readFileSync(path, 'utf8')
      expect(source).toMatch(/<h1 className="text-body font-medium/)
      expect(source).not.toContain('tableNameFor(')
    }
  })

  // *A card is one link* (D-531): a board card's title is stretched over it, and its arrows sit above.
  it('makes the whole board card its link', () => {
    const board = readFileSync('src/ui/formats/BoardView.tsx', 'utf8')
    expect(board).toMatch(/fc-board-card relative /)
    expect(board).toMatch(/fc-card-title [^"]*after:absolute after:inset-0/)
    expect(board).toContain('relative z-10 ml-auto flex')
  })
})


describe('the views and dashboards, swept (M54 F3)', () => {
  const SWEPT = [
    'src/ui/formats/Dashboard.tsx',
    'src/ui/formats/MakeBlock.tsx',
    'src/ui/formats/RollupView.tsx',
    'src/ui/formats/FilterBand.tsx',
    'src/ui/formats/ConnectionGraph.tsx',
    'src/ui/formats/ConnectionPanel.tsx',
    'src/ui/formats/LinkViews.tsx',
    'src/ui/screens/Dashboard.tsx',
    'src/ui/screens/Connections.tsx',
    'src/ui/screens/Agenda.tsx',
    'src/ui/screens/Calendar.tsx',
    'src/ui/screens/FormatLinkViews.tsx',
    'src/ui/charts/Chart.tsx',
  ]
  // *Every value is a token*, *Nothing between the spacing steps*, *Square by
  // spending the radius tokens* and *Contrast 4.5:1 for text* (D-531): no type,
  // tracking or leading in pixels, no spacing between the steps, no radius but a
  // dot's, and no text in ink-tertiary but a placeholder's or a disabled one's.
  it.each(SWEPT)('%s sizes, spaces, squares and inks from the tokens', (path) => {
    const source = readFileSync(path, 'utf8')
    expect(source.match(/\btext-\[[0-9.]+px\]|\btracking-\[|\bleading-\[/g) ?? []).toEqual([])
    const between = /(?<![\w-])-?(?:m|p|[mp][xytblrse]|gap|gap-[xy]|space-[xy]|inset|inset-[xy]|top|left|right|bottom|h|min-h)-\[[0-9.]+px\]/g
    expect(source.match(between) ?? []).toEqual([])
    expect(source.match(/\brounded(?:-(?:sm|md|lg|xl))?\b(?!-)/g) ?? []).toEqual([])
    expect(source.match(/(?<![\w:-])text-ink-tertiary\b/g) ?? []).toEqual([])
    // *No gradients, no shadows*: a drop target is a rule, never a shadow.
    expect(source).not.toMatch(/shadow-\[/)
  })

  // *Mono for raw cells only* and *Charts are ink*: a bar's figure is the app's own
  // type, an axis's labels ink-secondary; and *A card is one link*: a board card's
  // hover lifts nothing.
  it('draws a chart’s figures in the app’s type, and a board card’s hover without a shadow', () => {
    const tokens = readFileSync('src/ui/theme/tokens.css', 'utf8')
    const rule = (selector: string): string => {
      const at = tokens.indexOf(`\n${selector} {`)
      return at === -1 ? '' : tokens.slice(at, tokens.indexOf('}', at))
    }
    expect(rule('.fc-chart-val')).not.toMatch(/font-mono/)
    expect(rule('.fc-chart-val')).toMatch(/font-size: var\(--text-label\)/)
    expect(rule('.fc-col-tick')).toMatch(/fill: var\(--color-ink-secondary\)/)
    const hover = [...tokens.matchAll(/\n(\.fc-board-card[^{]*:hover[^{]*)\{([^}]*)\}/g)].map(([, , body = '']) => body)
    expect(hover.length).toBeGreaterThan(0)
    for (const body of hover) expect(body).not.toMatch(/shadow-pop/)
  })

  // *Keyboard first*, the WAI-ARIA menu pattern and separator: a block's ⋯ menu
  // and Add a block move by the arrows and give Escape back to what opened them;
  // each resize handle says its value; ⋯ is a 28px target with a 16px icon.
  it('keeps the dashboard’s menus and handles in the keyboard’s reach', () => {
    const dashboard = readFileSync('src/ui/formats/Dashboard.tsx', 'utf8')
    expect(dashboard.match(/menuKeys\(event\)/g)).toHaveLength(2)
    expect(dashboard).toContain('more.current?.focus()')
    expect(dashboard).toContain('opener.current?.focus()')
    expect(dashboard.match(/\{\.\.\.(across|along)\}/g)).toHaveLength(3)
    expect(dashboard).toContain(`'aria-valuenow': width`)
    expect(dashboard).toMatch(/className="fc-icon-action [^"]*"\s*>\s*<ActionGlyph name="more" size=\{16\}/)
  })

  // *Choices are ChoiceField: it stays a text field* — the band's column field is typed into.
  it('lets the filter’s column field be typed into', () => {
    const band = readFileSync('src/ui/formats/FilterBand.tsx', 'utf8')
    const field = band.slice(band.indexOf('export function ColumnFilter'), band.indexOf('function tickKey'))
    expect(field).not.toMatch(/readOnly/)
    expect(field).toMatch(/\n\s*filter\n/)
  })

  // *A screen names itself*: one h1, on the title step.
  it('heads each screen with one h1 on the title step', () => {
    for (const path of ['src/ui/screens/Dashboard.tsx', 'src/ui/screens/Calendar.tsx', 'src/ui/screens/Connections.tsx']) {
      const source = readFileSync(path, 'utf8')
      expect(source.match(/<h1 /g)).toHaveLength(1)
      expect(source).toMatch(/<h1 className="m-0 text-title">/)
    }
  })
})
