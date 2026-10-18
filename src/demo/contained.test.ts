import { describe, expect, it } from 'vitest'
import { containScrolling } from './contained.ts'

/** Just enough of a window: the two prototypes and whether it has a parent. */
function fakeWindow(embedded: boolean) {
  const calls: (FocusOptions | undefined)[] = []
  class FakeElement {
    scrollIntoView(): void {
      calls.push({ preventScroll: false })
    }
  }
  class FakeHTMLElement extends FakeElement {
    parentElement = null
    ownerDocument = { defaultView: null, body: null }
    focus(options?: FocusOptions): void {
      calls.push(options)
    }
  }
  const win = { Element: FakeElement, HTMLElement: FakeHTMLElement } as unknown as Window & typeof globalThis
  ;(win as { parent: unknown }).parent = embedded ? {} : win
  return { win, calls, element: new FakeHTMLElement() as unknown as HTMLElement }
}

describe('containScrolling', () => {
  it('makes every focus in an embedded app leave the page around it where it is', () => {
    const { win, calls, element } = fakeWindow(true)
    containScrolling(win)
    element.focus()
    element.focus({ focusVisible: true } as FocusOptions)
    expect(calls).toEqual([{ preventScroll: true }, { focusVisible: true, preventScroll: true }])
  })

  it('bounds scrollIntoView to the app’s own document', () => {
    const { win, calls, element } = fakeWindow(true)
    containScrolling(win)
    element.scrollIntoView()
    expect(calls).toEqual([])
  })

  it('changes nothing when the app is not embedded', () => {
    const { win, calls, element } = fakeWindow(false)
    containScrolling(win)
    element.focus()
    element.scrollIntoView()
    expect(calls).toEqual([undefined, { preventScroll: false }])
  })
})
