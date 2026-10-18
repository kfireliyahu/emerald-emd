/**
 * **A .json file of rows, as a table** — M48 U2.
 *
 * Rows a model or a script already holds as JSON were pasted through tool calls
 * two hundred at a time, because nothing read the file. A file of rows is a
 * kind of file, so it is read like a `.csv`: one object a row, its keys the
 * header, and everything downstream — the guessed mapping, the dry run, the
 * refusals by line — the one a spreadsheet gets. **Nothing here knows which
 * program wrote the file** (readers are generic by kind of file, never by
 * product).
 *
 * ## What it reads
 *
 * - **An array of objects** — one table;
 * - **an object holding one or more** — each array of objects under a key is a
 *   table named by that key, as a workbook's sheets are named, and the read
 *   takes the first unless a sheet is named.
 *
 * Anything else is refused, saying which of the two it is not.
 *
 * ## The cells
 *
 * The header is every key, in the order the rows first use it. A string is
 * text and a blank one empty; a number and a boolean keep their kind, as a
 * spreadsheet's typed cell does; `null` is empty. **A list stays a list**: an
 * array of plain values is its members joined by `; `, and the table records
 * that the column is split by `;` — the file said so, as a note's frontmatter
 * list does. An object, or an array holding one, is its JSON text: a value of
 * the column it lands on, never silently dropped.
 */

import type { ReadCell, ReadTable } from './reading.ts'

/** What joins a list's members in one cell, and splits them again on read — a note's list uses the same. */
const LIST_SEPARATOR = ';'

/** One table of the file: its name (the key it sat under, or empty for a bare array) and the table. */
export interface JsonRowsTable {
  readonly name: string
  readonly table: ReadTable
}

export type JsonRowsResult =
  | { readonly ok: true; readonly tables: readonly JsonRowsTable[] }
  | { readonly ok: false; readonly reason: string }

/** Whether a file name is a .json file. */
export function isJsonFileName(name: string): boolean {
  return /\.json$/i.test(name)
}

const SHAPE = 'an array of objects, or an object holding one'

/** The tables a .json file's text holds, or why it holds none. */
export function jsonRowsTables(text: string): JsonRowsResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''))
  } catch (error) {
    return { ok: false, reason: `it is not JSON (${error instanceof Error ? error.message : String(error)})` }
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { ok: false, reason: 'its array is empty — there are no rows in it' }
    const stray = parsed.findIndex((each) => !isRecord(each))
    if (stray !== -1) {
      return { ok: false, reason: `item ${String(stray)} of its array is not an object, and a row is one — it holds ${SHAPE}` }
    }
    return { ok: true, tables: [{ name: '', table: tableOf(parsed as readonly Record<string, unknown>[]) }] }
  }

  if (isRecord(parsed)) {
    const tables = Object.entries(parsed)
      .filter(([, value]) => Array.isArray(value) && value.length > 0 && value.every(isRecord))
      .map(([name, value]) => ({ name, table: tableOf(value as readonly Record<string, unknown>[]) }))
    if (tables.length === 0) {
      return { ok: false, reason: `no key of its object holds an array of objects — a file of rows is ${SHAPE}` }
    }
    return { ok: true, tables }
  }

  return { ok: false, reason: `it holds a single value — a file of rows is ${SHAPE}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tableOf(objects: readonly Record<string, unknown>[]): ReadTable {
  const header: string[] = []
  const seen = new Set<string>()
  const lists = new Set<string>()
  for (const object of objects) {
    for (const [key, value] of Object.entries(object)) {
      if (!seen.has(key)) {
        seen.add(key)
        header.push(key)
      }
      if (Array.isArray(value) && value.every(isPlain)) lists.add(key)
    }
  }
  const rows: ReadCell[][] = [
    header.map((key) => ({ kind: 'text', text: key })),
    ...objects.map((object) => header.map((key) => cellOf(object[key]))),
  ]
  return {
    rows,
    columnCount: header.length,
    separators: header.some((key) => lists.has(key))
      ? header.map((key) => (lists.has(key) ? LIST_SEPARATOR : undefined))
      : undefined,
  }
}

function isPlain(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function cellOf(value: unknown): ReadCell {
  if (value === null || value === undefined) return { kind: 'empty', text: '' }
  if (typeof value === 'string') return value.trim() === '' ? { kind: 'empty', text: value } : { kind: 'text', text: value }
  if (typeof value === 'number') return { kind: 'number', text: String(value), value }
  if (typeof value === 'boolean') return { kind: 'boolean', text: String(value), value }
  if (Array.isArray(value) && value.every(isPlain)) {
    const text = value
      .filter((each) => each !== null && String(each).trim() !== '')
      .map((each) => String(each))
      .join(`${LIST_SEPARATOR} `)
    return text === '' ? { kind: 'empty', text } : { kind: 'text', text }
  }
  return { kind: 'text', text: JSON.stringify(value) }
}
