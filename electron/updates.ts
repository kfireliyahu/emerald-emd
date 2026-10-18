/**
 * **Updates, if you turn them on** (M42 U8, D-502): one setting, off by default, a check at start
 * and once a day while it is on, and Help › Check for Updates Now, which works with it off.
 *
 * The rule it changes on the record (D-124 amended): the app makes no network call unless the
 * person turned updates on, and then only one — `RELEASES_LATEST`, GitHub's answer for this
 * repository's newest published release. A press of Check for Updates Now is consent for that one
 * check. On macOS nothing is downloaded and nothing is installed: a newer version is a quiet notice
 * in the window, whose Download opens the release page in the person's own browser.
 *
 * **On Windows, with the setting on** (M42 U9), the same check hands a newer version to a
 * `Downloader` (`windowsUpdater.ts`, electron-updater underneath): it fetches that release's
 * installer in the background, checks it against the sha512 the release published, and the notice
 * says `<version> is ready` only then. Nothing is installed until Install and restart. With the
 * setting off, a press of Check for Updates Now still only says so — a download is the setting's.
 *
 * **Why the release API and not `latest.yml`.** One request answers both platforms, from the host
 * that answers it (`api.github.com`, no redirect to a second host), and it exists today: the
 * `latest.yml` an updater reads is published only once U9's build ships it, and macOS would read a
 * second file. `releases/latest` skips drafts and pre-releases by itself.
 *
 * Pure apart from the clock and the two functions handed in, so the schedule and every answer
 * are a test (`updates.test.ts`); `main.ts` wires it to the session, the file and the window.
 */

import type { UpdateState, UpdateNotice } from './bridge.ts'
import { SOURCE_URL } from './about.ts'

/** `https://github.com/owner/name` → `owner/name`. */
function repositorySlug(source: string): string {
  const { hostname, pathname } = new URL(source)
  const parts = pathname.split('/').filter((part) => part !== '')
  if (hostname !== 'github.com' || parts.length !== 2) {
    throw new Error(`The source is not a GitHub repository: ${source}`)
  }
  return parts.join('/')
}

/** The one address a check asks, and the only one `network.ts` lets the update session reach. */
export const RELEASES_LATEST = `https://api.github.com/repos/${repositorySlug(SOURCE_URL)}/releases/latest`

/**
 * What Download opens in the person's browser: the newest release's page, a constant, never an
 * address the answer named. The installers there have no version in their names (M42 U9), so the
 * page is always one click from the right file.
 */
export const RELEASES_PAGE = `${SOURCE_URL}/releases/latest`

/**
 * Where a release's files are (M42 U9, D-502): `<this>v<version>/latest.yml` and the installer it
 * names. The version is the one the check just read, so the download is of the release the check
 * found — never `releases/latest/download/`, which could be a newer one by the time it is asked.
 */
export const RELEASE_DOWNLOADS = `${SOURCE_URL}/releases/download/`

/** The Windows installer's one name, every release (electron-builder.yml, M42 U9). */
export const WINDOWS_INSTALLER = 'Emerald-Setup.exe'

/** The folder electron-updater reads `latest.yml` from, for one version. */
export function releaseFeed(version: string, base: string = RELEASE_DOWNLOADS): string {
  return `${base}v${version}/`
}

/** A day, and how often the schedule asks whether one has passed — so a laptop that slept still checks. */
export const DAY_MS = 24 * 60 * 60 * 1000
export const TICK_MS = 60 * 60 * 1000

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

/** `v0.1.3` or `0.1.3` → `[0, 1, 3]`; anything else is not a version this app ever publishes. */
function parts(version: string): readonly [number, number, number] | undefined {
  const match = VERSION.exec(version.trim())
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Whether `candidate` is a later release than `current`. An unreadable one never is. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate)
  const b = parts(current)
  if (a === undefined || b === undefined) return false
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! > b[index]!
  }
  return false
}

/**
 * The newest version, out of GitHub's answer — its `tag_name`, without the `v`. Anything else in
 * the answer is ignored: no address, no text and no file from it reaches the window or the browser.
 */
export function latestVersionFrom(answer: unknown): string {
  const tag = typeof answer === 'object' && answer !== null ? (answer as { tag_name?: unknown }).tag_name : undefined
  const version = typeof tag === 'string' ? parts(tag) : undefined
  if (version === undefined) throw new Error('GitHub answered with no version this app can read.')
  return version.join('.')
}

/**
 * The setting, as `settings.json` in the app's own folder holds it. Anything but `true` is off:
 * a missing file, a hand-edited one, an older app's.
 */
export function automaticFrom(text: string | undefined): boolean {
  if (text === undefined) return false
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && (parsed as { automaticUpdates?: unknown }).automaticUpdates === true
  } catch {
    return false
  }
}

export function settingsText(automatic: boolean): string {
  return `${JSON.stringify({ automaticUpdates: automatic }, null, 2)}\n`
}

/**
 * The document to open again after Install and restart (M42 U9): written just before the installer
 * runs, read and removed at the next start. Anything unreadable is nothing to reopen.
 */
export function reopenText(path: string): string {
  return `${JSON.stringify({ reopen: path })}\n`
}

export function reopenFrom(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    const path = typeof parsed === 'object' && parsed !== null ? (parsed as { reopen?: unknown }).reopen : undefined
    return typeof path === 'string' && path !== '' ? path : undefined
  } catch {
    return undefined
  }
}

/** What a failed download says. A checksum that did not match is said plainly, not as two hashes. */
export function downloadFailure(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'ERR_CHECKSUM_MISMATCH' || /checksum mismatch/i.test(message)) {
    return 'The download did not match the checksum published with it, so it was not kept.'
  }
  return message
}

/**
 * **Windows' half** (M42 U9): what `windowsUpdater.ts` does with electron-updater, as the schedule
 * sees it. Present only where the app can install its own update — Windows, packaged.
 */
export interface Downloader {
  /**
   * Fetch `version`'s installer into the updater's cache and check it against the sha512 in that
   * release's `latest.yml`. Rejects on anything else: another version named, a mismatch, a refusal.
   */
  download(version: string): Promise<void>
  /** Stop a download in flight: the setting was turned off. */
  cancel(): void
  /** Run the downloaded installer, per-user and silent, and start Emerald again after it. */
  install(): void
}

export interface UpdatesDeps {
  /** `app.getVersion()`. */
  readonly version: string
  readonly automatic: boolean
  /** Ask `RELEASES_LATEST` and hand back the parsed answer. Called only while the gate is open. */
  fetchLatest(): Promise<unknown>
  /** Keep the setting. A failure is the caller's to note; the setting still changes for this run. */
  saveAutomatic(on: boolean): Promise<void>
  /** Every change, for the window. */
  publish(state: UpdateState): void
  now(): number
  /** Windows, packaged (M42 U9). Absent, a newer version is only ever said. */
  readonly downloader?: Downloader | undefined
}

export interface Updates {
  state(): UpdateState
  /** Whether the update session may reach `RELEASES_LATEST` right now. */
  gateOpen(): boolean
  setAutomatic(on: boolean): Promise<UpdateState>
  /** Help › Check for Updates Now: works with the setting off, and always answers in the notice. */
  checkNow(): Promise<UpdateState>
  /** At start, and every `TICK_MS` after: checks only when on and a day has passed. */
  tick(): Promise<void>
  /** Later, or Dismiss: the notice goes until the next start or the next day's check. */
  later(): UpdateState
  /** The version whose installer is downloading now, if one is: the download's gate (`network.ts`). */
  downloading(): string | undefined
  /** The version downloaded, checked and waiting for Install and restart, if one is. */
  ready(): string | undefined
  /** Install and restart, once the window has closed: false, and nothing run, unless one is ready. */
  install(): boolean
}

export function createUpdates(deps: UpdatesDeps): Updates {
  let automatic = deps.automatic
  let notice: UpdateNotice | undefined
  let checking = false
  /** When the last scheduled or pressed check finished; `undefined` at start, so the first tick checks. */
  let lastChecked: number | undefined
  /** The download in flight, by version (M42 U9); cleared when it ends or is cancelled. */
  let fetching: string | undefined
  /** Downloaded and checked, waiting for the person. */
  let ready: string | undefined
  const downloader = deps.downloader

  const state = (): UpdateState => ({ automatic, version: deps.version, downloads: downloader !== undefined, notice })

  function show(next: UpdateNotice | undefined): UpdateState {
    notice = next
    const current = state()
    deps.publish(current)
    return current
  }

  /**
   * One check. `pressed` is a person asking: they hear back whatever the answer, and a failure is
   * said. A scheduled check speaks only when there is something newer, and fails silently — a day
   * without GitHub is not news, and the next day's check tries again.
   */
  async function check(pressed: boolean): Promise<UpdateState> {
    if (checking) return state()
    checking = true
    if (pressed) show({ kind: 'checking' })
    try {
      const latest = latestVersionFrom(await deps.fetchLatest())
      lastChecked = deps.now()
      if (isNewer(latest, deps.version)) return offer(latest, pressed)
      return pressed ? show({ kind: 'latest', version: deps.version }) : state()
    } catch (error) {
      lastChecked = deps.now()
      const reason = error instanceof Error ? error.message : String(error)
      return pressed ? show({ kind: 'failed', reason }) : state()
    } finally {
      checking = false
    }
  }

  /**
   * A newer version. Said at once where nothing downloads, or with the setting off; otherwise said
   * when it is ready — or, after a press, that it is on its way. One download at a time.
   */
  function offer(latest: string, pressed: boolean): UpdateState {
    if (downloader === undefined || !automatic) return show({ kind: 'available', version: latest })
    if (ready === latest) return show({ kind: 'ready', version: latest })
    if (fetching !== latest) void fetch(downloader, latest)
    return pressed ? show({ kind: 'downloading', version: latest }) : state()
  }

  /**
   * The background download. A failure is never silent, because there *is* a newer version: it
   * falls back to the notice macOS shows, whose Download opens the release page, with the reason.
   * A download cancelled or overtaken by a newer one says nothing.
   */
  async function fetch(using: Downloader, latest: string): Promise<void> {
    fetching = latest
    ready = undefined
    try {
      await using.download(latest)
      if (fetching !== latest) return
      ready = latest
      show({ kind: 'ready', version: latest })
    } catch (error) {
      if (fetching !== latest) return
      show({ kind: 'available', version: latest, unfetched: downloadFailure(error) })
    } finally {
      if (fetching === latest) fetching = undefined
    }
  }

  async function tick(): Promise<void> {
    if (!automatic) return
    if (lastChecked !== undefined && deps.now() - lastChecked < DAY_MS) return
    await check(false)
  }

  return {
    state,
    // Open only while a check is asking: a scheduled one runs only while the setting is on, and a
    // pressed one only because somebody pressed it.
    gateOpen: () => checking,
    async setAutomatic(on) {
      automatic = on
      await deps.saveAutomatic(on)
      // Turned on, it checks now rather than tomorrow; turned off, the next tick asks nothing, and
      // a download in flight stops (one already made stays installable on a press).
      if (on) {
        lastChecked = undefined
        void tick()
      } else if (fetching !== undefined) {
        const version = fetching
        fetching = undefined
        downloader?.cancel()
        if (notice?.kind === 'downloading') return show({ kind: 'available', version })
      }
      return show(notice)
    },
    checkNow: () => check(true),
    tick,
    later: () => show(undefined),
    downloading: () => fetching,
    ready: () => ready,
    install() {
      if (ready === undefined || downloader === undefined) return false
      downloader.install()
      return true
    },
  }
}
