import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * "No SQL string lives in `src/plugin/`" is an acceptance criterion of M7, not
 * a preference (D-092), so it is enforced by a test rather than by review.
 *
 * It is the mechanical test for **wrapper, not fork**. The whole bet of the
 * milestone is that the plugin reaches the ledger through `domain/` and
 * `data/repositories/` — the same functions the app calls — because a plugin
 * that wrote its own SQL would put the money rules, the merchant normalization
 * and the natural key in a second place and let them drift. That is easy to say
 * and easy to erode one convenient query at a time, and a grep is what makes
 * eroding it fail out loud.
 *
 * **One thing changed when tier 1 landed** (D-094): comments are stripped
 * before scanning. The rule is about code, this codebase explains itself at
 * length, and a check that punished a comment for naming a SQL keyword is a
 * check somebody eventually deletes instead of a check somebody obeys.
 *
 * **There are no exemptions, and that is worth stating** (D-095). Tier 1 shipped
 * for one commit with two: a general `query` tool, which had to name the
 * statements it refused, and its test, which had to write one out to prove the
 * refusal. Removing that tool took both exemptions with it and the rule went
 * back to covering every file under `src/plugin/` flatly. An exemption list is
 * the kind of thing that grows one file at a time until it is the rule, and
 * having none is worth more than having a short one.
 */

/**
 * Shapes only a real statement has. Kept beside the coarse net below because a
 * lone keyword is a word while `SELECT … FROM` is a query, and naming which one
 * was found is what makes a failure legible.
 */
const STATEMENTS = [
  /\bSELECT\b.*\bFROM\b/,
  /\bINSERT\s+INTO\b/,
  /\bUPDATE\b.*\bSET\b/,
  /\bDELETE\s+FROM\b/,
  /\bCREATE\s+(TABLE|INDEX|VIEW|TRIGGER)\b/,
  /\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER)\b/,
  /\bALTER\s+TABLE\b/,
  /\bPRAGMA\s+\w+/,
]

/** The coarse net: a bare SQL keyword at all. No file here has business with one. */
const BARE_KEYWORDS = [
  /\bSELECT\b/,
  /\bFROM\b/,
  /\bINSERT\b/,
  /\bUPDATE\b/,
  /\bDELETE\b/,
  /\bCREATE\b/,
  /\bDROP\b/,
  /\bPRAGMA\b/,
  /\bJOIN\b/,
]

/**
 * The other half of the same rule: reaching the database handle directly is how
 * SQL gets in. `db.close()` is allowed — that is a file handle, not a query.
 */
const RAW_DATABASE_CALLS = [/\bdb\.run\s*\(/, /\bdb\.exec\s*\(/, /\bdb\.prepare\s*\(/]

/** Excluded because it holds the patterns above as literals and would match itself. */
const SCANNER = 'noSql.test.ts'

/**
 * Comments out, code in.
 *
 * Block comments first, then line comments. A `//` inside a string literal
 * would truncate that line early, which is a hole — and an acceptable one,
 * because no string in this folder contains one and a SQL statement hiding
 * behind a slash-slash is not the failure mode this guards against.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

async function pluginSources(dir = 'src/plugin'): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name).replace(/\\/g, '/')
    if (entry.isDirectory()) files.push(...(await pluginSources(path)))
    else if (entry.name.endsWith('.ts') && entry.name !== SCANNER) files.push(path)
  }
  return files
}

describe('src/plugin is a wrapper, not a fork', () => {
  it('contains no SQL statement and touches no database handle directly', async () => {
    const files = await pluginSources()
    // A glob that quietly matched nothing would make this test pass forever.
    expect(files.length).toBeGreaterThan(8)

    const offences: string[] = []
    for (const file of files) {
      const patterns = [...STATEMENTS, ...RAW_DATABASE_CALLS, ...BARE_KEYWORDS]
      const lines = stripComments(await readFile(file, 'utf8')).split('\n')
      lines.forEach((line, index) => {
        for (const pattern of patterns) {
          if (pattern.test(line)) offences.push(`${file}:${index + 1}: ${line.trim()}`)
        }
      })
    }

    expect(offences).toEqual([])
  })

  it('has no general query tool for the rule to make an exception for', async () => {
    // The scan above has no exemption list, and this is what keeps it that way:
    // a tool that took SQL from a caller would need one. The failure should land
    // here, next to the reason, rather than as a puzzling line number in the
    // scan — and it should be read as a design question (D-095), not as a
    // scanner that needs loosening.
    expect(await pluginSources()).not.toContain('src/plugin/tools/query.ts')
  })
})
