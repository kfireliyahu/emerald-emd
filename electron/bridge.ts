/**
 * The contract between the shell and the renderer: everything the page can
 * see of the process hosting it, and nothing else.
 *
 * **This is the one file in `electron/` that `src/` imports.** The direction is
 * deliberate and it is the only exception to "`src/` never imports the shell":
 * the renderer has to be able to name the capabilities it is offered, and a
 * contract both sides read is how the two stay in step. It imports nothing, so
 * importing it from `src/` costs the renderer nothing but the type.
 *
 * Everything here is a named function behind a named channel. The page never
 * receives `ipcRenderer`, and nothing is exposed by being reachable.
 */

/** The property `contextBridge` hangs this on: `window.emerald`. */
export const BRIDGE_KEY = 'emerald'

/**
 * The extension, defined here because the shell is what registers it with the
 * operating system and what filters the native dialogs by it; the app reads it
 * back through `src/data/storage/adapter.ts`.
 */
export const DOCUMENT_EXTENSION = '.emd'

/** The document as bytes, and where those bytes came from. */
export interface DocumentFile {
  readonly path: string
  /** The basename — what the header shows and what a copy is named after. */
  readonly name: string
  readonly bytes: Uint8Array
}

/**
 * What the file looked like at a moment: cheap facts, not content. The same
 * shape as `FileMark` in `src/data/storage/externalChange.ts`, which is where
 * the policy that compares two of them lives.
 */
export interface DocumentMark {
  readonly lastModified: number
  readonly size: number
}

export type DocumentMarkReading =
  | { readonly kind: 'mark'; readonly mark: DocumentMark }
  /** Moved, renamed, deleted, or locked by something else. */
  | { readonly kind: 'unreadable'; readonly reason: string }

/** One of the documents this person has opened before (D-128). */
export interface RecentDocument {
  readonly path: string
  /** The basename, so a menu can be built without touching the disk. */
  readonly name: string
  readonly openedAt: number
}

/**
 * The shell asking the app to do something.
 *
 * Everything here is something the document store already knows how to do: the
 * File menu and a double-clicked document are second ways to reach the buttons
 * in the header, never a second implementation of them.
 */
export type ShellCommand =
  | { readonly kind: 'new' }
  | { readonly kind: 'open' }
  | { readonly kind: 'save' }
  | { readonly kind: 'save-as' }
  /** The operating system, the menu's recents, or a second launch handed us a file. */
  | { readonly kind: 'open-path'; readonly path: string }
  /** The window is closing and the user chose to save first; see `main.ts`. */
  | { readonly kind: 'save-and-close' }
  /** View → Toggle Sidebar. The key is the page's; the menu item is the shell's. */
  | { readonly kind: 'toggle-sidebar' }
  /** View → Command Palette. Same split: the shell shows the key, the page binds it. */
  | { readonly kind: 'command-palette' }
  /** Help → Guide me (M28 U9, D-330): the guide's walk, picked up where it stopped. */
  | { readonly kind: 'guide' }
  /** File → Earlier copies of this document (M45 U4, D-455): the list, with Restore. */
  | { readonly kind: 'earlier-copies' }
  /** Help → About Emerald (M45 F3, D-457): the page's About, with the folder of earlier copies. */
  | { readonly kind: 'about' }

/**
 * The real filesystem, as much of it as the renderer is allowed to see.
 *
 * Every path here has to have come back from `open` or `chooseSavePath` — a
 * dialog the user answered. A path the shell did not hand out is refused, so
 * this is authority over the files someone picked rather than over the disk.
 */
export interface EmeraldDocuments {
  /** Native open dialog, then read. `undefined` when the user cancelled. */
  open(): Promise<DocumentFile | undefined>
  /** Re-read a path already granted — the "reload from disk" behind a conflict. */
  read(path: string): Promise<DocumentFile>
  /**
   * The documents this person has opened before, most recent first. Every path
   * in here is granted, because every path in here was chosen from a dialog
   * once (D-128).
   */
  recents(): Promise<readonly RecentDocument[]>
  /**
   * File › Open Recent › Clear Menu, from the palette too (M46 U1). Missing from
   * a shell older than M46.
   */
  clearRecents?(): Promise<void>
  /**
   * The shell asking the app to do something — a menu item, or a document the
   * operating system handed us to open. Returns an unsubscribe.
   */
  onCommand(listener: (command: ShellCommand) => void): () => void
  /**
   * "I am listening now." Called once, immediately after `onCommand`.
   *
   * A document handed to us at launch is ready before the page is, and a
   * command sent to a window that has not subscribed yet is simply lost —
   * which is how the first version of this silently ignored every
   * double-click. `did-finish-load` is not the same moment: the page's load
   * event can beat React's effects. Only the page knows when it is listening,
   * so the page is what says so.
   */
  ready(): void
  /** Native save dialog. Returns the path, `undefined` when cancelled. */
  chooseSavePath(suggestedName: string): Promise<string | undefined>
  /** Write the document, atomically. Our own writes never come back as changes. */
  write(path: string, bytes: Uint8Array): Promise<void>
  /**
   * Keep a copy of a document as it was, as `<name>.<label>.emd`, in its folder
   * of earlier copies (M25 U2; there since M48 U4, D-470). The main process
   * names the file from a path it already granted, so the page chooses no path;
   * `undefined` when that copy already exists, which is never overwritten — the
   * first copy is the one worth keeping.
   */
  backup(path: string, bytes: Uint8Array, label: string): Promise<string | undefined>
  mark(path: string): Promise<DocumentMarkReading>
  /**
   * The copies taken of this document before a write, newest first, from
   * Emerald's own folder (M45 U4, D-455) — the rolling ones and the named ones,
   * marked by `before` (M48 U4, D-470). Empty when there are none.
   */
  earlierCopies(path: string): Promise<readonly EarlierCopy[]>
  /**
   * Put an earlier copy back: a copy of the file as it is now is taken first,
   * into the same folder, then the earlier one is written over the document,
   * atomically. Returns where the copy of the current file went. The page
   * names the copy by the `name` `earlierCopies` gave it — never a path — and
   * reopens the document afterwards.
   */
  restoreEarlierCopy(path: string, copy: string): Promise<string>
  /** Watch this document, or stop watching when `undefined`. One at a time. */
  watch(path: string | undefined): Promise<void>
  /**
   * Something else wrote the watched file. The listener is told *that* it
   * changed and asks for the details itself, so a push and a check on focus
   * are the same code path with different triggers.
   */
  onChanged(listener: () => void): () => void
  /**
   * Whether there is unsaved work in the window, pushed whenever it changes.
   *
   * The shell cannot see the document — it is bytes in the renderer's memory —
   * and it has to know before it lets the window close. `beforeunload` is not
   * an answer here: in Electron a `beforeunload` that objects cancels the close
   * with **no dialog at all**, which is a window that silently refuses to shut.
   */
  setUnsaved(unsaved: boolean): void
  /** Close the window without asking again — the renderer has just saved. */
  closeWindow(): void
}

/**
 * The window the page is drawn in, as much of it as the page has to know.
 *
 * The shell draws no title bar of its own since D-130: the app draws it, which
 * means the app needs the two things it cannot see for itself — how much room
 * the platform's own buttons take, and a way to tell the platform what colour
 * to paint them. Everything else about the frame is CSS.
 */
/**
 * What the renderer needs in order to draw a title bar that fits. The numbers
 * are decided in `electron/windowChrome.ts`, which is also what configures the
 * window from them, so the two sides cannot drift.
 */
export interface WindowChrome {
  /** The app draws the title bar. False means the OS still does. */
  readonly frameless: boolean
  /** Height of the bar, matching what the shell reserved. */
  readonly height: number
  /** Room to leave at the inline start — macOS's traffic lights. */
  readonly insetStart: number
  /** Room to leave at the inline end — Windows' and Linux's caption buttons. */
  readonly insetEnd: number
}

export interface EmeraldWindow {
  /** The frame's measurements, decided in `electron/windowChrome.ts`. */
  readonly chrome: WindowChrome
  /**
   * Repaint the caption buttons Chromium draws for us (Windows and Linux).
   *
   * The theme lives in the renderer's `localStorage` and the shell cannot read
   * it, so the window opens following the system and the page corrects it as
   * soon as it knows better. A no-op on macOS, where the buttons are the
   * system's own.
   */
  setTheme(theme: 'light' | 'dark'): void
}

/* ------------------------------------------------- the local model runtime */

/**
 * The runtimes a person might already be running on this machine.
 *
 * Two, and both of them speak HTTP on a loopback port they picked years ago.
 * A bundled `llama.cpp` sidecar is the third and it is not here yet: this list
 * is *what to look for before offering to install anything*, which is the order
 * M10 asks for.
 */
export const RUNTIME_KINDS = ['ollama', 'lmstudio'] as const

export type RuntimeKind = (typeof RUNTIME_KINDS)[number]

/** What a person reads. The ids above are what the code compares. */
export const RUNTIME_LABELS: Readonly<Record<RuntimeKind, string>> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
}

/**
 * One model a runtime says it has.
 *
 * **No context window here, and that is deliberate.** Neither runtime prints it
 * in its list endpoint, and both will answer for one model at a time — which is
 * exactly the moment D-122 says the fit is decided. Detection answers "what is
 * installed and what does it cost on disk"; choosing is a separate question
 * asked once, of one model.
 */
export interface ModelCard {
  /** Exactly what the runtime is asked for. Never prettified. */
  readonly id: string
  /** The same thing, made readable. Falls back to `id`. */
  readonly label: string
  /** On disk, when the runtime says. A download budget has to have a number. */
  readonly sizeBytes?: number
}

/**
 * What looking at one runtime's port found.
 *
 * `absent` and `unusable` are split because they are different sentences to a
 * person: nothing is listening there, versus something is and it is not this.
 * The second is what a port collision looks like, and a detector that called it
 * "not installed" would send someone to install what they already have.
 */
export type RuntimeProbe =
  | {
      readonly kind: 'ready'
      readonly runtime: RuntimeKind
      readonly origin: string
      readonly version?: string
      readonly models: readonly ModelCard[]
    }
  | { readonly kind: 'absent'; readonly runtime: RuntimeKind; readonly origin: string }
  | {
      readonly kind: 'unusable'
      readonly runtime: RuntimeKind
      readonly origin: string
      readonly reason: string
    }

/**
 * A provider is a local runtime and a model name (M10), and this is the whole
 * of it.
 *
 * The seam used to be justified by making a local runtime and a remote API the
 * same shape to everything above. There is no remote shape any more (D-124), so
 * it earns its keep on the narrower argument that still holds: Ollama, LM Studio
 * and a bundled sidecar are three runtimes, and M11's surfaces must not know
 * which one answered.
 */
export interface Provider {
  readonly runtime: RuntimeKind
  readonly origin: string
  readonly model: string
}

/**
 * The local model runtime, as much of it as the page is allowed to reach.
 *
 * **Nothing here runs unless a person asked for it.** Off by default is a rule
 * with teeth in exactly one place — nothing in the shell calls `detect` at
 * launch — because a probe is a socket, and a socket opened on a schedule is a
 * socket nobody chose to open.
 *
 * **And the page never speaks to a runtime itself.** The renderer's session
 * cancels every request that is not `app://`, `blob:` or `data:` (D-124), and
 * `localhost` stays on the far side of that line; the main process is what
 * holds the connection, under the loopback guard in `electron/runtimes.ts`.
 */
/**
 * What a model is asked, and under what ceilings.
 *
 * **There is no free-form conversation here on purpose.** Under D-132 a local
 * model produces a *mapping template* — which fields exist and where — and
 * never a value, so every call this app makes wants a structured answer whose
 * shape is known before the model runs. `schema` is that shape, and it is
 * handed to the runtime as a grammar rather than as a request in the prompt:
 * both runtimes will constrain decoding to a JSON schema, which turns "the
 * model returned prose instead of JSON" from a failure mode into an
 * impossibility.
 */
export interface GenerateRequest {
  readonly provider: Provider
  /** Who the model is being, in one paragraph. */
  readonly system: string
  /** The question. Preloaded context belongs in here, not in a second turn. */
  readonly prompt: string
  /**
   * A JSON Schema the answer must satisfy. Omitted means free text, which
   * nothing in the app asks for yet.
   */
  readonly schema?: unknown
  readonly limits?: GenerateLimits
}

/**
 * The three ceilings, each of which exists because a run without it produced
 * nothing over a long time (D-114).
 */
export interface GenerateLimits {
  /** Generated tokens. A model in a loop will otherwise fill its own context. */
  readonly maxTokens?: number
  /** Wall clock, from the request leaving. One payslip once took 38 minutes. */
  readonly deadlineMs?: number
  /** The context window to ask the runtime for. */
  readonly contextTokens?: number
}

/** Why generation stopped — which is a result in every case, never an error. */
export type GenerateStop =
  /** The model finished on its own. The only case where `text` is complete. */
  | 'complete'
  /** Hit `maxTokens`. */
  | 'capped'
  /** Hit `deadlineMs`. */
  | 'timedOut'
  /** `cancel()` — a person pressed stop. */
  | 'cancelled'

export type GenerateResult =
  | {
      readonly kind: 'answer'
      readonly stop: GenerateStop
      /** What was generated, with any reasoning block removed. */
      readonly text: string
      /** Parsed when a `schema` was asked for and the text satisfied it. */
      readonly value?: unknown
      readonly tokens: number
      readonly elapsedMs: number
    }
  /** The runtime refused, vanished, or answered something that is not this. */
  | { readonly kind: 'failed'; readonly reason: string; readonly elapsedMs: number }

export interface EmeraldRuntimes {
  /**
   * Look at every known runtime's port, in parallel, and say what is there.
   * One entry per `RUNTIME_KINDS` member, always, in that order — "we looked
   * and found nothing" is an answer a screen has to be able to draw.
   */
  detect(): Promise<readonly RuntimeProbe[]>
  /**
   * Ask the chosen model a question, and get an answer or a reason there is
   * none.
   *
   * **One at a time**, like the document watcher: a second call while one is in
   * flight is refused rather than queued. A local model is one process on one
   * card, and two requests do not run twice as fast — they run at half speed
   * each and make the first one look broken.
   *
   * Never rejects for anything the model or the runtime did. A refusal, a
   * timeout and a cap are all `GenerateResult`s, because every one of them is
   * something a screen has to be able to say out loud.
   */
  generate(request: GenerateRequest): Promise<GenerateResult>
  /** Stop the generation in flight. Its promise resolves with `cancelled`. */
  cancel(): void
  /**
   * Tokens so far, pushed while a generation runs. Returns an unsubscribe.
   *
   * This is what keeps a slow answer from looking like a hung app: the first
   * token off a cold 17 GB model can be minutes away, and a progress line is
   * the difference between waiting and giving up.
   */
  onProgress(listener: (tokens: number) => void): () => void
}

/** What Help › About says (M45 F3, D-457): what the native panel said, and where the earlier copies are. */
export interface AboutFacts {
  readonly applicationName: string
  readonly version: string
  readonly copyright: string
  /** Lines, as `electron/about.ts` writes them. */
  readonly credits: string
  readonly backups: BackupsFolder
}

/** The app itself, as Help › About shows it. */
export interface EmeraldApp {
  about(): Promise<AboutFacts>
  /** Open Emerald's folder of earlier copies in the system's file manager — the one folder, never a path the page names. */
  openBackupsFolder(): Promise<void>
  /**
   * Help › License and Help › Third-Party Notices, from the palette as well as the menu
   * (M46 U1): the text, from `dist/`, in a window of its own. Missing from a shell older
   * than M46, which the palette treats as no such command.
   */
  openText?(text: 'license' | 'notices'): Promise<void>
  /** Help › Source Code: the repository's one address, in the system browser. The page names no URL. */
  openSource?(): Promise<void>
}

/**
 * **Updates, if you turn them on** (M42 U8, D-502). The main process asks and decides; the page
 * shows the one notice and holds the setting's switch. The page names no address and reaches
 * nothing: the check runs in a session of its own (`electron/updates.ts`, `network.ts`).
 */
export type UpdateNotice =
  /** Check for Updates Now, while it asks. */
  | { readonly kind: 'checking' }
  /**
   * A newer release: `<version> is out`, with Download and Later. On Windows with the setting on it
   * is said only when the download could not be made, and `unfetched` says why (M42 U9).
   */
  | { readonly kind: 'available'; readonly version: string; readonly unfetched?: string }
  /** Windows, after a press with the setting on (M42 U9): the newer installer is on its way. */
  | { readonly kind: 'downloading'; readonly version: string }
  /** Windows (M42 U9): downloaded and checked, `<version> is ready`, with Install and restart and Later. */
  | { readonly kind: 'ready'; readonly version: string }
  /** Only after a press: this is the newest. */
  | { readonly kind: 'latest'; readonly version: string }
  /** Only after a press: why it could not tell. A scheduled check fails silently. */
  | { readonly kind: 'failed'; readonly reason: string }

export interface UpdateState {
  /** The setting, off by default. */
  readonly automatic: boolean
  /** This app's version. */
  readonly version: string
  /**
   * Whether this app downloads a newer version itself with the setting on (Windows, M42 U9) or only
   * says so (macOS until its installers are signed). About's words follow it.
   */
  readonly downloads: boolean
  /** What the window says, until Later or Dismiss; `undefined` is nothing. */
  readonly notice: UpdateNotice | undefined
}

export interface EmeraldUpdates {
  state(): Promise<UpdateState>
  setAutomatic(on: boolean): Promise<UpdateState>
  checkNow(): Promise<UpdateState>
  /** Later, or Dismiss: the notice goes until the next start or the next day's check. */
  later(): Promise<UpdateState>
  /** Download: the newest release's page in the person's own browser. The page names no address. */
  openReleasePage(): Promise<void>
  /**
   * Install and restart (M42 U9): close the window the ordinary way — the unsaved-work question
   * included, and Cancel cancels the install — then run the downloaded installer and open Emerald
   * again on `reopen`, the document open now, which the shell takes only if it handed it out.
   * Optional because a shell older than M42 U9 has no such thing.
   */
  install?(reopen: string | undefined): Promise<void>
  onChange(listener: (state: UpdateState) => void): () => void
}

/**
 * **A file a cell points at** (M37 U6) — the `file` column, opened from the page.
 *
 * The one place the page names a path the person did not pick in a dialog of
 * ours (D-128 otherwise): a document holds paths, and a click on one asks the
 * shell to hand that file to the system's own app. Nothing is read into the
 * page — not a byte, not a `file://` load — so the page learns only whether a
 * file is there and whether it opened. `electron/linkedFiles.ts` is the gate.
 */
export interface EmeraldFiles {
  /** The native dialog for any file; its absolute path, or `undefined` when cancelled. */
  choose(): Promise<string | undefined>
  /** Where a file dropped on the page lives; `''` when it has no path (a page's own `File`). */
  pathOf(file: File): string
  /** Whether each of these absolute paths is there now, in order. */
  present(paths: readonly string[]): Promise<readonly boolean[]>
  /** Hand a path or a local address to the system to open. `undefined` when it opened, else why not. */
  open(target: string): Promise<string | undefined>
  /** Show the file selected in its folder. `undefined` when shown, else why not. */
  show(path: string): Promise<string | undefined>
}

/**
 * **The addresses a `file` cell may hold besides a path: a local app's own**,
 * handed to the system to open in that app (M37 U6). An allowlist and not a
 * denylist, because an `http:` address is a request and every scheme left off
 * this list might be one too (D-124, D-308). One so far — a note app's — and
 * the list grows by a decision. The engine keeps the same list
 * (`src/domain/format/file.ts`), and `linkedFiles.test.ts` fails when they differ.
 */
export const LOCAL_SCHEMES: readonly string[] = ['obsidian']

/**
 * **Kinds of file that are programs**, which the shell will show in their
 * folder and never run from a cell (M37 U6): a document arrives from elsewhere,
 * and a click on a cell is not consent to run what it names.
 */
export const PROGRAM_EXTENSIONS: readonly string[] = [
  'app', 'appref-ms', 'application', 'bat', 'chm', 'cmd', 'com', 'command', 'cpl', 'desktop',
  'exe', 'gadget', 'hta', 'inf', 'jar', 'js', 'jse', 'lnk', 'msc', 'msi', 'msix', 'msp', 'pif',
  'ps1', 'psm1', 'reg', 'scf', 'scr', 'settingcontent-ms', 'sh', 'url', 'vbe', 'vbs', 'website',
  'wsf', 'wsh',
]

export interface EmeraldBridge {
  /** The shell's version, which is the app's — see `package.json`. */
  readonly version: string
  /** `'win32'`, `'darwin'`, `'linux'`. What a keyboard hint has to know. */
  readonly platform: string
  readonly documents: EmeraldDocuments
  readonly window: EmeraldWindow
  readonly runtimes: EmeraldRuntimes
  /** Missing from a shell older than M45 F3, which the page treats as no About of its own. */
  readonly app?: EmeraldApp
  /** Missing from a shell older than M37 U6, where a `file` cell shows its path and copies it. */
  readonly files?: EmeraldFiles  /** Missing from a shell older than M42 U8, which the page treats as no updates at all. */
  readonly updates?: EmeraldUpdates
}

/** One channel per capability; `changed` and `command` run main → page. */
export const DOCUMENT_CHANNELS = {
  open: 'emerald:documents/open',
  read: 'emerald:documents/read',
  chooseSavePath: 'emerald:documents/choose-save-path',
  write: 'emerald:documents/write',
  backup: 'emerald:documents/backup',
  mark: 'emerald:documents/mark',
  earlierCopies: 'emerald:documents/earlier-copies',
  restoreEarlierCopy: 'emerald:documents/restore-earlier-copy',
  watch: 'emerald:documents/watch',
  recents: 'emerald:documents/recents',
  clearRecents: 'emerald:documents/clear-recents',
  changed: 'emerald:documents/changed',
  command: 'emerald:documents/command',
  /** Page → main, one-way: what the shell cannot see for itself. */
  ready: 'emerald:documents/ready',
  unsaved: 'emerald:documents/unsaved',
  closeWindow: 'emerald:documents/close-window',
} as const

/** The local model runtime's channels. One so far, and it is a question. */
export const RUNTIME_CHANNELS = {
  detect: 'emerald:runtimes/detect',
  generate: 'emerald:runtimes/generate',
  /** Page → main, one-way: stop whatever is running. */
  cancel: 'emerald:runtimes/cancel',
  /** Main → page, while one runs. */
  progress: 'emerald:runtimes/progress',
} as const

/** The app's own channels: two questions and Help's three openers, and none names a path. */
export const APP_CHANNELS = {
  about: 'emerald:app/about',
  openBackupsFolder: 'emerald:app/open-backups-folder',
  openText: 'emerald:app/open-text',
  openSource: 'emerald:app/open-source',
} as const

/** Updates (M42 U8, U9): six questions, and `changed` runs main → page. */
export const UPDATE_CHANNELS = {
  state: 'emerald:updates/state',
  setAutomatic: 'emerald:updates/set-automatic',
  checkNow: 'emerald:updates/check-now',
  later: 'emerald:updates/later',
  openReleasePage: 'emerald:updates/open-release-page',
  install: 'emerald:updates/install',
  changed: 'emerald:updates/changed',
} as const

/** A `file` cell's channels (M37 U6): every one a question, and `open` the only one that acts. */
export const FILE_CHANNELS = {
  choose: 'emerald:files/choose',
  present: 'emerald:files/present',
  open: 'emerald:files/open',
  show: 'emerald:files/show',
} as const

/** The window's own channels. Page → main, one-way, like `unsaved` above. */
export const WINDOW_CHANNELS = {
  theme: 'emerald:window/theme',
} as const

/**
 * How the version reaches a sandboxed preload. `process.env` is not there to
 * read, and a preload may not require the `app` module; an extra argv entry is
 * the one channel that survives the sandbox and needs no IPC round trip.
 */
export const VERSION_ARGUMENT = '--emerald-version='

export function versionFromArguments(argv: readonly string[]): string {
  const found = argv.find((argument) => argument.startsWith(VERSION_ARGUMENT))
  return found === undefined ? '0.0.0' : found.slice(VERSION_ARGUMENT.length)
}

// --- a named copy (M34 U6, D-399) ---------------------------------------------

/**
 * A copy kept **before** something — a read, a large batch, or because somebody
 * asked — named for it and kept apart from the plugin's rolling five `.bak`
 * copies, so a run of small writes cannot push the copy from before an import
 * out of the folder (D-399).
 *
 * `memory.emd` before reading `tasks.csv` on 6 October is
 * `memory.before-20261006T120512-reading-tasks-csv.emd`: an `.emd` that opens
 * like any other, sorting by when — **in the document's folder of earlier
 * copies, beside the rolling ones, never beside the document** (M48 U4, D-470,
 * amending D-455: the first big write of a session left one in a project folder
 * that was a git repository). Here rather than in
 * either half because both write one — the plugin with `copyFile`, the shell
 * from the page's bytes — and the two must name and prune them alike. Pure, so
 * the page imports it for nothing.
 */
export const NAMED_COPY_PREFIX = 'before-'

/** How many named copies are kept per document; the oldest goes when one more is made. */
export const NAMED_COPIES_KEPT = 3

/**
 * A write of this many rows or more takes a named copy first, read or batch
 * alike (D-399). Below it the rolling copies are enough: a slip of a few rows
 * is put right by hand, and a copy per small write would push the one that
 * matters out of the three.
 */
export const NAMED_COPY_ROWS = 100

/** `reading tasks.csv` → `reading-tasks-csv`: a word for a file name, at most 24 characters. */
export function namedCopySlug(what: string): string {
  return what
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
}

/**
 * The label a named copy carries between the document's stem and `.emd`.
 * The moment first, so a folder sorted by name is sorted by when; the slug
 * may be empty — a word that is all Hebrew has no ASCII to keep — and the
 * copy is still named for the moment it was kept.
 */
export function namedCopyLabel(what: string, at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
  const slug = namedCopySlug(what)
  return `${NAMED_COPY_PREFIX}${stamp}${slug === '' ? '' : `-${slug}`}`
}

/** `memory.emd` → `memory`: what a copy beside it is named after. */
export function documentStem(name: string): string {
  return name.toLowerCase().endsWith(DOCUMENT_EXTENSION) ? name.slice(0, -DOCUMENT_EXTENSION.length) : name
}

/** The file name a copy with this label has beside a document with this name. */
export function namedCopyName(documentName: string, label: string): string {
  return `${documentStem(documentName)}.${label}${DOCUMENT_EXTENSION}`
}

/**
 * Which of a folder's file names are this document's named copies past the newest
 * `NAMED_COPIES_KEPT`, counting `kept` — the one just made — among those kept.
 * Oldest by the moment in the name (D-399). The shell and the plugin each list the
 * folder and remove what this returns; the choosing is here so they choose alike.
 */
export function namedCopiesPast(documentName: string, names: readonly string[], kept: string): readonly string[] {
  return names
    .filter((each) => isNamedCopyOf(documentName, each) && each !== kept)
    .sort()
    .reverse()
    .slice(NAMED_COPIES_KEPT - 1)
}

/** Whether `candidate` is one of this document's named copies — what pruning may remove, and nothing else. */
export function isNamedCopyOf(documentName: string, candidate: string): boolean {
  const head = `${documentStem(documentName)}.${NAMED_COPY_PREFIX}`
  return (
    candidate.startsWith(head) &&
    candidate.endsWith(DOCUMENT_EXTENSION) &&
    /^\d{8}T\d{6}(-[a-z0-9-]+)?$/.test(candidate.slice(head.length, -DOCUMENT_EXTENSION.length))
  )
}

/** The moment a named copy of this document was kept, from its name; `undefined` when `candidate` is not one. */
export function namedCopyMoment(documentName: string, candidate: string): number | undefined {
  if (!isNamedCopyOf(documentName, candidate)) return undefined
  return anyNamedCopyMoment(candidate)
}

/**
 * What a named copy came before, as its name keeps it: `reading-tasks-csv` is
 * `reading tasks csv`, and a slug that was all Hebrew is `''`. Lossy on purpose —
 * a file name is all there is to read it from.
 */
export function namedCopyBefore(documentName: string, candidate: string): string | undefined {
  if (!isNamedCopyOf(documentName, candidate)) return undefined
  const head = `${documentStem(documentName)}.${NAMED_COPY_PREFIX}`
  return candidate
    .slice(head.length + 'YYYYMMDDTHHMMSS'.length, -DOCUMENT_EXTENSION.length)
    .replace(/^-/, '')
    .replace(/-/g, ' ')
}

const ANY_NAMED_COPY = /\.before-(\d{8}T\d{6})(?:-[a-z0-9-]+)?\.emd$/

/** The moment of a named copy of any document, from its name; `undefined` when it is not one. */
export function anyNamedCopyMoment(candidate: string): number | undefined {
  const found = ANY_NAMED_COPY.exec(candidate)
  return found?.[1] === undefined ? undefined : readStamp(found[1])?.at
}

/**
 * Whether two marks of a file say it changed: a different size or modification
 * time. The shell's watcher and the page's disk check ask it alike.
 */
export function marksDiffer(a: DocumentMark, b: DocumentMark): boolean {
  return a.lastModified !== b.lastModified || a.size !== b.size
}

/** What an atomic write needs from `node:fs/promises` and the process — handed in, so this file stays pure. */
export interface AtomicWriter {
  readonly pid: number
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  /** A pause between renames a held file refused; a timer when left out. */
  wait?(ms: number): Promise<void>
}

/**
 * **How often a rename that another program's hold refused is tried** (M47 U7):
 * six times, a fifth of a second apart — about a second. Windows refuses to
 * rename over a file another process has open, and the app holding a document
 * while a conversation writes it is the ordinary case, not a fault; two writes
 * to a document open in the app failed with `EPERM` and were retried by hand.
 */
export const RENAME_TRIES = 6
const RENAME_PAUSE_MS = 200

/** The codes a held file is refused with — on Windows, by whoever has it open. */
const HELD_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY'])

async function renameOver(io: AtomicWriter, from: string, to: string): Promise<void> {
  const wait = io.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let tried = 1; ; tried += 1) {
    try {
      await io.rename(from, to)
      return
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      if (typeof code !== 'string' || !HELD_CODES.has(code)) throw error
      if (tried >= RENAME_TRIES) {
        throw new Error(
          `${to} is held open by another program — the Emerald app, when the document is open there — and ` +
            `could not be replaced after ${String(RENAME_TRIES)} tries over a second (${code}). The document ` +
            'is as it was; close it there, or let its own save finish, and try again.',
        )
      }
      await wait(RENAME_PAUSE_MS)
    }
  }
}

/**
 * Write a document atomically: to a scratch name beside it, then renamed over it,
 * so a reader sees the old bytes or the new and never half of either. The shell's
 * save and every writing MCP tool go through it.
 *
 * The scratch name carries the pid, so two processes cannot collide on it. A
 * failed write or rename removes it — a stray `.saving-1234` beside somebody's
 * document is its own small betrayal of a document-based app — and cleaning up
 * never replaces the error that actually matters. A rename refused because the
 * file is held open is tried again for about a second first (`RENAME_TRIES`).
 */
export async function writeAtomically(io: AtomicWriter, path: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${path}.saving-${String(io.pid)}`
  try {
    await io.writeFile(temporary, bytes)
    await renameOver(io, temporary, path)
  } catch (error) {
    await io.unlink(temporary).catch(() => undefined)
    throw error
  }
}

// --- earlier copies, in Emerald's own folder (M45 U4, D-455) ------------------

/**
 * **The copy the plugin takes before a mutating batch lives in Emerald's own
 * folder, not beside the document** (D-455, amending D-098). Timestamped copies
 * beside a document filled the person's folder with files nobody named; a
 * desktop app keeps its recovery copies in a per-user folder of its own, and the
 * app's File menu lists them to restore — which is what answers D-098's reason
 * for putting them beside the document, *a backup the user cannot find is not a
 * backup*. **Named copies (D-399) go there too** (M48 U4, D-470, reversing
 * D-455's last clause, which kept them beside the document): the same folder,
 * the same list, still named for what they came before and pruned only against
 * their own kind.
 *
 * Here, pure, because both halves write one — the plugin with `copyFile` before
 * a batch, the shell before a restore — and list or prune them, and the two must
 * agree on the folder, the names and which go.
 */

/** How many timestamped copies are kept per document; the oldest goes when one more is made. */
export const BACKUPS_KEPT = 5

/** Points the whole folder somewhere else — how a test keeps out of the real one. */
export const BACKUPS_ROOT_VARIABLE = 'EMERALD_BACKUPS_DIR'

const ROLLING_COPY_SUFFIX = '.bak'

/**
 * Emerald's own folder of earlier copies, for this user on this machine: local,
 * never roaming, and computed in plain Node terms because the plugin runs
 * without Electron (and Electron's `userData` is roaming on Windows).
 *
 * - Windows: `%LOCALAPPDATA%\Emerald\Backups`
 * - macOS: `~/Library/Application Support/Emerald/Backups`
 * - Linux: `$XDG_STATE_HOME/emerald/backups`, else `~/.local/state/emerald/backups`
 */
export function backupsRoot(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const override = env[BACKUPS_ROOT_VARIABLE]
  if (override !== undefined && override !== '') return override
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA']
    const base = local !== undefined && local !== '' ? local : `${home}\\AppData\\Local`
    return `${base}\\Emerald\\Backups`
  }
  if (platform === 'darwin') return `${home}/Library/Application Support/Emerald/Backups`
  // The XDG spec ignores a relative value, and so do we.
  const state = env['XDG_STATE_HOME']
  const base = state !== undefined && state.startsWith('/') ? state : `${home}/.local/state`
  return `${base}/emerald/backups`
}

/**
 * The one document's folder inside the root: its name, so a person can tell
 * which document it is, and a short hash of its absolute path, so two
 * `finances.emd` in different folders keep apart. `household.emd` is
 * `household-` and eight hex digits.
 *
 * The path is taken resolved; on Windows it is compared as the file system
 * compares it — either separator, any case — so the plugin handed
 * `f:/home/household.emd` and the shell handed `F:\home\household.emd` by a
 * dialog find the same folder.
 */
export function documentBackupFolderName(resolvedPath: string, platform: string): string {
  const key = platform === 'win32' ? resolvedPath.replace(/\//g, '\\').toLowerCase() : resolvedPath
  const name = resolvedPath.split(/[\\/]/).pop() ?? resolvedPath
  return `${documentStem(name)}-${fnv1a(key)}`
}

/** FNV-1a, 32 bits, as eight hex digits: short, stable, and the same in both halves without a crypto import. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * `household.emd.20260823T171242.315.bak` — sortable, to the millisecond, and
 * free of the colons Windows will not put in a file name. Not an `.emd`, so a
 * person browsing the folder does not open one and save into it by accident:
 * the way back is the app's *Earlier copies of this document*.
 *
 * **To the millisecond, and a counter past that** (M45 F2): named to the second,
 * two batches inside one second wrote one name and the second copy replaced the
 * first — seen live, two writes at 12:11:12 left one copy. A second copy in the
 * same millisecond is `….315-2.bak`, the third `-3`; `claimRollingCopy` is the
 * one way either half finds the free one. Copies named to the second before
 * that are still read, as the moment's first millisecond.
 */
export function rollingCopyName(documentName: string, at: Date, sequence = 1): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/Z$/, '')
  return `${documentName}.${stamp}${sequence > 1 ? `-${sequence}` : ''}${ROLLING_COPY_SUFFIX}`
}

/**
 * Take the first free rolling-copy name for this moment: `claim` makes the copy
 * under a name and answers `false` when that name is already taken (a
 * `COPYFILE_EXCL` that met `EEXIST`), and the counter goes up until one is free.
 */
export async function claimRollingCopy(
  documentName: string,
  at: Date,
  claim: (name: string) => Promise<boolean>,
): Promise<string> {
  for (let sequence = 1; ; sequence += 1) {
    const name = rollingCopyName(documentName, at, sequence)
    if (await claim(name)) return name
  }
}

interface RollingCopyStamp {
  readonly at: number
  readonly sequence: number
}

function readRollingCopy(documentName: string, candidate: string): RollingCopyStamp | undefined {
  const head = `${documentName}.`
  if (!candidate.startsWith(head) || !candidate.endsWith(ROLLING_COPY_SUFFIX)) return undefined
  return readStamp(candidate.slice(head.length, -ROLLING_COPY_SUFFIX.length))
}

const STAMP = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?(?:-([1-9]\d*))?/

function readStamp(text: string): RollingCopyStamp | undefined {
  const stamp = new RegExp(`^${STAMP.source}$`).exec(text)
  if (stamp === null) return undefined
  const [, year, month, day, hour, minute, second, milli, sequence] = stamp
  return {
    at: Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(milli ?? 0),
    ),
    sequence: Number(sequence ?? 1),
  }
}

/** The moment a rolling copy of this document was taken, or `undefined` when `candidate` is not one. */
export function rollingCopyMoment(documentName: string, candidate: string): number | undefined {
  return readRollingCopy(documentName, candidate)?.at
}

/**
 * Newest first, for `sort`: by the moment in the name, then by the counter —
 * never by the name's letters, because `….315-2.bak` sorts before `….315.bak`
 * as text and is the later of the two. Names that are not this document's
 * rolling copies go last.
 */
export function newestRollingCopyFirst(documentName: string): (a: string, b: string) => number {
  return (a, b) => {
    const one = readRollingCopy(documentName, a)
    const two = readRollingCopy(documentName, b)
    if (one === undefined || two === undefined) return (one === undefined ? 1 : 0) - (two === undefined ? 1 : 0)
    return two.at - one.at || two.sequence - one.sequence
  }
}

/**
 * Which of a folder's names are this document's rolling copies past the newest
 * `BACKUPS_KEPT`, counting `kept` — the one just made — among those kept. Newest
 * by the moment in the name rather than D-098's mtime: the folder is Emerald's
 * own, so every name in it is one this code wrote, and the name is the moment
 * the copy was taken where the mtime is the document's.
 */
export function rollingCopiesPast(documentName: string, names: readonly string[], kept: string): readonly string[] {
  return names
    .filter((each) => each !== kept && rollingCopyMoment(documentName, each) !== undefined)
    .sort(newestRollingCopyFirst(documentName))
    .slice(BACKUPS_KEPT - 1)
}

/** One earlier copy, as the File menu lists it. */
export interface EarlierCopy {
  /** The file name inside the document's folder — what `restoreEarlierCopy` is handed back. */
  readonly name: string
  /** When it was taken, from its name. */
  readonly at: number
  readonly size: number
  /**
   * A named copy's word for what it came before (`reading tasks csv`, or `''`
   * when its slug was all Hebrew); absent for a rolling copy (M48 U4, D-470).
   */
  readonly before?: string
}

/**
 * Newest first across both kinds, for the File menu: by moment, then — inside
 * one second, where a named copy is stamped to the second and a rolling one to
 * the millisecond — the rolling copies' own order, then by name.
 */
export function newestEarlierCopyFirst(documentName: string): (a: EarlierCopy, b: EarlierCopy) => number {
  const rolling = newestRollingCopyFirst(documentName)
  return (a, b) =>
    b.at - a.at ||
    (a.before === undefined && b.before === undefined ? rolling(a.name, b.name) : 0) ||
    (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)
}

// --- the folder cleans up after itself (M45 F3, D-457) -------------------------

/**
 * **A document's folder goes once the document is gone and its copies are old**
 * (M45 F3, D-457, amending D-455). The last five copies per document cap one
 * folder; nothing capped the folders, so a renamed, moved or deleted document
 * left five copies of itself for good. So each folder says whose it is, and
 * every copy either half takes sweeps the others.
 *
 * Deleting is the dangerous half, so the sweep is narrow on purpose:
 *
 * - only a real directory directly inside the root, named as this code names
 *   one — never a link, so it cannot be walked out of the root;
 * - only when its document is **known to be gone**: its record names a path
 *   that hashes back to the folder's own name, and nothing is at that path while
 *   the drive it was on is there (a drive that is not plugged in is not a gone
 *   document);
 * - and only when its newest copy, by the moment in its name, is more than
 *   `ORPHANED_COPIES_DAYS` old — rolling or named alike (D-470).
 *
 * A folder with no record — one made before this, until the next copy into it
 * writes one — is swept only when a path this process knows (the shell's recents)
 * hashes to its name and is gone in the same sense. Anything the sweep cannot
 * read, it leaves. And it never throws: it rides on a write, and housekeeping
 * that fails is tried again by the next copy, while a write that fails is lost.
 */

/** How long a gone document's copies are kept after the last one was taken (2026-10-09). */
export const ORPHANED_COPIES_DAYS = 30

const DAY_MS = 86_400_000

/** The file in each document's folder that names its document's absolute path. Not a copy, and not an `.emd`. */
export const BACKUP_RECORD_NAME = 'document-path.txt'

/** What `documentBackupFolderName` makes: a stem, a dash, eight hex digits. */
const BACKUP_FOLDER_PATTERN = /^.+-[0-9a-f]{8}$/

const ANY_ROLLING_COPY = new RegExp(`\\.(${STAMP.source})\\${ROLLING_COPY_SUFFIX}$`)

/** The moment of a rolling copy of any document, from its name; `undefined` when it is not one. */
export function anyRollingCopyMoment(candidate: string): number | undefined {
  const found = ANY_ROLLING_COPY.exec(candidate)
  return found?.[1] === undefined ? undefined : readStamp(found[1])?.at
}

/** What a sweep and a record need from `node:fs/promises` and `node:path` — handed in, so this file stays pure. */
export interface BackupFileSystem {
  readdir(path: string): Promise<string[]>
  /** Never follows a link: a link is reported as one. */
  lstat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean; size: number }>
  stat(path: string): Promise<unknown>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, text: string, options: { flag: 'wx' }): Promise<void>
  rm(path: string, options: { recursive: true; force: false }): Promise<void>
  join(...parts: string[]): string
  /** The root of a path — `F:\` or `/` — which says whether its drive is there at all. */
  rootOf(path: string): string
}

/**
 * Write the folder's record unless it has one: the first copy into a new folder,
 * and the next copy into a folder made before records existed. Never throws —
 * a folder without a record is only one the sweep leaves alone.
 */
export async function recordBackupFolder(fs: BackupFileSystem, folder: string, resolvedPath: string): Promise<void> {
  await fs.writeFile(fs.join(folder, BACKUP_RECORD_NAME), `${resolvedPath}\n`, { flag: 'wx' }).catch(() => undefined)
}

type Presence = 'present' | 'absent' | 'unknown'

/** Whether a document is at `path`: `absent` only when its drive answers and the file does not. */
async function presence(fs: BackupFileSystem, path: string): Promise<Presence> {
  try {
    await fs.stat(path)
    return 'present'
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') return 'unknown'
  }
  try {
    await fs.stat(fs.rootOf(path))
    return 'absent'
  } catch {
    return 'unknown'
  }
}

export interface BackupSweep {
  readonly root: string
  /** The folder a copy was just taken into, which is never swept. */
  readonly keep: string
  /** Now, in milliseconds — the tests' clock. */
  readonly now: number
  readonly platform: string
  /** Paths this process knows — the shell's recents — which name a folder that has no record. */
  readonly known?: readonly string[]
}

/** Sweep the root's folders of gone documents; the names removed. Never throws. */
export async function sweepBackupFolders(fs: BackupFileSystem, sweep: BackupSweep): Promise<readonly string[]> {
  let names: readonly string[]
  try {
    names = await fs.readdir(sweep.root)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    if (name === sweep.keep || !BACKUP_FOLDER_PATTERN.test(name)) continue
    const folder = fs.join(sweep.root, name)
    try {
      if (!(await isGoneDocumentsFolder(fs, folder, name, sweep))) continue
      await fs.rm(folder, { recursive: true, force: false })
      removed.push(name)
    } catch {
      // Left for the next copy to try again.
    }
  }
  return removed
}

async function isGoneDocumentsFolder(
  fs: BackupFileSystem,
  folder: string,
  name: string,
  sweep: BackupSweep,
): Promise<boolean> {
  const self = await fs.lstat(folder)
  if (self.isSymbolicLink() || !self.isDirectory()) return false

  const inside = await fs.readdir(folder)
  // A named copy counts as a copy (M48 U4, D-470): a folder of only named
  // copies goes 30 days after the newest, like any other.
  const moments = inside
    .map((each) => anyRollingCopyMoment(each) ?? anyNamedCopyMoment(each))
    .filter((at): at is number => at !== undefined)
  if (moments.length === 0) return false
  if (sweep.now - Math.max(...moments) <= ORPHANED_COPIES_DAYS * DAY_MS) return false

  let documentPath: string | undefined
  if (inside.includes(BACKUP_RECORD_NAME)) {
    const record = fs.join(folder, BACKUP_RECORD_NAME)
    const kind = await fs.lstat(record)
    if (kind.isSymbolicLink() || !kind.isFile() || kind.size > 4096) return false
    const text = (await fs.readFile(record, 'utf8')).replace(/\r?\n$/, '')
    // A record that does not hash back to its own folder is not one this code wrote.
    if (text === '' || /[\r\n]/.test(text) || documentBackupFolderName(text, sweep.platform) !== name) return false
    documentPath = text
  } else {
    documentPath = sweep.known?.find((path) => documentBackupFolderName(path, sweep.platform) === name)
  }
  return documentPath !== undefined && (await presence(fs, documentPath)) === 'absent'
}

/** The whole folder, as Help › About shows it: where, how large, and for how many documents. */
export interface BackupsFolder {
  readonly path: string
  readonly bytes: number
  readonly documents: number
}

/** Add up the root's document folders, one level down, following no link. An absent root is empty. */
export async function measureBackupsFolder(fs: BackupFileSystem, root: string): Promise<BackupsFolder> {
  let bytes = 0
  let documents = 0
  let names: readonly string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return { path: root, bytes, documents }
  }
  for (const name of names) {
    const folder = fs.join(root, name)
    try {
      const kind = await fs.lstat(folder)
      if (kind.isSymbolicLink() || !kind.isDirectory()) continue
      documents += 1
      for (const each of await fs.readdir(folder)) {
        const file = await fs.lstat(fs.join(folder, each))
        if (file.isFile()) bytes += file.size
      }
    } catch {
      // Gone while we looked; it is not there to count.
    }
  }
  return { path: root, bytes, documents }
}
