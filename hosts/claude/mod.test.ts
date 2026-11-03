import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { tempDir } from '@/testing/tempDir'
import { projectDocument as hookRule, PROJECT_FILE } from './hooks/project.ts'
import { paneSections } from './mod/answer.ts'
import { projectDocument as modRule, type ProjectDocument, type ProjectFiles } from './mod/project.ts'
import { pluginDigest } from './release.ts'

/**
 * **The hooks module's parts a test can read without Claude Code** (M56 U1):
 * its folder rule, held to the command hooks' own; what its pane keeps of an
 * answer; that it only ever reads; and that the release digest covers it. The
 * module itself is tested by `claude plugin test hosts/claude`, in
 * `mod/pane.test.tsx`.
 */
const HERE = fileURLToPath(new URL('.', import.meta.url))
const MOD = join(HERE, 'mod')

/** `$.fs`, as the rule asks it, answered by Node's. */
const nodeFiles: ProjectFiles = {
  read: (path) => readFile(path, 'utf8'),
  list: async (path) => (await readdir(path)).map((name) => ({ name })),
  stat: async (path) => {
    const found = await stat(path)
    return { kind: found.isFile() ? 'file' : found.isDirectory() ? 'dir' : 'other' }
  },
}

/** The answer with its paths as the platform spells them, so the two rules compare. */
function spelled(document: ProjectDocument): ProjectDocument {
  if (document.kind !== 'document') return document
  return {
    kind: 'document',
    path: normalize(document.path),
    ...(document.worktreeCopy === undefined ? {} : { worktreeCopy: normalize(document.worktreeCopy) }),
  }
}

async function bothRules(folder: string): Promise<{ hook: ProjectDocument; mod: ProjectDocument }> {
  return { hook: await hookRule(folder), mod: spelled(await modRule(nodeFiles, folder)) }
}

describe("the module's folder rule is the command hooks' rule", () => {
  it('finds nothing in an empty folder or one with two documents', async () => {
    const folder = await tempDir('emerald-mod-')
    expect(await bothRules(folder)).toEqual({ hook: { kind: 'none' }, mod: { kind: 'none' } })
    await writeFile(join(folder, 'a.emd'), '')
    await writeFile(join(folder, 'b.emd'), '')
    expect(await bothRules(folder)).toEqual({ hook: { kind: 'none' }, mod: { kind: 'none' } })
  })

  it('takes the one .emd, its named copies not counted', async () => {
    const folder = await tempDir('emerald-mod-')
    await writeFile(join(folder, 'planner.emd'), '')
    await writeFile(join(folder, 'planner.before-20261009T062530-reading-tasks.emd'), '')
    const { hook, mod } = await bothRules(folder)
    expect(hook).toEqual({ kind: 'document', path: join(folder, 'planner.emd') })
    expect(mod).toEqual(hook)
  })

  it('takes what .claude/emerald.json names, and says when it is wrong', async () => {
    const folder = await tempDir('emerald-mod-')
    await mkdir(join(folder, '.claude'))
    await mkdir(join(folder, 'docs'))
    await writeFile(join(folder, 'other.emd'), '')
    await writeFile(join(folder, PROJECT_FILE), JSON.stringify({ document: 'docs/memory.emd' }))
    expect((await modRule(nodeFiles, folder)).kind).toBe('problem')
    expect((await hookRule(folder)).kind).toBe('problem')
    await writeFile(join(folder, 'docs', 'memory.emd'), '')
    const { hook, mod } = await bothRules(folder)
    expect(hook).toEqual({ kind: 'document', path: join(folder, 'docs', 'memory.emd') })
    expect(mod).toEqual(hook)
    await writeFile(join(folder, PROJECT_FILE), '{ not json')
    expect(await modRule(nodeFiles, folder)).toMatchObject({ kind: 'problem', message: expect.stringContaining('not JSON') })
  })

  it("takes a linked worktree's document at the main checkout, as git says", async () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Emerald test', '-c', 'user.email=test@emerald.invalid', ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    const main = await tempDir('emerald-mod-main-')
    await mkdir(join(main, '.claude'))
    await mkdir(join(main, 'docs'))
    await writeFile(join(main, 'docs', 'memory.emd'), 'text')
    await writeFile(join(main, PROJECT_FILE), JSON.stringify({ document: 'docs/memory.emd' }))
    git(main, 'init', '-q')
    git(main, 'add', '.')
    git(main, 'commit', '-q', '-m', 'The document')
    const worktree = join(await tempDir('emerald-mod-worktree-'), 'branch')
    git(main, 'worktree', 'add', '-q', '-b', 'branch', worktree)

    const { hook, mod } = await bothRules(worktree)
    expect(hook.kind).toBe('document')
    expect(mod).toEqual(spelled(hook))
    // And in the main checkout, which is not moved.
    expect(spelled(await modRule(nodeFiles, main))).toEqual(spelled(await hookRule(main)))
  })
})

describe('what the pane keeps of an answer', () => {
  const answer = [
    '**For you, never the person — do not repeat or paraphrase this line.** Say nothing about tools.',
    '### Ready to start — unit',
    '_state is planned, and nothing in blocks is still open._',
    '- M2 U3 · M2 · requests are limited',
    'Held:\n- M3 U1 · M3 · reported — waits on M2 U3',
    'Stalled — in_progress, taken more than 2 days ago:\n- M2 U1 · started 2026-10-01',
    '### inbox — state is new',
    'None.',
    'Whole list: `format_rows inbox match:{state:new}`.',
    '### milestone — state is open',
    '- M2 · Public API',
    '12 rows in all. Whole list: `format_rows milestone match:{state:open}`.',
    '**Untouched longest:** `book` · 3 rows · 2026-10-01. Every format: `formats`.',
    'New work begins with `formats`, which says what this document holds.',
    '### What a row looks like',
    '- `unit` — **ref**: unique',
    'Every write — `record_format_rows` — is a dry run until `commit: true`.',
  ].join('\n\n')

  it('keeps the sections, their lines and what they say of themselves', () => {
    expect(paneSections(answer)).toEqual([
      {
        heading: 'Ready to start — unit',
        notes: ['state is planned, and nothing in blocks is still open.'],
        lines: [
          { text: 'M2 U3 · M2 · requests are limited' },
          { text: 'M3 U1 · M3 · reported — waits on M2 U3', under: 'Held' },
          { text: 'M2 U1 · started 2026-10-01', under: 'Stalled — in_progress, taken more than 2 days ago' },
        ],
      },
      { heading: 'inbox — state is new', notes: ['None.'], lines: [] },
      { heading: 'milestone — state is open', notes: ['12 rows in all.'], lines: [{ text: 'M2 · Public API' }] },
    ])
  })

  it('says nothing meant for the model: no first line, no call, no shape of a row (D-493)', () => {
    const said = JSON.stringify(paneSections(answer))
    for (const word of ['For you', 'format_rows', 'formats`', 'Whole list', 'What a row', 'record_format_rows', 'Untouched']) {
      expect(said).not.toContain(word)
    }
  })

  it('reads a show_format answer, which has no headings', () => {
    const shown = '**For you.** Nothing.\n\nunit as its sheet — 2 rows.\n\n- M1 U1 · built\n- M2 U3 · planned\n\nEvery column is one call away: `format_rows unit`.'
    expect(paneSections(shown)).toEqual([
      { notes: ['unit as its sheet — 2 rows.'], lines: [{ text: 'M1 U1 · built' }, { text: 'M2 U3 · planned' }] },
    ])
  })
})

describe('the module', () => {
  const sources = readdirSync(MOD)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => ({ name, text: readFileSync(join(MOD, name), 'utf8') }))

  it('asks the server only the read tools it names, since $.mcp.call asks the person nothing', () => {
    const calls = sources.flatMap(({ name, text }) => [...text.matchAll(/\$\.mcp\.call\(([^)]*)\)/g)].map((found) => `${name}: ${found[1]}`))
    // One call in pane.tsx, whose tool is typed as one of READ_TOOLS, and one in inbox.ts (M56 U2), one of INBOX_READS.
    expect(calls.sort()).toEqual(['inbox.ts: connected.server, tool, args', 'pane.tsx: connected.server, tool, args'])
    const pane = sources.find((source) => source.name === 'pane.tsx')?.text ?? ''
    expect(pane).toMatch(/tool: \(typeof READ_TOOLS\)\[number\]/)
    expect(pane).toContain("export const READ_TOOLS = ['start_here', 'show_format'] as const")
    const inbox = sources.find((source) => source.name === 'inbox.ts')?.text ?? ''
    expect(inbox).toMatch(/type Read = \(typeof INBOX_READS\)\[number\]/)
    expect(inbox).toMatch(/async function ask\(\$: EngineInterface, tool: Read,/)
    expect(inbox).toContain("export const INBOX_READS = ['start_here', 'format_rows'] as const")
  })

  it('imports only its own files and claude-code, and never with import()', () => {
    for (const { name, text } of sources) {
      const imported = [...text.matchAll(/^import .* from '([^']+)'/gm)].map((found) => found[1])
      expect(imported.every((from) => from === 'claude-code' || from?.startsWith('./')), name).toBe(true)
      expect(text, name).not.toMatch(/\bimport\(/)
    }
  })

  it('is part of what the plugin ships, so a change to it cuts a new version', async () => {
    const before = pluginDigest(HERE)
    const register = join(MOD, 'register.tsx')
    const text = await readFile(register, 'utf8')
    try {
      await writeFile(register, `${text}\n// a change\n`)
      expect(pluginDigest(HERE)).not.toBe(before)
    } finally {
      await writeFile(register, text)
    }
    expect(pluginDigest(HERE)).toBe(before)
  })
})
