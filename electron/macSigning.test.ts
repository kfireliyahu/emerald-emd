import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * **The Mac app is signed ad hoc after packing** (M42 F4). With `mac.identity: null` nothing else
 * signs it, and an app whose signature no longer matches its bundle is "damaged" to macOS, with no
 * Open Anyway. That the signature holds on a real build is the release workflow's
 * `codesign --verify` step; this holds the hook to doing it, and only on a Mac build.
 */
const root = join(import.meta.dirname, '..')
const hook = await import(pathToFileURL(join(root, 'scripts', 'sign-mac.mjs')).href)

function packed(platform: string) {
  return {
    electronPlatformName: platform,
    appOutDir: join('release', 'mac-arm64'),
    packager: { appInfo: { productFilename: 'Emerald' } },
  }
}

describe('the Mac app is signed ad hoc (M42 F4)', () => {
  it('signs the packed app with `-`, its helpers too, on a Mac build', () => {
    const calls: unknown[][] = []
    hook.default(packed('darwin'), (...args: unknown[]) => calls.push(args))

    expect(calls).toHaveLength(1)
    const [command, args] = calls[0] ?? []
    expect(command).toBe('codesign')
    expect(args).toEqual(['--force', '--deep', '--sign', '-', join('release', 'mac-arm64', 'Emerald.app')])
  })

  it('does nothing on a Windows build', () => {
    const calls: unknown[][] = []
    hook.default(packed('win32'), (...args: unknown[]) => calls.push(args))
    expect(calls).toEqual([])
  })

  it('is the hook electron-builder runs, and no keychain identity is ever picked up', () => {
    const config = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    expect(config).toMatch(/^afterPack: \.\/scripts\/sign-mac\.mjs$/m)
    expect(config).toMatch(/^\s+identity: null$/m)
  })
})
