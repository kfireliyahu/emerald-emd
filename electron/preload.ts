/**
 * The only path between the page and the process that hosts it.
 *
 * `contextIsolation` is on and `sandbox` is on, so this file runs in its own
 * world and the page gets exactly what is handed to it here — a frozen object,
 * no `ipcRenderer`, no `require`, no Node. Every capability the shell gives the
 * renderer is a named function on `EmeraldBridge` implemented behind a channel
 * in `main.ts`; nothing is exposed by being reachable.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'

import {
  APP_CHANNELS,
  BRIDGE_KEY,
  DOCUMENT_CHANNELS,
  FILE_CHANNELS,
  RUNTIME_CHANNELS,
  UPDATE_CHANNELS,
  WINDOW_CHANNELS,
  versionFromArguments,
  type AboutFacts,
  type DocumentFile,
  type EmeraldApp,
  type DocumentMarkReading,
  type EarlierCopy,
  type EmeraldBridge,
  type EmeraldFiles,
  type EmeraldRuntimes,
  type EmeraldUpdates,
  type EmeraldWindow,
  type GenerateRequest,
  type GenerateResult,
  type RecentDocument,
  type RuntimeProbe,
  type ShellCommand,
  type UpdateState,
} from './bridge.ts'
import { windowChrome } from './windowChrome.ts'

const documents = Object.freeze({
  open: (): Promise<DocumentFile | undefined> => ipcRenderer.invoke(DOCUMENT_CHANNELS.open),

  read: (path: string): Promise<DocumentFile> => ipcRenderer.invoke(DOCUMENT_CHANNELS.read, path),

  chooseSavePath: (suggestedName: string): Promise<string | undefined> =>
    ipcRenderer.invoke(DOCUMENT_CHANNELS.chooseSavePath, suggestedName),

  write: (path: string, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke(DOCUMENT_CHANNELS.write, path, bytes),

  backup: (path: string, bytes: Uint8Array, label: string): Promise<string | undefined> =>
    ipcRenderer.invoke(DOCUMENT_CHANNELS.backup, path, bytes, label),

  mark: (path: string): Promise<DocumentMarkReading> =>
    ipcRenderer.invoke(DOCUMENT_CHANNELS.mark, path),

  earlierCopies: (path: string): Promise<readonly EarlierCopy[]> =>
    ipcRenderer.invoke(DOCUMENT_CHANNELS.earlierCopies, path),

  restoreEarlierCopy: (path: string, copy: string): Promise<string> =>
    ipcRenderer.invoke(DOCUMENT_CHANNELS.restoreEarlierCopy, path, copy),

  watch: (path: string | undefined): Promise<void> =>
    ipcRenderer.invoke(DOCUMENT_CHANNELS.watch, path),

  recents: (): Promise<readonly RecentDocument[]> =>
    ipcRenderer.invoke(DOCUMENT_CHANNELS.recents),

  clearRecents: (): Promise<void> => ipcRenderer.invoke(DOCUMENT_CHANNELS.clearRecents),

  ready: (): void => {
    ipcRenderer.send(DOCUMENT_CHANNELS.ready)
  },

  setUnsaved: (unsaved: boolean): void => {
    ipcRenderer.send(DOCUMENT_CHANNELS.unsaved, unsaved)
  },

  closeWindow: (): void => {
    ipcRenderer.send(DOCUMENT_CHANNELS.closeWindow)
  },

  /**
   * The listener the page hands over is called with no `IpcRendererEvent` —
   * that object carries `sender` and `ports`, which is a way back across the
   * isolation boundary that nothing here needs.
   */
  onChanged: (listener: () => void): (() => void) => {
    const forward = (): void => listener()
    ipcRenderer.on(DOCUMENT_CHANNELS.changed, forward)
    return () => {
      ipcRenderer.off(DOCUMENT_CHANNELS.changed, forward)
    }
  },

  onCommand: (listener: (command: ShellCommand) => void): (() => void) => {
    const forward = (_event: unknown, command: ShellCommand): void => listener(command)
    ipcRenderer.on(DOCUMENT_CHANNELS.command, forward)
    return () => {
      ipcRenderer.off(DOCUMENT_CHANNELS.command, forward)
    }
  },
})

/**
 * The frame, computed here rather than fetched.
 *
 * `windowChrome` is the same pure function `main.ts` built the window from, and
 * the preload bundle inlines its own copy — the two passes in `vite.config.ts`
 * exist precisely so neither process has to `require` a shared chunk (D-126).
 * A round trip for four numbers that cannot change while the window lives would
 * also mean the first paint happens before the bar knows how tall it is.
 */
const emeraldWindow: EmeraldWindow = Object.freeze({
  chrome: Object.freeze(windowChrome(process.platform)),

  setTheme: (theme: 'light' | 'dark'): void => {
    ipcRenderer.send(WINDOW_CHANNELS.theme, theme)
  },
})

/**
 * The local model runtime (M10), which the page may ask about and may not
 * reach.
 *
 * One function, and it is a question rather than a subscription: the page's
 * session cancels every request to `localhost` (D-124) and that is not being
 * loosened, so the socket lives in the main process behind
 * `electron/runtimes.ts` and its loopback guard. Nothing here is called at
 * launch — off by default is the rule, and a probe is a socket.
 */
const runtimes: EmeraldRuntimes = Object.freeze({
  detect: (): Promise<readonly RuntimeProbe[]> => ipcRenderer.invoke(RUNTIME_CHANNELS.detect),

  generate: (request: GenerateRequest): Promise<GenerateResult> =>
    ipcRenderer.invoke(RUNTIME_CHANNELS.generate, request),

  cancel: (): void => {
    ipcRenderer.send(RUNTIME_CHANNELS.cancel)
  },

  onProgress: (listener: (tokens: number) => void): (() => void) => {
    const forward = (_event: unknown, tokens: number): void => listener(tokens)
    ipcRenderer.on(RUNTIME_CHANNELS.progress, forward)
    return () => {
      ipcRenderer.off(RUNTIME_CHANNELS.progress, forward)
    }
  },
})

/** Help › About (M45 F3, D-457): two questions, and the folder is the main process's to name; and Help's openers (M46 U1). */
const emeraldApp: EmeraldApp = Object.freeze({
  about: (): Promise<AboutFacts> => ipcRenderer.invoke(APP_CHANNELS.about),
  openBackupsFolder: (): Promise<void> => ipcRenderer.invoke(APP_CHANNELS.openBackupsFolder),
  // Help's other three, for the palette (M46 U1): the main process opens them, the page names nothing.
  openText: (text: 'license' | 'notices'): Promise<void> => ipcRenderer.invoke(APP_CHANNELS.openText, text),
  openSource: (): Promise<void> => ipcRenderer.invoke(APP_CHANNELS.openSource),
})

// A `file` cell's questions (M37 U6). `pathOf` is the one answered here: a
// dropped file's path is the preload's to read (`webUtils`), never the page's.
const files: EmeraldFiles = Object.freeze({
  choose: (): Promise<string | undefined> => ipcRenderer.invoke(FILE_CHANNELS.choose),
  pathOf: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  present: (paths: readonly string[]): Promise<readonly boolean[]> => ipcRenderer.invoke(FILE_CHANNELS.present, paths),
  open: (target: string): Promise<string | undefined> => ipcRenderer.invoke(FILE_CHANNELS.open, target),
  show: (path: string): Promise<string | undefined> => ipcRenderer.invoke(FILE_CHANNELS.show, path),
})

// Updates (M42 U8, D-502): the main process asks and decides; the page holds the switch and the notice.
const updates: EmeraldUpdates = Object.freeze({
  state: (): Promise<UpdateState> => ipcRenderer.invoke(UPDATE_CHANNELS.state),
  setAutomatic: (on: boolean): Promise<UpdateState> => ipcRenderer.invoke(UPDATE_CHANNELS.setAutomatic, on),
  checkNow: (): Promise<UpdateState> => ipcRenderer.invoke(UPDATE_CHANNELS.checkNow),
  later: (): Promise<UpdateState> => ipcRenderer.invoke(UPDATE_CHANNELS.later),
  openReleasePage: (): Promise<void> => ipcRenderer.invoke(UPDATE_CHANNELS.openReleasePage),
  onChange: (listener: (state: UpdateState) => void): (() => void) => {
    const forward = (_event: unknown, state: UpdateState): void => listener(state)
    ipcRenderer.on(UPDATE_CHANNELS.changed, forward)
    return () => {
      ipcRenderer.off(UPDATE_CHANNELS.changed, forward)
    }
  },
})

const bridge: EmeraldBridge = Object.freeze({
  version: versionFromArguments(process.argv),
  platform: process.platform,
  documents,
  window: emeraldWindow,
  runtimes,
  app: emeraldApp,
  files,
  updates,
})

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge)
