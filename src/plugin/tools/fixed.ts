/**
 * The detector, reachable from a conversation — `fixed_expense_candidates`,
 * `track_fixed_expenses` and `dismiss_fixed_expense_candidates` (D-111).
 *
 * F09's detector has existed since M4 and the plugin could not see it: the
 * `fixed_expenses` tool lists what somebody has already confirmed, which is the
 * *answer* to a question the conversation had no way to ask. Everything here is
 * a wrapper — `detectFixedExpenses` over `listExpenseObservations`, then
 * `confirmCandidate` — so the candidates a conversation reads and the ones the
 * app's screen shows are the same arithmetic rather than two opinions.
 *
 * **A candidate is not a fixed expense** (docs/f09, `domain/model/fixed.ts`).
 * It is regenerated from the ledger on every call and never stored, which is
 * why it has no id and why every tool here names a *merchant* instead: the
 * merchant is the thing that persists, and an id for a row that does not exist
 * would be a promise this surface could not keep between two calls.
 *
 * **Two verbs, deliberately, and the reason is the safety shape rather than the
 * vocabulary.** Confirming writes a standing commitment that changes every plan
 * the splitter produces afterwards, so it dry-runs and takes a `.bak` like
 * every other row-writing tool. Saying no writes one `app_setting` key, touches
 * no row, and is undone by its own `restore` argument — so it writes
 * immediately, exactly as `note_merchant_suggestions` does. One tool carrying
 * both answers would have to impose one of those shapes on the write that
 * deserves the other.
 */

import { formatMoney, fromMajorUnits, type Money } from '@/core/money.ts'
import {
  addMonths,
  monthEnd,
  monthStart,
  toYearMonthString,
  yearMonthOf,
  type YearMonth,
} from '@/core/time.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import {
  clearDismissal,
  confirmCandidate,
  createFixedExpense,
  dismissMerchant,
  dismissedMerchants,
  listExpenseObservations,
  listFixedExpenses,
  readDismissals,
  trackedMerchants,
  type NewFixedExpense,
} from '@/data/repositories/fixedExpenseRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import {
  DEFAULT_WINDOW_MONTHS,
  detectFixedExpenses,
  monthlyShare,
} from '@/domain/fixedExpenses.ts'
import { CADENCES, type Cadence, type FixedExpenseCandidate } from '@/domain/model/fixed.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { count, date, instant, money, paragraphs, percent, plural, table } from '../format.ts'
import { today } from '../today.ts'
import { mutatingCall, writeDocument, type Mutation } from '../write.ts'
import { categoryPaths } from './ledger.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalBoolean,
  optionalNumber,
  optionalPeriod,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

/**
 * The lookback ceiling.
 *
 * Two is the floor the domain enforces — one month is a purchase, not a
 * pattern — and two years is as far back as a candidate says anything useful
 * about what the user is committed to *now*.
 */
const MIN_WINDOW = 2
const MAX_WINDOW = 24

/** One batch of answers. Beyond this, the window is the thing to narrow. */
const BATCH_MAX = 100

interface Window {
  readonly endingAt: YearMonth
  readonly months: number
}

function windowFrom(args: Args): Window {
  const endingAt = optionalPeriod(args, 'ending_at') ?? yearMonthOf(today())
  const months = optionalNumber(args, 'window_months') ?? DEFAULT_WINDOW_MONTHS

  if (months < MIN_WINDOW || months > MAX_WINDOW) {
    throw new ToolInputError(
      `\`window_months\` must be between ${MIN_WINDOW} and ${MAX_WINDOW}; got ${months}. ` +
        'Three is the default and the least that can tell recurring from coincidental; a yearly ' +
        'premium needs twelve, because a window structurally cannot see a cadence longer than ' +
        'itself.',
    )
  }
  return { endingAt, months: Math.trunc(months) }
}

/**
 * Run the detector, exactly as the screen runs it.
 *
 * Same window arithmetic, same two exclusion lists. A candidate that shows up
 * here and not on the screen would be a bug nobody could explain, so there is
 * one call and both front ends make it.
 */
function detect(document: OpenDocument, window: Window): readonly FixedExpenseCandidate[] {
  const from = monthStart(addMonths(window.endingAt, -(window.months - 1)))
  const to = monthEnd(window.endingAt)

  return detectFixedExpenses(listExpenseObservations(document.db, from, to), {
    endingAt: window.endingAt,
    windowMonths: window.months,
    dismissed: dismissedMerchants(document.db),
    alreadyTracked: trackedMerchants(document.db),
  })
}

// --- fixed_expense_candidates ----------------------------------------------

/**
 * The amortized monthly figure, through the app's own function.
 *
 * `monthlyShare` takes a whole `FixedExpense` and reads two fields of it. The
 * shell around those two is filled in here rather than the arithmetic being
 * copied, because a second implementation of "a yearly premium is a twelfth of
 * itself, rounded" is a second thing that can disagree with the screen.
 */
function perMonthOf(amount: Money, cadence: Cadence): Money {
  return monthlyShare({
    id: '',
    name: '',
    categoryId: undefined,
    matchKind: 'MANUAL_ONLY',
    matchRef: undefined,
    expectedAmount: amount,
    amountVariability: 'FIXED',
    cadence,
    dayOfMonthHint: undefined,
    isDiscretionary: false,
    source: 'USER_DEFINED',
    isActive: true,
    startedAt: undefined,
    endedAt: undefined,
  })
}

/**
 * What confirming one would produce, said in the answer rather than discovered
 * afterwards.
 *
 * `medianAmount` is the whole charge and the share beside it is that charge
 * amortized — the same pair `fixed_expenses` prints — because a yearly premium
 * printed beside eleven monthly ones is a number that invites the wrong sum.
 */
function candidateRow(
  candidate: FixedExpenseCandidate,
  paths: ReadonlyMap<string, string>,
): readonly string[] {
  const perMonth = perMonthOf(candidate.medianAmount, candidate.suggestedCadence)

  return [
    candidate.merchantNormalized,
    candidate.merchantRaw === '' ? '—' : candidate.merchantRaw,
    formatMoney(candidate.medianAmount),
    formatMoney(perMonth),
    candidate.suggestedCadence,
    candidate.confidence,
    `${count(candidate.occurrences)} months`,
    candidate.amountVariability === 'FIXED'
      ? 'fixed'
      : `varies ${percent(candidate.amountSpreadBasisPoints)}`,
    candidate.dayOfMonthSpread <= 3 ? `~${String(candidate.dayOfMonthHint)}` : 'moves',
    candidate.categoryId === undefined ? '—' : (paths.get(candidate.categoryId) ?? '—'),
    date(candidate.lastSeen),
  ]
}

function renderCandidates(document: OpenDocument, args: Args): string {
  const window = windowFrom(args)
  const candidates = detect(document, window)
  const paths = categoryPaths(document)
  const dismissals = readDismissals(document.db)
  const tracked = trackedMerchants(document.db)
  const showDismissed = optionalBoolean(args, 'include_dismissed') === true

  const window_ = `${count(window.months)} months ending ${toYearMonthString(window.endingAt)}`

  if (candidates.length === 0) {
    return paragraphs(
      `No candidates over the ${window_}.`,
      tracked.length === 0 && dismissals.size === 0
        ? 'Either nothing recurs in the ledger for that window, or nothing has been imported yet. ' +
          'A longer `window_months` sees longer cadences — twelve is what a yearly premium needs.'
        : `${plural(tracked.length, 'merchant')} are already tracked and ` +
          `${plural(dismissals.size, 'merchant')} were dismissed; both are excluded by ` +
          'construction, so an empty list here can mean the work is done.',
    )
  }

  return paragraphs(
    `**${plural(candidates.length, 'candidate')}** over the ${window_}, most convincing first.`,
    table(
      [
        'Merchant',
        'As written',
        'Charge',
        'Per month',
        'Cadence',
        'Confidence',
        'Seen',
        'Amount',
        'Day',
        'Usually categorized under',
        'Last seen',
      ],
      candidates.map((candidate) => candidateRow(candidate, paths)),
    ),
    'Charge is the whole recurring amount and Per month is it amortized — only the second is safe ' +
      'to add across rows. `VARIABLE` is a label on a real recurring bill, not a doubt about it: ' +
      'an electricity bill that swings between seasons is still a bill.',
    'Quote **Merchant** back exactly to `track_fixed_expenses` to confirm one, or to ' +
      '`dismiss_fixed_expense_candidates` to say no. Confirming takes the charge, the cadence and ' +
      'the category shown here unless you override them.',
    tracked.length === 0
      ? undefined
      : `Excluded because they are already tracked: ${tracked.join(', ')}. \`fixed_expenses\` ` +
        'lists those with what they are costing.',
    dismissals.size === 0
      ? undefined
      : showDismissed
        ? table(
            ['Dismissed merchant', 'When'],
            [...dismissals.entries()].map(([merchant, at]) => [merchant, instant(at)]),
          )
        : `${plural(dismissals.size, 'merchant')} were dismissed and are excluded. Pass ` +
          '`include_dismissed` to see them; `dismiss_fixed_expense_candidates` with `restore` ' +
          'brings one back.',
    window.months < 12
      ? 'This window cannot see a cadence longer than itself, so a yearly premium is invisible ' +
        'at twelve months of history or less. Ask for `window_months: 12` before concluding ' +
        'there is nothing annual.'
      : undefined,
  )
}

export const fixedExpenseCandidatesTool: PluginTool = {
  definition: {
    name: 'fixed_expense_candidates',
    title: 'Recurring charges the ledger suggests',
    description:
      'What looks like a recurring bill in the imported transactions but has not been confirmed ' +
      'as one: the merchant, the typical charge and its amortized monthly share, the cadence, ' +
      'how many months it was seen in, how much the amount and the day move, and how confident ' +
      'the detector is. Merchants already tracked or previously dismissed are excluded. This is ' +
      'the question `fixed_expenses` answers the other half of — that one lists what is already ' +
      'committed. Reads the document; changes nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        window_months: numberProp(
          `How many months of history to look at, ${MIN_WINDOW}–${MAX_WINDOW}. Default ` +
            `${DEFAULT_WINDOW_MONTHS}. A window cannot see a cadence longer than itself: use 12 ` +
            'to find yearly charges.',
        ),
        ending_at: stringProp('The newest month of the window, as YYYY-MM. Default this month.'),
        include_dismissed: booleanProp('Also list the merchants that were said no to.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderCandidates(document, args)),
}

// --- track_fixed_expenses --------------------------------------------------

/** One answer, as the caller gave it. */
interface Requested {
  readonly merchant: string | undefined
  readonly name: string | undefined
  readonly amountMajor: number | undefined
  readonly cadence: Cadence | undefined
  readonly categoryId: string | undefined
  readonly isDiscretionary: boolean | undefined
}

/** One answer, resolved against the document. */
interface Entry {
  readonly requested: Requested
  readonly kind: 'CONFIRM' | 'MERCHANT_UNSEEN' | 'MANUAL' | 'REFUSED'
  readonly name: string
  readonly amount: Money | undefined
  readonly cadence: Cadence
  readonly categoryPath: string
  readonly matchKind: string
  readonly note: string | undefined
  readonly candidate: FixedExpenseCandidate | undefined
  readonly replaces: boolean
}

interface Plan {
  readonly entries: readonly Entry[]
  readonly window: Window
}

function readBatch(args: Args): readonly Requested[] {
  const raw = args['expenses']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(
      '`expenses` must be a non-empty array. Each entry either names a `merchant` from ' +
        '`fixed_expense_candidates`, or gives a `name` and an `expected_amount` for a bill the ' +
        'ledger has never seen.',
    )
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} entries; the ceiling is ${BATCH_MAX}.`)
  }

  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`\`expenses[${index}]\` must be an object.`)
    }
    const record = entry as Record<string, unknown>
    const merchant = optionalString(record, 'merchant')
    const name = optionalString(record, 'name')
    const amountMajor = optionalNumber(record, 'expected_amount')
    const rawCadence = optionalString(record, 'cadence')?.toUpperCase()

    if (merchant === undefined && name === undefined) {
      throw new ToolInputError(
        `\`expenses[${index}]\` needs a \`merchant\` from \`fixed_expense_candidates\`, or a ` +
          '`name` for a bill the ledger cannot see.',
      )
    }
    if (merchant === undefined && amountMajor === undefined) {
      throw new ToolInputError(
        `\`expenses[${index}]\` names "${name ?? ''}" with no \`expected_amount\`. A bill the ` +
          'ledger has never seen has no amount to infer from, so the user has to say it.',
      )
    }
    if (rawCadence !== undefined && !CADENCES.includes(rawCadence as Cadence)) {
      throw new ToolInputError(
        `\`expenses[${index}].cadence\` must be one of ${CADENCES.join(', ')}.`,
      )
    }
    if (amountMajor !== undefined && amountMajor <= 0) {
      throw new ToolInputError(
        `\`expenses[${index}].expected_amount\` must be positive. It is the size of the charge, ` +
          'and the direction is already known — this is an expense.',
      )
    }

    return {
      merchant,
      name,
      amountMajor,
      cadence: rawCadence as Cadence | undefined,
      categoryId: optionalString(record, 'category_id'),
      isDiscretionary: optionalBoolean(record, 'is_discretionary'),
    }
  })
}

/**
 * Work out what each answer would do, against a freshly detected list.
 *
 * The candidates are regenerated here rather than carried over from whatever
 * `fixed_expense_candidates` printed, for the reason `mutatingCall` recomputes
 * every plan: a document that moved between the two calls should get an honest
 * answer, not a stale one applied blind. A merchant that has stopped being a
 * candidate — imported since, dismissed since, already tracked since — is
 * reported rather than silently confirmed from a memory of it.
 */
function buildPlan(document: OpenDocument, batch: readonly Requested[], args: Args): Plan {
  const window = windowFrom(args)
  const candidates = detect(document, window)
  const paths = categoryPaths(document)
  const known = new Set(listCategories(document.db, { includeArchived: true }).map((one) => one.id))
  const tracked = new Set(trackedMerchants(document.db))
  const currency = documentCurrency(document.db)
  const existing = listFixedExpenses(document.db)

  return {
    window,
    entries: batch.map((requested) => {
      if (requested.categoryId !== undefined && !known.has(requested.categoryId)) {
        return refused(
          requested,
          `no category with id ${requested.categoryId} — \`category_tree\` has the ids`,
        )
      }

      const candidate =
        requested.merchant === undefined
          ? undefined
          : candidates.find((one) => one.merchantNormalized === requested.merchant)

      const amount =
        requested.amountMajor === undefined
          ? candidate?.medianAmount
          : fromMajorUnits(requested.amountMajor, candidate?.currency ?? currency)

      if (requested.merchant !== undefined && candidate === undefined) {
        // Two very different reasons, and the user can act on exactly one of them.
        if (tracked.has(requested.merchant)) {
          return refused(
            requested,
            `${requested.merchant} is already tracked — \`fixed_expenses\` lists it. Change it in ` +
              'the app rather than confirming it twice',
          )
        }
        if (amount === undefined) {
          return refused(
            requested,
            `${requested.merchant} is not a candidate in this window. It may have been dismissed, ` +
              'or seen in too few months. Give an `expected_amount` to track it anyway, or widen ' +
              '`window_months`',
          )
        }
      }

      const name =
        requested.name ??
        (candidate === undefined
          ? (requested.merchant ?? '')
          : candidate.merchantRaw === ''
            ? candidate.merchantNormalized
            : candidate.merchantRaw)

      const categoryId = requested.categoryId ?? candidate?.categoryId
      const cadence = requested.cadence ?? candidate?.suggestedCadence ?? 'MONTHLY'
      const replaces = existing.some(
        (one) => one.matchKind === 'MERCHANT_PATTERN' && one.matchRef === requested.merchant,
      )

      return {
        requested,
        kind:
          candidate !== undefined
            ? ('CONFIRM' as const)
            : requested.merchant !== undefined
              ? ('MERCHANT_UNSEEN' as const)
              : ('MANUAL' as const),
        name,
        amount,
        cadence,
        categoryPath: categoryId === undefined ? '—' : (paths.get(categoryId) ?? categoryId),
        // A commitment with no merchant to recognize it by is `MANUAL_ONLY`,
        // which is a real answer rather than a fallback (docs/f09): an annual
        // premium the app has never seen a charge for is still a number the
        // user plans against.
        matchKind: requested.merchant === undefined ? 'MANUAL_ONLY' : 'MERCHANT_PATTERN',
        note: undefined,
        candidate,
        replaces,
      }
    }),
  }
}

function refused(requested: Requested, why: string): Entry {
  return {
    requested,
    kind: 'REFUSED',
    name: requested.name ?? requested.merchant ?? '',
    amount: undefined,
    cadence: 'MONTHLY',
    categoryPath: '—',
    matchKind: '—',
    note: why,
    candidate: undefined,
    replaces: false,
  }
}

const KIND_TEXT: Readonly<Record<Entry['kind'], string>> = {
  CONFIRM: 'confirm the detected candidate',
  MERCHANT_UNSEEN: 'track this merchant, on your figures rather than the detector’s',
  MANUAL: 'a bill the ledger cannot see — matched by nothing, planned for anyway',
  REFUSED: 'nothing',
}

function planTable(plan: Plan): string {
  return table(
    ['Name', 'Charge', 'Per month', 'Cadence', 'Category', 'Matched by', 'What happens'],
    plan.entries.map((entry) => [
      entry.name,
      money(entry.amount),
      entry.amount === undefined ? '—' : formatMoney(perMonthOf(entry.amount, entry.cadence)),
      entry.cadence,
      entry.categoryPath,
      entry.matchKind,
      entry.note ??
        (entry.replaces ? `${KIND_TEXT[entry.kind]} (updates the row already covering it)` : KIND_TEXT[entry.kind]),
    ]),
  )
}

function describePlan(plan: Plan): string {
  const doing = plan.entries.filter((entry) => entry.kind !== 'REFUSED')
  const refusals = plan.entries.length - doing.length

  return paragraphs(
    doing.length === 0
      ? '**Nothing to track.** Every entry was refused; the reasons are in the table.'
      : `**${plural(doing.length, 'bill')}** would be tracked` +
        (refusals === 0 ? '' : `, and ${plural(refusals, 'entry', 'entries')} refused`) +
        '.',
    planTable(plan),
    doing.length === 0
      ? undefined
      : 'A bill is **money that leaves every month whatever you do**: it is what the paycheck splitter subtracts ' +
        'before planning anything else, and what the monthly variance is measured against. ' +
        'Fixed and cuttable are different axes — pass `is_discretionary` for a gym membership, ' +
        'not for rent.',
  )
}

function applyPlan(document: OpenDocument, plan: Plan): string {
  const now = Date.now()
  const done: string[][] = []

  for (const entry of plan.entries) {
    if (entry.kind === 'REFUSED' || entry.amount === undefined) continue

    const overrides: Partial<NewFixedExpense> = {
      name: entry.name,
      cadence: entry.cadence,
      expectedAmount: entry.amount,
      ...(entry.requested.categoryId === undefined ? {} : { categoryId: entry.requested.categoryId }),
      ...(entry.requested.isDiscretionary === undefined
        ? {}
        : { isDiscretionary: entry.requested.isDiscretionary }),
    }

    if (entry.candidate !== undefined) {
      // Idempotent by construction: confirming the same merchant twice updates
      // the row that already covers it rather than adding a second one.
      const saved = confirmCandidate(document.db, entry.candidate, overrides, now)
      done.push([saved.name, money(saved.expectedAmount), saved.cadence, 'confirmed from the ledger'])
      continue
    }

    const created = createFixedExpense(
      document.db,
      {
        name: entry.name,
        matchKind: entry.matchKind === 'MANUAL_ONLY' ? 'MANUAL_ONLY' : 'MERCHANT_PATTERN',
        ...(entry.requested.merchant === undefined ? {} : { matchRef: entry.requested.merchant }),
        expectedAmount: entry.amount,
        cadence: entry.cadence,
        source: 'USER_DEFINED',
        ...(entry.requested.categoryId === undefined
          ? {}
          : { categoryId: entry.requested.categoryId }),
        ...(entry.requested.isDiscretionary === undefined
          ? {}
          : { isDiscretionary: entry.requested.isDiscretionary }),
      },
      now,
    )
    done.push([
      created.name,
      money(created.expectedAmount),
      created.cadence,
      entry.matchKind === 'MANUAL_ONLY' ? 'created, matched by nothing' : 'created, matched by merchant',
    ])
  }

  const refusals = plan.entries.filter((entry) => entry.kind === 'REFUSED')

  return paragraphs(
    `Tracking ${plural(done.length, 'bill')}.`,
    done.length === 0 ? undefined : table(['Name', 'Charge', 'Cadence', 'How'], done),
    refusals.length === 0
      ? undefined
      : `Refused: ${refusals.map((entry) => `${entry.name} — ${entry.note ?? ''}`).join('; ')}.`,
    '`fixed_expenses` lists them all with what each costs a month. Ending one, and every other ' +
      'edit, is app-only.',
  )
}

export const trackFixedExpensesTool: PluginTool = {
  definition: {
    name: 'track_fixed_expenses',
    title: 'Track recurring charges as bills',
    description:
      'Turn recurring charges into tracked bills — **several in one call**. An entry ' +
      'either names a `merchant` from fixed_expense_candidates, in which case the charge, ' +
      'cadence and category come from the detector unless overridden, or gives a `name` and an ' +
      '`expected_amount` for a bill the ledger cannot see, like an annual premium paid by ' +
      'standing order elsewhere. **Dry-runs by default**: it returns what it would track and ' +
      'writes nothing until called again with commit true. Confirming the same merchant twice ' +
      'updates the row already covering it rather than adding a second. The document is copied ' +
      'to a timestamped .bak before anything is written.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        expenses: {
          type: 'array',
          description: `One entry per bill. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              merchant: stringProp(
                'The normalized merchant, exactly as `fixed_expense_candidates` printed it.',
              ),
              name: stringProp(
                'What to call it. Defaults to the merchant as written. Required when there is no ' +
                  'merchant.',
              ),
              expected_amount: numberProp(
                'The whole recurring charge in major units, positive — a yearly premium is the ' +
                  'year’s figure, not a twelfth of it. Defaults to the detector’s median.',
              ),
              cadence: stringProp(
                `One of ${CADENCES.join(', ')}. Defaults to what the detector inferred.`,
              ),
              category_id: stringProp(
                'Overrides the category most of its rows are already in. Ids from `category_tree`.',
              ),
              is_discretionary: booleanProp(
                'True for a bill that could be cut — a subscription, not rent. Fixed and ' +
                  'cuttable are different axes.',
              ),
            },
            required: [],
            additionalProperties: false,
          },
        },
        window_months: numberProp(
          'The lookback used to re-find the candidates, matching the one you listed them with. ' +
            `Default ${DEFAULT_WINDOW_MONTHS}.`,
        ),
        ending_at: stringProp('The newest month of that window, as YYYY-MM. Default this month.'),
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'expenses'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const commit = args['commit'] === true
    const batch = readBatch(args)

    const mutation: Mutation<Plan> = {
      plan: (document) => buildPlan(document, batch, args),
      describe: describePlan,
      apply: applyPlan,
    }

    return mutatingCall(path, commit, mutation)
  },
}

// --- dismiss_fixed_expense_candidates --------------------------------------

/**
 * Saying no, and taking it back.
 *
 * **Writes immediately — no dry run and no `.bak`** — and for the reason
 * `note_merchant_suggestions` gives rather than because it is small: it touches
 * one `app_setting` key, changes no transaction, no category and no fixed
 * expense, and its own `restore` undoes it exactly. A safeguard that costs two
 * round trips to record "not that one" is a safeguard people route around.
 *
 * A dismissal is respected **permanently until cleared** (docs/f09). That is
 * what makes it worth writing down rather than leaving to the conversation: the
 * next conversation has no memory of this one, and a detector that offers the
 * same eight names every month is one nobody reads by March.
 */
export const dismissFixedExpenseCandidatesTool: PluginTool = {
  definition: {
    name: 'dismiss_fixed_expense_candidates',
    title: 'Say no to suggested recurring charges',
    description:
      'Record that these merchants are not recurring bills, so the detector stops offering them ' +
      '— to this conversation and to every later one. A dismissal lasts until it is cleared; ' +
      'pass restore to clear it and let the merchant be suggested again. Writes immediately: it ' +
      'changes no transaction, no category and no bill.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        merchants: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Normalized merchant names, exactly as `fixed_expense_candidates` printed them.',
        },
        restore: booleanProp(
          'Default false. True clears these dismissals instead of making them.',
        ),
      },
      required: ['path', 'merchants'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const raw = args['merchants']
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ToolInputError('`merchants` must be a non-empty array of normalized names.')
    }
    const merchants = raw.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    if (merchants.length === 0) {
      throw new ToolInputError('`merchants` held no usable names.')
    }
    const restore = optionalBoolean(args, 'restore') === true

    return writeDocument(path, (document) => {
      const now = Date.now()
      const before = readDismissals(document.db)
      const changed: string[] = []
      const already: string[] = []

      for (const merchant of merchants) {
        if (restore) {
          if (!before.has(merchant)) {
            already.push(merchant)
            continue
          }
          clearDismissal(document.db, merchant, now)
        } else {
          if (before.has(merchant)) {
            already.push(merchant)
            continue
          }
          dismissMerchant(document.db, merchant, now)
        }
        changed.push(merchant)
      }

      return paragraphs(
        changed.length === 0
          ? `Nothing changed.`
          : restore
            ? `Cleared ${plural(changed.length, 'dismissal')}: ${changed.join(', ')}. They can be ` +
              'suggested again.'
            : `Dismissed ${plural(changed.length, 'merchant')}: ${changed.join(', ')}. The ` +
              'detector will not offer them again until this is cleared.',
        already.length === 0
          ? undefined
          : restore
            ? `Not dismissed in the first place, so nothing to clear: ${already.join(', ')}.`
            : `Already dismissed: ${already.join(', ')}.`,
        'Nothing was deleted and no transaction was touched. A dismissal is a note about what to ' +
          'stop suggesting.',
      )
    })
  },
}
