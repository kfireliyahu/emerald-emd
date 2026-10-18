import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'

import { exportEncoded } from '@/data/storage/encoding.ts'

import { openDocumentForWriting } from './document.ts'
import { compareRows, matching, readFormat, watchFormat, type FormatChange, type WatchedRow } from './formatWatch.ts'
import { createServer } from './server.ts'
import { formatUri, subscriptionTargetOf } from './subscriptions.ts'
import { NO_CLIENT } from './tools/tool.ts'
import { createDocumentTool } from './tools/setup.ts'
import { recordFormatRowsTool } from './tools/formats.ts'
import { watchedDocumentCount } from './watch.ts'
import { changeLine, parseWatchArgs } from './watchCommand.ts'
import { tempDir } from '../testing/tempDir'

/**
 * **Told when one format's rows change, and only then** (M44 U3). Proved on a
 * document stored as text, because that is where every id is renewed on every
 * write (D-246) and a comparison by id would call every row changed.
 */

function row(label: string, extra: Record<string, string> = {}): WatchedRow {
  const cells = { subject: label, state: 'new', ...extra }
  return { label, cells, key: JSON.stringify(Object.values(cells)) }
}

const quiet = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A development-pack document, stored as text. */
async function aTextDocument(): Promise<string> {
  const path = join(await tempDir('emerald-format-watch-'), 'memory.emd')
  await createDocumentTool.run({ path, packs: ['development'] }, { engineOnly: true })
  const opened = await openDocumentForWriting(path)
  if (!opened.ok) throw new Error(opened.error.message)
  const text = await exportEncoded(opened.value.db, 'text')
  opened.value.db.close()
  if (!text.ok) throw new Error(text.error)
  await writeFile(path, text.value)
  return path
}

async function sendInbox(path: string, subject: string): Promise<void> {
  const answer = await recordFormatRowsTool.run(
    {
      path,
      format: 'inbox',
      rows: [{ subject, from: 'F:/projects/notes/notes.emd', sent_on: '2026-10-08', state: 'new' }],
      commit: true,
    },
    NO_CLIENT,
  )
  expect(answer).not.toMatch(/refus|cannot/i)
}

async function writeUnit(path: string, ref: string): Promise<void> {
  await recordFormatRowsTool.run(
    {
      path,
      format: 'unit',
      rows: [{ ref, milestone: 'M1', scope: 'engine', title: `A unit, ${ref}`, state: 'planned' }],
      commit: true,
    },
    NO_CLIENT,
  )
}

afterEach(() => {
  expect(watchedDocumentCount()).toBe(0)
})

describe('comparing two readings of a format (M44 U3)', () => {
  it('finds a row that arrived, one that left, and one edited under the same name', () => {
    const before = [row('kept'), row('edited'), row('dropped')]
    const after = [row('edited', { state: 'triaged' }), row('kept'), row('arrived')]
    const change = compareRows(before, after)
    expect(change.added.map((one) => one.label)).toEqual(['arrived'])
    expect(change.removed.map((one) => one.label)).toEqual(['dropped'])
    expect(change.changed.map((one) => [one.before.cells['state'], one.after.cells['state']])).toEqual([['new', 'triaged']])
  })

  it('finds nothing when only the order moved, and counts two identical rows as two', () => {
    expect(compareRows([row('a'), row('b')], [row('b'), row('a')])).toEqual({ added: [], changed: [], removed: [] })
    const twice = compareRows([row('same')], [row('same'), row('same')])
    expect(twice.added).toHaveLength(1)
  })

  it('matches the way format_rows does: without regard to case, and a list by one member', () => {
    const rows = [row('one'), row('two', { state: 'Triaged' }), row('three', { refs: 'D-1, D-2' })]
    expect(matching(rows, new Map([['state', 'triaged']])).map((one) => one.label)).toEqual(['two'])
    expect(matching(rows, new Map([['refs', 'd-2']])).map((one) => one.label)).toEqual(['three'])
    expect(matching(rows, undefined)).toHaveLength(3)
  })
})

describe('watching one format of a document stored as text', () => {
  it('hears a new inbox row by its subject, and nothing of a write to another format', async () => {
    const path = await aTextDocument()
    const heard: FormatChange[] = []
    const stop = await watchFormat({ path, format: 'inbox', onChange: (change) => heard.push(change) })
    try {
      // Every id in the file is renewed by this write, and the inbox did not move.
      await writeUnit(path, 'M1 U1')
      await quiet(800)
      expect(heard).toEqual([])

      await sendInbox(path, 'A fact from the identity project')
      await quiet(800)
      expect(heard.map((change) => change.added.map((one) => one.label))).toEqual([['A fact from the identity project']])
    } finally {
      stop()
    }
  }, 30_000)

  it('reads a link by the name of the row it names, so a renewed id is not a change', async () => {
    const path = await aTextDocument()
    const reading = await readFormat(path, 'inbox')
    expect(reading.kind === 'rows' && reading.columns).toContain('became_unit')
    expect((await readFormat(path, 'nothing')).kind).toBe('problem')
    expect((await readFormat(join(path, '..', 'gone.emd'), 'inbox')).kind).toBe('gone')
  })
})

describe('one format as a resource you subscribe to', () => {
  it('is the document’s URI with the format as its fragment, and leaves U2’s URIs as they were', () => {
    const path = join(process.cwd(), 'docs', 'memory.emd')
    expect(subscriptionTargetOf(formatUri(path, 'inbox'))).toEqual({ path, format: 'inbox' })
    expect(subscriptionTargetOf(`${path}#inbox`)).toEqual({ path, format: 'inbox' })
    expect(subscriptionTargetOf(path)).toEqual({ path })
    expect(subscriptionTargetOf(formatUri(path, 'inbox').replace(/#inbox$/, ''))).toEqual({ path })
    // A `#` that is not followed by a format's name is part of the file's name.
    expect(subscriptionTargetOf(`${path}#not a name`)).toEqual({ path: `${path}#not a name` })
    expect(subscriptionTargetOf('memory.emd#inbox')).toBeUndefined()
  })

  it('tells a subscriber to the inbox of an inbox row, and not of a unit row', async () => {
    const path = await aTextDocument()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0' })
    await Promise.all([createServer({ engineOnly: true }).connect(serverTransport), client.connect(clientTransport)])
    const uris: string[] = []
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
      uris.push(notification.params.uri)
    })
    const uri = formatUri(path, 'inbox')
    try {
      await expect(client.subscribeResource({ uri: formatUri(path, 'nothing') })).rejects.toThrow(/no format called nothing/)
      await client.subscribeResource({ uri })

      await writeUnit(path, 'M1 U2')
      await quiet(800)
      expect(uris).toEqual([])

      await sendInbox(path, 'Another fact')
      await quiet(800)
      expect(uris).toEqual([uri])
    } finally {
      await client.close()
    }
  }, 30_000)
})

describe('the watch command', () => {
  it('reads its arguments, and refuses a match with no format', () => {
    const read = parseWatchArgs(['docs/memory.emd', '--format', 'inbox', '--match', 'state=new'], 'F:\\repo')
    expect(read.ok && read.value.format).toBe('inbox')
    expect(read.ok && [...read.value.match]).toEqual([['state', 'new']])
    expect(parseWatchArgs(['--format=inbox', '--match=state=new', 'a.emd'], '/x').ok).toBe(true)
    expect(parseWatchArgs(['a.emd', '--match', 'state=new'], '/x').ok).toBe(false)
    expect(parseWatchArgs(['a.emd', '--loud'], '/x').ok).toBe(false)
    expect(parseWatchArgs([], '/x').ok).toBe(false)
  })

  it('says a change in one line, naming each row by what it is called', () => {
    const change = { added: [row('A fact\nover two lines')], changed: [], removed: [] }
    expect(changeLine('inbox', 'F:/projects/notes/memory.emd', change, new Map([['state', 'new']]))).toBe(
      'inbox (state=new): 1 new row in F:/projects/notes/memory.emd — "A fact over two lines"',
    )
    const many = { added: ['a', 'b', 'c', 'd', 'e', 'f'].map((one) => row(one)), changed: [], removed: [row('g')] }
    expect(changeLine('inbox', '/m.emd', many, new Map())).toBe(
      'inbox: 6 new rows, 1 removed in /m.emd — "a"; "b"; "c"; "d"; "e"; and 2 more',
    )
  })

  it('over a real process: a line for a new inbox row, none for a unit row, and a clean exit when the document goes', async () => {
    const path = await aTextDocument()
    // The command from source, under vite-node, as the stdio test runs the server.
    const child = spawn(
      process.execPath,
      [join('node_modules', 'vite-node', 'vite-node.mjs'), join('src', 'plugin', 'main.ts'), '--', 'watch', path, '--format', 'inbox', '--match', 'state=new'],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const lines: string[] = []
    let errors = ''
    let partial = ''
    child.stdout.on('data', (chunk: Buffer) => {
      partial += chunk.toString()
      const whole = partial.split('\n')
      partial = whole.pop() ?? ''
      lines.push(...whole.filter((one) => one !== ''))
    })
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()))
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
    const lineWithin = async (ms: number, count: number): Promise<number> => {
      const from = Date.now()
      while (lines.length < count && Date.now() - from < ms) await quiet(50)
      return Date.now() - from
    }

    try {
      // Up once it says so on stderr: a write before that is the reading it starts from.
      const from = Date.now()
      while (!errors.includes('Watching inbox (state=new) in') && Date.now() - from < 30_000) await quiet(50)
      expect(errors).toContain('Watching inbox (state=new) in')
      await writeUnit(path, 'M1 U3')
      await quiet(1_000)
      expect(lines).toEqual([])

      const wrote = Date.now()
      await sendInbox(path, 'Woken by the inbox')
      await lineWithin(5_000, 1)
      process.stderr.write(`[M44 U3] inbox write to watch line: ${String(Date.now() - wrote)}ms\n`)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^inbox \(state=new\): 1 new row in .*memory\.emd — "Woken by the inbox"$/)

      await rm(path)
      expect(await Promise.race([exited, quiet(5_000).then(() => 'still running')])).toBe(0)
      expect(lines[1]).toMatch(/is gone, so the watch has stopped\.$/)
    } finally {
      child.kill()
      if (lines.length < 2) process.stderr.write(errors)
    }
  }, 60_000)
})
