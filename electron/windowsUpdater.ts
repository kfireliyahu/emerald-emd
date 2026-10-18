/**
 * **Windows' download and Install and restart** (M42 U9, D-503): electron-updater, electron-builder's
 * own, held to what `updates.ts` asks of a `Downloader` and nothing more.
 *
 * - **It never checks on its own.** M42 U8's check (the release API) decides there is a newer
 *   version; this is handed that version and reads *that* release's `latest.yml` — a generic feed at
 *   `releases/download/v<version>/`, so the file it fetches is the release the check found, not
 *   whatever is newest a second later. `latest.yml` naming another version is a refusal.
 * - **It downloads only when asked**, never installs on quit (`autoDownload` and
 *   `autoInstallOnAppQuit` off), and installs on Install and restart: the installer per-user (the
 *   NSIS target is `perMachine: false`) and silent (`/S`), starting Emerald again after (`--force-run`).
 * - **The guarantee is the checksum.** electron-updater checks the file against the sha512 in
 *   `latest.yml` and deletes it on a mismatch. It would also check the installer's code signature
 *   against a publisher name, but the installers are unsigned (D-124) and `app-update.yml` names no
 *   publisher, so that check is skipped: what stands behind the file is that `latest.yml` and the
 *   installer came from this repository's own release, built and attested by its workflow (D-452) —
 *   the GitHub account is the real guard, as it is for anybody downloading from the page.
 * - **Differential download is off**: every update fetches the whole installer, one request to one
 *   file. The blockmap is published beside it, so turning it on later is a decision, not a rebuild.
 * - **Nothing identifying is sent**: no staging id (electron-updater would otherwise make one and send
 *   it as `x-user-staging-id`), `User-Agent: Emerald/<version>`, and `main.ts` holds its session to
 *   `isAllowedDownloadRequest` and strips the header again there.
 */

import { CancellationToken, NsisUpdater } from 'electron-updater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'

import type { Downloader } from './updates.ts'
import { releaseFeed, RELEASE_DOWNLOADS } from './updates.ts'

/** The session electron-updater asks from, by its own name — `main.ts` guards it. */
export const UPDATER_PARTITION = 'electron-updater'

/**
 * electron-updater without its staging id: it is for rolling a release out to a share of installs,
 * which this app never does, and making one writes an id to the app's folder that is then sent with
 * every request.
 */
export class QuietNsisUpdater extends NsisUpdater {
  protected override readonly stagingUserIdPromise = { value: Promise.resolve('') } as unknown as NsisUpdater['stagingUserIdPromise']

  constructor(app?: AppAdapter) {
    super(null, app)
  }
}

export interface WindowsDownloaderOptions {
  /** `app.getVersion()`, for the one header that names anything. */
  readonly version: string
  /** `RELEASE_DOWNLOADS`, or a local feed an unpackaged shell verifies against. */
  readonly base?: string
}

/**
 * The `Downloader` over an updater. Construct the updater (`QuietNsisUpdater`) where the app is, and
 * hand it here; the tests hand one whose requests reach a local feed.
 */
export function createWindowsDownloader(updater: NsisUpdater, options: WindowsDownloaderOptions): Downloader {
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.autoRunAppAfterInstall = true
  updater.allowDowngrade = false
  updater.allowPrerelease = false
  updater.disableDifferentialDownload = true
  updater.disableWebInstaller = true
  updater.requestHeaders = { 'User-Agent': `Emerald/${options.version}` }
  updater.logger = { info: () => undefined, warn: (message: unknown) => console.warn(`[emerald] updater: ${String(message)}`), error: (message: unknown) => console.warn(`[emerald] updater: ${String(message)}`) }

  const base = options.base ?? RELEASE_DOWNLOADS
  let cancellation: CancellationToken | undefined

  return {
    async download(version) {
      updater.setFeedURL({ provider: 'generic', url: releaseFeed(version, base) })
      const found = await updater.checkForUpdates()
      if (found === null) throw new Error('This copy of Emerald cannot update itself.')
      if (found.updateInfo.version !== version) {
        throw new Error(`The release for ${version} describes ${found.updateInfo.version}.`)
      }
      if (found.isUpdateAvailable !== true) throw new Error(`${version} is not newer than this copy.`)
      cancellation = new CancellationToken()
      try {
        await updater.downloadUpdate(cancellation)
      } finally {
        cancellation = undefined
      }
    },
    cancel() {
      cancellation?.cancel()
    },
    install() {
      updater.quitAndInstall(true, true)
    },
  }
}
