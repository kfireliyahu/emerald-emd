/**
 * The shell's main process: one window, showing the app that already exists.
 *
 * This is the host M9 is for (D-115). Nothing in `src/` changes to run inside
 * it — the renderer is the same bundle `dist/` has always been, loaded from
 * `app://` instead of over HTTP, and it does not know the difference. What the
 * shell adds in this unit is the process itself and the three things a process
 * can enforce that a browser tab cannot: an origin the renderer owns, a
 * session that cancels any request to anywhere else (D-124), and a preload
 * that is the only opening between the page and Node.
 *
 * It also serves the document: the native dialogs, the atomic write and the
 * watcher behind `src/data/storage/desktop.ts` (D-127). The mechanics of all
 * three are in `documents.ts`; what is here is the wiring, the window they
 * belong to, and the check that the renderer only ever names a file the user
 * pointed at.
 *
 * Since D-130 it also owns the *frame*: the window draws no title bar of its
 * own, and what the platform still draws — macOS's traffic lights, Chromium's
 * caption buttons on Windows and Linux — is positioned and coloured from
 * `windowChrome.ts`, which the renderer lays its own bar out against.
 */

import { readFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
  type WebContents,
} from 'electron'

import { aboutPanelOptions, BUNDLED_TEXTS, SOURCE_URL, type BundledText } from './about.ts'
import { APP_ORIGIN, APP_SCHEME, contentTypeFor, resolveAppRequest } from './appProtocol.ts'
import {
  APP_CHANNELS,
  DOCUMENT_CHANNELS,
  DOCUMENT_EXTENSION,
  FILE_CHANNELS,
  RUNTIME_CHANNELS,
  UPDATE_CHANNELS,
  VERSION_ARGUMENT,
  WINDOW_CHANNELS,
  backupsRoot,
  type AboutFacts,
  type GenerateRequest,
  type RecentDocument,
  type ShellCommand,
} from './bridge.ts'
import {
  createDocumentWatcher,
  createPathGrants,
  documentFromArguments,
  listEarlierCopies,
  measureEarlierCopies,
  readDocument,
  readDocumentMark,
  restoreEarlierCopy,
  withDocumentExtension,
  writeBackup,
  writeDocument,
  type DocumentWatcher,
} from './documents.ts'
import { openLinked, presentLinked, showLinked, type LinkedFileSystem } from './linkedFiles.ts'
import { buildMenuTemplate } from './menu.ts'
import { isAllowedRequest, isAllowedUpdateRequest } from './network.ts'
import { cancelGeneration, generate } from './generate.ts'
import { loadRecents, saveRecents, withRecent, withoutRecent } from './recents.ts'
import { detectRuntimes } from './runtimes.ts'
import {
  automaticFrom,
  createUpdates,
  RELEASES_LATEST,
  RELEASES_PAGE,
  settingsText,
  TICK_MS,
  type Updates,
} from './updates.ts'
import { titleBarOverlay, trafficLightPosition, usesControlsOverlay } from './windowChrome.ts'

/**
 * Set by `scripts/dev-desktop.mjs` and by nothing else. Present means the
 * renderer comes from Vite with hot reload; absent means it comes from `dist/`
 * over `app://`, which is what a packaged app does.
 */
const DEV_SERVER_URL = process.env['EMERALD_DEV_SERVER_URL']

/**
 * A file holding a release answer, read instead of asking GitHub — for verifying the notice in an
 * unpackaged shell, and honoured only there: a packaged app ignores it. Reading it makes no request.
 */
const UPDATE_ANSWER_FILE = process.env['EMERALD_UPDATE_ANSWER']

/**
 * `dist/` sits beside `dist-electron/`, in the repo and inside a packaged app
 * alike, so one relative path serves both and there is no `isPackaged` branch
 * to get wrong.
 */
const RENDERER_ROOT = join(__dirname, '..', 'dist')

/**
 * The renderer loads one script, one stylesheet and its fonts, all its own,
 * and reaches nothing else. Two concessions, and each one is a fact about this
 * app rather than a loosening for comfort:
 *
 * - **`wasm-unsafe-eval`**, because the database is SQLite compiled to
 *   WebAssembly and Chromium refuses to instantiate a module under a CSP
 *   without it. It permits compiling wasm and nothing else; `unsafe-eval`,
 *   which would also hand the page `eval`, is not here. The bytes it compiles
 *   are the ones the build inlined into the bundle.
 * - **`unsafe-inline` for styles**, which a React tree with `style` attributes
 *   and hand-rolled SVG charts needs.
 *
 * This is belt to the session guard's braces. The guard is what actually stops
 * a request; a header stops the markup that would have made one.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  // **`worker-src` exists for one caller and grants nothing outward** (D-147).
  // Tesseract runs its model on a worker, and `default-src 'none'` blocked it,
  // which is why D-118's "no Web Worker anywhere" was a CSP line as well as a
  // measurement. `'self'` is this app's own `app://` origin and `blob:` is the
  // worker script it builds from that origin; neither reaches the network, and
  // the session guard that actually stops requests is untouched — the test
  // naming Ollama's port still expects `false`.
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

// Before `app.ready`, which is the only time this may be called. `standard`
// gives the renderer a real origin — and with it `localStorage`, which is
// where the crash snapshot lives — and `secure` makes it a secure context.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

// Every renderer, not only the ones created with `sandbox: true` below.
app.enableSandbox()

function serveRenderer(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppRequest(request.url, RENDERER_ROOT)
    if (file === undefined) return new Response('Not found', { status: 404 })

    try {
      const bytes = await readFile(file)
      return new Response(bytes, {
        headers: {
          'content-type': contentTypeFor(file),
          'content-security-policy': CONTENT_SECURITY_POLICY,
        },
      })
    } catch {
      // A missing file here means a broken or half-copied build, which is
      // worth seeing as a 404 in the console rather than as a crash.
      return new Response('Not found', { status: 404 })
    }
  })
}

function guardSession(): void {
  const current = session.defaultSession

  current.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedRequest(details.url, DEV_SERVER_URL)
    if (!allowed) console.warn(`[emerald] blocked request to ${details.url}`)
    callback({ cancel: !allowed })
  })

  // A local-first finance app has nothing to ask the operating system for.
  current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  current.setPermissionCheckHandler(() => false)
  current.setDevicePermissionHandler(() => false)
}

/**
 * Help's license and notices (M43 U7, D-452): a plain window over a file `dist/` already holds,
 * served by the same `app://` handler and behind the same session guard as everything else, so
 * reading them asks nothing of the network. One window per text; asking again brings it forward.
 */
const textWindows = new Map<BundledText, BrowserWindow>()

/**
 * The document's window is the one that is not a text window. Everything that speaks to "the
 * window" — the menu's commands, the unsaved-work question, a second launch — means that one,
 * and a license window must neither receive a command nor reset the page's listening flag.
 */
function isTextWindow(window: BrowserWindow): boolean {
  for (const open of textWindows.values()) if (open === window) return true
  return false
}

function documentWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((window) => !isTextWindow(window))
}

function closeTextWindows(): void {
  for (const window of textWindows.values()) if (!window.isDestroyed()) window.close()
}

function openText(text: BundledText): void {
  const open = textWindows.get(text)
  if (open !== undefined && !open.isDestroyed()) {
    open.focus()
    return
  }
  const { file, title } = BUNDLED_TEXTS[text]
  const window = new BrowserWindow({
    width: 760,
    height: 720,
    title,
    autoHideMenuBar: true,
    // No preload: a page of text has no business with the bridge.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  })
  // A text file has no <title>, and the page would otherwise rename the window to its URL.
  window.on('page-title-updated', (event) => event.preventDefault())
  window.on('closed', () => textWindows.delete(text))
  textWindows.set(text, window)
  void window.loadURL(`${APP_ORIGIN}/${file}`)
}

/**
 * Help → Source Code: the one address this app hands to anything outside itself, and only on a
 * click. It is a constant read from `package.json` (`about.ts`), never a URL from the renderer,
 * and it opens in the person's own browser — the page still reaches nothing (D-124).
 */
function openSource(): void {
  void shell.openExternal(SOURCE_URL)
}

/**
 * **Updates, if you turn them on** (M42 U8, D-502) — the one request this app makes, and only on
 * the person's say: the setting, or a press of Help › Check for Updates Now.
 *
 * It asks from **a session of its own**, held in memory, which nothing the page loads runs in: the
 * page's session above refuses the address with the setting on or off, and this one allows that
 * address alone, only while a check is asking (`isAllowedUpdateRequest`). It tells GitHub the app's
 * name and version and a fixed language (`setUserAgent`), and a redirect is an error, not a second host.
 *
 * The setting is the app's, in `settings.json` beside `recents.json`, never the document's.
 */
function serveUpdates(): Updates {
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  let saved: string | undefined
  try {
    saved = readFileSync(settingsFile, 'utf8')
  } catch {
    saved = undefined
  }

  const stub = app.isPackaged || UPDATE_ANSWER_FILE === undefined || UPDATE_ANSWER_FILE === '' ? undefined : UPDATE_ANSWER_FILE
  const asking = session.fromPartition('emerald-updates')
  // The language too: Chromium would otherwise send the system's, which says where somebody is.
  asking.setUserAgent(`Emerald/${app.getVersion()}`, 'en')
  asking.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  asking.setPermissionCheckHandler(() => false)

  const updates = createUpdates({
    version: app.getVersion(),
    automatic: automaticFrom(saved),
    fetchLatest: async () => {
      if (stub !== undefined) return JSON.parse(await readFile(stub, 'utf8')) as unknown
      const response = await asking.fetch(RELEASES_LATEST, {
        headers: { accept: 'application/vnd.github+json' },
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}.`)
      return (await response.json()) as unknown
    },
    saveAutomatic: async (on) => {
      try {
        await mkdir(app.getPath('userData'), { recursive: true })
        await writeFile(settingsFile, settingsText(on))
      } catch (error) {
        // The switch still holds for this run; the next start reads off, which is the safe side.
        console.warn(`[emerald] could not write ${settingsFile}: ${String(error)}`)
      }
    },
    publish: (state) => {
      for (const window of documentWindows()) window.webContents.send(UPDATE_CHANNELS.changed, state)
    },
    now: () => Date.now(),
  })

  asking.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedUpdateRequest(details.url, updates.gateOpen())
    if (!allowed) console.warn(`[emerald] blocked update request to ${details.url}`)
    callback({ cancel: !allowed })
  })

  ipcMain.handle(UPDATE_CHANNELS.state, () => updates.state())
  ipcMain.handle(UPDATE_CHANNELS.setAutomatic, (_event, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('The setting is on or off.')
    return updates.setAutomatic(on)
  })
  ipcMain.handle(UPDATE_CHANNELS.checkNow, () => updates.checkNow())
  ipcMain.handle(UPDATE_CHANNELS.later, () => updates.later())
  // Download: the newest release's page, a constant — never an address the answer named.
  ipcMain.handle(UPDATE_CHANNELS.openReleasePage, () => shell.openExternal(RELEASES_PAGE))

  // At start, then every hour asking whether a day has passed: nothing at all while it is off.
  void updates.tick()
  const timer = setInterval(() => void updates.tick(), TICK_MS)
  app.on('will-quit', () => clearInterval(timer))
  return updates
}

/**
 * The document side of the shell: the dialogs, the file operations, the
 * recents list, the File menu, and the documents the operating system hands us.
 *
 * `grants` is the whole access model: a path is usable only after the user
 * pointed at it — from a dialog in this run, or from the recents list, which is
 * the same promise remembered across runs (D-128). The renderer is our own code
 * behind a session that cannot navigate anywhere else, so this is not a defence
 * against a hostile page — it is the File System Access API's handle model kept
 * rather than traded away, so that a mistake in the renderer stays a mistake
 * about the user's document and not about the user's disk.
 */
function serveDocuments(updates: Updates): void {
  const grants = createPathGrants()
  const recentsFile = join(app.getPath('userData'), 'recents.json')
  let recents: readonly RecentDocument[] = []

  /**
   * Set when the operating system hands us a document before there is a page
   * listening for it — which is the ordinary case at launch, not the odd one.
   * Flushed when the renderer says it has subscribed.
   */
  let pendingOpen: string | undefined
  let listening = false

  /** Pushed by the renderer, because the shell cannot see inside the document. */
  let unsavedWork = false

  const watcher: DocumentWatcher = createDocumentWatcher(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DOCUMENT_CHANNELS.changed)
    }
  })
  app.on('will-quit', () => watcher.close())

  const filters = [
    { name: 'Emerald document', extensions: [DOCUMENT_EXTENSION.replace(/^\./, '')] },
  ]

  function send(command: ShellCommand): void {
    const [window] = documentWindows()
    if (window === undefined || !listening) {
      // Nothing is listening yet. Only `open-path` is worth holding: the rest
      // come from a menu, which cannot be clicked before there is a window.
      if (command.kind === 'open-path') pendingOpen = command.path
      return
    }
    window.webContents.send(DOCUMENT_CHANNELS.command, command)
  }

  function refreshMenu(): void {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildMenuTemplate(process.platform, recents, {
          send,
          clearRecents: () => void writeRecents([]),
          // The page's About, not the native panel (M45 F3, D-457): it shows the folder of
          // earlier copies, with a button to open it, which the panel cannot hold.
          showAbout: () => send({ kind: 'about' }),
          openText,
          openSource,
          checkForUpdates: () => void updates.checkNow(),
        }),
      ),
    )
  }

  /** The one place recents change: the list, the menu and the file stay in step. */
  async function writeRecents(next: readonly RecentDocument[]): Promise<void> {
    recents = next
    refreshMenu()
    try {
      await saveRecents(recentsFile, next)
    } catch (error) {
      // A recents list that cannot be written is a smaller problem than a save
      // that fails because of it. Noted, not raised.
      console.warn(`[emerald] could not write ${recentsFile}: ${String(error)}`)
    }
  }

  /** A document the user chose: granted, remembered, and offered by the OS too. */
  function noteOpened(path: string): string {
    const full = grants.grant(path)
    app.addRecentDocument(full)
    void writeRecents(withRecent(recents, full, Date.now()))
    return full
  }

  function granted(value: unknown): string {
    if (typeof value !== 'string' || !grants.isGranted(value)) {
      // Reaches the renderer as a rejected promise, which the document store
      // already turns into a visible error rather than a silent nothing.
      throw new Error('That file was never opened here. Use Open… to choose it.')
    }
    return value
  }

  /** Every path the recents list remembers is one the user chose once. */
  async function restoreRecents(): Promise<void> {
    recents = await loadRecents(recentsFile)
    for (const entry of recents) grants.grant(entry.path)
    refreshMenu()
  }

  ipcMain.handle(DOCUMENT_CHANNELS.open, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result =
      window === null
        ? await dialog.showOpenDialog({ filters, properties: ['openFile'] })
        : await dialog.showOpenDialog(window, { filters, properties: ['openFile'] })

    const [picked] = result.filePaths
    if (result.canceled || picked === undefined) return undefined
    return readDocument(noteOpened(picked))
  })

  ipcMain.handle(DOCUMENT_CHANNELS.chooseSavePath, async (event, suggestedName: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    // Spread rather than an explicit `undefined`: `exactOptionalPropertyTypes`
    // is on, and an absent option is not the same as one set to nothing.
    const options = {
      filters,
      ...(typeof suggestedName === 'string' ? { defaultPath: suggestedName } : {}),
    }
    const result =
      window === null
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(window, options)

    if (result.canceled || result.filePath === undefined || result.filePath === '') return undefined
    return noteOpened(withDocumentExtension(result.filePath))
  })

  ipcMain.handle(DOCUMENT_CHANNELS.read, async (_event, path: unknown) => {
    const file = granted(path)
    try {
      return await readDocument(file)
    } catch (error) {
      // A recent that is not there any more takes itself off the list rather
      // than sitting in the menu offering to fail again.
      void writeRecents(withoutRecent(recents, file))
      throw error
    }
  })

  ipcMain.handle(DOCUMENT_CHANNELS.write, async (_event, path: unknown, bytes: unknown) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('A document is written as bytes.')
    const file = granted(path)
    // Noted before the write's own filesystem event can arrive, so saving the
    // document never reports the document as having changed underneath us.
    watcher.noteOurWrite(file, await writeDocument(file, bytes))
  })

  ipcMain.handle(DOCUMENT_CHANNELS.mark, (_event, path: unknown) => readDocumentMark(granted(path)))

  // Emerald's own folder of earlier copies (M45 U4, D-455) — the one the plugin
  // copies into before a write, computed in plain Node the same way, local and
  // never Electron's roaming `userData`. Read per call, so the variable that
  // moves it moves it for both halves alike.
  const copiesRoot = (): string => backupsRoot(process.platform, process.env, homedir())

  // A named copy of a document this window already holds (M25 U2), into its
  // folder of earlier copies since M48 U4 (D-470). The page names neither the
  // folder nor the file: both come from the granted path.
  ipcMain.handle(DOCUMENT_CHANNELS.backup, async (_event, path: unknown, bytes: unknown, label: unknown) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('A document is written as bytes.')
    if (typeof label !== 'string') throw new Error('A backup is labelled with a word.')
    return writeBackup(copiesRoot(), granted(path), bytes, label)
  })

  ipcMain.handle(DOCUMENT_CHANNELS.earlierCopies, (_event, path: unknown) =>
    listEarlierCopies(copiesRoot(), granted(path)),
  )

  // The page names a copy by the name the list gave it; the folder comes from
  // the granted path, and `restoreEarlierCopy` refuses any other name.
  ipcMain.handle(DOCUMENT_CHANNELS.restoreEarlierCopy, async (_event, path: unknown, copy: unknown) => {
    if (typeof copy !== 'string') throw new Error('An earlier copy is named by its file name.')
    const file = granted(path)
    // The recents name the folders made before each one recorded its document (D-457).
    const restored = await restoreEarlierCopy(
      copiesRoot(),
      file,
      copy,
      new Date(),
      recents.map((each) => each.path),
    )
    // Our own write, like a save: the watcher must not report it as somebody else's.
    watcher.noteOurWrite(file, restored.mark)
    return restored.safetyCopy
  })

  // Help › About (M45 F3, D-457): what the native panel said, and the folder of
  // earlier copies — where, how large — with the one folder it may open.
  ipcMain.handle(APP_CHANNELS.about, async (): Promise<AboutFacts> => {
    const panel = aboutPanelOptions(app.getVersion())
    return {
      applicationName: panel.applicationName,
      version: panel.applicationVersion,
      copyright: panel.copyright,
      credits: panel.credits,
      backups: await measureEarlierCopies(copiesRoot()),
    }
  })

  ipcMain.handle(APP_CHANNELS.openBackupsFolder, async () => {
    const root = copiesRoot()
    // Made if it is not there yet, so the button opens an empty folder rather than failing.
    await mkdir(root, { recursive: true })
    const failure = await shell.openPath(root)
    if (failure !== '') throw new Error(failure)
  })

  ipcMain.handle(DOCUMENT_CHANNELS.watch, (_event, path: unknown) =>
    watcher.watch(path === undefined ? undefined : granted(path)),
  )

  ipcMain.handle(DOCUMENT_CHANNELS.recents, () => recents)
  // File › Open Recent › Clear Menu, from the palette (M46 U1): the same write the menu makes.
  ipcMain.handle(DOCUMENT_CHANNELS.clearRecents, () => writeRecents([]))

  // Help's License, Third-Party Notices and Source Code, from the palette (M46 U1).
  // The page names which text, and only one of the two; the address is never the page's.
  ipcMain.handle(APP_CHANNELS.openText, (_event, text: unknown) => {
    if (text !== 'license' && text !== 'notices') throw new Error('No such text.')
    openText(text)
  })
  ipcMain.handle(APP_CHANNELS.openSource, () => openSource())

  ipcMain.on(DOCUMENT_CHANNELS.ready, () => {
    listening = true
    const path = pendingOpen
    pendingOpen = undefined
    if (path !== undefined) send({ kind: 'open-path', path })
  })

  ipcMain.on(DOCUMENT_CHANNELS.unsaved, (_event, value: unknown) => {
    unsavedWork = value === true
  })

  ipcMain.on(DOCUMENT_CHANNELS.closeWindow, (event) => {
    // The renderer has just saved and is answering the question below. `destroy`
    // rather than `close`, so the guard does not ask again.
    BrowserWindow.fromWebContents(event.sender)?.destroy()
  })

  /**
   * The question a document-based app owes the person closing it.
   *
   * `beforeunload` cannot do this: in Electron a `beforeunload` that objects
   * cancels the close and shows **nothing**, so the window simply refuses to
   * shut and never says why. That is what the app did between D-126 and here.
   */
  function guardClose(window: BrowserWindow): void {
    window.on('close', (event) => {
      if (!unsavedWork || isTextWindow(window)) return
      event.preventDefault()

      const choice = dialog.showMessageBoxSync(window, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: 'Save your changes before closing?',
        detail: 'Everything since the last save is lost otherwise.',
      })

      if (choice === 1) window.destroy()
      // The renderer saves and then asks to be closed, so a save that refuses —
      // because the file changed underneath us (D-092) — leaves the window open
      // with the conflict on screen, which is the only safe answer.
      else if (choice === 0) send({ kind: 'save-and-close' })
    })
  }

  /** A document the OS handed us, from any of the three ways it can arrive. */
  function openFromSystem(path: string | undefined): void {
    if (path === undefined) return
    send({ kind: 'open-path', path: noteOpened(path) })
  }

  app.on('open-file', (event, path) => {
    // macOS: a double-click, a drop on the dock icon, or the dock's own recents.
    event.preventDefault()
    openFromSystem(path)
  })

  app.on('second-instance', (_event, argv) => openFromSystem(documentFromArguments(argv)))

  app.on('browser-window-created', (_event, window) => {
    guardClose(window)
    // A reload — the dev loop's hot restart, or DevTools — throws away the
    // subscription, and the page says so again when it comes back. A text
    // window loading is not the page reloading (asked at the event: the window
    // is not in `textWindows` until its constructor has returned).
    window.webContents.on('did-start-loading', () => {
      if (isTextWindow(window)) return
      listening = false
      unsavedWork = false
    })
  })

  void restoreRecents().then(() => openFromSystem(documentFromArguments(process.argv)))
}

/**
 * The local model runtime (M10): the one place in this process that opens a
 * socket, and it opens it only when somebody asked.
 *
 * `guardSession` above cancels every request the *renderer* makes to anywhere
 * but `app://`, and `localhost` is on the wrong side of that line deliberately
 * (D-124). This handler is the other side of it: the page asks a question, the
 * main process answers it, and `electron/runtimes.ts` refuses any origin that
 * is not this machine's loopback. Node's `fetch` does not pass through the
 * session guard, which is exactly why that refusal is a tested predicate
 * rather than a comment.
 *
 * Registered at startup; **called at startup by nothing.** Off by default is
 * kept here by there being no caller, and in the renderer by no screen asking
 * until a person opens one.
 */
function serveRuntimes(): void {
  ipcMain.handle(RUNTIME_CHANNELS.detect, () => detectRuntimes())

  ipcMain.handle(RUNTIME_CHANNELS.generate, (event, request: unknown) =>
    // Progress goes back to the window that asked, not to every window: two
    // windows would otherwise each see the other's token count.
    generate(request as GenerateRequest, (tokens) => {
      if (!event.sender.isDestroyed()) event.sender.send(RUNTIME_CHANNELS.progress, tokens)
    }),
  )

  ipcMain.on(RUNTIME_CHANNELS.cancel, () => cancelGeneration())
}

/**
 * **A `file` cell's four questions** (M37 U6): pick a file, is it there, open
 * it, show it in its folder. `linkedFiles.ts` is the gate — no program run, no
 * share reached, no address but a local app's — and nothing comes back to the
 * page but a path the person picked, a yes or no, or why not.
 */
function serveFiles(): void {
  const io: LinkedFileSystem = {
    shell,
    platform: process.platform,
    exists: async (path) => {
      try {
        await stat(path)
        return true
      } catch {
        return false
      }
    },
  }

  ipcMain.handle(FILE_CHANNELS.choose, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openFile' as const] }
    const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
    const [picked] = result.filePaths
    return result.canceled || picked === undefined ? undefined : picked
  })
  ipcMain.handle(FILE_CHANNELS.present, (_event, paths: unknown) => presentLinked(paths, io))
  ipcMain.handle(FILE_CHANNELS.open, (_event, target: unknown) => openLinked(target, io))
  ipcMain.handle(FILE_CHANNELS.show, (_event, path: unknown) => showLinked(path, io))
}

/**
 * The one thing the frame needs from the page: which theme it settled on.
 *
 * Only the caption buttons Chromium paints for us care — everything else in
 * the bar is the page's own CSS. `setTitleBarOverlay` throws where there is no
 * overlay, so macOS never reaches it.
 */
function serveWindow(): void {
  ipcMain.on(WINDOW_CHANNELS.theme, (event, value: unknown) => {
    if (!usesControlsOverlay(process.platform)) return
    if (value !== 'light' && value !== 'dark') return
    BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(titleBarOverlay(value))
  })
}

/** Applied to every `WebContents` the app ever creates, not only the first. */
function hardenContents(contents: WebContents): void {
  // There is nowhere for a second window to go: no external links, no OAuth,
  // no help site. `window.open` and `target="_blank"` both land here.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  contents.on('will-navigate', (event, url) => {
    const home = DEV_SERVER_URL ?? APP_ORIGIN
    if (!url.startsWith(home)) event.preventDefault()
  })

  contents.on('will-attach-webview', (event) => event.preventDefault())

  // The menu bar is behind Alt on Windows and Linux (see `createWindow`), and
  // this key works whether or not anyone finds it.
  contents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const toggle =
      input.key === 'F12' ||
      (input.control && input.shift && key === 'i') ||
      (input.meta && input.alt && key === 'i')
    if (toggle) contents.toggleDevTools()
  })
}

/**
 * The window draws its own title bar (D-130).
 *
 * `hidden` keeps the window's own behaviours — the drag, the double-click to
 * maximise, the snap layouts on Windows — and stops it painting a bar. What is
 * left for the platform is the caption buttons: macOS keeps its traffic lights
 * and we move them down to sit in a taller bar, Windows and Linux get an
 * overlay Chromium paints in colours we hand it. Both sets of numbers come from
 * `windowChrome.ts`, which is also what the renderer lays its bar out against.
 */
function frameOptions(): Electron.BrowserWindowConstructorOptions {
  const dark = nativeTheme.shouldUseDarkColors
  if (usesControlsOverlay(process.platform)) {
    // Following the system until the renderer says what the theme actually is:
    // the preference is in the page's localStorage and the shell cannot read it.
    return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(dark ? 'dark' : 'light') }
  }
  return { titleBarStyle: 'hidden', trafficLightPosition: trafficLightPosition() }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    // The minimum is the app's now, not the browser's, which is what lets the
    // sidebar be a column rather than a tax (D-130 reversing D-054).
    minWidth: 960,
    minHeight: 640,
    title: 'Emerald',
    ...frameOptions(),
    // The File menu exists now (D-128), and on Windows and Linux it lives
    // behind Alt: the accelerators and Open Recent are there for whoever looks,
    // and the window keeps the clean edge the design language asks for. It stays
    // hidden now that the palette has a button on every screen (M46 U1, D-458):
    // every item in the menu is a palette command too, so nothing is behind Alt only.
    autoHideMenuBar: true,
    // A packaged app takes its icon from the executable and the bundle; this is
    // for the dev loop, which would otherwise wear Electron's own (D-129).
    ...(app.isPackaged ? {} : { icon: join(__dirname, '..', 'build', 'icon.png') }),
    // Shown on `ready-to-show` instead, so the first thing the user sees is
    // the app rather than a white rectangle filling in.
    show: false,
    // The renderer decides the theme from localStorage before its first paint
    // (`initTheme` in `src/main.tsx`); the shell cannot read that, so it
    // follows the system, and the two agree in every case but a deliberate
    // override.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0c' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: [`${VERSION_ARGUMENT}${app.getVersion()}`],
    },
  })

  window.once('ready-to-show', () => window.show())
  // Help's text windows belong to the document's: they do not keep the app open after it.
  window.on('closed', () => closeTextWindows())
  void window.loadURL(DEV_SERVER_URL ?? `${APP_ORIGIN}/index.html`)
}

/**
 * One instance, because a double-clicked `.emd` has to reach the window
 * that is already open rather than start a second copy — which would be two
 * writers over one file, which is the one thing this app's storage layer spends
 * its effort refusing to become. The second launch's argument is forwarded to
 * the first instance by `second-instance`, which `serveDocuments` handles.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = documentWindows()
    if (existing === undefined) return
    if (existing.isMinimized()) existing.restore()
    existing.focus()
  })

  app.on('web-contents-created', (_event, contents) => hardenContents(contents))

  // Windows groups taskbar buttons and files a jump list by this id, and it has
  // to be the one the installer registered or `addRecentDocument` lands nowhere
  // (D-129). It must match `appId` in `electron-builder.yml`.
  if (process.platform === 'win32') app.setAppUserModelId('com.kfireliyahu.emerald')

  void app.whenReady().then(() => {
    // macOS shows it from the app menu, Windows and Linux from Help → About Emerald.
    app.setAboutPanelOptions(aboutPanelOptions(app.getVersion()))
    guardSession()
    serveRenderer()
    // Builds the menu as well: File is where Open Recent lives, and D-126's
    // `setApplicationMenu(null)` was about the *default* menu, not about
    // having one.
    serveDocuments(serveUpdates())
    serveWindow()
    serveRuntimes()
    serveFiles()

    createWindow()

    app.on('activate', () => {
      if (documentWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
