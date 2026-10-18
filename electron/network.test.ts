import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { APP_ORIGIN } from './appProtocol.ts'
import { isAllowedRequest } from './network.ts'
import { versionFromArguments } from './bridge.ts'

const DEV = 'http://localhost:5173'

describe('isAllowedRequest', () => {
  it('allows the app serving itself', () => {
    expect(isAllowedRequest(`${APP_ORIGIN}/index.html`)).toBe(true)
    expect(isAllowedRequest(`${APP_ORIGIN}/assets/index.css`)).toBe(true)
  })

  it('allows the bytes the page already holds', () => {
    expect(isAllowedRequest('blob:app://emerald/8f0e-…')).toBe(true)
    expect(isAllowedRequest('data:image/svg+xml;base64,PHN2Zw==')).toBe(true)
  })

  it('blocks the network, which is the whole point (D-124)', () => {
    expect(isAllowedRequest('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans')).toBe(false)
    expect(isAllowedRequest('https://api.anthropic.com/v1/messages')).toBe(false)
    expect(isAllowedRequest('http://example.com/update.json')).toBe(false)
    expect(isAllowedRequest('ws://example.com/socket')).toBe(false)
  })

  it('blocks localhost too, unless the dev server put itself there', () => {
    expect(isAllowedRequest('http://localhost:11434/api/chat')).toBe(false)
    expect(isAllowedRequest(`${DEV}/index.html`)).toBe(false)
    expect(isAllowedRequest(`${DEV}/index.html`, DEV)).toBe(true)
  })

  it('allows the dev server and its hot-reload socket, and nothing beside them', () => {
    expect(isAllowedRequest(`${DEV}/@vite/client`, DEV)).toBe(true)
    expect(isAllowedRequest('ws://localhost:5173/', DEV)).toBe(true)
    expect(isAllowedRequest('http://localhost:5174/', DEV)).toBe(false)
    // A different authority that merely starts with the allowed one.
    expect(isAllowedRequest('http://localhost:51730/', DEV)).toBe(false)
  })

  it('blocks reading the disk through the renderer', () => {
    expect(isAllowedRequest('file:///C:/Users/someone/finances.emd')).toBe(false)
  })

  it('treats an empty dev origin as no dev origin', () => {
    expect(isAllowedRequest('http://localhost:5173/', '')).toBe(false)
  })
})

describe('versionFromArguments', () => {
  it('reads the version the shell passed to a sandboxed preload', () => {
    expect(versionFromArguments(['--emerald-version=1.2.3', '--other'])).toBe('1.2.3')
  })

  it('does not throw when it is missing', () => {
    expect(versionFromArguments([])).toBe('0.0.0')
  })
})

/**
 * The shell hands exactly one address to the system browser — the repository, a constant from
 * `package.json`, on Help → Source Code (M43 U7, D-452) — and the page can make it hand none.
 * **The one other `openExternal` is a `file` cell's local app address** (M37 U6): it is reached
 * only past `linkedTarget`, whose allowlist of local schemes refuses `http`, `https` and every
 * scheme not on it (`linkedFiles.test.ts`), so it opens an app on this machine and never a page.
 * A third call, or one fed something else, fails here.
 */
describe('what leaves the app for the system browser', () => {
  it('is the source address, and a local app address past the allowlist, and nothing else', () => {
    const dir = import.meta.dirname
    const calls = readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .flatMap((file) =>
        [...readFileSync(join(dir, file), 'utf8').matchAll(/openExternal\(([^)]*)\)/g)].map(
          (match) => `${file}: ${match[1]}`,
        ),
      )
    expect(calls.sort()).toEqual(['linkedFiles.ts: target.address', 'main.ts: SOURCE_URL'])
  })
})
