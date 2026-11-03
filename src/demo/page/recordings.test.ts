import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLAUDE_RECORDINGS, DEVELOPMENT_RECORDING, posterOf } from './page.ts'
import { en } from './copy/en.ts'

/** Where the demo build copies the recordings from (scripts/make-demo-document.mjs). */
const FIXTURES = 'fixtures/synthetic/demo'

describe('the recordings on the page (M33 F11, M56 U6)', () => {
  it('names no file it does not have: a named clip and its poster frame are in the fixtures', () => {
    if (DEVELOPMENT_RECORDING !== '') expect(existsSync(`${FIXTURES}/${DEVELOPMENT_RECORDING}`)).toBe(true)
    for (const file of Object.values(CLAUDE_RECORDINGS)) {
      if (file === '') continue
      expect(existsSync(`${FIXTURES}/${file}`), file).toBe(true)
      expect(existsSync(`${FIXTURES}/${posterOf(file)}`), posterOf(file)).toBe(true)
    }
  })

  it('a clip’s poster frame is the PNG of the same name', () => {
    expect(posterOf('claude-pane.mp4')).toBe('claude-pane.png')
    expect(posterOf('claude-inbox.webm')).toBe('claude-inbox.png')
  })

  it('every clip has its figure in the markup and its caption in the copy', () => {
    const markup = readFileSync('demo-page.html', 'utf8')
    const figures = [...markup.matchAll(/data-clip="([a-z]+)"/g)].map((match) => match[1])
    expect(figures).toEqual(Object.keys(CLAUDE_RECORDINGS))
    for (const clip of Object.keys(CLAUDE_RECORDINGS)) {
      expect(markup).toContain(`data-t="claude.${clip}"`)
      expect(en.claude[clip as keyof typeof CLAUDE_RECORDINGS]).not.toBe('')
    }
  })
})
