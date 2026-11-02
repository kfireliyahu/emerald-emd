import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'

import { recentFolders, type RecentDocument, type ShellCommand } from './bridge.ts'
import { buildMenuTemplate, menuText, NOTHING_OPEN, type MenuState } from './menu.ts'

/**
 * The menu as data (D-128). Worth testing for two reasons that have nothing to
 * do with layout: every item is a second route into the document store, and one
 * item — Reload — would discard an unsaved document with no warning if it were
 * ever allowed back in.
 */

const RECENTS: RecentDocument[] = [
  { path: '/home/k/2026.emd', name: '2026.emd', openedAt: 2 },
  { path: '/home/k/old/2025.emd', name: '2025.emd', openedAt: 1 },
]

const OPEN: MenuState = { document: true, guide: true }

function collect(recents: readonly RecentDocument[] = RECENTS, platform = 'win32', state: MenuState = OPEN) {
  const sent: ShellCommand[] = []
  /** Every Help action, in the order they were clicked. */
  const shell: string[] = []
  let cleared = 0
  const template = buildMenuTemplate(platform, recents, {
    send: (command) => sent.push(command),
    clearRecents: () => {
      cleared += 1
    },
    showAbout: () => shell.push('about'),
    openText: (text) => shell.push(`text:${text}`),
    openSource: () => shell.push('source'),
    checkForUpdates: () => shell.push('updates'),
  }, state)
  return { template, sent, shell, cleared: () => cleared }
}

function click(entry: MenuItemConstructorOptions | undefined): void {
  entry?.click?.(undefined as never, undefined as never, undefined as never)
}

function menu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const found = template.find((item) => item.label?.replace('&', '') === label)
  if (found === undefined || !Array.isArray(found.submenu)) throw new Error(`no ${label} menu`)
  return found.submenu
}

function item(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const found = items.find((entry) => entry.label === label)
  if (found === undefined) throw new Error(`no ${label} item`)
  return found
}

describe('the application menu', () => {
  it('reaches the document actions the header already has', () => {
    const { template, sent } = collect()
    const file = menu(template, 'File')

    for (const label of ['New', 'Open…', 'Save', 'Save as…', 'Earlier copies of this document…']) {
      item(file, label).click?.(
        undefined as never,
        undefined as never,
        undefined as never,
      )
    }

    expect(sent.map((command) => command.kind)).toEqual(['new', 'open', 'save', 'save-as', 'earlier-copies'])
  })

  it('binds the accelerators a document app is expected to have', () => {
    const file = menu(collect().template, 'File')
    expect(item(file, 'Save').accelerator).toBe('CmdOrCtrl+S')
    expect(item(file, 'Open…').accelerator).toBe('CmdOrCtrl+O')
    expect(item(file, 'New').accelerator).toBe('CmdOrCtrl+N')
    expect(item(file, 'Save as…').accelerator).toBe('CmdOrCtrl+Shift+S')
  })

  it('opens a recent document by path, with its folder in the label (M54 F7)', () => {
    const { template, sent } = collect()
    const recent = menu(template, 'File').find((entry) => entry.label === 'Open recent')
    if (recent === undefined || !Array.isArray(recent.submenu)) throw new Error('no Open recent')

    expect(recent.enabled).toBe(true)
    // A Windows menu shows no tooltip, so the folder is in the label itself.
    expect(recent.submenu[0]?.label).toBe('2026.emd — …/k')
    expect(recent.submenu[0]?.toolTip).toBeUndefined()
    recent.submenu[0]?.click?.(undefined as never, undefined as never, undefined as never)

    expect(sent).toEqual([{ kind: 'open-path', path: '/home/k/2026.emd' }])
  })

  it('tells two documents of one name apart by the end of their folders (M54 F7)', () => {
    const twins: RecentDocument[] = [
      { path: 'C:\\Users\\k\\2025\\finances.emd', name: 'finances.emd', openedAt: 2 },
      { path: 'D:\\backup\\2025\\finances.emd', name: 'finances.emd', openedAt: 1 },
      { path: 'C:\\Users\\k\\notes.emd', name: 'notes.emd', openedAt: 0 },
    ]
    expect(recentFolders(twins)).toEqual(['…\\k\\2025', '…\\backup\\2025', '…\\k'])
    // A folder shown whole carries no ellipsis.
    expect(recentFolders([{ path: '/a.emd', name: 'a.emd' }, { path: '/x/a.emd', name: 'a.emd' }])).toEqual(['/', '/x'])
  })

  it("doubles an ampersand, which Windows would read as the item's mnemonic (M54 F7)", () => {
    expect(menuText('A & B.emd — …/k')).toBe('A && B.emd — …/k')
    const recent = menu(collect([{ path: '/k/A & B.emd', name: 'A & B.emd', openedAt: 1 }]).template, 'File').find(
      (entry) => entry.label === 'Open recent',
    )
    if (recent === undefined || !Array.isArray(recent.submenu)) throw new Error('no Open recent')
    expect(recent.submenu[0]?.label).toBe('A && B.emd — /k')
  })

  it('offers Open recent greyed out rather than not at all on a first run', () => {
    const recent = menu(collect([]).template, 'File').find((entry) => entry.label === 'Open recent')
    expect(recent?.enabled).toBe(false)
  })

  it('greys out what has nothing to act on (M54 F7)', () => {
    const none = collect(RECENTS, 'win32', NOTHING_OPEN).template
    const file = menu(none, 'File')
    for (const label of ['Save', 'Save as…', 'Earlier copies of this document…']) {
      expect(item(file, label).enabled).toBe(false)
    }
    for (const label of ['New', 'Open…']) expect(item(file, label).enabled).not.toBe(false)
    expect(item(menu(none, 'Help'), 'Guide me').enabled).toBe(false)

    // A document that keeps no ledger: everything in File, but no guide.
    const noLedger = collect(RECENTS, 'win32', { document: true, guide: false }).template
    expect(item(menu(noLedger, 'File'), 'Save').enabled).toBe(true)
    expect(item(menu(noLedger, 'Help'), 'Guide me').enabled).toBe(false)
  })

  it('names every item in sentence case, the roles included (M54 F7, D-531)', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const labels: string[] = []
      const walk = (items: readonly MenuItemConstructorOptions[]): void => {
        for (const entry of items) {
          if (entry.type === 'separator' || entry.role === 'appMenu' || entry.role === 'windowMenu') continue
          if (Array.isArray(entry.submenu)) walk(entry.submenu)
          else labels.push(entry.label ?? `(no label: ${String(entry.role)})`)
        }
      }
      walk(collect([], platform).template)
      // After the first word, no word starts upper case but a name: Emerald, and the File menu's own.
      const titled = labels.filter((label) =>
        label
          .split(' ')
          .slice(1)
          .some((word) => /^[A-Z]/.test(word) && word !== 'Emerald'),
      )
      expect(titled, platform).toEqual([])
      expect(labels.filter((label) => label.startsWith('(no label')), platform).toEqual([])
    }
  })

  it('has no Reload, because a reload throws away an unsaved document', () => {
    const view = menu(collect().template, 'View')
    const roles = view.map((entry) => entry.role)
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forceReload')
    expect(roles).toContain('toggleDevTools')
  })

  it('has a Help that holds Guide me and what a downloader is owed (D-330, D-452)', () => {
    const { template, sent, shell } = collect()
    const help = menu(template, 'Help')
    expect(help.filter((entry) => entry.type !== 'separator').map((entry) => entry.label)).toEqual([
      'Guide me',
      'License',
      'Third-party notices',
      'Source code',
      'Check for updates now',
      'About Emerald',
    ])
    for (const entry of help) click(entry)
    expect(sent).toEqual([{ kind: 'guide' }])
    expect(shell).toEqual(['text:license', 'text:notices', 'source', 'updates', 'about'])
  })

  it('names no address in the menu: Source code asks main for the one it has (D-124, D-452)', () => {
    const help = menu(collect().template, 'Help')
    const text = JSON.stringify(help)
    expect(text).not.toMatch(/https?:/)
    expect(help.some((entry) => entry.role === 'help')).toBe(false)
  })

  it('leaves macOS its About in the app menu, not a second one in Help', () => {
    const help = menu(collect(RECENTS, 'darwin').template, 'Help')
    expect(help.map((entry) => entry.label)).not.toContain('About Emerald')
    expect(help.map((entry) => entry.label)).toContain('Source code')
  })

  it('checks for updates from Help on every platform, with no setting in the way (M42 U8)', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const { template, shell } = collect(RECENTS, platform)
      click(item(menu(template, 'Help'), 'Check for updates now'))
      expect(shell).toEqual(['updates'])
    }
  })

  it('keeps copy and paste, which every text field needs', () => {
    const edit = menu(collect().template, 'Edit')
    expect(edit.map((entry) => entry.role)).toEqual(
      expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']),
    )
  })

  it('gives macOS its application and window menus, and nothing else does', () => {
    const mac = collect(RECENTS, 'darwin').template
    expect(mac.map((entry) => entry.role)).toEqual(
      expect.arrayContaining(['appMenu', 'windowMenu']),
    )
    expect(collect().template.map((entry) => entry.role)).not.toContain('appMenu')
  })

  /**
   * The sidebar's key is bound in the page, because the browser build has no
   * menu to bind it. The menu shows the same key and must not *register* it:
   * two handlers on one toggle is a sidebar that never moves (D-130).
   */
  it('shows the sidebar accelerator without registering it', () => {
    const { template, sent } = collect()
    const toggle = item(menu(template, 'View'), 'Toggle the sidebar')
    expect(toggle.accelerator).toBe('CmdOrCtrl+B')
    expect(toggle.registerAccelerator).toBe(false)

    toggle.click?.(
      undefined as never,
      undefined as never,
      undefined as never,
    )
    expect(sent).toEqual([{ kind: 'toggle-sidebar' }])
  })
})
