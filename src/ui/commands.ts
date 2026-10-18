import { shellApp, shellBridge, shellDocuments } from '@/data/storage/desktop.ts'
import { canShowAbout, openAbout } from '@/ui/About.tsx'
import { canListEarlierCopies, openEarlierCopies } from '@/ui/EarlierCopies.tsx'
import { useDocumentStore } from '@/state/documentStore.ts'
import { createStore } from '@/state/store.ts'
import { isDemo } from '@/ui/edition.ts'
import { formatPlacesOf } from '@/ui/formats/places.ts'
import { openGuide } from '@/ui/guide/guideState.ts'
import { railSections } from '@/ui/nav.ts'
import { openDocumentKeptPacks, packRails, showingOf } from '@/ui/packs.ts'
import { toggleSidebar } from '@/ui/useSidebar.ts'

/**
 * Everything you can do, as a list (D-130).
 *
 * `useShellCommands.ts` was already half of this: the File menu sends a
 * `ShellCommand` and the renderer turns it into a call on the document store,
 * because the menu is a *second way to reach* an action rather than a second
 * implementation of it. The palette is the other half, and it holds the same
 * line — nothing here does any work of its own, it names work that already
 * exists somewhere with a button on it.
 *
 * Two kinds, and the split is the point of a palette rather than a jump list:
 *
 * - **Places**, straight out of `nav.ts` — sections, their children, and the
 *   *tabs* of a child, which the sidebar never shows at all (D-157). The
 *   sidebar shows a section's children only while you are in it; the palette
 *   shows all of them always, which is what you want when you know the name of
 *   the screen and not where it lives. The four Wealth screens that became tabs
 *   are reached here by their own names, which is the whole reason a tab may
 *   leave the rail.
 * - **Operations** — save, open, import, categorize, the recent documents.
 *   These have never had one list. Save is a header button and a menu item and
 *   `Ctrl+S`; categorize is reachable from a count on two screens and nowhere
 *   else. A person who knows what they want should not have to know which
 *   screen keeps it.
 *
 * **An unavailable command is absent, not greyed.** A palette is a search box:
 * a disabled row you cannot act on is a result that wasted the keystroke.
 *
 * **A pack the open document does not keep has its places and operations
 * absent too** (M20 U0, D-227; M25 U8), for the same reason and off the same
 * filter the sidebar uses. A palette that
 * still offered *Import a statement…* while the rail had no finance in it would
 * be the second list this file exists to prevent.
 */

/**
 * Whether the palette is showing.
 *
 * Outside React for the reason the sidebar's collapse is (D-130): two things
 * open it — `Ctrl/Cmd+K` on the window, and the shell's View menu arriving as a
 * `ShellCommand` — and neither of them is in the component's tree.
 */
const paletteOpen = createStore(false)

export function setCommandPaletteOpen(next: boolean): void {
  paletteOpen.set(next)
}

export function openCommandPalette(): void {
  setCommandPaletteOpen(true)
}

export function useCommandPaletteOpen(): boolean {
  return paletteOpen.use()
}

export type CommandGroup = 'Go to' | 'Do' | 'Document' | 'Help' | 'Recent'

export interface Command {
  readonly id: string
  readonly label: string
  readonly group: CommandGroup
  /** Extra words that should find this row — never shown. */
  readonly keywords?: string
  /** Shown right-aligned: the key that does this without the palette. */
  readonly hint?: string
  /** Shown under the label when the label alone is ambiguous — a path, mostly. */
  readonly detail?: string
  run(): void
}

export interface CommandContext {
  /** Navigate. The palette does not import the router; its host passes this in. */
  readonly go: (to: string) => void
  /** Open the file picker that starts an import. */
  readonly importStatement: () => void
  /** The documents opened before, already loaded — the palette cannot await. */
  readonly recents: readonly { readonly path: string; readonly name: string }[]
}

export function buildCommands(context: CommandContext): readonly Command[] {
  const store = useDocumentStore.getState()
  const hasDocument = store.db !== undefined
  const kept = openDocumentKeptPacks()
  const commands: Command[] = []

  if (hasDocument) {
    const seen = new Set<string>()
    const place = (to: string, label: string, keywords?: string): void => {
      // A tab's first entry is its owner's own path, so `Wealth · Savings &
      // debts` and `Wealth · Savings & debts · Savings` are one row, not two.
      if (seen.has(to)) return
      seen.add(to)
      commands.push({
        id: `go:${to}`,
        label,
        group: 'Go to',
        ...(keywords === undefined ? {} : { keywords }),
        run: () => context.go(to),
      })
    }

    // The declared formats are places too (M20 U1), and the palette is where
    // you reach one by name rather than by finding it in the rail.
    for (const section of railSections(showingOf(kept), formatPlacesOf(store.db), packRails(kept))) {
      place(section.to, section.label)
      for (const tab of section.tabs ?? []) place(tab.to, `${section.label} · ${tab.label}`, tab.label)
      for (const child of section.children ?? []) {
        // Qualified, because "Savings" and "Funds" mean less on their own
        // than they do under Wealth — and a palette is read out of context
        // by definition.
        place(child.to, `${section.label} · ${child.label}`, child.label)
        for (const tab of child.tabs ?? []) {
          place(tab.to, `${section.label} · ${tab.label}`, tab.label)
        }
      }
    }

    // The two the ledger owns. Neither is a *place*, so neither came off the
    // rail above, and both would be dead ends without a ledger: the
    // categorize queue is a ledger screen, and the import lands in the ledger's
    // mapper. The engine reads a document onto a format it declares, from that
    // format's own screen (D-226).
    if (kept.has('ledger')) {
      commands.push(
        {
          id: 'do:categorize',
          label: 'Categorize transactions',
          group: 'Do',
          keywords: 'uncategorized file rows',
          run: () => context.go('/transactions/merchants'),
        },
        {
          id: 'do:import',
          label: 'Import a statement…',
          group: 'Do',
          keywords: 'card bank xlsx csv upload open file',
          run: context.importStatement,
        },
      )
    }
  }

  commands.push({
    id: 'do:sidebar',
    label: 'Toggle the sidebar',
    group: 'Do',
    hint: 'Ctrl+B',
    keywords: 'collapse expand nav',
    run: toggleSidebar,
  })

  // **The demo has no Document group and no recents** (M33 U1, D-413): a
  // visitor has no file to make, open or save.
  if (isDemo()) return [...commands, ...helpCommands(kept.has('ledger') && hasDocument)]

  commands.push(
    { id: 'doc:new', label: 'New document', group: 'Document', hint: 'Ctrl+N', run: () => void useDocumentStore.getState().requestNew() },
    { id: 'doc:open', label: 'Open document…', group: 'Document', hint: 'Ctrl+O', run: () => void useDocumentStore.getState().requestOpenFile() },
  )

  if (hasDocument) {
    commands.push(
      {
        id: 'doc:save',
        label: 'Save',
        group: 'Document',
        hint: 'Ctrl+S',
        run: () => void useDocumentStore.getState().save(),
      },
      {
        id: 'doc:save-as',
        label: 'Save a copy…',
        group: 'Document',
        hint: 'Ctrl+Shift+S',
        run: () => void useDocumentStore.getState().saveCopyAs(),
      },
      // M34 U6 (D-399): `keep_copy`'s half on a screen — a named copy among the
      // document's earlier copies (D-470), or held in a browser page until downloaded.
      {
        id: 'doc:keep-copy',
        label: 'Back up now',
        group: 'Document',
        keywords: 'backup snapshot before undo named copy',
        detail:
          store.adapter.backup !== undefined
            ? 'Among its earlier copies, named for now. The last three are kept.'
            : 'Held in this page until you download it.',
        run: () => void useDocumentStore.getState().keepCopy('now'),
      },
      // M45 U4 (D-455): the shell's File › Earlier copies of this document —
      // the copies taken before an assistant's write, in Emerald's own folder.
      // Not in a browser, which has no such folder.
      ...(canListEarlierCopies()
        ? [
            {
              id: 'doc:earlier-copies',
              label: 'Earlier copies of this document…',
              group: 'Document' as const,
              keywords: 'backup restore undo previous version bak',
              detail: 'The copies taken before a write, and the named ones. Restore puts one back.',
              run: openEarlierCopies,
            },
          ]
        : []),
      // **The per-file choice, and the only place in the app that makes it**
      // (D-246). A command rather than a setting, because it is not a
      // preference: it changes what the file *is*, once, and every save
      // afterwards keeps it. The label says which way it is going, so there is
      // nothing to read a checkbox's state out of.
      store.encoding === 'text'
        ? {
            id: 'doc:as-sqlite',
            label: 'Save this document as SQLite bytes',
            group: 'Document',
            keywords: 'binary format encoding convert database',
            detail: 'Smaller and faster for a large document. Git cannot diff it.',
            run: () => void useDocumentStore.getState().convertTo('sqlite'),
          }
        : {
            id: 'doc:as-text',
            label: 'Save this document as text',
            group: 'Document',
            keywords: 'markdown format encoding convert readable git diff',
            detail: 'Readable and diffable. Declared formats only — not a ledger.',
            run: () => void useDocumentStore.getState().convertTo('text'),
          },
    )
  }

  commands.push(...helpCommands(kept.has('ledger') && hasDocument))

  for (const entry of context.recents) {
    commands.push({
      id: `recent:${entry.path}`,
      label: entry.name,
      group: 'Recent',
      detail: entry.path,
      // `requestOpen` rather than `openDocumentAt`: unsaved work is never
      // thrown away by a document arriving, it becomes the notice at the top
      // of the region instead.
      run: () => void useDocumentStore.getState().requestOpen(entry.path),
    })
  }

  // File › Open Recent › Clear Menu (M46 U1), beside what it clears.
  const clearRecents = shellDocuments()?.clearRecents
  if (context.recents.length > 0 && clearRecents !== undefined) {
    commands.push({
      id: 'recent:clear',
      label: 'Clear recent documents',
      group: 'Recent',
      keywords: 'forget list history',
      run: () => void clearRecents(),
    })
  }

  return commands
}

/**
 * **Help, the menu's and the palette's** (M46 U1, D-458). The shell's Help menu
 * hides behind Alt with the rest of the menu bar, and a person who did not know
 * that could not find About at all; every item in it is here too, under the
 * same heading, so the palette's button reaches what the menu holds. The menu
 * test (`menuParity.test.ts`) fails when the menu gains an item this list —
 * or the Document group — has no row for.
 *
 * Unavailable is still absent: Guide me only where a ledger is kept (the guide
 * walks its screens), and the rest only in a shell that can open them.
 */
function helpCommands(guide: boolean): Command[] {
  const help: Command[] = []
  // Help › Guide me, for the build with no menu bar (M28 U9, D-330).
  if (guide) {
    help.push({
      id: 'help:guide',
      label: 'Guide me',
      group: 'Help',
      keywords: 'help getting started tour walk onboarding',
      run: () => openGuide(),
    })
  }
  // Help › About: the page's own (M45 F3, D-457), with the folder of earlier copies.
  if (canShowAbout()) {
    help.push({
      id: 'help:about',
      label: 'About Emerald',
      group: 'Help',
      keywords: 'help version license earlier copies backups folder size',
      run: openAbout,
    })
  }
  const app = shellApp()
  const openText = app?.openText
  if (openText !== undefined) {
    help.push(
      {
        id: 'help:license',
        label: 'License',
        group: 'Help',
        keywords: 'help agpl gnu terms licence',
        run: () => void openText('license'),
      },
      {
        id: 'help:notices',
        label: 'Third-party notices',
        group: 'Help',
        keywords: 'help licenses credits open source',
        run: () => void openText('notices'),
      },
    )
  }
  const openSource = app?.openSource
  if (openSource !== undefined) {
    help.push({
      id: 'help:source',
      label: 'Source code',
      group: 'Help',
      keywords: 'help repository github agpl',
      detail: 'Opens in your browser',
      run: () => void openSource(),
    })
  }
  return help
}

/**
 * The palette's own key, as this machine writes it: `⌘K` on a Mac, `Ctrl+K`
 * everywhere else (M46 U1). The shell knows its platform; a browser tab is
 * asked through `navigator`, and a tab that will not say is not a Mac.
 */
export function commandPaletteKey(): string {
  const platform =
    shellBridge()?.platform ?? (typeof navigator === 'undefined' ? '' : navigator.platform)
  return /^(darwin|mac)/i.test(platform) ? '⌘K' : 'Ctrl+K'
}

/** The recents list, or nothing outside the shell. Awaited before the palette opens. */
export async function loadRecents(): Promise<readonly { path: string; name: string }[]> {
  try {
    return (await shellDocuments()?.recents()) ?? []
  } catch {
    // A recents file that cannot be read is not a reason to have no palette.
    return []
  }
}

/**
 * Filter and rank, on a subsequence match rather than a substring one — "wsav"
 * should find "Wealth · Savings", which is the whole reason to type into a
 * palette instead of reading a menu.
 *
 * Ranked by where the match starts and how tightly it lands, so an exact
 * prefix beats a scattered hit. Stable within a score, so a tie leaves the
 * declared order — places before operations before recents — alone.
 */
export function filterCommands(
  commands: readonly Command[],
  query: string,
  /**
   * Only the matches that cross at most one gap (M37 U2c, the mockup's
   * `s < 200`): when the palette has entries to show under the commands, a
   * command found by walking the whole of its label is noise above them.
   */
  tight = false,
): readonly Command[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return commands

  const scored: { command: Command; score: number; at: number }[] = []
  for (const [at, command] of commands.entries()) {
    const haystack = `${command.label} ${command.keywords ?? ''}`.toLowerCase()
    const score = subsequenceScore(haystack, needle)
    if (score !== undefined && (!tight || score < TIGHT)) scored.push({ command, score, at })
  }

  scored.sort((a, b) => (a.score === b.score ? a.at - b.at : a.score - b.score))
  return scored.map((entry) => entry.command)
}

/** A score under this crossed at most one gap. */
const TIGHT = 200

/**
 * Lower is better: a gap crossed costs far more than a late start.
 *
 * The weighting is the whole of the ranking and it was wrong the first way
 * round. With the start index leading, "trend" put **Toggle the sidebar** above
 * **Insights · Trends** — t-r-e-n-d is in "toggle the sidebar" if you are
 * willing to walk the whole string, and it starts at character zero. What a
 * person means by typing "trend" is a word, so contiguity is the signal and the
 * start index is only the tie-break.
 */
function subsequenceScore(haystack: string, needle: string): number | undefined {
  let index = 0
  let first: number | undefined
  let gaps = 0
  let previous = -1

  for (const character of needle) {
    const found = haystack.indexOf(character, index)
    if (found === -1) return undefined
    if (first === undefined) first = found
    if (previous !== -1 && found !== previous + 1) gaps += 1
    previous = found
    index = found + 1
  }

  return gaps * 100 + (first ?? 0)
}
