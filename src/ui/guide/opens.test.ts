import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { currentGuideOpen } from './guideState.ts'

/**
 * **Guide me never opens by itself** (M59 U5, D-575, D-581). A second person's
 * first ledger document opened with the guide's dialog over Home, unasked. It
 * opens from a press only: Help › Guide me, the palette, the rail's compass and
 * Home's Getting started line — so those are the only places that may ask, and
 * the dialog itself only moves a walk that is already open.
 */
const PRESSES = [
  'src/ui/Sidebar.tsx', // the rail's compass
  'src/ui/commands.ts', // the palette
  'src/ui/guide/GuideLine.tsx', // Home's line
  'src/ui/useShellCommands.ts', // Help › Guide me
]

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`
    if (statSync(join(dir, name)).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const calling = (pattern: RegExp): string[] =>
  sources('src')
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .sort()

describe('what opens the guide', () => {
  it('is closed when the app starts', () => {
    expect(currentGuideOpen()).toBeUndefined()
  })

  it('is only a press', () => {
    expect(calling(/\bopenGuide\(/).filter((path) => path !== 'src/ui/guide/guideState.ts')).toEqual(PRESSES)
  })

  it('is never the dialog itself, which only moves or closes a walk already open', () => {
    const dialog = readFileSync('src/ui/guide/Guide.tsx', 'utf8')
    expect(dialog).not.toMatch(/\bopenGuide\(/)
    expect(dialog).not.toMatch(/setGuideOpen\(\{\s*kind:\s*'resume'/)
    expect(calling(/\bsetGuideOpen\(/).filter((path) => !path.startsWith('src/ui/guide/'))).toEqual([])
  })
})
