import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * **The skills a stranger gets are this folder's** (M42 U6), and the plugin
 * M42 U4 builds ships them. A skill this repository also uses keeps a copy in
 * `.claude/skills/`, where Claude Code finds it while Emerald is developed —
 * and the copy is the same file, byte for byte, or one of them has drifted.
 * This repository's own skills (closing-pass, run-milestone and the rest) are
 * not here: they name its paths, and a stranger has none of them.
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))

const shipped = readdirSync(HERE, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)

describe('the skills Claude gets', () => {
  it('ships declare-a-format', () => {
    expect(shipped).toContain('declare-a-format')
  })

  it.each(shipped)('%s is the same file as the copy this repository develops with', (skill) => {
    const ours = readFileSync(join(ROOT, '.claude', 'skills', skill, 'SKILL.md'), 'utf8')
    expect(readFileSync(join(HERE, skill, 'SKILL.md'), 'utf8')).toBe(ours)
  })
})
