/**
 * `assign_category` — the first tool that changes rows in a document somebody
 * cares about, and the one all three safeguards were built for.
 *
 * It dry-runs by default, it takes a timestamped copy before it commits, and
 * every row it touches comes out labelled `categorySource = 'AI'` (D-092,
 * D-098). None of those is a nicety: the plugin is what replaced the app's
 * review queue, and a batch that could categorize four hundred merchants needs
 * the size and the target to be visible *before* it happens, recoverable
 * *after* it happens, and identifiable *forever*.
 *
 * **The rule it will not break is the oldest one in the app.** "User overrides
 * win" (docs/conventions.md, D-009): a `MANUAL` assignment is never overwritten
 * by automation, and one instance of that being violated destroys confidence in
 * every other assignment in the document. So this tool touches only rows that
 * are uncategorized or that it assigned itself — and it counts and names what
 * it skipped rather than passing over it quietly, because a batch that silently
 * did less than it said is its own kind of wrong.
 */

import { formatMoney, money as makeMoney, type Money } from '@/core/money.ts'
import {
  UNCATEGORIZED_ID,
  listCategories,
  setCategoryFromAssistant,
} from '@/data/repositories/categoryRepository.ts'
import {
  clearMerchantSuggestions,
  isSuggestionStatus,
  noteMerchantSuggestions,
  type SuggestionInput,
  type SuggestionStatus,
} from '@/data/repositories/merchantSuggestionRepository.ts'
import {
  listTransactions,
  type StoredTransaction,
  type TransactionFilter,
} from '@/data/repositories/transactionRepository.ts'

import { type OpenDocument } from '../document.ts'
import { count, date, paragraphs, plural, table } from '../format.ts'
import { mutatingCall, writeDocument, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  optionalDate,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

/**
 * The ceiling on one batch, in rows across the whole call. Above it, the scope
 * is the thing to fix.
 */
const BATCH_MAX = 2000

/** The ceiling on assignments in one call. Above it, so is the conversation. */
const ASSIGNMENTS_MAX = 200

/** Rows shown in the diff of a single assignment. The counts are over everything. */
const SAMPLE = 15

/**
 * Why a row was left alone.
 *
 * Named rather than counted, because "34 rows were skipped" invites the wrong
 * next question and "34 rows you categorized by hand were skipped" answers it.
 */
type SkipReason = 'MANUAL' | 'RULE' | 'ALREADY'

const SKIP_TEXT: Readonly<Record<SkipReason, string>> = {
  MANUAL: 'categorized by hand — never overwritten by automation',
  RULE: 'assigned by a rule — change the rule rather than the row',
  ALREADY: 'already in this category',
}

/** One assignment as the caller asked for it, before the document is consulted. */
interface Requested {
  readonly categoryId: string
  readonly merchant: string | undefined
  readonly transactionIds: readonly string[] | undefined
  readonly filter: TransactionFilter
  readonly scope: string
}

/** One assignment, resolved against the document. */
interface Entry {
  readonly requested: Requested
  readonly categoryPath: string
  readonly targets: readonly StoredTransaction[]
  readonly skipped: readonly { readonly row: StoredTransaction; readonly why: SkipReason }[]
  readonly total: Money | undefined
  readonly merchants: readonly string[]
}

interface Plan {
  readonly entries: readonly Entry[]
  readonly targetCount: number
  readonly hitCeiling: boolean
}

function filterFor(record: Record<string, unknown>, merchant: string | undefined): TransactionFilter {
  const from = optionalDate(record, 'from')
  const to = optionalDate(record, 'to')
  const accountId = optionalString(record, 'account_id')

  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(accountId === undefined ? {} : { accountId }),
    // The ledger's own search, so "which rows do you mean" has one spelling
    // (D-045). Narrowed to an exact normalized match below, because a rule and
    // a batch must claim the same set of rows rather than nearly the same.
    ...(merchant === undefined ? {} : { search: merchant }),
  }
}

function scopeText(merchant: string | undefined, ids: readonly string[] | undefined, filter: TransactionFilter): string {
  const parts: string[] = [merchant !== undefined ? merchant : `${count(ids?.length ?? 0)} named rows`]
  if (filter.from !== undefined || filter.to !== undefined) {
    parts.push(`${date(filter.from)}…${date(filter.to)}`)
  }
  if (filter.accountId !== undefined) parts.push(`account ${filter.accountId}`)
  return parts.join(', ')
}

/**
 * Read the batch before the document is opened.
 *
 * **This tool takes a list** (D-110), and it did not always: it shipped filing
 * one merchant per call and dry-running by default, so forty merchants meant
 * eighty round trips, each re-sending the whole conversation. The list is the
 * fix, and one list also means **one** preview, **one** yes, and **one** `.bak`
 * for the whole batch rather than forty of each.
 *
 * The flat single-assignment form it used to take is refused with the sentence
 * that rewrites it, rather than quietly accepted beside the list: two ways to
 * say the same thing is a surface nobody can keep honest, and a caller that
 * sent the old shape needs to be told once.
 */
function readBatch(args: Args): readonly Requested[] {
  const raw = args['assignments']
  if (raw === undefined && args['category_id'] !== undefined) {
    throw new ToolInputError(
      'This tool takes a list. Send `assignments: [{ category_id, merchant }]` rather than a ' +
        'bare `category_id` — one call categorizes every merchant you have worked out, with one ' +
        'preview and one confirmation for the whole batch.',
    )
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(
      '`assignments` must be a non-empty array of {category_id, merchant} or ' +
        '{category_id, transaction_ids}.',
    )
  }
  if (raw.length > ASSIGNMENTS_MAX) {
    throw new ToolInputError(
      `That is ${raw.length} assignments; the ceiling is ${ASSIGNMENTS_MAX} in one call.`,
    )
  }

  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`\`assignments[${index}]\` must be an object.`)
    }
    const record = entry as Record<string, unknown>
    const categoryId = requireString(record, 'category_id')
    const merchant = optionalString(record, 'merchant')
    const ids = idsFrom(record, index)

    if (merchant === undefined && ids === undefined) {
      throw new ToolInputError(
        `\`assignments[${index}]\` needs either \`merchant\` (the normalized name exactly as ` +
          '`uncategorized_merchants` printed it) or `transaction_ids`. An assignment with no ' +
          'scope would be every row in the document.',
      )
    }
    if (merchant !== undefined && ids !== undefined) {
      throw new ToolInputError(
        `\`assignments[${index}]\` gives both \`merchant\` and \`transaction_ids\`. Give one: ` +
          'the merchant covers every row of that name in the scope, the ids cover exactly those.',
      )
    }

    const filter = filterFor(record, merchant)
    return {
      categoryId,
      merchant,
      transactionIds: ids,
      filter,
      scope: scopeText(merchant, ids, filter),
    }
  })
}

function idsFrom(record: Record<string, unknown>, index: number): readonly string[] | undefined {
  const raw = record['transaction_ids']
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    throw new ToolInputError(`\`assignments[${index}].transaction_ids\` must be an array of ids.`)
  }
  return raw.map((one, at) => {
    if (typeof one !== 'string' || one.trim() === '') {
      throw new ToolInputError(
        `\`assignments[${index}].transaction_ids[${at}]\` must be a non-empty string.`,
      )
    }
    return one
  })
}

function reasonFor(row: StoredTransaction, categoryId: string): SkipReason | undefined {
  if (row.categorySource === 'MANUAL') return 'MANUAL'
  if (row.categorySource === 'RULE') return 'RULE'
  if (row.categoryId === categoryId) return 'ALREADY'
  return undefined
}

function sumOf(rows: readonly StoredTransaction[]): Money | undefined {
  const currencies = new Set(rows.map((row) => row.amount.currency))
  // Adding agorot to cents needs a rate this document does not have (D-003), so
  // a mixed batch reports no total rather than a wrong one.
  if (currencies.size !== 1) return undefined
  const [currency] = [...currencies]
  if (currency === undefined) return undefined
  return makeMoney(
    rows.reduce((running, row) => running + Math.abs(row.amount.minor), 0),
    currency,
  )
}

/**
 * Resolve the whole batch against the document, and **refuse a row claimed
 * twice**.
 *
 * Two assignments that both claim a row are not a conflict a batch may resolve
 * by order of appearance: whichever one lost would be a category the user was
 * shown in the preview and never got. It is a caller mistake with an obvious
 * fix, so it comes back as one sentence naming the row rather than as a silent
 * last-writer-wins.
 */
function buildPlan(document: OpenDocument, batch: readonly Requested[]): Plan {
  const categories = listCategories(document.db, { includeArchived: true })
  const claims = new Map<string, string>()
  const entries: Entry[] = []
  let targetCount = 0
  let hitCeiling = false

  for (const requested of batch) {
    const category = categories.find((one) => one.id === requested.categoryId)
    if (category === undefined) {
      throw new ToolInputError(
        `No category with id ${requested.categoryId}. Call \`category_tree\` for the ids — a ` +
          'path is not one, and `create_category` makes one the document does not have.',
      )
    }
    if (category.id === UNCATEGORIZED_ID) {
      throw new ToolInputError(
        'Assigning the uncategorized category is not a categorization. To clear a category, do it ' +
          'in the app — that is a correction, and corrections are the user’s to make.',
      )
    }

    const candidates = listTransactions(document.db, requested.filter, BATCH_MAX)
    if (candidates.length === BATCH_MAX) hitCeiling = true

    const scoped =
      requested.transactionIds === undefined
        ? // `search` matches raw, normalized and the provider label, which is
          // right for finding rows and too loose for changing them. The batch is
          // the exact normalized name, which is what a rule would match on too.
          candidates.filter((row) => row.merchantNormalized === requested.merchant)
        : candidates.filter((row) => requested.transactionIds?.includes(row.id) === true)

    const targets: StoredTransaction[] = []
    const skipped: { row: StoredTransaction; why: SkipReason }[] = []

    for (const row of scoped) {
      const why = reasonFor(row, requested.categoryId)
      if (why !== undefined) {
        skipped.push({ row, why })
        continue
      }
      const claimedBy = claims.get(row.id)
      if (claimedBy !== undefined && claimedBy !== category.path) {
        throw new ToolInputError(
          `${row.merchantRaw} (${row.id}) is covered by two assignments — ${claimedBy} and ` +
            `${category.path}. Decide which one it is and send the batch again.`,
        )
      }
      claims.set(row.id, category.path)
      targets.push(row)
    }

    targetCount += targets.length
    entries.push({
      requested,
      categoryPath: category.path,
      targets,
      skipped,
      total: sumOf(targets),
      merchants: [...new Set(targets.map((row) => row.merchantNormalized))],
    })
  }

  return { entries, targetCount, hitCeiling }
}

function skipSummary(entries: readonly Entry[]): string | undefined {
  const byReason = new Map<SkipReason, number>()
  for (const entry of entries) {
    for (const { why } of entry.skipped) byReason.set(why, (byReason.get(why) ?? 0) + 1)
  }
  if (byReason.size === 0) return undefined

  const total = [...byReason.values()].reduce((running, one) => running + one, 0)
  return (
    `Leaving ${plural(total, 'row')} alone: ` +
    [...byReason.entries()].map(([why, n]) => `${count(n)} ${SKIP_TEXT[why]}`).join('; ') +
    '.'
  )
}

function planTable(entries: readonly Entry[]): string {
  return table(
    ['Category', 'Scope', 'Rows', 'Total', 'Left alone'],
    entries.map((entry) => [
      entry.categoryPath,
      entry.requested.scope,
      count(entry.targets.length),
      entry.total === undefined ? '—' : formatMoney(entry.total),
      entry.skipped.length === 0 ? '—' : count(entry.skipped.length),
    ]),
  )
}

/**
 * The rows themselves, but only when there is one assignment to look at.
 *
 * A batch of forty merchants printing fifteen rows each is six hundred rows in
 * a conversation nobody will read, and the per-assignment table above already
 * carries what a reader checks: the category, the scope, the count and the
 * money. One assignment is the case where the rows *are* the question.
 */
function sample(entries: readonly Entry[]): string | undefined {
  const only = entries.length === 1 ? entries[0] : undefined
  if (only === undefined || only.targets.length === 0) return undefined

  return table(
    ['Date', 'Merchant', 'Amount', 'Currently'],
    only.targets
      .slice(0, SAMPLE)
      .map((row) => [
        date(row.chargeDate),
        row.merchantRaw,
        formatMoney(row.amount),
        row.categoryPath ?? 'uncategorized',
      ]),
  )
}

/**
 * The one line a reader takes away, which is a different sentence for one
 * assignment than for forty.
 *
 * A batch says how much money moved and how many categories it landed in; a
 * single assignment says which category, because that is the whole question.
 * The old shape of this tool only had the second sentence, and it is worth
 * keeping — most calls will still be one merchant somebody is checking.
 */
function summaryLine(plan: Plan, done: boolean): string {
  const withRows = plan.entries.filter((entry) => entry.targets.length > 0)
  const only = withRows.length === 1 ? withRows[0] : undefined
  const rows = plural(plan.targetCount, 'transaction')

  if (only !== undefined) {
    const where =
      only.merchants.length === 1
        ? `, all at ${only.merchants[0] ?? ''}`
        : ` across ${plural(only.merchants.length, 'merchant')}`
    return done
      ? `Assigned **${only.categoryPath}** to ${rows}` +
          (only.total === undefined ? '' : `, ${formatMoney(only.total)} in total`) +
          '.'
      : `**${rows} → ${only.categoryPath}**` +
          (only.total === undefined ? '' : `, ${formatMoney(only.total)} in total`) +
          where +
          '.'
  }

  const total = sumOf(plan.entries.flatMap((entry) => [...entry.targets]))
  const categories = plural(withRows.length, 'category', 'categories')
  return done
    ? `Assigned ${rows} across ${categories}` +
        (total === undefined ? '' : `, ${formatMoney(total)} in total`) +
        '.'
    : `**${rows} → ${categories}**` +
        (total === undefined ? '' : `, ${formatMoney(total)} in total`) +
        '.'
}

function describePlan(plan: Plan): string {
  if (plan.targetCount === 0) {
    return paragraphs(
      'Nothing to change: no row in this batch can take the category asked for.',
      planTable(plan.entries),
      skipSummary(plan.entries),
    )
  }

  const withRows = plan.entries.filter((entry) => entry.targets.length > 0)
  const only = withRows.length === 1 ? withRows[0] : undefined

  return paragraphs(
    summaryLine(plan, false),
    planTable(plan.entries),
    skipSummary(plan.entries),
    sample(plan.entries),
    only !== undefined && only.targets.length > SAMPLE
      ? `Showing ${count(SAMPLE)} of ${count(only.targets.length)}; the counts above are over all ` +
        'of them.'
      : undefined,
    plan.hitCeiling
      ? `An assignment hit the ceiling of ${count(BATCH_MAX)} rows. Narrow the dates or the ` +
        'account rather than committing a batch nobody can check.'
      : undefined,
  )
}

function applyPlan(document: OpenDocument, plan: Plan): string {
  const now = Date.now()
  const merchants = new Set<string>()

  for (const entry of plan.entries) {
    for (const row of entry.targets) {
      setCategoryFromAssistant(document.db, row.id, entry.requested.categoryId, now)
    }
    for (const merchant of entry.merchants) merchants.add(merchant)
  }

  // The question about these merchants has been answered, so the note that
  // existed to stop it being asked again has done its job. A memo left beside a
  // categorized merchant says a decision is still open when it is not.
  clearMerchantSuggestions(document.db, [...merchants], now)

  return paragraphs(
    summaryLine(plan, true),
    planTable(plan.entries),
    skipSummary(plan.entries),
    'Every row is marked `AI`, so the whole batch is findable afterwards — `transactions` with ' +
      'one of these categories shows the source of each one. Nothing categorized by hand was ' +
      'touched.',
  )
}

export const assignCategoryTool: PluginTool = {
  definition: {
    name: 'assign_category',
    title: 'Assign categories to transactions',
    description:
      'Categorize the transactions with no category — **many merchants in one call**. Send every ' +
      'merchant-to-category decision you have worked out as one `assignments` list rather than ' +
      'calling this once per merchant. **Dry-runs by default**: it returns what the whole batch ' +
      'would change and writes nothing until you call it again with commit true, so show the ' +
      'user the table and let them answer once. Rows categorized by hand are never touched, rows ' +
      'assigned by a rule are left to the rule, and every row it does change is marked AI so the ' +
      'batch stays findable. The document is copied to a timestamped .bak before anything is ' +
      'written. A row covered by two assignments refuses the batch rather than picking one.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        assignments: {
          type: 'array',
          description: `One entry per category-and-scope. Up to ${String(ASSIGNMENTS_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              category_id: stringProp('The category to assign. Ids come from `category_tree`.'),
              merchant: stringProp(
                'The normalized merchant name, exactly as `uncategorized_merchants` printed it. ' +
                  'Covers every row of that name within the dates and account given.',
              ),
              transaction_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific transactions, instead of a merchant. Not both.',
              },
              from: stringProp('Narrow to charges on or after this date, as YYYY-MM-DD.'),
              to: stringProp('Narrow to charges on or before this date, as YYYY-MM-DD.'),
              account_id: stringProp('Narrow to one account.'),
            },
            required: ['category_id'],
            additionalProperties: false,
          },
        },
        commit: booleanProp(
          'Default false. False previews the whole batch and writes nothing; true makes it.',
        ),
      },
      required: ['path', 'assignments'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const commit = args['commit'] === true
    const batch = readBatch(args)

    const mutation: Mutation<Plan> = {
      plan: (document) => buildPlan(document, batch),
      describe: describePlan,
      apply: applyPlan,
    }

    return mutatingCall(path, commit, mutation)
  },
}

// --- note_merchant_suggestions ---------------------------------------------

/** One batch of notes. Above this, the conversation is not a conversation. */
const NOTES_MAX = 200

interface NoteBatch {
  readonly inputs: readonly SuggestionInput[]
  readonly unknownCategories: readonly string[]
}

function readNotes(document: OpenDocument, args: Args): NoteBatch {
  const raw = args['suggestions']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`suggestions` must be a non-empty array of notes.')
  }
  if (raw.length > NOTES_MAX) {
    throw new ToolInputError(
      `That is ${raw.length} notes; the ceiling is ${NOTES_MAX} in one call. Send them in batches.`,
    )
  }

  const known = new Set(listCategories(document.db).map((category) => category.id))
  const inputs: SuggestionInput[] = []
  const unknownCategories: string[] = []

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError('Every entry in `suggestions` must be an object.')
    }
    const record = entry as Record<string, unknown>
    const merchant = record['merchant']
    const status = record['status']
    const categoryId = record['category_id']
    const note = record['note']

    if (typeof merchant !== 'string' || merchant === '') {
      throw new ToolInputError('Every note needs a `merchant`, exactly as the backlog printed it.')
    }
    if (typeof status !== 'string' || !isSuggestionStatus(status)) {
      throw new ToolInputError(
        `\`status\` must be SUGGESTED, DECLINED or NO_SUGGESTION; got "${String(status)}" ` +
          `for ${merchant}.`,
      )
    }
    if (status !== 'NO_SUGGESTION' && (typeof categoryId !== 'string' || categoryId === '')) {
      throw new ToolInputError(
        `${merchant} is ${status} but names no category. A suggestion without a category is ` +
          'NO_SUGGESTION — say that instead.',
      )
    }
    // Reported rather than refused: a category deleted between the suggestion
    // and the note is the user's doing, and losing the whole batch over it
    // would cost more than the one line it invalidates.
    if (typeof categoryId === 'string' && categoryId !== '' && !known.has(categoryId)) {
      unknownCategories.push(`${merchant} → ${categoryId}`)
    }

    inputs.push({
      merchantNormalized: merchant,
      ...(typeof categoryId === 'string' && categoryId !== '' ? { categoryId } : {}),
      status: status as SuggestionStatus,
      ...(typeof note === 'string' && note !== '' ? { note } : {}),
    })
  }

  return { inputs, unknownCategories }
}

function describeNotes(batch: NoteBatch, written: number): string {
  const byStatus = new Map<SuggestionStatus, number>()
  for (const input of batch.inputs) {
    byStatus.set(input.status, (byStatus.get(input.status) ?? 0) + 1)
  }

  return paragraphs(
    `Noted ${count(written)} merchants: ` +
      [...byStatus.entries()].map(([status, n]) => `${count(n)} ${status}`).join(', ') +
      '.',
    batch.unknownCategories.length === 0
      ? undefined
      : `Written, but naming a category this document does not have: ` +
        `${batch.unknownCategories.join('; ')}. Those read back as “a category since deleted”.`,
    'These show in the `Asked about` column of `uncategorized_merchants`, and are cleared the ' +
      'moment the merchant is actually categorized. They change no transaction and no category.',
  )
}

/**
 * The memo that stops the same merchant being asked about twice.
 *
 * **It writes immediately — no dry run and no `.bak`** — and that is a
 * deliberate exception rather than an oversight. Those two safeguards exist for
 * batches that move money rows (D-098): they make the *size and target*
 * visible before the fact and recoverable after it. This tool touches one
 * `app_setting` key, changes no transaction, no category and no rule, and can
 * overwrite nothing except a note it wrote itself. Making it dry-run first
 * would mean two round trips to record "the user could not identify these
 * ten", and a safeguard that costs more than what it protects is a safeguard
 * people route around. It is the same weighing D-097 made for onboarding's
 * writes.
 */
export const noteMerchantSuggestionsTool: PluginTool = {
  definition: {
    name: 'note_merchant_suggestions',
    title: 'Note what was suggested about merchants',
    description:
      'Remember what this conversation suggested for merchants that were **not** categorized — ' +
      'a category the user declined, or a name nobody could identify — so the next ' +
      'conversation does not ask about the same names again. Shown in the Asked about column ' +
      'of uncategorized_merchants, cleared automatically when a merchant is categorized. ' +
      'Writes immediately: it changes no transaction, no category and no rule.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        suggestions: {
          type: 'array',
          description: 'One entry per merchant. Up to ' + String(NOTES_MAX) + ' in a call.',
          items: {
            type: 'object',
            properties: {
              merchant: stringProp(
                'The normalized merchant name, exactly as `uncategorized_merchants` printed it.',
              ),
              status: stringProp(
                'SUGGESTED (offered, not yet acted on), DECLINED (offered and refused — do not ' +
                  'offer that category again), or NO_SUGGESTION (looked at, nothing to say).',
              ),
              category_id: stringProp(
                'The category the note is about. Required unless the status is NO_SUGGESTION.',
              ),
              note: stringProp('One line of why, in your own words. Shown to the next reader.'),
            },
            required: ['merchant', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['path', 'suggestions'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')

    return writeDocument(path, (document) => {
      const batch = readNotes(document, args)
      const written = noteMerchantSuggestions(document.db, batch.inputs, Date.now())
      return describeNotes(batch, written.length)
    })
  },
}
