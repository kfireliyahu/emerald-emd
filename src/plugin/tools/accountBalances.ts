/**
 * `set_opening_balances` — the write behind Overview's Accounts table (M28 U8,
 * D-325): what an account held before its first statement, and the day that
 * stands for everything before.
 *
 * A document cannot read this off a file, so a person says it once, and the
 * check it buys — opening plus what the statements moved equals the balance the
 * last one ended on — is shown beside it. The tool takes the whole list, and
 * its answer carries the check so a conversation does not need a second call to
 * learn whether the number it just wrote was right.
 */

import { formatMoney, fromMajorUnits, type Money } from '@/core/money.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { listAccounts } from '@/data/repositories/accountRepository.ts'
import { accountBalances, setOpeningBalance, type AccountBalance } from '@/data/repositories/accountBalanceRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { uncheckedReason, type OpeningCheck } from '@/domain/accountBalances.ts'

import { type OpenDocument } from '../document.ts'
import { paragraphs, plural, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 30

interface Requested {
  readonly account: string
  /** Major units; `undefined` with `clear` forgets it. */
  readonly amountMajor: number | undefined
  readonly date: LocalDate | undefined
  readonly clear: boolean
}

interface Entry {
  readonly requested: Requested
  readonly accountId: string | undefined
  readonly accountName: string
  readonly amount: Money | undefined
  readonly date: LocalDate | undefined
  readonly note: string | undefined
}

function readRequests(args: Args): readonly Requested[] {
  const raw = args['accounts']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`accounts` must be a non-empty array, one entry per account.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} accounts; the ceiling is ${BATCH_MAX}.`)
  }
  return raw.map((entry, index) => {
    const where = `\`accounts[${index}]\``
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`${where} must be an object.`)
    const record = entry as Record<string, unknown>
    const account = optionalString(record, 'account')
    if (account === undefined) {
      throw new ToolInputError(`${where} needs an \`account\`: an id or a name from \`document_info\`.`)
    }
    if (record['clear'] === true) return { account, amountMajor: undefined, date: undefined, clear: true }
    const amount = record['amount']
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new ToolInputError(
        `${where} needs an \`amount\` (a number, in the document's currency) or \`clear: true\`.`,
      )
    }
    const dateText = optionalString(record, 'date')
    const date = dateText === undefined ? undefined : parseISODate(dateText)
    if (date === undefined) {
      throw new ToolInputError(
        `${where} needs a \`date\`, as YYYY-MM-DD: the day the amount stands for everything before.`,
      )
    }
    return { account, amountMajor: amount, date, clear: false }
  })
}

function plan(document: OpenDocument, batch: readonly Requested[]): readonly Entry[] {
  const accounts = listAccounts(document.db, { includeArchived: true })
  const currency = documentCurrency(document.db)
  return batch.map((requested): Entry => {
    const account = accounts.find(
      (one) =>
        one.id === requested.account ||
        one.name.trim().toLowerCase() === requested.account.trim().toLowerCase(),
    )
    const base = {
      requested,
      accountId: account?.id,
      accountName: account?.name ?? requested.account,
      amount: requested.amountMajor === undefined ? undefined : fromMajorUnits(requested.amountMajor, currency),
      date: requested.date,
    }
    if (account === undefined) return { ...base, note: `no account called "${requested.account}"` }
    if (account.kind === 'CREDIT_CARD') {
      return {
        ...base,
        note: 'a card has no balance the statements carry; an opening balance is for a bank account or cash',
      }
    }
    return { ...base, note: undefined }
  })
}

function checkSentence(check: OpeningCheck): string {
  switch (check.kind) {
    case 'ADDS_UP':
      return 'adds up to the last statement'
    case 'OFF':
      return `off by ${formatMoney(check.missing)} against the last statement`
    case 'UNCHECKED':
      return `not checked: ${uncheckedReason(check.reason)}`
  }
}

export const setOpeningBalancesTool: PluginTool = {
  definition: {
    name: 'set_opening_balances',
    title: "Set accounts' opening balances",
    description:
      'Say what each bank or cash account **held before its first statement**, and the day that ' +
      'stands for everything before — **several in one call**. A document cannot read this off a ' +
      'file. The answer shows the check it buys: opening, plus what the statements moved since, ' +
      'has to equal the balance the last statement ended on, and the row says by how much when it ' +
      'does not. `clear: true` forgets one. A credit card has none. **Dry-runs by default**; ' +
      'the document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        accounts: {
          type: 'array',
          description: `One entry per account. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              account: stringProp('The account, by id or by name.'),
              amount: numberProp("What it held, in the document's currency, e.g. 12500.50."),
              date: stringProp(
                'YYYY-MM-DD. The amount stands for everything before this day; statements start on it.',
              ),
              clear: booleanProp('True forgets the opening balance instead.'),
            },
            required: ['account'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'accounts'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readRequests(args)

    const mutation: Mutation<readonly Entry[]> = {
      plan: (document) => plan(document, batch),
      refuses: (entries) => entries.every((entry) => entry.note !== undefined),
      describe: (entries) =>
        paragraphs(
          entries.every((entry) => entry.note !== undefined)
            ? '**Nothing to change.** The reasons are in the table.'
            : `**${plural(entries.filter((entry) => entry.note === undefined).length, 'account')}** would change.`,
          table(
            ['Account', 'Opening balance', 'As of', 'What happens'],
            entries.map((entry) => [
              entry.accountName,
              entry.amount === undefined ? 'forgotten' : formatMoney(entry.amount),
              entry.date === undefined ? '—' : toISODate(entry.date),
              entry.note ?? 'set',
            ]),
          ),
        ),
      apply: (document, entries) => {
        const now = Date.now()
        const done: string[] = []
        for (const entry of entries) {
          if (entry.note !== undefined || entry.accountId === undefined) continue
          setOpeningBalance(
            document.db,
            entry.accountId,
            entry.amount === undefined || entry.date === undefined
              ? undefined
              : { amount: entry.amount, date: entry.date },
            now,
          )
          done.push(entry.accountId)
        }
        const balances = accountBalances(document.db, documentCurrency(document.db)).filter((one) =>
          done.includes(one.accountId),
        )
        const refused = entries.filter((entry) => entry.note !== undefined)
        return paragraphs(
          `Changed ${plural(done.length, 'account')}.`,
          balances.length === 0
            ? undefined
            : table(
                ['Account', 'Opening', 'Moved since', 'Last statement', 'Check'],
                balances.map((one) => [
                  one.name,
                  one.opening === undefined ? '—' : formatMoney(one.opening),
                  formatMoney(one.moved),
                  lastStatement(one),
                  checkSentence(one.check),
                ]),
              ),
          refused.length === 0
            ? undefined
            : `Refused: ${refused.map((entry) => `${entry.accountName} (${entry.note ?? ''})`).join('; ')}.`,
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

/** The balance, the day its statement ends, and — plainly — when a later statement offered none (F24). */
function lastStatement(one: AccountBalance): string {
  if (one.statementBalance === undefined) return '—'
  const dated = one.balanceTo === undefined ? formatMoney(one.statementBalance) : `${formatMoney(one.statementBalance)} (to ${toISODate(one.balanceTo)})`
  const newer = one.newerWithoutBalance
  return newer === undefined
    ? dated
    : `${dated}, older than ${newer.fileName} (to ${toISODate(newer.to)}), which has no balance that adds up`
}
