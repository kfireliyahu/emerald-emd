import { describe, expect, it } from 'vitest'

import type { UpdateState } from './bridge.ts'
import {
  automaticFrom,
  createUpdates,
  DAY_MS,
  downloadFailure,
  isNewer,
  latestVersionFrom,
  releaseFeed,
  RELEASES_PAGE,
  reopenFrom,
  reopenText,
  settingsText,
  type Downloader,
  type UpdatesDeps,
} from './updates.ts'

/**
 * Updates, if you turn them on (M42 U8, D-502), against a stubbed release: the schedule asks
 * nothing while the setting is off, a press asks once with it off, and every answer is the notice.
 */

/**
 * Windows' downloader, stubbed (M42 U9): records what it was asked, and each download waits for the
 * test to finish it — `finish()` as electron-updater would after a matching sha512, `refuse(error)`
 * as it does on a mismatch.
 */
function stubDownloader() {
  const downloads: string[] = []
  const pending: { resolve: () => void; reject: (error: unknown) => void }[] = []
  let cancelled = 0
  let installed = 0
  const downloader: Downloader = {
    download: (version) => {
      downloads.push(version)
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }))
    },
    cancel: () => {
      cancelled += 1
    },
    install: () => {
      installed += 1
    },
  }
  return {
    downloader,
    downloads,
    finish: async () => {
      pending.shift()?.resolve()
      await settle()
    },
    refuse: async (error: unknown) => {
      pending.shift()?.reject(error)
      await settle()
    },
    cancelled: () => cancelled,
    installed: () => installed,
  }
}

function harness(
  options: { automatic?: boolean; latest?: unknown; fail?: string; version?: string; downloader?: Downloader } = {},
) {
  let clock = 1_000_000
  const asked: number[] = []
  const saved: boolean[] = []
  const published: UpdateState[] = []
  let gateDuringFetch: boolean | undefined
  let latest = options.latest ?? { tag_name: 'v0.2.0', html_url: 'https://example.com/elsewhere' }
  const deps: UpdatesDeps = {
    version: options.version ?? '0.1.2',
    automatic: options.automatic ?? false,
    fetchLatest: () => {
      asked.push(clock)
      gateDuringFetch = updates.gateOpen()
      return options.fail === undefined ? Promise.resolve(latest) : Promise.reject(new Error(options.fail))
    },
    saveAutomatic: (on) => {
      saved.push(on)
      return Promise.resolve()
    },
    publish: (state) => published.push(state),
    now: () => clock,
    downloader: options.downloader,
  }
  const updates = createUpdates(deps)
  return {
    updates,
    asked,
    saved,
    published,
    gateDuringFetch: () => gateDuringFetch,
    advance: (ms: number) => {
      clock += ms
    },
    release: (tag: string) => {
      latest = { tag_name: tag }
    },
  }
}

/** Let a check started without `await` finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('versions', () => {
  it('compares the three numbers, as numbers', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('v0.1.10', '0.1.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.1.2', '0.1.2')).toBe(false)
    expect(isNewer('0.1.0', '0.1.2')).toBe(false)
  })

  it('never calls an unreadable version newer', () => {
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(false)
    expect(isNewer('latest', '0.1.0')).toBe(false)
    expect(isNewer('0.2.0', 'dev')).toBe(false)
  })

  it('reads the tag and nothing else from the answer', () => {
    expect(latestVersionFrom({ tag_name: 'v0.1.0', html_url: 'https://anywhere' })).toBe('0.1.0')
    expect(() => latestVersionFrom({ message: 'Not Found' })).toThrow(/no version/)
    expect(() => latestVersionFrom({ tag_name: 'nightly' })).toThrow(/no version/)
    expect(() => latestVersionFrom(null)).toThrow(/no version/)
  })

  it('opens the newest release page, a constant from package.json', () => {
    expect(RELEASES_PAGE).toBe('https://github.com/kfireliyahu/emerald-emd/releases/latest')
  })
})

describe('the setting', () => {
  it('is off unless the file says true', () => {
    expect(automaticFrom(undefined)).toBe(false)
    expect(automaticFrom('')).toBe(false)
    expect(automaticFrom('{"automaticUpdates":"yes"}')).toBe(false)
    expect(automaticFrom('not json')).toBe(false)
    expect(automaticFrom(settingsText(true))).toBe(true)
    expect(automaticFrom(settingsText(false))).toBe(false)
  })
})

describe('the schedule', () => {
  it('asks nothing while the setting is off, however long the app runs', async () => {
    const run = harness({ automatic: false })
    for (let hour = 0; hour < 24 * 10; hour += 1) {
      await run.updates.tick()
      run.advance(60 * 60 * 1000)
    }
    expect(run.asked).toEqual([])
    expect(run.updates.gateOpen()).toBe(false)
  })

  it('asks at start and once a day while on, and opens the gate only while asking', async () => {
    const run = harness({ automatic: true })
    await run.updates.tick()
    expect(run.asked).toHaveLength(1)
    expect(run.gateDuringFetch()).toBe(true)
    expect(run.updates.gateOpen()).toBe(false)

    for (let hour = 1; hour < 24; hour += 1) {
      run.advance(60 * 60 * 1000)
      await run.updates.tick()
    }
    expect(run.asked).toHaveLength(1)
    run.advance(60 * 60 * 1000)
    await run.updates.tick()
    expect(run.asked).toHaveLength(2)
  })

  it('says a newer version quietly, and nothing when there is none', async () => {
    const newer = harness({ automatic: true })
    await newer.updates.tick()
    expect(newer.updates.state().notice).toEqual({ kind: 'available', version: '0.2.0' })

    const same = harness({ automatic: true, latest: { tag_name: 'v0.1.2' } })
    await same.updates.tick()
    expect(same.updates.state().notice).toBeUndefined()
    expect(same.published).toEqual([])
  })

  it('fails silently on a schedule, and tries again the next day', async () => {
    const run = harness({ automatic: true, fail: 'offline' })
    await run.updates.tick()
    expect(run.updates.state().notice).toBeUndefined()
    run.advance(DAY_MS)
    await run.updates.tick()
    expect(run.asked).toHaveLength(2)
  })

  it('hides on Later until the next day’s check finds it again', async () => {
    const run = harness({ automatic: true })
    await run.updates.tick()
    run.updates.later()
    expect(run.updates.state().notice).toBeUndefined()
    run.advance(DAY_MS - 1)
    await run.updates.tick()
    expect(run.updates.state().notice).toBeUndefined()
    run.advance(1)
    await run.updates.tick()
    expect(run.updates.state().notice).toEqual({ kind: 'available', version: '0.2.0' })
  })

  it('checks as soon as it is turned on, keeps the choice, and stops when turned off', async () => {
    const run = harness({ automatic: false })
    const on = await run.updates.setAutomatic(true)
    expect(on.automatic).toBe(true)
    await settle()
    expect(run.asked).toHaveLength(1)
    expect(run.saved).toEqual([true])

    await run.updates.setAutomatic(false)
    run.advance(DAY_MS * 3)
    await run.updates.tick()
    expect(run.asked).toHaveLength(1)
    expect(run.saved).toEqual([true, false])
  })
})

describe('Check for Updates Now', () => {
  it('asks once with the setting off, and says there is nothing newer', async () => {
    const run = harness({ automatic: false, latest: { tag_name: 'v0.1.0' } })
    const answer = await run.updates.checkNow()
    expect(run.asked).toHaveLength(1)
    expect(run.gateDuringFetch()).toBe(true)
    expect(answer.notice).toEqual({ kind: 'latest', version: '0.1.2' })
    expect(run.published.map((state) => state.notice?.kind)).toEqual(['checking', 'latest'])
    // Consent for that one check, not for a schedule.
    run.advance(DAY_MS * 2)
    await run.updates.tick()
    expect(run.asked).toHaveLength(1)
    expect(run.updates.gateOpen()).toBe(false)
  })

  it('says a newer version in the same notice', async () => {
    const run = harness({ automatic: false })
    run.release('v0.1.3')
    expect((await run.updates.checkNow()).notice).toEqual({ kind: 'available', version: '0.1.3' })
  })

  it('says why, when it could not tell', async () => {
    const run = harness({ fail: 'GitHub answered 403.' })
    expect((await run.updates.checkNow()).notice).toEqual({ kind: 'failed', reason: 'GitHub answered 403.' })
    expect(run.updates.gateOpen()).toBe(false)
  })

  it('asks once when pressed twice while asking', async () => {
    const run = harness()
    await Promise.all([run.updates.checkNow(), run.updates.checkNow()])
    expect(run.asked).toHaveLength(1)
  })
})

describe('Windows: downloads quietly, installs on a press (M42 U9)', () => {
  /** A real `ERR_CHECKSUM_MISMATCH`, as builder-util-runtime throws it. */
  const mismatch = Object.assign(new Error('sha512 checksum mismatch, expected abc, got def'), { code: 'ERR_CHECKSUM_MISMATCH' })

  it('downloads a newer version on a schedule, says nothing until it is ready, then says it is ready', async () => {
    const stub = stubDownloader()
    const run = harness({ automatic: true, downloader: stub.downloader })
    await run.updates.tick()
    expect(stub.downloads).toEqual(['0.2.0'])
    expect(run.updates.downloading()).toBe('0.2.0')
    expect(run.updates.state().notice).toBeUndefined()
    expect(run.published).toEqual([])

    await stub.finish()
    expect(run.updates.downloading()).toBeUndefined()
    expect(run.updates.ready()).toBe('0.2.0')
    expect(run.updates.state()).toMatchObject({ downloads: true, notice: { kind: 'ready', version: '0.2.0' } })
    // Nothing is installed by being ready.
    expect(stub.installed()).toBe(0)
  })

  it('downloads nothing for the same version or an older one', async () => {
    for (const tag of ['v0.1.2', 'v0.1.0']) {
      const stub = stubDownloader()
      const run = harness({ automatic: true, downloader: stub.downloader, latest: { tag_name: tag } })
      await run.updates.tick()
      expect((await run.updates.checkNow()).notice).toEqual({ kind: 'latest', version: '0.1.2' })
      expect(stub.downloads).toEqual([])
      expect(run.updates.downloading()).toBeUndefined()
    }
  })

  it('refuses a download whose checksum does not match, keeps nothing installable, and says so', async () => {
    const stub = stubDownloader()
    const run = harness({ automatic: true, downloader: stub.downloader })
    await run.updates.tick()
    await stub.refuse(mismatch)
    expect(run.updates.ready()).toBeUndefined()
    expect(run.updates.install()).toBe(false)
    expect(stub.installed()).toBe(0)
    // Never silent, because there is a newer version: the notice macOS shows, with the reason.
    expect(run.updates.state().notice).toEqual({
      kind: 'available',
      version: '0.2.0',
      unfetched: 'The download did not match the checksum published with it, so it was not kept.',
    })
  })

  it('only says so with the setting off, even on a press', async () => {
    const stub = stubDownloader()
    const run = harness({ automatic: false, downloader: stub.downloader })
    expect((await run.updates.checkNow()).notice).toEqual({ kind: 'available', version: '0.2.0' })
    expect(stub.downloads).toEqual([])
  })

  it('says a pressed download is on its way, and downloads once however often it is asked', async () => {
    const stub = stubDownloader()
    const run = harness({ automatic: true, downloader: stub.downloader })
    expect((await run.updates.checkNow()).notice).toEqual({ kind: 'downloading', version: '0.2.0' })
    run.advance(DAY_MS)
    await run.updates.tick()
    expect(stub.downloads).toEqual(['0.2.0'])
    await stub.finish()
    expect(run.updates.state().notice).toEqual({ kind: 'ready', version: '0.2.0' })
  })

  it('hides on Later, and says ready again at the next day’s check without downloading again', async () => {
    const stub = stubDownloader()
    const run = harness({ automatic: true, downloader: stub.downloader })
    await run.updates.tick()
    await stub.finish()
    run.updates.later()
    expect(run.updates.state().notice).toBeUndefined()
    run.advance(DAY_MS)
    await run.updates.tick()
    expect(run.updates.state().notice).toEqual({ kind: 'ready', version: '0.2.0' })
    expect(stub.downloads).toEqual(['0.2.0'])
  })

  it('stops a download when the setting is turned off', async () => {
    const stub = stubDownloader()
    const run = harness({ automatic: true, downloader: stub.downloader })
    await run.updates.checkNow()
    const off = await run.updates.setAutomatic(false)
    expect(stub.cancelled()).toBe(1)
    expect(run.updates.downloading()).toBeUndefined()
    expect(off.notice).toEqual({ kind: 'available', version: '0.2.0' })
    // The cancelled download's rejection says nothing more.
    await stub.refuse(new Error('cancelled'))
    expect(run.updates.state().notice).toEqual({ kind: 'available', version: '0.2.0' })
  })

  it('installs only when one is ready and somebody pressed Install and restart', async () => {
    const stub = stubDownloader()
    const run = harness({ automatic: true, downloader: stub.downloader })
    expect(run.updates.install()).toBe(false)
    await run.updates.tick()
    expect(run.updates.install()).toBe(false)
    await stub.finish()
    expect(stub.installed()).toBe(0)
    expect(run.updates.install()).toBe(true)
    expect(stub.installed()).toBe(1)
  })

  it('says where nothing downloads, so About can say so too', () => {
    expect(harness().updates.state().downloads).toBe(false)
  })

  it('reads the release the check found, at its own address', () => {
    expect(releaseFeed('0.2.0')).toBe('https://github.com/kfireliyahu/emerald-emd/releases/download/v0.2.0/')
  })

  it('keeps the document to reopen, and nothing unreadable', () => {
    expect(reopenFrom(reopenText('C:\\Users\\me\\books.emd'))).toBe('C:\\Users\\me\\books.emd')
    expect(reopenFrom(undefined)).toBeUndefined()
    expect(reopenFrom('{"reopen":3}')).toBeUndefined()
    expect(reopenFrom('nonsense')).toBeUndefined()
  })

  it('says a mismatch plainly, and anything else as it came', () => {
    expect(downloadFailure(mismatch)).toMatch(/did not match the checksum/)
    expect(downloadFailure(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('net::ERR_INTERNET_DISCONNECTED')
  })
})
