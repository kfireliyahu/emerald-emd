/**
 * The project pane under `claude plugin test hosts/claude` (M56 U1). The
 * engine is played by the test's own hooks: a folder of files in memory, a
 * server whose answers are the demo project's, and a store.
 */
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROJECT = '/work/shop'
const DOCUMENT = `${PROJECT}/project.emd`

/** `start_here`'s answer, as the server gives it: a line for the model, sections, calls, and a row's shape. */
const START = `**For you, never the person — do not repeat or paraphrase this line.** Say nothing about servers or tools.

### Ready to start — unit

_state is planned, and nothing in blocks is still open._

- M2 U3 · M2 · requests are limited per client

Held:
- M3 U1 · M3 · errors are reported — waits on M2 U3 · planned

### inbox — state is new

None.

Whole list: \`format_rows inbox match:{state:new}\`.

### milestone — state is open

- M2 · Public API

12 rows in all. Whole list: \`format_rows milestone match:{state:open}\`.

### What a row looks like

- \`unit\` — **ref**: unique · **state**: planned|built`

const AFTER = START.replace('M2 · Public API', 'M2 · Public API, renamed')

const SHOWN = `**For you, never the person.** Say nothing.

unit as its sheet — 2 rows, each with its state.

- M1 U1 · built
- M2 U3 · planned

Every column of these rows is one call away: \`format_rows unit\`.`

const PANE = {
  plugin: 'emerald',
  component: 'Pane',
  requestId: 'emerald',
  props: {
    title: 'project.emd',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

/** The person typing `/emerald …` at the prompt. */
const RUN = { command: 'emerald', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

/** A folder holding `files` (path → text), and the server's answers. */
function world(
  on: On,
  files: Record<string, string>,
  answers: { start: string[]; shown?: string },
  stored: Record<string, unknown> = {},
  rules: 'allow' | 'ask' = 'allow',
) {
  const calls: { tool: string; args: Record<string, unknown> }[] = []
  const opened: string[] = []
  // The engine hands a hook the path resolved: on Windows with a drive and backslashes.
  const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const strip = (path: string) => norm(path).replace(/\/$/, '')
  on('fs.read', (_, e) => {
    const text = files[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.stat', (_, e) => {
    if (files[norm(e.path)] !== undefined) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
    if (Object.keys(files).some((path) => path.startsWith(`${strip(e.path)}/`))) {
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.list', (_, e) => {
    const head = `${strip(e.path)}/`
    const names = new Set(
      Object.keys(files)
        .filter((path) => path.startsWith(head))
        .map((path) => path.slice(head.length).split('/')[0] ?? ''),
    )
    return { value: [...names].map((name) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('session.cwd', () => ({ value: PROJECT }))
  on('mcp.connect', () => ({ value: { isConnected: true, server: 'plugin:emerald:emerald' } }))
  on('mcp.call', (_, e) => {
    calls.push({ tool: e.tool, args: e.args })
    const text = e.tool === 'start_here' ? (answers.start.shift() ?? AFTER) : (answers.shown ?? '')
    if (e.tool === 'start_here' && answers.start.length === 0) answers.start.push(AFTER)
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })
  // The person's rules for the pane's reads: allowed, as `npx emerald-mcp init` writes them, or not yet.
  const checked: string[] = []
  on('tool.check', (_, e) => {
    if (!/__(start_here|show_format)$/.test(e.tool)) return { decision: 'allow' }
    checked.push(e.tool)
    return { decision: rules }
  })
  on('command.register', () => ({ value: { command: 'emerald' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const store = new Map(Object.entries(stored))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  // The reads run on a timer of their own: `clock.settle()` lets them land.
  const clock = mock.clock(on)
  return { calls, opened, store, clock, checked }
}

test('in a folder with one document the pane opens and shows what start_here answers, for the person', async ($, on) => {
  const { calls, opened, clock } = world(on, { [DOCUMENT]: '' }, { start: [START] })
  await $.session.start({ cwd: PROJECT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toEqual(['emerald'])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Ready to start — unit$/ }))?.text).toBe('Ready to start — unit')
    expect((await ui.find({ type: 'Text', text: /requests are limited/ }))?.text).toBe('· M2 U3 · M2 · requests are limited per client')
    expect((await ui.find({ type: 'Text', text: /^Held$/ }))?.text).toBe('Held')
    expect((await ui.find({ type: 'Text', text: /12 rows in all/ }))?.text).toBe('12 rows in all.')
    // Nothing meant for the model reaches the person (D-493).
    for (const said of [/For you/, /format_rows/, /Whole list/, /What a row looks like/, /\*\*ref\*\*/]) {
      expect(await ui.find({ type: 'Text', text: said })).toBeUndefined()
    }
    await ui.unmount()
  }
  expect(calls.map((call) => call.tool).every((tool) => tool === 'start_here')).toBe(true)
  expect(calls[0]?.args).toEqual({ path: DOCUMENT })
})

test('in a folder with no document nothing opens', async ($, on) => {
  const { calls, opened, clock } = world(on, { '/work/notes/readme.md': '' }, { start: [START] })
  await $.session.start({ cwd: '/work/notes', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toEqual([])
  expect(calls).toEqual([])
})

test('two documents and no .claude/emerald.json mean none; the file names one', async ($, on) => {
  const two = { [`${PROJECT}/a.emd`]: '', [`${PROJECT}/b.emd`]: '' }
  const { opened, clock } = world(on, two, { start: [START] })
  await $.session.start({ cwd: PROJECT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toEqual([])
})

test('a document named in .claude/emerald.json opens the pane on it', async ($, on) => {
  const files = {
    [`${PROJECT}/a.emd`]: '',
    [`${PROJECT}/docs/memory.emd`]: '',
    [`${PROJECT}/.claude/emerald.json`]: '{ "document": "docs/memory.emd" }',
  }
  const { calls, opened, clock } = world(on, files, { start: [START] })
  await $.session.start({ cwd: PROJECT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toEqual(['emerald'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.unmount()
  expect(calls[0]?.args).toEqual({ path: `${PROJECT}/docs/memory.emd` })
})

test('a project the person closed the pane for stays closed until /emerald', async ($, on) => {
  const { opened, store, clock } = world(on, { [DOCUMENT]: '' }, { start: [START] }, { [`closed:${DOCUMENT}`]: true })
  await $.session.start({ cwd: PROJECT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toEqual([])
  const ran = await $.command.run({ ...RUN, args: '' })
  await clock.settle()
  expect(ran.text).toBe('Showing project.emd.')
  expect(opened).toEqual(['emerald'])
  expect(store.has(`closed:${DOCUMENT}`)).toBe(false)
})

test('the pane is read again after an emerald write, and not after a read', async ($, on) => {
  const { calls, clock } = world(on, { [DOCUMENT]: '' }, { start: [START] })
  on('tool.call', (_, e) =>
    String(e.tool).endsWith('__format_rows') ? { result: {}, isReadOnly: true } : { result: {} },
  )
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /renamed/ })).toBeUndefined()

  await $.tool.call({ tool: 'mcp__plugin_emerald_emerald__format_rows', path: DOCUMENT, format: 'unit' })
  await clock.settle()
  expect(calls).toHaveLength(1)

  await $.tool.call({ tool: 'mcp__plugin_emerald_emerald__record_format_rows', path: DOCUMENT, format: 'unit', rows: [] })
  await clock.settle()
  expect((await ui.find({ type: 'Text', text: /renamed/ }))?.text).toBe('· M2 · Public API, renamed')
  expect(calls).toHaveLength(2)
  await ui.unmount()
})

test('/emerald show <format> puts one format in the same pane', async ($, on) => {
  const { calls, opened, clock } = world(on, { [DOCUMENT]: '' }, { start: [START], shown: SHOWN })
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ran = await $.command.run({ ...RUN, args: 'show unit board' })
  expect(ran.text).toBe('Showing unit (board) from project.emd.')
  expect(opened).toEqual(['emerald', 'emerald'])
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /2 rows/ }))?.text).toBe('unit as its sheet — 2 rows, each with its state.')
  expect((await ui.find({ type: 'Text', text: /M2 U3/ }))?.text).toBe('· M2 U3 · planned')
  expect(await ui.find({ type: 'Text', text: /format_rows/ })).toBeUndefined()
  await ui.unmount()
  expect(calls.at(-1)).toEqual({ tool: 'show_format', args: { path: DOCUMENT, format: 'unit', view: 'board' } })
})

test("where the person's rules would ask, the pane reads only when they press Read (D-541)", async ($, on) => {
  const { calls, clock, checked } = world(on, { [DOCUMENT]: '' }, { start: [START] }, {}, 'ask')
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(checked).toEqual(['mcp__plugin_emerald_emerald__start_here'])
  expect(calls).toEqual([])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Button', key: 'read' }))?.props['label']).toBe('Read project.emd')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'read' })
  expect(calls.map((call) => call.tool)).toEqual(['start_here'])
  expect((await ui.find({ type: 'Text', text: /^Ready to start — unit$/ }))?.text).toBe('Ready to start — unit')

  // A write then leaves what was read in place, and offers to read it again.
  await $.tool.call({ tool: 'mcp__plugin_emerald_emerald__record_format_rows', path: DOCUMENT, format: 'unit', rows: [] })
  await clock.settle()
  expect(calls).toHaveLength(1)
  expect((await ui.find({ type: 'Button', key: 'read' }))?.props['label']).toBe('project.emd changed: read it again')
  expect(await ui.find({ type: 'Text', text: /requests are limited/ })).toBeDefined()
  await ui.unmount()
})
