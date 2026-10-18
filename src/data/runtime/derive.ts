/**
 * Asking the local model where a document's fields are — F17's second rung, from
 * the page's side. A payslip and a fund report both come through here.
 *
 * M10 built everything under this: `modelTasks.ts` declares the question,
 * `electron/generate.ts` enforces the ceilings and holds the socket, and the
 * bridge carries the answer back. This is the twenty lines that were missing —
 * a caller in the app, which is why none of it was reachable from a screen.
 *
 * **The answer is validated even though a grammar was sent.** Both runtimes
 * will constrain decoding to a JSON schema and neither is obliged to: a runtime
 * that ignored the grammar, a model that produced a valid-JSON answer with a
 * string where an integer belongs, an older build of either — all of them come
 * back through this function, and every one of them has to end as "no template"
 * rather than as a template whose `grossLine` is `"14"`. `toPayslipLines` is
 * that gate, and it is a pure function so the ugly shapes can be tested without
 * a model running.
 *
 * **Nothing here is a value.** No task's schema has a money field in it and
 * these validators would drop one; what comes back is line numbers and booleans,
 * and the figures are read off the document afterwards by `payslipTemplate.ts`
 * and `fundReportTemplate.ts` (D-132).
 *
 * **Four tasks, one pipe.** `ask` is everything about the socket, the ceilings
 * and the stop reasons; a task supplies the question and a validator judges the
 * answer. M19 U2c's format proposal added exactly one function here and nothing
 * else — and that one is not a reading at all, which is the point. It asks the engine's
 * question (`domain/format/proposal.ts`) rather than the pack's, it comes back
 * as a **draft** rather than as line numbers, and the pipe could not tell the
 * difference.
 */

import type { Provider } from '../../../electron/bridge.ts'
import { toColumnProposal, type ColumnProposal } from '@/data/importer/columnProposal.ts'
import { shellBridge } from '@/data/storage/desktop.ts'
import type { FormatDraft } from '@/domain/format/draft.ts'
import { formatFromExample, toProposedDraft } from '@/domain/format/proposal.ts'
import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import {
  fundReport,
  payslipTemplate,
  statementColumns,
  type FundReportLines,
  type ModelTask,
  type PayslipLines,
  type StatementContext,
} from '@/domain/modelTasks.ts'

export type DeriveResult<Lines> =
  | {
      readonly kind: 'lines'
      readonly lines: Lines
      readonly tokens: number
      readonly elapsedMs: number
    }
  /** The runtime refused, the answer was not one, or a person pressed stop. */
  | { readonly kind: 'failed'; readonly reason: string }

/** Ask the chosen model to map one slip. */
export async function derivePayslipLines(
  provider: Provider,
  text: string,
): Promise<DeriveResult<PayslipLines>> {
  return ask(provider, payslipTemplate, { text }, toPayslipLines)
}

/**
 * And the same for a pension, hishtalmut, provident or savings report.
 *
 * One line, because the only thing that differs between the two is which task is
 * asked and which validator judges the answer — everything else here is about
 * the socket, the ceilings and the stop reasons, and none of that knows what
 * kind of document it is carrying.
 */
export async function deriveFundReportLines(
  provider: Provider,
  text: string,
  depositRoles: readonly ColumnRoleId[],
): Promise<DeriveResult<FundReportLines>> {
  return ask(provider, fundReport, { text, depositRoles }, toFundReportLines)
}

/**
 * And the columns of a statement — F17's tabular half.
 *
 * The one task with something to beat: `headerAliases.ts` once mapped a
 * reference column to `amount` (D-114). What verifies it is what already
 * verified the mapper — the live parse and the file's own printed total.
 */
export async function deriveStatementColumns(
  provider: Provider,
  context: StatementContext,
): Promise<DeriveResult<ColumnProposal>> {
  return ask(provider, statementColumns, context, (value) =>
    toColumnProposal(value, context.roles),
  )
}

/**
 * And what kind of thing an example is one of — the engine's own question
 * (M19 U2c, D-221).
 *
 * The one call here that asks for no vocabulary and reads no document: what
 * comes back is a **draft** for the editor, never a template and never a row.
 * `toProposedDraft` is deliberately the lenient one of the validators in this
 * file, because the surface it feeds draws a problem beside the field that
 * caused it — see the head of `proposal.ts`.
 */
export async function deriveFormatFromExample(
  provider: Provider,
  text: string,
): Promise<DeriveResult<FormatDraft>> {
  return ask(provider, formatFromExample, { text }, toProposedDraft)
}

/**
 * Ask one task and validate the answer.
 *
 * Every way this can end is a returned value rather than a thrown one, because
 * every one of them is a sentence a screen has to say: the model finished, the
 * model ran out of its budget mid-answer, the runtime is not there any more.
 * A capped or timed-out answer is **not** salvaged by parsing what arrived —
 * truncated JSON that happens to parse is the shape that costs a month's slip.
 */
async function ask<Context, Lines>(
  provider: Provider,
  task: ModelTask<Context>,
  context: Context,
  validate: (value: unknown) => Lines | undefined,
): Promise<DeriveResult<Lines>> {
  const runtimes = shellBridge()?.runtimes
  if (runtimes === undefined) {
    return { kind: 'failed', reason: 'This build has no way to reach a local model.' }
  }

  const result = await runtimes.generate({
    provider,
    system: task.system(context),
    prompt: task.prompt(context),
    schema: task.schema(context),
    limits: task.limits,
  })

  if (result.kind === 'failed') return { kind: 'failed', reason: result.reason }
  if (result.stop !== 'complete') return { kind: 'failed', reason: stopReason(result.stop) }

  const lines = validate(result.value)
  if (lines === undefined) {
    return { kind: 'failed', reason: 'The model’s answer was not a template this build can read.' }
  }

  return { kind: 'lines', lines, tokens: result.tokens, elapsedMs: result.elapsedMs }
}

/** Stop the generation in flight. Its promise resolves as cancelled. */
export function cancelDerivation(): void {
  shellBridge()?.runtimes?.cancel()
}

/** Tokens so far, while one runs. Returns an unsubscribe, or a no-op. */
export function onDerivationProgress(listener: (tokens: number) => void): () => void {
  return shellBridge()?.runtimes?.onProgress(listener) ?? (() => {})
}

function stopReason(stop: 'capped' | 'timedOut' | 'cancelled'): string {
  switch (stop) {
    case 'capped':
      return 'The model used its whole token budget without finishing the answer.'
    case 'timedOut':
      return 'The model did not finish in time.'
    case 'cancelled':
      return 'Stopped.'
  }
}

/**
 * The answer, if it is one.
 *
 * Every leaf is checked for being an integer or a boolean, which is the same
 * property `modelTasks.ts` states about its schemas: there is nowhere in a
 * template for a figure to be written, and that is a test rather than a hope.
 * A line number below 1 is not a line, and a deduction entry missing its line
 * is dropped rather than defaulted — a defaulted line points somewhere, and
 * somewhere is where a wrong figure comes from.
 */
export function toPayslipLines(value: unknown): PayslipLines | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>

  const grossLine = lineNumber(record['grossLine'])
  const netLine = lineNumber(record['netLine'])
  if (grossLine === undefined || netLine === undefined) return undefined

  const rows = record['deductionLines']
  const deductionLines: PayslipLines['deductionLines'] = Array.isArray(rows)
    ? rows.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return []
        const row = entry as Record<string, unknown>
        const line = lineNumber(row['line'])
        if (line === undefined) return []
        return [
          {
            line,
            hasEmployerColumn: row['hasEmployerColumn'] === true,
            hasBasisColumn: row['hasBasisColumn'] === true,
          },
        ]
      })
    : []

  return {
    grossLine,
    netLine,
    ...optional('employeeDeductionsTotalLine', record),
    ...optional('salaryMonthLine', record),
    ...optional('payDateLine', record),
    deductionLines,
  }
}

function optional(field: string, record: Record<string, unknown>): Record<string, number> {
  const line = lineNumber(record[field])
  return line === undefined ? {} : { [field]: line }
}

function lineNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

/**
 * A fund report's answer, if it is one.
 *
 * The same gate `toPayslipLines` is, and it holds the same property: every leaf
 * is an integer or it is dropped, so there is nowhere in a template for a figure
 * to be written even if a runtime ignored the grammar entirely (D-132).
 *
 * **A report with no closing-balance line is not a report this can use.** The
 * balance is the one figure the document exists to state, and a template that
 * missed it is pointing at the wrong page — better to fall to the next rung than
 * to store a map of a report's footer.
 */
export function toFundReportLines(value: unknown): FundReportLines | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>

  const closingBalanceLine = lineNumber(record['closingBalanceLine'])
  if (closingBalanceLine === undefined) return undefined

  return {
    closingBalanceLine,
    ...optional('openingBalanceLine', record),
    ...optional('depositsLine', record),
    ...optional('feesLine', record),
    ...optional('yieldLine', record),
    ...optional('asOfDateLine', record),
    ...optional('periodStartLine', record),
    ...optional('employeeComponentLine', record),
    ...optional('employerComponentLine', record),
    ...optional('severanceComponentLine', record),
    ...optional('feeRateOnDepositLine', record),
    ...optional('feeRateOnAccumulationLine', record),
    ...optional('investmentTrackLine', record),
    ...optional('employerNameLine', record),
    ...optional('expectedPensionLine', record),
    chargeLines: lineList(record['chargeLines']),
    adjustmentLines: lineList(record['adjustmentLines']),
  }
}

/** A list of line numbers, with everything that is not one dropped. */
function lineList(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return []
  const lines: number[] = []
  for (const entry of value) {
    const line = lineNumber(entry)
    if (line !== undefined) lines.push(line)
  }
  return lines
}
