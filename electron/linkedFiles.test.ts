import { describe, expect, it, vi } from 'vitest'

import { LOCAL_SCHEMES as ENGINE_SCHEMES } from '../src/domain/format/file.ts'
import { LOCAL_SCHEMES } from './bridge.ts'
import { isProgram, linkedTarget, openLinked, presentLinked, showLinked, type LinkedFileSystem } from './linkedFiles.ts'

/** A shell and a disk that hold only `there`, and record what they were asked to open. */
function fakeIo(there: readonly string[], platform = 'win32') {
  const shell = {
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
    showItemInFolder: vi.fn(),
  }
  const io: LinkedFileSystem = { shell, platform, exists: async (path) => there.includes(path) }
  return { io, shell }
}

describe('the gate a file cell’s click goes through (M37 U6)', () => {
  it('keeps one list of local schemes with the engine', () => {
    expect([...LOCAL_SCHEMES]).toEqual([...ENGINE_SCHEMES])
  })

  it('hands a local app its own address, and refuses every scheme off the list — the web first', () => {
    expect(linkedTarget('obsidian://open?vault=Notes&file=plan', 'win32')).toEqual({
      kind: 'address',
      address: 'obsidian://open?vault=Notes&file=plan',
    })
    for (const address of ['https://example.com/a.pdf', 'http://example.com', 'HTTPS://example.com']) {
      const target = linkedTarget(address, 'win32')
      expect(target.kind).toBe('refused')
      expect(target.kind === 'refused' && target.why).toMatch(/request, and Emerald makes none/)
    }
    for (const address of ['ftp://example.com/x', 'smb://host/share', 'mailto:someone@example.com', 'javascript:alert(1)', 'ms-settings:']) {
      expect(linkedTarget(address, 'win32').kind, address).toBe('refused')
    }
  })

  it('refuses a share on another machine, and a path that is not absolute', () => {
    expect(linkedTarget('\\\\host\\share\\a.pdf', 'win32').kind).toBe('refused')
    expect(linkedTarget('//host/share/a.pdf', 'linux').kind).toBe('refused')
    expect(linkedTarget('scans/a.pdf', 'win32').kind).toBe('refused')
    expect(linkedTarget('', 'win32').kind).toBe('refused')
    expect(linkedTarget(42, 'win32').kind).toBe('refused')
  })

  it('reads a drive path on Windows and a root path elsewhere', () => {
    expect(linkedTarget('C:/work/plans/a.pdf', 'win32')).toEqual({ kind: 'path', path: 'C:\\work\\plans\\a.pdf' })
    expect(linkedTarget('/home/someone/a.pdf', 'linux')).toEqual({ kind: 'path', path: '/home/someone/a.pdf' })
    expect(linkedTarget('C:/a.pdf', 'linux').kind).toBe('refused')
  })

  it('knows a program by its kind', () => {
    expect(isProgram('C:\\tools\\setup.EXE')).toBe(true)
    expect(isProgram('/home/someone/run.sh')).toBe(true)
    expect(isProgram('C:\\work\\plan.pdf')).toBe(false)
    expect(isProgram('C:\\work\\.exe')).toBe(false)
  })

  it('opens a file that is there, says one that is not is missing, and never runs a program', async () => {
    const { io, shell } = fakeIo(['C:\\work\\a.pdf', 'C:\\work\\setup.exe'])
    expect(await openLinked('C:/work/a.pdf', io)).toBeUndefined()
    expect(shell.openPath).toHaveBeenCalledWith('C:\\work\\a.pdf')
    expect(await openLinked('C:/work/gone.pdf', io)).toBe('No file is there now.')
    expect(await openLinked('C:/work/setup.exe', io)).toMatch(/program/)
    expect(shell.openPath).toHaveBeenCalledTimes(1)
    expect(await openLinked('https://example.com', io)).toMatch(/request/)
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(await openLinked('obsidian://open?vault=Notes', io)).toBeUndefined()
    expect(shell.openExternal).toHaveBeenCalledWith('obsidian://open?vault=Notes')
  })

  it('shows a file in its folder, program or not, and says which are there', async () => {
    const { io, shell } = fakeIo(['C:\\work\\setup.exe'])
    expect(await showLinked('C:/work/setup.exe', io)).toBeUndefined()
    expect(shell.showItemInFolder).toHaveBeenCalledWith('C:\\work\\setup.exe')
    expect(await showLinked('C:/work/gone.pdf', io)).toBe('No file is there now.')
    expect(await presentLinked(['C:/work/setup.exe', 'C:/work/gone.pdf', '//host/x', 'https://a'], io)).toEqual([
      true,
      false,
      false,
      false,
    ])
    expect(await presentLinked('not a list', io)).toEqual([])
  })
})
