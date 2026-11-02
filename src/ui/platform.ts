import { shellBridge } from '@/data/storage/desktop.ts'

/**
 * **Which machine this window is on**, as the words on a screen need it
 * (M54 F6): `⌘S` on a Mac and `Ctrl+S` everywhere else, and the desktop
 * assistant's configuration that starts `npx` through `cmd` on Windows. The
 * shell knows its platform; a browser tab is asked through `navigator`, and a
 * tab that will not say is neither — as `commandPaletteKey` reads it.
 */
function platform(): string {
  return shellBridge()?.platform ?? (typeof navigator === 'undefined' ? '' : navigator.platform)
}

export function isMac(): boolean {
  return /^(darwin|mac)/i.test(platform())
}

export function isWindows(): boolean {
  return /^win/i.test(platform())
}

/** The modifier a shortcut is written with here: `⌘` on a Mac, `Ctrl` elsewhere. */
export function modifierKey(): '⌘' | 'Ctrl' {
  return isMac() ? '⌘' : 'Ctrl'
}
