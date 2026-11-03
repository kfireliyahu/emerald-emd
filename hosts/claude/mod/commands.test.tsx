/**
 * `/claim` and `/land` under `claude plugin test hosts/claude` (M56 U3): each
 * answers the person in a line, leaves the model the one call to make, and asks
 * for a turn — and the module itself calls no tool.
 *
 * A `.tsx` file, as `pane.test.tsx` is, so Vitest (which takes only `.test.ts` under hosts)
 * leaves it to `npm run test:mod`.
 */
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MAIN = '/work/shop'
const WORKTREE = `${MAIN}/.claude/worktrees/a`
const NAMED = '{ "document": "docs/memory.emd" }'

const FILES: Record<string, string> = {
  [`${MAIN}/.claude/emerald.json`]: NAMED,
  [`${MAIN}/docs/memory.emd`]: '',
  [`${MAIN}/.git/HEAD`]: 'ref: refs/heads/main',
  [`${MAIN}/.git/worktrees/a/commondir`]: '../..',
  [`${WORKTREE}/.git`]: `gitdir: ${MAIN}/.git/worktrees/a`,
  [`${WORKTREE}/.claude/emerald.json`]: NAMED,
  [`${WORKTREE}/docs/memory.emd`]: '',
  ['/work/notes/readme.md']: '',
}

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

function world(on: On, cwd: string, status = '') {
  const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const strip = (path: string) => norm(path).replace(/\/$/, '')
  on('fs.read', (_, e) => {
    const text = FILES[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.stat', (_, e) => {
    if (FILES[norm(e.path)] !== undefined) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
    if (Object.keys(FILES).some((path) => path.startsWith(`${strip(e.path)}/`))) {
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.list', (_, e) => {
    const head = `${strip(e.path)}/`
    const names = new Set(Object.keys(FILES).filter((path) => path.startsWith(head)).map((path) => path.slice(head.length).split('/')[0] ?? ''))
    return { value: [...names].map((name) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('session.cwd', () => ({ value: cwd }))
  on('process.run', (_, e) => {
    const args = e.argv.slice(1).join(' ')
    const stdout = args === 'branch --show-current' ? 'unit-branch' : args === 'rev-parse --short HEAD' ? 'abc1234' : args === 'status --porcelain' ? status : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const registered: string[] = []
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const submitted: string[] = []
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  const tools: string[] = []
  on('tool.call', (_, e) => {
    tools.push(String(e.tool))
    return { result: {} }
  })
  // The turn is asked for on a timer of its own: `clock.settle()` lets it land.
  const clock = mock.clock(on)
  return { registered, store, submitted, tools, clock }
}

test('both commands are registered at the start of a session, beside /emerald', async ($, on) => {
  const { registered } = world(on, '/work/notes')
  await $.session.start({ cwd: '/work/notes', surface: 'terminal', isInteractive: true })
  expect(registered).toContain('claim')
  expect(registered).toContain('land')
  expect(registered).toContain('emerald')
})

test('/claim hands the model claim_units for the unit, on this branch, and asks for a turn', async ($, on) => {
  const { store, submitted, tools, clock } = world(on, MAIN)
  const ran = await $.command.run({ ...RUN, command: 'claim', args: ' M2 U3 ' })
  expect(ran.text).toBe('Claiming M2 U3 in memory.emd on unit-branch.')
  const said = ran.context?.join('\n') ?? ''
  expect(said).toContain('`claim_units`')
  expect(said).toContain(
    JSON.stringify({ path: `${MAIN}/docs/memory.emd`, units: ['M2 U3'], taken_by: 'a Claude Code session on unit-branch', branch: 'unit-branch' }),
  )
  expect(said).toContain('`commit: true`')
  expect(store.get(`claimed:${MAIN}/docs/memory.emd:unit-branch`)).toBe('M2 U3')
  await clock.settle()
  expect(submitted).toEqual(['Claim M2 U3.'])
  // The module writes nothing: the call is the model's to make.
  expect(tools).toEqual([])
})

test('/claim with no ref, or with no document, says so and hands over nothing', async ($, on) => {
  const { submitted, clock } = world(on, '/work/notes')
  expect((await $.command.run({ ...RUN, command: 'claim', args: '' })).text).toMatch(/^`\/claim <unit ref>`/)
  const none = await $.command.run({ ...RUN, command: 'claim', args: 'M2 U3' })
  expect(none.text).toMatch(/no Emerald document/)
  expect(none.context).toBeUndefined()
  await clock.settle()
  expect(submitted).toEqual([])
})

test('/land in the main checkout hands over land_units with the commit and the claimed unit', async ($, on) => {
  const { submitted, tools, clock } = world(on, MAIN)
  await $.command.run({ ...RUN, command: 'claim', args: 'M2 U3' })
  const ran = await $.command.run({ ...RUN, command: 'land', args: '' })
  expect(ran.text).toBe('Landing M2 U3.')
  const said = ran.context?.join('\n') ?? ''
  expect(said).toContain('`land_units`')
  expect(said).toContain('"unit":"M2 U3","commit":"abc1234","branch":"unit-branch"')
  expect(said).not.toMatch(/uncommitted/)
  expect(said).not.toContain('inbox')
  await clock.settle()
  expect(submitted).toEqual(['Claim M2 U3.', 'Land M2 U3.'])
  expect(tools).toEqual([])
})

test('/land in a worktree proposes the landing as one inbox row in the main checkout’s document', async ($, on) => {
  world(on, WORKTREE, ' M src/a.ts\n M docs/memory.emd\n')
  const ran = await $.command.run({ ...RUN, command: 'land', args: 'M2 U3' })
  expect(ran.text).toBe('Proposing the landing of M2 U3 from this worktree.')
  const said = ran.context?.join('\n') ?? ''
  expect(said).toContain('`record_format_rows`')
  expect(said).toContain(JSON.stringify(`${MAIN}/docs/memory.emd`))
  expect(said).toContain(`"from":"${WORKTREE}/docs/memory.emd"`)
  expect(said).toContain('"refs":"M2 U3"')
  expect(said).toContain('ONE object')
  expect(said).not.toContain('`land_units`')
  // src/a.ts is uncommitted: the work is committed first, and no commit is named for it.
  expect(said).toMatch(/uncommitted changes/)
  expect(said).toContain('<the commit that carries the work>')
})
