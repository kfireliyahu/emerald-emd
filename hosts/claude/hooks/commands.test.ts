import { execFileSync, spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDocumentTool, FOR_THE_MODEL, formatRowsTool, NO_CLIENT, recordFormatRowsTool, updateFormatRowsTool } from '@/plugin/host.ts'
import { tempDir } from '@/testing/tempDir'
import { parseHookArgs, refreshStatus, runHook, sessionOf } from './commands.ts'
import { projectDocument, PROJECT_FILE } from './project.ts'
import { readStatusCache, refreshMarkFor, stampOf, statusText, writeStatusCache, type DocumentStamp } from './statusCache.ts'
import { statusLine } from './statusLine.ts'
import { toldPathFor } from './told.ts'

/** A folder holding one development-pack document, `memory.emd`. */
async function aProject(packs: readonly string[] = ['development']): Promise<{ folder: string; path: string }> {
  const folder = await tempDir('emerald-hooks-')
  const path = join(folder, 'memory.emd')
  await createDocumentTool.run({ path, packs }, { engineOnly: true })
  return { folder, path }
}

async function sendInbox(path: string, subject: string): Promise<void> {
  const answer = await recordFormatRowsTool.run(
    { path, format: 'inbox', rows: [{ subject, from: 'F:/projects/notes/notes.emd', sent_on: '2026-10-13', state: 'new' }], commit: true },
    NO_CLIENT,
  )
  expect(answer).not.toMatch(/refus|cannot/i)
}

/** Runs a hook command in-process and keeps what it said — as `session`, when one is given. */
async function run(argv: readonly string[], cwd = process.cwd(), session?: string): Promise<{ code: number; out: string; err: string }> {
  const [command, ...rest] = argv
  const args = parseHookArgs(command as 'start-here' | 'rows' | 'status', rest, cwd)
  if (!args.ok) return { code: 1, out: '', err: args.error }
  let out = ''
  let errText = ''
  const code = await runHook(session === undefined ? args.value : { ...args.value, session }, {
    line: (text) => (out += `${text}\n`),
    complain: (text) => (errText += `${text}\n`),
  })
  return { code, out, err: errText }
}

describe('which document a project means', () => {
  it('takes what .claude/emerald.json names, relative to the folder', async () => {
    const folder = await tempDir('emerald-hooks-')
    await mkdir(join(folder, '.claude'))
    await mkdir(join(folder, 'docs'))
    await writeFile(join(folder, 'docs', 'memory.emd'), '')
    await writeFile(join(folder, PROJECT_FILE), JSON.stringify({ document: 'docs/memory.emd' }))
    expect(await projectDocument(folder)).toEqual({ kind: 'document', path: join(folder, 'docs', 'memory.emd') })
  })

  it('says so when what it names is not there, or when the file is not one it can read', async () => {
    const folder = await tempDir('emerald-hooks-')
    await mkdir(join(folder, '.claude'))
    await writeFile(join(folder, PROJECT_FILE), JSON.stringify({ document: 'gone.emd' }))
    expect(await projectDocument(folder)).toMatchObject({ kind: 'problem', message: expect.stringContaining('no document there') })
    await writeFile(join(folder, PROJECT_FILE), '{ not json')
    expect(await projectDocument(folder)).toMatchObject({ kind: 'problem', message: expect.stringContaining('not JSON') })
  })

  it('takes the one .emd in the folder, not counting the copies Emerald keeps beside it', async () => {
    const folder = await tempDir('emerald-hooks-')
    await writeFile(join(folder, 'planner.emd'), '')
    await writeFile(join(folder, 'planner.before-20261009T062530-adding-9-rows-to-milesto.emd'), '')
    await writeFile(join(folder, 'planner.emd.20261009T072438.bak'), '')
    expect(await projectDocument(folder)).toEqual({ kind: 'document', path: join(folder, 'planner.emd') })
  })

  it('means nothing when there are none, or two', async () => {
    const folder = await tempDir('emerald-hooks-')
    expect(await projectDocument(folder)).toEqual({ kind: 'none' })
    await writeFile(join(folder, 'a.emd'), '')
    await writeFile(join(folder, 'b.emd'), '')
    expect(await projectDocument(folder)).toEqual({ kind: 'none' })
  })
})

describe('start-here', () => {
  it("prints the project document's start_here", async () => {
    const { folder, path } = await aProject()
    const { code, out } = await run(['start-here', folder])
    expect(code).toBe(0)
    expect(out).toContain(`start_here on ${path.split('\\').join('/')}:`)
    expect(out).toContain('Ready to start')
  })

  it('says first that it is text and nothing was drawn, and to call the tool when asked to see (M51 F2)', async () => {
    // On 2026-10-18 a session asked to show what is ready retyped this text
    // as a table and never called a drawing tool, so no answer said nothing
    // was drawn. A host may keep only the head of a long hook's output.
    const { folder } = await aProject()
    const { out } = await run(['start-here', folder])
    const first = out.split('\n')[0] ?? ''
    expect(first).toContain('A hook printed this as text, and nothing was drawn.')
    expect(first).toContain('call `start_here` or `show_format` rather than retyping this')
    expect(first).toContain('a host may draw only the servers it runs itself')
    // For the model, never relayed to the person (M51 F3, D-493).
    expect(first.startsWith(FOR_THE_MODEL)).toBe(true)
    expect(first).toContain('follow the first line of its answer')
    expect(first).toContain('Say nothing to the person about this hook, drawing, views, servers or tools')
    expect(first).toContain('never call anything drawn or above')
    // Host-neutral, as the server is (M42 U6): no host and no server named.
    expect(first).not.toMatch(/Claude|emerald-ledger|Code tab/)
  })

  it('says nothing in a folder that means no document', async () => {
    expect(await run(['start-here', await tempDir('emerald-hooks-')])).toEqual({ code: 0, out: '', err: '' })
  })

  it('exits 1, never 2, for a document that is not there — a 2 would block the prompt', async () => {
    const result = await run(['start-here', join(await tempDir('emerald-hooks-'), 'gone.emd')])
    expect(result.code).toBe(1)
    expect(result.out).toBe('')
  })
})

describe('rows', () => {
  it('says nothing while no row matches, and prints the rows once one does', async () => {
    const { folder, path } = await aProject()
    expect(await run(['rows', folder, 'inbox', '--match', 'state=new'])).toEqual({ code: 0, out: '', err: '' })
    await sendInbox(path, 'A finding from another project')
    const { code, out } = await run(['rows', folder, 'inbox', '--match', 'state=new'])
    expect(code).toBe(0)
    expect(out).toContain('inbox (state=new): 1 row in ')
    expect(out).toContain('A finding from another project')
    expect(out).toContain('F:/projects/notes/notes.emd')
  })

  it('is silent in a project whose document has no such format, and says so for a document named outright', async () => {
    const { folder, path } = await aProject([])
    expect(await run(['rows', folder, 'inbox', '--match', 'state=new'])).toEqual({ code: 0, out: '', err: '' })
    const named = await run(['rows', path, 'inbox', '--match', 'state=new'])
    expect(named.code).toBe(1)
    expect(named.err).not.toBe('')
  })

  it('refuses a --match on a column the format has not got', async () => {
    const { path } = await aProject()
    const result = await run(['rows', path, 'inbox', '--match', 'colour=red'])
    expect(result.code).toBe(1)
    expect(result.err).toContain('colour')
  })

  it('reads its arguments', () => {
    expect(parseHookArgs('rows', ['x.emd'], 'F:/')).toMatchObject({ ok: false })
    expect(parseHookArgs('rows', ['x.emd', 'inbox', '--match', 'state'], 'F:/')).toMatchObject({ ok: false })
    expect(parseHookArgs('start-here', ['--match', 'state=new'], 'F:/')).toMatchObject({ ok: false })
    const both = parseHookArgs('rows', ['x.emd', 'inbox', '--match=state=new'], 'F:/')
    expect(both.ok && [...both.value.match]).toEqual([['state', 'new']])
  })
})

describe('the inbox, told once per session (M51 U6)', () => {
  const prompt = (folder: string, session: string): Promise<{ code: number; out: string; err: string }> =>
    run(['rows', folder, 'inbox', '--match', 'state=new', '--once-per-session'], process.cwd(), session)

  it('prints a new row once, then the count once, then nothing', async () => {
    const { folder, path } = await aProject()
    await sendInbox(path, 'The release sequence')

    const first = await prompt(folder, 'session-a')
    expect(first.out).toContain('inbox (state=new): 1 row in ')
    expect(first.out).toContain('The release sequence')

    const second = await prompt(folder, 'session-a')
    expect(second.out).not.toContain('The release sequence')
    expect(second.out.trim().split('\n')).toHaveLength(1)
    expect(second.out).toContain('1 row in ')
    expect(second.out).toContain('printed in full earlier this session')

    expect((await prompt(folder, 'session-a')).out).toBe('')
    // Never in the document: beside it.
    await access(toldPathFor(path))
  })

  it('prints a row that arrived between prompts in full, once, and not the ones already told', async () => {
    const { folder, path } = await aProject()
    await sendInbox(path, 'The first finding')
    await prompt(folder, 'session-a')
    await prompt(folder, 'session-a')

    await sendInbox(path, 'A second finding')
    const arrived = await prompt(folder, 'session-a')
    expect(arrived.out).toContain('inbox (state=new): 2 rows in ')
    expect(arrived.out).toContain('1 of them printed earlier this session and not repeated')
    expect(arrived.out).toContain('A second finding')
    expect(arrived.out).not.toContain('The first finding')
    expect((arrived.out.match(/^\*\*[0-9a-f-]+\*\*$/gm) ?? []).length).toBe(1)

    const after = await prompt(folder, 'session-a')
    expect(after.out).toContain('2 rows in ')
    expect(after.out).not.toContain('A second finding')
  })

  it('prints it again in a new session, and in full every time without one', async () => {
    const { folder, path } = await aProject()
    await sendInbox(path, 'The release sequence')
    await prompt(folder, 'session-a')
    expect((await prompt(folder, 'session-b')).out).toContain('The release sequence')
    // No session id in the input: as before, every prompt.
    const unknown = run(['rows', folder, 'inbox', '--match', 'state=new', '--once-per-session'])
    expect((await unknown).out).toContain('The release sequence')
    expect((await run(['rows', folder, 'inbox', '--match', 'state=new', '--once-per-session'])).out).toContain('The release sequence')
  })

  it('says nothing once the rows are triaged, and tells a row that comes back', async () => {
    const { folder, path } = await aProject()
    await sendInbox(path, 'Triaged later')
    await prompt(folder, 'session-a')
    const id = /^\*\*([0-9a-f-]+)\*\*$/m.exec(await formatRowsTool.run({ path, format: 'inbox' }, NO_CLIENT))?.[1] as string
    await updateFormatRowsTool.run({ path, format: 'inbox', edits: [{ id, values: { state: 'triaged' } }], commit: true }, NO_CLIENT)
    expect((await prompt(folder, 'session-a')).out).toBe('')
  })

  it('reads the session id from the hook input, and takes --once-per-session for rows only', () => {
    expect(sessionOf(JSON.stringify({ session_id: 'abc', hook_event_name: 'UserPromptSubmit' }))).toBe('abc')
    expect(sessionOf('')).toBeUndefined()
    expect(sessionOf('{"session_id": 4}')).toBeUndefined()
    expect(parseHookArgs('start-here', ['--once-per-session'], 'F:/')).toMatchObject({ ok: false })
    expect(parseHookArgs('rows', ['x.emd', 'inbox', '--once-per-session'], 'F:/')).toMatchObject({ ok: true, value: { once: true } })
  })
})

describe('the status line (M51 U6)', () => {
  it('says the new inbox rows and the units in progress, from what the slow half wrote beside the document', async () => {
    const { folder, path } = await aProject()
    await sendInbox(path, 'A finding')
    const refreshed: string[] = []
    const refresh = (document: string): void => void refreshed.push(document)

    // Nothing known yet: nothing printed, and one refresh asked for, however often it is asked.
    expect(await statusLine(folder, { refresh })).toBe('')
    expect(await statusLine(folder, { refresh })).toBe('')
    expect(refreshed).toEqual([path])
    await access(refreshMarkFor(path))

    const { out } = await run(['status', folder])
    expect(out.trim()).toBe('inbox 1 new')
    await expect(access(refreshMarkFor(path))).rejects.toThrow()
    expect(await statusLine(folder, { refresh })).toBe('inbox 1 new')
    expect(refreshed).toHaveLength(1)

    // The document changed: what it last knew, and a refresh.
    await sendInbox(path, 'Another finding')
    expect(await statusLine(folder, { refresh })).toBe('inbox 1 new')
    expect(refreshed).toHaveLength(2)
    expect(await refreshStatus(path)).toBe('inbox 2 new')
    expect(await statusLine(path, { refresh })).toBe('inbox 2 new')
  })

  it('names two units in progress and counts the rest, and is silent without the formats', async () => {
    expect(statusText({ inbox: 0, units: ['M51 U6', 'M43 U1', 'M33 U4'] })).toBe('inbox 0 new · in progress: M51 U6, M43 U1 +1')
    expect(statusText({ units: [] })).toBe('')
    const { folder, path } = await aProject([])
    expect(await refreshStatus(path)).toBe('')
    expect(await readStatusCache(path)).toMatchObject({ parts: {} })
    expect(await statusLine(folder, { refresh: () => undefined })).toBe('')
    expect(await statusLine(await tempDir('emerald-hooks-'), { refresh: () => undefined })).toBe('')
  })

  it('prints the count in under 200 ms on docs/memory.emd, as a process of its own', async () => {
    await refreshStatus(join(process.cwd(), 'docs', 'memory.emd'))
    // Node runs the entry from source as it runs the build: it bundles Node's modules and three small files.
    const timed = async (args: readonly string[]): Promise<{ took: number; out: string }> => {
      const started = performance.now()
      const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
      await new Promise((settle) => child.on('close', settle))
      return { took: performance.now() - started, out }
    }
    // The best of up to ten, beside a Node that loads nothing timed in the same moments: alone it
    // is ~100 ms against ~60, and a suite busy in other workers slows both (a test's budget holds
    // under load, M29 F6). Loading the server's bundle instead would add ~290 ms to it alone, so
    // the line passes under 200 ms, or within 150 ms (or three times) of a bare Node — the full
    // suite once took it to 206 ms with Node alone near 60 (M51 F3).
    const line: number[] = []
    const bare: number[] = []
    for (let run = 0; run < 10 && !(Math.min(...line) < 200); run += 1) {
      const { took, out } = await timed([join('hosts', 'claude', 'hooks', 'statusLineMain.ts'), process.cwd()])
      expect(out).toMatch(/^inbox \d+ new/)
      line.push(took)
      bare.push((await timed(['-e', '0'])).took)
    }
    const best = Math.min(...line)
    const node = Math.min(...bare)
    expect(best < 200 || best < Math.max(node + 150, 3 * node), `best ${best.toFixed(0)} ms; Node alone ${node.toFixed(0)} ms`).toBe(true)
  }, 30_000)

  it('never opens the document: what it prints comes from beside it', async () => {
    const { folder, path } = await aProject()
    await sendInbox(path, 'A finding')
    await refreshStatus(path)
    const cache = await readStatusCache(path)
    // Garbage in its place, stamped as read: a status line that opened it would have nothing to say.
    await writeFile(path, 'not an Emerald document')
    await writeStatusCache(path, { of: (await stampOf(path)) as DocumentStamp, parts: cache?.parts ?? {} })
    expect(await statusLine(folder, { refresh: () => expect.fail('the stamp matched; nothing to refresh') })).toBe('inbox 1 new')
  }, 30_000)
})

describe('in a git worktree (M51 U1)', () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=Emerald test', '-c', 'user.email=test@emerald.invalid', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  const samePath = (a: string, b: string): boolean => relative(a, b) === ''

  /**
   * A repository whose committed `docs/memory.emd` its `.claude/emerald.json`
   * names, and a real linked worktree of it — made by `git worktree add`, with
   * nothing linked into it (a junctioned `node_modules` is deleted through by
   * `git worktree remove`).
   */
  async function aRepoWithAWorktree(): Promise<{ main: string; worktree: string; document: string; copy: string }> {
    const main = await tempDir('emerald-worktree-main-')
    await mkdir(join(main, '.claude'))
    await mkdir(join(main, 'docs'))
    const document = join(main, 'docs', 'memory.emd')
    await createDocumentTool.run({ path: document, packs: ['development'] }, { engineOnly: true })
    await writeFile(join(main, PROJECT_FILE), JSON.stringify({ document: 'docs/memory.emd' }))
    git(main, 'init', '-q')
    git(main, 'add', '.')
    git(main, 'commit', '-q', '-m', 'The document')
    const worktree = join(await tempDir('emerald-worktree-'), 'branch')
    git(main, 'worktree', 'add', '-q', '-b', 'branch', worktree)
    return { main, worktree, document, copy: join(worktree, 'docs', 'memory.emd') }
  }

  /** Runs the guard as Claude Code would, with the payload on stdin; what it printed. */
  async function guard(cwd: string, command: string): Promise<string> {
    const child = spawn(process.execPath, [join('scripts', 'guard-memory-emd.mjs')], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.stdin.end(JSON.stringify({ cwd, tool_input: { command } }))
    await new Promise((settle) => child.on('close', settle))
    return out
  }

  it("reads the main checkout's document, rows recorded there and not committed with it", async () => {
    const { worktree, document, copy } = await aRepoWithAWorktree()
    await sendInbox(document, 'Recorded in the main checkout, not committed')

    const found = await projectDocument(worktree)
    expect(found.kind).toBe('document')
    if (found.kind !== 'document') return
    expect(samePath(found.path, document)).toBe(true)
    expect(samePath(found.worktreeCopy as string, copy)).toBe(true)

    const started = await run(['start-here', worktree])
    expect(started.code).toBe(0)
    expect(started.out).toContain("the main checkout's copy, which every worktree reads and writes")
    expect(started.out).toContain('Ready to start')
    const inbox = await run(['rows', worktree, 'inbox', '--match', 'state=new'])
    expect(inbox.out).toContain('Recorded in the main checkout, not committed')
    expect(inbox.out).toContain("not to this worktree's")
  }, 60_000)

  it("writes land in the main checkout's file, and the worktree's copy is never touched", async () => {
    const { main, worktree, document } = await aRepoWithAWorktree()
    const found = await projectDocument(worktree)
    if (found.kind !== 'document') throw new Error('the worktree means no document')
    await sendInbox(found.path, 'Written from the worktree')

    expect(await formatRowsTool.run({ path: document, format: 'inbox', match: { state: 'new' } }, NO_CLIENT)).toContain('Written from the worktree')
    expect(git(worktree, 'status', '--porcelain')).toBe('')
    expect(git(main, 'status', '--porcelain', '--', 'docs/memory.emd')).not.toBe('')
  }, 60_000)

  it('leaves the main checkout as it was', async () => {
    const { main, document } = await aRepoWithAWorktree()
    const found = await projectDocument(main)
    expect(found.kind === 'document' && samePath(found.path, document) && found.worktreeCopy === undefined).toBe(true)
    const { out } = await run(['start-here', main])
    expect(out).not.toContain("main checkout's copy")
  }, 60_000)

  it("refuses a worktree's commit of its own copy, and nothing else", async () => {
    const { main, worktree, copy } = await aRepoWithAWorktree()
    expect(await guard(worktree, 'git commit -m "Some work"')).toBe('')

    await sendInbox(copy, 'Written into the copy by mistake')
    expect(await guard(worktree, 'git commit -m "Some work"')).toBe('')
    expect(await guard(worktree, 'git commit -am "Some work"')).toContain('"permissionDecision":"deny"')
    git(worktree, 'add', 'docs/memory.emd')
    const refused = await guard(worktree, 'git add -A && git commit -m "Some work"')
    expect(refused).toContain('"permissionDecision":"deny"')
    expect(refused).toContain('git worktree')

    await sendInbox(join(main, 'docs', 'memory.emd'), 'Written in the main checkout')
    git(main, 'add', 'docs/memory.emd')
    expect(await guard(main, 'git commit -m "The rows"')).toBe('')
  }, 60_000)
})

describe('the hook set', () => {
  /** Every hook command, by event, with where the hooks' bundle is left out. */
  function commandsOf(settings: { hooks: Record<string, { hooks: { command: string }[] }[]> }, server: string | RegExp, as = '<server>'): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      out[event] = (settings.hooks[event] ?? []).flatMap((group) => group.hooks.map((hook) => hook.command.replace(server, as)))
    }
    return out
  }

  it("is the same in this repo's settings and in the set the plugin ships", async () => {
    const repo = JSON.parse(await readFile(join('.claude', 'settings.json'), 'utf8'))
    const shipped = JSON.parse(await readFile(join('hosts', 'claude', 'hooks', 'hooks.json'), 'utf8'))
    const here = commandsOf(repo, '$CLAUDE_PROJECT_DIR/dist-plugin/hooks.mjs')
    // The plugin runs the same bundle from the published package, pinned (M42 U4, D-499).
    expect(here).toEqual(commandsOf(shipped, /^npx -y --prefer-offline -p emerald-mcp@[\d.]+ emerald-hooks/, 'node "<server>"'))
    expect(here['SessionStart']).toEqual(['node "<server>" start-here "$CLAUDE_PROJECT_DIR"'])
    expect(here['UserPromptSubmit']).toEqual(['node "<server>" rows "$CLAUDE_PROJECT_DIR" inbox --match state=new --once-per-session'])
  })

  it('runs through the entry point, which reads the session from stdin and prints the rows on stdout', async () => {
    const { folder, path } = await aProject()
    await sendInbox(path, 'Through the entry point')
    const child = spawn(
      process.execPath,
      [join('node_modules', 'vite-node', 'vite-node.mjs'), join('hosts', 'claude', 'hooks', 'main.ts'), '--', 'rows', folder, 'inbox', '--match', 'state=new', '--once-per-session'],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.stdin.end(JSON.stringify({ session_id: 'through-the-entry-point', hook_event_name: 'UserPromptSubmit' }))
    const code = await new Promise<number | null>((settle) => child.on('close', settle))
    expect(code).toBe(0)
    expect(out).toContain('Through the entry point')
    // The same session, in-process: it was remembered.
    expect((await run(['rows', folder, 'inbox', '--match', 'state=new'], process.cwd(), 'through-the-entry-point')).out).toContain('printed in full earlier')
  }, 60_000)
})
