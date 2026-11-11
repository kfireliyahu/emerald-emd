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
 * app's own files, and the About. One item leaves the app — *Source code*, which
 * hands the repository's address, and only that one, to the system browser. It
 * is the source the AGPL promises, and a person asked for it by clicking. **Check for updates
 * now** (M42 U8, D-502) asks GitHub for the newest version once, with the setting on or off, and
 * answers in the window's notice.
 *
 * **Nothing here is reachable only behind Alt** (M46 U1, D-458): every item is
 * also a command in the palette, which has a button on every screen, and
 * `src/ui/menuParity.test.ts` fails when an item is added without one — or
 * without a reason written there why it needs none.
 */

import type { MenuItemConstructorOptions } from 'electron'

import type { BundledText } from './about.ts'
import { recentFolders, type RecentDocument, type ShellCommand } from './bridge.ts'
import { shellWords, type ShellWords } from './language.ts'

interface MenuActions {
  send(command: ShellCommand): void
  clearRecents(): void
  /** Help › About: the page's own since M45 F3 (D-457), which `main.ts` fills from `about.ts`. */
  showAbout(): void
  /** The license or the notices, from `dist/`, in a window of their own. */
  openText(text: BundledText): void
  /** The repository, in the system browser. Takes no address: there is only one. */
  openSource(): void
  /** Help › Check for updates now (M42 U8): one check, with the setting on or off, answered in the window. */
  checkForUpdates(): void
}

/**
 * What the window holds, as far as the menu greys out by it (M54 F7): an item
 * that has nothing to act on is disabled rather than clicked into silence —
 * Save, Save as… and Earlier copies with no document, Guide me with no ledger.
 */
export interface MenuState {
  readonly document: boolean
  readonly guide: boolean
}

export const NOTHING_OPEN: MenuState = { document: false, guide: false }

/**
 * A label with its `&` doubled: Windows and Linux read a single one as the
 * mnemonic's marker, so `A & B.emd` would lose its ampersand and underline a space.
 */
export function menuText(text: string): string {
  return text.replaceAll('&', '&&')
}

/**
 * **Every label is the command's one name, in sentence case** (M54 F7, D-531) —
 * the same words the palette and the title bar use, never the platform's Title
 * Case: a person who learned *Save as…* in one place finds it by that name in
 * the others. The roles carry labels for the same reason; their own are Title Case.
 *
 * **The words are the app's language** (M60 U7, D-588): `words` is the shell's area of the
 * catalogue, English unless the page said Hebrew. The order is not reversed for Hebrew: an OS that
 * lays its menus out right to left mirrors them itself, and one reversed here would be mirrored twice.
 */
export function buildMenuTemplate(
  platform: string,
  recents: readonly RecentDocument[],
  actions: MenuActions,
  state: MenuState = NOTHING_OPEN,
  words: ShellWords = shellWords('en'),
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin'
  const w = words.menu
  const folders = recentFolders(recents)

  const openRecent: MenuItemConstructorOptions = {
    label: w.openRecent,
    // Disabled rather than hidden: an empty submenu that vanishes makes the
    // menu jump, and a greyed entry says "this exists, you have not used it".
    enabled: recents.length > 0,
    submenu:
      recents.length === 0
        ? [{ label: w.nothingYet, enabled: false }]
        : [
            ...recents.map(
              (entry, index): MenuItemConstructorOptions => ({
                // The folder in the label, cut to the end that differs: two years of
                // `finances.emd` in different folders is the normal case, not the odd
                // one, and a Windows menu shows no tooltip to tell them apart (M54 F7).
                label: menuText(`${entry.name} — ${folders[index] ?? ''}`),
                click: () => actions.send({ kind: 'open-path', path: entry.path }),
              }),
            ),
            { type: 'separator' },
            { label: w.clearRecents, click: () => actions.clearRecents() },
          ],
  }

  const file: MenuItemConstructorOptions = {
    label: w.file,
    submenu: [
      { label: w.new, accelerator: 'CmdOrCtrl+N', click: () => actions.send({ kind: 'new' }) },
      { label: w.open, accelerator: 'CmdOrCtrl+O', click: () => actions.send({ kind: 'open' }) },
      openRecent,
      { type: 'separator' },
      {
        label: w.save,
        accelerator: 'CmdOrCtrl+S',
        enabled: state.document,
        click: () => actions.send({ kind: 'save' }),
      },
      // Save as (D-531): a new file, and the window carries on in it — what every
      // platform calls it, and what its dialog is titled.
      {
        label: w.saveAs,
        accelerator: 'CmdOrCtrl+Shift+S',
        enabled: state.document,
        click: () => actions.send({ kind: 'save-as' }),
      },
      // M45 U4 (D-455): the copies taken before a write, in Emerald's own
      // folder, listed with Restore — what makes a copy there one a person finds.
      {
        label: w.earlierCopies,
        enabled: state.document,
        click: () => actions.send({ kind: 'earlier-copies' }),
      },
      { type: 'separator' },
      // On macOS quitting lives in the app menu, and Close is the window verb.
      // Either way it goes through the window's `close`, which is where the
      // unsaved-work question is asked (D-128).
      mac ? { role: 'close', label: w.closeWindow } : { role: 'quit', label: w.quit },
    ],
  }

  // Copy and paste have to work in every text field, and on macOS the roles
  // are also what bind Cmd+C and Cmd+V at all.
  const edit: MenuItemConstructorOptions = {
    label: w.edit,
    submenu: [
      { role: 'undo', label: w.undo },
      { role: 'redo', label: w.redo },
      { type: 'separator' },
      { role: 'cut', label: w.cut },
      { role: 'copy', label: w.copy },
      { role: 'paste', label: w.paste },
      { role: 'selectAll', label: w.selectAll },
    ],
  }

  const view: MenuItemConstructorOptions = {
    label: w.view,
    submenu: [
      {
        // The title bar's button is *Commands* (M54 F7): one name for the palette.
        label: w.commands,
        accelerator: 'CmdOrCtrl+K',
        // Shown, not registered — see Toggle the sidebar below.
        registerAccelerator: false,
        click: () => actions.send({ kind: 'command-palette' }),
      },
      {
        label: w.toggleSidebar,
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
      { role: 'resetZoom', label: w.actualSize },
      { role: 'zoomIn', label: w.zoomIn },
      { role: 'zoomOut', label: w.zoomOut },
      { type: 'separator' },
      { role: 'togglefullscreen', label: w.fullScreen },
      { role: 'toggleDevTools', label: w.developerTools },
    ],
  }

  const help: MenuItemConstructorOptions = {
    label: w.help,
    // `role: 'help'` is what puts the search field in macOS's Help menu.
    role: 'help',
    submenu: [
      // The guide walks the ledger's screens, so it is greyed where none is kept,
      // as the palette leaves it out there.
      { label: w.guide, enabled: state.guide, click: () => actions.send({ kind: 'guide' }) },
      { type: 'separator' },
      { label: w.license, click: () => actions.openText('license') },
      { label: w.notices, click: () => actions.openText('notices') },
      { label: w.source, toolTip: w.sourceHint, click: () => actions.openSource() },
      { type: 'separator' },
      // M42 U8 (D-502): with the setting off too — pressing it is consent for that one check, and
      // the answer is the window's quiet notice, never a dialog.
      { label: w.checkForUpdates, click: () => actions.checkForUpdates() },
      // On macOS the About is the app menu's first item, as every Mac app has it.
      ...(mac ? [] : ([{ label: w.about, click: () => actions.showAbout() }] as MenuItemConstructorOptions[])),
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
