import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { denylistTerms } from './domain/format/searchTerms.ts'
import { searchDocumentTool } from './plugin/tools/searchDocument.ts'
import { NO_CLIENT } from './plugin/tools/tool.ts'

/**
 * **Nothing personal in the repository** — M36 U13.
 *
 * Real documents taught the engine its rules, and for a while the
 * repository carried pieces of them: a bank's name where a test meant *a bank*,
 * a payslip's figures, a card's last four digits, the name of a file on
 * disk. They were replaced with synthetic stand-ins, and this keeps them out.
 *
 * The real terms live in a denylist **outside the repository**, because a list
 * of what must never be committed cannot itself be committed. It is read from
 * `$EMERALD_DENYLIST`, or `~/.emerald/denylist.txt`; when neither exists — any
 * other machine, any other clone — the check skips rather than fails.
 *
 * The file is in `git filter-repo --replace-text` form, so one list serves the
 * check and the history rewrite: `literal==>replacement` or
 * `regex:pattern==>replacement`, one per line, `#` for a comment. Only the left
 * side is read here. A failure names the file and the denylist's line number,
 * never the term, so the output does not repeat what it is guarding.
 *
 * What it cannot see: binary files (a synthetic `.xlsx` is zipped XML), which
 * is why fixtures are generated from scripts that are text. **A `.emd` is the
 * exception since M47 U6**: it is opened and scanned as a document, through the
 * same `search_document` a person runs before sharing one, so one stored as
 * SQLite bytes is read too.
 */

const DENYLIST = process.env.EMERALD_DENYLIST ?? join(homedir(), '.emerald', 'denylist.txt')

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((path) => path !== '')
}

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0)
}

describe.skipIf(!existsSync(DENYLIST))('nothing personal in the repository (M36 U13)', () => {
  it('no tracked file holds a term from the denylist', () => {
    // One parser for the check, the history rewrite's file and a document's scan (M47 U6).
    const terms = denylistTerms(readFileSync(DENYLIST, 'utf8'))
    expect(terms.length).toBeGreaterThan(0)

    const found: string[] = []
    for (const path of trackedFiles()) {
      if (!existsSync(path)) continue // deleted in the working tree, not yet staged
      const bytes = readFileSync(path)
      if (isBinary(bytes)) continue
      const text = bytes.toString('utf8')
      for (const term of terms) {
        const n = term.count(text)
        if (n > 0) found.push(`${path}: denylist ${term.name} (${n}×)`)
      }
    }
    expect(found).toEqual([])
  })

  // **A document is scanned as a document** (M47 U6): every value it holds, as
  // it is shown, and its bytes — where a deleted value stays in a document
  // stored as SQLite bytes, which the text check above skips as binary. The
  // answer names rows and denylist lines, never a term.
  it('no tracked document holds a term from the denylist, scanned through search_document', async () => {
    const documents = trackedFiles().filter((path) => path.endsWith('.emd') && existsSync(path))
    expect(documents).toContain('docs/memory.emd')
    for (const path of documents) {
      const answer = await searchDocumentTool.run({ path: join(process.cwd(), path), denylist: DENYLIST }, NO_CLIENT)
      expect(answer, path).toMatch(/^Clean: /)
    }
  }, 60_000)

  it('the denylist itself is not in the repository', () => {
    const named = trackedFiles().filter((path) => /denylist|replace-text/i.test(path))
    expect(named).toEqual([])
  })
})
