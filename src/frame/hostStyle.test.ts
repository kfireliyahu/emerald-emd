import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  HOST_TOKENS,
  MEANING_TOKENS,
  TEXT_CONTRAST,
  TEXT_TOKENS,
  contextOf,
  contrast,
  describeApplied,
  describeContext,
  hexOf,
  mergeContext,
  parseColour,
  shortfalls,
  tokensFrom,
  type Rgba,
} from './hostStyle.ts'
// What the stand-in sends with --host-theme=vscode (scripts/try-frame.mjs):
// VS Code's Modern themes as its chat panel draws them — plausible, not captured.
import HOST_THEMES from './hostThemes.json'

/** Emerald's own value of a token in a theme, read from tokens.css rather than copied. */
function emerald(token: string, theme: 'light' | 'dark'): Rgba {
  const css = readFileSync(new URL('../ui/theme/tokens.css', import.meta.url), 'utf8')
  const blocks = theme === 'light' ? [css.slice(css.indexOf('@theme {'))] : css.split(':root[data-theme="dark"] {').slice(1)
  for (const block of blocks) {
    const value = new RegExp(`${token}:\\s*(#[0-9a-fA-F]+);`).exec(block.slice(0, block.indexOf('\n}')))?.[1]
    if (value !== undefined) return parseColour(value)!
  }
  throw new Error(`${token} has no ${theme} value in tokens.css`)
}

describe('the frame reads the host context (M41 F1)', () => {
  it('takes theme, variables and fonts, and leaves out anything malformed', () => {
    expect(
      contextOf({
        theme: 'dark',
        displayMode: 'inline',
        styles: { variables: { '--color-text-primary': '#ccc', '--font-sans': '', 'not-a-variable': 'x', '--n': 4 }, css: { fonts: '@font-face{}' } },
      }),
    ).toEqual({ theme: 'dark', styles: { variables: { '--color-text-primary': '#ccc' }, css: { fonts: '@font-face{}' } } })
    expect(contextOf({ theme: 'sepia' })).toEqual({})
    expect(contextOf(undefined)).toEqual({})
  })

  it('merges a change onto what it had, as the spec says a view does', () => {
    const first = contextOf({ theme: 'light', styles: { variables: { '--color-text-primary': '#333', '--font-sans': 'Segoe UI' } } })
    expect(mergeContext(first, contextOf({ theme: 'dark' }))).toEqual({ ...first, theme: 'dark' })
    expect(mergeContext(first, contextOf({ theme: 'dark', styles: { variables: { '--color-text-primary': '#ccc' } } }))).toEqual({
      theme: 'dark',
      styles: { variables: { '--color-text-primary': '#ccc', '--font-sans': 'Segoe UI' } },
    })
  })
})

describe('which of Emerald’s tokens a host sets', () => {
  it('surfaces, ink, hairlines, the small radii and the type — each only when given', () => {
    expect(tokensFrom({})).toEqual({})
    expect(tokensFrom(HOST_THEMES.vscode.dark)).toEqual({
      '--color-background': '#181818',
      '--color-elevated': '#181818',
      '--color-surface': '#1f1f1f',
      '--color-ink': '#cccccc',
      '--color-ink-secondary': '#9d9d9d',
      '--color-ink-tertiary': '#6e7681',
      '--color-hairline': '#2b2b2b',
      '--color-hairline-strong': '#3c3c3c',
      '--radius-sm': '4px',
      '--radius-md': '6px',
      '--radius-lg': '8px',
      '--font-sans': HOST_THEMES.vscode.dark['--font-sans'],
      '--font-mono': HOST_THEMES.vscode.dark['--font-mono'],
    })
  })

  it('never what carries meaning: the accent, the action, the verdicts, the flows, the square cards and controls', () => {
    const set = HOST_TOKENS.map((entry) => entry.token)
    for (const kept of [...MEANING_TOKENS, '--color-accent-soft', '--color-action', '--color-flow-out', '--radius-card', '--radius-control']) {
      expect(set).not.toContain(kept)
    }
    // A host that sends its own accent, ring and status colours changes none of them.
    expect(tokensFrom({ '--color-ring-primary': '#0078d4', '--color-text-success': '#0f0', '--color-text-danger': '#f00' })).toEqual({})
  })
})

describe('Emerald’s meaning reads on the host’s surface, in light and dark', () => {
  it('measures as WCAG does', () => {
    expect(contrast(parseColour('#000')!, parseColour('#fff')!)).toBeCloseTo(21, 5)
    expect(parseColour('rgb(24, 24, 24)')).toEqual({ r: 24, g: 24, b: 24, a: 1 })
    expect(parseColour('rgba(255 255 255 / 50%)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 })
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`the accent, proved, failed and the host’s own text clear 4.5:1 on VS Code’s ${theme} surface`, () => {
      const host = HOST_THEMES.vscode[theme]
      const background = parseColour(host['--color-background-primary'])!
      const colours: Record<string, Rgba> = {
        ...Object.fromEntries(MEANING_TOKENS.map((token) => [token, emerald(token, theme)])),
        '--color-ink': parseColour(host['--color-text-primary'])!,
        '--color-ink-secondary': parseColour(host['--color-text-secondary'])!,
      }
      expect(shortfalls(background, colours)).toEqual([])
      for (const colour of Object.values(colours)) expect(contrast(colour, background)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    })
  }

  it('names what falls short, which is when the frame keeps Emerald’s colours whole', () => {
    // Emerald's light accent on a dark surface: a host whose theme and surface disagree.
    const short = shortfalls(parseColour('#181818')!, { '--color-accent': emerald('--color-accent', 'light') })
    expect(short.map((s) => s.token)).toEqual(['--color-accent'])
    expect(short[0]!.ratio).toBeLessThan(TEXT_CONTRAST)
  })
})

describe('the page is the host’s in every host (M41 F4)', () => {
  const css = readFileSync(new URL('./frame.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('paints no page background, and only the guard paints Emerald’s own', () => {
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const background = /background:\s*([^;]+);/.exec(body!)?.[1]
      if (background === undefined) continue
      if (selector!.includes('[data-own-surface]')) expect(background).toBe('var(--color-background)')
      else expect(background).toBe('transparent')
    }
    expect(css).toContain('[data-own-surface]')
  })

  it('declares no colour scheme on its root inside VS Code’s webview, whose frame declares none, and keeps the theme on its content', () => {
    expect(/html:root:has\(> body\[data-vscode-theme-kind\]\)\s*\{\s*color-scheme:\s*normal;/.test(css)).toBe(true)
    expect(/\[data-theme="dark"\]:has\(> body\[data-vscode-theme-kind\]\) body\s*\{\s*color-scheme:\s*dark;/.test(css)).toBe(true)
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`with no host colours, Emerald’s ${theme} text and verdicts clear 4.5:1 on the surface it assumes — the theme’s usual one`, () => {
      const colours = Object.fromEntries([...MEANING_TOKENS, ...TEXT_TOKENS].map((token) => [token, emerald(token, theme)]))
      // Emerald's own surface for the theme, and a host's (the stand-in's VS Code palette).
      for (const surface of [emerald('--color-background', theme), parseColour(HOST_THEMES.vscode[theme]['--color-background-primary'])!]) {
        expect(shortfalls(surface, colours)).toEqual([])
      }
      expect(describeApplied({ kind: 'none', theme })).toContain(`assumes the host's surface is that theme's usual one`)
    })
  }

  it('says what the host handed: theme, every variable’s name, what the read ones resolve to, fonts, the page’s own variables', () => {
    expect(describeContext(contextOf({ theme: 'dark' }), {}, 0)).toBe('Host context: theme dark; no styles; fonts none; --vscode-* variables on the page: 0.')
    expect(
      describeContext(
        contextOf({ theme: 'dark', styles: { variables: { '--color-background-primary': 'var(--vscode-editor-background)', '--color-ring-primary': '#0078d4' } } }),
        { '--color-background-primary': '#1f1f1f' },
        412,
      ),
    ).toBe(
      'Host context: theme dark; 2 style variables (--color-background-primary, --color-ring-primary); ' +
        'the ones Emerald reads resolve to --color-background-primary #1f1f1f; fonts none; --vscode-* variables on the page: 412.',
    )
    expect(hexOf({ r: 31, g: 31, b: 31, a: 1 })).toBe('#1f1f1f')
    expect(hexOf({ r: 204, g: 204, b: 204, a: 0.7 })).toBe('#ccccccb3')
  })
})
