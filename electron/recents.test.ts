import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  decodeRecents,
  encodeRecents,
  loadRecents,
  RECENT_LIMIT,
  saveRecents,
  withRecent,
  withoutRecent,
  type RecentDocument,
} from './recents.ts'
import { tempDir } from '../src/testing/tempDir'

/**
 * The recents list (D-128). It is authority as much as convenience — every
 * path in it is granted at startup — so the two things worth proving are that
 * it holds what the user actually opened, and that a corrupted file on disk
 * costs the entry rather than the app's ability to start.
 */

let directory: string

beforeEach(async () => {
  directory = await tempDir('emerald-recents-')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function entry(path: string, openedAt = 1): RecentDocument {
  return { path: resolve(path), name: path.slice(path.lastIndexOf('/') + 1), openedAt }
}

describe('withRecent', () => {
  it('puts the newest first and keeps the basename for the menu', () => {
    const list = withRecent([], join(directory, 'finances.emd'), 10)
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('finances.emd')
    expect(list[0]?.openedAt).toBe(10)
  })

  it('moves a document already in the list rather than repeating it', () => {
    const first = join(directory, 'a.emd')
    const second = join(directory, 'b.emd')
    const list = withRecent(withRecent([], first, 1), second, 2)

    const reopened = withRecent(list, first, 3)

    expect(reopened.map((row) => row.path)).toEqual([resolve(first), resolve(second)])
    expect(reopened).toHaveLength(2)
  })

  it('is not fooled into a duplicate by a path that walks back to itself', () => {
    const list = withRecent([], join(directory, 'finances.emd'), 1)
    const again = withRecent(list, join(directory, 'nested', '..', 'finances.emd'), 2)
    expect(again).toHaveLength(1)
  })

  it('stops at the limit, dropping the oldest', () => {
    let list: RecentDocument[] = []
    for (let index = 0; index < RECENT_LIMIT + 4; index++) {
      list = withRecent(list, join(directory, `doc-${index}.emd`), index)
    }
    expect(list).toHaveLength(RECENT_LIMIT)
    expect(list[0]?.name).toBe(`doc-${RECENT_LIMIT + 3}.emd`)
  })
})

describe('withoutRecent', () => {
  it('drops a document that is not there any more', () => {
    const gone = join(directory, 'gone.emd')
    const list = withRecent(withRecent([], gone, 1), join(directory, 'here.emd'), 2)
    expect(withoutRecent(list, gone).map((row) => row.name)).toEqual(['here.emd'])
  })
})

describe('decodeRecents', () => {
  it('reads back what it wrote', () => {
    const list = [entry('/home/k/finances.emd', 7)]
    expect(decodeRecents(encodeRecents(list))).toEqual(list)
  })

  it('is empty rather than broken for a file that is not JSON at all', () => {
    expect(decodeRecents('')).toEqual([])
    expect(decodeRecents('{ half a fi')).toEqual([])
    expect(decodeRecents('"a string"')).toEqual([])
  })

  it('drops the rows it cannot use and keeps the rest', () => {
    const text = JSON.stringify([
      { path: '/home/k/one.emd', name: 'one.emd', openedAt: 5 },
      { name: 'no path here' },
      null,
      42,
      { path: '', name: 'empty' },
      { path: '/home/k/two.emd' },
    ])

    const decoded = decodeRecents(text)

    expect(decoded.map((row) => row.path)).toEqual(['/home/k/one.emd', '/home/k/two.emd'])
    // A missing name is recoverable from the path; a missing timestamp is not
    // worth losing the entry over.
    expect(decoded[1]?.name).toBe('two.emd')
    expect(decoded[1]?.openedAt).toBe(0)
  })
})

describe('the file on disk', () => {
  it('is an empty list before anything has been opened', async () => {
    expect(await loadRecents(join(directory, 'recents.json'))).toEqual([])
  })

  it('round-trips', async () => {
    const file = join(directory, 'recents.json')
    const list = withRecent([], join(directory, 'finances.emd'), 3)

    await saveRecents(file, list)

    expect(await loadRecents(file)).toEqual(list)
    // Readable by a person, because it is a list of their own file paths.
    expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true)
  })
})
