import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  aboutCredits,
  aboutPanelOptions,
  NOT_ADVICE,
  SOURCE_URL,
  sourceUrlFrom,
  taggedSourceUrl,
} from './about.ts'

/**
 * The About (M43 U7, D-452): what it says is what the AGPL and a plain reading of D-308 owe a
 * person who downloaded an installer — and its one address comes from `package.json` alone.
 */

const ROOT = join(import.meta.dirname, '..')

describe('the source address', () => {
  it('is package.json\'s repository, made a browsable https address', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      repository: { url: string }
    }
    expect(SOURCE_URL).toBe(sourceUrlFrom(pkg.repository))
    expect(SOURCE_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/)
    expect(sourceUrlFrom('git+https://github.com/someone/thing.git')).toBe(
      'https://github.com/someone/thing',
    )
  })

  it('refuses anything that is not a plain https address, since it reaches openExternal', () => {
    for (const bad of [
      'git@github.com:someone/thing.git',
      'http://github.com/someone/thing',
      'file:///etc/passwd',
      'https://user:secret@github.com/someone/thing',
      'not an address',
    ]) {
      expect(() => sourceUrlFrom(bad)).toThrow()
    }
  })

  it('links this exact version by the tag the release workflow builds from', () => {
    expect(taggedSourceUrl('1.2.3', 'https://github.com/a/b')).toBe(
      'https://github.com/a/b/tree/v1.2.3',
    )
  })
})

describe('what the About says', () => {
  const options = aboutPanelOptions('0.9.0', 'https://github.com/a/b')

  it('names the version, the licence with no warranty, and the source of this version', () => {
    expect(options.applicationName).toBe('Emerald')
    expect(options.applicationVersion).toBe('0.9.0')
    expect(options.credits).toContain('AGPL-3.0-only, with no warranty')
    expect(options.credits).toContain('https://github.com/a/b/tree/v0.9.0')
    expect(options.website).toBe('https://github.com/a/b')
  })

  it('says it computes and does not advise, in the screens\' own word for a paycheck (D-451)', () => {
    expect(options.credits).toContain(NOT_ADVICE)
    expect(NOT_ADVICE).toMatch(/does not advise/)
    expect(NOT_ADVICE).toMatch(/paycheck/)
    expect(NOT_ADVICE).not.toMatch(/payslip/)
  })

  it('names the author without the address', () => {
    expect(options.copyright).toMatch(/^Copyright © \d{4} \S/)
    expect(options.copyright).not.toContain('@')
  })

  it('is the same text on every platform', () => {
    expect(aboutCredits('0.9.0', 'https://github.com/a/b')).toBe(options.credits)
  })
})

describe('the README says it too', () => {
  // Not the exact sentence: the README is the maintainer's to word (M43 U1), the line is not.
  it('carries the not-advice line', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    expect(readme).toMatch(/computes; it does not advise/)
  })
})
