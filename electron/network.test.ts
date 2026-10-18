import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { APP_ORIGIN } from './appProtocol.ts'
import { isAllowedRequest, isAllowedUpdateRequest } from './network.ts'
import { RELEASES_LATEST } from './updates.ts'
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

describe('the update check (M42 U8, D-502)', () => {
  const OTHERS = [
    'https://api.github.com/repos/kfireliyahu/emerald-emd/releases',
    'https://api.github.com/repos/kfireliyahu/emerald-emd/releases/latest?per_page=1',
    'https://api.github.com/repos/someone-else/emerald-emd/releases/latest',
    'https://api.github.com/user',
    'https://github.com/kfireliyahu/emerald-emd/releases/latest',
    'https://objects.githubusercontent.com/github-production-release-asset/1',
    'http://api.github.com/repos/kfireliyahu/emerald-emd/releases/latest',
    'https://api.github.com.example.com/repos/kfireliyahu/emerald-emd/releases/latest',
    'https://api.anthropic.com/v1/messages',
    `${APP_ORIGIN}/index.html`,
    'http://localhost:11434/api/chat',
  ]

  it('asks one address, the newest release of this repository', () => {
    expect(RELEASES_LATEST).toBe('https://api.github.com/repos/kfireliyahu/emerald-emd/releases/latest')
  })

  it('is closed while no check is asking — the setting off is that, for a whole session', () => {
    expect(isAllowedUpdateRequest(RELEASES_LATEST, false)).toBe(false)
    for (const url of OTHERS) expect(isAllowedUpdateRequest(url, false)).toBe(false)
  })

  it('opens for that address and no other while a check asks', () => {
    expect(isAllowedUpdateRequest(RELEASES_LATEST, true)).toBe(true)
    for (const url of OTHERS) expect(isAllowedUpdateRequest(url, true), url).toBe(false)
  })

  it('never reaches the page: its session still refuses the address', () => {
    expect(isAllowedRequest(RELEASES_LATEST)).toBe(false)
    expect(isAllowedRequest(RELEASES_LATEST, DEV)).toBe(false)
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
 * The shell hands two fixed addresses to the system browser, and the page names neither: the
 * repository, a constant from `package.json`, on Help → Source Code (M43 U7, D-452), and the newest
 * release's page, built from the same constant, on an update notice's Download (M42 U8, D-502) —
 * never an address the release answer named. **The one other `openExternal` is a `file` cell's
 * local app address** (M37 U6): it is reached only past `linkedTarget`, whose allowlist of local
 * schemes refuses `http`, `https` and every scheme not on it (`linkedFiles.test.ts`), so it opens
 * an app on this machine and never a page.
 * A fourth call, or one fed something else, fails here.
 */
describe('what leaves the app for the system browser', () => {
  it('is the source address, the release page, and a local app address past the allowlist, and nothing else', () => {
    const dir = import.meta.dirname
    const calls = readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .flatMap((file) =>
        [...readFileSync(join(dir, file), 'utf8').matchAll(/openExternal\(([^)]*)\)/g)].map(
          (match) => `${file}: ${match[1]}`,
        ),
      )
    expect(calls.sort()).toEqual(['linkedFiles.ts: target.address', 'main.ts: RELEASES_PAGE', 'main.ts: SOURCE_URL'])
  })
})
