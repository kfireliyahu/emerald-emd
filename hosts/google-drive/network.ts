/**
 * **The endpoint makes no request but to Google's APIs** (M57 U4, D-560).
 *
 * Every request the connector sends goes through the `fetch` this file guards:
 * Drive, Google's sign-in token exchange, Firestore, and Cloud Run's metadata
 * server for Firestore's credentials. The bundle's entry installs it as the
 * process's `fetch` too (`main.ts`), so code that reaches for the global one
 * is held to the same list. A request anywhere else throws before it is sent.
 *
 * A local run adds one host of its own — the Firestore emulator — and nothing
 * else; `endpoint.test.ts` runs a whole sign-in and calls through this guard.
 */

import type { Fetch } from './drive.ts'

/** Google's hosts the endpoint may send to, each with the scheme it is reached by. */
export const GOOGLE_HOSTS: ReadonlyMap<string, 'https:' | 'http:'> = new Map([
  // Drive's API and its uploads.
  ['www.googleapis.com', 'https:'],
  // The sign-in: a code traded for a token, and a token refreshed.
  ['oauth2.googleapis.com', 'https:'],
  // The five fields (D-562).
  ['firestore.googleapis.com', 'https:'],
  // Cloud Run's own metadata server, inside Google's network: Firestore's credentials.
  ['metadata.google.internal', 'http:'],
])

/** Whether the endpoint may send to `url`, given any local hosts this run adds. */
export function sendsTo(url: string, local: readonly string[] = []): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (local.includes(parsed.host) && parsed.protocol === 'http:') return true
  return GOOGLE_HOSTS.get(parsed.hostname) === parsed.protocol && parsed.port === ''
}

/** `send`, refusing anything but Google's APIs (and the local hosts named). */
export function googleOnly(send: Fetch, local: readonly string[] = []): Fetch {
  return (url, init) => {
    if (!sendsTo(url, local)) {
      return Promise.reject(new Error(`The Google Drive connector sends to Google's APIs alone; refused ${String(URL.parse(url)?.host)}.`))
    }
    return send(url, init)
  }
}
