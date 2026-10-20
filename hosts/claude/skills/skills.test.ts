import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * **The skills a stranger gets are this folder's** (M42 U6), and the plugin
 * M42 U4 builds ships them. A skill this repository uses as it is keeps a copy
 * in `.claude/skills/`, where Claude Code finds it while Emerald is developed —
 * and the copy is the same file, byte for byte, or one of them has drifted.
 *
 * **The development pack's workflows are generic copies** (M42 U7, D-504):
 * run-milestone, closing-pass and review-phase for any project keeping the
 * pack, written from this repository's own, which stay in `.claude/skills/`
 * with its paths, its decision log and its npm scripts. So the generic ones
 * carry none of those: no decision or unit of this repository's cited, no note
 * of `docs/`, no script of `scripts/`, no `npm run`.
 *
 * **emerald-setup is the plugin's alone** (M42 F8): it tells a person whose
 * host started no plugin server how to add Emerald to the Claude app, which
 * this repository never needs, so it has no copy here and the same rule.
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))

const shipped = readdirSync(HERE, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
const GENERIC = ['run-milestone', 'closing-pass', 'review-phase']
const PLUGIN_ONLY = ['emerald-setup']
const skill = (name: string) => readFileSync(join(HERE, name, 'SKILL.md'), 'utf8')

describe('the skills Claude gets', () => {
  it("ships declare-a-format, the development pack's three workflows and the setup skill", () => {
    expect([...shipped].sort()).toEqual(['declare-a-format', ...GENERIC, ...PLUGIN_ONLY].sort())
  })

  it.each(shipped.filter((name) => !GENERIC.includes(name) && !PLUGIN_ONLY.includes(name)))('%s is the same file as the copy this repository develops with', (name) => {
    expect(skill(name)).toBe(readFileSync(join(ROOT, '.claude', 'skills', name, 'SKILL.md'), 'utf8'))
  })

  it.each([...GENERIC, ...PLUGIN_ONLY])('%s is its own, for any project: named for itself, and nothing of this repository in it', (name) => {
    const text = skill(name)
    expect(text).toMatch(new RegExp(`^---\nname: ${name}\ndescription: .+\n---\n`))
    if (!PLUGIN_ONLY.includes(name)) expect(text).not.toBe(readFileSync(join(ROOT, '.claude', 'skills', name, 'SKILL.md'), 'utf8'))
    for (const ours of [/\bD-\d{3}\b/, /\bM\d{2} [UF]\d+/, /docs\//, /scripts\//, /npm run/, /memory\.emd/, /decision log/i, /\bEmerald repo\b/]) {
      expect(text, `${name} names ${String(ours)}`).not.toMatch(ours)
    }
  })
})
