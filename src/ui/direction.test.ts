import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { arrowStep, pageIsRtl } from './direction.ts'

/**
 * **In Hebrew the layout mirrors, and English is unchanged** — M60 U3 (D-586).
 *
 * Every class that names a side is a logical one (`ms-`, `pe-`, `start-`,
 * `border-s`, `rounded-e`, `text-end`), so `<html dir="rtl">` mirrors the screen
 * and `ltr` draws it exactly as before. A physical one (`ml-`, `pr-`, `left-`,
 * `border-l`, `rounded-r`, `text-left`) is a screen that does not mirror, and
 * this fails on it. A chart keeps time running left to right (`dir="ltr"` on
 * it), so `src/ui/charts/` may name sides.
 */

const ALLOWED = ['src/ui/charts/']

const SPACE = String.raw`(?:\d+(?:\.\d+)?|px|full|auto|\d+\/\d+|\[[^\]\s]+\]|\([^)\s]+\))`
const COLOR_OR_WIDTH = String.raw`(?:\d+|\[[^\]\s]+\]|\([^)\s]+\)|[a-z]+(?:-[a-z0-9]+)*(?:\/\d+)?)`
const RADIUS = String.raw`(?:none|xs|sm|md|lg|xl|2xl|3xl|full|card|control|\[[^\]\s]+\]|\([^)\s]+\))`
const BEFORE = String.raw`(?<=^|[\s"'\x60{(:!,])`
const AFTER = String.raw`(?=$|[\s"'\x60)},])`
const PHYSICAL = new RegExp(
  [
    `${BEFORE}-?(?:ml|mr|pl|pr|scroll-ml|scroll-mr|scroll-pl|scroll-pr|left|right)-${SPACE}${AFTER}`,
    `${BEFORE}border-[lr](?:-${COLOR_OR_WIDTH})?${AFTER}`,
    `${BEFORE}rounded-(?:l|r|tl|tr|bl|br)(?:-${RADIUS})?${AFTER}`,
    `${BEFORE}(?:text|float|clear)-(?:left|right)${AFTER}`,
  ].join('|'),
  'g',
)

/** The physical classes in a source text. */
export function physicalClasses(text: string): string[] {
  return [...text.matchAll(PHYSICAL)].map((match) => match[0])
}

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const at = path.join(dir, name)
    if (statSync(at).isDirectory()) out.push(...sources(at))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(at.split(path.sep).join('/'))
  }
  return out
}

describe('the layout mirrors (M60 U3, D-586)', () => {
  it('finds the physical classes it is meant to', () => {
    expect(physicalClasses('className="ml-2 pr-4 left-0 -right-1.5 border-l-2 rounded-tr-md text-right md:pl-[3px]"')).toEqual([
      'ml-2',
      'pr-4',
      'left-0',
      '-right-1.5',
      'border-l-2',
      'rounded-tr-md',
      'text-right',
      'pl-[3px]',
    ])
    expect(physicalClasses('className="ms-2 pe-4 start-0 border-s-2 rounded-se-md text-end inset-x-0"')).toEqual([])
    // Words are not classes.
    expect(physicalClasses("'right-click' and the left-out rows, right-aligned")).toEqual([])
  })

  it('names no side in src/ui outside the charts, and none in the app shell', () => {
    const files = [...sources('src/ui'), 'src/App.tsx'].filter((file) => !ALLOWED.some((allowed) => file.startsWith(allowed)))
    expect(files.length).toBeGreaterThan(100)
    const found = files.flatMap((file) => physicalClasses(readFileSync(file, 'utf8')).map((cls) => `${file}: ${cls}`))
    expect(found).toEqual([])
  })

  it('keeps tokens.css to logical sides, but for what is placed by measuring', () => {
    const css = readFileSync('src/ui/theme/tokens.css', 'utf8')
    // The guide's arrow and toast are placed by the guide from measured boxes,
    // and a rule for Hebrew alone says its side on purpose.
    const placed = /(?:\.fc-guide-(?:arrow|toast)|\[dir='rtl'\])[^{]*\{[^}]*\}/g
    const rest = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(placed, '')
    expect(rest.match(/^\s*(?:left|right|margin-(?:left|right)|padding-(?:left|right)|border-(?:left|right)[a-z-]*)\s*:.*$|^\s*text-align:\s*(?:left|right).*$/gm) ?? []).toEqual([])
  })

  it('draws a chart left to right in either language', () => {
    expect(readFileSync('src/ui/charts/Chart.tsx', 'utf8')).toContain('<figure className="m-0" dir="ltr">')
  })
})

describe('arrowStep', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('steps forward on → in English', () => {
    vi.stubGlobal('document', { documentElement: { dir: '' } })
    expect(pageIsRtl()).toBe(false)
    expect(arrowStep('ArrowRight')).toBe(1)
    expect(arrowStep('ArrowLeft')).toBe(-1)
    expect(arrowStep('Enter')).toBe(0)
  })

  it('steps forward on ← in Hebrew, where the next thing is drawn on the left', () => {
    vi.stubGlobal('document', { documentElement: { dir: 'rtl' } })
    expect(pageIsRtl()).toBe(true)
    expect(arrowStep('ArrowLeft')).toBe(1)
    expect(arrowStep('ArrowRight')).toBe(-1)
  })
})
