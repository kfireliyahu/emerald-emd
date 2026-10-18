/**
 * "No network calls. None, and there is no longer an exception" (D-124),
 * enforced in code rather than by review.
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
