import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * **What only Claude reads lives in `hosts/claude/`, and the server imports
 * none of it** (M42 U6).
 *
 * The MCP server is the same for every client that runs a local server; a hook,
 * a status line, a skill and a plugin manifest are Claude's alone. The line
 * between them is a folder, and a folder is a rule somebody has to remember —
 * so it is checked here, both ways:
 *
 * - nothing in `src/` or `electron/` imports from `hosts/`;
 * - a host's code reaches `src/` only through `src/plugin/host.ts`, what the
 *   server exports for hosts, and `electron/` only through `bridge.ts`, the
 *   constants every layer already shares. A host's test may also use
 *   `src/testing/`, the suite's own helpers.
 *
 * Packages and Node's modules are anybody's.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)'([^']+)'/gm

/** Where an import lands, relative to the repository, or undefined for a package. */
function landing(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('@/')) return join('src', specifier.slice(2))
  if (specifier.startsWith('./') || specifier.startsWith('../')) return normalize(join(dirname(file), specifier))
  return undefined
}

/** One file's imports that cross the line, as `file → landing`. */
function crossings(file: string, source: string): string[] {
  const out: string[] = []
  const top = file.split(/[\\/]/)[0]
  const isTest = file.endsWith('.test.ts')
  for (const [, specifier] of source.matchAll(SPECIFIER)) {
    if (specifier === undefined) continue
    const target = landing(file, specifier)
    if (target === undefined) continue
    const into = target.split(/[\\/]/)[0]
    const posix = target.split(sep).join('/')
    if (top !== 'hosts' && into === 'hosts') out.push(`${file} → ${posix}`)
    if (top === 'hosts') {
      if (into === 'src' && posix !== 'src/plugin/host.ts' && !(isTest && posix.startsWith('src/testing/'))) out.push(`${file} → ${posix}`)
      if (into === 'electron' && posix !== 'electron/bridge.ts') out.push(`${file} → ${posix}`)
    }
  }
  return out
}

function sourcesUnder(folder: string): string[] {
  return readdirSync(join(ROOT, folder), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(folder, name))
}

describe('the line between the server and a host', () => {
  it('holds over the tree: src/ and electron/ import nothing from hosts/, and hosts/ only host.ts and bridge.ts', () => {
    // This file is left out: its cases below spell crossings out on purpose.
    const files = [...sourcesUnder('src'), ...sourcesUnder('electron'), ...sourcesUnder('hosts')].filter(
      (file) => file !== join('src', 'plugin', 'hostBoundary.test.ts'),
    )
    expect(files.some((file) => file.startsWith(join('hosts', 'claude')))).toBe(true)
    const found = files.flatMap((file) => crossings(relative(ROOT, join(ROOT, file)), readFileSync(join(ROOT, file), 'utf8')))
    expect(found).toEqual([])
  })

  it('fails when the server imports a host', () => {
    expect(crossings(join('src', 'plugin', 'main.ts'), "import { runHook } from '../../hosts/claude/hooks/commands.ts'\n")).toEqual([
      `${join('src', 'plugin', 'main.ts')} → hosts/claude/hooks/commands.ts`,
    ])
    expect(crossings(join('src', 'plugin', 'main.ts'), "const m = await import('../../hosts/claude/hooks/main.ts')\n")).toHaveLength(1)
    expect(crossings(join('electron', 'main.ts'), "import '../hosts/claude/hooks/told.ts'\n")).toHaveLength(1)
  })

  it('fails when a host reaches past what the server exports', () => {
    const hook = join('hosts', 'claude', 'hooks', 'commands.ts')
    expect(crossings(hook, "import { formatRowsTool } from '@/plugin/tools/formats.ts'\n")).toEqual([`${hook} → src/plugin/tools/formats.ts`])
    expect(crossings(hook, "import { x } from '../../../electron/network.ts'\n")).toHaveLength(1)
    expect(crossings(hook, "import { tempDir } from '@/testing/tempDir'\n")).toHaveLength(1)
    // What is allowed.
    expect(crossings(hook, "import { formatRowsTool } from '@/plugin/host.ts'\nimport { DOCUMENT_EXTENSION } from '../../../electron/bridge.ts'\nimport { x } from './told.ts'\nimport { y } from 'node:fs'\n")).toEqual([])
    expect(crossings(join('hosts', 'claude', 'hooks', 'commands.test.ts'), "import { tempDir } from '@/testing/tempDir'\n")).toEqual([])
  })
})
