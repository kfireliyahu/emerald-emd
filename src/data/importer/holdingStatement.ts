/**
 * **A statement of an account with holdings, read by a conversation** (M30 U6).
 *
 * There is no app reader for a broker's PDF on purpose: one was built before
 * D-308, and it cost too much and read too little (2026-10-04). A
 * conversation reads the file itself and hands over what it printed — the
 * movements, each with the cash balance after it, and the holdings table — and
 * this writes all of it in one batch: the rows onto the account (naming the
 * holding and quantity a buy or a sale turned cash into, D-355), and the
 * holdings table as dated readings (D-358).
 *
 * **The cash balance after each row is what makes the batch safe to trust and
 * safe to repeat.** Two things follow from it:
 *
 * - **The chain.** Each row's balance is the one before it plus its amount, so a
 *   transcription that misread a figure breaks the chain at that row and the
 *   whole batch is refused there — the same self-check a bank file's running
 *   balance gives the importer (F06), with the model as the parser.
 * - **The key.** A row is its value date, its amount and the balance after it.
 *   An overlapping file — a half-year export repeating every monthly row — keys
 *   the same rows the same way and adds nothing, and two identical buys on one
 *   day still differ by the balance between them. The description is left out
 *   of the key on purpose: a model reading the same Hebrew twice need not spell
 *   it the same way twice.
 *
 * A row that moves no cash and names no holding (a broker's own tax bookkeeping
 * line) is left out: it adds nothing to the balance and nothing to a holding.
 *
 * The plan is read-only and the dry run shows it; the apply writes through the
 * repositories the screens use, so nothing here holds a line of SQL.
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { compareDates, toISODate, type LocalDate } from '@/core/time.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { costBasisCheck, type CostBasisCheck } from '@/domain/goalDeposits.ts'
import { cashCheck, quantityCheck, type ReadingCheck } from '@/domain/holdingReadings.ts'
import type { Holding, HoldingPlace } from '@/domain/model/savings.ts'
import { createAccount, findAccountById, listAccounts } from '../repositories/accountRepository.ts'
import {
  holdingQuantityBy,
  holdingReadingProblem,
  listHoldingReadings,
  priceCheck,
  readingClash,
  recordHoldingReading,
  rowsPutIn,
  runningBalance,
  type HoldingReading,
} from '../repositories/holdingReadingRepository.ts'
import {
  createSession,
  findCommittedFile,
  setCoverage,
  setSessionCounts,
  setSessionStatus,
} from '../repositories/importSessionRepository.ts'
import {
  cashHoldingOf,
  createHolding,
  createHoldingPlace,
  holdingChoiceProblem,
  listHoldingPlaces,
  listHoldings,
  setPlaceAccount,
} from '../repositories/savingsRepository.ts'
import { existingNaturalKeys, insertTransactions } from '../repositories/transactionRepository.ts'
import { suggestTransfers } from '../repositories/transferPairRepository.ts'
import { directionOf } from './apply.ts'

/** One movement as the statement printed it. */
export interface StatementRowInput {
  /** The value date — the day the cash moved, which is the day the holdings table counts it. */
  readonly date: LocalDate
  readonly description: string
  /** Signed: a buy is negative, a deposit or a sale positive. */
  readonly amount: Money
  /** The account's cash after this row, as printed. */
  readonly cashAfter: Money
  /** What the row's cash turned into — by id or name — and how much of it. Both or neither. */
  readonly holding: string | undefined
  readonly quantityMicro: number | undefined
}

/** One line of the holdings table. */
export interface StatementLineInput {
  readonly holding: string
  readonly value: Money
  readonly quantityMicro: number | undefined
  readonly costBasis: Money | undefined
  readonly priceMicro: number | undefined
  /** These figures replace a different reading of the same day. */
  readonly correct: boolean
}

export interface HoldingStatementInput {
  /** The account by id, or the name of one to make — an account with holdings. */
  readonly account: { readonly id: string } | { readonly newName: string }
  /** The place on the money map that names the account, when it names none yet: by id or name, made when new. */
  readonly place: string | undefined
  readonly fileName: string
  readonly fileHash: string
  /** The day the holdings table is for. */
  readonly asOf: LocalDate
  /** The first day of the period the statement printed, when it printed one. */
  readonly from: LocalDate | undefined
  readonly currency: CurrencyCode
  readonly rows: readonly StatementRowInput[]
  readonly lines: readonly StatementLineInput[]
  /** The cash line of the holdings table. */
  readonly cash: Money | undefined
}

export type HoldingRef =
  | { readonly kind: 'EXISTING'; readonly holding: Holding }
  | { readonly kind: 'NEW'; readonly name: string }

type RowOutcome = 'NEW' | 'ALREADY' | 'NO_CASH'

interface RowPlan {
  readonly input: StatementRowInput
  readonly key: string
  readonly holding: HoldingRef | undefined
  readonly outcome: RowOutcome
  readonly problem: string | undefined
}

interface PreviewChecks {
  readonly cost: CostBasisCheck
  readonly quantity: ReadingCheck<number>
  readonly price: ReadingCheck<Money>
}

interface LinePlan {
  readonly input: StatementLineInput
  readonly holding: HoldingRef | undefined
  readonly outcome: 'NEW' | 'SAME' | 'CORRECTS'
  readonly problem: string | undefined
  readonly checks: PreviewChecks | undefined
}

export interface HoldingStatementPlan {
  readonly input: HoldingStatementInput
  readonly accountId: string | undefined
  readonly accountName: string
  /** The place the holdings are in, and whether this batch makes it or links it. */
  readonly place:
    | { readonly id: string | undefined; readonly name: string; readonly isNew: boolean; readonly links: boolean }
    | undefined
  /** The account's own cash holding, when it has one already. */
  readonly cashHolding: Holding | undefined
  /** The statement this same file was written as before, if it was. */
  readonly previousStatementId: string | undefined
  readonly newHoldings: readonly string[]
  readonly rows: readonly RowPlan[]
  readonly lines: readonly LinePlan[]
  readonly cash: { readonly check: ReadingCheck<Money>; readonly problem: string | undefined } | undefined
  /** Where the printed balances stop adding up, if they do. */
  readonly chain: { readonly row: number; readonly expected: Money; readonly printed: Money } | undefined
  /** Everything that refuses the batch, in a sentence each. */
  readonly problems: readonly string[]
}

/** A row's identity on its account: the value date, the amount and the cash after it. */
export function statementRowKey(row: StatementRowInput): string {
  return `${toISODate(row.date)}${String(row.amount.minor)}${row.amount.currency}@${String(row.cashAfter.minor)}`
}

/** By id, else by a name only one of `among` carries; undefined when none does. */
function findByName(among: readonly Holding[], all: readonly Holding[], wanted: string): Holding | string | undefined {
  const byId = all.find((one) => one.id === wanted)
  if (byId !== undefined) return byId
  const lower = wanted.trim().toLowerCase()
  const named = among.filter((one) => one.name.trim().toLowerCase() === lower)
  if (named.length > 1) return `${String(named.length)} holdings are called "${wanted}"; name one by its id`
  return named[0]
}

function findPlace(places: readonly HoldingPlace[], wanted: string): HoldingPlace | undefined {
  const lower = wanted.trim().toLowerCase()
  return places.find((one) => one.id === wanted) ?? places.find((one) => one.name.trim().toLowerCase() === lower)
}

/**
 * What the batch would write and what it would prove, without writing. Every
 * refusal is collected rather than thrown, so the dry run names them all.
 */
export function planHoldingStatement(db: Database, input: HoldingStatementInput): HoldingStatementPlan {
  const problems: string[] = []

  // --- the account, and the place that names it ---------------------------
  let accountId: string | undefined
  let accountName: string
  if ('id' in input.account) {
    const found = findAccountById(db, input.account.id)
    accountId = found?.id
    accountName = found?.name ?? input.account.id
    if (found === undefined) problems.push(`No account with id ${input.account.id}; \`document_info\` lists them.`)
    else if (found.kind !== 'HOLDINGS') {
      problems.push(
        `${found.name} is not an account with holdings, so its buys and deposits would count as spending ` +
          'and income. `update_account` makes it one (kind HOLDINGS), or name a new account.',
      )
    }
  } else {
    const newName = input.account.newName
    accountName = newName
    const twin = listAccounts(db, { includeArchived: true }).find(
      (one) => one.name.trim().toLowerCase() === newName.trim().toLowerCase(),
    )
    if (twin !== undefined) {
      problems.push(`There is already an account called ${twin.name} (\`account_id\` ${twin.id}); name it by its id.`)
    }
  }

  const places = listHoldingPlaces(db, { includeArchived: true })
  const linked = accountId === undefined ? undefined : places.find((one) => one.accountId === accountId)
  let place: HoldingStatementPlan['place']
  if (linked !== undefined) {
    place = { id: linked.id, name: linked.name, isNew: false, links: false }
    if (input.place !== undefined && findPlace([linked], input.place) === undefined) {
      problems.push(`${accountName} is already named by ${linked.name}; leave \`place\` out or name that one.`)
    }
  } else {
    const wanted = input.place ?? accountName
    const found = findPlace(places, wanted)
    if (found === undefined) place = { id: undefined, name: wanted, isNew: true, links: true }
    else {
      place = { id: found.id, name: found.name, isNew: false, links: true }
      if (found.accountId !== undefined && found.accountId !== accountId) {
        const other = findAccountById(db, found.accountId)
        problems.push(`${found.name} already names ${other?.name ?? 'another account'}; a place names one account.`)
      }
    }
  }
  const cashHolding = accountId === undefined ? undefined : cashHoldingOf(db, accountId)

  // --- holdings, by name or id, made in the place when new ------------------
  const allHoldings = listHoldings(db, { includeArchived: true })
  const inPlace = place.id === undefined ? [] : allHoldings.filter((one) => one.holdingPlaceId === place.id)
  const newHoldings = new Map<string, string>()
  const resolve = (wanted: string): HoldingRef | string => {
    const found = findByName(inPlace, allHoldings, wanted)
    if (typeof found === 'string') return found
    if (found !== undefined) return { kind: 'EXISTING', holding: found }
    const key = wanted.trim().toLowerCase()
    if (!newHoldings.has(key)) newHoldings.set(key, wanted.trim())
    return { kind: 'NEW', name: newHoldings.get(key) ?? wanted.trim() }
  }
  const sameRef = (a: HoldingRef | undefined, b: HoldingRef | undefined): boolean =>
    a !== undefined &&
    b !== undefined &&
    (a.kind === 'EXISTING'
      ? b.kind === 'EXISTING' && a.holding.id === b.holding.id
      : b.kind === 'NEW' && a.name.toLowerCase() === b.name.toLowerCase())

  // --- the rows ----------------------------------------------------------
  const already = accountId === undefined ? new Set<string>() : existingNaturalKeys(db, accountId)
  const seen = new Set<string>()
  const rows = input.rows.map((row, index): RowPlan => {
    const key = statementRowKey(row)
    const refuse = (problem: string, holding?: HoldingRef): RowPlan => ({
      input: row,
      key,
      holding,
      outcome: 'NEW',
      problem: `Row ${String(index + 1)}: ${problem}`,
    })
    if (row.description.trim() === '') return refuse('needs its description, as printed.')
    if (row.amount.currency !== input.currency || row.cashAfter.currency !== input.currency) {
      return refuse(`is not in ${input.currency}; one statement is one currency.`)
    }
    if ((row.holding === undefined) !== (row.quantityMicro === undefined)) {
      return refuse('names a holding without a quantity, or a quantity without a holding; a buy or a sale needs both.')
    }
    let holding: HoldingRef | undefined
    if (row.holding !== undefined && row.quantityMicro !== undefined) {
      const resolved = resolve(row.holding)
      if (typeof resolved === 'string') return refuse(resolved)
      holding = resolved
      if (row.quantityMicro === 0) return refuse('a quantity of zero bought or sold nothing.', holding)
      if (row.amount.minor !== 0 && Math.sign(row.amount.minor) === Math.sign(row.quantityMicro)) {
        return refuse(
          'a buy takes cash out (a negative amount, a positive quantity) and a sale brings it in (the other way round); ' +
            'this row has both the same sign.',
          holding,
        )
      }
      if (holding.kind === 'EXISTING' && accountId !== undefined) {
        const problem = holdingChoiceProblem(db, accountId, { holdingId: holding.holding.id, quantityMicro: row.quantityMicro })
        if (problem !== undefined) return refuse(problem, holding)
      }
      if (holding.kind === 'EXISTING' && cashHolding !== undefined && holding.holding.id === cashHolding.id) {
        return refuse('names the account’s own cash, and a row cannot turn cash into cash.', holding)
      }
    }
    if (row.amount.minor === 0 && holding === undefined) {
      return { input: row, key, holding, outcome: 'NO_CASH', problem: undefined }
    }
    if (seen.has(key)) return refuse('is the same day, amount and balance after as another row of this batch.', holding)
    seen.add(key)
    return { input: row, key, holding, outcome: already.has(key) ? 'ALREADY' : 'NEW', problem: undefined }
  })

  // The chain: each printed balance is the one before it plus the row.
  let chain: HoldingStatementPlan['chain']
  for (let index = 1; index < input.rows.length; index += 1) {
    const before = input.rows[index - 1]
    const row = input.rows[index]
    if (before === undefined || row === undefined) continue
    const expected = before.cashAfter.minor + row.amount.minor
    if (expected !== row.cashAfter.minor) {
      chain = { row: index + 1, expected: money(expected, input.currency), printed: row.cashAfter }
      break
    }
  }
  if (chain !== undefined) {
    problems.push(
      `The printed balances stop adding up at row ${String(chain.row)}: the row before it and its amount come to ` +
        `${String(chain.expected.minor / 100)}, and it says ${String(chain.printed.minor / 100)} after. A figure was misread — ` +
        'read that row again.',
    )
  }

  // What the new rows add by a day, per holding and to the cash.
  const asOf = toISODate(input.asOf)
  const pending = rows.filter((row) => row.outcome === 'NEW' && row.problem === undefined && compareDates(row.input.date, input.asOf) <= 0)

  // --- the holdings table ------------------------------------------------
  const lineSeen = new Set<string>()
  const lines = input.lines.map((line, index): LinePlan => {
    const refuse = (problem: string, holding?: HoldingRef): LinePlan => ({
      input: line,
      holding,
      outcome: 'NEW',
      problem: `Holding line ${String(index + 1)}: ${problem}`,
      checks: undefined,
    })
    const resolved = resolve(line.holding)
    if (typeof resolved === 'string') return refuse(resolved)
    const ref = resolved
    const identity = ref.kind === 'EXISTING' ? ref.holding.id : `new:${ref.name.toLowerCase()}`
    if (lineSeen.has(identity)) return refuse('the table names this holding twice.', ref)
    lineSeen.add(identity)
    if (line.value.currency !== input.currency || (line.costBasis !== undefined && line.costBasis.currency !== input.currency)) {
      return refuse(`is not in ${input.currency}; one statement is one currency.`, ref)
    }
    if (ref.kind === 'EXISTING' && cashHolding !== undefined && ref.holding.id === cashHolding.id) {
      return refuse('is the account’s own cash; send it as `cash`, a value only.', ref)
    }
    let outcome: LinePlan['outcome'] = 'NEW'
    if (ref.kind === 'EXISTING') {
      const reading = {
        holdingId: ref.holding.id,
        asOf: input.asOf,
        value: line.value,
        quantityMicro: line.quantityMicro,
        costBasis: line.costBasis,
        priceMicro: line.priceMicro,
      }
      const problem = holdingReadingProblem(db, reading)
      if (problem !== undefined) return refuse(problem, ref)
      const clash = readingClash(db, reading)
      if (clash !== undefined && !line.correct) {
        return refuse(
          `a reading of ${ref.holding.name} for ${asOf} already says ${String(clash.value.minor / 100)}; send \`correct: true\` if this one replaces it.`,
          ref,
        )
      }
      outcome =
        clash !== undefined
          ? 'CORRECTS'
          : listHoldingReadings(db, ref.holding.id).some((one) => one.asOf === asOf)
            ? 'SAME'
            : 'NEW'
    }

    // What the rows will say once these are written: the ones there, and the new ones by the day.
    const mine = pending.filter((row) => sameRef(row.holding, ref))
    const putInHeld = ref.kind === 'EXISTING' ? rowsPutIn(db, ref.holding.id, input.currency, asOf) : undefined
    const putIn = (putInHeld?.putIn.minor ?? 0) - mine.reduce((sum, row) => sum + row.input.amount.minor, 0)
    const heldQuantity = ref.kind === 'EXISTING' ? holdingQuantityBy(db, ref.holding.id, asOf) : { quantityMicro: 0 }
    const quantity =
      'reason' in heldQuantity
        ? heldQuantity
        : { quantityMicro: heldQuantity.quantityMicro + mine.reduce((sum, row) => sum + (row.input.quantityMicro ?? 0), 0) }
    return {
      input: line,
      holding: ref,
      outcome,
      problem: undefined,
      checks: {
        cost:
          line.costBasis === undefined
            ? { kind: 'UNCHECKED', reason: 'The table printed no cost.' }
            : costBasisCheck(money(putIn, input.currency), line.costBasis, putInHeld?.otherCurrencies ?? 0),
        quantity: quantityCheck(quantity, line.quantityMicro),
        price: priceCheck(db, line.quantityMicro, line.priceMicro, line.value),
      },
    }
  })

  // --- the cash line -------------------------------------------------------
  let cash: HoldingStatementPlan['cash']
  if (input.cash !== undefined) {
    const held = accountId === undefined ? undefined : runningBalance(db, accountId, asOf, input.currency)
    const added = pending.reduce((sum, row) => sum + row.input.amount.minor, 0)
    const running =
      held === undefined && pending.length === 0 ? undefined : money((held?.minor ?? 0) + added, input.currency)
    let problem: string | undefined
    if (input.cash.currency !== input.currency) problem = `The cash line is not in ${input.currency}.`
    else if (cashHolding !== undefined) {
      const clash = readingClash(db, { holdingId: cashHolding.id, asOf: input.asOf, value: input.cash })
      if (clash !== undefined) {
        problem = `A reading of ${accountName}'s cash for ${asOf} already says ${String(clash.value.minor / 100)}.`
      }
    }
    cash = { check: cashCheck(running, input.cash), problem }
    if (problem !== undefined) problems.push(problem)
  }

  for (const row of rows) if (row.problem !== undefined) problems.push(row.problem)
  for (const line of lines) if (line.problem !== undefined) problems.push(line.problem)
  if (input.rows.length === 0 && input.lines.length === 0 && input.cash === undefined) {
    problems.push('There is nothing to write: no rows, no holdings and no cash line.')
  }

  return {
    input,
    accountId,
    accountName,
    place,
    cashHolding,
    previousStatementId:
      accountId === undefined ? undefined : findCommittedFile(db, accountId, input.fileHash)?.id,
    newHoldings: [...newHoldings.values()],
    rows,
    lines,
    cash,
    chain,
    problems,
  }
}

interface HoldingStatementResult {
  readonly accountId: string
  readonly statementId: string
  readonly rowsWritten: number
  readonly rowsAlready: number
  readonly rowsWithoutCash: number
  readonly holdingsMade: readonly string[]
  /** Every reading the batch names, as stored now — the checks are run over these. */
  readonly readings: readonly HoldingReading[]
  readonly readingsWritten: number
  readonly transfersSuggested: number
}

/** Write a plan that refused nothing. Throws when it did: the batch applies whole or not at all. */
export function applyHoldingStatement(db: Database, plan: HoldingStatementPlan, now: number): HoldingStatementResult {
  if (plan.problems.length > 0) throw new Error(plan.problems.join(' '))
  const input = plan.input

  const accountId =
    plan.accountId ?? createAccount(db, { name: plan.accountName, kind: 'HOLDINGS' }, now).id

  const place = plan.place
  if (place === undefined) throw new Error('No place to keep the holdings in.')
  const placeId = place.id ?? createHoldingPlace(db, { name: place.name, kind: 'INVESTMENT' }, now).id
  const cashHolding = place.links
    ? setPlaceAccount(db, placeId, accountId, now).cashHolding
    : (plan.cashHolding ?? cashHoldingOf(db, accountId))

  const made = new Map<string, Holding>()
  for (const name of plan.newHoldings) {
    made.set(
      name.toLowerCase(),
      createHolding(db, { holdingPlaceId: placeId, name, kind: 'SECURITY', provenance: 'TRANSCRIBED', isLiquid: true }, now),
    )
  }
  const holdingId = (ref: HoldingRef | undefined): string | undefined =>
    ref === undefined ? undefined : ref.kind === 'EXISTING' ? ref.holding.id : made.get(ref.name.toLowerCase())?.id

  const written = plan.rows.filter((row) => row.outcome === 'NEW')
  let statementId = plan.previousStatementId
  if (statementId === undefined) {
    statementId = newId()
    createSession(
      db,
      { id: statementId, accountId, mappingId: undefined, fileName: input.fileName, fileHash: input.fileHash, sheetName: undefined },
      now,
    )
    const dates = input.rows.map((row) => row.date).sort(compareDates)
    const first = dates[0]
    const last = dates[dates.length - 1]
    setCoverage(
      db,
      statementId,
      {
        rows: first === undefined || last === undefined ? undefined : { from: first, to: last },
        printed: input.from === undefined ? undefined : { from: input.from, to: input.asOf },
      },
      now,
    )
    setSessionCounts(
      db,
      statementId,
      {
        total: input.rows.length,
        newRows: written.length,
        duplicates: plan.rows.filter((row) => row.outcome === 'ALREADY').length,
        failed: 0,
      },
      now,
    )
    setSessionStatus(db, statementId, 'COMMITTED', now)
  }

  insertTransactions(
    db,
    written.map((row) => {
      const index = plan.rows.indexOf(row)
      return {
        id: newId(),
        accountId,
        transactionDate: row.input.date,
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: row.input.amount,
        direction: directionOf(row.input.amount),
        merchantRaw: row.input.description.trim(),
        merchantNormalized: normalizeMerchant(row.input.description),
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: row.key,
        importSessionId: statementId,
        sourceRowRef: `${input.fileName}!${String(index + 1)}`,
        holdingId: holdingId(row.holding),
        quantityMicro: row.input.quantityMicro,
      }
    }),
    now,
  )

  const readingIds: string[] = []
  let readingsWritten = 0
  const record = (id: string, values: Omit<Parameters<typeof recordHoldingReading>[1], 'holdingId' | 'asOf'>, correct: boolean) => {
    const outcome = recordHoldingReading(
      db,
      { holdingId: id, asOf: input.asOf, statementId, source: input.fileName, ...values },
      { correct },
      now,
    )
    if (outcome !== 'UNCHANGED') readingsWritten += 1
    readingIds.push(id)
  }
  for (const line of plan.lines) {
    const id = holdingId(line.holding)
    if (id === undefined) continue
    record(
      id,
      {
        value: line.input.value,
        quantityMicro: line.input.quantityMicro,
        costBasis: line.input.costBasis,
        priceMicro: line.input.priceMicro,
      },
      line.input.correct,
    )
  }
  if (input.cash !== undefined && cashHolding !== undefined) record(cashHolding.id, { value: input.cash }, false)

  const transfersSuggested = suggestTransfers(db)

  const asOf = toISODate(input.asOf)
  return {
    accountId,
    statementId,
    rowsWritten: written.length,
    rowsAlready: plan.rows.filter((row) => row.outcome === 'ALREADY').length,
    rowsWithoutCash: plan.rows.filter((row) => row.outcome === 'NO_CASH').length,
    holdingsMade: plan.newHoldings,
    readings: readingIds.flatMap((id) => listHoldingReadings(db, id).filter((one) => one.asOf === asOf)),
    readingsWritten,
    transfersSuggested,
  }
}
