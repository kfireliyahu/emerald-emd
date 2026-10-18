/**
 * `set_no_pay_months` and `count_card_charges` — the conversation half of the
 * two answers Home's waiting list added (M31 U1, D-367).
 *
 * Both close a question that could otherwise only be closed by a document that
 * may never exist: "No payslip for September", for a month with no pay, and a
 * card charge in the bank for a card with no statement, counted as the spending
 * it stands for. Neither moves a figure; each stores the answer, and Home's
 * buttons write through the same two functions.
 */

import { toYearMonthString, type YearMonth } from '@/core/time.ts'
import { unmatchedSettlements } from '@/data/importer/settlementScan.ts'
import { countCardCharges } from '@/data/repositories/cardSettlementRepository.ts'
import { readNoPayMonths, setNoPayMonths } from '@/data/repositories/paycheckRepository.ts'
import type { UnmatchedSettlement } from '@/domain/model/banking.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { date, money, paragraphs, plural, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { PATH_PROP, ToolInputError, booleanProp, optionalBoolean, requireString, type Args, type PluginTool } from './tool.ts'

const MONTH = /^(\d{4})-(\d{2})$/

function readMonths(args: Args): readonly YearMonth[] {
  const raw = args['months']
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolInputError('`months` must be a non-empty array of YYYY-MM.')
  return raw.map((entry, index) => {
    const match = typeof entry === 'string' ? MONTH.exec(entry.trim()) : null
    const month = match === null ? NaN : Number(match[2])
    if (match === null || month < 1 || month > 12) throw new ToolInputError(`\`months[${index}]\` is not a YYYY-MM month.`)
    return { year: Number(match[1]), month }
  })
}

export const setNoPayMonthsTool: PluginTool = {
  definition: {
    name: 'set_no_pay_months',
    title: 'Say a month had no pay',
    description:
      'Says months had no pay — between jobs, unpaid leave — so no paycheck is missing for them: Home stops ' +
      'asking "No paycheck for …" and `paychecks` stops listing them as gaps. `no_pay: false` takes it back. ' +
      'Stores the answer only; no paycheck and no figure. **Dry-runs by default**; the document is copied to a ' +
      'timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        months: { type: 'array', items: { type: 'string' }, description: 'Salary months, as YYYY-MM.' },
        no_pay: booleanProp('Default true. False takes the answer back.'),
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'months'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const months = readMonths(args)
    const noPay = optionalBoolean(args, 'no_pay') ?? true
    const describe = (said: ReadonlySet<string>): string =>
      table(
        ['Month', 'Now', 'Will be'],
        months.map((one) => {
          const key = toYearMonthString(one)
          return [key, said.has(key) ? 'no pay' : '—', noPay ? 'no pay' : '—']
        }),
      )
    const mutation: Mutation<ReadonlySet<string>> = {
      plan: (document) => readNoPayMonths(document.db),
      describe,
      apply: (document, said) => {
        setNoPayMonths(document.db, months, noPay, Date.now())
        return paragraphs(describe(said), `${plural(months.length, 'month')} ${noPay ? 'said to have no pay' : 'taken back'}.`)
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

/** `0932`, or `unknown` for a charge whose card number the bank left out. */
function cardKey(entry: UnmatchedSettlement): string {
  return entry.last4 ?? 'unknown'
}

function chargesTable(entries: readonly UnmatchedSettlement[]): string {
  return table(
    ['Card', 'Payments', 'Total', 'Dates'],
    entries.map((entry) => [cardKey(entry), String(entry.rows.length), money(entry.chargedTotal), entry.rows.map((row) => date(row.date)).join(', ')]),
  )
}

interface ChargePlan {
  readonly chosen: readonly UnmatchedSettlement[]
  readonly unknown: readonly string[]
}

function planCharges(document: OpenDocument, cards: readonly string[]): ChargePlan {
  const all = unmatchedSettlements(document.db)
  return {
    chosen: all.filter((entry) => cards.includes(cardKey(entry))),
    unknown: cards.filter((card) => !all.some((entry) => cardKey(entry) === card)),
  }
}

export const countCardChargesTool: PluginTool = {
  definition: {
    name: 'count_card_charges',
    title: 'Count a card payment with no statement as spending',
    description:
      'The card payments in a bank statement for a card this document has no statement of — that month of card ' +
      'spending is otherwise missing. Without `cards`, lists them. With `cards` (the last four digits, or ' +
      '`unknown`), counts each card’s payments as the spending they stand for, so Home stops asking; the rows ' +
      'already count, so no figure moves. Reading the card’s statement later still makes them card payments to ' +
      'answer. **Dry-runs by default**; the document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        cards: { type: 'array', items: { type: 'string' }, description: 'Last four digits per card, or `unknown`.' },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const raw = args['cards']
    if (raw === undefined) {
      return readDocument(path, (document) => {
        const all = unmatchedSettlements(document.db)
        return all.length === 0
          ? 'No card payment is waiting: every one has its statement, or was counted.'
          : paragraphs(`${plural(all.length, 'card')} paid from the bank with no statement read.`, chargesTable(all))
      })
    }
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((one) => typeof one !== 'string')) {
      throw new ToolInputError('`cards` is a non-empty array of last-four digits, or `unknown`.')
    }
    const cards = raw.map((one) => String(one).trim())
    const describe = (plan: ChargePlan): string =>
      paragraphs(
        plan.chosen.length === 0 ? undefined : chargesTable(plan.chosen),
        plan.unknown.length === 0
          ? undefined
          : `No waiting payment for ${plan.unknown.join(', ')}. **Nothing will be written** while one is named that has none; call without \`cards\` to list them.`,
      )
    const mutation: Mutation<ChargePlan> = {
      plan: (document) => planCharges(document, cards),
      refuses: (plan) => plan.unknown.length > 0 || plan.chosen.length === 0,
      describe,
      apply: (document, plan) => {
        if (plan.unknown.length > 0 || plan.chosen.length === 0) return paragraphs(describe(plan), '**Nothing was written.**')
        countCardCharges(document.db, plan.chosen.flatMap((entry) => entry.rows.map((row) => row.ref)), true, Date.now())
        return paragraphs(describe(plan), `Counted as spending: ${plural(plan.chosen.length, 'card')}.`)
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
