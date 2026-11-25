/**
 * **A theme for one pane** (M64 U16, D-611): `.fc-theme-light` restates the
 * light value of every token the dark theme overrides, because `@theme` cannot
 * take a class. This is the test that says the day a light value moves and its
 * copy does not.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

/** Every `--token: value` in the blocks whose selector is exactly `selector`. */
function declared(selector: string): Map<string, string> {
  const found = new Map<string, string>()
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const block of CSS.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const [, name, value] of (block[1] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (name !== undefined && value !== undefined) found.set(name, value.replace(/\s+/g, ' ').trim())
    }
  }
  return found
}

const theme = new Map(
  [...(/@theme\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    ([, name, value]) => [name ?? '', (value ?? '').replace(/\s+/g, ' ').trim()],
  ),
)
const root = declared(':root')
const dark = declared(':root[data-theme="dark"],\n.fc-theme-dark')
const light = declared('.fc-theme-light')

describe('a theme for one pane', () => {
  it('shares the dark blocks', () => {
    expect(dark.size).toBeGreaterThan(30)
  })

  it('restates, in .fc-theme-light, the light value of every token the dark theme overrides', () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort())
    for (const [name, value] of light) expect([name, value]).toEqual([name, theme.get(name) ?? root.get(name)])
  })
})
