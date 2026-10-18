import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { backupsRoot } from './bridge.ts'

/**
 * **The Windows uninstaller takes Emerald's folder of earlier copies** (M45 F3, D-457).
 * electron-builder includes `build/installer.nsh` by name — `directories.buildResources` is
 * `build`, and a file called `installer.nsh` there is its default `nsis.include` — and the
 * uninstaller inserts `customUnInstall`. This holds the script to the folder `backupsRoot`
 * names, so the two cannot drift; that the macro reaches the generated uninstaller was read
 * in a `dist:win` build's NSIS (`release/builder-debug.yml`) when it landed.
 */
const script = readFileSync(join(import.meta.dirname, '..', 'build', 'installer.nsh'), 'utf8')

describe('the uninstaller (M45 F3, D-457)', () => {
  it('removes the folder backupsRoot names on Windows, and only on an uninstall, never an update', () => {
    const folder = backupsRoot('win32', { LOCALAPPDATA: '$LOCALAPPDATA' }, 'unused')
    const macro = /!macro customUnInstall\r?\n([\s\S]*?)!macroend/.exec(script)?.[1] ?? ''

    expect(macro).toContain(`RMDir /r "${folder}"`)
    // electron-builder runs the old uninstaller silently when an update installs.
    const guarded = /\$\{ifNot\} \$\{isUpdated\}([\s\S]*?)\$\{endIf\}\s*$/.exec(macro)?.[1] ?? ''
    expect(guarded).toContain(`RMDir /r "${folder}"`)
    // Emerald's own folder goes only when it is empty: no /r.
    expect(macro).toMatch(/RMDir "\$LOCALAPPDATA\\Emerald"\r?\n/)
  })

  it('is where electron-builder looks for it', () => {
    const config = readFileSync(join(import.meta.dirname, '..', 'electron-builder.yml'), 'utf8')
    expect(config).toMatch(/^\s+buildResources: build$/m)
    expect(config).not.toMatch(/^\s+include:/m)
  })
})
