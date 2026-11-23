import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { tempDir } from '../src/testing/tempDir'

import { checkExportFiles, exportFilesOf, writeExportFiles, type ExportFileSystem } from './exportFiles.ts'

/** A disk in memory, by absolute path, that records every write. */
function memory(held: Record<string, string> = {}): ExportFileSystem & { readonly writes: string[] } {
  const files = new Map(Object.entries(held))
  const writes: string[] = []
  return {
    writes,
    read: (path) => Promise.resolve(files.get(path)),
    write: (path, text) => {
      writes.push(path)
      files.set(path, text)
      return Promise.resolve()
    },
  }
}

describe('saved exports in the main process (M63 U4, D-605)', () => {
  const folder = join(tmpdir(), 'shop')
  const document = join(folder, 'shop.emd')

  it('refuses ../x.json and a path in another folder, reading and writing neither, and writes the rest', async () => {
    const disk = memory()
    const elsewhere = join(tmpdir(), 'elsewhere', 'x.json')
    const files = [
      { file: '../x.json', text: '[]\n' },
      { file: elsewhere, text: '[]\n' },
      { file: 'out/items.json', text: '[]\n' },
    ]
    expect(await checkExportFiles(document, files, disk)).toEqual([
      { file: '../x.json', state: 'refused' },
      { file: elsewhere, state: 'refused' },
      { file: 'out/items.json', state: 'missing' },
    ])
    expect(await writeExportFiles(document, files, disk)).toEqual([
      { file: '../x.json', state: 'refused' },
      { file: elsewhere, state: 'refused' },
      { file: 'out/items.json', state: 'written' },
    ])
    expect(disk.writes).toEqual([join(folder, 'out', 'items.json')])
  })

  it('calls a file current, stale or missing, and leaves a current one unwritten', async () => {
    const disk = memory({ [join(folder, 'a.json')]: 'same\n', [join(folder, 'b.json')]: 'old\n' })
    const files = [
      { file: 'a.json', text: 'same\n' },
      { file: 'b.json', text: 'new\n' },
      { file: 'c.json', text: 'new\n' },
    ]
    expect((await checkExportFiles(document, files, disk)).map((each) => each.state)).toEqual(['current', 'differs', 'missing'])
    expect((await writeExportFiles(document, files, disk)).map((each) => each.state)).toEqual(['current', 'written', 'written'])
    expect(disk.writes).toEqual([join(folder, 'b.json'), join(folder, 'c.json')])
    expect((await checkExportFiles(document, files, disk)).map((each) => each.state)).toEqual(['current', 'current', 'current'])
  })

  it('writes on the real disk, making the folder', async () => {
    const root = await tempDir('emerald-exports-')
    const path = join(root, 'doc.emd')
    await writeFile(path, '')
    const files = [{ file: 'site/data.json', text: '[]\n' }]
    expect(await writeExportFiles(path, files)).toEqual([{ file: 'site/data.json', state: 'written' }])
    expect(await readFile(join(root, 'site', 'data.json'), 'utf8')).toBe('[]\n')
    expect(await checkExportFiles(path, files)).toEqual([{ file: 'site/data.json', state: 'current' }])
  })

  it('refuses a list the page did not shape as files and their text', () => {
    expect(() => exportFilesOf('x.json')).toThrow('list of files')
    expect(() => exportFilesOf([{ file: 'x.json' }])).toThrow('a file and its text')
    expect(exportFilesOf([{ file: 'x.json', text: '[]', extra: 1 }])).toEqual([{ file: 'x.json', text: '[]' }])
  })
})
