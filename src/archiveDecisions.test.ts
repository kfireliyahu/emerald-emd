// `scripts/archive-decisions.mjs` run on a fixture checkout (M52). When it
// archived M42's nine entries on 2026-10-22 it named the milestone only on the
// one index row whose link text already said `M42` — the other eight kept the
// text of `[below](#d-NNN)` and docs:check failed on them — and it rewrote a
// path quoted in a comment of `scripts/docs-check.mjs`. Both were fixed by hand.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from './testing/tempDir'

const SCRIPT = join(__dirname, '..', 'scripts', 'archive-decisions.mjs')

const MEMORY = `<!-- emerald document, schema 62 -->
<!-- emerald: decision.format.md -->
## rows

### D-001
milestone: M1

### D-002
milestone: M1

### D-003
milestone: M1

### D-004
milestone: M2

<!-- emerald: milestone.format.md -->
## rows

### M1
title: The first one
state: closed

### M2
title: The second one
state: open
`

const entry = (n: number, text: string) => `## D-00${n} · 2026-10-01 · Decision ${n} <a id="d-00${n}"></a>

${text}
`

const LOG = `# Decision log

## Index

| # | Date | Decision | Where |
|---|---|---|---|
| D-001 | 2026-10-01 | Decision 1 | [below](#d-001) |
| D-002 | 2026-10-01 | Decision 2 | [M1](#d-002) |
| D-003 | 2026-10-01 | Decision 3 | [below](#d-003) |
| D-004 | 2026-10-01 | Decision 4 | [below](#d-004) |

---

${entry(1, 'The first.')}
${entry(2, 'Amends [D-001](#d-001).')}
${entry(3, 'The third.')}
${entry(4, 'Follows [D-003](#d-003).')}
## Related

- [Conventions](./conventions.md)
`

// A doc comment quoting a path to an entry, as docs-check.mjs's does.
const CODE = '/** A link to a decision\'s anchor — `09-decision-log.md#d-001`. */\nexport {}\n'

async function fixture() {
  const root = await tempDir('emerald-archive-')
  const files: Record<string, string> = {
    'docs/09-decision-log.md': LOG,
    'docs/memory.emd': MEMORY,
    'docs/conventions.md': 'Why: [the first](./09-decision-log.md#d-001), and [the fourth](./09-decision-log.md#d-004).\n',
    'scripts/docs-check.mjs': CODE,
    'README.md': 'See `docs/09-decision-log.md#d-002`.\n',
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
  return { root, git, read: (file: string) => readFileSync(join(root, file), 'utf8') }
}

describe('archive-decisions', () => {
  it('names the milestone on every archived entry’s index row, and changes nothing outside docs/', async () => {
    const { root, git, read } = await fixture()
    execFileSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })

    const log = read('docs/09-decision-log.md')
    const where = (id: string) => new RegExp(`^\\| ${id} \\|.*\\| ([^|]*) \\|$`, 'm').exec(log)?.[1]
    expect(['D-001', 'D-002', 'D-003'].map(where)).toEqual(['M1', 'M1', 'M1'])
    expect(where('D-004')).toBe('[below](#d-004)')
    expect(log).not.toMatch(/^## D-00[123] /m)
    expect(log).toContain('Follows D-003.')

    expect(read('docs/conventions.md')).toBe(
      'Why: the first, and [the fourth](./09-decision-log.md#d-004).\n',
    )
    const changed = git('status', '--porcelain', '--untracked-files=all')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3))
    expect(changed.every((file) => file.startsWith('docs/'))).toBe(true)
    expect(changed.filter((file) => file.startsWith('docs/archive/'))).toHaveLength(1)
    expect(read('scripts/docs-check.mjs')).toBe(CODE)
  })
})
