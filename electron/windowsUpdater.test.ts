import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, request, type ClientRequest, type IncomingMessage, type RequestOptions, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { tempDir } from '../src/testing/tempDir.ts'

import { isAllowedDownloadRequest } from './network.ts'
import { WINDOWS_INSTALLER } from './updates.ts'
import { createWindowsDownloader, QuietNsisUpdater } from './windowsUpdater.ts'

/**
 * Windows' download (M42 U9) through the real electron-updater, against a stubbed feed: a local
 * server laid out as GitHub lays out a release — `/v<version>/latest.yml` and the installer it names.
 * Only the transport is swapped (Node's `http` for Electron's `net`, which needs the app); the
 * check, the feed, the download, the sha512 and the cache are electron-updater's own.
 */

const INSTALLER = randomBytes(64 * 1024)
const sha512 = (bytes: Buffer) => createHash('sha512').update(bytes).digest('base64')

function latestYml(version: string, digest: string): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${WINDOWS_INSTALLER}`,
    `    sha512: ${digest}`,
    `    size: ${String(INSTALLER.length)}`,
    `path: ${WINDOWS_INSTALLER}`,
    `sha512: ${digest}`,
    "releaseDate: '2026-10-18T00:00:00.000Z'",
    '',
  ].join('\n')
}

/** Each release the feed holds: what its latest.yml says. */
const RELEASES: Record<string, string> = {
  // Newer, and the file is the one its checksum names.
  '0.2.0': latestYml('0.2.0', sha512(INSTALLER)),
  // This copy's own version, and an older one.
  '0.1.3': latestYml('0.1.3', sha512(INSTALLER)),
  '0.1.0': latestYml('0.1.0', sha512(INSTALLER)),
  // Newer, but the checksum is of other bytes: the file served is not the file published.
  '0.3.0': latestYml('0.3.0', sha512(randomBytes(64 * 1024))),
  // A release whose latest.yml describes another version.
  '0.4.0': latestYml('0.5.0', sha512(INSTALLER)),
}

/** electron-updater's own executor, reaching the local feed over Node's `http` instead of Electron's `net`. */
class NodeExecutor extends ElectronHttpExecutor {
  constructor() {
    super(undefined)
  }

  override createRequest(options: RequestOptions, callback: (response: IncomingMessage) => void): ReturnType<ElectronHttpExecutor['createRequest']> {
    const outgoing: ClientRequest = request(options)
    outgoing.on('response', callback)
    // Node's request has the members the executor uses; Electron's type has two more it never calls here.
    return outgoing as unknown as ReturnType<ElectronHttpExecutor['createRequest']>
  }
}

let server: Server
let base: string
let root: string
const asked: string[] = []
const staging: (string | string[] | undefined)[] = []

beforeAll(async () => {
  server = createServer((incoming, answer) => {
    const url = incoming.url ?? ''
    asked.push(url)
    staging.push(incoming.headers['x-user-staging-id'])
    const match = /^\/v([\d.]+)\/([^?]+)/.exec(url)
    const release = match === null ? undefined : RELEASES[match[1]!]
    if (release !== undefined && match![2] === 'latest.yml') {
      answer.writeHead(200, { 'content-type': 'text/yaml' }).end(release)
    } else if (release !== undefined && match![2] === WINDOWS_INSTALLER) {
      answer.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(INSTALLER.length) }).end(INSTALLER)
    } else {
      answer.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`
  root = await tempDir('emerald-updater-')
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

/** A fresh updater, as the installed app has one: version 0.1.3, its own cache, no publisher named. */
function updater(name: string) {
  const folder = join(root, name)
  // electron-builder writes this into the installed app; it names the cache and, here, no publisher.
  writeFileSync(join(root, `${name}.yml`), 'updaterCacheDirName: emerald-updater\n')
  const app = {
    version: '0.1.3',
    name: 'Emerald',
    isPackaged: true,
    appUpdateConfigPath: join(root, `${name}.yml`),
    userDataPath: folder,
    baseCachePath: folder,
    whenReady: () => Promise.resolve(),
    relaunch: () => undefined,
    quit: () => undefined,
    onQuit: () => undefined,
  }
  const quiet = new QuietNsisUpdater(app)
  ;(quiet as unknown as { httpExecutor: ElectronHttpExecutor }).httpExecutor = new NodeExecutor()
  const pending = join(folder, 'emerald-updater', 'pending')
  return { downloader: createWindowsDownloader(quiet, { version: '0.1.3', base }), pending, folder }
}

describe('the Windows download, through electron-updater, against a stubbed feed', () => {
  // **It runs as Windows wherever it runs** (M51 F6): electron-updater names the feed's file by the
  // platform at the moment it asks — `latest.yml` on Windows, `latest-linux.yml` on the Linux CI runs
  // on — and this is the Windows download, so the platform it reads is Windows for these tests alone.
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  beforeAll(() => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  })
  afterAll(() => {
    Object.defineProperty(process, 'platform', platform)
  })

  it('downloads a newer installer, checked against its sha512, from that release and nowhere else', async () => {
    asked.length = 0
    const { downloader, pending } = updater('newer')
    await downloader.download('0.2.0')
    expect(readdirSync(pending)).toContain(WINDOWS_INSTALLER)
    // Two requests, both inside that release, both allowed by the download's gate.
    expect(asked.map((url) => url.replace(/\?noCache=[0-9a-v]+$/, ''))).toEqual(['/v0.2.0/latest.yml', `/v0.2.0/${WINDOWS_INSTALLER}`])
    for (const url of asked) expect(isAllowedDownloadRequest(`${base}${url.slice(1)}`, '0.2.0', base)).toBe(true)
  })

  it('refuses the same version and an older one', async () => {
    const same = updater('same')
    await expect(same.downloader.download('0.1.3')).rejects.toThrow(/not newer/)
    const older = updater('older')
    await expect(older.downloader.download('0.1.0')).rejects.toThrow(/not newer/)
    expect(existsSync(same.pending)).toBe(false)
    expect(existsSync(older.pending)).toBe(false)
  })

  it('refuses an installer whose checksum does not match, and keeps nothing', async () => {
    const { downloader, pending } = updater('mismatch')
    await expect(downloader.download('0.3.0')).rejects.toMatchObject({ code: 'ERR_CHECKSUM_MISMATCH' })
    expect(existsSync(pending) ? readdirSync(pending).filter((file) => file.endsWith('.exe')) : []).toEqual([])
  })

  it('refuses a release whose latest.yml describes another version', async () => {
    const { downloader } = updater('another')
    await expect(downloader.download('0.4.0')).rejects.toThrow(/describes 0\.5\.0/)
  })

  it('makes and sends no staging id', async () => {
    staging.length = 0
    const { downloader, folder } = updater('staging')
    await downloader.download('0.2.0')
    expect(existsSync(join(folder, '.updaterId'))).toBe(false)
    // electron-updater still names the header; it carries nothing, and the app's session drops it.
    expect(staging.every((value) => value === undefined || value === '')).toBe(true)
  })
})
