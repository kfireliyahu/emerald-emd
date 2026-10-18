import { describe, expect, it } from 'vitest'
import { join, resolve, sep } from 'node:path'

import { APP_ORIGIN, contentTypeFor, resolveAppRequest } from './appProtocol.ts'

const ROOT = resolve('/srv/emerald/dist')

describe('resolveAppRequest', () => {
  it('serves index.html for the origin root', () => {
    expect(resolveAppRequest(`${APP_ORIGIN}/`, ROOT)).toBe(join(ROOT, 'index.html'))
  })

  it('serves an asset by path', () => {
    expect(resolveAppRequest(`${APP_ORIGIN}/assets/index-BgP5JK9G.js`, ROOT)).toBe(
      join(ROOT, 'assets', 'index-BgP5JK9G.js'),
    )
  })

  it('ignores the query and the hash, which is where every route lives', () => {
    expect(resolveAppRequest(`${APP_ORIGIN}/index.html#/transactions?v=2`, ROOT)).toBe(
      join(ROOT, 'index.html'),
    )
  })

  it('decodes a percent-escaped name', () => {
    expect(resolveAppRequest(`${APP_ORIGIN}/assets/a%20b.css`, ROOT)).toBe(
      join(ROOT, 'assets', 'a b.css'),
    )
  })

  it('flattens a plain climb rather than following it', () => {
    // The URL parser has already collapsed the dot segments by the time this
    // function sees them — `app://` is declared standard, so its path is a
    // list of segments and not an opaque string. The result is a miss inside
    // the root, which is a 404 and not a read.
    expect(resolveAppRequest(`${APP_ORIGIN}/../../etc/passwd`, ROOT)).toBe(join(ROOT, 'etc', 'passwd'))
    expect(resolveAppRequest(`${APP_ORIGIN}/assets/../../../secrets.emd`, ROOT)).toBe(
      join(ROOT, 'secrets.emd'),
    )
  })

  it('refuses a climb that survived the URL parser as an escape', () => {
    // `%2f` is not a separator to the parser, so nothing collapses and the
    // decoded path really does leave the root. This is the case the
    // containment check exists for.
    expect(resolveAppRequest(`${APP_ORIGIN}/..%2f..%2fpasswd`, ROOT)).toBeUndefined()
    expect(resolveAppRequest(`${APP_ORIGIN}/assets/..%2f..%2f..%2fsecrets.emd`, ROOT)).toBeUndefined()
  })

  it('refuses a backslash, which is a separator here and not in a URL', () => {
    expect(resolveAppRequest(`${APP_ORIGIN}/assets%5C..%5C..%5Csecrets`, ROOT)).toBeUndefined()
  })

  it('refuses a NUL, which truncates the name a syscall finally sees', () => {
    expect(resolveAppRequest(`${APP_ORIGIN}/index.html%00.png`, ROOT)).toBeUndefined()
  })

  it('refuses a malformed escape rather than guessing at it', () => {
    expect(resolveAppRequest(`${APP_ORIGIN}/assets/%zz`, ROOT)).toBeUndefined()
  })

  it('refuses another scheme and another host', () => {
    expect(resolveAppRequest('file:///srv/emerald/dist/index.html', ROOT)).toBeUndefined()
    expect(resolveAppRequest('https://emerald/index.html', ROOT)).toBeUndefined()
    expect(resolveAppRequest('app://elsewhere/index.html', ROOT)).toBeUndefined()
  })

  it('refuses something that is not a URL at all', () => {
    expect(resolveAppRequest('index.html', ROOT)).toBeUndefined()
  })

  it('does not let a sibling directory pass for the root', () => {
    // `…/dist-plugin` starts with `…/dist`, which a naive prefix check accepts
    // — comparing against the root plus a separator is what rules it out.
    const escaped = resolveAppRequest(`${APP_ORIGIN}/..%2fdist-plugin%2fserver.mjs`, ROOT)
    expect(escaped).not.toBe(`${ROOT}-plugin${sep}server.mjs`)
    expect(escaped).toBeUndefined()
  })
})

describe('contentTypeFor', () => {
  it('names what the build actually emits', () => {
    expect(contentTypeFor(join(ROOT, 'index.html'))).toBe('text/html; charset=utf-8')
    expect(contentTypeFor(join(ROOT, 'assets', 'index.js'))).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor(join(ROOT, 'assets', 'index.css'))).toBe('text/css; charset=utf-8')
    expect(contentTypeFor(join(ROOT, 'assets', 'emerald.svg'))).toBe('image/svg+xml')
    expect(contentTypeFor(join(ROOT, 'assets', 'plex.woff2'))).toBe('font/woff2')
    expect(contentTypeFor(join(ROOT, 'THIRD_PARTY_NOTICES.txt'))).toBe('text/plain; charset=utf-8')
  })

  it('is case-insensitive about the extension', () => {
    expect(contentTypeFor(join(ROOT, 'INDEX.HTML'))).toBe('text/html; charset=utf-8')
  })

  it('falls back rather than guessing', () => {
    expect(contentTypeFor(join(ROOT, 'notes.unknown'))).toBe('application/octet-stream')
    expect(contentTypeFor(join(ROOT, 'LICENSE'))).toBe('application/octet-stream')
  })
})
