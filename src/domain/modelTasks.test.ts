import { describe, expect, it } from 'vitest'

import { COLUMN_ROLES } from './model/importing.ts'
import { DEPOSIT_COLUMN_ROLES } from './model/templates.ts'
import {
  MODEL_TASKS,
  numberLines,
  payslipTemplate,
  resolveFieldLines,
  resolveLines,
  statementColumns,
  TASKS,
  type ModelTask,
  type PayslipLines,
} from './modelTasks.ts'

/**
 * Every field any task's context carries, so one object drives all four.
 *
 * `TASKS` is typed `ModelTask<never>` on purpose — it exists to enumerate, and
 * each task's own export is what a caller uses with its context intact. Walking
 * all four therefore needs one object that satisfies every one of them, and the
 * cast below is that and nothing more.
 */
const EVERY_CONTEXT = {
  text: '',
  headers: [],
  sampleRows: [],
  roles: COLUMN_ROLES,
  depositRoles: DEPOSIT_COLUMN_ROLES,
}

function schemaOf(task: ModelTask<never>): unknown {
  return (task.schema as (context: typeof EVERY_CONTEXT) => unknown)(EVERY_CONTEXT)
}

const SLIP = [
  'תלוש שכר — יולי 2026',
  '',
  'תאריך תשלום: 01/08/2026    חודש שכר: 07/2026',
  'תיאור            בסיס        עובד',
  'מס הכנסה                  3,980.50',
  'פנסיה         24,500.00    1,470.00',
  'סה"כ ברוטו                24,500.00',
  'נטו לתשלום                16,205.00',
].join('\n')

const template: PayslipLines = {
  grossLine: 7,
  netLine: 8,
  salaryMonthLine: 3,
  deductionLines: [
    { line: 5, hasEmployerColumn: false, hasBasisColumn: false },
    { line: 6, hasEmployerColumn: false, hasBasisColumn: true },
  ],
}

describe('the tasks themselves', () => {
  it('has one entry per declared task, keyed by its own id', () => {
    for (const id of MODEL_TASKS) expect(TASKS[id].id).toBe(id)
  })

  it('never gives a model somewhere to put free text, which is what makes D-132 structural', () => {
    // A model produces a template, never a figure — and the check belongs on
    // the schema rather than the prompt, because a schema is what the decoder
    // is actually held to. The property that enforces it: **every leaf is an
    // integer, a boolean, or a string from a fixed list.** There is nowhere in
    // any of these to write `16,205.00`, and nowhere to mistype a Hebrew label.
    for (const id of MODEL_TASKS) {
      for (const leaf of leaves(schemaOf(TASKS[id]))) {
        if (leaf.type === 'string') {
          expect(leaf, `${id}: a free string is somewhere a value can hide`).toHaveProperty('enum')
        } else {
          expect(['integer', 'boolean']).toContain(leaf.type)
        }
      }
    }
  })

  it('asks the payslip for integers, because a string could be truncated', () => {
    // The measured failure: with a string field, qwen3:8b returned `סה` for a
    // label reading `סה"כ ברוטו` — the grammar closed the string at the
    // gershayim. An integer has no such edge.
    const schema = JSON.stringify(payslipTemplate.schema({ text: '' }))
    expect(schema).not.toContain('"string"')
    expect(schema).toContain('"integer"')
  })

  it('tells the model the role vocabulary rather than leaving it to be discovered', () => {
    // D-114: unaided, a model asked to use an app's vocabulary invents members
    // of it. The list comes from the *document* since M19 U1 (D-212), so this
    // hands over the seed and checks both halves are built from the same array.
    const context = { headers: [], sampleRows: [], roles: COLUMN_ROLES }
    for (const role of COLUMN_ROLES) expect(statementColumns.system(context)).toContain(role)
    expect(JSON.stringify(statementColumns.schema(context))).toContain('"providerCategory"')
  })

  it('asks with the document’s vocabulary, not this build’s', () => {
    // The whole of U1 in one assertion: a role somebody added because a real
    // statement printed a column no release could name (D-208) reaches both the
    // system prose and the grammar, and the list is still closed around it.
    const context = { headers: [], sampleRows: [], roles: [...COLUMN_ROLES, 'settlementDate'] }
    expect(statementColumns.system(context)).toContain('settlementDate')
    expect(JSON.stringify(statementColumns.schema(context))).toContain('"settlementDate"')
  })

  it('gives every task a budget it cannot sensibly overrun', () => {
    for (const id of MODEL_TASKS) {
      const { limits } = TASKS[id]
      expect(limits.maxTokens).toBeGreaterThan(0)
      expect(limits.maxTokens).toBeLessThanOrEqual(2000)
      expect(limits.contextTokens).toBeGreaterThanOrEqual(8192)
      expect(limits.deadlineMs).toBeGreaterThan(0)
    }
  })

  it('numbers a statement’s columns in the prompt, so an index means something', () => {
    const prompt = statementColumns.prompt({
      headers: ['תאריך', 'שם בית עסק', 'סכום'],
      sampleRows: [['01/07/2026', 'סופר', '‎-120.50']],
      roles: COLUMN_ROLES,
    })
    expect(prompt).toContain('0: תאריך')
    expect(prompt).toContain('2: סכום')
  })
})

describe('numberLines', () => {
  it('counts from one, because a person is being asked to read them', () => {
    expect(numberLines('a\nb')).toBe('1: a\n2: b')
  })

  it('keeps blank lines, so the numbering matches the document', () => {
    expect(numberLines('a\n\nc')).toBe('1: a\n2: \n3: c')
  })

  it('is what resolveLines counts against', () => {
    const numbered = numberLines(SLIP).split('\n')
    expect(numbered[6]).toContain('סה"כ ברוטו')
    expect(resolveLines({ ...template, deductionLines: [] }, SLIP).fields[0]).toMatchObject({
      field: 'grossLine',
      line: 7,
    })
  })
})

describe('resolveLines', () => {
  it('reads the label out of the document, gershayim and all', () => {
    // The whole point of answering with a line: the app gets the exact text
    // because it read it, not because the model copied it.
    const resolved = resolveLines(template, SLIP)
    const gross = resolved.fields.find((field) => field.field === 'grossLine')
    expect(gross?.text).toContain('סה"כ ברוטו')
    expect(resolved.unresolved).toEqual([])
  })

  it('resolves every deduction line the template named', () => {
    const resolved = resolveLines(template, SLIP)
    expect(resolved.fields.filter((field) => field.field.startsWith('deduction'))).toHaveLength(2)
  })

  it('rejects a line the slip does not have', () => {
    const resolved = resolveLines({ ...template, netLine: 99 }, SLIP)
    expect(resolved.unresolved).toContainEqual({
      field: 'netLine',
      reason: 'the slip has no line 99',
    })
    // And the rest still resolve: one bad field is not a failed template.
    expect(resolved.fields.length).toBeGreaterThan(0)
  })

  it('rejects a blank line', () => {
    const resolved = resolveLines({ ...template, netLine: 2 }, SLIP)
    expect(resolved.unresolved).toContainEqual({ field: 'netLine', reason: 'line 2 is blank' })
  })

  it('rejects a heading, which is the real error a model makes here', () => {
    // Measured: qwen3:8b took the deductions table's column headings for a
    // deduction line. The larger model did not. A payslip field always points
    // at a line carrying a figure, so this needs no Hebrew to catch.
    const resolved = resolveLines(
      { ...template, deductionLines: [{ line: 4, hasEmployerColumn: false, hasBasisColumn: false }] },
      SLIP,
    )
    expect(resolved.unresolved).toContainEqual({
      field: 'deduction[0]',
      reason: 'line 4 has no figure on it',
    })
  })

  it('omits a field the model left out rather than inventing an unresolved one', () => {
    const resolved = resolveLines(template, SLIP)
    expect(resolved.fields.map((field) => field.field)).not.toContain('payDateLine')
    expect(resolved.unresolved.map((entry) => entry.field)).not.toContain('payDateLine')
  })

  it('trims what it returns but reports the line it came from', () => {
    const resolved = resolveLines({ ...template, deductionLines: [] }, SLIP)
    for (const field of resolved.fields) {
      expect(field.text).toBe(field.text.trim())
      expect(field.line).toBeGreaterThan(0)
    }
  })
})

/** Every scalar property in a JSON Schema, however deeply nested. */
function leaves(schema: unknown): readonly { type?: string; enum?: unknown }[] {
  const node = schema as { type?: string; properties?: Record<string, unknown>; items?: unknown }
  if (node?.type === 'object' && node.properties !== undefined) {
    return Object.values(node.properties).flatMap((child) => leaves(child))
  }
  if (node?.type === 'array') return leaves(node.items)
  return node === undefined ? [] : [node]
}

describe('a boxed total, whose name and figure are on separate lines', () => {
  // What a real payslip does with the net: the figure is set large in a frame
  // and its name sits beside it, a few points off the same baseline — which is
  // two lines once the page has been flattened.
  const slip = ['סה"כ ניכויים    9,220.00', '22,180.00', 'נטו לתשלום', 'תאריך: 05/02/2026'].join('\n')

  it('takes the figure from the line beside the name', () => {
    const resolved = resolveFieldLines([{ field: 'netLine', line: 3 }], slip)

    expect(resolved.unresolved).toEqual([])
    expect(resolved.fields[0]).toEqual({
      field: 'netLine',
      line: 2,
      text: '22,180.00',
      borrowedFrom: 3,
    })
  })

  it('refuses when both neighbours are bare figures', () => {
    // Two candidates is no candidate: taking either would be a guess, and the
    // one thing a template must not do is point at a figure nobody named.
    const ambiguous = ['1,000.00', 'נטו לתשלום', '2,000.00'].join('\n')
    const resolved = resolveFieldLines([{ field: 'netLine', line: 2 }], ambiguous)

    expect(resolved.fields).toEqual([])
    expect(resolved.unresolved[0]?.reason).toBe('line 2 has no figure on it')
  })

  it('will not borrow from a line that carries a label of its own', () => {
    const laid = ['נטו לתשלום', 'סה"כ ניכויים    9,220.00'].join('\n')
    const resolved = resolveFieldLines([{ field: 'netLine', line: 1 }], laid)

    expect(resolved.fields).toEqual([])
    expect(resolved.unresolved).toHaveLength(1)
  })
})
