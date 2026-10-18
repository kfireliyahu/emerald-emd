/**
 * The three tools that read the ledger and its taxonomy: `category_tree`,
 * `uncategorized_merchants` and `transactions`.
 *
 * They share a file because they share a vocabulary. A scope in this plugin is
 * a `TransactionFilter` — the ledger's own filter shape, the one re-apply also
 * scopes with (D-045) — so "which rows do you mean" has exactly one spelling
 * across the app, the plugin, and any rule the conversation goes on to write.
 * Three tools with three slightly different ideas of a date range would be
 * three bugs waiting for somebody to compare their answers.
 */

import {
  UNCATEGORIZED_ID,
  listCategories,
  type Category,
} from '@/data/repositories/categoryRepository.ts'
import { categoryBudgets } from '@/data/repositories/categoryBudgetRepository.ts'
import { readSkipped } from '@/data/repositories/labelingQueueRepository.ts'
import { listMerchantGroups } from '@/data/repositories/merchantGroupRepository.ts'
import {
  merchantSuggestionMap,
  type MerchantSuggestion,
} from '@/data/repositories/merchantSuggestionRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import {
  DEFAULT_SORT,
  listTransactions,
  summarizeTransactions,
  type SortColumn,
  type TransactionFilter,
  type TransactionSort,
} from '@/data/repositories/transactionRepository.ts'
import { groupWeight } from '@/domain/merchantGroups.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { today } from '../today.ts'
import { capNote, count, date, instant, money, paragraphs, table } from '../format.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  limitArg,
  numberProp,
  optionalBoolean,
  optionalDate,
  optionalMoney,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

// --- the shared scope ------------------------------------------------------

/** The filter properties every scoped tool advertises, written once. */
const SCOPE_PROPS: Record<string, unknown> = {
  from: stringProp('Inclusive start of the charge-date range, as YYYY-MM-DD.'),
  to: stringProp('Inclusive end of the charge-date range, as YYYY-MM-DD.'),
  account_id: stringProp('Restrict to one account. Ids come from `accounts` in `document_info`.'),
  search: stringProp(
    'Matched against the merchant as written, the normalized merchant, and the provider label.',
  ),
}

function scopeFrom(args: Args): TransactionFilter {
  const from = optionalDate(args, 'from')
  const to = optionalDate(args, 'to')
  const accountId = optionalString(args, 'account_id')
  const search = optionalString(args, 'search')

  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(search === undefined ? {} : { search }),
  }
}

/**
 * The scope, said back to the caller.
 *
 * An answer that does not restate its own question is how a conversation ends
 * up quoting a figure for the wrong month: the caller asked for July, the
 * argument was dropped as unparseable, and the total looked plausible.
 */
function describeScope(filter: TransactionFilter): string | undefined {
  const parts: string[] = []
  if (filter.from !== undefined || filter.to !== undefined) {
    parts.push(`dates ${date(filter.from)} to ${date(filter.to)}`)
  }
  if (filter.accountId !== undefined) parts.push(`account ${filter.accountId}`)
  if (filter.categoryId !== undefined) parts.push(`category ${filter.categoryId}`)
  if (filter.includeSubcategories === true) parts.push('subcategories included')
  if (filter.uncategorized === true) parts.push('uncategorized only')
  if (filter.search !== undefined) parts.push(`search "${filter.search}"`)
  if (filter.min !== undefined) parts.push(`at least ${money(filter.min)}`)
  if (filter.max !== undefined) parts.push(`at most ${money(filter.max)}`)
  return parts.length === 0 ? undefined : `Scope: ${parts.join(', ')}.`
}

// --- category_tree ---------------------------------------------------------

/**
 * Every category id mapped to the path `category_tree` prints for it.
 *
 * One place, shared with the other tools, so that a category named in a fixed
 * expense and the same category named in the tree are the same string. Archived
 * ones are included: a row can still be filed under a category the user has
 * since put away, and printing its id there would be the one cell nobody could
 * read.
 */
export function categoryPaths(document: OpenDocument): ReadonlyMap<string, string> {
  return new Map(
    listCategories(document.db, { includeArchived: true }).map((category) => [
      category.id,
      category.path,
    ]),
  )
}

const CATEGORY_MAX = 1000

function categoryFlags(category: Category): string {
  const marks: string[] = []
  if (category.isSystem) marks.push('system')
  if (category.isArchived) marks.push('archived')
  return marks.length === 0 ? '—' : marks.join(', ')
}

/**
 * The taxonomy, as the paths a rule and a category assignment both name.
 *
 * `path` rather than `name` is what a conversation should quote back: two
 * categories may share a short name and only one of them is `Insurance → Car`.
 * The id sits beside it because that is what the tier 2 write tools will take —
 * a path is for the human reading the conversation, an id is for the call.
 */
function renderCategoryTree(document: OpenDocument, includeArchived: boolean): string {
  const categories = listCategories(document.db, { includeArchived })
  const shown = categories.slice(0, CATEGORY_MAX)
  const budgets = categoryBudgets(document.db, today(), documentCurrency(document.db))

  return paragraphs(
    capNote(shown.length, categories.length, 'category', CATEGORY_MAX, 'categories') +
      (includeArchived ? ' Archived ones included.' : ' Archived ones excluded.'),
    table(
      ['Path', 'Id', 'Kind', 'Plan bucket', 'Flags'],
      shown.map((category) => [
        category.path,
        category.id,
        category.kind,
        money(budgets.get(category.id)),
        categoryFlags(category),
      ]),
    ),
    `The uncategorized category is \`${UNCATEGORIZED_ID}\`. A category’s Plan bucket is what it gets each month, and ` +
      'counts everything under the category; nothing enforces it. The tree is three levels at most: a ' +
      'top-level category (Living, Income…) is a heading Plan lists its buckets under.',
  )
}

export const categoryTreeTool: PluginTool = {
  definition: {
    name: 'category_tree',
    title: 'Category tree',
    description:
      'The document category taxonomy: every category full path (Living → Utilities → Electricity), its ' +
      'id, its kind and its Plan bucket. Read this before suggesting a ' +
      'category for anything — the ids here are what the write tools take, and two categories ' +
      'may share a short name.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        include_archived: booleanProp('Include archived categories. Default false.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) =>
      renderCategoryTree(document, optionalBoolean(args, 'include_archived') === true),
    ),
}

// --- uncategorized_merchants ----------------------------------------------

const MERCHANTS_DEFAULT = 50
const MERCHANTS_MAX = 500

/**
 * The backlog, grouped by the string a rule actually matches on.
 *
 * Three columns make this worth reading rather than a list of names, and none
 * of them is acted on here — the plugin reports evidence and lets the
 * conversation decide, for the same reason the app screen shows a count instead
 * of pre-selecting anything (D-047):
 *
 * - **Already filed under** — what the user has put *other* rows of this
 *   merchant into. Their own past decision, and the strongest hint there is.
 * - **Provider called it** — the heading the card issuer printed on these very
 *   rows. Not the user's taxonomy, but the only hint that exists for a merchant
 *   nobody has ever filed, and already something a rule can match on (D-080).
 * - **Asked about** — what was suggested for this name before, so a second
 *   conversation does not re-derive it or re-ask a question the user has
 *   already answered with "I don't know".
 * - **Skipped** — a name the user set aside on By merchant. Still uncategorized
 *   and still listed, after every name that is waiting, because the screen has
 *   stopped asking about it and a conversation should not ask first either.
 *
 * **Amounts are ordered by and not printed** (D-120, closing D-114's disclosure
 * item): merchant categorization sends merchant names, the provider's label and
 * the category list, and **not** amounts — and this read used to print an `Outflow` column of real per-merchant
 * spending. The ordering it gave is worth keeping: the largest backlog first is
 * the right first question. Disclosing the figures to get it is not, because the
 * question being answered is *which merchant needs a category*, and no amount
 * helps answer it. So `groupWeight` still sorts on the totals and
 * `include_amounts` is how a conversation that genuinely needs them asks.
 */
function renderUncategorized(document: OpenDocument, args: Args): string {
  const paths = categoryPaths(document)
  const scope = scopeFrom(args)
  const limit = limitArg(args, MERCHANTS_DEFAULT, MERCHANTS_MAX)
  const asked = merchantSuggestionMap(document.db)
  const amounts = optionalBoolean(args, 'include_amounts') === true
  const skipped = readSkipped(document.db)

  const groups = [...listMerchantGroups(document.db, scope)].sort(
    (a, b) =>
      Number(skipped.has(a.merchantNormalized)) - Number(skipped.has(b.merchantNormalized)) ||
      groupWeight(b) - groupWeight(a),
  )
  const shown = groups.slice(0, limit)
  const anySkipped = shown.some((group) => skipped.has(group.merchantNormalized))

  return paragraphs(
    capNote(shown.length, groups.length, 'merchant with uncategorized rows', MERCHANTS_MAX, 'merchants with uncategorized rows'),
    describeScope(scope),
    groups.length === 0
      ? 'Nothing is uncategorized in this scope.'
      : table(
          [
            'Merchant',
            'As written',
            'Rows',
            ...(amounts ? ['Outflow'] : []),
            'Already categorized under',
            'Provider called it',
            'Asked about',
            ...(anySkipped ? ['Skipped'] : []),
          ],
          shown.map((group) => [
            group.merchantNormalized,
            group.merchantRaw === group.merchantNormalized ? '—' : group.merchantRaw,
            count(group.count),
            ...(amounts
              ? [
                  group.totals
                    .map((total) => money({ minor: total.outflowMinor, currency: total.currency }))
                    .join(' + ') || '—',
                ]
              : []),
            group.settled.length === 0
              ? '—'
              : group.settled
                  .map(
                    (tally) =>
                      `${paths.get(tally.categoryId) ?? tally.categoryId} (${count(tally.count)})`,
                  )
                  .join('; '),
            group.providerCategories.length === 0
              ? '—'
              : group.providerCategories
                  .map((tally) => `${tally.value} (${count(tally.count)})`)
                  .join('; '),
            describeSuggestion(asked.get(group.merchantNormalized), paths),
            ...(anySkipped ? [describeSkip(skipped.get(group.merchantNormalized))] : []),
          ]),
        ),
    'Merchant is the normalized name — the string a categorization rule matches on. Quote it ' +
      'back exactly; it has not been reformatted. Already categorized under is what the user has ' +
      'previously chosen for other rows of the same merchant, not a suggestion. Provider ' +
      'called it is the issuer’s own heading on these rows — a hint, and something a rule can ' +
      'match on, never a category in itself.',
    asked.size === 0
      ? undefined
      : 'Asked about is what a previous conversation already suggested for this name. Do not ' +
        'put the same question a second time: a declined category is one the user has ' +
        'rejected, and “nothing to suggest” means the last attempt got nowhere without new ' +
        'information from them. Record new outcomes with `note_merchant_suggestions`.',
    anySkipped
      ? 'Skipped names were set aside by the user on By merchant and are listed last. They ' +
          'are still uncategorized; suggest a category for one only when the user asks.'
      : undefined,
  )
}

function describeSkip(at: number | undefined): string {
  return at === undefined ? '—' : `skipped ${instant(at)}`
}

function describeSuggestion(
  suggestion: MerchantSuggestion | undefined,
  paths: ReadonlyMap<string, string>,
): string {
  if (suggestion === undefined) return '—'

  const category =
    suggestion.categoryId === undefined
      ? undefined
      : (paths.get(suggestion.categoryId) ?? suggestion.categoryId)
  const what =
    suggestion.status === 'NO_SUGGESTION'
      ? 'nothing to suggest'
      : suggestion.status === 'DECLINED'
        ? `declined ${category ?? 'a category since deleted'}`
        : `suggested ${category ?? 'a category since deleted'}`

  return [what, instant(suggestion.at), suggestion.note]
    .filter((part) => part !== undefined)
    .join(' · ')
}

export const uncategorizedMerchantsTool: PluginTool = {
  definition: {
    name: 'uncategorized_merchants',
    title: 'Uncategorized merchants',
    description:
      'The uncategorized backlog, grouped by merchant: how many rows each merchant has, and ' +
      'what the user has already categorized other rows of the same merchant under. Ordered by the ' +
      'largest single-currency outflow, which is not printed. Start a "help me categorize" ' +
      'conversation here.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        ...SCOPE_PROPS,
        limit: numberProp(
          `Merchants to return. Default ${MERCHANTS_DEFAULT}, maximum ${MERCHANTS_MAX}.`,
        ),
        include_amounts: booleanProp(
          'Print what each merchant adds up to. Off by default: the backlog is already ordered ' +
            'by it, and naming a category needs the merchant rather than the sum. Ask for it ' +
            'only when the user wants the spending itself.',
        ),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderUncategorized(document, args)),
}

// --- transactions ----------------------------------------------------------

const TRANSACTIONS_DEFAULT = 50
const TRANSACTIONS_MAX = 500

const SORT_COLUMNS: readonly SortColumn[] = ['DATE', 'CHARGED', 'MERCHANT', 'CATEGORY', 'AMOUNT']

function sortFrom(args: Args): TransactionSort {
  const column = optionalString(args, 'sort')
  const direction = optionalString(args, 'direction')

  if (column !== undefined && !SORT_COLUMNS.includes(column as SortColumn)) {
    throw new ToolInputError(`\`sort\` must be one of ${SORT_COLUMNS.join(', ')}; got "${column}".`)
  }
  if (direction !== undefined && direction !== 'ASC' && direction !== 'DESC') {
    throw new ToolInputError(`\`direction\` must be ASC or DESC; got "${direction}".`)
  }

  return {
    column: (column as SortColumn | undefined) ?? DEFAULT_SORT.column,
    direction: (direction as 'ASC' | 'DESC' | undefined) ?? DEFAULT_SORT.direction,
  }
}

/**
 * A page of rows, and — separately — what the whole filter adds up to.
 *
 * The two come from different calls on purpose. `listTransactions` is capped
 * and `summarizeTransactions` is not, so the total printed under a fifty-row
 * page is the total of every matching row rather than of the page. Summing the
 * page instead would be exactly the quietly wrong answer that pair of functions
 * exists to prevent.
 */
function renderTransactions(document: OpenDocument, args: Args): string {
  const currency = documentCurrency(document.db)
  const categoryId = optionalString(args, 'category_id')
  const uncategorized = optionalBoolean(args, 'uncategorized')
  const includeSubcategories = optionalBoolean(args, 'include_subcategories')
  const min = optionalMoney(args, 'min', currency)
  const max = optionalMoney(args, 'max', currency)

  const filter: TransactionFilter = {
    ...scopeFrom(args),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(uncategorized === undefined ? {} : { uncategorized }),
    ...(includeSubcategories === undefined ? {} : { includeSubcategories }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  }

  const limit = limitArg(args, TRANSACTIONS_DEFAULT, TRANSACTIONS_MAX)
  const rows = listTransactions(document.db, filter, limit, sortFrom(args))
  const summary = summarizeTransactions(document.db, filter)

  const totals = summary.totals
    .map(
      (total) =>
        `${total.currency} out ${money({ minor: total.outflowMinor, currency: total.currency })}` +
        `, in ${money({ minor: total.inflowMinor, currency: total.currency })}`,
    )
    .join(' · ')

  if (summary.count === 0) {
    return paragraphs('No rows match.', describeScope(filter))
  }

  return paragraphs(
    capNote(rows.length, summary.count, 'matching transaction', TRANSACTIONS_MAX),
    describeScope(filter),
    `Totals over **all** matching rows, not just the ones listed — ${totals}.`,
    summary.excluded === 0
      ? undefined
      : `${count(summary.excluded)} matching rows are left out of totals: counted above, ` +
        'not summed.',
    summary.moved === 0
      ? undefined
      : `${count(summary.moved)} matching rows are money moved, not spent (a declared format links them, or ` +
        'their category is on the Money moved tab): counted above, not summed.',
    summary.held === 0
      ? undefined
      : `${count(summary.held)} matching rows name a holding — cash turning into what the account ` +
        'holds, a buy or a sale — and are neither in nor out: counted above, not summed.',
    table(
      ['Id', 'Date', 'Charged', 'Merchant', 'Amount', 'Category', 'Source', 'Account', 'Totals', 'Note'],
      rows.map((row) => [
        row.id,
        date(row.transactionDate),
        date(row.chargeDate),
        row.merchantRaw,
        money(row.amount),
        row.categoryPath ?? '—',
        row.categorySource,
        row.accountId,
        row.isExcludedFromStats ? 'left out' : row.countedOnCard ? 'card payment, counted on the card' : row.holdingId !== undefined ? 'held' : 'counted',
        row.note ?? '',
      ]),
    ),
    'Sorting happens in SQL over the whole filter rather than over the page, so sort: AMOUNT ' +
      'really does give the largest charge. Source is how the category got there: MANUAL, RULE, ' +
      'AI, INHERITED or NONE.',
  )
}

export const transactionsTool: PluginTool = {
  definition: {
    name: 'transactions',
    title: 'Transactions',
    description:
      'A filtered page of the ledger, plus the totals over every matching row — not just the ' +
      'page. Filter by date range, account, category, uncategorized-only, merchant search and ' +
      'amount bounds; sort by date, charge date, merchant, category or amount. Use this to ' +
      'answer "what did I spend at X" and to show the evidence behind any figure.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        ...SCOPE_PROPS,
        category_id: stringProp('Restrict to one category. Ids come from `category_tree`.'),
        uncategorized: booleanProp('Only rows with no category. Overrides `category_id`.'),
        include_subcategories: booleanProp(
          'Read `category_id` as a parent and include its children. Default false, matching the ' +
            'app own picker, where choosing Utilities means Utilities.',
        ),
        min: numberProp(
          'Smallest amount, by magnitude, in major units of the document currency. 200 matches a ' +
            '200 refund as well as a 200 charge.',
        ),
        max: numberProp('Largest amount, by magnitude, in major units of the document currency.'),
        sort: stringProp(`One of ${SORT_COLUMNS.join(', ')}. Default ${DEFAULT_SORT.column}.`),
        direction: stringProp(`ASC or DESC. Default ${DEFAULT_SORT.direction}.`),
        limit: numberProp(
          `Rows to return. Default ${TRANSACTIONS_DEFAULT}, maximum ${TRANSACTIONS_MAX}.`,
        ),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderTransactions(document, args)),
}
