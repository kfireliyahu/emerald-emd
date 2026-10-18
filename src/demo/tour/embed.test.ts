import { describe, expect, it, vi } from 'vitest'
import { EMBED_SOURCE, messageBetween, resetMessage, tell } from './embed.ts'

const at = (mode: 'ready' | 'opening' | 'watch' | 'try' | 'catching-up', scene: number, lost?: string) => ({ mode, scene, lost })

describe('what the frame tells its page (M33 U4)', () => {
  it('says a step when one comes up while the tour plays, counted from 1', () => {
    expect(messageBetween(at('opening', 0), at('watch', 0), 5)).toEqual({ source: EMBED_SOURCE, event: 'step', step: 1, of: 5 })
    expect(messageBetween(at('watch', 0), at('watch', 1), 5)).toMatchObject({ event: 'step', step: 2 })
    // The loop starting over is a step too.
    expect(messageBetween(at('watch', 4), at('watch', 0), 5)).toMatchObject({ event: 'step', step: 1 })
  })

  it('says nothing for a row inside the same step, while it waits, or while it fast-forwards', () => {
    expect(messageBetween(at('watch', 2), at('watch', 2), 5)).toBeUndefined()
    expect(messageBetween(undefined, at('ready', 0), 5)).toBeUndefined()
    expect(messageBetween(at('watch', 2), at('catching-up', 0), 5)).toBeUndefined()
    expect(messageBetween(at('catching-up', 0), at('catching-up', 3), 5)).toBeUndefined()
    // Back to watching after a fast-forward: the step it came back to.
    expect(messageBetween(at('catching-up', 3), at('watch', 3), 5)).toMatchObject({ event: 'step', step: 4 })
  })

  it('says took-over once, at the step the visitor took it over at — and not when the tour lost its way', () => {
    expect(messageBetween(at('watch', 2), at('try', 2), 5)).toEqual({ source: EMBED_SOURCE, event: 'took-over', step: 3, of: 5 })
    expect(messageBetween(at('try', 2), at('try', 2), 5)).toBeUndefined()
    expect(messageBetween(at('watch', 2), at('try', 2, 'Step 3 never came.'), 5)).toBeUndefined()
  })

  it('a Reset goes back to the first step', () => {
    expect(resetMessage(5)).toEqual({ source: EMBED_SOURCE, event: 'reset', step: 1, of: 5 })
  })

  it('posts to the parent only, and not at all when the frame is the top page', () => {
    const postMessage = vi.fn()
    const parent = { postMessage } as unknown as Window
    tell(resetMessage(5), { parent } as unknown as Window)
    expect(postMessage).toHaveBeenCalledWith(resetMessage(5), '*')

    const top = { postMessage: vi.fn() } as unknown as Window & { parent: Window }
    ;(top as { parent: Window }).parent = top
    tell(resetMessage(5), top)
    expect(top.postMessage).not.toHaveBeenCalled()
  })
})
