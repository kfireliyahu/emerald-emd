/**
 * **U4 against the only real document the engine has** — `docs/memory.emd`,
 * which is this project's own decisions, units, review entries and open
 * questions (M22 U1, D-240).
 *
 * The whole unit is one claim — *the text is complete, deterministic and reads
 * back* — and the way to test a claim like that is not a fixture somebody wrote
 * to pass it. Four times here a real document destroyed a green suite, so the
 * round trip below runs over the real one: 36
 * rows across four formats, one of them self-referential, one of them carrying
 * an eighteen-link chain of `supersedes`.
 *
 * `document.test.ts` is where the shapes a real document does not have yet get
 * proved — money, quantities, a newline in a cell, a unit somebody corrected.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { joinParts, splitParts } from '@/domain/format/document.ts'
import { createDatabase } from '../db/database.ts'
import { openEncoded } from '../storage/encoding.ts'
import { listFormats } from './formatRepository.ts'
import { countRows, listRows } from './formatRowRepository.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'

const MEMORY = fileURLToPath(new URL('../../../docs/memory.emd', import.meta.url))

const NOW = Date.UTC(2026, 8, 20)

/** A uuid, which is the one thing that must not appear anywhere in the text. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

/**
 * The document through the app's own door. The file is text since D-246, so
 * what is serialized here was itself read from text — which makes the round
 * trip below a second lap of the one the file already survived, not a weaker one.
 */
async function openMemory(): Promise<Database> {
  const { db } = await openEncoded(readFileSync(MEMORY))
  return db
}

describe("this project's own memory, serialized", () => {
  // And, since M27 U3, the development pack's two boards (D-301); since M40 U2,
  // the project's own `rule` format beside the pack's formats (D-435), and since
  // M40 U3 its `term` format (D-436); since M44 U1 the pack's sixth, `inbox` (D-439).
  it('writes a part per format, its views, and nothing for the units it was seeded with', async () => {
    const db = await openMemory()
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)

    expect(parts.value.map((part) => part.name)).toEqual([
      'decision.format.md',
      'finding.format.md',
      'inbox.format.md',
      'milestone.format.md',
      'open_question.format.md',
      'review_entry.format.md',
      'rule.format.md',
      'term.format.md',
      'unit.format.md',
      'views.md',
      // When each format last changed (M47 U5, D-462).
      'changed.md',
    ])
    db.close()
  })

  it('names a link by the row it points at and never by an id', async () => {
    const db = await openMemory()
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const decisions = parts.value.find((part) => part.name === 'decision.format.md')?.text ?? ''

    // D-244 supersedes D-243, and this is the whole of D-241 landing in a diff:
    // the alternative reads `supersedes: 0c0af4de-6da3-4935-9201-54246964ddca`.
    expect(decisions).toContain('supersedes: D-243')
    expect(decisions).toContain('### D-244')

    for (const part of parts.value) {
      expect(part.text).not.toMatch(UUID)
    }
    db.close()
  })

  it('reads back into an empty document with every row and every link', async () => {
    const source = await openMemory()
    const parts = serializeDocument(source)
    if (!parts.ok) throw new Error(parts.error)

    const rebuilt = await createDatabase()
    const applied = applyParts(rebuilt, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)

    expect(listFormats(rebuilt).map((each) => each.name)).toEqual(
      listFormats(source).map((each) => each.name).sort(),
    )
    for (const declaration of listFormats(source)) {
      expect(countRows(rebuilt, declaration)).toBe(countRows(source, declaration))
    }

    // The links resolved, rather than having quietly become null: the chain of
    // `supersedes` is the case D-224's one hop cannot follow, so if anything
    // here dropped a pointer nothing else in the suite would notice.
    const decision = listFormats(source).find((each) => each.name === 'decision')
    if (decision === undefined) throw new Error('memory.emd declares no decision format')
    const before = listRows(source, decision).filter(
      (row) => typeof row.cells['supersedes'] === 'string',
    ).length
    const after = listRows(rebuilt, decision).filter(
      (row) => typeof row.cells['supersedes'] === 'string',
    ).length
    expect(after).toBe(before)
    expect(before).toBeGreaterThan(0)

    source.close()
    rebuilt.close()
  })

  it('writes the same bytes from the document it just rebuilt', async () => {
    const source = await openMemory()
    const first = serializeDocument(source)
    if (!first.ok) throw new Error(first.error)

    const rebuilt = await createDatabase()
    const applied = applyParts(rebuilt, first.value, NOW)
    if (!applied.ok) throw new Error(applied.error)

    const second = serializeDocument(rebuilt)
    if (!second.ok) throw new Error(second.error)

    // **The property a clean filter needs.** The two databases differ in bytes
    // — different ids, different page layout — and the two texts do not, which
    // is the difference between a logical serialization and a byte-level one.
    expect(second.value).toEqual(first.value)

    source.close()
    rebuilt.close()
  })

  it('folds into one text and splits back out of it', async () => {
    const db = await openMemory()
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)

    const joined = joinParts(parts.value)
    if (!joined.ok) throw new Error(joined.error)

    const split = splitParts(joined.value)
    if (!split.ok) throw new Error(split.error)
    expect(split.value).toEqual(parts.value)

    db.close()
  })

  it('refuses to read text over a document that already has formats', async () => {
    const db = await openMemory()
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)

    const applied = applyParts(db, parts.value, NOW)
    expect(applied.ok).toBe(false)
    if (applied.ok) throw new Error('expected a refusal')
    expect(applied.error).toContain('already declares')

    db.close()
  })
})
