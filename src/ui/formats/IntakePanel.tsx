import { useState } from 'react'
import type { Database } from 'sql.js'

import { capitalize } from '@/core/text.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { parseFigure, type DateOrder, type ReadCell, type ReadTable, type Reading } from '@/domain/format/reading.ts'
import { companionKeyOf, offeredKeysOf } from '@/domain/format/row.ts'
import { entryLabel } from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ChoiceField, ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'

/**
 * **The mapper: a file's columns pointed at a format's keys** — M19 U5
 * ([D-226](../../../docs/09-decision-log.md)), and since M26 U5 the part of
 * making a **reader** that a person does by hand.
 *
 * This file was the whole single-file reading panel until U5 moved reading to
 * its own screen (`ReadFiles`), where any number of files are read at once,
 * each by the reader that fits it. What is left here is what that screen opens
 * when no reader fits — the grid and the values that hold for the whole file —
 * and what made it worth keeping is unchanged:
 *
 * - **the mapping is on screen beside what it produces** (D-013), so a wrong
 *   guess costs a click rather than a bad import;
 * - **a link is read off the page only by the exact unique name of its row**
 *   (D-261) — or filled once, for the whole file, below the grid.
 */
/**
 * The grid: the file as it is, with a select over every column.
 *
 * Six rows, which is the pack's answer too — enough to tell a date from a
 * reference number, and not so many that the selects leave the screen. The
 * header row is a select of its own because a real export puts two lines of
 * preamble above it as often as not.
 */
export function Mapper({
  declaration,
  table,
  reading,
  keys,
  onChange,
}: {
  declaration: FormatDeclaration
  table: ReadTable
  reading: Reading
  keys: readonly string[]
  onChange: (reading: Reading) => void
}) {
  const bound = new Map(reading.columns.map((each) => [each.index, each.key]))
  const preview = table.rows.slice(reading.headerRow + 1, reading.headerRow + 7)
  const indexes = Array.from({ length: table.columnCount }, (_, index) => index)
  // *Numbers right, text left*: a column whose shown cells are all figures.
  const figures = indexes.map((index) => {
    const cells = preview.map((row) => row[index]).filter((cell): cell is ReadCell => cell !== undefined && cell.kind !== 'empty')
    return cells.length > 0 && cells.every((cell) => cell.kind === 'number' || parseFigure(cell.text) !== undefined)
  })
  // A row by its number and its first cells, as a person reads a sheet (M54 F4).
  const headerRows = table.rows.slice(0, 20).map((row, index) => {
    const cells = row.map((cell) => cell.text.trim()).filter((text) => text !== '')
    const said = cells.join(', ')
    return {
      value: String(index),
      label: cells.length === 0 ? `Row ${String(index + 1)}, empty` : `Row ${String(index + 1)}: ${said.length > 60 ? `${said.slice(0, 59)}…` : said}`,
    }
  })
  // A column holding several of a list is split by what the person states
  // (M34 U5, D-398), never by a guess — or by what the file joined it with,
  // when the file held it as a list (a note's frontmatter, M34 U7).
  const listKeys = new Set(
    declaration.columns.filter((each) => each.type === 'enums' || each.type === 'links').map((each) => each.name),
  )
  const separatorAt = (index: number): string | undefined =>
    reading.columns.find((each) => each.index === index)?.separator

  const set = (index: number, key: string): void => {
    const columns = reading.columns.filter((each) => each.index !== index && each.key !== key)
    onChange({
      ...reading,
      columns: key === '' ? columns : [...columns, { index, key }].sort((a, b) => a.index - b.index),
    })
  }
  const split = (index: number, separator: string): void => {
    onChange({
      ...reading,
      columns: reading.columns.map((each) => {
        if (each.index !== index) return each
        return { index: each.index, key: each.key, ...(separator === '' ? {} : { separator }) }
      }),
    })
  }

  return (
    <div className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-caption">
        <label className="flex items-center gap-2">
          <span className="text-ink-secondary">Header row</span>
          <ChoiceMenu
            text={headerRows[reading.headerRow]?.label ?? ''}
            choices={headerRows}
            onPick={(choice) => onChange({ ...reading, headerRow: Number(choice.value) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-ink-secondary">Dates are</span>
          <ChoiceMenu
            text={DATE_ORDERS.find((each) => each.value === reading.dateOrder)?.label ?? ''}
            choices={DATE_ORDERS}
            onPick={(choice) => onChange({ ...reading, dateOrder: choice.value as DateOrder })}
          />
        </label>
      </div>

      <div className="overflow-auto border border-hairline">
        <table className="w-full text-caption">
          <thead>
            <tr className="border-b border-hairline bg-surface">
              {indexes.map((index) => {
                const key = bound.get(index)
                const header = table.rows[reading.headerRow]?.[index]
                return (
                  <th key={index} className={`p-1 align-top font-normal ${figures[index] === true ? 'text-end' : 'text-start'}`}>
                    {/* *The mapper shows the raw cell* (D-531): the role is a small
                        label at rest, a menu on focus or a click. A link takes a
                        cell naming its row exactly (D-261); a format it cannot
                        fill that way says so under the grid. */}
                    <ChoiceMenu
                      className={`${ROLE} ${key === undefined ? 'text-ink-secondary' : 'text-ink'}`}
                      aria-label={`What column ${String(index + 1)} is read into`}
                      text={key === undefined ? 'Ignore' : capitalize(keyWords(declaration, key))}
                      choices={[
                        { value: '', label: 'Ignore' },
                        ...keys.map((each) => ({ value: each, label: capitalize(keyWords(declaration, each)) })),
                      ]}
                      onPick={(choice) => set(index, choice.value)}
                    />
                    {listKeys.has(key ?? '') && (
                      <label className="fc-pop-enter mt-1 flex items-center gap-1 px-1 text-ink-secondary">
                        <span className="shrink-0">Split by</span>
                        <input
                          className={`${FIELD} w-12`}
                          aria-label={`What splits a cell of ${keyWords(declaration, key ?? '')}`}
                          placeholder=","
                          value={separatorAt(index) ?? ''}
                          onChange={(event) => split(index, event.target.value)}
                        />
                      </label>
                    )}
                    <span className={`mt-1 flex min-w-0 px-1 font-mono ${key === undefined ? 'text-ink-secondary' : 'text-ink'}`}>
                      <Bidi className="min-w-0 truncate">{header?.text ?? ''}</Bidi>
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, line) => (
              <tr key={line} className="border-b border-hairline last:border-0">
                {indexes.map((index) => (
                  <td
                    key={index}
                    className={`px-2 py-1 font-mono ${figures[index] === true ? 'text-end tabular-nums' : 'text-start'} ${
                      bound.has(index) ? 'text-ink' : 'text-ink-secondary'
                    }`}
                  >
                    <Bidi className="block max-w-48 truncate">{row[index]?.text ?? ''}</Bidi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The keys no column of the file fills: one value for every row.
 *
 * Three things end up here and they are all the same thing — **a fact about the
 * file rather than about a row**. A currency, when every amount in the export is
 * in one. A unit, when every figure is in grams. And a **link**, which is the
 * only way one can be filled at all (H10): a person picks the recipe once, and
 * every line of the file points at it.
 */
export function Fixed({
  db,
  declaration,
  declared,
  reading,
  onChange,
}: {
  db: Database
  declaration: FormatDeclaration
  declared: readonly FormatDeclaration[]
  reading: Reading
  onChange: (reading: Reading) => void
}) {
  const bound = new Set(reading.columns.map((each) => each.key))
  const fixed = new Map(reading.fixed.map((each) => [each.key, each.value]))

  const wanted = declaration.columns.flatMap((column) => {
    // A link a column of the file fills is not one value for the whole file.
    if (column.type === 'link') return bound.has(column.name) ? [] : [{ column, key: column.name }]
    const companion = companionKeyOf(column)
    if (companion === undefined || !bound.has(column.name) || bound.has(companion)) return []
    return [{ column, key: companion }]
  })

  if (wanted.length === 0) return null

  const set = (key: string, value: string): void => {
    const rest = reading.fixed.filter((each) => each.key !== key)
    onChange({ ...reading, fixed: value === '' ? rest : [...rest, { key, value }] })
  }

  return (
    <div className="fc-pop-enter mb-4 space-y-2">
      {wanted.map(({ column, key }) => (
        <label key={key} className="flex flex-wrap items-center gap-2 text-caption">
          <span className="text-ink-secondary">
            {column.type === 'link'
              ? `Every row belongs to which ${(declared.find((each) => each.name === column.target)?.title ?? 'row').toLowerCase()}?`
              : `Every ${entryLabel(column)} is in`}
          </span>
          {column.type === 'link' ? (
            <RowChoice
              rows={targetRows(db, declared, column.target)}
              id={fixed.get(key) ?? ''}
              onPick={(id) => set(key, id)}
            />
          ) : (
            // A placeholder never looks like an answer (M54 F4): the currency
            // the cells or the document say is a value, here to confirm.
            <input
              className={`${FIELD} w-28`}
              aria-label={capitalize(keyWords(declaration, key))}
              value={fixed.get(key) ?? ''}
              placeholder={column.type === 'money' ? 'Three letters' : 'A unit'}
              onChange={(event) => set(key, event.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  )
}

/**
 * The rows of the format a link points at, labelled by something a person can
 * recognise.
 *
 * **`labelColumn` is where that rule lives now** (M22 U1). It was written here
 * first and copied twice, and the copies were the reason a link read back as a
 * uuid everywhere a person was not choosing one from a list. The rule itself is
 * unchanged, including the half worth keeping: **a declaration has no display
 * column** and this was not the place to invent one.
 */
function targetRows(
  db: Database,
  declared: readonly FormatDeclaration[],
  target: string | undefined,
): readonly { readonly id: string; readonly label: string }[] {
  const declaration = declared.find((each) => each.name === target)
  if (declaration === undefined) return []
  const naming = labelColumn(declaration)
  return listRows(db, declaration, { limit: 200 }).map((row) => ({
    id: row.id,
    label: naming === undefined ? row.id : String(row.cells[naming.name] ?? row.id),
  }))
}

/**
 * *The role is a small label* (D-531): no field's border at rest, the menu's
 * when it is pointed at, the accent rule and ring when it has focus.
 */
const ROLE =
  'h-6 w-full min-w-max cursor-pointer border-0 border-b border-transparent bg-transparent px-1 text-label uppercase outline-none ' +
  'hover:border-hairline-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

/**
 * **A key as a person reads it** (M54 F4, *Words name the rule*): a column by
 * its label, and a money column's currency or a quantity's unit as "currency of
 * amount" — never `amount_currency`. Only the words: the key stays the key in
 * the reading and every tool.
 */
export function keyWords(declaration: FormatDeclaration, key: string): string {
  for (const column of declaration.columns) {
    if (column.name === key) return entryLabel(column)
    if (companionKeyOf(column) === key) return `${column.type === 'money' ? 'currency' : 'unit'} of ${entryLabel(column)}`
  }
  return key.replace(/_/g, ' ')
}

/** A sentence the engine wrote for a conversation, with each of the format's keys in its words. */
export function keysInWords(sentence: string, declaration: FormatDeclaration): string {
  const keys = new Set(offeredKeysOf(declaration))
  return sentence.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (word) => (keys.has(word) ? keyWords(declaration, word) : word))
}

const DATE_ORDERS = [
  { value: 'dmy', label: 'day / month / year' },
  { value: 'mdy', label: 'month / day / year' },
  { value: 'ymd', label: 'year / month / day' },
]

/**
 * The row every read row belongs to: an autocomplete, since a format can hold
 * two hundred of them (*Choices are ChoiceField*, M54 U3). What is typed only
 * narrows the list; leaving the field puts back the row that is chosen.
 */
function RowChoice({
  rows,
  id,
  onPick,
}: {
  rows: readonly { readonly id: string; readonly label: string }[]
  id: string
  onPick: (id: string) => void
}) {
  const [typed, setTyped] = useState<string | undefined>()
  const chosen = id === '' ? 'Not set' : (rows.find((row) => row.id === id)?.label ?? '')
  return (
    <ChoiceField
      className={`${FIELD} w-56`}
      filter
      text={typed ?? chosen}
      choices={[{ value: '', label: 'Not set' }, ...rows.map((row) => ({ value: row.id, label: row.label }))]}
      onText={setTyped}
      onPick={(choice) => {
        setTyped(undefined)
        onPick(choice.value)
      }}
      onBlur={() => setTyped(undefined)}
    />
  )
}
