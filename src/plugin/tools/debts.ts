/**
 * F08's writes — `create_debts` and `record_debt_payments` (D-113).
 *
 * The `debts` read lives in `wealth.ts` and stays there; these are the writes it
 * had none of. Wrappers over `debtRepository`, judged by `validateDebt` and
 * `validatePayment`.
 *
 * **A debt has no stored balance** (docs/f08): a principal and a stream of
 * payments, with outstanding derived. So there is nothing here that sets a
 * balance, and the only way one moves is a payment.
 *
 * Two things this deliberately does not do. `CARD_INSTALLMENT_GROUP` tracking is
 * refused, because promoting a group also **confirms the slices already
 * charged** and that is a different act than naming a ref. And nothing here
 * answers the review queue: payments the app discovers at import land
 * unconfirmed, and confirming them is app-only for now.
 */

import { fromMajorUnits, type Money } from '@/core/money.ts'
import { parseISODate, type LocalDate } from '@/core/time.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import {
  addPayment,
  createDebt,
  debtBalances,
  listDebts,
  listPayments,
  type NewDebt,
} from '@/data/repositories/debtRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import {
  draftPrincipalPart,
  paymentWarnings,
  validateDebt,
  validatePayment,
  type DebtBalance,
  type DebtProblem,
  type PaymentProblem,
} from '@/domain/debt.ts'
import {
  AUTO_TRACK_KINDS,
  DEBT_KINDS,
  type AutoTracking,
  type DebtKind,
} from '@/domain/model/debt.ts'

import { type OpenDocument } from '../document.ts'
import { date, money, paragraphs, plural, table, verb } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalNumber,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 60

/** The tracking kinds a conversation has the evidence for (the D-111 line). */
const WRITABLE_TRACKING: readonly string[] = ['NONE', 'MERCHANT_PATTERN', 'CATEGORY']

// --- create_debts -----------------------------------------------------------

interface RequestedDebt {
  readonly name: string
  readonly kind: DebtKind
  readonly principalMajor: number
  readonly openedDate: LocalDate
  readonly expectedEndDate: LocalDate | undefined
  readonly monthlyPaymentMajor: number | undefined
  readonly trackingKind: string | undefined
  readonly trackingRef: string | undefined
  readonly note: string | undefined
}

interface DebtEntry {
  readonly requested: RequestedDebt
  readonly input: NewDebt | undefined
  readonly note: string | undefined
}

const DEBT_PROBLEM_TEXT: Readonly<Record<DebtProblem, string>> = {
  NO_NAME: 'the name is empty',
  NON_POSITIVE_PRINCIPAL: 'the principal must be above zero — it is what outstanding counts down from',
  NEGATIVE_MONTHLY_PAYMENT: 'the monthly payment is negative',
  MIXED_CURRENCY: 'the amounts are not all in one currency',
  EMPTY_TRACKING_REF: 'that tracking kind needs a `tracking_ref`',
  PATTERN_TOO_LONG: 'the merchant pattern is too long',
  ENDS_BEFORE_IT_STARTS: 'the expected end date is before the date it was opened',
}

function trackingFrom(kind: string | undefined, ref: string | undefined): AutoTracking {
  switch (kind) {
    case 'MERCHANT_PATTERN':
      return { kind: 'MERCHANT_PATTERN', pattern: ref ?? '' }
    case 'CATEGORY':
      return { kind: 'CATEGORY', categoryId: ref ?? '' }
    default:
      return { kind: 'NONE' }
  }
}

function readDebts(args: Args): readonly RequestedDebt[] {
  const raw = args['debts']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`debts` must be a non-empty array, one entry per debt.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} debts; the ceiling is ${BATCH_MAX}.`)
  }

  return raw.map((entry, index) => {
    const where = `\`debts[${index}]\``
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`${where} must be an object.`)
    }
    const record = entry as Record<string, unknown>

    const name = optionalString(record, 'name')
    if (name === undefined) throw new ToolInputError(`${where} needs a \`name\`.`)

    const rawKind = optionalString(record, 'kind')?.toUpperCase()
    if (rawKind === undefined || !DEBT_KINDS.includes(rawKind as DebtKind)) {
      throw new ToolInputError(`${where}.kind must be one of ${DEBT_KINDS.join(', ')}.`)
    }

    const principalMajor = optionalNumber(record, 'principal_amount')
    if (principalMajor === undefined) {
      throw new ToolInputError(
        `${where} needs a \`principal_amount\` — the original amount borrowed, which is what ` +
          'outstanding counts down from. A debt has no stored balance.',
      )
    }

    const openedText = optionalString(record, 'opened_date')
    const openedDate = openedText === undefined ? undefined : parseISODate(openedText)
    if (openedDate === undefined) {
      throw new ToolInputError(`${where} needs an \`opened_date\`, as YYYY-MM-DD.`)
    }

    const endText = optionalString(record, 'expected_end_date')
    const expectedEndDate = endText === undefined ? undefined : parseISODate(endText)
    if (endText !== undefined && expectedEndDate === undefined) {
      throw new ToolInputError(`${where}.expected_end_date must be YYYY-MM-DD; got "${endText}".`)
    }

    const trackingKind = optionalString(record, 'tracking_kind')?.toUpperCase()
    if (trackingKind !== undefined && !AUTO_TRACK_KINDS.includes(trackingKind as never)) {
      throw new ToolInputError(
        `${where}.tracking_kind must be one of ${AUTO_TRACK_KINDS.join(', ')}.`,
      )
    }

    return {
      name,
      kind: rawKind as DebtKind,
      principalMajor,
      openedDate,
      expectedEndDate,
      monthlyPaymentMajor: optionalNumber(record, 'monthly_payment'),
      trackingKind,
      trackingRef: optionalString(record, 'tracking_ref'),
      note: optionalString(record, 'note'),
    }
  })
}

function planDebts(document: OpenDocument, batch: readonly RequestedDebt[]): readonly DebtEntry[] {
  const currency = documentCurrency(document.db)
  const existing = listDebts(document.db, { includeClosed: true })
  const categories = new Set(
    listCategories(document.db, { includeArchived: true }).map((one) => one.id),
  )

  return batch.map((requested): DebtEntry => {
    const clash = existing.find(
      (debt) => debt.name.trim().toLowerCase() === requested.name.trim().toLowerCase(),
    )
    if (clash !== undefined) {
      return refusedDebt(
        requested,
        `a debt called "${clash.name}" already exists. Payments go to it with ` +
          '`record_debt_payments`; changing or closing a debt is app-only, at `#/wealth/debts`',
      )
    }

    if (requested.trackingKind === 'CARD_INSTALLMENT_GROUP') {
      return refusedDebt(
        requested,
        'promoting a card installment group is app-only, at `#/wealth/debts`. It does more than ' +
          'name a ref: it confirms the slices already charged, and it says whether the principal ' +
          'is the total the statement printed or slice × count — an estimate accepted as a fact ' +
          'becomes a balance nobody can check',
      )
    }
    if (requested.trackingKind !== undefined && !WRITABLE_TRACKING.includes(requested.trackingKind)) {
      return refusedDebt(requested, `this tool does not write ${requested.trackingKind} tracking`)
    }
    if (
      requested.trackingKind === 'CATEGORY' &&
      requested.trackingRef !== undefined &&
      !categories.has(requested.trackingRef)
    ) {
      return refusedDebt(
        requested,
        `no category with id ${requested.trackingRef} — \`category_tree\` has the ids`,
      )
    }

    const principalAmount = fromMajorUnits(requested.principalMajor, currency)
    const monthlyPaymentAmount =
      requested.monthlyPaymentMajor === undefined
        ? undefined
        : fromMajorUnits(requested.monthlyPaymentMajor, currency)

    const problems = validateDebt({
      id: '',
      name: requested.name,
      kind: requested.kind,
      principalAmount,
      openedDate: requested.openedDate,
      expectedEndDate: requested.expectedEndDate,
      monthlyPaymentAmount,
      linkedAccountId: undefined,
      tracking: trackingFrom(requested.trackingKind, requested.trackingRef),
      isClosed: false,
      note: requested.note,
    })
    if (problems.length > 0) {
      return refusedDebt(requested, problems.map((one) => DEBT_PROBLEM_TEXT[one]).join('; '))
    }

    return {
      requested,
      note: undefined,
      input: {
        name: requested.name,
        kind: requested.kind,
        principalAmount,
        openedDate: requested.openedDate,
        ...(requested.expectedEndDate === undefined
          ? {}
          : { expectedEndDate: requested.expectedEndDate }),
        ...(monthlyPaymentAmount === undefined ? {} : { monthlyPaymentAmount }),
        ...(requested.trackingKind === undefined
          ? {}
          : { tracking: trackingFrom(requested.trackingKind, requested.trackingRef) }),
        ...(requested.note === undefined ? {} : { note: requested.note }),
      },
    }
  })
}

function refusedDebt(requested: RequestedDebt, why: string): DebtEntry {
  return { requested, input: undefined, note: why }
}

export const createDebtsTool: PluginTool = {
  definition: {
    name: 'create_debts',
    title: 'Create debts',
    description:
      'Add debts — **several in one call**. A debt is the original principal plus a stream of ' +
      'payments; **the balance is derived, never stored**, so there is nothing here that sets ' +
      'one. Optionally set how payments are discovered: a merchant pattern for a standing order, ' +
      'or a category. **Dry-runs by default**; the document is copied to a timestamped .bak ' +
      'first. Editing, closing and deleting a debt are app-only, as is promoting a card ' +
      'installment group.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        debts: {
          type: 'array',
          description: `One entry per debt. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              name: stringProp('What the user calls it.'),
              kind: stringProp(`One of ${DEBT_KINDS.join(', ')}.`),
              principal_amount: numberProp(
                'The original amount borrowed, in major units — not what is left. Outstanding is ' +
                  'this minus the principal of every payment.',
              ),
              opened_date: stringProp('When it was taken on, as YYYY-MM-DD.'),
              expected_end_date: stringProp('When it is due to be paid off, as YYYY-MM-DD.'),
              monthly_payment: numberProp(
                'The expected payment, used to project a payoff date before there is any history.',
              ),
              tracking_kind: stringProp(
                'How payments are found: NONE (entered by hand — money owed to a friend), ' +
                  'MERCHANT_PATTERN (a standing order, matched against the normalized merchant), ' +
                  'or CATEGORY. A payroll-deducted loan is not set here — that link is the ' +
                  'deduction type’s "Pays into", set with `set_deduction_types`.',
              ),
              tracking_ref: stringProp(
                'The merchant pattern, or a category id from `category_tree`. Required unless ' +
                  'tracking_kind is NONE.',
              ),
              note: stringProp('Anything worth keeping — the lender, the rate, the agreement.'),
            },
            required: ['name', 'kind', 'principal_amount', 'opened_date'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'debts'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readDebts(args)

    const mutation: Mutation<readonly DebtEntry[]> = {
      plan: (document) => planDebts(document, batch),
      describe: (entries) => {
        const doing = entries.filter((entry) => entry.input !== undefined)
        const tracked = doing.filter(
          (entry) => entry.requested.trackingKind !== undefined &&
            entry.requested.trackingKind !== 'NONE',
        )

        return paragraphs(
          doing.length === 0
            ? '**Nothing to create.** The reasons are in the table.'
            : `**${plural(doing.length, 'debt')}** would be created.`,
          table(
            ['Debt', 'Kind', 'Principal', 'Opened', 'Monthly', 'Payments found by', 'What happens'],
            entries.map((entry) => [
              entry.requested.name,
              entry.requested.kind,
              money(entry.input?.principalAmount),
              date(entry.requested.openedDate),
              money(entry.input?.monthlyPaymentAmount),
              entry.requested.trackingKind === undefined || entry.requested.trackingKind === 'NONE'
                ? 'by hand'
                : `${entry.requested.trackingKind}: ${entry.requested.trackingRef ?? '—'}`,
              entry.note ?? 'created',
            ]),
          ),
          tracked.length === 0
            ? undefined
            : `${plural(tracked.length, 'debt')} will have payments discovered from the ledger ` +
              'at the next import. Those land **unconfirmed** — they count towards the balance ' +
              'and are marked — and answering them is the app’s review queue at `#/wealth/debts`.',
          doing.length === 0
            ? undefined
            : 'There is no interest rate: v1 has no amortization schedule, so a payment is all ' +
              'principal unless it names an interest portion of its own.',
        )
      },
      apply: (document, entries) => {
        const now = Date.now()
        const done: string[][] = []

        for (const entry of entries) {
          if (entry.input === undefined) continue
          const debt = createDebt(document.db, entry.input, now)
          done.push([debt.name, debt.kind, money(debt.principalAmount), debt.tracking.kind])
        }

        const refusals = entries.filter((entry) => entry.note !== undefined)
        return paragraphs(
          `Created ${plural(done.length, 'debt')}.`,
          done.length === 0
            ? undefined
            : table(['Debt', 'Kind', 'Principal', 'Payments found by'], done),
          refusals.length === 0
            ? undefined
            : `Refused: ${refusals.map((entry) => `${entry.requested.name} — ${entry.note ?? ''}`).join('; ')}.`,
          '`record_debt_payments` records what has been paid; `debts` shows what is outstanding ' +
            'and when each projects to be paid off.',
        )
      },
    }

    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

// --- record_debt_payments ---------------------------------------------------

interface RequestedPayment {
  readonly debt: string
  readonly amountMajor: number
  readonly date: LocalDate
  readonly interestMajor: number | undefined
  readonly note: string | undefined
}

interface PaymentEntry {
  readonly requested: RequestedPayment
  readonly debtId: string | undefined
  readonly debtName: string
  readonly amount: Money | undefined
  readonly interest: Money | undefined
  readonly warning: string | undefined
  readonly note: string | undefined
}

const PAYMENT_PROBLEM_TEXT: Readonly<Record<PaymentProblem, string>> = {
  UNKNOWN_DEBT: 'no such debt',
  CLOSED_DEBT: 'that debt is closed and takes no new payments — reopening it is app-only',
  ZERO_AMOUNT: 'the amount is zero',
  NEGATIVE_AMOUNT: 'the amount must be positive — a payment is a magnitude, and its direction is known',
  NEGATIVE_INTEREST: 'the interest portion is negative',
  INTEREST_EXCEEDS_PAYMENT: 'the interest portion is larger than the payment',
  MIXED_CURRENCY: 'the amount is not in the debt’s currency',
}

function readPayments(args: Args): readonly RequestedPayment[] {
  const raw = args['payments']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`payments` must be a non-empty array, one entry per payment.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} payments; the ceiling is ${BATCH_MAX}.`)
  }

  return raw.map((entry, index) => {
    const where = `\`payments[${index}]\``
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`${where} must be an object.`)
    }
    const record = entry as Record<string, unknown>

    const debt = optionalString(record, 'debt')
    if (debt === undefined) {
      throw new ToolInputError(`${where} needs a \`debt\` — an id or a name from \`debts\`.`)
    }

    const amountMajor = optionalNumber(record, 'amount')
    if (amountMajor === undefined) throw new ToolInputError(`${where} needs an \`amount\`.`)

    const dateText = optionalString(record, 'date')
    const parsed = dateText === undefined ? undefined : parseISODate(dateText)
    if (parsed === undefined) {
      throw new ToolInputError(`${where}.date is required, as YYYY-MM-DD.`)
    }

    return {
      debt,
      amountMajor,
      date: parsed,
      interestMajor: optionalNumber(record, 'interest_portion'),
      note: optionalString(record, 'note'),
    }
  })
}

function planPayments(
  document: OpenDocument,
  batch: readonly RequestedPayment[],
): readonly PaymentEntry[] {
  const currency = documentCurrency(document.db)
  const debts = listDebts(document.db, { includeClosed: true })

  return batch.map((requested): PaymentEntry => {
    const debt = debts.find(
      (one) =>
        one.id === requested.debt ||
        one.name.trim().toLowerCase() === requested.debt.trim().toLowerCase(),
    )
    if (debt === undefined) {
      return refusedPayment(
        requested,
        `no debt called "${requested.debt}". \`debts\` lists them; \`create_debts\` makes one`,
      )
    }

    const amount = fromMajorUnits(requested.amountMajor, currency)
    const interest =
      requested.interestMajor === undefined
        ? fromMajorUnits(0, currency)
        : fromMajorUnits(requested.interestMajor, currency)

    const candidate = {
      id: '',
      debtId: debt.id,
      date: requested.date,
      amount,
      interestPortion: interest,
      principalPart: draftPrincipalPart(amount, interest),
      sourceKind: 'MANUAL' as const,
      sourceRefId: undefined,
      isConfirmed: true,
      note: requested.note,
    }

    const problems = validatePayment(candidate, { debt })
    if (problems.length > 0) {
      return refusedPayment(requested, problems.map((one) => PAYMENT_PROBLEM_TEXT[one]).join('; '))
    }

    const existing = listPayments(document.db, debt.id)
    const warnings = paymentWarnings(candidate, debt, existing)

    return {
      requested,
      debtId: debt.id,
      debtName: debt.name,
      amount,
      interest,
      warning:
        warnings.length === 0
          ? undefined
          : `more than ${owed(debtBalances(document.db, [debt]).get(debt.id))}`,
      note: undefined,
    }
  })
}

/** What the warning compares a payment to: the declared outstanding, or why there is none. */
function owed(balance: DebtBalance | undefined): string {
  return balance?.kind === 'KNOWN' ? `the ${money(balance.outstanding)} outstanding` : 'what is owed, which is unchecked'
}

function refusedPayment(requested: RequestedPayment, why: string): PaymentEntry {
  return {
    requested,
    debtId: undefined,
    debtName: requested.debt,
    amount: undefined,
    interest: undefined,
    warning: undefined,
    note: why,
  }
}

export const recordDebtPaymentsTool: PluginTool = {
  definition: {
    name: 'record_debt_payments',
    title: 'Record debt payments',
    description:
      'Record payments against a debt — **several in one call**. The amount is a magnitude; the ' +
      'direction is known. A payment is **all principal** unless it names an interest portion, ' +
      'because v1 has no amortization schedule. Paying more than is outstanding is allowed and ' +
      'is flagged. **Dry-runs by default**; the document is copied to a timestamped .bak first. ' +
      'Payments the app discovered at import are a separate thing and are confirmed in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        payments: {
          type: 'array',
          description: `One entry per payment. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              debt: stringProp('The debt, by id or by name. It must already exist.'),
              amount: numberProp('What was paid, in major units, positive.'),
              date: stringProp('YYYY-MM-DD.'),
              interest_portion: numberProp(
                'How much of the payment was interest. Defaults to 0, which makes the whole ' +
                  'payment come off the principal.',
              ),
              note: stringProp('Anything worth keeping about this payment.'),
            },
            required: ['debt', 'amount', 'date'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'payments'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readPayments(args)

    const mutation: Mutation<readonly PaymentEntry[]> = {
      plan: (document) => planPayments(document, batch),
      describe: (entries) => {
        const doing = entries.filter((entry) => entry.debtId !== undefined)
        const warned = doing.filter((entry) => entry.warning !== undefined)
        const withInterest = doing.filter((entry) => (entry.interest?.minor ?? 0) > 0)

        return paragraphs(
          doing.length === 0
            ? '**Nothing to record.** The reasons are in the table.'
            : `**${plural(doing.length, 'payment')}** would be recorded.`,
          table(
            ['Debt', 'Amount', 'Of which interest', 'Off the principal', 'Date', 'What happens'],
            entries.map((entry) => [
              entry.debtName,
              money(entry.amount),
              money(entry.interest),
              entry.amount === undefined || entry.interest === undefined
                ? '—'
                : money({ ...entry.amount, minor: entry.amount.minor - entry.interest.minor }),
              date(entry.requested.date),
              entry.note ?? entry.warning ?? 'recorded',
            ]),
          ),
          withInterest.length === doing.length || doing.length === 0
            ? undefined
            : 'Payments with no interest portion come off the principal in full. That is the v1 ' +
              'default rather than a fact about the loan — ask the user if the statement splits it.',
          warned.length === 0
            ? undefined
            : `${plural(warned.length, 'payment')} ${verb(warned.length, 'pays', 'pay')} more ` +
              'than is outstanding. That is allowed and shows as overpaid; the app offers to ' +
              'close a settled debt.',
        )
      },
      apply: (document, entries) => {
        const now = Date.now()
        const done: string[][] = []

        for (const entry of entries) {
          if (entry.debtId === undefined || entry.amount === undefined) continue
          const payment = addPayment(
            document.db,
            {
              debtId: entry.debtId,
              date: entry.requested.date,
              amount: entry.amount,
              ...(entry.interest === undefined ? {} : { interestPortion: entry.interest }),
              ...(entry.requested.note === undefined ? {} : { note: entry.requested.note }),
            },
            now,
          )
          done.push([entry.debtName, money(payment.amount), date(payment.date)])
        }

        const refusals = entries.filter((entry) => entry.note !== undefined)
        return paragraphs(
          `Recorded ${plural(done.length, 'payment')}.`,
          done.length === 0 ? undefined : table(['Debt', 'Amount', 'Date'], done),
          refusals.length === 0
            ? undefined
            : `Refused: ${refusals.map((entry) => `${entry.debtName} — ${entry.note ?? ''}`).join('; ')}.`,
          '`debts` shows what is outstanding, how far along each is and when it projects to be ' +
            'paid off.',
        )
      },
    }

    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
