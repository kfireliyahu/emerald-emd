import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * **The tour's chrome** (M54 F11, D-531, D-532): what U8's review found and
 * the maintainer ruled, held where a later edit would undo it.
 */
const css = readFileSync('src/demo/tour/frame.css', 'utf8')
const sheet = css.replace(/\n:root \{[^}]*\}/, '')
const frame = readFileSync('src/demo/tour/Frame.tsx', 'utf8')

describe('frame.css spends a token set of its own (rule Every value is a token)', () => {
  it('declares its tokens once, at its root: spacing, a rem ramp, sizes and named durations', () => {
    expect(css).toMatch(/\n:root \{[^}]*--tour-space-2:[^}]*--tour-text-body: [\d.]+rem;[^}]*--tour-travel:[^}]*--tour-ease:/)
  })

  it('spaces with its steps: no number in a margin, padding, gap or inset', () => {
    const spacing = /\n\s*((?:margin|padding|gap|row-gap|column-gap|inset|top|bottom|left|right)(?:-[a-z-]+)?):\s*([^;]+);/g
    const literal = [...sheet.matchAll(spacing)]
      .filter(([, , value = '']) => /(^|[\s(])-?\d*\.?\d+(px|rem)/.test(value.replace(/calc\(-1 \* var\([^)]*\)\)/g, '')))
      .map(([line = '']) => line.trim())
    expect(literal).toEqual([])
  })

  it('sizes its type from its own ramp, and times its motion with named durations', () => {
    const sizes = [...sheet.matchAll(/font-size:\s*([^;]+);/g)].map(([, value = '']) => value)
    expect(sizes.filter((value) => value !== '100%' && !value.startsWith('var(--tour-text-'))).toEqual([])
    expect(sheet.match(/\b\d+ms\b/g) ?? []).toEqual([])
    // Crossfade's latest is the sheet's token, read at run time.
    expect(frame).not.toMatch(/setTimeout\([^)]*\b\d{3,}\)/)
    expect(frame).toContain("getPropertyValue('--tour-fade-gone')")
  })

  it('reads at the browser’s own size (rem for type)', () => {
    expect(css).toMatch(/\nhtml \{\s*font-size: 100%;\s*\}/)
  })
})

describe('the tour’s chrome keeps the ui rule rows (D-531)', () => {
  it('writes what a visitor reads, and a dot’s only edge, in ink-secondary — never ink-tertiary', () => {
    expect(css).not.toContain('ink-tertiary')
    expect(css).not.toMatch(/\.tour-line\.was \{[^}]*opacity/)
  })

  it('casts no shadow: a picture or a card in the tour is not a room that floats', () => {
    expect(css).not.toMatch(/box-shadow/)
  })

  it('draws its outline square', () => {
    expect(frame).toMatch(/<rect x="1" y="1" pathLength=\{100\} \/>/)
    expect(frame).not.toMatch(/\brx=/)
  })
})

describe('the tour can be paused, and walked by a keyboard (M54 F11, D-532)', () => {
  it('has one Pause, named the same whichever state, pressed while paused', () => {
    expect(frame).toMatch(/className="tour-pause"\s+aria-pressed=\{state\.paused\}\s+aria-label="Pause"/)
    expect(frame.match(/>\s*Pause\s*</g)?.length).toBe(1)
    expect(frame).not.toMatch(/>\s*Play\s*</)
  })

  it('makes Watch / Try it one Tab stop moved by the arrows, with neither checked on the held first frame', () => {
    expect(frame).toMatch(/const chosenSide = waiting \? undefined : trying \? 1 : 0/)
    expect(frame).toMatch(/tabIndex=\{chosenSide === side \|\| \(chosenSide === undefined && side === 0\) \? 0 : -1\}/)
    expect(frame).toMatch(/onKeyDown=\{\(event\) => segKey\(event, side\)\}/)
  })

  it('names the current step', () => {
    expect(frame).toMatch(/aria-current=\{index === state\.scene \? 'step' : undefined\}/)
  })

  it('keeps the app out of the keyboard’s reach while it is watched', () => {
    expect(frame).toMatch(/frame\.inert = !trying/)
    expect(frame).toMatch(/win\?\.addEventListener\('keydown', stays, true\)/)
  })

  it('lands a click mid-move on what was under it', () => {
    expect(frame).toMatch(/onClick=\{waiting \? \(\) => player\.start\(\) : movie \? undefined : takeOverAt\}/)
    expect(frame).toMatch(/click\(target as HTMLElement, point\)/)
  })
})
