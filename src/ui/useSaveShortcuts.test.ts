import { describe, expect, it } from 'vitest'

import { saveShortcut } from './useSaveShortcuts.ts'

const press = (key: string, modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) => ({
  key,
  ctrlKey: modifiers.ctrl ?? false,
  metaKey: modifiers.meta ?? false,
  shiftKey: modifiers.shift ?? false,
})

describe('the save shortcuts', () => {
  it('saves on Ctrl/Cmd+S', () => {
    expect(saveShortcut(press('s', { ctrl: true }))).toBe('save')
    expect(saveShortcut(press('s', { meta: true }))).toBe('save')
  })

  // The File menu and the palette show Ctrl+Shift+S as Save as…; it saved in place (M54 U6, D-531).
  it('saves as on Ctrl/Cmd+Shift+S', () => {
    expect(saveShortcut(press('S', { ctrl: true, shift: true }))).toBe('save-as')
    expect(saveShortcut(press('S', { meta: true, shift: true }))).toBe('save-as')
  })

  it('leaves every other key alone', () => {
    expect(saveShortcut(press('s'))).toBeUndefined()
    expect(saveShortcut(press('d', { ctrl: true }))).toBeUndefined()
  })
})
