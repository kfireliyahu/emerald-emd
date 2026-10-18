import { describe, expect, it } from 'vitest'

import {
  BACKUP_RECORD_NAME,
  BACKUPS_KEPT,
  anyRollingCopyMoment,
  backupsRoot,
  documentBackupFolderName,
  namedCopiesPast,
  newestRollingCopyFirst,
  rollingCopiesPast,
  rollingCopyMoment,
  rollingCopyName,
  sweepBackupFolders,
  writeAtomically,
  RENAME_TRIES,
  type AtomicWriter,
  type BackupFileSystem,
} from './bridge.ts'

/** A file system in a map, so a failure can be put exactly where it is wanted. */
function memoryFs(failOn?: 'writeFile' | 'rename'): AtomicWriter & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    pid: 42,
    writeFile: (path, bytes) => {
      files.set(path, bytes)
      return failOn === 'writeFile' ? Promise.reject(new Error('disk full')) : Promise.resolve()
    },
    rename: (from, to) => {
      if (failOn === 'rename') return Promise.reject(new Error('locked'))
      const bytes = files.get(from)
      if (bytes !== undefined) files.set(to, bytes)
      files.delete(from)
      return Promise.resolve()
    },
    unlink: (path) => {
      files.delete(path)
      return Promise.resolve()
    },
  }
}

describe('writeAtomically (M45 U3)', () => {
  it('writes beside the document and renames over it', async () => {
    const fs = memoryFs()
    fs.files.set('a.emd', new Uint8Array([1]))
    await writeAtomically(fs, 'a.emd', new Uint8Array([2]))
    expect([...fs.files.keys()]).toEqual(['a.emd'])
    expect(fs.files.get('a.emd')).toEqual(new Uint8Array([2]))
  })

  it('leaves no scratch file when the write itself fails, and keeps the original', async () => {
    const fs = memoryFs('writeFile')
    fs.files.set('a.emd', new Uint8Array([1]))
    await expect(writeAtomically(fs, 'a.emd', new Uint8Array([2]))).rejects.toThrow('disk full')
    expect([...fs.files.keys()]).toEqual(['a.emd'])
    expect(fs.files.get('a.emd')).toEqual(new Uint8Array([1]))
  })

  it('leaves no scratch file when the rename fails', async () => {
    const fs = memoryFs('rename')
    await expect(writeAtomically(fs, 'a.emd', new Uint8Array([2]))).rejects.toThrow('locked')
    expect(fs.files.size).toBe(0)
  })
})

describe('writeAtomically over a file another program holds (M47 U7)', () => {
  /** A rename refused `held` times with `code`, then let through; the pauses are counted, not slept. */
  function heldFs(held: number, code = 'EPERM') {
    const fs = memoryFs()
    const pauses: number[] = []
    let refused = 0
    const rename = fs.rename.bind(fs)
    return {
      fs: {
        ...fs,
        rename: (from: string, to: string) => {
          if (refused < held) {
            refused += 1
            return Promise.reject(Object.assign(new Error(`${code}: operation not permitted, rename`), { code }))
          }
          return rename(from, to)
        },
        wait: (ms: number) => {
          pauses.push(ms)
          return Promise.resolve()
        },
      },
      files: fs.files,
      pauses,
    }
  }

  it('tries the rename again while the hold lasts, and writes', async () => {
    const { fs, files, pauses } = heldFs(3)
    files.set('a.emd', new Uint8Array([1]))
    await writeAtomically(fs, 'a.emd', new Uint8Array([2]))
    expect(files.get('a.emd')).toEqual(new Uint8Array([2]))
    expect([...files.keys()]).toEqual(['a.emd'])
    expect(pauses).toHaveLength(3)
  })

  it('refuses after about a second, saying the app has the file, and leaves the original', async () => {
    const { fs, files, pauses } = heldFs(RENAME_TRIES, 'EBUSY')
    files.set('a.emd', new Uint8Array([1]))
    await expect(writeAtomically(fs, 'a.emd', new Uint8Array([2]))).rejects.toThrow(
      /a\.emd is held open by another program — the Emerald app, when the document is open there.*\(EBUSY\)/,
    )
    expect(pauses.reduce((sum, ms) => sum + ms, 0)).toBe(1000)
    expect([...files.keys()]).toEqual(['a.emd'])
    expect(files.get('a.emd')).toEqual(new Uint8Array([1]))
  })

  it('does not wait on a refusal a pause cannot cure', async () => {
    const { fs, pauses } = heldFs(1, 'ENOENT')
    await expect(writeAtomically(fs, 'a.emd', new Uint8Array([2]))).rejects.toThrow('ENOENT')
    expect(pauses).toEqual([])
  })
})

describe('namedCopiesPast (M45 U3)', () => {
  const copy = (stamp: string): string => `memory.before-${stamp}-reading.emd`

  it('keeps the newest, counting the one just kept, and touches nothing else', () => {
    const names = [
      copy('20261001T100000'),
      copy('20261002T100000'),
      copy('20261003T100000'),
      copy('20261004T100000'),
      'memory.emd',
      'memory.pre-M25.emd',
      'memory.before-by-hand.emd',
    ]
    expect(namedCopiesPast('memory.emd', names, copy('20261004T100000'))).toEqual([
      copy('20261001T100000'),
    ])
  })
})

describe("Emerald's own folder of earlier copies (M45 U4, D-455)", () => {
  it('is local and per user on every platform, and a variable moves it', () => {
    expect(backupsRoot('win32', { LOCALAPPDATA: 'C:\\Users\\k\\AppData\\Local' }, 'C:\\Users\\k')).toBe(
      'C:\\Users\\k\\AppData\\Local\\Emerald\\Backups',
    )
    expect(backupsRoot('win32', {}, 'C:\\Users\\k')).toBe('C:\\Users\\k\\AppData\\Local\\Emerald\\Backups')
    expect(backupsRoot('darwin', {}, '/Users/k')).toBe('/Users/k/Library/Application Support/Emerald/Backups')
    expect(backupsRoot('linux', { XDG_STATE_HOME: '/home/k/.state' }, '/home/k')).toBe('/home/k/.state/emerald/backups')
    expect(backupsRoot('linux', { XDG_STATE_HOME: 'relative' }, '/home/k')).toBe('/home/k/.local/state/emerald/backups')
    expect(backupsRoot('linux', { EMERALD_BACKUPS_DIR: '/tmp/x' }, '/home/k')).toBe('/tmp/x')
  })

  it('names a document’s folder for the document, apart from another of the same name', () => {
    const one = documentBackupFolderName('F:\\home\\household.emd', 'win32')
    expect(one).toMatch(/^household-[0-9a-f]{8}$/)
    // The plugin may be handed either separator and either case; the shell gets a dialog's path.
    expect(documentBackupFolderName('f:/home/household.emd', 'win32')).toBe(one)
    expect(documentBackupFolderName('F:\\work\\household.emd', 'win32')).not.toBe(one)
    expect(documentBackupFolderName('/home/k/Household.emd', 'linux')).not.toBe(
      documentBackupFolderName('/home/k/household.emd', 'linux'),
    )
  })

  it('keeps the newest five by the moment in the name, and reads the moment back', () => {
    const at = (second: number): string => rollingCopyName('memory.emd', new Date(Date.UTC(2026, 9, 9, 12, 0, second)))
    expect(at(7)).toBe('memory.emd.20261009T120007.000.bak')
    expect(rollingCopyMoment('memory.emd', at(7))).toBe(Date.UTC(2026, 9, 9, 12, 0, 7))
    expect(rollingCopyMoment('memory.emd', 'other.emd.20261009T120007.bak')).toBeUndefined()
    expect(rollingCopyMoment('memory.emd', 'memory.emd.yesterday.bak')).toBeUndefined()

    const names = [0, 1, 2, 3, 4, 5].map(at)
    expect(BACKUPS_KEPT).toBe(5)
    expect(rollingCopiesPast('memory.emd', [...names, 'notes.txt'], at(5))).toEqual([at(0)])
  })

  it('names a copy to the millisecond with a counter past that, and orders old and new names by moment (M45 F2)', () => {
    const moment = new Date(Date.UTC(2026, 9, 9, 12, 11, 12, 315))
    expect(rollingCopyName('memory.emd', moment)).toBe('memory.emd.20261009T121112.315.bak')
    expect(rollingCopyName('memory.emd', moment, 2)).toBe('memory.emd.20261009T121112.315-2.bak')
    expect(rollingCopyMoment('memory.emd', 'memory.emd.20261009T121112.315-2.bak')).toBe(moment.getTime())
    // A copy named to the second before M45 F2 is still one, at its second's first millisecond.
    expect(rollingCopyMoment('memory.emd', 'memory.emd.20261009T121112.bak')).toBe(Date.UTC(2026, 9, 9, 12, 11, 12))
    expect(rollingCopyMoment('memory.emd', 'memory.emd.20261009T121112.31.bak')).toBeUndefined()
    expect(rollingCopyMoment('memory.emd', 'memory.emd.20261009T121112.315-0.bak')).toBeUndefined()

    const oldest = 'memory.emd.20261009T121111.bak'
    const second = 'memory.emd.20261009T121112.bak'
    const third = 'memory.emd.20261009T121112.315.bak'
    const fourth = 'memory.emd.20261009T121112.315-2.bak'
    const fifth = 'memory.emd.20261009T121112.315-10.bak'
    const newest = 'memory.emd.20261009T121113.002.bak'
    const shuffled = [fourth, newest, oldest, fifth, third, second]
    expect([...shuffled].sort(newestRollingCopyFirst('memory.emd'))).toEqual([newest, fifth, fourth, third, second, oldest])
    expect(rollingCopiesPast('memory.emd', shuffled, newest)).toEqual([oldest])
  })
})

describe('the sweep (M45 F3, D-457)', () => {
  it('reads the moment of any document’s rolling copy, and nothing else', () => {
    expect(anyRollingCopyMoment('a.b.emd.20261009T121112.315-2.bak')).toBe(Date.UTC(2026, 9, 9, 12, 11, 12, 315))
    expect(anyRollingCopyMoment('x.emd.20261009T121112.bak')).toBe(Date.UTC(2026, 9, 9, 12, 11, 12))
    expect(anyRollingCopyMoment(BACKUP_RECORD_NAME)).toBeUndefined()
    expect(anyRollingCopyMoment('x.emd.yesterday.bak')).toBeUndefined()
  })

  it('never throws: a folder it cannot remove, or a root it cannot read, is left for the next copy', async () => {
    const path = '/gone/old.emd'
    const name = documentBackupFolderName(path, 'linux')
    const directory = { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false, size: 0 }
    const file = { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size: 20 }
    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' })
    const fs: BackupFileSystem = {
      readdir: (at) => Promise.resolve(at === 'R' ? [name] : [rollingCopyName('old.emd', new Date(0)), BACKUP_RECORD_NAME]),
      lstat: (at) => Promise.resolve(at.endsWith(BACKUP_RECORD_NAME) ? file : directory),
      stat: (at) => (at === '/' ? Promise.resolve({}) : Promise.reject(missing)),
      readFile: () => Promise.resolve(path),
      writeFile: () => Promise.resolve(),
      rm: () => Promise.reject(new Error('locked')),
      join: (...parts) => parts.join('/'),
      rootOf: () => '/',
    }
    const sweep = { root: 'R', keep: 'other-00000000', now: Date.UTC(2026, 9, 9), platform: 'linux' }

    await expect(sweepBackupFolders(fs, sweep)).resolves.toEqual([])
    await expect(sweepBackupFolders({ ...fs, readdir: () => Promise.reject(missing) }, sweep)).resolves.toEqual([])
    // The same folder goes when it can be removed, which says the refusal above was the rm's.
    await expect(sweepBackupFolders({ ...fs, rm: () => Promise.resolve() }, sweep)).resolves.toEqual([name])
    // And stays while its drive is not there: an unplugged drive is not a gone document.
    await expect(
      sweepBackupFolders({ ...fs, rm: () => Promise.resolve(), stat: () => Promise.reject(missing) }, sweep),
    ).resolves.toEqual([])
  })
})
