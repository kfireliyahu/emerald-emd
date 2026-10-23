/**
 * The navigation, as data (D-130), in the order a person gets ready (D-157).
 *
 * Until the sidebar, this lived in five places: a `Nav` in `App.tsx` and a
 * sub-nav inside each of `Plan`, `Wealth`, `InsightsShell` and `Settings` —
 * four copies of the same five lines, which D-072 defended on the grounds that
 * a shared shell whose only variable is a list of links is not worth the
 * indirection. That was true while the lists were *drawn* in four places. They
 * are drawn in one now, so they are declared in one.
 *
 * **The order is intake first** (D-157). A payslip, a statement and a fund
 * report are things you *bring in*; a plan is what you make once they are in;
 * savings, debts and net worth are what they add up to. Paychecks is therefore
 * top level rather than Plan's first tab, and Insights is not a section at all:
 * the month *is* Home, and the year and trends are two more periods of it.
 *
 * **Three levels, and only two of them are in the sidebar.** A section and its
 * children are places; a child's `tabs` are views *of* one place, reached by a
 * control on the screen rather than by a link in the rail. The palette shows
 * all three, because a palette is read by someone who knows a screen's name and
 * not where it lives.
 *
 * Every route that ever worked still resolves — `#/insights/year`,
 * `#/plan/paychecks`, `#/wealth/fees` — through the redirects in `App.tsx`
 * (D-031).
 *
 * **Most of this list is the ledger pack's, and shows when the open document
 * keeps a ledger** (M20 U0, D-227; M25 U8). A place says whose it is with
 * `pack`, `railSections` leaves out the packs the document does not keep, and
 * nothing else in this file knows: a hidden place keeps its route, its section
 * and its tab strip, because the filter is about what you are offered and not
 * about what exists.
 */

/** Which of the hand-drawn glyphs a top-level item wears when collapsed. */
export type NavGlyph =
  | 'home'
  | 'dashboard'
  | 'transactions'
  | 'paychecks'
  | 'plan'
  | 'wealth'
  | 'categories'
  | 'formats'
  | 'connections'
  | 'agenda'
  | 'mcp'
  | 'settings'
  | 'pack'

/**
 * A view of a place, not a place of its own.
 *
 * Drawn as a tab strip above the screen (`ViewTabs`) and never in the sidebar:
 * a rail that lists every view of every screen is the seven-item Wealth section
 * this replaced. The first tab's `to` is always its owner's own path, so the
 * strip has something to be on when you arrive from the sidebar.
 */
export interface NavTab {
  readonly to: string
  readonly label: string
  /**
   * Paths that are this view's own screens without being views of their own —
   * reading files is the month's (M28 U5): the rail keeps Month lit while it is
   * open, and the root section owns it.
   */
  readonly also?: readonly string[]
}

export interface NavChild {
  readonly to: string
  readonly label: string
  /** Lit only on its own path, as Home is: Wealth's overview is `/wealth` itself. */
  readonly end?: boolean
  /** Paths that belong to a child lit with `end`, which `startsAt` would not reach. */
  readonly also?: readonly string[]
  readonly tabs?: readonly NavTab[]
  /** Whose place this is. Absent means the engine's, which every document has. */
  readonly pack?: PackId
  /**
   * The heading it is drawn under, indented once more — the name of the pack a
   * format came from (M33 F3). Children that share one are drawn together.
   */
  readonly group?: string
  /**
   * The format this place is, by name, when it is one — drawn in the rail as
   * a folder of its entries (M37 U2, D-475).
   */
  readonly format?: string
}

/**
 * A pack a place can belong to — M20 U0 (D-227).
 *
 * A name rather than a closed list since M27 U7: which packs a document keeps
 * is asked of every pack in `data/packs/packs.ts`, and a third one costs a
 * pack file there and no word here. The ledger is still the only pack with
 * hand-drawn places in `NAVIGATION`; a pack that declares views is drawn from
 * them instead (`PackRail`).
 */
export type PackId = string

export interface NavSection {
  readonly to: string
  readonly label: string
  readonly glyph: NavGlyph
  /** Whose place this is. Absent means the engine's, which every document has. */
  readonly pack?: PackId
  /**
   * `end` only for Home: without it the root matches every route beneath it
   * and the sidebar shows two active items.
   */
  readonly end?: boolean
  /** Shown nested, and only while the section is the one you are in. */
  readonly children?: readonly NavChild[]
  /** Views of the section itself, for a section with no children. */
  readonly tabs?: readonly NavTab[]
}

export const NAVIGATION: readonly NavSection[] = [
  {
    to: '/',
    label: 'Home',
    glyph: 'home',
    pack: 'ledger',
    end: true,
    // The period control, which is what is left of Insights (D-157). **Month
    // and Year** (M28 U5, D-313): the names chosen, without the "this" that
    // made the month sound like the calendar's. Trends is not a third view any
    // more — its three parts are the year's, and `/trends` lands there.
    // Read files and the one Readers list (M36 U10) are the month's own screens.
    tabs: [
      { to: '/', label: 'Month', also: ['/read'] },
      { to: '/year', label: 'Year' },
    ],
  },
  // **The document's dashboard** (M53 U7, D-521): its own place, right under
  // Home — first, and `#/` itself, in a document with no ledger. Blocks from any
  // format, and nothing else (D-514).
  { to: '/dashboard', label: 'Dashboard', glyph: 'dashboard' },
  {
    to: '/transactions',
    label: 'Transactions',
    glyph: 'transactions',
    pack: 'ledger',
    // A statement's readers were a tab here (M28 U3) until the one Readers list
    // beside Read files took them (M36 U10); By merchant is a view on the page.
  },
  // Intake, not planning: a payslip is a document you bring in, and Plan is
  // what you do once it is in. It was Plan's first tab for three milestones and
  // `#/plan/paychecks` still lands here (D-157).
  {
    to: '/paychecks',
    label: 'Paychecks',
    glyph: 'paychecks',
    pack: 'ledger',
    // **The payroll vocabulary is a view of payroll** (D-170). It was
    // `/settings/deductions`, sixth of six children of the last section here —
    // and four other screens had to send people to it in a sentence, which is
    // the tell that a screen is not a setting. A tab, because a deduction type
    // is not a *place* you go: it is what the slips on this screen are made of.
    // **Where it went is part of a month** (M28 U4): it was a tab of its own
    // (D-193), and it was asked for beside the slip it follows, so it is
    // half of the month Paychecks opens on, and `/paychecks/trace` lands there.
    tabs: [
      { to: '/paychecks', label: 'Paychecks' },
      { to: '/paychecks/deductions', label: 'Deduction types' },
    ],
  },
  {
    to: '/plan',
    label: 'Plan',
    glyph: 'plan',
    pack: 'ledger',
  },
  {
    to: '/wealth',
    label: 'Wealth',
    glyph: 'wealth',
    pack: 'ledger',
    // **Four places, and a tab strip only where a place has views** (M28 U8,
    // D-312's frame). It was three children and seven entries: savings, debts and
    // the money map shared a strip, and net worth was a page of its own. Net worth
    // is four figures on Overview now; the money map is a section of it; a goal
    // names one place. Fee impact is a section of Funds and the deposit check a column of it. Every
    // old path forwards (D-031).
    children: [
      { to: '/wealth', label: 'Net worth', end: true, also: ['/wealth/places'] },
      { to: '/wealth/goals', label: 'Goals' },
      { to: '/wealth/debts', label: 'Debts' },
      // Fee impact and the deposit check are sections of Funds (D-327; M36 U10), and their paths
      // open Funds with the section open.
      { to: '/wealth/funds', label: 'Funds', also: ['/wealth/fees', '/wealth/deposits'] },
    ],
  },
  // **Rules sit beside the categories they fill** (M36 U10): they were a child
  // of Settings, and nine links on three screens sent people there.
  {
    to: '/categories',
    label: 'Categories',
    glyph: 'categories',
    pack: 'ledger',
    tabs: [
      { to: '/categories', label: 'Categories' },
      { to: '/categories/rules', label: 'Rules' },
    ],
  },
  // **The engine, and it is a place rather than a setting** (M19 U1, D-216).
  // A declared format is a kind of thing this document can hold — the same sort
  // of answer Transactions and Paychecks are, not a preference. It sits last of
  // the places and before Settings because nothing else in the rail depends on
  // it yet: finance keeps working untouched until the engine is good enough to
  // eat it (D-214).
  //
  // The label collides with the Settings child below, which has called F17's
  // stored templates "formats" since D-163 — and under the engine's four layers
  // those are **templates**: how one issuer's actual file maps onto a format.
  // Renaming that child is the smallest honest fix; the route is untouched, so
  // every bookmarked hash still lands.
  { to: '/formats', label: 'Formats', glyph: 'formats' },
  // **The third arrow, as a place** (M20 U5, D-233). A `link` and an aggregate
  // are facts about *two* formats, so they are authored between two bubbles
  // rather than in a section of a form about one — and the rail said nothing
  // about connections until there was a screen for them.
  { to: '/connections', label: 'Connections', glyph: 'connections' },
  // **Every dated format's rows on one list of days** (M49 U3, D-473). A place
  // of the engine's, drawn only while some format has a date (`railSections`).
  { to: '/agenda', label: 'Agenda', glyph: 'agenda' },
  // **Talking to the document from an assistant** (M26 U7, D-295): the tools
  // the MCP server offers and the snippet that connects one. In the rail and
  // not in Settings, by choice — it is a way into the document.
  { to: '/mcp', label: 'Assistants', glyph: 'mcp' },
  {
    to: '/settings',
    label: 'Settings',
    glyph: 'settings',
    children: [
      // **Where a document takes the ledger on** (M20 U0, D-227; M25 U8). It is
      // first because a rail this short is a rail somebody is looking for
      // something in, and in Settings because that section is always there.
      { to: '/settings/packs', label: 'Packs' },
      { to: '/settings/accounts', label: 'Accounts', pack: 'ledger' },
      // The ledger's readers left for the screens they feed in M28, and Rules
      // for Categories in M36 U10.
      // The engine's, and the one Settings child that is: U2c asks a local
      // model to work a declaration out from an example (D-221).
      { to: '/settings/model', label: 'Local model' },
      // **The day this document's weeks start on** (M53 F6, D-528): what
      // `this week` names, kept in the file beside its currency.
      { to: '/settings/calendar', label: 'Calendar' },
      // **A spreadsheet of what the document holds** (M28 U5, D-313): the
      // months' CSV was a button above the month on Home, and it was asked
      // for here.
      { to: '/settings/export', label: 'Export', pack: 'ledger' },
    ],
  },
]

/** A declared format, as the rail needs it. Its name is its route (M20 U1). */
export interface FormatPlace {
  readonly name: string
  readonly title: string
  /** Whether it has a date column, and so is on the agenda (M49 U3). */
  readonly dated?: boolean
}

/** The engine's own section, which is the one the document adds children to. */
export const FORMATS_PATH = '/formats'

/** The graph across formats (M20 U5). */
export const CONNECTIONS_PATH = '/connections'

/** Every dated format's rows from today (M49 U3, D-473). */
export const AGENDA_PATH = '/agenda'

/**
 * The route a format's rows are on.
 *
 * The *name* and not the table name: a declaration names declarations, and a
 * reader who had to know the `fmt_` prefix in order to read a URL would be
 * reading storage (D-216).
 */
export function formatPath(name: string): string {
  return `${FORMATS_PATH}/${name}`
}

/**
 * **The table an entry page goes back to, as it was filtered** (M42 F12): by
 * its back button, after a delete, and when its row is gone. `search` is the
 * address's — `?state=open&search=bidi&order:date=descending`, or empty — so the
 * filter and the sort the entry was opened from (M42 F14) are the ones the
 * table comes back with.
 */
export function tablePath(name: string, search: string): string {
  return formatPath(name) + search
}

/**
 * One entry of a format — **the one view of a row** (M26 U6; M35 U2, D-401):
 * a row's id, or `new` for a row not written yet. An id is a uuid, so it is
 * never the word `new`. Every way in lands here; `page/:id` redirects.
 */
export function entryPath(name: string, entry: string): string {
  return `${formatPath(name)}/entry/${encodeURIComponent(entry)}`
}

/** A format's board (M27 U3, D-301): its rows as cards in lanes. */
export function boardPath(name: string): string {
  return `${formatPath(name)}/board`
}

/** A format's roadmap (M27 U4, D-302): its rows in order, with what names each. */
export function roadmapPath(name: string): string {
  return `${formatPath(name)}/roadmap`
}

/** A format's ready view (M27 U5, D-303): what waits on nothing still open. */
export function readyPath(name: string): string {
  return `${formatPath(name)}/ready`
}

/** A format's list (M53 U4, D-519): one line per row, a tick, grouped by a column. Every format has one. */
export function listPath(name: string): string {
  return `${formatPath(name)}/list`
}

/**
 * **Where a saved view opens** (M53 U5, D-520): its kind's route with the
 * address it keeps — `#/formats/task/list?due=today`. A saved view is not a
 * route of its own, so a bookmark of it is the same address, and changing the
 * filter there is changing the view as it is drawn, never the one kept.
 */
export function savedViewPath(format: string, kind: 'table' | 'board' | 'list' | 'roadmap' | 'ready', address: string): string {
  const path =
    kind === 'board'
      ? boardPath(format)
      : kind === 'list'
        ? listPath(format)
        : kind === 'roadmap'
          ? roadmapPath(format)
          : kind === 'ready'
            ? readyPath(format)
            : formatPath(format)
  return path + address
}

/** The document's own dashboard (M53 U7, D-521): blocks from any format. */
export const DASHBOARD_PATH = '/dashboard'

/** A format's dashboard (M53 U7, D-521): the last tab of its strip. */
export function dashboardPath(name: string): string {
  return `${formatPath(name)}/dashboard`
}

/**
 * **Where a view opened from a dashboard goes back to** (M53 U7): a block's
 * title hands the route `{ from: 'dashboard', dashboard }` — a format's name,
 * or empty for the document's — and the view's back link reads it here.
 */
export function dashboardBack(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const held = state as { readonly from?: unknown; readonly dashboard?: unknown }
  if (held.from !== 'dashboard') return undefined
  return typeof held.dashboard === 'string' && held.dashboard !== '' ? dashboardPath(held.dashboard) : DASHBOARD_PATH
}

/** The state a dashboard hands what it opens: a format's name, or empty for the document's (M53 U7). */
export function dashboardState(dashboard: string | undefined): { readonly from: 'dashboard'; readonly dashboard: string } {
  return { from: 'dashboard', dashboard: dashboard ?? '' }
}

/**
 * **Where a dashboard's row or board card opens** (M53 F5, D-521): its
 * entry, with the block's saved view's address — so the list beside the
 * entry holds that block's rows, as opening from the full view does — and the
 * state its back link reads, `← Dashboard`.
 */
export function dashboardEntry(
  format: string,
  row: string,
  address: string,
  dashboard: string | undefined,
): { readonly to: string; readonly state: ReturnType<typeof dashboardState> } {
  return { to: entryPath(format, row) + address, state: dashboardState(dashboard) }
}

/**
 * **What an entry was opened from**, as its route's state carries it — a
 * list or a board (M53 U5), or a dashboard's row or card (M53 F5) — or
 * nothing, the table. Every step between entries keeps it.
 */
export type EntryCame =
  | { readonly from: 'list' | 'board' }
  | { readonly from: 'dashboard'; readonly dashboard: string }

export function entryCame(state: unknown): EntryCame | undefined {
  const from = typeof state === 'object' && state !== null ? (state as { from?: unknown }).from : undefined
  if (from === 'list' || from === 'board') return { from }
  if (from !== 'dashboard') return undefined
  const dashboard = (state as { dashboard?: unknown }).dashboard
  return dashboardState(typeof dashboard === 'string' ? dashboard : undefined)
}

/**
 * **Where an entry's back link goes, and what it reads**: `← List` to the
 * list and `← Board` to the board, each with the address the entry kept;
 * `← Dashboard` to the dashboard it came from (M53 F5); and nothing — the
 * format's own title — to the table.
 */
export function entryBack(
  came: EntryCame | undefined,
  name: string,
  address: string,
): { readonly path: string; readonly label: 'List' | 'Board' | 'Dashboard' | undefined } {
  if (came?.from === 'dashboard') return { path: dashboardBack(came) ?? DASHBOARD_PATH, label: 'Dashboard' }
  if (came?.from === 'list') return { path: listPath(name) + address, label: 'List' }
  if (came?.from === 'board') return { path: boardPath(name) + address, label: 'Board' }
  return { path: tablePath(name, address), label: undefined }
}

/** The word an entry's route takes for a row not written yet. */
export const NEW_ENTRY = 'new'

/** Where files are read onto a format (M26 U5): its readers, tried on each. */
export function readPath(name: string): string {
  return `${formatPath(name)}/read`
}

/** The formats a pack brought, under the pack's own name (M33 F3). */
export interface PackFormats<T> {
  readonly pack: PackId
  /** The pack's name as the app shows it everywhere else: *The ledger*, *Development*. */
  readonly title: string
  readonly formats: readonly T[]
}

/** A person's own formats, and each pack's under its name. */
export interface FormatsByPack<T> {
  readonly own: readonly T[]
  readonly packs: readonly PackFormats<T>[]
}

/**
 * **Whose each format is** — M33 F3. A format is a pack's when the pack is
 * kept and declares that name (`packs` is the kept ones); every other is the
 * person's. Packs come in the order given, and formats within each group in
 * the order they came in. A pack holding none of them is left out.
 */
export function groupByPack<T>(
  formats: readonly T[],
  packs: readonly Pick<PackRail, 'id' | 'title' | 'formats'>[],
  nameOf: (format: T) => string,
): FormatsByPack<T> {
  const whose = (format: T): PackId | undefined => packs.find((pack) => pack.formats.includes(nameOf(format)))?.id
  return {
    own: formats.filter((format) => whose(format) === undefined),
    packs: packs
      .map((pack) => ({
        pack: pack.id,
        title: pack.title,
        formats: formats.filter((format) => whose(format) === pack.id),
      }))
      .filter((group) => group.formats.length > 0),
  }
}

/**
 * `Formats`' children: the person's own first, at the top, then each pack's
 * under the pack's name (M33 F3) — so their own are found without reading past
 * a ledger's twenty.
 */
function formatChildren(formats: readonly FormatPlace[], packs: readonly PackRail[]): readonly NavChild[] {
  const grouped = groupByPack(formats, packs, (format) => format.name)
  const child = (format: FormatPlace): NavChild => ({ to: formatPath(format.name), label: format.title, format: format.name })
  return [
    ...grouped.own.map(child),
    ...grouped.packs.flatMap((group) =>
      group.formats.map((format) => ({ ...child(format), pack: group.pack, group: group.title })),
    ),
  ]
}

/** A view a pack declares that is a place of its own: one per format at most. */
export type PackViewKind = 'roadmap' | 'board' | 'ready'

/**
 * **A pack the document keeps, as the rail needs it** — M27 U7.
 *
 * Its views and its formats and nothing else: the section is drawn from them,
 * so a pack that declares a board gets a link to it without a line of rail
 * code naming the pack. Arrives as an argument for the reason the formats do —
 * this file is the navigation as data and reads no document.
 */
export interface PackRail {
  readonly id: PackId
  readonly title: string
  /** In the order the rail shows them; each names a format the pack declares. */
  readonly views: readonly { readonly kind: PackViewKind; readonly format: string }[]
  /** The pack's format names, which leave `Formats` for the pack's section. */
  readonly formats: readonly string[]
}

const VIEW_PATH: Record<PackViewKind, (name: string) => string> = {
  roadmap: roadmapPath,
  board: boardPath,
  ready: readyPath,
}

const VIEW_LABEL: Record<PackViewKind, string> = { roadmap: 'Roadmap', board: 'Board', ready: 'Ready to start' }

/**
 * A pack's section: its views, then its formats. **A view the pack draws once
 * is named by its kind** — *Roadmap*, *Ready* — and one it draws on several
 * formats by the format's title as well, *Unit board*. Only formats the
 * document declares are drawn, and a section with nothing to show is none.
 */
export function packSection(pack: PackRail, formats: readonly FormatPlace[]): NavSection | undefined {
  const title = new Map(formats.map((each) => [each.name, each.title] as const))
  const views = pack.views.filter((view) => title.has(view.format))
  const several = (kind: PackViewKind): boolean => views.filter((each) => each.kind === kind).length > 1
  const children: NavChild[] = [
    ...views.map((view) => ({
      to: VIEW_PATH[view.kind](view.format),
      label: several(view.kind)
        ? `${title.get(view.format) ?? view.format} ${VIEW_LABEL[view.kind].toLowerCase()}`
        : VIEW_LABEL[view.kind],
      pack: pack.id,
    })),
    ...formats
      .filter((each) => pack.formats.includes(each.name))
      .map((each) => ({ to: formatPath(each.name), label: each.title, pack: pack.id, format: each.name })),
  ]
  const [first] = children
  if (first === undefined) return undefined
  return { to: first.to, label: pack.title, glyph: 'pack', pack: pack.id, children }
}

/**
 * Which rail section a path is in: a pack's drawn section when one of its
 * places holds the path — `/formats/unit/board` is the development pack's, not
 * `Formats`' — and otherwise the hand-drawn one `sectionFor` finds.
 */
export function railSectionFor(rail: readonly NavSection[], pathname: string): NavSection | undefined {
  const drawn = rail.find(
    (section) =>
      section.glyph === 'pack' && (section.children ?? []).some((child) => childIsActive(child, pathname)),
  )
  return drawn ?? sectionFor(pathname)
}

/**
 * The rail, with the packs the document does not keep left out — M20 U0
 * (D-227), and the document decides since M25 U8.
 *
 * **`NAVIGATION` above is still the whole app and this is the only filter.**
 * Everything that answers a question *about a path* — `sectionFor`, `tabsFor`,
 * `activeTab` — keeps reading the full list, deliberately: a hidden place is
 * hidden, not removed, so `#/wealth/funds/3` out of a bookmark has to land on a
 * working screen with its section and its tab strip intact. What the filter
 * changes is what you are *offered*, which is the sidebar and the palette, and
 * both of them come through here.
 *
 * A child is filtered as well as a section, because Settings is the one place
 * the two halves share: four of its five children are the pack's and `Local
 * model` is the engine's.
 *
 * **`formats` is the one part of the rail the document decides** (M20 U1): a
 * format's name is a place, so every format this document declares is a child
 * of `Formats` — the person's own first, each kept pack's under its name (M33
 * F3, D-422), and a pack that declares views takes its own into its section.
 * It arrives as an argument rather than as a read, because `nav.ts` is the navigation *as data* and a list that opened a database would
 * be a list nothing could hold still. `ui/formats/places.ts` is where it is
 * fetched, once, for both surfaces that draw a rail.
 */
export function railSections(
  showing: Readonly<Record<PackId, boolean>>,
  formats: readonly FormatPlace[] = [],
  packs: readonly PackRail[] = [],
): readonly NavSection[] {
  const shown = (pack: PackId | undefined): boolean => pack === undefined || showing[pack] === true
  // **A kept pack's section sits just before `Formats`** (M27 U7), after the
  // ledger's hand-drawn places, and its formats move into it: one format, one
  // place in the rail.
  // A pack with no views of its own — the ledger, whose places are hand-drawn
  // above — keeps its formats in `Formats`, under its name (M33 F3).
  const kept = packs.filter((pack) => shown(pack.id))
  const drawn = kept.filter((pack) => pack.views.length > 0).flatMap((pack) => packSection(pack, formats) ?? [])
  const claimed = new Set(drawn.flatMap((section) => (section.children ?? []).map((child) => child.to)))
  const unclaimed = formats.filter((each) => !claimed.has(formatPath(each.name)))
  const grouped = kept.filter((pack) => pack.views.length === 0)
  // The agenda is a place only while something is on it to be (M49 U3).
  const dated = formats.some((each) => each.dated === true)
  return NAVIGATION.filter((section) => shown(section.pack) && (section.to !== AGENDA_PATH || dated)).flatMap((section) => {
    const before = section.to === FORMATS_PATH ? drawn : []
    const declared = section.to === FORMATS_PATH ? formatChildren(unclaimed, grouped) : undefined
    const children = declared ?? section.children?.filter((child) => shown(child.pack))
    if (children === undefined) return [...before, section]
    // Spread rather than a mutation, and the key is dropped when it empties:
    // `exactOptionalPropertyTypes` is on, and a section whose `children` is an
    // empty array draws an expander with nothing under it.
    const { children: _dropped, ...rest } = section
    return [...before, children.length === 0 ? rest : { ...rest, children }]
  })
}

/**
 * Which section a path is in, by longest matching prefix.
 *
 * The sidebar expands a section when you are inside it rather than when you
 * click it, so this has to answer for a path nobody navigated to from the
 * sidebar at all — a drill-through, a stale bookmark, `#/wealth/funds/3`.
 *
 * Home's tabs are the exception the root always is: `/year` and `/trends` are
 * not under `/` as a *prefix* — everything is — so they are matched by name.
 */
export function sectionFor(pathname: string): NavSection | undefined {
  let best: NavSection | undefined
  for (const section of NAVIGATION) {
    if (section.to === '/') {
      if (pathname === '/' || ownsByTab(section, pathname)) best = section
      continue
    }
    if (pathname === section.to || pathname.startsWith(`${section.to}/`)) {
      if (best === undefined || section.to.length > best.to.length) best = section
    }
  }
  return best
}

function ownsByTab(section: NavSection, pathname: string): boolean {
  return (section.tabs ?? []).some(
    (tab) => (tab.to !== '/' && startsAt(pathname, tab.to)) || alsoHits(tab, pathname),
  )
}

function alsoHits(tab: NavTab, pathname: string): boolean {
  return (tab.also ?? []).some((path) => startsAt(pathname, path))
}

function tabHits(tab: NavTab, pathname: string): boolean {
  return (tab.to === '/' ? pathname === '/' : startsAt(pathname, tab.to)) || alsoHits(tab, pathname)
}

/** `/wealth/funds/3` is inside `/wealth/funds`; `/wealth/fundsy` is not. */
function startsAt(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * The tab strip a path belongs to, or nothing.
 *
 * One list, drawn in three places — the strip, the sidebar's active child, and
 * the palette — because a second copy of it is how the sub-navs drifted before
 * D-130 collected them.
 */
export function tabsFor(pathname: string): readonly NavTab[] | undefined {
  for (const section of NAVIGATION) {
    if (matchesTabs(section.tabs, pathname)) return section.tabs
    for (const child of section.children ?? []) {
      if (matchesTabs(child.tabs, pathname)) return child.tabs
    }
  }
  return undefined
}

/**
 * True when a strip is a section's own views rather than a child's (M28 U4).
 * The rail lists those under the section, so the strip is drawn only while the
 * rail is collapsed to its glyphs and cannot.
 */
export function isSectionTabs(tabs: readonly NavTab[]): boolean {
  return NAVIGATION.some((section) => section.tabs === tabs)
}

function matchesTabs(tabs: readonly NavTab[] | undefined, pathname: string): boolean {
  if (tabs === undefined) return false
  return tabs.some((tab) => tabHits(tab, pathname))
}

/** Which tab of a strip a path is on — the deepest match, so a detail counts. */
export function activeTab(
  tabs: readonly NavTab[],
  pathname: string,
): NavTab | undefined {
  let best: NavTab | undefined
  for (const tab of tabs) {
    if (tabHits(tab, pathname) && (best === undefined || tab.to.length > best.to.length)) best = tab
  }
  return best
}

/** True while `pathname` is the child's own page or any tab of it. */
export function childIsActive(child: NavChild, pathname: string): boolean {
  if (child.end === true) {
    return pathname === child.to || (child.also ?? []).some((path) => startsAt(pathname, path))
  }
  if (startsAt(pathname, child.to)) return true
  if ((child.also ?? []).some((path) => startsAt(pathname, path))) return true
  return (child.tabs ?? []).some((tab) => startsAt(pathname, tab.to))
}

/**
 * Whose place a path is — a pack's, or the engine's when `undefined` (M25 U2).
 *
 * A section's own pack, unless a child of it says otherwise: `#/settings` is
 * the engine's and `#/settings/accounts` under it is the ledger's. What the
 * guard in front of the ledger's screens asks before it lets one read a
 * document that keeps no ledger.
 */
export function packOf(pathname: string): PackId | undefined {
  const section = sectionFor(pathname)
  if (section === undefined) return undefined
  const child = (section.children ?? []).find((each) => startsAt(pathname, each.to))
  return child?.pack ?? section.pack
}
