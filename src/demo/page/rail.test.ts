import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rowAt, tones } from './rail.ts'
import { installerLink, INSTALLERS, LATEST_RELEASE, SOURCE_URL } from './page.ts'

describe('the page as a roadmap (M33 U8)', () => {
  it('the row under the eye is the last whose top has passed the mark', () => {
    expect(rowAt([0, 500, 1000], 400, false)).toBe(0)
    expect(rowAt([0, 500, 1000], 600, false)).toBe(1)
    expect(rowAt([0, 500, 1000], 1000, false)).toBe(2)
  })

  it('a page scrolled to its end is at its last row, however short that row is', () => {
    expect(rowAt([0, 500, 1000], 600, true)).toBe(2)
  })

  it('the first row when none has passed, and nothing when there are no rows', () => {
    expect(rowAt([100, 500], 0, false)).toBe(0)
    expect(rowAt([], 0, false)).toBe(-1)
  })

  it('what was read is done, the row under the eye is live, the rest wait', () => {
    expect(tones(4, 1)).toEqual(['done', 'live', 'waiting', 'waiting'])
    expect(tones(2, 0)).toEqual(['live', 'waiting'])
  })

  it('the source address is the one package.json names (D-452)', () => {
    const { repository } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      repository?: string | { url?: string }
    }
    const named = typeof repository === 'string' ? repository : (repository?.url ?? '')
    expect(named.replace(/^git\+/, '').replace(/\.git$/, '')).toBe(SOURCE_URL)
  })

  it('the installers it links are the files the build names, with no version in them (M42 F2, U9)', () => {
    const yml = readFileSync(new URL('../../../electron-builder.yml', import.meta.url), 'utf8')
    const patterns = [...yml.matchAll(/artifactName: (\S+)/g)].map((match) => match[1] ?? '')
    expect(patterns.length).toBeGreaterThan(0)
    for (const pattern of patterns) expect(pattern).not.toContain('${version}')
    const named = (arch: string): string[] => patterns.map((pattern) => pattern.replace('${arch}', arch))
    expect(named('x64')).toContain(INSTALLERS.windows.replace(/\.exe$/, '.${ext}'))
    expect(named('arm64')).toContain(INSTALLERS.arm64.replace(/\.dmg$/, '.${ext}'))
    expect(named('x64')).toContain(INSTALLERS.x64.replace(/\.dmg$/, '.${ext}'))
  })

  it('offers the Claude extension the release workflow attaches, by its own name (M42 F15)', () => {
    const script = readFileSync(new URL('../../../scripts/mcpb.mjs', import.meta.url), 'utf8')
    expect(script).toContain(`join(root, 'release', '${INSTALLERS.extension}')`)
    expect(installerLink(INSTALLERS.extension, true)).toBe(
      'https://github.com/kfireliyahu/emerald-emd/releases/latest/download/emerald.mcpb',
    )
    const page = readFileSync(new URL('../../../demo-page.html', import.meta.url), 'utf8')
    expect(page).toContain('data-installer="extension"')
  })

  it('links the newest release’s file once the names are out, and its page until then (M42 U9)', () => {
    expect(installerLink(INSTALLERS.windows, true)).toBe(`${SOURCE_URL}/releases/latest/download/Emerald-Setup.exe`)
    expect(installerLink(INSTALLERS.sums, true)).toBe(`${SOURCE_URL}/releases/latest/download/SHA256SUMS`)
    expect(installerLink(INSTALLERS.arm64, false)).toBe(`${SOURCE_URL}/releases/latest`)
    expect(LATEST_RELEASE).toBe('https://github.com/kfireliyahu/emerald-emd/releases/latest')
  })
})
