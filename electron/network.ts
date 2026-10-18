/**
 * "No network calls. None, and there is no longer an exception" (D-124),
 * enforced in code rather than by review — **with one exception since M42 U8
 * (D-502): the update check, in a session of its own, to one address, while a
 * check is asking — and since M42 U9 (D-503) Windows' download, in
 * electron-updater's session, to one release's two files, while it downloads.**
 * The page's session below is unchanged and never reaches either.
 *
 * The rule has held so far because a browser tab full of code that never wrote
 * a `fetch` cannot make a request by accident. A shell is a new place for one
 * to appear — a dependency that phones home, an update check somebody adds
 * because desktop apps have them, a stray `<img src="https://…">` in a future
 * screen. This predicate is the answer: the session cancels anything it does
 * not recognise, so a request that should not exist fails loudly in
 * development instead of quietly succeeding in someone's house.
 *
 * Pure and string-in, boolean-out, so the list of what is allowed is a test
 * rather than a comment.
 */

import { APP_ORIGIN } from './appProtocol.ts'
import { RELEASE_DOWNLOADS, RELEASES_LATEST, releaseFeed, WINDOWS_INSTALLER } from './updates.ts'

/**
 * `devOrigin` is the Vite dev server, and only in the dev loop: the shell is
 * started by `scripts/dev-desktop.mjs`, which is the only thing that sets it.
 * A packaged app passes `undefined` and cannot reach any origin over HTTP at
 * all — including `localhost`, which the local model runtime (M10) will have
 * to open here deliberately and narrowly when it arrives.
 */
export function isAllowedRequest(url: string, devOrigin?: string | undefined): boolean {
  // Bytes the page already holds. A blob URL is how the download adapter
  // hands the user their document, so cancelling these would break Save.
  if (url.startsWith('data:') || url.startsWith('blob:')) return true

  // The DevTools front end serves itself.
  if (url.startsWith('devtools://')) return true

  if (url === APP_ORIGIN || url.startsWith(`${APP_ORIGIN}/`)) return true

  if (devOrigin !== undefined && devOrigin !== '') {
    if (url === devOrigin || url.startsWith(`${devOrigin}/`)) return true
    // Hot module replacement speaks over a WebSocket to the same authority.
    const socketOrigin = devOrigin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    if (url === socketOrigin || url.startsWith(`${socketOrigin}/`)) return true
  }

  return false
}

/**
 * **The update session's whole list** (M42 U8, D-502): `RELEASES_LATEST`, exactly — no other
 * path on that host, no query, no redirect to another — and only while `open`, which `main.ts`
 * takes from `Updates.gateOpen()`: true while a check is asking, and a check asks only when the
 * setting is on or somebody pressed Check for Updates Now.
 *
 * It is a different session from the page's, not a loosening of `isAllowedRequest`: the page
 * cannot reach this address with the setting on or off, because nothing the page loads runs in the
 * session this guards.
 */
export function isAllowedUpdateRequest(url: string, open: boolean): boolean {
  return open && url === RELEASES_LATEST
}

/** Where GitHub redirects a release download (D-502): its file store, by a signed one-off address. */
export const RELEASE_ASSET_HOSTS: readonly string[] = ['release-assets.githubusercontent.com', 'objects.githubusercontent.com']

/** `latest.yml`, with electron-updater's cache-busting query if it adds one, or the installer. */
const RELEASE_FILE = new RegExp(`^(latest\\.yml(\\?noCache=[0-9a-v]+)?|${WINDOWS_INSTALLER.replace(/[.]/g, '\\.')})$`)

/**
 * **The download's whole list** (M42 U9, D-502), for electron-updater's own session
 * (`electron-updater`, which nothing the page loads runs in either): while `downloading` names a
 * version — the setting is on and that version's download is in flight — exactly
 * `<releases>/download/v<that version>/latest.yml` and `…/Emerald-Setup.exe`, and the hosts GitHub
 * redirects those two to. Any other file, release, repository or host is refused, and with nothing
 * downloading everything is.
 *
 * `base` is `RELEASE_DOWNLOADS`; an unpackaged shell verifying itself against a local feed passes
 * that feed instead (`EMERALD_UPDATE_FEED`), and then no GitHub host is allowed at all.
 */
export function isAllowedDownloadRequest(url: string, downloading: string | undefined, base: string = RELEASE_DOWNLOADS): boolean {
  if (downloading === undefined) return false
  const feed = releaseFeed(downloading, base)
  if (url.startsWith(feed)) return RELEASE_FILE.test(url.slice(feed.length))
  if (base !== RELEASE_DOWNLOADS) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && parsed.port === '' && RELEASE_ASSET_HOSTS.includes(parsed.hostname)
}
