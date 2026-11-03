/**
 * The write rules as guards under `claude plugin test hosts/claude` (M56 U3):
 * each refuses its case and lets the plain case through. The engine is played
 * by the test's hooks: a main checkout and a linked worktree of it in memory,
 * `git` answering from what the test says is staged or changed, and the tools
 * themselves answering `{ result }`.
 *
 * A `.tsx` file, as `pane.test.tsx` is, so Vitest (which takes only `.test.ts` under hosts)
 * leaves it to `npm run test:mod`.
 */
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MAIN = '/work/shop'
const WORKTREE = `${MAIN}/.claude/worktrees/a`
const NAMED = '{ "document": "docs/memory.emd" }'

/** Both checkouts: each names docs/memory.emd, and the worktree's `.git` points into the main one's. */
const FILES: Record<string, string> = {
  [`${MAIN}/.claude/emerald.json`]: NAMED,
  [`${MAIN}/docs/memory.emd`]: '',
  [`${MAIN}/.git/HEAD`]: 'ref: refs/heads/main',
  [`${MAIN}/.git/worktrees/a/commondir`]: '../..',
  [`${WORKTREE}/.git`]: `gitdir: ${MAIN}/.git/worktrees/a`,
  [`${WORKTREE}/.claude/emerald.json`]: NAMED,
  [`${WORKTREE}/docs/memory.emd`]: '',
  [`${WORKTREE}/src/a.ts`]: '',
}

/** The session in `cwd`; the document's copy staged, changed, or neither; git answering or not. */
function world(on: On, cwd: string, copy: { staged?: boolean; changed?: boolean } = {}, gitAnswers = true) {
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
  const ran: string[][] = []
  on('process.run', (_, e) => {
    // A git that answers nothing usable: the guard's own judgement fails.
    if (!gitAnswers) return { value: undefined as never }
    ran.push([...e.argv])
    const args = e.argv.slice(1).join(' ')
    const stdout =
      args.startsWith('diff --cached') ? (copy.staged === true ? 'docs/memory.emd\n' : '')
      : args.startsWith('status --porcelain') ? (copy.changed === true || copy.staged === true ? ' M docs/memory.emd\n' : '')
      : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // The tools themselves: whatever reaches them answers.
  on('tool.call', () => ({ result: {} }))
  return { ran }
}

const edit = (file_path: string) => ({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }) as const
const bash = (command: string) => ({ tool: 'Bash', command }) as const

test('an Edit or Write on a .emd file is refused, with why; on any other file it runs', async ($, on) => {
  world(on, MAIN)
  const refused = await $.tool.call(edit(`${MAIN}/docs/memory.emd`))
  expect(refused.deny).toMatch(/is an Emerald document, and it is changed through its tools/)
  expect((await $.tool.call({ tool: 'Write', file_path: 'C:\\shop\\plan.EMD', content: '' })).deny).toMatch(/record_format_rows/)
  expect((await $.tool.call(edit(`${MAIN}/src/a.ts`))).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: `${MAIN}/notes.emd.md`, content: '' })).deny).toBeUndefined()
})

test("a commit in a worktree is refused while the document's copy is staged", async ($, on) => {
  world(on, WORKTREE, { staged: true })
  const refused = await $.tool.call(bash('git add -A && git commit -m "the unit"'))
  expect(refused.deny).toMatch(/this commit would carry its own copy of the project's document/)
  expect(refused.deny).toContain(`${WORKTREE}/docs/memory.emd`)
  expect((await $.tool.call({ tool: 'PowerShell', command: "git -C . commit -m 'the unit'" })).deny).toBeDefined()
})

test('a changed, unstaged copy is refused only when -a or a pathspec would take it', async ($, on) => {
  world(on, WORKTREE, { changed: true })
  expect((await $.tool.call(bash('git commit -m "the unit"'))).deny).toBeUndefined()
  expect((await $.tool.call(bash('git commit -m "the unit" -- src/a.ts'))).deny).toBeUndefined()
  expect((await $.tool.call(bash('git commit -am "the unit"'))).deny).toBeDefined()
  expect((await $.tool.call(bash('git commit --all -m x'))).deny).toBeDefined()
  expect((await $.tool.call(bash('git commit -m x -- docs/'))).deny).toBeDefined()
  expect((await $.tool.call(bash('git commit -m x .'))).deny).toBeDefined()
  expect((await $.tool.call(bash('cd docs && git commit -m x memory.emd'))).deny).toBeDefined()
})

test('a clean copy, the main checkout, and any other command all run', async ($, on) => {
  const { ran } = world(on, WORKTREE)
  expect((await $.tool.call(bash('git commit -am "the unit"'))).deny).toBeUndefined()
  expect((await $.tool.call(bash('git status && npm test'))).deny).toBeUndefined()
  // Only a commit asks git anything.
  expect(ran.every((argv) => argv[1] === 'diff' || argv[1] === 'status')).toBe(true)
})

test('the main checkout commits its own document', async ($, on) => {
  const { ran } = world(on, MAIN, { staged: true })
  expect((await $.tool.call(bash('git commit -am "rows"'))).deny).toBeUndefined()
  expect(ran).toEqual([])
})

test('a guard that fails refuses rather than lets the commit through', async ($, on) => {
  world(on, WORKTREE, { staged: true }, false)
  expect((await $.tool.call(bash('git commit -m x'))).deny).toMatch(/could not tell/)
  // A command with no commit never reaches git, so it runs.
  expect((await $.tool.call(bash('npm test'))).deny).toBeUndefined()
})
