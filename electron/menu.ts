/**
 * The application menu — a template, built as data so it can be tested.
 *
 * D-126 removed the menu on Windows and Linux because the default one is a
 * File/Edit/View/Help bar this app had no use for and whose Help entry opens a
 * website. **That reasoning was about the default menu, not about having one**
 * (D-128): now there is a document to open, a recents list to reach and
 * accelerators to declare, and those want a real File menu. It is hidden
 * behind Alt on Windows and Linux (`autoHideMenuBar`), and on macOS it is in
 * the system bar where it costs nothing.
 *
 * Two things this menu deliberately does not have:
 *
 * - **Reload.** The stock View role carries Reload and Force Reload, and in a
 *   document-based app a reload discards whatever is unsaved with no warning
 *   and no undo. DevTools stays, on the key D-126 already wired.
 * - **A website.** There is none to point at, and there is not going to be one
 *   (D-124). **Help holds Guide me** (M28 U9, D-330): the walk through the real
 *   screens, picked up where it stopped — the in-app help this menu was missing.
 *
 * **What Help gained is what a downloader is owed** (M43 U7, D-452): the license
 * and the third-party notices, each opened in a window of its own from the
 * app's own files, and the About. One item leaves the app — *Source Code*, which
 * hands the repository's address, and only that one, to the system browser. It
 * is the source the AGPL promises, and a person asked for it by clicking.
 *
 * **Nothing here is reachable only behind Alt** (M46 U1, D-458): every item is
 * also a command in the palette, which has a button on every screen, and
 * `src/ui/menuParity.test.ts` fails when an item is added without one — or
 * without a reason written there why it needs none.
 */

import type { MenuItemConstructorOptions } from 'electron'

import type { BundledText } from './about.ts'
import type { RecentDocument, ShellCommand } from './bridge.ts'

interface MenuActions {
  send(command: ShellCommand): void
  clearRecents(): void
  /** Help › About: the page's own since M45 F3 (D-457), which `main.ts` fills from `about.ts`. */
  showAbout(): void
  /** The license or the notices, from `dist/`, in a window of their own. */
  openText(text: BundledText): void
  /** The repository, in the system browser. Takes no address: there is only one. */
  openSource(): void
}

export function buildMenuTemplate(
  platform: string,
  recents: readonly RecentDocument[],
  actions: MenuActions,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin'

  const openRecent: MenuItemConstructorOptions = {
    label: 'Open Recent',
    // Disabled rather than hidden: an empty submenu that vanishes makes the
    // menu jump, and a greyed entry says "this exists, you have not used it".
    enabled: recents.length > 0,
    submenu:
      recents.length === 0
        ? [{ label: 'Nothing yet', enabled: false }]
        : [
            ...recents.map(
              (entry): MenuItemConstructorOptions => ({
                label: entry.name,
                // The full path, because two years of `finances.emd` in
                // different folders is the normal case, not the odd one.
                toolTip: entry.path,
                click: () => actions.send({ kind: 'open-path', path: entry.path }),
              }),
            ),
            { type: 'separator' },
            { label: 'Clear Menu', click: () => actions.clearRecents() },
          ],
  }

  const file: MenuItemConstructorOptions = {
    label: '&File',
    submenu: [
      { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => actions.send({ kind: 'new' }) },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => actions.send({ kind: 'open' }) },
      openRecent,
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => actions.send({ kind: 'save' }) },
      {
        label: 'Save a Copy…',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => actions.send({ kind: 'save-as' }),
      },
      // M45 U4 (D-455): the copies taken before a write, in Emerald's own
      // folder, listed with Restore — what makes a copy there one a person finds.
      {
        label: 'Earlier copies of this document…',
        click: () => actions.send({ kind: 'earlier-copies' }),
      },
      { type: 'separator' },
      // On macOS quitting lives in the app menu, and Close is the window verb.
      // Either way it goes through the window's `close`, which is where the
      // unsaved-work question is asked (D-128).
      mac ? { role: 'close' } : { role: 'quit' },
    ],
  }

  // Copy and paste have to work in every text field, and on macOS the roles
  // are also what bind Cmd+C and Cmd+V at all.
  const edit: MenuItemConstructorOptions = {
    label: '&Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  }

  const view: MenuItemConstructorOptions = {
    label: '&View',
    submenu: [
      {
        label: 'Command Palette…',
        accelerator: 'CmdOrCtrl+K',
        // Shown, not registered — see Toggle Sidebar below.
        registerAccelerator: false,
        click: () => actions.send({ kind: 'command-palette' }),
      },
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        // **Shown, not registered.** The page already binds this key — it has
        // to, because the browser build has no menu — and an accelerator
        // registered here as well would toggle the sidebar twice and leave it
        // exactly where it started. `registerAccelerator: false` keeps the hint
        // in the menu and the handler in one place (D-130).
        registerAccelerator: false,
        click: () => actions.send({ kind: 'toggle-sidebar' }),
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools' },
    ],
  }

  const help: MenuItemConstructorOptions = {
    label: '&Help',
    // `role: 'help'` is what puts the search field in macOS's Help menu.
    role: 'help',
    submenu: [
      { label: 'Guide me', click: () => actions.send({ kind: 'guide' }) },
      { type: 'separator' },
      { label: 'License', click: () => actions.openText('license') },
      { label: 'Third-Party Notices', click: () => actions.openText('notices') },
      { label: 'Source Code', toolTip: 'Opens in your browser', click: () => actions.openSource() },
      // On macOS the About is the app menu's first item, as every Mac app has it.
      ...(mac
        ? []
        : ([
            { type: 'separator' },
            { label: 'About Emerald', click: () => actions.showAbout() },
          ] as MenuItemConstructorOptions[])),
    ],
  }

  return [
    ...(mac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    file,
    edit,
    view,
    ...(mac ? [{ role: 'windowMenu' } as MenuItemConstructorOptions] : []),
    help,
  ]
}
