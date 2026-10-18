/**
 * **U6 against the only real document the engine has** — M22 U6, D-246.
 *
 * The claim is that a `.emd` may *be* text, so the test that means anything is
 * the real document going all the way round: `docs/memory.emd` — this
 * project's own decisions, units, review entries and open questions — written
 * as text, opened from that text, and written again. U4 proved the serializer
 * round-trips; what is proved here is the *file*, header and sniff and all.
 *
 * The refusal gets the same treatment. A text save that quietly dropped a
 * ledger is the one failure this app is named against, so the case below puts a
 * row in a pack table and expects the save to say so by name.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import { bringUpToDate } from '../packs/packs.ts'
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import {
  createDatabase,
  exportDatabase,
  query,
  SCHEMA_VERSION,
  SchemaTooNewError,
} from '../db/database.ts'
import { column } from '@/domain/format/declaration.ts'
import { adoptFormat, listFormats } from '../repositories/formatRepository.ts'
import { countRows, insertRows, listRows } from '../repositories/formatRowRepository.ts'
import { boardSettings, entryInputs, setBoardLanes, setEntryInput } from '../repositories/formatViewRepository.ts'
import {
  exportEncoded,
  openEncoded,
  openEncodedWithoutMigrating,
} from './encoding.ts'

const MEMORY = fileURLToPath(new URL('../../../docs/memory.emd', import.meta.url))

function memoryBytes(): Uint8Array {
  return readFileSync(MEMORY)
}

/**
 * The same document as SQLite bytes. The file itself is text (D-246, so it diffs
 * in git), and the binary is made here by exporting what it opens to — never by
 * writing the file back, which other writers share.
 */
async function memorySqliteBytes(): Promise<Uint8Array> {
  const { db } = await openEncoded(memoryBytes())
  const bytes = exportDatabase(db)
  db.close()
  return bytes
}

async function textOf(db: Database): Promise<Uint8Array> {
  const encoded = await exportEncoded(db, 'text')
  if (!encoded.ok) throw new Error(encoded.error)
  return encoded.value
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/**
 * Every format with its row count, which is what "the same document" means here
 * — **sorted, because the order is not one of the things the text carries.**
 *
 * `listFormats` orders by `created_at` and then by name. A text document mints
 * every `created_at` at the moment it is read, so after a round trip the
 * tie-break decides and the formats come back alphabetically rather than in the
 * order they were declared. Deterministic, and deliberately not fixed: the
 * alternative is a timestamp in the text, which would put a line nobody wrote
 * in every diff. It is the same trade as U4's unwritten row id (D-245), one
 * level up.
 */
function shapeOf(db: Database): readonly (readonly [string, number])[] {
  return [...listFormats(db)]
    .map((format) => [format.name, countRows(db, format)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

/** Every declared row's id, sorted — the identity a conversation is handed. */
function idsOf(db: Database): readonly string[] {
  return listFormats(db)
    .flatMap((format) => listRows(db, format).map((row) => row.id))
    .sort()
}

describe('which shape a file is', () => {
  it('knows the binary by its own magic bytes', async () => {
    const opened = await openEncoded(await memorySqliteBytes())
    expect(opened.encoding).toBe('sqlite')
    opened.db.close()
  })

  it('knows a text document by the header, and only by the header', async () => {
    const { db } = await openEncoded(memoryBytes())
    const text = decode(await textOf(db))
    db.close()

    const opened = await openEncoded(new TextEncoder().encode(text))
    expect(opened.encoding).toBe('text')
    opened.db.close()
    // The same text with its first line gone is not a document. *Not SQLite* is
    // a different claim from *text*, and a file that is neither has to be
    // refused rather than guessed at.
    const beheaded = text.slice(text.indexOf('\n') + 1)
    await expect(openEncoded(new TextEncoder().encode(beheaded))).rejects.toThrow()
  })

  it('refuses a file that is neither', async () => {
    await expect(openEncoded(new Uint8Array([0, 1, 2, 3]))).rejects.toThrow()
    await expect(openEncoded(new TextEncoder().encode('# Just a markdown file\n'))).rejects.toThrow()
  })
})

describe("this project's own memory, as a text file", () => {
  it('opens from text with the same formats and the same rows', async () => {
    const { db: binary, encoding } = await openEncoded(await memorySqliteBytes())
    expect(encoding).toBe('sqlite')
    const before = shapeOf(binary)
    const text = await textOf(binary)
    binary.close()

    const { db: rebuilt, encoding: rebuiltEncoding } = await openEncoded(text)
    expect(rebuiltEncoding).toBe('text')
    expect(shapeOf(rebuilt)).toEqual(before)

    // Not just the counts. The decision rows are what a session actually reads
    // back, and their `supersedes` is the one column that only survives if the
    // links were rewired to freshly minted ids.
    const decision = listFormats(rebuilt).find((each) => each.name === 'decision')
    if (decision === undefined) throw new Error('the text declares no decision format')
    const rows = listRows(rebuilt, decision)
    expect(rows.length).toBeGreaterThan(15)
    rebuilt.close()
  })

  it('round-trips byte-identically through the file, not merely through the parts', async () => {
    const { db: first } = await openEncoded(memoryBytes())
    const once = await textOf(first)
    first.close()

    const { db: second } = await openEncoded(once)
    const twice = await textOf(second)
    second.close()

    // The property a git checkout depends on: reading a text document and
    // writing it back must produce the file it was, or every clone shows a diff
    // nobody made.
    expect(decode(twice)).toEqual(decode(once))
  })

  it('is left exactly as it was by bringing it up to date, which rebuilds only what a pack vouches for (M36 U09)', async () => {
    const { db: first } = await openEncoded(memoryBytes())
    const once = await textOf(first)
    // The ledger's rebuilds are the ledger's: a document keeping only the
    // development pack has nothing any pack vouches for.
    expect(bringUpToDate(first, Date.UTC(2026, 9, 5))).toEqual({ ok: true, value: { changed: 0 } })
    const after = await textOf(first)
    first.close()

    expect(decode(after)).toEqual(decode(once))
  })

  it('puts the schema version in the first line and nowhere else', async () => {
    const { db } = await openEncoded(memoryBytes())
    const text = decode(await textOf(db))
    db.close()

    expect(text.split('\n')[0]).toBe(`<!-- emerald document, schema ${String(SCHEMA_VERSION)} -->`)
  })

  it('is smaller as text than as bytes, which is why the choice is worth having', async () => {
    const { db } = await openEncoded(memoryBytes())
    const text = await textOf(db)
    const bytes = exportDatabase(db)
    db.close()

    // About half. It was under half until 048 dropped the ledger's old tables,
    // which every document carried empty and which made the bytes larger. It
    // crossed 0.60 on 2026-10-05 (0.6001 at bac23ba) as the memory filled with
    // long-text rows — briefs and answers, which text carries one to one.
    expect(text.length).toBeLessThan(bytes.length * 0.65)
  })
})

describe('the ids a text document has', () => {
  it('are the same ones the next open finds, because they come from the rows', async () => {
    // **The bug U6 found by being driven rather than by being tested** (D-247).
    // The plugin holds no document open between calls, so an id it answers with
    // has to survive the file closing — and while the ids were drawn at random,
    // writing a link over one refused every time with *no row with that id*,
    // which reads as the caller's mistake and was not.
    const { db } = await openEncoded(memoryBytes())
    const text = await textOf(db)
    db.close()

    const first = await openEncoded(text)
    const second = await openEncoded(text)
    expect(idsOf(first.db)).toEqual(idsOf(second.db))
    first.db.close()
    second.db.close()
  })

  it('change for the row that changed and for no other', async () => {
    const { db } = await openEncoded(memoryBytes())
    const text = decode(await textOf(db))
    db.close()

    // One word of one row's prose. Deliberately a row and not a declaration,
    // and deliberately checked to appear once, because an edit that landed
    // somewhere else would make this test pass for the wrong reason.
    const phrase = 'Should the pack switch be per machine or per document?'
    expect(text.split(phrase).length - 1).toBe(1)
    const edited = text.replace(phrase, 'Should the pack switch be per machine, or per document?')

    const before = await openEncoded(new TextEncoder().encode(text))
    const after = await openEncoded(new TextEncoder().encode(edited))
    const was = idsOf(before.db)
    const now = idsOf(after.db)
    before.db.close()
    after.db.close()

    // One row moved and the rest are where they were. An id derived from an
    // ordinal would have shifted everything below the change.
    expect(now.length).toBe(was.length)
    expect(now.filter((id) => !was.includes(id)).length).toBe(1)
  })
})

describe('a file from the future', () => {
  it('is refused rather than read down, the same as a binary one', async () => {
    const { db } = await openEncoded(memoryBytes())
    const text = decode(await textOf(db))
    db.close()

    const ahead = text.replace(/schema \d+/, `schema ${String(SCHEMA_VERSION + 3)}`)
    await expect(openEncoded(new TextEncoder().encode(ahead))).rejects.toThrow(SchemaTooNewError)
    await expect(openEncoded(new TextEncoder().encode(ahead))).rejects.toThrow(/newer version/)
  })

  it('reports the version the header says when nothing may migrate it', async () => {
    const { db } = await openEncoded(memoryBytes())
    const text = decode(await textOf(db))
    db.close()

    // The plugin's rule (D-094): it opens through here, reads the version, and
    // refuses anything that is not its own. A text document rebuilt at *this*
    // build's schema would tell it the version it wanted to hear.
    // Without what only this schema can hold — a `links` column (M27 U2,
    // D-300), which schema 52's `format_column` refuses by its CHECK — and
    // without every value of it, in a row or in a view. A row naming a column
    // its format no longer declares is refused, and the refusal surfaced as the
    // format linking to it (`review_entry` points at `unit`) rather than its own.
    const behind = text
      .replace(/schema \d+/, `schema ${String(SCHEMA_VERSION - 1)}`)
      .split('\n')
      .filter((line) => !line.includes('| links |') && !line.startsWith('blocks:'))
      .join('\n')
    const opened = await openEncodedWithoutMigrating(new TextEncoder().encode(behind))
    const recorded = query(opened.db, 'SELECT MAX(version) AS version FROM schema_version')
    expect(recorded[0]?.['version']).toBe(SCHEMA_VERSION - 1)
    opened.db.close()
  })
})

describe('a document the text cannot carry', () => {
  it('is refused by name rather than saved with the ledger missing', async () => {
    // A ledger's formats are declared and its rows are theirs, but what the
    // pack seeded is kept beside them (D-264), and the text does not carry it.
    const db = await createLedgerDatabase()

    const encoded = await exportEncoded(db, 'text')
    expect(encoded.ok).toBe(false)
    if (encoded.ok) throw new Error('a ledger was saved as text')
    expect(encoded.error).toContain('format_seed')
    expect(encoded.error).toContain('cannot be saved as text')
    db.close()
  })

  it('does not mistake the rows every document is seeded with for a ledger', async () => {
    // The units arrive from the migrations, and a text document gets every one
    // of them back by being created rather than by being read. A check that
    // counted rows would refuse every document there is.
    const { db } = await openEncoded(memoryBytes())
    expect(query(db, 'SELECT COUNT(*) AS n FROM measurement_unit')[0]?.['n']).toBeGreaterThan(10)
    await expect(exportEncoded(db, 'text')).resolves.toMatchObject({ ok: true })
    db.close()
  })

  // M27 U3 found this missing from `CARRIED` since M26 U6: the views part held
  // an entry's input, and the save refused the document for holding one.
  it('carries what a view keeps per column, an entry’s input and a board’s lanes', async () => {
    const { db } = await openEncoded(memoryBytes())
    setEntryInput(db, 'unit', 'brief', 'markdown')
    setBoardLanes(db, 'review_entry', 'state')
    const encoded = await exportEncoded(db, 'text')
    if (!encoded.ok) throw new Error(encoded.error)
    db.close()
    const { db: back } = await openEncoded(encoded.value)
    expect(entryInputs(back, 'unit').get('brief')).toBe('markdown')
    expect(boardSettings(back, 'review_entry').get('state')).toBe('lanes')
    back.close()
  })

  it('refuses a document with nothing declared, rather than write a file it cannot open', async () => {
    // The empty new document, which is the first thing anybody would try the
    // command on. Its text would be the header and no parts, and opening that
    // is refused — so the save is what has to refuse instead.
    const db = await createDatabase()

    const encoded = await exportEncoded(db, 'text')
    expect(encoded.ok).toBe(false)
    if (encoded.ok) throw new Error('an empty document was saved as text')
    expect(encoded.error).toContain('declares none')
    db.close()
  })

  it('saves as bytes whatever is in it, because that shape carries everything', async () => {
    const db = await createLedgerDatabase()

    const encoded = await exportEncoded(db, 'sqlite')
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) throw new Error(encoded.error)
    const opened = await openEncoded(encoded.value)
    expect(opened.encoding).toBe('sqlite')
    opened.db.close()
    db.close()
  })
})

describe('a unique column as text (M24 U4, D-255)', () => {
  it('survives the round trip, index and all, and a repeat in the file is refused', async () => {
    const db = await createDatabase()
    const tag = {
      language: 5,
      name: 'tag',
      title: 'Tag',
      notes: '',
      columns: [column('name', 'text', { required: true, unique: true })],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }
    expect(adoptFormat(db, tag, 0).refusals).toEqual([])
    insertRows(db, tag, [{ name: 'red' }, { name: 'blue' }])
    const text = decode(await textOf(db))
    db.close()
    expect(text).toContain('| required | unique |')

    const { db: back } = await openEncoded(new TextEncoder().encode(text))
    expect(listFormats(back)[0]?.columns[0]?.unique).toBe(true)
    expect(countRows(back, tag)).toBe(2)
    expect(
      query(back, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'fmt_tag__name__unique'"),
    ).toHaveLength(1)
    back.close()

    const repeated = text.replace('blue', 'red')
    await expect(openEncoded(new TextEncoder().encode(repeated))).rejects.toThrow()
  })
})
