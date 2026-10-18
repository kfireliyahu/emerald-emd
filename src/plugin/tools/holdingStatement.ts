/**
 * `record_holdings_statement` — a statement of an account with holdings,
 * read by the conversation and written in one batch (M30 U6).
 *
 * There is no app reader for a broker's PDF, and that is a decision,
 * not a gap waiting for one (2026-10-04): it was built before D-308 and cost
 * more than it read. The conversation reads the file and sends what it printed;
 * `src/data/importer/holdingStatement.ts` checks it — the printed balance after
 * every row against the one before it plus the row — and writes the movements
 * onto the account and the holdings table as dated readings. Each row is keyed
 * by its value date, its amount and the balance after it, so the half-year file
 * that repeats every monthly row adds nothing the months did not.
 */

import { fromMajorUnits, type CurrencyCode, type Money } from '@/core/money.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import {
  applyHoldingStatement,
  planHoldingStatement,
  type HoldingRef,
  type HoldingStatementInput,
  type HoldingStatementPlan,
  type StatementLineInput,
  type StatementRowInput,
} from '@/data/importer/holdingStatement.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { parseQuantity, quantityText } from '@/data/repositories/transactionRepository.ts'

import { type OpenDocument } from '../document.ts'
import { money, paragraphs, plural, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { checksTable, costText, moneyCheckText, quantityCheckText } from './holdingReadings.ts'
import { PATH_PROP, ToolInputError, booleanProp, optionalString, requireString, stringProp, type Args, type PluginTool } from './tool.ts'
import { readFileOffered } from '../files.ts'

const ROWS_MAX = 400
const LINES_MAX = 100

/** What the call said, before the document is open: the figures stay numbers until the currency is known. */
interface Offered {
  readonly account: HoldingStatementInput['account']
  readonly place: string | undefined
  readonly file: string
  readonly asOf: LocalDate
  readonly from: LocalDate | undefined
  readonly currency: string | undefined
  readonly rows: readonly {
    readonly date: LocalDate
    readonly description: string
    readonly amount: number
    readonly cashAfter: number
    readonly holding: string | undefined
    readonly quantityMicro: number | undefined
  }[]
  readonly lines: readonly {
    readonly holding: string
    readonly value: number
    readonly quantityMicro: number | undefined
    readonly costBasis: number | undefined
    readonly priceMicro: number | undefined
    readonly correct: boolean
  }[]
  readonly cash: number | undefined
}

function dateArg(value: unknown, where: string): LocalDate {
  const parsed = typeof value === 'string' ? parseISODate(value.trim()) : undefined
  if (parsed === undefined) throw new ToolInputError(`${where} must be a date as YYYY-MM-DD.`)
  return parsed
}

function figureArg(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(`${where} is an amount in major units, such as -3717.2.`)
  }
  return value
}

function decimalArg(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' && typeof value !== 'number') throw new ToolInputError(`${where} is a figure, such as "2357".`)
  const parsed = parseQuantity(value)
  if (!parsed.ok) throw new ToolInputError(`${where}: ${parsed.error}`)
  return parsed.value
}

function textArg(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ToolInputError(`${where} must be text.`)
  return value.trim() === '' ? undefined : value.trim()
}

function objects(args: Args, name: string, max: number): readonly Record<string, unknown>[] {
  const raw = args[name]
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ToolInputError(`\`${name}\` must be an array.`)
  if (raw.length > max) throw new ToolInputError(`That is ${String(raw.length)} entries in \`${name}\`; the ceiling is ${String(max)}.`)
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ToolInputError(`\`${name}[${String(index)}]\` must be an object.`)
    }
    return entry as Record<string, unknown>
  })
}

function readOffered(args: Args): Offered {
  const accountId = optionalString(args, 'account_id')
  const newAccount = optionalString(args, 'new_account')
  if ((accountId === undefined) === (newAccount === undefined)) {
    throw new ToolInputError(
      'Give `account_id` for the account with holdings (`document_info` lists them), or `new_account` — ' +
        'its name — and the batch makes it. One of the two.',
    )
  }
  const cash = args['cash']
  return {
    account: accountId !== undefined ? { id: accountId } : { newName: newAccount ?? '' },
    place: optionalString(args, 'place'),
    file: requireString(args, 'file'),
    asOf: dateArg(args['as_of'], '`as_of`'),
    from: args['from'] === undefined ? undefined : dateArg(args['from'], '`from`'),
    currency: optionalString(args, 'currency'),
    rows: objects(args, 'rows', ROWS_MAX).map((row, index) => {
      const at = `\`rows[${String(index)}]\``
      return {
        date: dateArg(row['date'], `${at}.date`),
        description: textArg(row['description'], `${at}.description`) ?? '',
        amount: figureArg(row['amount'], `${at}.amount`),
        cashAfter: figureArg(row['cash_after'], `${at}.cash_after`),
        holding: textArg(row['holding'], `${at}.holding`),
        quantityMicro: decimalArg(row['quantity'], `${at}.quantity`),
      }
    }),
    lines: objects(args, 'holdings', LINES_MAX).map((line, index) => {
      const at = `\`holdings[${String(index)}]\``
      const holding = textArg(line['holding'], `${at}.holding`)
      if (holding === undefined) throw new ToolInputError(`${at} needs a \`holding\`.`)
      return {
        holding,
        value: figureArg(line['value'], `${at}.value`),
        quantityMicro: decimalArg(line['quantity'], `${at}.quantity`),
        costBasis: line['cost_basis'] === undefined || line['cost_basis'] === null ? undefined : figureArg(line['cost_basis'], `${at}.cost_basis`),
        priceMicro: decimalArg(line['price'], `${at}.price`),
        correct: line['correct'] === true,
      }
    }),
    cash: cash === undefined || cash === null ? undefined : figureArg(cash, '`cash`'),
  }
}

function inputOf(document: OpenDocument, offered: Offered, fileName: string, fileHash: string): HoldingStatementInput {
  const currency = (offered.currency ?? documentCurrency(document.db)) as CurrencyCode
  const asMoney = (value: number): Money => fromMajorUnits(value, currency)
  return {
    account: offered.account,
    place: offered.place,
    fileName,
    fileHash,
    asOf: offered.asOf,
    from: offered.from,
    currency,
    rows: offered.rows.map(
      (row): StatementRowInput => ({
        date: row.date,
        description: row.description,
        amount: asMoney(row.amount),
        cashAfter: asMoney(row.cashAfter),
        holding: row.holding,
        quantityMicro: row.quantityMicro,
      }),
    ),
    lines: offered.lines.map(
      (line): StatementLineInput => ({
        holding: line.holding,
        value: asMoney(line.value),
        quantityMicro: line.quantityMicro,
        costBasis: line.costBasis === undefined ? undefined : asMoney(line.costBasis),
        priceMicro: line.priceMicro,
        correct: line.correct,
      }),
    ),
    cash: offered.cash === undefined ? undefined : asMoney(offered.cash),
  }
}

function holdingName(ref: HoldingRef | undefined): string {
  return ref === undefined ? '' : ref.kind === 'EXISTING' ? ref.holding.name : `${ref.name} (new)`
}

const ROW_OUTCOME = { NEW: 'new', ALREADY: 'already there', NO_CASH: 'left out: moves no cash' } as const

function describePlan(plan: HoldingStatementPlan): string {
  const input = plan.input
  const place = plan.place
  const header =
    `**${input.fileName}** → ${plan.accountName}${plan.accountId === undefined ? ' (new, an account with holdings)' : ''}` +
    (place === undefined
      ? ''
      : `, held at ${place.name}${place.isNew ? ' (new)' : ''}${place.links ? ' — the place will name this account and keep its cash' : ''}`) +
    `; the holdings table is for ${toISODate(input.asOf)}.`
  const counts = (outcome: keyof typeof ROW_OUTCOME): number => plan.rows.filter((row) => row.outcome === outcome && row.problem === undefined).length
  const rows =
    plan.rows.length === 0
      ? undefined
      : table(
          ['#', 'Value date', 'Description', 'Amount', 'Cash after', 'Holding', 'Quantity', 'Will be'],
          plan.rows.map((row, index) => [
            String(index + 1),
            toISODate(row.input.date),
            row.input.description,
            money(row.input.amount),
            money(row.input.cashAfter),
            holdingName(row.holding),
            row.input.quantityMicro === undefined ? '' : quantityText(row.input.quantityMicro),
            row.problem === undefined ? ROW_OUTCOME[row.outcome] : 'refused',
          ]),
        )
  const lines =
    plan.lines.length === 0
      ? undefined
      : table(
          ['Holding', 'Worth', 'Quantity', 'Cost', 'Will be', 'Cost against the rows', 'Quantity against the rows', 'Quantity × price'],
          plan.lines.map((line) => [
            holdingName(line.holding) || line.input.holding,
            money(line.input.value),
            line.input.quantityMicro === undefined ? '—' : quantityText(line.input.quantityMicro),
            money(line.input.costBasis),
            line.problem !== undefined ? 'refused' : line.outcome === 'SAME' ? 'already recorded' : line.outcome === 'CORRECTS' ? 'corrects that day' : 'new reading',
            line.checks === undefined ? '—' : costText(line.checks.cost),
            line.checks === undefined ? '—' : quantityCheckText(line.checks.quantity),
            line.checks === undefined ? '—' : moneyCheckText(line.checks.price, 'quantity × price'),
          ]),
        )
  return paragraphs(
    header,
    plan.rows.length === 0
      ? undefined
      : `${plural(counts('NEW'), 'new row')}, ${String(counts('ALREADY'))} already there` +
          (counts('NO_CASH') === 0 ? '' : `, ${String(counts('NO_CASH'))} left out because they move no cash and name no holding`) +
          (plan.chain === undefined && plan.rows.length > 1 ? '. **The printed balances add up row by row.**' : '.'),
    rows,
    plan.newHoldings.length === 0 ? undefined : `New holdings, made in ${place?.name ?? 'the place'}: ${plan.newHoldings.join(', ')}.`,
    lines,
    plan.cash === undefined ? undefined : `Cash line ${money(input.cash)} against the account's rows: ${moneyCheckText(plan.cash.check, 'its rows')}.`,
    plan.previousStatementId === undefined ? undefined : 'This exact file was written before; only what it adds is new.',
    plan.problems.length === 0
      ? undefined
      : `**Refused — nothing will be written** while any of this stands:\n\n${plan.problems.map((one) => `- ${one}`).join('\n')}`,
  )
}

export const recordHoldingsStatementTool: PluginTool = {
  definition: {
    name: 'record_holdings_statement',
    title: 'Record a statement of an account with holdings',
    description:
      'Write what a broker’s (or any account with holdings’) statement printed — **the whole file in one call**: ' +
      'its movements onto the account, and its holdings table as dated readings. **You read the file** — a PDF, ' +
      'usually — and send what it printed; nothing here parses it. Each row is the **value date**, the description ' +
      'as printed, the signed `amount` (a buy negative, a deposit or a sale positive; a fee printed in its own column ' +
      'is already inside the amount), and `cash_after`, the cash balance the statement printed after it. A buy or a ' +
      'sale also names the `holding` and the `quantity` (bought positive, sold negative). **The balances are a ' +
      'check**: each must be the one before it plus the row, and the batch is refused at the first that is not — a ' +
      'misread figure. **They are also each row’s key** (date, amount, balance after), so an overlapping file — a ' +
      'half-year export repeating the months — adds only what is new, and the same file again adds nothing. A row ' +
      'of amount 0 naming no holding (the broker’s tax bookkeeping) is left out. `holdings` is the holdings table: ' +
      'per holding its `value`, and when printed its `quantity`, `cost_basis` and `price` (one unit, in major units — ' +
      'a price printed in agorot is divided by 100); `cash` is the cash line. Each is checked: the cost against what ' +
      'the holding’s rows put in by `as_of`, the quantity against theirs, quantity × price against the value, and ' +
      'the cash against the account’s rows. Holdings are named by id or name (`savings` lists them); a name the place ' +
      'does not have is made there. **Dry-runs by default**; the document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        file: stringProp('Absolute path to the statement file you read. Hashed, so the same file is known again.'),
        account_id: stringProp('The account with holdings. Or `new_account`.'),
        new_account: stringProp('Instead of `account_id`: the name of the account to make, e.g. the broker’s name.'),
        place: stringProp(
          'The place on Net worth that names the account, when it names none yet — by id or name; made when new. ' +
            'Defaults to one with the account’s name.',
        ),
        as_of: stringProp('The day the holdings table is for, YYYY-MM-DD.'),
        from: stringProp('The first day of the period the statement printed, when it printed one.'),
        currency: stringProp('Defaults to the document’s currency.'),
        rows: {
          type: 'array',
          description: `Every movement, in the order printed. Up to ${String(ROWS_MAX)}.`,
          items: {
            type: 'object',
            properties: {
              date: stringProp('The value date (יום ערך), YYYY-MM-DD.'),
              description: stringProp('The movement type and the security, as printed.'),
              amount: { type: 'number', description: 'Signed, in major units: a buy is negative.' },
              cash_after: { type: 'number', description: 'The cash balance printed after this row.' },
              holding: stringProp('What a buy or a sale was in: a holding id or name.'),
              quantity: { type: ['string', 'number'], description: 'How much was bought (positive) or sold (negative).' },
            },
            required: ['date', 'description', 'amount', 'cash_after'],
            additionalProperties: false,
          },
        },
        holdings: {
          type: 'array',
          description: `The holdings table, one entry per holding but the cash. Up to ${String(LINES_MAX)}.`,
          items: {
            type: 'object',
            properties: {
              holding: stringProp('A holding id or name.'),
              value: { type: 'number', description: 'What it was worth, as printed, in major units.' },
              quantity: { type: ['string', 'number'], description: 'How much of it, as printed.' },
              cost_basis: { type: 'number', description: 'What it cost, as printed, in major units.' },
              price: { type: ['string', 'number'], description: 'One unit’s price in major units. A check only.' },
              correct: booleanProp('True when these figures replace a different reading of that day.'),
            },
            required: ['holding', 'value'],
            additionalProperties: false,
          },
        },
        cash: { type: 'number', description: 'The cash line of the holdings table, in major units.' },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'file', 'as_of'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const offered = readOffered(args)
    const { fileName, hash: fileHash } = await readFileOffered(offered.file)

    const mutation: Mutation<HoldingStatementPlan> = {
      plan: (document) => planHoldingStatement(document.db, inputOf(document, offered, fileName, fileHash)),
      refuses: (plan) => plan.problems.length > 0,
      describe: describePlan,
      apply: (document, plan) => {
        if (plan.problems.length > 0) return paragraphs(describePlan(plan), '**Nothing was written.**')
        const result = applyHoldingStatement(document.db, plan, Date.now())
        return paragraphs(
          `Wrote ${plural(result.rowsWritten, 'row')} from ${fileName} into ${plan.accountName}, \`account_id\` ${result.accountId}` +
            (result.rowsAlready === 0 ? '' : `; ${String(result.rowsAlready)} were already there`) +
            (result.rowsWithoutCash === 0 ? '' : `; ${String(result.rowsWithoutCash)} left out as moving no cash`) +
            `. ${plural(result.readingsWritten, 'reading')} written.`,
          result.holdingsMade.length === 0 ? undefined : `Made ${plural(result.holdingsMade.length, 'holding')}: ${result.holdingsMade.join(', ')}.`,
          result.readings.length === 0 ? undefined : checksTable(document, result.readings),
          result.transfersSuggested === 0
            ? undefined
            : `${plural(result.transfersSuggested, 'transfer')} between the person’s own accounts suggested; ` +
              '`transfers` lists them and `answer_transfers` answers them.',
          'Nothing on an account with holdings is income or spending: a deposit there is money moved, and ' +
            'interest, a bonus or a rebate is growth of its cash.',
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
