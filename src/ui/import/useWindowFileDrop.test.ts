import { describe, expect, it, vi } from 'vitest'

import { watchFileDrag } from '@/ui/import/useWindowFileDrop.ts'

/** A drag event as far as the listeners read one, on a target with no DOM. */
function drag(type: string, extra: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true })
  Object.assign(event, {
    dataTransfer: { types: ['Files'], files: [], dropEffect: 'none' },
    relatedTarget: {},
    ...extra,
  })
  return event
}

function watched() {
  const target = new EventTarget()
  const seen: boolean[] = []
  const files = vi.fn()
  const stop = watchFileDrag(target, { onDragging: (on) => seen.push(on), onFiles: files })
  return { target, seen, files, stop }
}

describe('the window drop overlay (M28 F12)', () => {
  it('stays up while the pointer crosses elements, and goes when it has left them all', () => {
    const { target, seen } = watched()
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('dragleave'))
    expect(seen).toEqual([true])
    target.dispatchEvent(drag('dragleave'))
    expect(seen).toEqual([true, false])
  })

  it('lets go on a drop, even one a screen’s own drop zone stopped', () => {
    const target = new EventTarget()
    const add = vi.spyOn(target, 'addEventListener')
    const seen: boolean[] = []
    watchFileDrag(target, { onDragging: (on) => seen.push(on), onFiles: () => undefined })
    // The clearing drop is a capture listener, so a zone's stopPropagation
    // in the bubble phase cannot keep it from the window.
    expect(add.mock.calls.some(([type, , capture]) => type === 'drop' && capture === true)).toBe(true)

    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('drop'))
    expect(seen).toEqual([true, false])
  })

  it('lets go when the drag leaves the window, whatever the depth', () => {
    const { target, seen } = watched()
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('dragleave', { relatedTarget: null }))
    expect(seen).toEqual([true, false])
  })

  it('lets go on Escape, and a new drag starts from nothing', () => {
    const { target, seen } = watched()
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
    expect(seen).toEqual([true, false])
    target.dispatchEvent(drag('dragenter'))
    target.dispatchEvent(drag('dragleave'))
    expect(seen).toEqual([true, false, true, false])
  })

  it('hands the dropped files on, and ignores a drag that carries none', () => {
    const { target, seen, files } = watched()
    target.dispatchEvent(drag('dragenter', { dataTransfer: { types: ['text/plain'], files: [] } }))
    expect(seen).toEqual([])
    const file = { name: 'a.csv' }
    target.dispatchEvent(drag('drop', { dataTransfer: { types: ['Files'], files: [file] } }))
    expect(files).toHaveBeenCalledWith([file])
  })
})
