import type { Database } from 'sql.js'

import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { DateOrder, ReadTable, Reading } from '@/domain/format/reading.ts'
import { companionKeyOf } from '@/domain/format/row.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { SELECT, FIELD } from '@/ui/components/fieldLook.ts'

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
          <select
            className={SELECT}
            value={reading.headerRow}
            onChange={(event) => onChange({ ...reading, headerRow: Number(event.target.value) })}
          >
            {table.rows.slice(0, 20).map((row, index) => (
              <option key={index} value={index}>
                {index + 1}: {row.map((cell) => cell.text).join(' · ').slice(0, 60) || '(blank)'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-ink-secondary">Dates are</span>
          <select
            className={SELECT}
            value={reading.dateOrder}
            onChange={(event) =>
              onChange({ ...reading, dateOrder: event.target.value as DateOrder })
            }
          >
            <option value="dmy">day / month / year</option>
            <option value="mdy">month / day / year</option>
            <option value="ymd">year / month / day</option>
          </select>
        </label>
      </div>

      <div className="overflow-auto rounded-md border border-hairline">
        <table className="w-full text-caption">
          <thead>
            <tr className="border-b border-hairline bg-surface">
              {indexes.map((index) => (
                <th key={index} className="p-1 text-left align-top font-normal">
                  <select
                    className={`${SELECT} w-full`}
                    value={bound.get(index) ?? ''}
                    onChange={(event) => set(index, event.target.value)}
                  >
                    <option value="">Ignore</option>
                    {keys.map((key) => (
                      // A link takes a cell naming its row exactly (D-261); a
                      // format it cannot fill that way says so under the grid.
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                  {listKeys.has(bound.get(index) ?? '') && (
                    <label className="fc-pop-enter mt-1 flex items-center gap-1 px-1 text-ink-secondary">
                      <span className="shrink-0">Split by</span>
                      <input
                        className={`${SELECT} w-12`}
                        aria-label={`What splits a cell of ${bound.get(index) ?? ''}`}
                        placeholder=","
                        value={separatorAt(index) ?? ''}
                        onChange={(event) => split(index, event.target.value)}
                      />
                    </label>
                  )}
                  <span className="flex min-w-0 mt-1 px-1 text-ink-tertiary">
                    <Bidi className="min-w-0 truncate">{table.rows[reading.headerRow]?.[index]?.text ?? ''}</Bidi>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, line) => (
              <tr key={line} className="border-b border-hairline last:border-0">
                {indexes.map((index) => (
                  <td key={index} className="px-2 py-1 text-ink-secondary">
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
              ? `Every row belongs to which ${column.target ?? 'row'}?`
              : column.type === 'money'
                ? `Every ${column.name} is in`
                : `Every ${column.name} is in`}
          </span>
          {column.type === 'link' ? (
            <select
              className={SELECT}
              value={fixed.get(key) ?? ''}
              onChange={(event) => set(key, event.target.value)}
            >
              <option value="">Not set</option>
              {targetRows(db, declared, column.target).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={`${FIELD} w-28`}
              value={fixed.get(key) ?? ''}
              placeholder={column.type === 'money' ? 'ILS' : 'g'}
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

