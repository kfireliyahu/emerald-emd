import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from '@/domain/format/artefact.ts'
import { declarationRejection, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { declarationChangeRefusal } from '@/domain/format/owner.ts'
import { declarationFrom } from './declare.ts'

/** The ledger's paycheck as the pack declares it: what the timesheet tour adds to. */
function paycheck(): FormatDeclaration {
  const text = readFileSync(new URL('../../data/packs/ledger/formats/paycheck.format.md', import.meta.url), 'utf8')
  const parsed = parse(text)
  if (!parsed.ok) throw new Error(parsed.error)
  return { ...parsed.value, owner: { pack: 'ledger', written: 'on the Paychecks screen', columns: parsed.value.columns.map((each) => each.name) } }
}

const DAY = {
  format: 'timesheet_day',
  title: 'Timesheet day',
  columns: [
    { name: 'date', type: 'date', required: true },
    { name: 'start', type: 'time' },
    { name: 'end', type: 'time' },
    { name: 'rate', type: 'money' },
    { name: 'paycheck', type: 'link', target: 'paycheck', found_by: 'date in period' },
  ],
  computed: [
    { name: 'hours', works_out: 'end - start' },
    { name: 'earned', works_out: 'hours * rate' },
  ],
}

describe("a tour's declaring write (M33 U7)", () => {
  it('makes a format the document does not hold, found-by link and computed columns included', () => {
    const made = declarationFrom(DAY, undefined)
    if (!made.ok) throw new Error(made.error)
    expect(made.value.columns.find((each) => each.name === 'paycheck')?.foundBy).toEqual({ from: 'date', in: 'period', grain: 'MONTH' })
    expect(made.value.derived?.map((each) => each.name)).toEqual(['hours', 'earned'])
    expect(declarationRejection(made.value, [paycheck()])).toBeUndefined()
  })

  it("adds a total and a claim to a pack's format and none of its columns, which the pack's lock lets through", () => {
    const held = paycheck()
    const added = declarationFrom(
      {
        format: 'paycheck',
        aggregates: [{ name: 'worked', of: 'sum', over_format: 'timesheet_day', over_column: 'paycheck', works_out: 'earned' }],
        claims: [{ name: 'hours_paid', expression: 'gross = worked' }],
      },
      held,
    )
    if (!added.ok) throw new Error(added.error)
    expect(added.value.columns).toEqual(held.columns)
    expect(added.value.identities.map((each) => each.name)).toEqual([...held.identities.map((each) => each.name), 'hours_paid'])
    expect(declarationChangeRefusal(held, added.value)).toBeUndefined()
    // Whether the engine takes it beside the rest of the ledger is the demo's
    // own judging, played by check:tours; here, only what was added.
    expect(added.value.aggregates.at(-1)?.over).toEqual({ format: 'timesheet_day', column: 'paycheck' })
  })

  it('refuses a type the engine has not got, and a new format with no title', () => {
    expect(declarationFrom({ ...DAY, columns: [{ name: 'when', type: 'datetime' }] }, undefined).ok).toBe(false)
    expect(declarationFrom({ format: 'shift', columns: [{ name: 'date', type: 'date' }] }, undefined).ok).toBe(false)
  })
})
