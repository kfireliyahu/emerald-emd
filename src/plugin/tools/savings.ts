/**
 * F07's writes — `create_goals` and `record_deposits` (D-113).
 *
 * The `savings` read lives in `wealth.ts` beside `debts` and `fixed_expenses`
 * and stays there; these are the writes it had none of. Wrappers over
 * `savingsRepository`, judged by `validateGoal` and `validateDeposit` so the
 * preview refuses exactly what the app's forms refuse.
 *
 * **Money lands in a holding, and a holding is an object, not a string** (D-175).
 * Both tools take one the same way — an `id`, or a `name` that creates the
 * holding when it matches nothing — and creating needs `kind`, `is_liquid`,
 * `provenance` *and* the `place` it sits at.
 *
 * **Two of those are refused rather than guessed, and for one reason each.**
 * Liquidity is the user's answer and not an inference from the kind (a פק"מ with
 * six months to run is a `DEPOSIT` and is not liquid), and provenance is
 * declared rather than inferred (D-176) — a fixed deposit with nothing
 * transcribed against it yet must still say that a statement is what would
 * confirm it, or the app can never tell the user their figure is stale.
 */

import { fromMajorUnits, type Money } from '@/core/money.ts'
import { parseISODate, type LocalDate } from '@/core/time.ts'
import {
  addDeposit,
  createHolding,
  createHoldingPlace,
  listDeposits,
  listGoals,
  listHoldingPlaces,
  listHoldings,
  recordTransfer,
  type NewSavingGoal,
} from '@/data/repositories/savingsRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { goalFeeds } from '@/data/repositories/goalDepositRepository.ts'
import { goalAnswerProblem, saveGoalAnswer } from '@/data/repositories/goalWhereRepository.ts'
import {
  DEPOSIT_MODES,
  signedAmount,
  sourceKindFor,
  type DepositMode,
} from '@/domain/depositEntry.ts'
import {
  depositWarnings,
  validateDeposit,
  validateGoal,
  type DepositProblem,
  type GoalProblem,
} from '@/domain/savings.ts'
import {
  HOLDING_KINDS,
  HOLDING_PLACE_KINDS,
  HOLDING_PROVENANCES,
  SAVING_GOAL_KINDS,
  type Holding,
  type HoldingKind,
  type HoldingPlace,
  type HoldingPlaceKind,
  type HoldingProvenance,
  type SavingDeposit,
  type SavingGoalKind,
} from '@/domain/model/savings.ts'

import { type OpenDocument } from '../document.ts'
import { date, money, paragraphs, plural, table, verb } from '../format.ts'
import { today } from '../today.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 60

// --- holdings, shared by both tools -----------------------------------------

/** A place as the caller named it: an existing one, or one to create. */
interface RequestedPlace {
  readonly id: string | undefined
  readonly name: string | undefined
  readonly kind: HoldingPlaceKind | undefined
  readonly institution: string | undefined
}

/** A holding as the caller named it. **Money always lands in one** (D-175). */
interface RequestedHolding {
  readonly id: string | undefined
  readonly name: string | undefined
  readonly kind: HoldingKind | undefined
  readonly isLiquid: boolean | undefined
  readonly provenance: HoldingProvenance | undefined
  readonly place: RequestedPlace | undefined
}

function readPlace(value: unknown, where: string): RequestedPlace | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') {
    throw new ToolInputError(
      `${where} must be an object naming a place — \`{ "id": … }\` for one \`savings\` listed, or ` +
        '`{ "name": …, "kind": … }` to create one.',
    )
  }
  const record = value as Record<string, unknown>
  const id = optionalString(record, 'id')
  const name = optionalString(record, 'name')
  if (id === undefined && name === undefined) {
    throw new ToolInputError(`${where} needs an \`id\` or a \`name\`.`)
  }

  const rawKind = optionalString(record, 'kind')?.toUpperCase()
  if (rawKind !== undefined && !HOLDING_PLACE_KINDS.includes(rawKind as HoldingPlaceKind)) {
    throw new ToolInputError(`${where}.kind must be one of ${HOLDING_PLACE_KINDS.join(', ')}.`)
  }

  return {
    id,
    name,
    kind: rawKind as HoldingPlaceKind | undefined,
    institution: optionalString(record, 'institution'),
  }
}

function readHolding(value: unknown, where: string): RequestedHolding | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') {
    throw new ToolInputError(
      `${where} must be an object naming a holding — \`{ "id": … }\` for one \`savings\` listed, ` +
        'or `{ "name": …, "kind": …, "is_liquid": …, "provenance": …, "place": … }` to create one.',
    )
  }
  const record = value as Record<string, unknown>
  const id = optionalString(record, 'id')
  const name = optionalString(record, 'name')
  if (id === undefined && name === undefined) {
    throw new ToolInputError(`${where} needs an \`id\` or a \`name\`.`)
  }

  const rawKind = optionalString(record, 'kind')?.toUpperCase()
  if (rawKind !== undefined && !HOLDING_KINDS.includes(rawKind as HoldingKind)) {
    throw new ToolInputError(`${where}.kind must be one of ${HOLDING_KINDS.join(', ')}.`)
  }

  const rawProvenance = optionalString(record, 'provenance')?.toUpperCase()
  if (
    rawProvenance !== undefined &&
    !HOLDING_PROVENANCES.includes(rawProvenance as HoldingProvenance)
  ) {
    throw new ToolInputError(
      `${where}.provenance must be one of ${HOLDING_PROVENANCES.join(', ')}.`,
    )
  }

  return {
    id,
    name,
    kind: rawKind as HoldingKind | undefined,
    isLiquid: optionalBoolean(record, 'is_liquid'),
    provenance: rawProvenance as HoldingProvenance | undefined,
    place: readPlace(record['place'], `${where}.place`),
  }
}

/** An existing place, a place to create, or the reason neither is possible. */
type PlaceResolution =
  | { readonly kind: 'EXISTING'; readonly place: HoldingPlace }
  | { readonly kind: 'NEW'; readonly name: string; readonly requested: RequestedPlace }
  | { readonly kind: 'REFUSED'; readonly why: string }

/** The same three answers about a holding, carrying the place it belongs to. */
type HoldingResolution =
  | { readonly kind: 'EXISTING'; readonly holding: Holding; readonly placeName: string }
  | {
      readonly kind: 'NEW'
      readonly name: string
      readonly requested: RequestedHolding
      readonly place: PlaceResolution
    }
  | { readonly kind: 'REFUSED'; readonly why: string }

function resolvePlace(
  requested: RequestedPlace,
  existing: readonly HoldingPlace[],
): PlaceResolution {
  if (requested.id !== undefined) {
    const found = existing.find((place) => place.id === requested.id)
    return found === undefined
      ? { kind: 'REFUSED', why: `no holding place with id ${requested.id} — \`savings\` lists them` }
      : { kind: 'EXISTING', place: found }
  }

  const name = (requested.name ?? '').trim()
  const found = existing.find((place) => place.name.trim().toLowerCase() === name.toLowerCase())
  if (found !== undefined) return { kind: 'EXISTING', place: found }

  if (requested.kind === undefined) {
    return {
      kind: 'REFUSED',
      why:
        `no holding place called "${name}", so it would be created — and that needs a \`kind\` ` +
        `(${HOLDING_PLACE_KINDS.join(', ')})`,
    }
  }
  return { kind: 'NEW', name, requested }
}

/**
 * Which holding this movement lands in.
 *
 * **Creating one needs three answers the app will not guess.** `is_liquid`
 * because liquidity is the user's answer and not the kind's; `provenance`
 * because it is declared rather than inferred (D-176), and inferring it from
 * whether anything has been transcribed yet would make a holding change its own
 * kind by being neglected; and a `place`, because a holding without one is money
 * in no particular bank.
 */
function resolveHolding(
  requested: RequestedHolding,
  holdings: readonly Holding[],
  places: readonly HoldingPlace[],
): HoldingResolution {
  const placeNameOf = (holding: Holding): string =>
    places.find((one) => one.id === holding.holdingPlaceId)?.name ?? ''

  if (requested.id !== undefined) {
    const found = holdings.find((holding) => holding.id === requested.id)
    return found === undefined
      ? { kind: 'REFUSED', why: `no holding with id ${requested.id} — \`savings\` lists them` }
      : { kind: 'EXISTING', holding: found, placeName: placeNameOf(found) }
  }

  const name = (requested.name ?? '').trim()
  const found = holdings.find(
    (holding) => holding.name.trim().toLowerCase() === name.toLowerCase(),
  )
  if (found !== undefined) {
    return { kind: 'EXISTING', holding: found, placeName: placeNameOf(found) }
  }

  const missing: string[] = []
  if (requested.kind === undefined) missing.push(`\`kind\` (${HOLDING_KINDS.join(', ')})`)
  if (requested.isLiquid === undefined) {
    missing.push(
      '`is_liquid` — your answer, not something the kind implies: a fixed deposit with six ' +
        'months to run is not reachable money',
    )
  }
  if (requested.provenance === undefined) {
    missing.push(
      `\`provenance\` (${HOLDING_PROVENANCES.join(', ')}) — how the balance is known, which is ` +
        'declared and never inferred: a deposit with no statement transcribed yet is still ' +
        'TRANSCRIBED, because a statement is what would confirm it',
    )
  }
  if (requested.place === undefined) missing.push('`place` — the bank or broker it is at')

  if (missing.length > 0) {
    return {
      kind: 'REFUSED',
      why: `no holding called "${name}", so it would be created — and that needs ${missing.join('; ')}`,
    }
  }

  const place = resolvePlace(requested.place as RequestedPlace, places)
  if (place.kind === 'REFUSED') return { kind: 'REFUSED', why: place.why }

  return { kind: 'NEW', name, requested, place }
}

/**
 * A record an earlier entry in the same batch would create, so a later entry
 * naming it resolves rather than being refused.
 *
 * Found by driving the built server: a transfer created "PKM 6 months" and the
 * next movement into it was refused for not existing — which is the D-112
 * grouping lesson in a second shape. The id is a placeholder until the record is
 * really made, and `holdingIdOf` is what turns it into the real one.
 */
const PENDING = 'pending:'

function pendingId(name: string): string {
  return PENDING + name.trim().toLowerCase()
}

function carryForward(
  knownHoldings: Holding[],
  knownPlaces: HoldingPlace[],
  resolution: HoldingResolution,
): void {
  if (resolution.kind !== 'NEW') return

  const place = resolution.place
  const placeId =
    place.kind === 'EXISTING' ? place.place.id : place.kind === 'NEW' ? pendingId(place.name) : ''
  if (place.kind === 'NEW' && !knownPlaces.some((one) => one.id === placeId)) {
    knownPlaces.push({
      id: placeId,
      name: place.name,
      kind: place.requested.kind ?? 'OTHER',
      institution: place.requested.institution,
      note: undefined,
      isArchived: false,
    })
  }

  const id = pendingId(resolution.name)
  if (knownHoldings.some((holding) => holding.id === id)) return
  knownHoldings.push({
    id,
    holdingPlaceId: placeId,
    name: resolution.name,
    kind: resolution.requested.kind ?? 'OTHER',
    provenance: resolution.requested.provenance ?? 'RECORDED',
    lastConfirmedAt: undefined,
    isLiquid: resolution.requested.isLiquid === true,
    expectedReturn: undefined,
    termEndDate: undefined,
    feeBasisPoints: undefined,
    note: undefined,
    isArchived: false,
  })
}

/**
 * Create the places and holdings a plan resolved to, once each, keyed by the
 * name it named.
 *
 * Places first, because a holding belongs to one and a holding with a dangling
 * place id would be money Net worth has to render as "somewhere this
 * document does not have".
 */
interface MadeRecords {
  readonly places: ReadonlyMap<string, HoldingPlace>
  readonly holdings: ReadonlyMap<string, Holding>
}

function createTargets(
  document: OpenDocument,
  resolutions: readonly HoldingResolution[],
  now: number,
): MadeRecords {
  const places = new Map<string, HoldingPlace>()
  const holdings = new Map<string, Holding>()

  for (const resolution of resolutions) {
    if (resolution.kind !== 'NEW') continue
    const place = resolution.place
    if (place.kind !== 'NEW') continue
    const key = place.name.toLowerCase()
    if (places.has(key)) continue
    places.set(
      key,
      createHoldingPlace(
        document.db,
        {
          name: place.name,
          kind: place.requested.kind ?? 'OTHER',
          ...(place.requested.institution === undefined
            ? {}
            : { institution: place.requested.institution }),
        },
        now,
      ),
    )
  }

  for (const resolution of resolutions) {
    if (resolution.kind !== 'NEW') continue
    const key = resolution.name.toLowerCase()
    if (holdings.has(key)) continue

    const place = resolution.place
    // A place an earlier entry of this same call announced as new is known by its
    // placeholder id; written as it stood, the holding pointed at a place that never
    // existed and its money showed as "a holding this document no longer has" (M28 F10).
    const placeId =
      place.kind === 'EXISTING'
        ? place.place.id.startsWith(PENDING)
          ? places.get(place.place.id.slice(PENDING.length))?.id
          : place.place.id
        : place.kind === 'NEW'
          ? places.get(place.name.toLowerCase())?.id
          : undefined
    if (placeId === undefined) continue

    holdings.set(
      key,
      createHolding(
        document.db,
        {
          holdingPlaceId: placeId,
          name: resolution.name,
          kind: resolution.requested.kind ?? 'OTHER',
          provenance: resolution.requested.provenance ?? 'RECORDED',
          isLiquid: resolution.requested.isLiquid === true,
        },
        now,
      ),
    )
  }

  return { places, holdings }
}

function holdingIdOf(
  resolution: HoldingResolution,
  made: MadeRecords,
): string | undefined {
  if (resolution.kind === 'NEW') return made.holdings.get(resolution.name.toLowerCase())?.id
  if (resolution.kind !== 'EXISTING') return undefined

  const id = resolution.holding.id
  return id.startsWith(PENDING) ? made.holdings.get(id.slice(PENDING.length))?.id : id
}

function holdingLabel(resolution: HoldingResolution): string {
  switch (resolution.kind) {
    case 'EXISTING': {
      // A holding an earlier row already announced as new is just its name here.
      // Marking every row that names it reads as several holdings.
      const at = resolution.placeName === '' ? '' : `${resolution.placeName} · `
      return at + resolution.holding.name + (resolution.holding.isLiquid ? '' : ' (locked)')
    }
    case 'NEW':
      return `${resolution.name} — **new**${resolution.requested.isLiquid === true ? '' : ', locked'}`
    case 'REFUSED':
      return '—'
  }
}

const HOLDING_PROP = {
  type: 'object',
  description:
    'What the money is held in. `{ "id": … }` for a holding `savings` listed, or ' +
    '`{ "name": …, "kind": …, "is_liquid": …, "provenance": …, "place": … }` to create one. ' +
    '**Money always lands in a holding**, never in a bare place: the cash and the fixed deposit ' +
    'at one bank are two holdings, and only one of them is reachable this week.',
  properties: {
    id: stringProp('An existing holding, from `savings`.'),
    name: stringProp('The holding by name. A name matching nothing creates it.'),
    kind: stringProp(`One of ${HOLDING_KINDS.join(', ')}. Needed only when creating.`),
    is_liquid: booleanProp(
      'Whether the money is reachable this week. **The user’s answer, not the kind’s** — a ' +
        'fixed deposit with six months to run is not liquid. Needed only when creating.',
    ),
    provenance: stringProp(
      `One of ${HOLDING_PROVENANCES.join(', ')}: how the balance is known. RECORDED is the ` +
        'running total of what was entered and nothing will ever confirm it; TRANSCRIBED means a ' +
        'statement prints the figure; VALUED means holdings times a price. **Declared, never ' +
        'inferred** — a deposit with no statement transcribed yet is still TRANSCRIBED. Needed ' +
        'only when creating.',
    ),
    place: {
      type: 'object',
      description:
        'Where the money is — the bank or broker. `{ "id": … }` for a place `savings` listed, or ' +
        '`{ "name": …, "kind": … }` to create one. Needed only when creating the holding.',
      properties: {
        id: stringProp('An existing holding place, from `savings`.'),
        name: stringProp('The place by name. A name matching nothing creates it.'),
        kind: stringProp(`One of ${HOLDING_PLACE_KINDS.join(', ')}. Needed only when creating.`),
        institution: stringProp('Bank or broker. Free text.'),
      },
      required: [],
      additionalProperties: false,
    },
  },
  required: [],
  additionalProperties: false,
}

// --- create_goals ----------------------------------------------------

interface RequestedGoal {
  readonly name: string
  readonly kind: SavingGoalKind
  readonly targetMajor: number | undefined
  readonly targetDate: LocalDate | undefined
  readonly priority: number | undefined
  readonly note: string | undefined
  readonly holding: RequestedHolding | undefined
  /** *How much of it is already there?* (M30 F3), in major units, and the day it stands for. */
  readonly alreadyThereMajor: number | undefined
  readonly alreadyThereOn: LocalDate | undefined
  /** *Transfers into <account> are for this goal* (M30 F4). */
  readonly fromTransfers: boolean
}

interface GoalEntry {
  readonly requested: RequestedGoal
  readonly input: NewSavingGoal | undefined
  readonly holding: HoldingResolution | undefined
  readonly note: string | undefined
}

const GOAL_PROBLEM_TEXT: Readonly<Record<GoalProblem, string>> = {
  NO_NAME: 'the name is empty',
  NEGATIVE_TARGET: 'the target is negative',
}

function readGoals(args: Args): readonly RequestedGoal[] {
  const raw = args['goals']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`goals` must be a non-empty array, one entry per goal.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} goals; the ceiling is ${BATCH_MAX}.`)
  }

  return raw.map((entry, index) => {
    const where = `\`goals[${index}]\``
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`${where} must be an object.`)
    }
    const record = entry as Record<string, unknown>

    const name = optionalString(record, 'name')
    if (name === undefined) throw new ToolInputError(`${where} needs a \`name\`.`)

    // The goal form asks no kind (M36 U11), so a goal without one is EARMARKED, as the form makes it.
    const rawKind = optionalString(record, 'kind')?.toUpperCase() ?? 'EARMARKED'
    if (!SAVING_GOAL_KINDS.includes(rawKind as SavingGoalKind)) {
      throw new ToolInputError(`${where}.kind must be one of ${SAVING_GOAL_KINDS.join(', ')}.`)
    }

    const targetDateText = optionalString(record, 'target_date')
    const targetDate = targetDateText === undefined ? undefined : parseISODate(targetDateText)
    if (targetDateText !== undefined && targetDate === undefined) {
      throw new ToolInputError(`${where}.target_date must be YYYY-MM-DD; got "${targetDateText}".`)
    }

    const onText = optionalString(record, 'already_there_on')
    const alreadyThereOn = onText === undefined ? undefined : parseISODate(onText)
    if (onText !== undefined && alreadyThereOn === undefined) {
      throw new ToolInputError(`${where}.already_there_on must be YYYY-MM-DD; got "${onText}".`)
    }

    return {
      name,
      kind: rawKind as SavingGoalKind,
      alreadyThereMajor: optionalNumber(record, 'already_there'),
      alreadyThereOn,
      fromTransfers: record['from_transfers'] === true,
      targetMajor: optionalNumber(record, 'target_amount'),
      targetDate,
      priority: optionalNumber(record, 'priority'),
      note: optionalString(record, 'note'),
      holding: readHolding(record['default_holding'], `${where}.default_holding`),
    }
  })
}

function planGoals(document: OpenDocument, batch: readonly RequestedGoal[]): readonly GoalEntry[] {
  const currency = documentCurrency(document.db)
  const existingGoals = listGoals(document.db, { includeClosed: true })
  const places = [...listHoldingPlaces(document.db, { includeArchived: true })]
  const holdings = [...listHoldings(document.db, { includeArchived: true })]

  return batch.map((requested): GoalEntry => {
    const clash = existingGoals.find(
      (goal) => goal.name.trim().toLowerCase() === requested.name.trim().toLowerCase(),
    )
    if (clash !== undefined) {
      return refusedGoal(
        requested,
        `a goal called "${clash.name}" already exists. Deposits go to it with ` +
          '`record_deposits`; changing a goal is app-only, at `#/wealth/goals`',
      )
    }

    const holding =
      requested.holding === undefined
        ? undefined
        : resolveHolding(requested.holding, holdings, places)
    if (holding?.kind === 'REFUSED') return refusedGoal(requested, holding.why)
    if (holding !== undefined) carryForward(holdings, places, holding)

    // Judged as the record it will become, so the preview refuses exactly what
    // the app's form refuses.
    const problems = validateGoal({
      id: '',
      name: requested.name,
      kind: requested.kind,
      targetAmount:
        requested.targetMajor === undefined
          ? undefined
          : fromMajorUnits(requested.targetMajor, currency),
      targetDate: requested.targetDate,
      defaultHoldingId: undefined,
      isClosed: false,
      priority: requested.priority ?? 0,
      note: requested.note,
    })
    if (problems.length > 0) {
      return refusedGoal(requested, problems.map((one) => GOAL_PROBLEM_TEXT[one]).join('; '))
    }
    if (requested.alreadyThereMajor !== undefined && holding === undefined) {
      return refusedGoal(requested, '`already_there` needs a `default_holding`: the money is somewhere')
    }
    if (requested.fromTransfers && (holding?.kind !== 'EXISTING' || holding.holding.id.startsWith(PENDING))) {
      return refusedGoal(requested, '`from_transfers` needs a bank account’s own Cash in `default_holding`')
    }
    // The same judgement the goal form shows (M30 F3): money typed into a holding its
    // rows feed, or a holding another goal already follows, is refused here as there.
    if (holding?.kind === 'EXISTING' && !holding.holding.id.startsWith(PENDING)) {
      const why = goalAnswerProblem(document.db, {
        name: requested.name,
        kind: requested.kind,
        where: { kind: 'HOLDING', holdingId: holding.holding.id },
        transfersIn: requested.fromTransfers,
        ...(requested.alreadyThereMajor === undefined
          ? {}
          : { alreadyThere: { amount: fromMajorUnits(requested.alreadyThereMajor, currency), date: today() } }),
      })
      if (why !== undefined) return refusedGoal(requested, why)
    }

    return {
      requested,
      holding,
      note: undefined,
      input: {
        name: requested.name,
        kind: requested.kind,
        ...(requested.targetMajor === undefined
          ? {}
          : { targetAmount: fromMajorUnits(requested.targetMajor, currency) }),
        ...(requested.targetDate === undefined ? {} : { targetDate: requested.targetDate }),
        ...(requested.priority === undefined ? {} : { priority: requested.priority }),
        ...(requested.note === undefined ? {} : { note: requested.note }),
      },
    }
  })
}

function refusedGoal(requested: RequestedGoal, why: string): GoalEntry {
  return { requested, input: undefined, holding: undefined, note: why }
}

function goalTable(entries: readonly GoalEntry[]): string {
  return table(
    ['Goal', 'Kind', 'Target', 'By', 'Default holding', 'What happens'],
    entries.map((entry) => [
      entry.requested.name,
      entry.requested.kind,
      entry.input?.targetAmount === undefined ? '— (open-ended)' : money(entry.input.targetAmount),
      date(entry.requested.targetDate),
      entry.holding === undefined ? '—' : holdingLabel(entry.holding),
      entry.note ?? 'created',
    ]),
  )
}

export const createSavingGoalsTool: PluginTool = {
  definition: {
    name: 'create_goals',
    title: 'Create goals',
    description:
      'Add goals — **several in one call**. A goal has a name; a target amount ' +
      'and a target date are optional, and an open-ended goal is a real answer. Its kind is optional and ' +
      'drives nothing (EARMARKED when left out, as the goal form makes it); how many months of expenses ' +
      'the bank should hold is the cushion (`set_cushion`). ' +
      '**Dry-runs by default**; the document is copied to a timestamped .bak ' +
      'before anything is written. **The goal form’s one question is `default_holding`**: a bank account’s ' +
      'Cash, a place kept by hand or a new one takes `already_there`; a holding a broker’s rows buy is ' +
      'followed by its rows, with nothing to type; a bank account’s Cash can count the transfers into it ' +
      '(`from_transfers`). Editing, closing and deleting a goal are app-only, except its default holding (`set_goal_deposit_categories`).',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        goals: {
          type: 'array',
          description: `One entry per goal. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              name: stringProp('What the user calls it.'),
              kind: stringProp(`Optional, and drives nothing: one of ${SAVING_GOAL_KINDS.join(', ')}.`),
              target_amount: numberProp(
                'What they are aiming for, in major units. Leave out for an open-ended goal.',
              ),
              target_date: stringProp('When they want it by, as YYYY-MM-DD.'),
              priority: numberProp(
                'Lower is funded first by the splitter. Defaults to last, because a goal added ' +
                  'today has not earned a place above the rent.',
              ),
              default_holding: HOLDING_PROP,
              already_there: numberProp(
                'How much of the money is already there, in major units — the goal form’s "How much of it ' +
                  'is already there?". Written as a Was already there deposit into `default_holding`. Not for ' +
                  'a holding bought by rows: a goal on one follows its rows, and those are its deposits.',
              ),
              already_there_on: stringProp('The day `already_there` stands for, as YYYY-MM-DD. Default today.'),
              from_transfers: booleanProp(
                'The goal form’s "Transfers into <account> are for this goal": with a bank or cash account’s ' +
                  'Cash as `default_holding`, every confirmed transfer arriving there after `already_there` is a ' +
                  'deposit, one leaving it a withdrawal. Off unless the user says the account is for this goal.',
              ),
              note: stringProp('Anything worth keeping about the goal.'),
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'goals'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readGoals(args)

    const mutation: Mutation<readonly GoalEntry[]> = {
      plan: (document) => planGoals(document, batch),
      describe: (entries) => {
        const doing = entries.filter((entry) => entry.input !== undefined)
        return paragraphs(
          doing.length === 0
            ? '**Nothing to create.** The reasons are in the table.'
            : `**${plural(doing.length, 'goal')}** would be created.`,
          goalTable(entries),
        )
      },
      apply: (document, entries) => {
        const now = Date.now()
        const made = createTargets(
          document,
          entries.map((entry) => entry.holding).filter((one) => one !== undefined),
          now,
        )
        const done: string[][] = []

        for (const entry of entries) {
          if (entry.input === undefined) continue
          const holdingId =
            entry.holding === undefined ? undefined : holdingIdOf(entry.holding, made)
          const input = entry.input
          const already = entry.requested.alreadyThereMajor
          // One write per goal, the form's (M30 F3): the goal, the money already there, and
          // its rows followed when the holding is bought by them.
          const goal = saveGoalAnswer(
            document.db,
            {
              name: input.name,
              kind: input.kind,
              targetAmount: input.targetAmount,
              targetDate: input.targetDate,
              note: input.note,
              priority: input.priority,
              where: holdingId === undefined ? undefined : { kind: 'HOLDING', holdingId },
              transfersIn: entry.requested.fromTransfers,
              alreadyThere:
                already === undefined
                  ? undefined
                  : {
                      amount: fromMajorUnits(already, documentCurrency(document.db)),
                      date: entry.requested.alreadyThereOn ?? today(),
                    },
            },
            now,
          )
          const fed = goalFeeds(document.db).get(goal.id)
          done.push([
            goal.name,
            goal.kind,
            String(goal.priority),
            already === undefined ? '—' : money(fromMajorUnits(already, documentCurrency(document.db))),
            fed?.kind === 'HOLDING'
              ? `follows ${fed.name}'s rows`
              : fed?.kind === 'TRANSFERS'
                ? `the transfers into ${fed.name}`
                : '—',
          ])
        }

        const refusals = entries.filter((entry) => entry.note !== undefined)
        return paragraphs(
          `Created ${plural(done.length, 'goal')}.`,
          done.length === 0 ? undefined : table(['Goal', 'Kind', 'Priority', 'Already there', 'Deposits'], done),
          refusals.length === 0
            ? undefined
            : `Refused: ${refusals.map((entry) => `${entry.requested.name} — ${entry.note ?? ''}`).join('; ')}.`,
          '`record_deposits` puts money in them; `savings` shows the balances.',
        )
      },
    }

    return mutatingCall(path, args['commit'] === true, mutation)
  },
}

// --- record_deposits --------------------------------------------------------

interface RequestedDeposit {
  readonly goal: string
  readonly mode: DepositMode
  readonly amountMajor: number
  readonly date: LocalDate
  readonly holding: RequestedHolding
  readonly toHolding: RequestedHolding | undefined
  readonly note: string | undefined
}

interface DepositEntry {
  readonly requested: RequestedDeposit
  readonly goalId: string | undefined
  readonly goalName: string
  readonly amount: Money | undefined
  readonly holding: HoldingResolution | undefined
  readonly toHolding: HoldingResolution | undefined
  readonly warning: string | undefined
  readonly note: string | undefined
}

const DEPOSIT_PROBLEM_TEXT: Readonly<Record<DepositProblem, string>> = {
  UNKNOWN_GOAL: 'no such goal',
  ZERO_AMOUNT: 'the amount is zero',
  CLOSED_GOAL: 'that goal is closed — reopening it is app-only, at `#/wealth/goals`',
  UNKNOWN_HOLDING: 'no such holding place',
  WITHDRAWAL_WITHOUT_REASON:
    'money out has to say why, in `note`. It is stored as a negative deposit, and without a ' +
    'reason nothing on the row tells a withdrawal from a correction',
  MIXED_CURRENCY: 'the amount is not in the goal’s currency',
}

function readDeposits(args: Args): readonly RequestedDeposit[] {
  const raw = args['deposits']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`deposits` must be a non-empty array, one entry per movement.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} movements; the ceiling is ${BATCH_MAX}.`)
  }

  return raw.map((entry, index) => {
    const where = `\`deposits[${index}]\``
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`${where} must be an object.`)
    }
    const record = entry as Record<string, unknown>

    const goal = optionalString(record, 'goal')
    if (goal === undefined) {
      throw new ToolInputError(`${where} needs a \`goal\` — an id or a name from \`savings\`.`)
    }

    const rawMode = optionalString(record, 'mode')?.toUpperCase() ?? 'DEPOSIT'
    if (!DEPOSIT_MODES.includes(rawMode as DepositMode)) {
      throw new ToolInputError(`${where}.mode must be one of ${DEPOSIT_MODES.join(', ')}.`)
    }

    const amountMajor = optionalNumber(record, 'amount')
    if (amountMajor === undefined) {
      throw new ToolInputError(`${where} needs an \`amount\`.`)
    }
    if (amountMajor < 0) {
      throw new ToolInputError(
        `${where}.amount must be positive. **The mode carries the direction, not a minus sign** — ` +
          'use WITHDRAWAL for money out and LOSS for a fall in value.',
      )
    }

    const dateText = optionalString(record, 'date')
    const parsed = dateText === undefined ? undefined : parseISODate(dateText)
    if (parsed === undefined) {
      throw new ToolInputError(`${where}.date is required, as YYYY-MM-DD.`)
    }

    const holding = readHolding(record['holding'], `${where}.holding`)
    if (holding === undefined) {
      throw new ToolInputError(`${where} needs a \`holding\` — what the money is held in.`)
    }
    const toHolding = readHolding(record['to_holding'], `${where}.to_holding`)
    if (rawMode === 'TRANSFER' && toHolding === undefined) {
      throw new ToolInputError(
        `${where} is a TRANSFER and needs a \`to_holding\` as well as a \`holding\`.`,
      )
    }

    return {
      goal,
      mode: rawMode as DepositMode,
      amountMajor,
      date: parsed,
      holding,
      toHolding,
      note: optionalString(record, 'note'),
    }
  })
}

function planDeposits(
  document: OpenDocument,
  batch: readonly RequestedDeposit[],
): readonly DepositEntry[] {
  const currency = documentCurrency(document.db)
  const goals = listGoals(document.db, { includeClosed: true })
  const places = [...listHoldingPlaces(document.db, { includeArchived: true })]
  const holdings = [...listHoldings(document.db, { includeArchived: true })]
  // What the batch itself would put in each goal, so "more than the goal holds"
  // is judged against the balance as this call would leave it. Without it a
  // withdrawal after an opening balance in the same batch warns falsely, which
  // is the same carry-forward the holdings needed.
  const pending = new Map<string, SavingDeposit[]>()

  return batch.map((requested, index): DepositEntry => {
    const goal = goals.find(
      (one) =>
        one.id === requested.goal ||
        one.name.trim().toLowerCase() === requested.goal.trim().toLowerCase(),
    )
    if (goal === undefined) {
      return refusedDeposit(
        requested,
        `no goal called "${requested.goal}". \`savings\` lists them; \`create_goals\` ` +
          'makes one. Nothing here creates a goal by accident — a typo would split a balance in two',
      )
    }

    const holding = resolveHolding(requested.holding, holdings, places)
    if (holding.kind === 'REFUSED') return refusedDeposit(requested, holding.why)
    carryForward(holdings, places, holding)

    const toHolding =
      requested.toHolding === undefined
        ? undefined
        : resolveHolding(requested.toHolding, holdings, places)
    if (toHolding?.kind === 'REFUSED') return refusedDeposit(requested, toHolding.why)
    if (toHolding !== undefined) carryForward(holdings, places, toHolding)

    const amount = signedAmount(
      requested.mode,
      fromMajorUnits(requested.amountMajor, currency).minor,
      currency,
    )
    // Judged as the row it will become. The closed goal, the missing reason and
    // the zero are all the domain's own answers rather than a second opinion
    // here; `holdings` already carries anything this batch would create.
    const candidate: SavingDeposit = {
      id: `pending:${String(index)}`,
      goalId: goal.id,
      date: requested.date,
      amount,
      holdingId: holding.kind === 'EXISTING' ? holding.holding.id : pendingId(holding.name),
      sourceKind: sourceKindFor(requested.mode),
      sourceRefId: undefined,
      transferGroupKey: undefined,
      note: requested.note,
    }
    const problems = validateDeposit(candidate, { goal, holdings })
    if (problems.length > 0) {
      return refusedDeposit(
        requested,
        problems.map((one) => DEPOSIT_PROBLEM_TEXT[one]).join('; '),
      )
    }

    const already = pending.get(goal.id) ?? []
    const warnings =
      requested.mode === 'TRANSFER'
        ? []
        : depositWarnings(candidate, [
            ...listDeposits(document.db, { goalId: goal.id }),
            ...already,
          ])
    // A transfer nets to zero, so it changes no balance a later entry is judged
    // against and is deliberately not carried.
    if (requested.mode !== 'TRANSFER') pending.set(goal.id, [...already, candidate])

    return {
      requested,
      goalId: goal.id,
      goalName: goal.name,
      amount,
      holding,
      toHolding,
      warning: warnings.length === 0 ? undefined : 'takes out more than the goal holds',
      note: undefined,
    }
  })
}

function refusedDeposit(requested: RequestedDeposit, why: string): DepositEntry {
  return {
    requested,
    goalId: undefined,
    goalName: requested.goal,
    amount: undefined,
    holding: undefined,
    toHolding: undefined,
    warning: undefined,
    note: why,
  }
}

const MODE_TEXT: Readonly<Record<DepositMode, string>> = {
  DEPOSIT: 'money in',
  WITHDRAWAL: 'money out',
  TRANSFER: 'moved between holdings',
  OPENING: 'already there when tracking started',
  GAIN: 'it grew',
  LOSS: 'it fell',
}

export const recordDepositsTool: PluginTool = {
  definition: {
    name: 'record_deposits',
    title: 'Record savings movements',
    description:
      'Record money moving in a goal — **several in one call**. Six modes: DEPOSIT, ' +
      'WITHDRAWAL, TRANSFER between holdings, OPENING for what was already there when tracking ' +
      'started, and GAIN / LOSS for what the market did. **The mode carries the direction; the ' +
      'amount is always positive.** OPENING, GAIN and LOSS are in the balance but are not money ' +
      'the user set aside, so they are kept out of the savings rate. **Dry-runs by default**; the ' +
      'document is copied to a timestamped .bak first. Editing and deleting a movement are app-only. ' +
      'A DEPOSIT here is money **set aside** by hand, still inside the bank; deposits **read from the ' +
      'bank** come from the Money moved category a goal reads (`set_goal_deposit_categories`).',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        deposits: {
          type: 'array',
          description: `One entry per movement. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              goal: stringProp('The goal, by id or by name. It must already exist.'),
              mode: stringProp(
                `One of ${DEPOSIT_MODES.join(', ')}. Default DEPOSIT. WITHDRAWAL and LOSS store a ` +
                  'negative amount; TRANSFER writes two legs that cancel out.',
              ),
              amount: numberProp('Always positive, in major units. The mode decides the sign.'),
              date: stringProp('YYYY-MM-DD.'),
              holding: HOLDING_PROP,
              to_holding: HOLDING_PROP,
              note: stringProp(
                'Required for WITHDRAWAL — a balance that dropped for no recorded reason is what ' +
                  'makes people stop trusting the number. A LOSS needs none: the mode is the why.',
              ),
            },
            required: ['goal', 'amount', 'date', 'holding'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'deposits'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readDeposits(args)

    const mutation: Mutation<readonly DepositEntry[]> = {
      plan: (document) => planDeposits(document, batch),
      describe: (entries) => {
        const doing = entries.filter((entry) => entry.goalId !== undefined)
        const warned = doing.filter((entry) => entry.warning !== undefined)
        const uncounted = doing.filter((entry) =>
          ['OPENING', 'GAIN', 'LOSS'].includes(entry.requested.mode),
        )

        return paragraphs(
          doing.length === 0
            ? '**Nothing to record.** The reasons are in the table.'
            : `**${plural(doing.length, 'movement')}** would be recorded.`,
          table(
            ['Goal', 'What', 'Amount', 'Date', 'Held in', 'Note'],
            entries.map((entry) => [
              entry.goalName,
              MODE_TEXT[entry.requested.mode],
              money(entry.amount),
              date(entry.requested.date),
              entry.holding === undefined
                ? '—'
                : entry.toHolding === undefined
                  ? holdingLabel(entry.holding)
                  : `${holdingLabel(entry.holding)} → ${holdingLabel(entry.toHolding)}`,
              entry.note ?? entry.warning ?? entry.requested.note ?? '—',
            ]),
          ),
          uncounted.length === 0
            ? undefined
            : `${plural(uncounted.length, 'movement')} ${verb(uncounted.length, 'is', 'are')} in ` +
              'the balance but **not a contribution**: an opening balance was set aside before ' +
              'the app existed, and a gain was not set aside by anyone. Both stay out of the ' +
              'savings rate and the required-monthly figure.',
          warned.length === 0
            ? undefined
            : `${plural(warned.length, 'withdrawal')} ${verb(warned.length, 'takes', 'take')} ` +
              'out more than the goal holds. That is allowed — the records may simply be ' +
              'incomplete — but it is worth checking.',
          doing.some((entry) => entry.requested.mode === 'TRANSFER')
            ? 'A move writes two legs that net to zero, so the goal’s balance does not change — ' +
              'only what is reachable does.'
            : undefined,
        )
      },
      apply: (document, entries) => {
        const now = Date.now()
        const made = createTargets(
          document,
          entries.flatMap((entry) =>
            [entry.holding, entry.toHolding].filter((one) => one !== undefined),
          ),
          now,
        )
        const done: string[][] = []

        for (const entry of entries) {
          if (
            entry.goalId === undefined ||
            entry.amount === undefined ||
            entry.holding === undefined
          ) {
            continue
          }
          const holdingId = holdingIdOf(entry.holding, made)
          if (holdingId === undefined) continue

          if (entry.requested.mode === 'TRANSFER') {
            const toId =
              entry.toHolding === undefined ? undefined : holdingIdOf(entry.toHolding, made)
            if (toId === undefined) continue
            recordTransfer(
              document.db,
              {
                goalId: entry.goalId,
                date: entry.requested.date,
                amount: entry.amount,
                fromHoldingId: holdingId,
                toHoldingId: toId,
                ...(entry.requested.note === undefined ? {} : { note: entry.requested.note }),
              },
              now,
            )
          } else {
            addDeposit(
              document.db,
              {
                goalId: entry.goalId,
                date: entry.requested.date,
                amount: entry.amount,
                holdingId,
                sourceKind: sourceKindFor(entry.requested.mode),
                ...(entry.requested.note === undefined ? {} : { note: entry.requested.note }),
              },
              now,
            )
          }
          done.push([
            entry.goalName,
            MODE_TEXT[entry.requested.mode],
            money(entry.amount),
            date(entry.requested.date),
          ])
        }

        const refusals = entries.filter((entry) => entry.note !== undefined)
        const newHoldings = [...made.holdings.values()].map((holding) => holding.name)

        return paragraphs(
          `Recorded ${plural(done.length, 'movement')}` +
            (newHoldings.length === 0
              ? '.'
              : `, and created ${plural(newHoldings.length, 'holding')}: ${newHoldings.join(', ')}.`),
          done.length === 0 ? undefined : table(['Goal', 'What', 'Amount', 'Date'], done),
          refusals.length === 0
            ? undefined
            : `Refused: ${refusals.map((entry) => `${entry.goalName} — ${entry.note ?? ''}`).join('; ')}.`,
          '`savings` shows the balances, net worth and its parts, and where the money is.',
        )
      },
    }

    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
