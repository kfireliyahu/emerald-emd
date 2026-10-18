/**
 * `set_transaction_holdings` — the conversation half of a row naming what its
 * cash turned into (M30 U2).
 *
 * A transaction may name a holding and a quantity: a buy (cash out, quantity
 * positive) or a sale (cash in, quantity negative) inside one account. Such a
 * row counts in neither came in, went out nor moved, and the holding's quantity
 * is the sum of its rows'. The Transactions screen's detail panel is the screen
 * half, and both write through `setTransactionHolding`.
 */

import {
  holdingQuantity,
  listHoldings,
  setTransactionHolding,
  transactionHoldingProblem,
} from '@/data/repositories/savingsRepository.ts'
import {
  findTransactionById,
  parseQuantity,
  quantityText,
  type StoredTransaction,
} from '@/data/repositories/transactionRepository.ts'
import type { Holding } from '@/domain/model/savings.ts'

import { type OpenDocument } from '../document.ts'
import { date, money, paragraphs, plural, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 500

interface Requested {
  readonly transactionId: string
  /** `null` clears the row's holding and quantity. */
  readonly holding: string | null
  readonly quantity: string | number | undefined
}

interface RowPlan {
  readonly transactionId: string
  readonly row: StoredTransaction | undefined
  readonly was: string
  readonly holdingId: string | undefined
  readonly holdingName: string
  readonly quantityMicro: number | undefined
  readonly note: string | undefined
}

function readRows(args: Args): readonly Requested[] {
  const raw = args['rows']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`rows` must be a non-empty array, one entry per transaction.')
  }
  if (raw.length > BATCH_MAX) throw new ToolInputError(`That is ${raw.length} entries; the ceiling is ${BATCH_MAX}.`)
  return raw.map((entry, index): Requested => {
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`\`rows[${index}]\` must be an object.`)
    const record = entry as Record<string, unknown>
    const id = record['transaction_id']
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ToolInputError(`\`rows[${index}]\` needs a \`transaction_id\`, from \`transactions\`.`)
    }
    const holding = record['holding']
    if (holding !== null && (typeof holding !== 'string' || holding.trim() === '')) {
      throw new ToolInputError(`\`rows[${index}].holding\` is a holding's id or name, or null to clear it.`)
    }
    const quantity = record['quantity']
    if (quantity !== undefined && typeof quantity !== 'string' && typeof quantity !== 'number') {
      throw new ToolInputError(`\`rows[${index}].quantity\` is a figure, such as "12.5" or -3.`)
    }
    return { transactionId: id.trim(), holding: holding === null ? null : holding.trim(), quantity }
  })
}

/** By id, else by a name only one holding carries — two of one name is a question, not a guess. */
function findHolding(holdings: readonly Holding[], wanted: string): Holding | string {
  const byId = holdings.find((one) => one.id === wanted)
  if (byId !== undefined) return byId
  const lower = wanted.toLowerCase()
  const named = holdings.filter((one) => one.name.trim().toLowerCase() === lower)
  if (named.length === 1 && named[0] !== undefined) return named[0]
  return named.length === 0
    ? `no holding called "${wanted}"; \`savings\` lists them with their ids`
    : `${named.length} holdings are called "${wanted}"; name one by its id`
}

function planRows(document: OpenDocument, batch: readonly Requested[]): readonly RowPlan[] {
  const holdings = listHoldings(document.db, { includeArchived: true })
  const nameOf = (id: string | undefined): string =>
    id === undefined ? '—' : (holdings.find((one) => one.id === id)?.name ?? id)

  return batch.map((one): RowPlan => {
    const row = findTransactionById(document.db, one.transactionId)
    const was =
      row?.holdingId === undefined
        ? '—'
        : `${nameOf(row.holdingId)}${row.quantityMicro === undefined ? '' : ` × ${quantityText(row.quantityMicro)}`}`
    const base = { transactionId: one.transactionId, row, was }
    if (row === undefined) {
      return { ...base, holdingId: undefined, holdingName: '—', quantityMicro: undefined, note: 'no such transaction; `transactions` lists them' }
    }
    if (one.holding === null) {
      if (one.quantity !== undefined) {
        return { ...base, holdingId: undefined, holdingName: 'none', quantityMicro: undefined, note: 'a quantity with no holding is a count of nothing' }
      }
      return { ...base, holdingId: undefined, holdingName: 'none', quantityMicro: undefined, note: undefined }
    }
    const found = findHolding(holdings, one.holding)
    if (typeof found === 'string') {
      return { ...base, holdingId: undefined, holdingName: one.holding, quantityMicro: undefined, note: found }
    }
    if (one.quantity === undefined) {
      return { ...base, holdingId: found.id, holdingName: found.name, quantityMicro: undefined, note: 'needs a `quantity`: bought is positive, sold negative' }
    }
    const parsed = parseQuantity(one.quantity)
    if (!parsed.ok) {
      return { ...base, holdingId: found.id, holdingName: found.name, quantityMicro: undefined, note: parsed.error }
    }
    const problem = transactionHoldingProblem(document.db, row.id, { holdingId: found.id, quantityMicro: parsed.value })
    return { ...base, holdingId: found.id, holdingName: found.name, quantityMicro: parsed.value, note: problem }
  })
}

function describeRows(entries: readonly RowPlan[]): string {
  return table(
    ['Date', 'Merchant', 'Amount', 'Names now', 'Will name', 'Quantity', 'Note'],
    entries.map((entry) => [
      entry.row === undefined ? entry.transactionId : date(entry.row.transactionDate),
      entry.row?.merchantRaw ?? '—',
      entry.row === undefined ? '—' : money(entry.row.amount),
      entry.was,
      entry.holdingName,
      entry.quantityMicro === undefined ? '—' : quantityText(entry.quantityMicro),
      entry.note ?? '',
    ]),
  )
}

/** What each holding the batch touched holds now — so nobody has to ask. */
function heldNow(document: OpenDocument, entries: readonly RowPlan[]): string {
  const touched = new Set<string>()
  for (const entry of entries) {
    if (entry.holdingId !== undefined) touched.add(entry.holdingId)
    if (entry.row?.holdingId !== undefined) touched.add(entry.row.holdingId)
  }
  const holdings = listHoldings(document.db, { includeArchived: true })
  return table(
    ['Holding', 'Holds now', 'Rows'],
    [...touched].map((id) => {
      const quantity = holdingQuantity(document.db, id)
      return [
        holdings.find((one) => one.id === id)?.name ?? id,
        quantity.kind === 'VALUE' ? quantityText(quantity.quantityMicro) : `unchecked — ${quantity.reason}`,
        quantity.kind === 'VALUE' ? String(quantity.rows) : '—',
      ]
    }),
  )
}

export const setTransactionHoldingsTool: PluginTool = {
  definition: {
    name: 'set_transaction_holdings',
    title: 'Say what a transaction’s cash turned into',
    description:
      'Name the holding a transaction bought or sold, and how much of it — **a list in one ' +
      'call**. Such a row is cash turning into a holding inside one account (a broker buying a ' +
      'fund, a savings account opening a deposit): it counts in neither came in, went out nor ' +
      'moved, and the holding’s quantity is the sum of its rows’ quantities. `quantity` is a ' +
      'count of the thing, never money — bought is positive, sold negative, up to six places. ' +
      '`holding: null` clears both. The holding must sit at a place that names the row’s own ' +
      'account, or at one that names none, and is never an account’s own cash. Holdings and ' +
      'their ids are listed by `savings`; transaction ids by `transactions`. **Dry-runs by ' +
      'default**; the document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        rows: {
          type: 'array',
          description: `One entry per transaction. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              transaction_id: stringProp('The transaction, from `transactions`.'),
              holding: {
                type: ['string', 'null'],
                description: 'The holding, by id or by a name only one holding carries; null clears it.',
              },
              quantity: {
                type: ['string', 'number'],
                description: 'How much of the holding: positive bought, negative sold. Required with a holding.',
              },
            },
            required: ['transaction_id', 'holding'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'rows'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readRows(args)

    const mutation: Mutation<readonly RowPlan[]> = {
      plan: (document) => planRows(document, batch),
      refuses: (entries) => entries.some((entry) => entry.note !== undefined),
      describe: (entries) =>
        paragraphs(
          describeRows(entries),
          entries.some((entry) => entry.note !== undefined)
            ? 'Nothing will be written while any entry has a note: the batch applies whole or not at all.'
            : 'A row that names a holding is neither in nor out of any month: what it spent became the holding.',
        ),
      apply: (document, entries) => {
        if (entries.some((entry) => entry.note !== undefined)) {
          return paragraphs(describeRows(entries), '**Nothing was written**: the batch applies whole or not at all.')
        }
        const now = Date.now()
        for (const entry of entries) {
          setTransactionHolding(
            document.db,
            entry.transactionId,
            entry.holdingId === undefined || entry.quantityMicro === undefined
              ? undefined
              : { holdingId: entry.holdingId, quantityMicro: entry.quantityMicro },
            now,
          )
        }
        const named = entries.filter((entry) => entry.holdingId !== undefined).length
        const cleared = entries.length - named
        return paragraphs(
          `Named a holding on ${plural(named, 'row')}` +
            (cleared === 0 ? '.' : `, cleared ${plural(cleared, 'row')}.`),
          heldNow(document, entries),
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
