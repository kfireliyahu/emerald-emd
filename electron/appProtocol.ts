/**
 * The scheme the built renderer is served from inside the shell.
 *
 * **Not `file://`, and the reason is the same constraint the whole app is
 * built around** (D-115). A local file gets a unique opaque origin: no
 * IndexedDB, a File System Access API that refuses, and a `localStorage` that
 * is one shared bucket for every HTML file on the machine — which is where the
 * crash snapshot lives. A registered `app://` scheme, declared standard and
 * secure, gives the renderer a real origin and a secure context, and the
 * renderer does not have to change to get either.
 *
 * Both functions here are pure and take the root explicitly, because the
 * containment check below is the only thing standing between a crafted
 * `app://` URL and the rest of the disk, and that is worth a test rather than
 * a review.
 */

import { extname, resolve, sep } from 'node:path'

export const APP_SCHEME = 'app'
const APP_HOST = 'emerald'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/**
 * An `app://` URL → the absolute file to answer it with, or `undefined` when
 * the request has no business being answered at all.
 *
 * There is no single-page fallback to `index.html` for an unknown path, on
 * purpose: routing is hash-based (docs/conventions.md), so every real
 * navigation is `/index.html#/somewhere` and a miss here is a missing asset
 * rather than a route. Answering it with the app's HTML would turn a broken
 * build into a blank window.
 */
export function resolveAppRequest(url: string, root: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  if (parsed.protocol !== `${APP_SCHEME}:`) return undefined
  if (parsed.hostname !== APP_HOST) return undefined

  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    // A malformed percent-escape. Nothing legitimate produces one.
    return undefined
  }

  // A backslash is a path separator on Windows and an ordinary character in a
  // URL, which is exactly the mismatch a traversal attempt lives in. A NUL
  // truncates the name a syscall finally sees.
  if (pathname.includes('\\') || pathname.includes('\0')) return undefined

  const requested = pathname === '' || pathname === '/' ? '/index.html' : pathname

  const rootPath = resolve(root)
  const target = resolve(rootPath, `.${requested}`)

  // `resolve` has already flattened any `..`; this is what makes the flattening
  // matter. Comparing against `rootPath + sep` rather than `rootPath` alone
  // keeps a sibling directory whose name merely starts with the root's out.
  if (target !== rootPath && !target.startsWith(rootPath + sep)) return undefined

  return target
}

/**
 * The renderer is served by us, so nothing sniffs: a stylesheet answered as
 * `application/octet-stream` is simply ignored by the page. The list is what
 * `dist/` actually contains — HTML, one JS bundle, one stylesheet, the mark,
 * and the font files — plus the few neighbours a later build could emit.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  // The license and the third-party notices, which Help opens in a window (M43 U7). Served as
  // anything else they would be a download, which is not reading them.
  '.txt': 'text/plain; charset=utf-8',
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}
