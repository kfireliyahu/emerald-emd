/**
 * `record_holding_readings` — the conversation half of a dated reading of what a
 * holding is worth (M30 U5, D-358).
 *
 * A statement prints what each holding was worth on a day, and often its
 * quantity, its cost and a price; a conversation reads the statement and writes
 * them here. Nothing is fetched (D-308). A goal fed by the holding is then worth
 * its latest reading, with what went in beside it, and each reading proves what
 * it can about the rows: the cost against the buys, the quantity against their
 * quantities, quantity × price against the value, and an account's cash line
 * against its running balance. The goal's page is the screen half, and both
 * write through `recordHoldingReading`.
 */

import { fromMajorUnits, type Money } from '@/core/money.ts'
import { parseISODate, type LocalDate } from '@/core/time.ts'
import { goalHoldingFeeds, goalWorth } from '@/data/repositories/goalDepositRepository.ts'
import {
  deleteHoldingReading,
  holdingReadingProblem,
  listHoldingReadings,
  readingChecks,
  readingClash,
  recordHoldingReading,
  type HoldingReading,
  type NewHoldingReading,
  type ReadingChecks,
} from '@/data/repositories/holdingReadingRepository.ts'
import { findGoal, listHoldings } from '@/data/repositories/savingsRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { parseQuantity, quantityText } from '@/data/repositories/transactionRepository.ts'
import type { CostBasisCheck } from '@/domain/goalDeposits.ts'
import type { ReadingCheck } from '@/domain/holdingReadings.ts'
import type { Holding } from '@/domain/model/savings.ts'

import { type OpenDocument } from '../document.ts'
import { money, paragraphs, plural, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { PATH_PROP, ToolInputError, booleanProp, requireString, stringProp, type Args, type PluginTool } from './tool.ts'

const BATCH_MAX = 200

interface Requested {
  readonly holding: string
  readonly asOf: string
  readonly value: number | undefined
  readonly currency: string | undefined
  readonly quantity: string | number | undefined
  readonly costBasis: number | undefined
  readonly price: string | number | undefined
  readonly statement: string | undefined
  readonly source: string | undefined
  readonly note: string | undefined
  readonly correct: boolean
  readonly remove: boolean
}

interface EntryPlan {
  readonly requested: Requested
  readonly holding: Holding | undefined
  readonly input: NewHoldingReading | undefined
  /** The reading `remove` names. */
  readonly removes: HoldingReading | undefined
  readonly outcome: 'NEW' | 'SAME' | 'CORRECTS' | 'REMOVES'
  readonly note: string | undefined
}

function readEntries(args: Args): readonly Requested[] {
  const raw = args['readings']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`readings` must be a non-empty array, one entry per holding and day.')
  }
  if (raw.length > BATCH_MAX) throw new ToolInputError(`That is ${raw.length} entries; the ceiling is ${BATCH_MAX}.`)
  return raw.map((entry, index): Requested => {
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`\`readings[${index}]\` must be an object.`)
    const record = entry as Record<string, unknown>
    const text = (name: string): string | undefined => {
      const value = record[name]
      if (value === undefined || value === null) return undefined
      if (typeof value !== 'string') throw new ToolInputError(`\`readings[${index}].${name}\` must be text.`)
      return value.trim() === '' ? undefined : value.trim()
    }
    const figure = (name: string): number | undefined => {
      const value = record[name]
      if (value === undefined || value === null) return undefined
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ToolInputError(`\`readings[${index}].${name}\` is an amount in major units, such as 6300.5.`)
      }
      return value
    }
    const decimal = (name: string): string | number | undefined => {
      const value = record[name]
      if (value === undefined || value === null) return undefined
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new ToolInputError(`\`readings[${index}].${name}\` is a figure, such as "12.5".`)
      }
      return value
    }
    const holding = text('holding')
    const asOf = text('as_of')
    if (holding === undefined) throw new ToolInputError(`\`readings[${index}]\` needs a \`holding\`, from \`savings\`.`)
    if (asOf === undefined) throw new ToolInputError(`\`readings[${index}]\` needs an \`as_of\` date, YYYY-MM-DD.`)
    return {
      holding,
      asOf,
      value: figure('value'),
      currency: text('currency'),
      quantity: decimal('quantity'),
      costBasis: figure('cost_basis'),
      price: decimal('price'),
      statement: text('statement'),
      source: text('source'),
      note: text('note'),
      correct: record['correct'] === true,
      remove: record['remove'] === true,
    }
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

function planEntries(document: OpenDocument, batch: readonly Requested[]): readonly EntryPlan[] {
  const holdings = listHoldings(document.db, { includeArchived: true })
  const fallback = documentCurrency(document.db)
  const seen = new Set<string>()
  return batch.map((requested): EntryPlan => {
    const refused = (note: string, holding?: Holding): EntryPlan => ({
      requested,
      holding,
      input: undefined,
      removes: undefined,
      outcome: 'NEW',
      note,
    })
    const found = findHolding(holdings, requested.holding)
    if (typeof found === 'string') return refused(found)
    const asOf: LocalDate | undefined = parseISODate(requested.asOf)
    if (asOf === undefined) return refused(`\`as_of\` must be a date as YYYY-MM-DD; got "${requested.asOf}"`, found)
    const key = `${found.id}:${requested.asOf}`
    if (seen.has(key)) return refused('the batch names this holding and day twice', found)
    seen.add(key)

    if (requested.remove) {
      const held = listHoldingReadings(document.db, found.id).find((one) => one.asOf === requested.asOf)
      return held === undefined
        ? refused('there is no reading of it that day to remove', found)
        : { requested, holding: found, input: undefined, removes: held, outcome: 'REMOVES', note: undefined }
    }
    if (requested.value === undefined) return refused('needs a `value`: what the statement says it was worth', found)
    const currency = requested.currency ?? fallback
    const asMoney = (value: number | undefined): Money | undefined =>
      value === undefined ? undefined : fromMajorUnits(value, currency)
    let quantityMicro: number | undefined
    if (requested.quantity !== undefined) {
      const parsed = parseQuantity(requested.quantity)
      if (!parsed.ok) return refused(`quantity: ${parsed.error}`, found)
      quantityMicro = parsed.value
    }
    let priceMicro: number | undefined
    if (requested.price !== undefined) {
      const parsed = parseQuantity(requested.price)
      if (!parsed.ok) return refused(`price: ${parsed.error}`, found)
      priceMicro = parsed.value
    }
    const input: NewHoldingReading = {
      holdingId: found.id,
      asOf,
      value: fromMajorUnits(requested.value, currency),
      quantityMicro,
      costBasis: asMoney(requested.costBasis),
      priceMicro,
      statementId: requested.statement,
      source: requested.source,
      note: requested.note,
    }
    const problem = holdingReadingProblem(document.db, input)
    if (problem !== undefined) return refused(problem, found)
    const clash = readingClash(document.db, input)
    const same = listHoldingReadings(document.db, found.id).some((one) => one.asOf === requested.asOf)
    if (clash !== undefined && !requested.correct) {
      return refused(
        `a reading that day already says ${money(clash.value)}; send \`correct: true\` if this one replaces it`,
        found,
      )
    }
    return {
      requested,
      holding: found,
      input,
      removes: undefined,
      outcome: clash !== undefined ? 'CORRECTS' : same ? 'SAME' : 'NEW',
      note: undefined,
    }
  })
}

const OUTCOME: Readonly<Record<EntryPlan['outcome'], string>> = {
  NEW: 'new',
  SAME: 'already recorded — changes nothing',
  CORRECTS: 'corrects that day’s reading',
  REMOVES: 'removed',
}

function describeEntries(entries: readonly EntryPlan[]): string {
  return table(
    ['Holding', 'Day', 'Worth', 'Quantity', 'Cost', 'Price', 'Will be', 'Note'],
    entries.map((entry) => [
      entry.holding?.name ?? entry.requested.holding,
      entry.requested.asOf,
      entry.input === undefined ? (entry.removes === undefined ? '—' : money(entry.removes.value)) : money(entry.input.value),
      entry.input?.quantityMicro === undefined ? '—' : quantityText(entry.input.quantityMicro),
      money(entry.input?.costBasis),
      entry.input?.priceMicro === undefined ? '—' : quantityText(entry.input.priceMicro),
      entry.note === undefined ? OUTCOME[entry.outcome] : 'refused',
      entry.note ?? '',
    ]),
  )
}

export function costText(check: CostBasisCheck): string {
  return check.kind === 'PROVED'
    ? 'proved'
    : check.kind === 'FAILED'
      ? `failed: printed ${money(check.printed)}, the rows ${money({ ...check.printed, minor: check.printed.minor + check.difference.minor })}`
      : `unchecked: ${check.reason}`
}

export function moneyCheckText(check: ReadingCheck<Money> | undefined, ours: string): string {
  if (check === undefined) return '—'
  return check.kind === 'PROVED'
    ? 'proved'
    : check.kind === 'FAILED'
      ? `failed: printed ${money(check.printed)}, ${ours} ${money(check.ours)}`
      : `unchecked: ${check.reason}`
}

export function quantityCheckText(check: ReadingCheck<number>): string {
  return check.kind === 'PROVED'
    ? 'proved'
    : check.kind === 'FAILED'
      ? `failed: printed ${quantityText(check.printed)}, the rows ${quantityText(check.ours)}`
      : `unchecked: ${check.reason}`
}

/** What each reading proves — the four checks, each its own column, none left unsaid. */
export function checksTable(document: OpenDocument, readings: readonly HoldingReading[]): string {
  const holdings = listHoldings(document.db, { includeArchived: true })
  return table(
    ['Holding', 'Day', 'Worth', 'Cost against the rows', 'Quantity against the rows', 'Quantity × price', 'Cash against the account'],
    readings.map((reading) => {
      const checks: ReadingChecks = readingChecks(document.db, reading)
      const isCash = checks.cash !== undefined
      return [
        holdings.find((one) => one.id === reading.holdingId)?.name ?? reading.holdingId,
        reading.asOf,
        money(reading.value),
        isCash ? '—' : costText(checks.cost),
        isCash ? '—' : quantityCheckText(checks.quantity),
        isCash ? '—' : moneyCheckText(checks.price, 'quantity × price'),
        moneyCheckText(checks.cash, 'its rows'),
      ]
    }),
  )
}

/** The goals the batch's holdings feed, with what each is worth now and what went in. */
function goalsNow(document: OpenDocument, holdingIds: ReadonlySet<string>): string | undefined {
  const currency = documentCurrency(document.db)
  const rows: string[][] = []
  for (const [goalId, holdingId] of goalHoldingFeeds(document.db)) {
    if (!holdingIds.has(holdingId)) continue
    const worth = goalWorth(document.db, goalId, currency)
    if (worth === undefined) continue
    rows.push([
      findGoal(document.db, goalId)?.name ?? goalId,
      money(worth.worth),
      worth.asOf,
      money(worth.putIn),
      money({ ...worth.worth, minor: worth.worth.minor - worth.putIn.minor }),
    ])
  }
  return rows.length === 0 ? undefined : table(['Goal', 'Worth now', 'Latest reading', 'Put in', 'Growth'], rows)
}

export const recordHoldingReadingsTool: PluginTool = {
  definition: {
    name: 'record_holding_readings',
    title: 'Record what a statement says a holding is worth',
    description:
      'Write what a statement printed each holding was worth on a day — **a list in one call**. ' +
      'Transcribed, never fetched: there is no price feed. `value` is the worth as printed, in ' +
      'major units; `quantity`, `cost_basis` and `price` are optional and each is a check: the ' +
      'cost against what the rows that name the holding put in by that day, the quantity against ' +
      'their quantities, quantity × `price` against the value (a price printed in agorot is ' +
      'divided by 100 first — the check catches it when it is not). An account’s own cash holding ' +
      'takes a value only, checked against the account’s running balance. A goal fed by the holding ' +
      'is then worth its latest reading, with what went in beside it, and the difference is growth. ' +
      'The same figures for the same day again change nothing; other figures for a day that has a ' +
      'reading are refused unless `correct: true`; `remove: true` takes a day’s reading away. ' +
      'Holdings and their ids are listed by `savings`. **Dry-runs by default**; the document is ' +
      'copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        readings: {
          type: 'array',
          description: `One entry per holding and day. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              holding: stringProp('The holding, by id or by a name only one holding carries.'),
              as_of: stringProp('The day the statement says it was worth that, YYYY-MM-DD.'),
              value: { type: 'number', description: 'What it was worth, as printed, in major units.' },
              currency: stringProp('Defaults to the document’s currency.'),
              quantity: { type: ['string', 'number'], description: 'How much of it, as printed.' },
              cost_basis: { type: 'number', description: 'What it cost, as printed, in major units.' },
              price: {
                type: ['string', 'number'],
                description: 'One unit’s price in the value’s currency, major units. A check only.',
              },
              statement: stringProp('The id of the imported statement it came from, if there is one.'),
              source: stringProp('The file it came from, as named.'),
              note: stringProp('Optional.'),
              correct: booleanProp('True when these figures replace a different reading of that day.'),
              remove: booleanProp('True to take that day’s reading away; nothing else is needed.'),
            },
            required: ['holding', 'as_of'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'readings'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readEntries(args)

    const mutation: Mutation<readonly EntryPlan[]> = {
      plan: (document) => planEntries(document, batch),
      refuses: (entries) => entries.some((entry) => entry.note !== undefined),
      describe: (entries) =>
        paragraphs(
          describeEntries(entries),
          entries.some((entry) => entry.note !== undefined)
            ? 'Nothing will be written while any entry has a note: the batch applies whole or not at all.'
            : 'A goal fed by one of these holdings will be worth its latest reading; the difference from what went in is growth.',
        ),
      apply: (document, entries) => {
        if (entries.some((entry) => entry.note !== undefined)) {
          return paragraphs(describeEntries(entries), '**Nothing was written**: the batch applies whole or not at all.')
        }
        const now = Date.now()
        const touched = new Set<string>()
        let written = 0
        let removed = 0
        for (const entry of entries) {
          if (entry.holding !== undefined) touched.add(entry.holding.id)
          if (entry.removes !== undefined) {
            deleteHoldingReading(document.db, entry.removes.id, now)
            removed += 1
          } else if (entry.input !== undefined) {
            const outcome = recordHoldingReading(document.db, entry.input, { correct: entry.requested.correct }, now)
            if (outcome !== 'UNCHANGED') written += 1
          }
        }
        const readings = entries
          .filter((entry) => entry.input !== undefined && entry.holding !== undefined)
          .flatMap((entry) =>
            listHoldingReadings(document.db, entry.holding?.id).filter((one) => one.asOf === entry.requested.asOf),
          )
        return paragraphs(
          `Wrote ${plural(written, 'reading')}` +
            (removed === 0 ? '' : `, removed ${plural(removed, 'reading')}`) +
            (written + removed < entries.length ? `; ${plural(entries.length - written - removed, 'was', 'were')} already recorded.` : '.'),
          readings.length === 0 ? undefined : checksTable(document, readings),
          goalsNow(document, touched),
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
