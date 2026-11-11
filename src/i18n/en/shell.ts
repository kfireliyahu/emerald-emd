/**
 * **The desktop shell's own words, in English** — its menu, its dialogs and its
 * windows' titles (M60 U7, D-588). The source `../he/shell.ts` translates.
 *
 * **The shell reads this file itself**, bundled into `main.cjs`: it has to be
 * right before a page has loaded, and on a Hebrew computer before anybody has
 * chosen anything. So it holds data and imports nothing, and `electron/language.ts`
 * is the one file in `electron/` that reaches it.
 *
 * A menu item is the command's one name (D-531), in sentence case; `&` marks the
 * key Alt opens a menu by on Windows and Linux. `{name}` is the document's name.
 */
export const shell = {
  menu: {
    file: '&File',
    edit: '&Edit',
    view: '&View',
    help: '&Help',
    new: 'New',
    open: 'Open…',
    openRecent: 'Open recent',
    nothingYet: 'Nothing yet',
    clearRecents: 'Clear recent documents',
    save: 'Save',
    saveAs: 'Save as…',
    earlierCopies: 'Earlier copies of this document…',
    closeWindow: 'Close window',
    quit: 'Quit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    commands: 'Commands…',
    toggleSidebar: 'Toggle the sidebar',
    actualSize: 'Actual size',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fullScreen: 'Toggle full screen',
    developerTools: 'Toggle developer tools',
    guide: 'Guide me',
    license: 'License',
    notices: 'Third-party notices',
    source: 'Source code',
    sourceHint: 'Opens in your browser',
    checkForUpdates: 'Check for updates now',
    about: 'About Emerald',
  },
  dialogs: {
    saveAsTitle: 'Save as',
    documentFilter: 'Emerald document',
    thisDocument: 'this document',
    save: 'Save',
    dontSave: "Don't save",
    cancel: 'Cancel',
    unsavedClosing: 'Save your changes to {name} before closing?',
    unsavedRestarting: 'Save your changes to {name} before restarting?',
    unsavedDetail: 'Everything since the last save is lost otherwise.',
    unsavedRestartingDetail: 'Emerald restarts to install the update. Everything since the last save is lost otherwise.',
    crashedAgain: 'This window stopped working again.',
    crashedAgainDetail: 'Close it and open Emerald again: unsaved work is offered back when it opens.',
  },
  windows: {
    license: 'Emerald — License (GNU AGPL-3.0)',
    notices: 'Emerald — Third-party notices',
  },
} as const
