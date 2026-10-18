/**
 * **What a row in another document holds now** (M47 U4, D-461) — the half of
 * an `elsewhere` column that has to reach the disk, so it is the plugin's.
 *
 * Each document named is opened once, read-only, and closed; each row is found
 * by its name in that document's naming columns (`labelColumn`). Every way it
 * can fail to be found is an answer rather than a refusal: a file that is not
 * there, one this build cannot read, a name no row has, a name two rows share.
 * Nothing here writes, and nothing here follows a row elsewhere *of* that row —
 * one hop, as a link is (D-224).
 */

import { existsSync } from 'node:fs'

import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  documentNameOf,
  parseElsewhere,
  pathFrom,
  readingOf,
  readingText,
  type Elsewhere,
  type ElsewhereReading,
  type NamedRow,
} from '@/domain/format/elsewhere.ts'
import { readValue, type StoredRow } from '@/domain/format/row.ts'
import type { Database } from 'sql.js'

import { openDocument } from './document.ts'

/** The `elsewhere` values these rows hold, in the columns that hold them. */
export function elsewhereValues(declaration: FormatDeclaration, rows: readonly StoredRow[]): readonly string[] {
  const columns = declaration.columns.filter((column) => column.type === 'elsewhere')
  return rows.flatMap((row) =>
    columns.flatMap((column) => {
      const value = row.cells[column.name]
      return typeof value === 'string' ? [value] : []
    }),
  )
}

/**
 * Each value read where it points, as the clause `cellText` prints beside it —
 * `unit S1 U5 · built`, or `unresolved — no file at …`. `holder` is the path of
 * the document the values are in, which a relative path is beside.
 */
export async function elsewhereLabels(values: Iterable<string>, holder: string): Promise<Map<string, string>> {
  const readings = await readElsewhere(values, holder)
  return new Map([...readings].map(([value, reading]) => [value, readingText(reading)]))
}

/** Each value, read. */
export async function readElsewhere(values: Iterable<string>, holder: string): Promise<Map<string, ElsewhereReading>> {
  const readings = new Map<string, ElsewhereReading>()
  const byPath = new Map<string, { value: string; elsewhere: Elsewhere }[]>()
  for (const value of new Set(values)) {
    const parsed = parseElsewhere(value)
    if (!parsed.ok) {
      readings.set(value, { kind: 'unresolved', why: parsed.error })
      continue
    }
    const path = pathFrom(parsed.value.path, holder.replace(/\\/g, '/'))
    if (path === undefined) {
      readings.set(value, { kind: 'unresolved', why: `${parsed.value.path} is relative, and this document has no folder` })
      continue
    }
    byPath.set(path, [...(byPath.get(path) ?? []), { value, elsewhere: parsed.value }])
  }
  for (const [path, wanted] of byPath) {
    const unresolved = (why: string): void => {
      for (const each of wanted) readings.set(each.value, { kind: 'unresolved', why })
    }
    if (!existsSync(path)) {
      unresolved(`no file at ${path}`)
      continue
    }
    const opened = await openDocument(path)
    if (!opened.ok) {
      // The first sentence: what is wrong. The fix is the refusal's own to give,
      // when that document is asked for itself.
      unresolved(`${documentNameOf(path)} could not be read: ${opened.error.message.split(/(?<=\.)\s/)[0] ?? ''}`)
      continue
    }
    try {
      const formats = listFormats(opened.value.db)
      for (const each of wanted) {
        readings.set(each.value, readingOf(each.elsewhere, rowsNamed(opened.value.db, formats, each.elsewhere.name)))
      }
    } catch (error) {
      unresolved(`${documentNameOf(path)} could not be read (${error instanceof Error ? error.message : String(error)})`)
    } finally {
      opened.value.db.close()
    }
  }
  return readings
}

/** Every row of every format called `name` — by its naming column, as a person writes it. */
function rowsNamed(db: Database, formats: readonly FormatDeclaration[], name: string): readonly NamedRow[] {
  return formats.flatMap((format) => {
    const naming = labelColumn(format)
    if (naming === undefined) return []
    const state = format.columns.find((column) => column.type === 'enum')
    return listRows(db, format, { match: new Map([[naming.name, name]]), limit: 3 }).map((row) => {
      const said = state === undefined ? undefined : readValue(state, row)
      const called = readValue(naming, row)
      return {
        format: format.name,
        name: typeof called === 'string' ? called : name,
        state: typeof said === 'string' ? said : undefined,
      }
    })
  })
}
