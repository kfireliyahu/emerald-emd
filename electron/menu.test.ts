import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'

import type { RecentDocument, ShellCommand } from './bridge.ts'
import { buildMenuTemplate } from './menu.ts'

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

function collect(recents: readonly RecentDocument[] = RECENTS, platform = 'win32') {
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
  })
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

    for (const label of ['New', 'Open…', 'Save', 'Save a Copy…', 'Earlier copies of this document…']) {
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
    expect(item(file, 'Save a Copy…').accelerator).toBe('CmdOrCtrl+Shift+S')
  })

  it('opens a recent document by path, and shows the folder in the tooltip', () => {
    const { template, sent } = collect()
    const recent = menu(template, 'File').find((entry) => entry.label === 'Open Recent')
    if (recent === undefined || !Array.isArray(recent.submenu)) throw new Error('no Open Recent')

    expect(recent.enabled).toBe(true)
    expect(recent.submenu[0]?.toolTip).toBe('/home/k/2026.emd')
    recent.submenu[0]?.click?.(undefined as never, undefined as never, undefined as never)

    expect(sent).toEqual([{ kind: 'open-path', path: '/home/k/2026.emd' }])
  })

  it('offers Open Recent greyed out rather than not at all on a first run', () => {
    const recent = menu(collect([]).template, 'File').find((entry) => entry.label === 'Open Recent')
    expect(recent?.enabled).toBe(false)
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
      'Third-Party Notices',
      'Source Code',
      'About Emerald',
    ])
    for (const entry of help) click(entry)
    expect(sent).toEqual([{ kind: 'guide' }])
    expect(shell).toEqual(['text:license', 'text:notices', 'source', 'about'])
  })

  it('names no address in the menu: Source Code asks main for the one it has (D-124, D-452)', () => {
    const help = menu(collect().template, 'Help')
    const text = JSON.stringify(help)
    expect(text).not.toMatch(/https?:/)
    expect(help.some((entry) => entry.role === 'help')).toBe(false)
  })

  it('leaves macOS its About in the app menu, not a second one in Help', () => {
    const help = menu(collect(RECENTS, 'darwin').template, 'Help')
    expect(help.map((entry) => entry.label)).not.toContain('About Emerald')
    expect(help.map((entry) => entry.label)).toContain('Source Code')
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
    const toggle = item(menu(template, 'View'), 'Toggle Sidebar')
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
