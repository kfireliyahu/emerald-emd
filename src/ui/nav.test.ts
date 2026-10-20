import { describe, expect, it } from 'vitest'

import { addressFilter, filterAddress } from './formats/addressFilter.ts'
import {
  isSectionTabs,
  NAVIGATION,
  activeTab,
  childIsActive,
  entryPath,
  formatPath,
  packSection,
  railSectionFor,
  railSections,
  sectionFor,
  tablePath,
  tabsFor,
} from './nav.ts'

/**
 * The navigation used to be five lists in five components; it is one list now
 * (D-130). What is worth testing is the thing that got harder when it moved:
 * the sidebar expands a section because you are *inside* it, so a path nobody
 * clicked — a drill-through, a stale bookmark, a fund detail — has to resolve
 * to the same section a click would have opened.
 *
 * D-157 added a third level and one new way to be wrong: a *tab* is a view of a
 * place rather than a place, it is not in the sidebar at all, and the child it
 * belongs to has to light up while you are standing on it. Wealth lost four
 * sidebar children that way and none of them became unreachable.
 */

describe('the navigation model', () => {
  it('resolves a section from any path inside it, however deep', () => {
    expect(sectionFor('/wealth/funds/3')?.label).toBe('Wealth')
    expect(sectionFor('/plan/splitter')?.label).toBe('Plan')
    // Rules sit beside the categories they fill (M36 U10).
    expect(sectionFor('/categories/rules')?.label).toBe('Categories')
    expect(activeTab(tabsFor('/categories/rules') ?? [], '/categories/rules')?.label).toBe('Rules')
    // Every reader is in one list beside Read files, and Month stays lit (M36 U10).
    expect(sectionFor('/read/readers')?.label).toBe('Home')
    expect(activeTab(tabsFor('/read/readers') ?? [], '/read/readers')?.label).toBe('Month')
  })

  it('keeps Home to the root and its own periods, so two items are never active at once', () => {
    expect(sectionFor('/')?.label).toBe('Home')
    expect(sectionFor('/year')?.label).toBe('Home')
    expect(sectionFor('/read')?.label).toBe('Home')
    expect(sectionFor('/read/2')?.label).toBe('Home')
    expect(sectionFor('/transactions')?.label).toBe('Transactions')
    // Paychecks is its own section since D-157: intake, not planning.
    expect(sectionFor('/paychecks')?.label).toBe('Paychecks')
    // `/categorize` is only a redirect to By merchant now (M28 U6), so no section
    // owns it and nothing in the sidebar lights up for it.
    expect(sectionFor('/categorize')).toBeUndefined()
  })

  it('never matches a section by a shared prefix that is not a path segment', () => {
    expect(sectionFor('/plandemonium')).toBeUndefined()
    expect(sectionFor('/yearbook')).toBeUndefined()
  })

  it('points every child at a path under its own section', () => {
    for (const section of NAVIGATION) {
      for (const child of section.children ?? []) {
        // Wealth's Overview is the section's own path (M28 U8); `end` is how it says so.
        expect(child.to.startsWith(`${section.to}/`) || (child.end === true && child.to === section.to)).toBe(true)
        expect(sectionFor(child.to)?.to).toBe(section.to)
      }
    }
  })

  it('gives every section a distinct glyph, because collapsed that is all there is', () => {
    const glyphs = NAVIGATION.map((section) => section.glyph)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  /**
   * The strip has to have something to be on the moment you arrive from the
   * sidebar, which is only true while the owner's own path is also its first
   * tab. Getting this wrong shows as a tab strip with nothing marked.
   */
  it('starts every tab strip on the path that owns it', () => {
    for (const section of NAVIGATION) {
      if (section.tabs !== undefined) expect(section.tabs[0]?.to).toBe(section.to)
      for (const child of section.children ?? []) {
        if (child.tabs !== undefined) expect(child.tabs[0]?.to).toBe(child.to)
      }
    }
  })

  it('finds the strip a path belongs to, and nothing for a path with no views', () => {
    // Funds has no strip since M28 U8: fee impact is its section, the deposit check its column.
    expect(tabsFor('/wealth/fees')).toBeUndefined()
    // Debts is a place of its own since M28 U8: no strip over it.
    expect(tabsFor('/wealth/debts')).toBeUndefined()
    expect(tabsFor('/year')?.map((tab) => tab.label)).toEqual(['Month', 'Year'])
    // Reading files is the month's own screen (M28 U5): Month stays lit.
    expect(activeTab(tabsFor('/read') ?? [], '/read')?.label).toBe('Month')
    expect(tabsFor('/wealth/worth')).toBeUndefined()
    expect(tabsFor('/settings/model')).toBeUndefined()
    expect(tabsFor('/transactions')).toBeUndefined()
  })

  it('marks the tab a detail route is under, not the one that merely starts the strip', () => {
    const tabs = tabsFor('/paychecks/deductions/3')
    expect(tabs).toBeDefined()
    expect(activeTab(tabs ?? [], '/paychecks/deductions/3')?.label).toBe('Deduction types')
  })

  /**
   * Home's first tab is `/`, which is a prefix of every path there is. It has
   * to match exactly or the period control claims the whole app.
   */
  it('does not let the root tab claim every path', () => {
    expect(tabsFor('/plan/splitter')).toBeUndefined()
    expect(activeTab(NAVIGATION[0]?.tabs ?? [], '/')?.label).toBe('Month')
    expect(activeTab(NAVIGATION[0]?.tabs ?? [], '/year')?.label).toBe('Year')
  })

  it('lights a sidebar child while you are on any view of it', () => {
    const wealth = NAVIGATION.find((section) => section.to === '/wealth')
    const find = (to: string) => wealth?.children?.find((child) => child.to === to)
    const funds = find('/wealth/funds')
    const goals = find('/wealth/goals')
    const overview = find('/wealth')
    expect(funds).toBeDefined()
    expect(goals).toBeDefined()
    expect(overview).toBeDefined()
    if (funds === undefined || goals === undefined || overview === undefined) return

    expect(childIsActive(funds, '/wealth/funds/3')).toBe(true)
    expect(childIsActive(funds, '/wealth/deposits')).toBe(true)
    expect(childIsActive(funds, '/wealth/goals')).toBe(false)
    expect(childIsActive(goals, '/wealth/goals/2')).toBe(true)
    // Overview is `/wealth` itself, and the money map it absorbed: not a prefix of everything.
    expect(childIsActive(overview, '/wealth')).toBe(true)
    expect(childIsActive(overview, '/wealth/places')).toBe(true)
    expect(childIsActive(overview, '/wealth/goals')).toBe(false)
    expect(childIsActive(overview, '/wealth/debts/9')).toBe(false)
  })
})

/**
 * D-170 moved the payroll vocabulary out of Settings and made it a view of the
 * screen whose documents it describes.
 */
describe('deduction types as a view of Paychecks', () => {
  it('is a tab of Paychecks and not a place in the rail', () => {
    const tabs = tabsFor('/paychecks/deductions')
    expect(tabs?.map((tab) => tab.to)).toEqual(['/paychecks', '/paychecks/deductions'])
    expect(activeTab(tabs ?? [], '/paychecks/deductions')?.label).toBe('Deduction types')
    // The deepest match wins, so standing on the tab does not light up its owner.
    expect(activeTab(tabs ?? [], '/paychecks')?.label).toBe('Paychecks')
  })

  it("is one of a section's own views, which the rail lists under it (M28 U4)", () => {
    expect(isSectionTabs(tabsFor('/paychecks/deductions') ?? [])).toBe(true)
    expect(isSectionTabs(tabsFor('/wealth/funds') ?? [])).toBe(false)
  })

  it('leaves the sidebar showing Paychecks while you are on it', () => {
    expect(sectionFor('/paychecks/deductions')?.label).toBe('Paychecks')
  })

  it('is gone from Settings, which is the half that makes it findable', () => {
    const settings = NAVIGATION.find((section) => section.label === 'Settings')
    expect(settings?.children?.map((child) => child.to)).not.toContain('/settings/deductions')
  })
})

/**
 * **Staging the pack is a filter and nothing else** — M20 U0, D-227.
 *
 * The whole risk of hiding a screen is that something else quietly stops
 * working with it: the sidebar's expansion, a tab strip, a bookmark. So what
 * is tested here is the *separation* — `railSections` leaves places out, and
 * every question about a path is still answered off the full list, which is
 * what makes "no route dies" checkable rather than promised.
 */
describe('the ledger, staged', () => {
  const staged = railSections({ ledger: false })
  const showing = railSections({ ledger: true })

  it('leaves the engine’s own places standing, and nothing of the pack', () => {
    // Connections joined them in M20 U5 (D-233): the third arrow is a place of
    // the engine's, so staging the pack does not touch it.
    expect(staged.map((section) => section.label)).toEqual([
      'Formats',
      'Connections',
      'Assistants',
      'Settings',
    ])
  })

  it('shows the whole rail again when the pack is shown, in its own order', () => {
    // The agenda is a place only while some format has a date (M49 U3).
    expect(showing.map((section) => section.label)).toEqual(NAVIGATION.map((one) => one.label).filter((label) => label !== 'Agenda'))
    const dated = railSections({ ledger: true }, [{ name: 'assignment', title: 'Assignment', dated: true }])
    expect(dated.map((section) => section.label)).toContain('Agenda')
    expect(railSections({ ledger: false }, [{ name: 'course', title: 'Course' }]).map((section) => section.label)).not.toContain('Agenda')
  })

  it('stages a child as well as a section, because Settings holds both halves', () => {
    const settings = staged.find((section) => section.label === 'Settings')
    expect(settings?.children?.map((child) => child.to)).toEqual([
      '/settings/packs',
      '/settings/model',
    ])
  })

  it('keeps Packs out of the pack it switches, or it could not be switched back', () => {
    expect(
      NAVIGATION.flatMap((section) => section.children ?? []).find(
        (child) => child.to === '/settings/packs',
      )?.pack,
    ).toBeUndefined()
  })

  it('still resolves a staged path to its section and its strip, for a bookmark', () => {
    expect(sectionFor('/wealth/funds/3')?.label).toBe('Wealth')
    expect(tabsFor('/paychecks/deductions')).toBeDefined()
  })

  it('drops the key rather than leaving an empty children array', () => {
    for (const section of [...staged, ...showing]) {
      expect(section.children).not.toEqual([])
    }
  })
})

/**
 * **A format's name is a place** — M20 U1, D-227.
 *
 * The declared formats are the one part of the rail the document decides, and
 * they arrive as an argument rather than as a read so that this file stays the
 * navigation *as data*. What is worth holding still is that they behave like
 * every other child: the section resolves from a format's own path, and the
 * child lights while you are on it.
 */
describe('the declared formats as places', () => {
  const rail = railSections({ ledger: false }, [
    { name: 'ingredient', title: 'Ingredient' },
    { name: 'recipe_line', title: 'Recipe line' },
  ])
  const formats = rail.find((section) => section.to === '/formats')

  it('hangs every declared format under Formats, by its title', () => {
    expect(formats?.children?.map((child) => child.label)).toEqual(['Ingredient', 'Recipe line'])
  })

  it('routes one by its name and never by its table name', () => {
    expect(formatPath('ingredient')).toBe('/formats/ingredient')
    expect(formats?.children?.map((child) => child.to)).toEqual([
      '/formats/ingredient',
      '/formats/recipe_line',
    ])
  })

  it('puts a format inside the Formats section, so the rail opens where you are', () => {
    expect(sectionFor('/formats/ingredient')?.label).toBe('Formats')
  })

  it('lights the format you are standing on, and only that one', () => {
    const [first, second] = formats?.children ?? []
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return
    expect(childIsActive(first, '/formats/ingredient')).toBe(true)
    expect(childIsActive(second, '/formats/ingredient')).toBe(false)
  })

  it('leaves Formats childless when the document declares none', () => {
    const empty = railSections({ ledger: false }, [])
    expect(empty.find((section) => section.to === '/formats')?.children).toBeUndefined()
  })
})

/**
 * **A kept pack is drawn from its views** — M27 U7. No branch names the pack:
 * the section is its views and its formats, and its formats leave `Formats`.
 */
describe('a pack drawn from its views', () => {
  const pack = {
    id: 'development',
    title: 'Development',
    views: [
      { kind: 'roadmap', format: 'milestone' },
      { kind: 'board', format: 'open_question' },
      { kind: 'board', format: 'unit' },
      { kind: 'ready', format: 'unit' },
    ],
    formats: ['milestone', 'open_question', 'unit'],
  } as const
  const places = [
    { name: 'milestone', title: 'Milestone' },
    { name: 'open_question', title: 'Open question' },
    { name: 'unit', title: 'Unit' },
    { name: 'ingredient', title: 'Ingredient' },
  ]
  const rail = railSections({ ledger: false, development: true }, places, [pack])
  const drawn = rail.find((section) => section.label === 'Development')

  it('sits before Formats, and takes its formats out of it', () => {
    expect(rail.map((section) => section.label)).toEqual(['Development', 'Formats', 'Connections', 'Assistants', 'Settings'])
    expect(rail.find((section) => section.to === '/formats')?.children?.map((child) => child.label)).toEqual([
      'Ingredient',
    ])
  })

  it('names a view drawn once by its kind, and one drawn twice by its format too', () => {
    expect(drawn?.children?.map((child) => [child.label, child.to])).toEqual([
      ['Roadmap', '/formats/milestone/roadmap'],
      ['Open question board', '/formats/open_question/board'],
      ['Unit board', '/formats/unit/board'],
      ['Ready to start', '/formats/unit/ready'],
      ['Milestone', '/formats/milestone'],
      ['Open question', '/formats/open_question'],
      ['Unit', '/formats/unit'],
    ])
    expect(drawn?.to).toBe('/formats/milestone/roadmap')
  })

  it('opens the pack’s section on its places, and Formats on a format of nobody’s', () => {
    expect(railSectionFor(rail, '/formats/unit/board')?.label).toBe('Development')
    expect(railSectionFor(rail, '/formats/unit/page/abc')?.label).toBe('Development')
    expect(railSectionFor(rail, '/formats/ingredient')?.label).toBe('Formats')
  })

  it('draws nothing for a pack the document does not keep, or for formats it lacks', () => {
    expect(railSections({ development: false }, places, [pack]).map((s) => s.label)).not.toContain('Development')
    expect(packSection(pack, [])).toBeUndefined()
  })
})

/**
 * **An entry page goes back to the table it was opened from** (M42 F12): a
 * delete used to land on the bare table, every row showing, because the row
 * was gone before the address moved and the missing-row redirect dropped the
 * filter. Back, a delete and a missing row all go through `tablePath`.
 */
describe('the table an entry goes back to keeps its filter', () => {
  const filter = { match: { state: 'open' }, search: 'bidi' }
  const address = filterAddress(filter)

  it('is the table with the address the entry was opened with', () => {
    const entry = entryPath('open_question', '396c8a8b') + address
    const search = entry.slice(entry.indexOf('?'))
    const back = tablePath('open_question', search)
    expect(back).toBe('/formats/open_question?state=open&search=bidi')
    expect(addressFilter(back.slice(back.indexOf('?')))).toEqual(filter)
  })

  it('is the bare table when nothing was filtered', () => {
    expect(tablePath('open_question', '')).toBe(formatPath('open_question'))
  })
})
