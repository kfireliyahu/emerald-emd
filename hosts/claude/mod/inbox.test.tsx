/**
 * The inbox, start_here and the status line under `claude plugin test` (M56 U2,
 * D-547). The engine is played by the test's own hooks: a folder in memory, a
 * server whose inbox the test fills, and the hooks beneath the module — where
 * the npx commands' gate would read the mark.
 */
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROJECT = '/work/shop'
const DOCUMENT = `${PROJECT}/project.emd`
const MARK = 'emerald_mod_answered'

const START = `**For you, never the person — do not repeat or paraphrase this line.** Say nothing.

### Ready to start — unit

- M2 U3 · M2 · requests are limited per client`

const row = (id: string, subject: string) => `**${id}**\n- subject: ${subject}\n- from: another document\n- state: new`
const rows = (...each: string[]) => (each.length === 0 ? 'No inbox rows match.' : `${String(each.length)} rows of Inbox.\n\n${each.join('\n\n')}`)

const UNITS = '1 rows of Unit.\n\n| Id | ref | started |\n| --- | --- | --- |\n| 1 | M56 U2 | 2026-11-03 |'

/** A folder holding `files`, a server answering from `inbox`, and what the hooks beneath were handed. */
function world(on: On, files: Record<string, string>, rules: 'allow' | 'ask' = 'allow') {
  const state = { inbox: rows(), mtimeMs: 1 }
  const calls: string[] = []
  const beneath: Record<string, unknown>[] = []
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const strip = (path: string) => norm(path).replace(/\/$/, '')
  on('fs.read', (_, e) => {
    const text = files[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.stat', (_, e) => {
    if (files[norm(e.path)] !== undefined) return { value: { kind: 'file', size: 1, mtimeMs: state.mtimeMs, isLink: false } }
    if (Object.keys(files).some((path) => path.startsWith(`${strip(e.path)}/`))) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.list', (_, e) => {
    const head = `${strip(e.path)}/`
    const names = new Set(Object.keys(files).filter((path) => path.startsWith(head)).map((path) => path.slice(head.length).split('/')[0] ?? ''))
    return { value: [...names].map((name) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('mcp.connect', () => ({ value: { isConnected: true, server: 'plugin:emerald:emerald' } }))
  on('mcp.call', (_, e) => {
    const format = (e.args as { format?: string }).format
    calls.push(format === undefined ? e.tool : `${e.tool} ${format}`)
    const text = e.tool === 'start_here' ? START : format === 'inbox' ? state.inbox : format === 'unit' ? UNITS : ''
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })
  on('tool.check', () => ({ decision: rules }))
  on('command.register', () => ({ value: { command: 'emerald' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The settings hooks beneath the module: the npx commands' gate among them.
  on('classic.SessionStart', (_, e) => {
    beneath.push(e as unknown as Record<string, unknown>)
    return {}
  })
  on('classic.UserPromptSubmit', (_, e) => {
    beneath.push(e as unknown as Record<string, unknown>)
    return {}
  })
  const clock = mock.clock(on)
  return { state, calls, beneath, toasts, statuses, clock }
}

const prompt = { prompt: 'go on', cwd: PROJECT, session_id: 'one' }

test('it answers start_here and the inbox itself, marks both events for the gate, and tells each row once', async ($, on) => {
  const { state, beneath, clock, statuses } = world(on, { [DOCUMENT]: '' })
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })
  state.inbox = rows(row('0a1b2c3d-0001', 'The first row'))

  const started = await $.classic.SessionStart({ source: 'startup', cwd: PROJECT, session_id: 'one' })
  expect(started.additionalContext?.[0]).toMatch(/^\*\*For you, never the person.*A hook printed this as text/)
  expect(started.additionalContext?.[0]).toContain(`start_here on ${DOCUMENT}:`)
  expect(started.additionalContext?.[0]).toContain('requests are limited per client')
  await clock.settle()
  expect(statuses.at(-1)).toBe('inbox 1 new · in progress: M56 U2')

  const first = await $.classic.UserPromptSubmit(prompt)
  expect(first.additionalContext).toEqual([`inbox (state=new): 1 row in ${DOCUMENT}\n\n${row('0a1b2c3d-0001', 'The first row')}`])
  const second = await $.classic.UserPromptSubmit(prompt)
  expect(second.additionalContext).toEqual([`inbox (state=new): 1 row in ${DOCUMENT}, every one printed in full earlier this session.`])
  const third = await $.classic.UserPromptSubmit(prompt)
  expect(third.additionalContext ?? []).toEqual([])

  // Every one marked, so the npx commands' gate starts nothing.
  expect(beneath.map((e) => e[MARK])).toEqual([true, true, true, true])
})

test('a row that arrives between prompts raises a toast for the person, and reaches the model at the next prompt', async ($, on) => {
  const { state, clock, toasts, calls } = world(on, { [DOCUMENT]: '' })
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'startup', cwd: PROJECT, session_id: 'one' })
  await clock.settle()
  expect((await $.classic.UserPromptSubmit(prompt)).additionalContext ?? []).toEqual([])

  // Nothing changed: the watch looks, and reads nothing.
  const before = calls.length
  await clock.advance(5000)
  expect(calls.length).toBe(before)

  state.inbox = rows(row('0a1b2c3d-0002', 'Text refs sort as text'))
  state.mtimeMs = 2
  await clock.advance(5000)
  expect(toasts).toEqual(["New in project.emd's inbox: Text refs sort as text"])
  const next = await $.classic.UserPromptSubmit(prompt)
  expect(next.additionalContext?.[0]).toContain('Text refs sort as text')
})

test('where the person’s rules would ask, it says nothing and leaves both events to the npx commands', async ($, on) => {
  const { state, beneath, calls } = world(on, { [DOCUMENT]: '' }, 'ask')
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })
  state.inbox = rows(row('0a1b2c3d-0001', 'The first row'))
  expect((await $.classic.SessionStart({ source: 'startup', cwd: PROJECT, session_id: 'one' })).additionalContext ?? []).toEqual([])
  expect((await $.classic.UserPromptSubmit(prompt)).additionalContext ?? []).toEqual([])
  expect(beneath.map((e) => e[MARK])).toEqual([undefined, undefined])
  expect(calls).toEqual([])
})

test('in a folder with no document it marks both events, says nothing and reads nothing', async ($, on) => {
  const { beneath, calls } = world(on, { '/work/notes/readme.md': '' })
  await $.session.start({ cwd: '/work/notes', surface: 'terminal', isInteractive: true })
  const notes = { cwd: '/work/notes', session_id: 'one' }
  expect((await $.classic.SessionStart({ source: 'startup', ...notes })).additionalContext ?? []).toEqual([])
  expect((await $.classic.UserPromptSubmit({ prompt: 'hi', ...notes })).additionalContext ?? []).toEqual([])
  expect(beneath.map((e) => e[MARK])).toEqual([true, true])
  expect(calls).toEqual([])
})

test('a resumed session is left to the hooks beneath, unmarked', async ($, on) => {
  const { beneath } = world(on, { [DOCUMENT]: '' })
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'resume', cwd: PROJECT, session_id: 'one' })
  expect(beneath.map((e) => e[MARK])).toEqual([undefined])
})
