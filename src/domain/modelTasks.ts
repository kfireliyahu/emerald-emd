/**
 * The questions a local model is allowed to be asked, declared in one place.
 *
 * Plain TypeScript: no React, no sql.js, no DOM. `electron/generate.ts` is a
 * pipe that enforces ceilings and knows nothing about payslips; everything a
 * model is *told* is here, where it can be read, tested and changed without
 * touching the process that opens the socket.
 *
 * **Why a task is a thing at all.** D-114 measured a model against the finished
 * plugin surface and found three failures that were the *host's* to fix rather
 * than the model's: the tool list was too large to fit alongside the weights,
 * the context it needed was left to be discovered, and the write gate was
 * prose. A task is what a host can do that a conversation cannot — it names one
 * job, hands over exactly the vocabulary that job needs, states the answer's
 * shape as a grammar, and sets a budget sized to it. Nothing here is a prompt
 * anyone assembles at a call site.
 *
 * **What a model may produce, and it is never a value** (D-132, F17). A task
 * returns a **mapping template**: which fields exist and where they live. The
 * numbers are read out of the document by plain code afterwards, and the user
 * confirms the template once. So no schema in this file has a money field in
 * it, and that is the property to check before adding one.
 *
 * > A model decides the schema; code moves the data. Which column holds the
 * > amount is judgement and worth a model. Reading nine hundred rows out of
 * > that column is `parseFloat`.
 *
 * **Two things stay out of reach entirely** (D-132). **Deduction types**: a
 * template may say a deduction line lives at a label and which side of the slip
 * it falls on; naming it pension and linking what it pays into is the user's.
 * This is why D-112's invented deduction-type ids stop being something to
 * compensate for — the local model is not on that path. **The splitter**: no AI
 * in it at all.
 */

import type { ModelTask } from './modelTask.ts'
import type { ColumnRoleId } from './model/columnRoles.ts'
import type { DepositColumn } from './model/templates.ts'

/** Every reading this pack asks for, so a caller names one rather than writing a prompt. */
export const MODEL_TASKS = [
  'payslip-template',
  'fund-report',
  'statement-columns',
] as const

export type ModelTaskId = (typeof MODEL_TASKS)[number]

/**
 * The shape a task takes lives in `modelTask.ts`, where the engine can reach
 * it too: `src/domain/format/` imports nothing from this pack, and M19 U2c gave
 * the engine a question of its own (`format/proposal.ts`). **The four below are
 * the ledger's readings** — `MODEL_TASKS` and `TASKS` enumerate those and not
 * every task that exists.
 */
export type { ModelTask }

/* -------------------------------------------------------------- a payslip */

export interface PayslipContext {
  /** The slip's text, as extracted. Hebrew, right to left, with its layout. */
  readonly text: string
}

/**
 * Where each field lives on a payslip — F17's label-value shape, answered as
 * **line numbers**.
 *
 * **It asks for lines rather than labels, and that is a measurement rather than
 * a preference.** The first version of this task asked the model to copy each
 * label exactly, and qwen3:8b returned `סה` for a label that reads `סה"כ ברוטו`
 * — truncated at the gershayim. The cause is the grammar: inside a JSON string
 * a `"` has to be escaped, and a constrained decoder that has produced one
 * takes the cheap continuation and closes the string. The same run *without* a
 * grammar copied both labels perfectly and answered in markdown prose carrying
 * every figure on the slip — which is the thing D-132 exists to forbid. So the
 * grammar is necessary and it is not sufficient, and asking for text at all was
 * the mistake.
 *
 * Hebrew financial vocabulary is full of the gershayim — `סה"כ`, `ש"ח`, `ח.פ.`
 * — so this is not an exotic case in this market; it is most of the totals on
 * every slip.
 *
 * **Asking for a line number fixes it by removing the possibility.** An integer
 * cannot be truncated, cannot be transliterated, and cannot be tidied. The
 * label text is then read out of that line by code — which is exactly D-132's
 * rule one level down: the model produces the *location*, code produces the
 * *text*. `resolveLines` is the other half.
 *
 * The deduction lines say *there is a deduction on this line, and it has these
 * columns*. They do not say what kind of deduction it is. The user does.
 */
export const payslipTemplate: ModelTask<PayslipContext> = {
  id: 'payslip-template',
  label: 'Reading a payslip’s layout',

  system: () => [
    'You map the layout of an Israeli payslip. You are given one slip, with every line',
    'numbered.',
    '',
    'You answer with LINE NUMBERS and nothing else. You never copy text out of the slip,',
    'and you never report any of the figures on it. If a field is not on the slip, omit it',
    'rather than guessing a line for it.',
    '',
    'Give the line the FIGURE is printed on. A slip often prints a total in a box, with its',
    'name on one line and the number on the line above or below; the line you want is the one',
    'with the number.',
  ].join('\n'),

  schema: () => ({
    type: 'object',
    properties: {
      grossLine: { type: 'integer' },
      netLine: { type: 'integer' },
      employeeDeductionsTotalLine: { type: 'integer' },
      salaryMonthLine: { type: 'integer' },
      payDateLine: { type: 'integer' },
      deductionLines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            line: { type: 'integer' },
            hasEmployerColumn: { type: 'boolean' },
            hasBasisColumn: { type: 'boolean' },
          },
          required: ['line', 'hasEmployerColumn', 'hasBasisColumn'],
        },
      },
    },
    required: ['grossLine', 'netLine', 'deductionLines'],
  }),

  prompt: ({ text }) =>
    [
      'The payslip, one line per line:',
      '',
      numberLines(text),
      '',
      'Give the line number of each of these:',
      '- grossLine: the total pay before deductions',
      '- netLine: what is actually paid out',
      '- employeeDeductionsTotalLine: the sum of what was deducted from the employee',
      '- salaryMonthLine: the month the pay is for',
      '- payDateLine: the date it was paid',
      '',
      'And one entry in deductionLines for every individual line in the deductions section —',
      'not the total — with its line number, whether that line also carries an employer',
      'amount, and whether it carries a basis amount.',
      '',
      'Do not say what kind of deduction any line is. Only where it is.',
    ].join('\n'),

  // A slip is one page and the answer is a couple of dozen integers. The budget
  // is small on purpose: a task that cannot overrun is one fewer thing the
  // ceilings in `generate.ts` have to catch.
  limits: { maxTokens: 1500, contextTokens: 8192, deadlineMs: 240_000 },
}

/** One-based, because the model is asked to read them and people count from one. */
export function numberLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')
}

/**
 * What a payslip template says, before anything has checked it against the
 * document.
 */
export interface PayslipLines {
  readonly grossLine: number
  readonly netLine: number
  readonly employeeDeductionsTotalLine?: number
  readonly salaryMonthLine?: number
  readonly payDateLine?: number
  readonly deductionLines: readonly {
    readonly line: number
    readonly hasEmployerColumn: boolean
    readonly hasBasisColumn: boolean
  }[]
}

/** A field, resolved to the text the document actually has on that line. */
export interface ResolvedField {
  readonly field: string
  readonly line: number
  readonly text: string
  /**
   * Set when the template named a line with no figure on it and the figure was
   * one line away — a boxed total, whose name and number are on separate lines.
   *
   * Carried rather than hidden: the surface says so, because a figure read from
   * a line nobody named is exactly the kind of help that has to be visible to
   * be trusted.
   */
  readonly borrowedFrom?: number
}

export interface ResolvedTemplate {
  readonly fields: readonly ResolvedField[]
  /**
   * Fields the model named a line for that the document does not have, or that
   * held nothing. Never silently dropped: a template with a field missing is a
   * different thing to confirm than one with a field pointing somewhere blank,
   * and F17 says a template is trusted only while it verifies.
   */
  readonly unresolved: readonly { readonly field: string; readonly reason: string }[]
}

const SINGLE_FIELDS = [
  'grossLine',
  'netLine',
  'employeeDeductionsTotalLine',
  'salaryMonthLine',
  'payDateLine',
] as const

/** A field and the line a template says it is on. */
export interface FieldLine {
  readonly field: string
  readonly line: number
}

/**
 * A line holding one figure and nothing else.
 *
 * This is what a boxed total looks like after a page has been turned into
 * lines: the figure is set large in its own frame and its name sits beside it,
 * a few points off the same baseline, so the two land on separate lines. Real
 * payslips do it for the net.
 */
function isBareFigure(line: string | undefined): boolean {
  if (line === undefined) return false
  const trimmed = line.trim()
  return trimmed !== '' && /[0-9]/.test(trimmed) && !/\s/.test(trimmed) && !/\p{L}/u.test(trimmed)
}

/**
 * Turn line numbers into the document's own text, and say what did not resolve.
 *
 * This is the half of the template a model does not produce. A line the model
 * named is only accepted if the document has it and it is not blank; nothing is
 * repaired, guessed, or nudged to a neighbour. A wrong line that resolves to
 * real text is still caught downstream — a payslip carries its own arithmetic
 * proof (F17), and that is what a template is trusted on.
 *
 * Takes field-and-line pairs rather than a payslip, because the second caller
 * arrives with line numbers it worked out for itself: a **stored** template
 * anchors to labels, finds the lines those labels are on in the document in
 * front of it, and then needs exactly these guards applied to them (D-139).
 */
export function resolveFieldLines(
  entries: readonly FieldLine[],
  text: string,
): ResolvedTemplate {
  const lines = text.split(/\r?\n/)
  const fields: ResolvedField[] = []
  const unresolved: { field: string; reason: string }[] = []

  for (const { field, line } of entries) {
    const found = lines[line - 1]
    if (found === undefined) {
      unresolved.push({ field, reason: `the slip has no line ${line}` })
      continue
    }
    if (found.trim() === '') {
      unresolved.push({ field, reason: `line ${line} is blank` })
      continue
    }
    // Every field on a payslip points at a line carrying a figure or a date.
    // A line with no digit on it is a heading, and the cheapest real error a
    // model makes here is taking the deductions table's column headings for a
    // deduction — qwen3:8b did exactly that on the first measured run, where
    // the larger model did not. This catches it without knowing anything about
    // Hebrew.
    if (!/[0-9]/.test(found)) {
      // **Unless the figure is simply on the next line.** A boxed total puts
      // the name and the number a few points apart vertically, which is two
      // lines once a page has been flattened — measured on a real slip, where
      // `נטו לתשלום` and `22,180.00` sit 4.3 points apart and the rows around
      // them are 4.5 apart, so no line-grouping tolerance separates the one
      // without merging the others.
      //
      // Narrow on purpose: only a neighbour that is **one figure and nothing
      // else**, and only when exactly one of the two neighbours is. A line with
      // a label on it belongs to something; a bare figure in a frame does not.
      const above = lines[line - 2]
      const below = lines[line]
      const candidates = [
        { at: line - 1, text: above },
        { at: line + 1, text: below },
      ].filter((entry) => isBareFigure(entry.text))

      const only = candidates.length === 1 ? candidates[0] : undefined
      if (only?.text === undefined) {
        unresolved.push({ field, reason: `line ${line} has no figure on it` })
        continue
      }

      fields.push({ field, line: only.at, text: only.text.trim(), borrowedFrom: line })
      continue
    }
    fields.push({ field, line, text: found.trim() })
  }

  return { fields, unresolved }
}

/**
 * A model's answer as field-and-line pairs, in the order a slip prints them.
 *
 * The one place field names are spelled — `deduction[0]` and its siblings are a
 * naming convention two files downstream depend on, and a second copy of it is
 * a second copy to keep in step.
 */
export function payslipFieldLines(template: PayslipLines): readonly FieldLine[] {
  const entries: FieldLine[] = []
  for (const field of SINGLE_FIELDS) {
    const line = template[field]
    if (line !== undefined) entries.push({ field, line })
  }
  template.deductionLines.forEach((entry, index) => {
    entries.push({ field: `deduction[${index}]`, line: entry.line })
  })
  return entries
}

/** The same, for a template that is still line numbers — a model's answer. */
export function resolveLines(template: PayslipLines, text: string): ResolvedTemplate {
  return resolveFieldLines(payslipFieldLines(template), text)
}

/* ----------------------------------------------------------- a fund report */

export interface FundReportContext {
  /** The report's text, as extracted. Hebrew, right to left, with its layout. */
  readonly text: string
  /**
   * This document's deposit-table vocabulary, in offer order (D-212).
   *
   * Read from the document rather than taken from a `const`, so a role somebody
   * added when a real file printed an unnameable column is a role the model may
   * answer with (D-208). Still a closed list at the moment it is asked, which is
   * all D-114 requires.
   */
  readonly depositRoles: readonly ColumnRoleId[]
}

/**
 * Where each figure lives on a pension, hishtalmut, provident or savings report
 * — the **same task as a payslip's**, asked about a different document, and
 * answered the same way: line numbers, never text and never a figure (D-137,
 * D-132).
 *
 * **What is different is the proof, and it is weaker.** A payslip carries its
 * own arithmetic — gross minus deductions is net, on every slip ever printed. A
 * fund report prints *opening + deposits + yield − fees = closing* only
 * sometimes, and prints the three components of the balance only sometimes, so
 * a reading here can be checked, wrong, or **uncheckable**, which is a third
 * state rather than a failure (`fundReportTemplate.ts`). That is why every field
 * below except the closing balance is optional: a report that states four of
 * them is not a broken report.
 *
 * **The yield is an amount, not a percentage.** Israeli reports print תשואה as a
 * percentage beside a shekel figure for רווח, and the two are one line apart. A
 * percentage read as money is the error this task exists to make unlikely — the
 * prompt says so, and the reader treats a bare percentage as no figure at all.
 */
export const fundReport: ModelTask<FundReportContext> = {
  id: 'fund-report',
  label: 'Reading a fund report’s layout',

  system: () => [
    'You map the layout of an Israeli pension, study fund (קרן השתלמות), provident fund',
    'or savings report. You are given one report, with every line numbered.',
    '',
    'You answer with LINE NUMBERS and nothing else. You never copy text out of the report,',
    'and you never report any of the figures on it. If a figure is not on the report, omit',
    'its field rather than guessing a line for it.',
    '',
    'Give the line the FIGURE is printed on. A report often prints a total in a box, with its',
    'name on one line and the number on the line above or below; the line you want is the one',
    'with the number.',
    '',
    'Amounts only, except where a field asks for a percentage. Where a report prints a percentage',
    'beside an amount — a yield, a fee rate — the line you want is the one carrying the amount in',
    'shekels.',
    '',
    'A report states figures for THIS account and, for information, figures about the market.',
    'Every answer you give is about this account.',
  ].join('\n'),

  schema: ({ depositRoles }) => ({
    type: 'object',
    properties: {
      closingBalanceLine: { type: 'integer' },
      openingBalanceLine: { type: 'integer' },
      depositsLine: { type: 'integer' },
      feesLine: { type: 'integer' },
      yieldLine: { type: 'integer' },
      asOfDateLine: { type: 'integer' },
      employeeComponentLine: { type: 'integer' },
      employerComponentLine: { type: 'integer' },
      severanceComponentLine: { type: 'integer' },
      periodStartLine: { type: 'integer' },
      chargeLines: { type: 'array', items: { type: 'integer' } },
      adjustmentLines: { type: 'array', items: { type: 'integer' } },
      feeRateOnDepositLine: { type: 'integer' },
      feeRateOnAccumulationLine: { type: 'integer' },
      investmentTrackLine: { type: 'integer' },
      employerNameLine: { type: 'integer' },
      expectedPensionLine: { type: 'integer' },
      depositTableHeaderLine: { type: 'integer' },
      depositColumns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            role: { type: 'string', enum: [...depositRoles] },
          },
          required: ['index', 'role'],
        },
      },
    },
    required: ['closingBalanceLine'],
  }),

  prompt: ({ text }) =>
    [
      'The report, one line per line:',
      '',
      numberLines(text),
      '',
      'Give the line number of each of these that the report prints:',
      '- closingBalanceLine: the total accumulated balance at the END of the period',
      '- openingBalanceLine: the balance at the START of the period',
      '- depositsLine: the total paid in over the period',
      '- feesLine: the MANAGEMENT fee charged over the period, in shekels (דמי ניהול שנגבו)',
      '- yieldLine: what the money earned over the period, in shekels — not the percentage',
      '- asOfDateLine: the date the report is dated, or the end of the period it covers',
      '- periodStartLine: the date the period this report covers begins',
      '',
      'THE MOVEMENTS BLOCK IS EXHAUSTIVE. Between the opening balance and the closing balance,',
      'every line carrying a figure is one of five things: the deposits, the gains, the management',
      'fee, a cost, or an adjustment. Account for all of them:',
      '- chargeLines: every line that takes money out and is NOT the management fee — insurance',
      '  costs (עלות ביטוח לסיכוני נכות, עלות ביטוח למקרה מוות), risk costs, any other charge.',
      '- adjustmentLines: every line that moves the balance and is none of the above — an actuarial',
      '  balance adjustment (מנגנון איזון אקטוארי), a correction.',
      'Leaving one out makes the arithmetic wrong, so list them even when unsure.',
      '',
      'The three components of the balance, if the report breaks the BALANCE down:',
      '- employeeComponentLine, employerComponentLine, severanceComponentLine.',
      'If it breaks down what was PAID IN rather than what the balance is made of, omit all three.',
      '',
      'Then five things about the account rather than about the period:',
      '- feeRateOnDepositLine: the percentage fee charged on deposits (דמי ניהול מהפקדה).',
      '- feeRateOnAccumulationLine: the percentage fee on the balance (דמי ניהול מהצבירה/מחיסכון).',
      '  A report often prints a MARKET AVERAGE beside the account’s own rates, under a heading',
      '  like לידיעתך ממוצע. Those two lines are about other people. Take the lines under the',
      '  account’s own heading (דמי ניהול בקרן) and never the average.',
      '- investmentTrackLine: the line naming the investment track.',
      '- employerNameLine: the line naming the employer (שם המעסיק).',
      '- expectedPensionLine: the expected monthly pension at retirement, if one is stated.',
      '',
      '',
      'Finally, the DEPOSIT TABLE, if the report prints one — a table with one row per deposit',
      'received (פירוט ההפקדות), each row naming a month and an amount. This one is not a line',
      'with a figure on it; it is a table, and you describe it twice over:',
      '- depositTableHeaderLine: the line carrying the table’s COLUMN HEADINGS — not its title,',
      '  and not its first row of data. Omit it if the report prints no such table.',
      '- depositColumns: what each column of that table holds, in the order the heading line reads',
      '  them, one entry per column with its index counting from zero. The roles: employerName,',
      '  depositDate (when the money arrived), salaryMonth (the month the deposit is FOR), salary,',
      '  employee (תגמולי עובד), employer (תגמולי מעסיק), severance (פיצויים), total, and ignore',
      '  for a column none of those fits — a running total, a policy number, a rate.',
      'Give the columns only if you also give the header line, and never list the rows: this',
      'application reads those off the page itself.',
      '',
      'Omit any field the report does not print. Do not say what kind of fund this is.',
    ].join('\n'),

  // Smaller than a payslip's: a handful of integers, and a report is usually a
  // page or two of mostly prose the model has to skip rather than map. The
  // deposit table adds one line and a short list, never its rows — those are
  // read off the page by code (D-153).
  limits: { maxTokens: 900, contextTokens: 8192, deadlineMs: 240_000 },
}

/**
 * What a fund-report template says, before anything has checked it against the
 * document.
 */
export interface FundReportLines {
  readonly closingBalanceLine: number
  readonly openingBalanceLine?: number
  readonly depositsLine?: number
  readonly feesLine?: number
  readonly yieldLine?: number
  readonly asOfDateLine?: number
  readonly periodStartLine?: number
  readonly employeeComponentLine?: number
  readonly employerComponentLine?: number
  readonly severanceComponentLine?: number
  readonly feeRateOnDepositLine?: number
  readonly feeRateOnAccumulationLine?: number
  readonly investmentTrackLine?: number
  readonly employerNameLine?: number
  readonly expectedPensionLine?: number
  readonly chargeLines?: readonly number[]
  readonly adjustmentLines?: readonly number[]
  /**
   * The line carrying the deposit table's **column headings** (D-153).
   *
   * Deliberately not a member of `FUND_REPORT_FIELDS`: every field in that list
   * points at a figure, and `resolveFieldLines` rejects a line with no digit on
   * it precisely because a model's cheapest error is taking a table's headings
   * for a row of it. A heading is exactly what this one is, so it is anchored
   * and resolved by its label alone (`resolveAnchorLine`).
   */
  readonly depositTableHeaderLine?: number
  /** What each column of that table holds, in the order the heading reads them. */
  readonly depositColumns?: readonly DepositColumn[]
}

/** The one place a fund report's field names are spelled. */
export const FUND_REPORT_FIELDS = [
  'closingBalanceLine',
  'openingBalanceLine',
  'depositsLine',
  'feesLine',
  'yieldLine',
  'asOfDateLine',
  'periodStartLine',
  'employeeComponentLine',
  'employerComponentLine',
  'severanceComponentLine',
  'feeRateOnDepositLine',
  'feeRateOnAccumulationLine',
  'investmentTrackLine',
  'employerNameLine',
  'expectedPensionLine',
] as const

/** A model's answer as field-and-line pairs, in the order a report prints them. */
export function fundReportFieldLines(template: FundReportLines): readonly FieldLine[] {
  const entries: FieldLine[] = []
  for (const field of FUND_REPORT_FIELDS) {
    const line = template[field]
    if (line !== undefined) entries.push({ field, line })
  }
  // The repeating ones, named as a payslip's deduction rows are — an index in
  // the field name, so an anchor stays one row's anchor across a re-derivation.
  template.chargeLines?.forEach((line, index) => entries.push({ field: `charge[${index}]`, line }))
  template.adjustmentLines?.forEach((line, index) =>
    entries.push({ field: `adjustment[${index}]`, line }),
  )
  return entries
}

/** The same, for a template that is still line numbers — a model's answer. */
export function resolveFundReportLines(
  template: FundReportLines,
  text: string,
): ResolvedTemplate {
  return resolveFieldLines(fundReportFieldLines(template), text)
}

/* ------------------------------------------------------------ a statement */

export interface StatementContext {
  /** The header row as read, in file order. */
  readonly headers: readonly string[]
  /** A few data rows, so a model can tell a date column from a reference one. */
  readonly sampleRows: readonly (readonly string[])[]
  /**
   * This document's statement-column vocabulary, in offer order (D-212).
   *
   * Read from the document rather than taken from a `const`, so a role somebody
   * added when a real file printed an unnameable column is a role the model may
   * answer with (D-208). Still a closed list at the moment it is asked, which is
   * all D-114 requires.
   */
  readonly roles: readonly ColumnRoleId[]
}

/**
 * Which column holds what — F17's tabular shape, and the one place a model has
 * something to beat: `headerAliases.ts` once mapped a reference column to
 * `amount` (D-114).
 *
 * **The role vocabulary is preloaded, not discovered.** This is the fix D-114
 * named: unaided, a model asked to use an app's vocabulary invents members of
 * it. The list comes from the **document** since M19 U1 (D-212) — seeded with
 * `COLUMN_ROLES` and carrying anything a person added — and the system prose
 * and the grammar's `enum` are built from the same array, because a hand-kept
 * second copy is a copy that drifts.
 */
export const statementColumns: ModelTask<StatementContext> = {
  id: 'statement-columns',
  label: 'Reading a statement’s columns',

  system: ({ roles }) => [
    'You map the columns of an Israeli bank or credit-card statement to the roles this',
    'application understands. You are given the header row and a few sample rows.',
    '',
    'You answer with column INDEXES, counting from zero, in the order the columns were given.',
    'You never answer with the values in the cells.',
    '',
    'Only these roles exist. Do not invent one, and do not use a role twice:',
    roles.map((role) => `  ${role}`).join('\n'),
    '',
    'Leave a role out if no column holds it. Most files use only a handful.',
  ].join('\n'),

  schema: ({ roles }) => ({
    type: 'object',
    properties: {
      columns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            role: { type: 'string', enum: [...roles] },
          },
          required: ['index', 'role'],
        },
      },
      amountConvention: {
        type: 'string',
        enum: ['SIGNED_SINGLE', 'POSITIVE_IS_CHARGE', 'SEPARATE_DEBIT_CREDIT'],
      },
    },
    required: ['columns', 'amountConvention'],
  }),

  prompt: ({ headers, sampleRows }) =>
    [
      'Columns, with their index:',
      ...headers.map((header, index) => `  ${index}: ${header}`),
      '',
      'Sample rows:',
      ...sampleRows.map((row) => `  ${row.join(' | ')}`),
      '',
      'Return one entry per column that has a role, and say which amount convention the file',
      'uses: SIGNED_SINGLE when one column carries a sign, POSITIVE_IS_CHARGE when one column',
      'is always positive and means money out, SEPARATE_DEBIT_CREDIT when money out and money',
      'in are two columns.',
    ].join('\n'),

  limits: { maxTokens: 800, contextTokens: 8192, deadlineMs: 180_000 },
}

/**
 * Every task by id, so a surface names one and a test can walk all of them.
 *
 * Typed loosely on purpose: the map exists to enumerate, and each task's own
 * export is what a caller uses, with its context type intact.
 */
export const TASKS: Readonly<Record<ModelTaskId, ModelTask<never>>> = {
  'payslip-template': payslipTemplate as ModelTask<never>,
  'fund-report': fundReport as ModelTask<never>,
  'statement-columns': statementColumns as ModelTask<never>,
}
