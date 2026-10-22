import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { openDocument, PLUGIN_VERSION } from './document.ts'
import { parseInitArgs, runInit, SECTION_BEGIN, SECTION_END, withSection } from './init.ts'
import { extendFormatTool } from './tools/formats.ts'
import { NO_CLIENT } from './tools/tool.ts'
import { tempDir } from '../testing/tempDir'

/**
 * **`npx emerald-mcp init`** (M50 U1): a repository set up to keep its
 * planning in a document, by one command — and the second run changes nothing.
 */

interface Run {
  readonly code: number
  readonly out: string
  readonly problems: string
}

async function init(folder: string, configDir: string, document?: string): Promise<Run> {
  const args = parseInitArgs(document === undefined ? [] : [document], folder)
  if (!args.ok) throw new Error(args.error)
  const out: string[] = []
  const problems: string[] = []
  const code = await runInit(args.value, { configDir }, { line: (text) => out.push(text), complain: (text) => problems.push(text) })
  return { code, out: out.join('\n'), problems: problems.join('\n') }
}

/** An empty repository and an empty Claude config folder beside it. */
async function repo(): Promise<{ folder: string; config: string }> {
  const root = await tempDir('emerald-init-')
  const folder = join(root, 'repo')
  const config = join(root, 'config')
  await mkdir(folder)
  await mkdir(config)
  return { folder, config }
}

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

describe('init', () => {
  it('sets an empty repository up: the document as text, the section, the hooks, and start_here', async () => {
    const { folder, config } = await repo()
    const run = await init(folder, config)
    expect(run.problems).toBe('')
    expect(run.code).toBe(0)

    const path = join(folder, 'docs', 'memory.emd')
    const opened = await openDocument(path)
    if (!opened.ok) throw new Error(opened.error.message)
    expect(opened.value.encoding).toBe('text')
    opened.value.db.close()

    expect(JSON.parse(await read(join(folder, '.claude', 'emerald.json')))).toEqual({ document: 'docs/memory.emd' })

    const claude = await read(join(folder, 'CLAUDE.md'))
    expect(claude.startsWith(SECTION_BEGIN)).toBe(true)
    expect(claude.trimEnd().endsWith(SECTION_END)).toBe(true)
    expect(claude).toContain('| `start_here` answers | The whole list |')
    expect(claude).toContain('**Ready to start** `unit`')
    expect(claude).toContain('### What a row looks like')
    expect(claude).toMatch(/^- `decision` — /m)

    const settings = JSON.parse(await read(join(folder, '.claude', 'settings.json'))) as {
      hooks: Record<string, { matcher?: string; hooks: { command: string; timeout: number }[] }[]>
    }
    expect(settings.hooks['SessionStart']?.[0]?.matcher).toBe('startup|clear|compact')
    expect(settings.hooks['SessionStart']?.[0]?.hooks[0]?.command).toBe(
      `npx -y --prefer-offline -p emerald-mcp@${PLUGIN_VERSION} emerald-hooks start-here "$CLAUDE_PROJECT_DIR"`,
    )
    expect(settings.hooks['UserPromptSubmit']?.[0]?.hooks[0]?.command).toContain('emerald-hooks rows "$CLAUDE_PROJECT_DIR" inbox --match state=new --once-per-session')

    expect(run.out).toContain('created, keeping the development pack. Stored as text')
    expect(run.out).toContain('A session here now sees first — start_here on docs/memory.emd:')
    expect(run.out).toContain('### Ready to start — unit')
  })

  it('changes nothing the second time, to the byte', async () => {
    const { folder, config } = await repo()
    await init(folder, config)
    const files = ['CLAUDE.md', join('.claude', 'settings.json'), join('.claude', 'emerald.json'), join('docs', 'memory.emd')]
    const before = await Promise.all(files.map((file) => read(join(folder, file))))
    const again = await init(folder, config)
    expect(again.code).toBe(0)
    expect(await Promise.all(files.map((file) => read(join(folder, file))))).toEqual(before)
    expect(again.out).toContain('CLAUDE.md — unchanged')
    expect(again.out).toContain('.claude/settings.json — unchanged')
    expect(again.out).toContain('there already; read, never written')
  })

  it('writes the section again after a format changes, and nothing outside it', async () => {
    const { folder, config } = await repo()
    await writeFile(join(folder, 'CLAUDE.md'), '# A project\r\n\r\nIts own words.\r\n')
    await init(folder, config)
    const settings = await read(join(folder, '.claude', 'settings.json'))
    const first = await read(join(folder, 'CLAUDE.md'))
    expect(first.startsWith('# A project\r\n\r\nIts own words.\r\n\r\n<!-- emerald-init:')).toBe(true)
    expect(first).not.toMatch(/[^\r]\n/)
    expect(first).not.toContain('reviewer')

    const path = join(folder, 'docs', 'memory.emd')
    await extendFormatTool.run({ path, format: 'unit', columns: [{ name: 'reviewer', type: 'text' }], commit: true }, NO_CLIENT)
    const run = await init(folder, config)
    expect(run.code).toBe(0)
    const second = await read(join(folder, 'CLAUDE.md'))
    expect(second.startsWith('# A project\r\n\r\nIts own words.\r\n\r\n<!-- emerald-init:')).toBe(true)
    expect(second).toMatch(/^- `unit` — .*reviewer/m)
    expect(second.split(SECTION_END)).toHaveLength(2)
    expect(await read(join(folder, '.claude', 'settings.json'))).toBe(settings)
  })

  it('writes no hooks where the Claude plugin is enabled', async () => {
    const { folder, config } = await repo()
    await writeFile(join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'emerald@emerald-emd': true } }))
    const run = await init(folder, config)
    expect(run.code).toBe(0)
    expect(run.out).toContain('no hooks written: the Claude plugin brings the same two')
    await expect(read(join(folder, '.claude', 'settings.json'))).rejects.toThrow()
  })

  it('merges into the settings there, and leaves a start-here hook it did not write', async () => {
    const { folder, config } = await repo()
    const own = 'node "$CLAUDE_PROJECT_DIR/dist-plugin/hooks.mjs" start-here "$CLAUDE_PROJECT_DIR"'
    await mkdir(join(folder, '.claude'))
    await writeFile(
      join(folder, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(ls)'] },
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node guard.mjs' }] }],
          SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: own, timeout: 30 }] }],
        },
      }),
    )
    const run = await init(folder, config)
    expect(run.code).toBe(0)
    expect(run.out).toContain('SessionStart: left as it is — a hook this did not write already runs')
    const settings = JSON.parse(await read(join(folder, '.claude', 'settings.json'))) as {
      permissions: unknown
      hooks: Record<string, { hooks: { command: string }[] }[]>
    }
    expect(settings.permissions).toEqual({ allow: ['Bash(ls)'] })
    expect(settings.hooks['PreToolUse']?.[0]?.hooks[0]?.command).toBe('node guard.mjs')
    expect(settings.hooks['SessionStart']).toHaveLength(1)
    expect(settings.hooks['SessionStart']?.[0]?.hooks[0]?.command).toBe(own)
    expect(settings.hooks['UserPromptSubmit']?.[0]?.hooks[0]?.command).toContain('emerald-hooks rows')
  })

  it('pins a hook it wrote at an older version to this one', async () => {
    const { folder, config } = await repo()
    await init(folder, config)
    const path = join(folder, '.claude', 'settings.json')
    await writeFile(path, (await read(path)).replaceAll(`emerald-mcp@${PLUGIN_VERSION}`, 'emerald-mcp@0.0.1'))
    const run = await init(folder, config)
    expect(run.out).toContain(`SessionStart: pinned to emerald-mcp@${PLUGIN_VERSION}`)
    expect(await read(path)).not.toContain('0.0.1')
  })

  it('keeps a document outside the repository as SQLite bytes, named by its absolute path', async () => {
    const { folder, config } = await repo()
    const outside = join(folder, '..', 'planning.emd')
    const run = await init(folder, config, outside)
    expect(run.code).toBe(0)
    expect(run.out).toContain('Stored as SQLite bytes, outside this repository')
    const opened = await openDocument(outside)
    if (!opened.ok) throw new Error(opened.error.message)
    expect(opened.value.encoding).toBe('sqlite')
    opened.value.db.close()
    const named = JSON.parse(await read(join(folder, '.claude', 'emerald.json'))) as { document: string }
    expect(named.document).toBe(outside.split(sep).join('/'))
  })

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseInitArgs(['notes.txt'], '/x').ok).toBe(false)
    expect(parseInitArgs(['a.emd', 'b.emd'], '/x').ok).toBe(false)
    expect(parseInitArgs(['--force'], '/x').ok).toBe(false)
    expect(withSection(`${SECTION_BEGIN} x -->\nno end\n`, 'section').ok).toBe(false)
  })
})
