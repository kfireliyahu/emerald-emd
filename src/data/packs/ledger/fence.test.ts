import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { tableNameFor } from '@/domain/format/declaration.ts'
import { ledgerFormats } from './pack.ts'

/**
 * **The fence on the ledger's SQL** — M25 U1, D-265.
 *
 * A pack may carry code, and its code writes SQL — only against the tables the
 * pack declares. This is the test that makes that a check and not a promise,
 * the SQL half of what `format/boundary.test.ts` is for imports (D-221).
 *
 * M25 moved the ledger table by table, with a list of the tables still waiting;
 * the list emptied at U8 and went in M45 U2. The ledger names no table it does
 * not declare.
 */

/** The engine's own tables. Not the pack's to name — but reading `sqlite_master` is anybody's. */
const ENGINE_TABLES = new Set([
  'format',
  'format_aggregate',
  'format_column',
  'format_column_value',
  'format_constraint',
  'format_rollup',
  'format_rule_set',
  'format_derived',
  'format_identity',
  'format_intake',
  'format_intake_column',
  'format_intake_header_cell',
  'format_intake_row',
  'format_seed',
  'measurement_unit',
  'schema_version',
  'sqlite_master',
])

/** The engine's files, which name no ledger table at all. */
const ENGINE_FILE = /^data\/(db\/database\.ts|repositories\/(format\w*|unit)Repository\.ts)$/

const SRC = fileURLToPath(new URL('../../../', import.meta.url))
const TABLE_NAMED = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+"?([a-z_][a-z0-9_]*)"?/g
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/

function sources(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** Every table each file's SQL names, by the file's path under `src/`. */
function tablesNamed(): ReadonlyMap<string, ReadonlySet<string>> {
  const named = new Map<string, Set<string>>()
  for (const path of sources(SRC)) {
    const source = readFileSync(path, 'utf8')
    if (!SQL.test(source)) continue
    const file = relative(SRC, path).replace(/\\/g, '/')
    for (const [, table] of source.matchAll(TABLE_NAMED)) {
      if (table === undefined) continue
      const tables = named.get(file) ?? new Set<string>()
      tables.add(table)
      named.set(file, tables)
    }
  }
  return named
}

function packTables(): ReadonlySet<string> {
  const formats = ledgerFormats()
  if (!formats.ok) throw new Error(formats.error)
  return new Set(formats.value.map((each) => tableNameFor(each.declaration)))
}

describe('the fence on the ledger’s SQL', () => {
  it('names only tables the pack declares, or the engine’s own', () => {
    const allowed = new Set([...packTables(), ...ENGINE_TABLES])
    const strays: string[] = []
    for (const [file, tables] of tablesNamed()) {
      if (ENGINE_FILE.test(file)) continue
      for (const table of tables) if (!allowed.has(table)) strays.push(`${file}: ${table}`)
    }
    expect(strays).toEqual([])
  })
})
