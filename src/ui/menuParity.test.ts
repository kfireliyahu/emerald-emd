import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { buildMenuTemplate } from '../../electron/menu.ts'

/**
 * **Nothing is reachable only behind Alt** (M46 U1, D-458).
 *
 * The shell's menu bar hides until Alt is pressed (`autoHideMenuBar`), and
 * Help › About could not be found because of it. The palette has a button
 * on every screen now, so every item in the menu is a palette command too —
 * the way `parity.test.ts` holds a tool to its screen. A menu item added with
 * no palette row, and no reason written here why it needs none, fails this.
 *
 * The palette is built as the shell builds it, with everything it can offer:
 * a document open from a file, a ledger kept, a shell new enough for Help's
 * openers and for clearing the recents.
 */

const platform = vi.hoisted(() => ({ name: 'win32' }))

vi.mock('@/data/storage/desktop.ts', () => ({
  shellBridge: () => ({ platform: platform.name }),
  shellApp: () => ({ openText: () => Promise.resolve(), openSource: () => Promise.resolve() }),
  shellUpdates: () => ({ checkNow: () => Promise.resolve() }),
  shellDocuments: () => ({ clearRecents: () => Promise.resolve() }),
}))
vi.mock('@/state/documentStore.ts', () => ({
  useDocumentStore: { getState: () => ({ db: {}, adapter: {}, encoding: 'text' }) },
}))
vi.mock('@/ui/packs.ts', () => ({
  openDocumentKeptPacks: () => new Set(['ledger']),
  packRails: () => [],
  showingOf: () => undefined,
}))
vi.mock('@/ui/nav.ts', () => ({ railSections: () => [] }))
vi.mock('@/ui/formats/places.ts', () => ({ formatPlacesOf: () => [] }))
vi.mock('@/ui/About.tsx', () => ({ canShowAbout: () => true, openAbout: () => undefined }))
vi.mock('@/ui/EarlierCopies.tsx', () => ({
  canListEarlierCopies: () => true,
  openEarlierCopies: () => undefined,
}))

const { buildCommands, commandPaletteKey } = await import('./commands.ts')

const RECENT = { path: '/documents/kept.emd', name: 'kept.emd', openedAt: 0 }

/** A menu item, by its label, and the palette row that does the same thing. */
const IN_THE_PALETTE: Readonly<Record<string, string>> = {
  New: 'doc:new',
  'Open…': 'doc:open',
  'Save': 'doc:save',
  'Save a Copy…': 'doc:save-as',
  'Earlier copies of this document…': 'doc:earlier-copies',
  [RECENT.name]: `recent:${RECENT.path}`,
  'Clear Menu': 'recent:clear',
  'Toggle Sidebar': 'do:sidebar',
  'Guide me': 'help:guide',
  License: 'help:license',
  'Third-Party Notices': 'help:notices',
  'Source Code': 'help:source',
  'Check for Updates Now': 'help:check-updates',
  'About Emerald': 'help:about',
}

/** A menu item, by its label or its role, and why the palette has no row for it. */
const NOT_IN_THE_PALETTE: Readonly<Record<string, string>> = {
  'Command Palette…': 'it is the palette',
  'Nothing yet': 'a disabled line saying the recents are empty',
  undo: 'it acts on the focused field, which opening the palette takes focus from; Ctrl+Z works everywhere',
  redo: 'the same as undo',
  cut: 'the same as undo',
  copy: 'the same as undo',
  paste: 'the same as undo',
  selectAll: 'the same as undo',
  resetZoom: 'a key of its own (Ctrl+0), registered while the bar is hidden',
  zoomIn: 'a key of its own, registered while the bar is hidden',
  zoomOut: 'a key of its own, registered while the bar is hidden',
  togglefullscreen: 'a key of its own (F11), registered while the bar is hidden',
  toggleDevTools: "a developer's, on a key of its own",
  quit: "the window's own close button is always on screen",
  close: "the window's own close button is always on screen",
  appMenu: "macOS's own menu, in the system bar, which never hides",
  windowMenu: "macOS's own menu, in the system bar, which never hides",
}

function leaves(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => {
    if (item.type === 'separator') return []
    if (Array.isArray(item.submenu)) return leaves(item.submenu)
    return [item]
  })
}

const keyOf = (item: MenuItemConstructorOptions): string => item.label ?? item.role ?? '(unnamed)'

const noActions = {
  send: () => undefined,
  clearRecents: () => undefined,
  showAbout: () => undefined,
  openText: () => undefined,
  openSource: () => undefined,
  checkForUpdates: () => undefined,
}

describe('every item in the shell menu is a palette command', () => {
  for (const os of ['win32', 'darwin', 'linux']) {
    it(`on ${os}`, () => {
      const ids = new Set(
        buildCommands({ go: () => undefined, importStatement: () => undefined, recents: [RECENT] }).map(
          (command) => command.id,
        ),
      )
      const items = [
        ...leaves(buildMenuTemplate(os, [RECENT], noActions)),
        ...leaves(buildMenuTemplate(os, [], noActions)),
      ]
      const missing = items
        .map(keyOf)
        .filter((key) => {
          const id = IN_THE_PALETTE[key]
          if (id !== undefined) return !ids.has(id)
          return NOT_IN_THE_PALETTE[key] === undefined
        })
      expect(missing, 'menu items with no palette command and no reason written down').toEqual([])
    })
  }

  it('names no item the menu no longer has', () => {
    const keys = new Set(
      ['win32', 'darwin'].flatMap((os) =>
        [...leaves(buildMenuTemplate(os, [RECENT], noActions)), ...leaves(buildMenuTemplate(os, [], noActions))].map(keyOf),
      ),
    )
    const stale = [...Object.keys(IN_THE_PALETTE), ...Object.keys(NOT_IN_THE_PALETTE)].filter((key) => !keys.has(key))
    expect(stale).toEqual([])
  })

  it('puts Help under its own heading, as the menu does', () => {
    const help = buildCommands({ go: () => undefined, importStatement: () => undefined, recents: [] }).filter(
      (command) => command.group === 'Help',
    )
    expect(help.map((command) => command.label)).toEqual([
      'Guide me',
      'About Emerald',
      'License',
      'Third-party notices',
      'Source code',
      'Check for updates now',
    ])
  })
})

describe("the button's tooltip teaches the key", () => {
  it('says Ctrl+K off a Mac and ⌘K on one', () => {
    platform.name = 'win32'
    expect(commandPaletteKey()).toBe('Ctrl+K')
    platform.name = 'darwin'
    expect(commandPaletteKey()).toBe('⌘K')
    platform.name = 'win32'
  })
})
