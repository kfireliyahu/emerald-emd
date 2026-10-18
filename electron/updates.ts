/**
 * **Updates, if you turn them on** (M42 U8, D-502): one setting, off by default, a check at start
 * and once a day while it is on, and Help › Check for Updates Now, which works with it off.
 *
 * The rule it changes on the record (D-124 amended): the app makes no network call unless the
 * person turned updates on, and then only one — `RELEASES_LATEST`, GitHub's answer for this
 * repository's newest published release. A press of Check for Updates Now is consent for that one
 * check. Nothing is downloaded and nothing is installed here: a newer version is a quiet notice in
 * the window, whose Download opens the release page in the person's own browser. Windows' download
 * and Install and restart are M42 U9's.
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
}

export function createUpdates(deps: UpdatesDeps): Updates {
  let automatic = deps.automatic
  let notice: UpdateNotice | undefined
  let checking = false
  /** When the last scheduled or pressed check finished; `undefined` at start, so the first tick checks. */
  let lastChecked: number | undefined

  const state = (): UpdateState => ({ automatic, version: deps.version, notice })

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
      if (isNewer(latest, deps.version)) return show({ kind: 'available', version: latest })
      return pressed ? show({ kind: 'latest', version: deps.version }) : state()
    } catch (error) {
      lastChecked = deps.now()
      const reason = error instanceof Error ? error.message : String(error)
      return pressed ? show({ kind: 'failed', reason }) : state()
    } finally {
      checking = false
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
      // Turned on, it checks now rather than tomorrow; turned off, the next tick asks nothing.
      if (on) {
        lastChecked = undefined
        void tick()
      }
      return show(notice)
    },
    checkNow: () => check(true),
    tick,
    later: () => show(undefined),
  }
}
