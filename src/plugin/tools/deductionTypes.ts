/**
 * `set_deduction_types` — the conversation half of the deduction types screen
 * (M36 F1, D-391; M36 F2, D-392).
 *
 * **This link is how a fund finds its payslip lines.** A pension line is a
 * deposit into a fund only because its deduction type names the fund
 * (`deduction_type.linked_holding`, D-389); a type that names nothing leaves
 * every fund answering that it has no payslips behind it. Until F1 the link had
 * a screen and no tool, against D-227.
 *
 * **And since F2, the rest of the screen**: a new type (its name, what the slip
 * calls it, its kind), a rename, a kind, a removal and the picker's order, so a
 * conversation can make the loan-repayment type a payroll loan needs and point
 * it at the loan in the same call. One list, one dry run, whole or nothing.
 *
 * **The screen's writes, and its refusals by name**: `createDeductionType`,
 * `updateDeductionType` (a kind change through `kindChange`, so the flags follow
 * while they are still the kind's guess), `deleteDeductionType`,
 * `reorderDeductionTypes`, and then `syncPayroll` as the screen runs it after a
 * link, so a debt's payments exist before anybody looks. A fund or a goal takes
 * a line that counts as saving and a debt a loan repayment; a built-in, a type
 * a stored payslip line names, and a type another row links to are not removed.
 */

import { listDebts } from '@/data/repositories/debtRepository.ts'
import {
  createDeductionType,
  deductionTypeUsageCounts,
  deleteDeductionType,
  listDeductionTypes,
  reorderDeductionTypes,
  updateDeductionType,
  type DeductionTypeEdit,
} from '@/data/repositories/deductionTypeRepository.ts'
import { linkingSentences, rowsLinkingTo } from '@/data/repositories/formatRowRepository.ts'
import { listFunds } from '@/data/repositories/fundRepository.ts'
import { syncPayroll } from '@/data/repositories/payrollSyncRepository.ts'
import { listGoals } from '@/data/repositories/savingsRepository.ts'
import { allDeclared, declared } from '@/data/packs/ledger/tables.ts'
import { DEDUCTION_KINDS, type DeductionKind, type DeductionType } from '@/domain/model/paycheck.ts'
import { countsAsWords, defaultFlags, flagsAsGuessed, KIND_LABEL, kindChange } from '@/domain/paycheckEntry.ts'

import { type OpenDocument } from '../document.ts'
import { paragraphs, plural, table } from '../format.ts'
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

const BATCH_MAX = 60

/** The *Counts as* answers, as the screen says them, plus the kind's own guess. */
const COUNTS_AS = {
  out_of_net_saving: { reducesNet: true, countsAsSaving: true },
  out_of_net: { reducesNet: true, countsAsSaving: false },
  saving: { reducesNet: false, countsAsSaving: true },
  not_cash: { reducesNet: false, countsAsSaving: false },
} as const
type CountsAs = keyof typeof COUNTS_AS | 'guess'
const COUNTS_AS_VALUES: readonly CountsAs[] = [...(Object.keys(COUNTS_AS) as (keyof typeof COUNTS_AS)[]), 'guess']

type TargetKind = 'fund' | 'goal' | 'debt'
const TARGET_KINDS: readonly TargetKind[] = ['fund', 'goal', 'debt']

type Flags = { readonly reducesNet: boolean; readonly countsAsSaving: boolean }

interface Requested {
  /** An existing type, by id or name; `undefined` makes a new one. */
  readonly type: string | undefined
  /** The new type's name, or an existing one's new name. */
  readonly name: string | undefined
  /** `undefined` leaves it; `null` clears it. */
  readonly onTheSlip: string | null | undefined
  readonly kind: DeductionKind | undefined
  readonly countsAs: CountsAs | undefined
  /** `undefined` leaves it; `null` unlinks. */
  readonly paysInto: string | null | undefined
  readonly paysIntoKind: TargetKind | undefined
  readonly remove: boolean
}

interface Target {
  readonly kind: TargetKind
  readonly id: string
  readonly name: string
}

interface Entry {
  readonly typeName: string
  readonly change: string
  /** The type it changes or removes; `undefined` for a new one. */
  readonly type: DeductionType | undefined
  readonly remove: boolean
  readonly name: string | undefined
  readonly onTheSlip: string | null | undefined
  readonly kind: DeductionKind
  readonly kindChanged: boolean
  /** Written when defined — always for a new type. */
  readonly flags: Flags | undefined
  /** `undefined` leaves the link; `null` unlinks. */
  readonly target: Target | null | undefined
  readonly countsNow: string
  readonly countsThen: string
  readonly paysNow: string
  readonly paysThen: string
  readonly note: string | undefined
}

interface Plan {
  readonly entries: readonly Entry[]
  /** The ids (or `new:<index>` for a type this call makes) to put first, in order. */
  readonly order: readonly string[] | undefined
  readonly orderNames: readonly string[]
  readonly orderProblems: readonly string[]
}

function text(record: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new ToolInputError(`\`${where}.${key}\` must be a non-empty string.`)
  return value.trim()
}

function readBatch(args: Args): { readonly batch: readonly Requested[]; readonly order: readonly string[] | undefined } {
  const raw = args['types'] ?? []
  const rawOrder = args['order']
  if (!Array.isArray(raw)) throw new ToolInputError('`types` must be an array, one entry per deduction type.')
  if (rawOrder !== undefined && (!Array.isArray(rawOrder) || rawOrder.length === 0 || rawOrder.some((one) => typeof one !== 'string' || one.trim() === ''))) {
    throw new ToolInputError('`order` must be a non-empty array of deduction types, by id or by name.')
  }
  if (raw.length === 0 && rawOrder === undefined) {
    throw new ToolInputError('Give `types` (one entry per deduction type), `order`, or both.')
  }
  if (raw.length > BATCH_MAX) throw new ToolInputError(`That is ${raw.length} entries; the ceiling is ${BATCH_MAX}.`)

  const batch = raw.map((entry, index): Requested => {
    const where = `types[${index}]`
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`\`${where}\` must be an object.`)
    const record = entry as Record<string, unknown>
    const type = text(record, 'type', where)
    const name = text(record, 'name', where)

    const slip = record['on_the_slip']
    if (slip !== undefined && slip !== null && (typeof slip !== 'string' || slip.trim() === '')) {
      throw new ToolInputError(`\`${where}.on_the_slip\` is what the paycheck calls it, or null to clear it.`)
    }
    const kind = record['kind']
    if (kind !== undefined && !DEDUCTION_KINDS.includes(kind as DeductionKind)) {
      throw new ToolInputError(`\`${where}.kind\` is one of ${DEDUCTION_KINDS.join(', ')}.`)
    }
    const counts = record['counts_as']
    if (counts !== undefined && !COUNTS_AS_VALUES.includes(counts as CountsAs)) {
      throw new ToolInputError(`\`${where}.counts_as\` is one of ${COUNTS_AS_VALUES.join(', ')}.`)
    }
    const pays = record['pays_into']
    if (pays !== undefined && pays !== null && (typeof pays !== 'string' || pays.trim() === '')) {
      throw new ToolInputError(`\`${where}.pays_into\` is a fund, goal or debt by id or name, or null to link nothing.`)
    }
    const targetKind = record['pays_into_kind']
    if (targetKind !== undefined && !TARGET_KINDS.includes(targetKind as TargetKind)) {
      throw new ToolInputError(`\`${where}.pays_into_kind\` is one of ${TARGET_KINDS.join(', ')}.`)
    }
    const remove = record['remove']
    if (remove !== undefined && typeof remove !== 'boolean') throw new ToolInputError(`\`${where}.remove\` is true or left out.`)

    const says = [name, slip, kind, counts, pays].some((value) => value !== undefined)
    if (remove === true) {
      if (type === undefined) throw new ToolInputError(`\`${where}\` removes a type, so it needs \`type\`, by id or by name.`)
      if (says || targetKind !== undefined) throw new ToolInputError(`\`${where}\` removes ${type}, and takes nothing else.`)
    } else if (type === undefined) {
      if (name === undefined || kind === undefined) {
        throw new ToolInputError(`\`${where}\` makes a new type, so it needs a \`name\` and a \`kind\` — or give \`type\` to change one there is.`)
      }
    } else if (!says) {
      throw new ToolInputError(
        `\`${where}\` says nothing to set: give \`name\`, \`on_the_slip\`, \`kind\`, \`counts_as\`, \`pays_into\` or \`remove\`.`,
      )
    }
    return {
      type,
      name,
      onTheSlip: slip === undefined ? undefined : slip === null ? null : (slip as string).trim(),
      kind: kind as DeductionKind | undefined,
      countsAs: counts as CountsAs | undefined,
      paysInto: pays === undefined ? undefined : pays === null ? null : (pays as string).trim(),
      paysIntoKind: targetKind as TargetKind | undefined,
      remove: remove === true,
    }
  })
  return { batch, order: rawOrder === undefined ? undefined : (rawOrder as string[]).map((one) => one.trim()) }
}

function same(wanted: string, id: string, ...names: (string | null | undefined)[]): boolean {
  if (wanted === id) return true
  const lower = wanted.trim().toLowerCase()
  return names.some((name) => typeof name === 'string' && name.trim().toLowerCase() === lower)
}

function countsWords(flags: Flags, kind: DeductionKind): string {
  const words = countsAsWords(flags)
  return flagsAsGuessed({ kind, ...flags }) ? words : `${words} (set by hand)`
}

function planBatch(document: OpenDocument, batch: readonly Requested[], order: readonly string[] | undefined): Plan {
  const db = document.db
  const types = listDeductionTypes(db)
  const usage = deductionTypeUsageCounts(db)
  // Archived, closed and all: the screen offers them, and a link may already name one.
  const targets: readonly Target[] = [
    ...listFunds(db, { includeArchived: true }).map((one) => ({ kind: 'fund' as const, id: one.id, name: one.name })),
    ...listGoals(db, { includeClosed: true }).map((one) => ({ kind: 'goal' as const, id: one.id, name: one.name })),
    ...listDebts(db, { includeClosed: true }).map((one) => ({ kind: 'debt' as const, id: one.id, name: one.name })),
  ]
  const linkOf = (type: DeductionType): string => {
    const found =
      type.linkedFundId !== undefined
        ? targets.find((one) => one.kind === 'fund' && one.id === type.linkedFundId)
        : type.linkedSavingGoalId !== undefined
          ? targets.find((one) => one.kind === 'goal' && one.id === type.linkedSavingGoalId)
          : type.linkedDebtId !== undefined
            ? targets.find((one) => one.kind === 'debt' && one.id === type.linkedDebtId)
            : undefined
    const id = type.linkedFundId ?? type.linkedSavingGoalId ?? type.linkedDebtId
    if (id === undefined) return '—'
    return found === undefined ? id : `${found.kind}: ${found.name}`
  }

  const found = batch.map((one) => (one.type === undefined ? undefined : types.find((candidate) => same(one.type ?? '', candidate.id, candidate.name, candidate.hebrewName))))
  const removed = new Set(batch.flatMap((one, index) => (one.remove && found[index] !== undefined ? [(found[index] as DeductionType).id] : [])))
  // What each type will be called once the batch is in, for the name checks and `order`.
  const finalName = (index: number): string | undefined => batch[index]?.name ?? found[index]?.name
  const renamedIn = new Map<string, number>()
  batch.forEach((one, index) => {
    const type = found[index]
    if (type !== undefined && !one.remove) renamedIn.set(type.id, index)
  })
  const seen = new Set<string>()

  const entries = batch.map((one, index): Entry => {
    const type = found[index]
    const blank = {
      typeName: one.type ?? one.name ?? '',
      change: '',
      type,
      remove: one.remove,
      name: one.name,
      onTheSlip: one.onTheSlip,
      kind: one.kind ?? type?.kind ?? 'OTHER_DEDUCTION',
      kindChanged: false,
      flags: undefined,
      target: undefined,
      countsNow: '—',
      countsThen: '—',
      paysNow: '—',
      paysThen: '—',
    }
    if (one.type !== undefined && type === undefined) {
      return { ...blank, note: `no deduction type called "${one.type}"; \`paychecks\` lists them with their ids` }
    }
    if (type !== undefined) {
      if (seen.has(type.id)) return { ...blank, typeName: type.name, note: `${type.name} is named twice in this call` }
      seen.add(type.id)
    }

    // Removal: the screen's refusals, by name, before anything is written.
    if (one.remove && type !== undefined) {
      const base = { ...blank, typeName: type.name, change: 'removed', countsNow: countsWords(type, type.kind), paysNow: linkOf(type) }
      if (type.isBuiltIn) {
        return { ...base, note: `${type.name} is built in, and a built-in type is never removed: rename it, or leave it out of your paychecks` }
      }
      const lines = usage.get(type.id) ?? 0
      if (lines > 0) {
        return { ...base, note: `${plural(lines, 'stored paycheck line')} ${lines === 1 ? 'names' : 'name'} ${type.name}; remove those lines first` }
      }
      const declaration = declared(db, 'deduction_type')
      const linking = rowsLinkingTo(db, declaration, [type.id], allDeclared(db))
      if (linking.length > 0) return { ...base, note: linkingSentences(db, declaration, linking).join(' ') }
      return { ...base, note: undefined }
    }

    // The name it will have, against every other type's: `name` is unique, and
    // this tool finds a type by its name without minding case.
    const name = finalName(index) ?? ''
    const clash =
      one.name === undefined
        ? undefined
        : types.find((other) => other.id !== type?.id && !removed.has(other.id) && same(name, '', other.name)) !== undefined ||
            batch.some((_, other) => other !== index && !batch[other]?.remove && same(name, '', finalName(other)))
          ? `there is already a deduction type called ${name}`
          : undefined

    const kind = one.kind ?? type?.kind ?? 'OTHER_DEDUCTION'
    const current: Flags | undefined = type === undefined ? undefined : { reducesNet: type.reducesNet, countsAsSaving: type.countsAsSaving }
    // A new type starts as its kind's guess, as the screen's Add does; a kind
    // change carries the flags along while they are still the guess.
    const carried = type === undefined ? undefined : kindChange(type, kind)
    const following: Flags =
      type === undefined || carried === undefined || current === undefined
        ? defaultFlags(kind)
        : {
            reducesNet: carried.reducesNet ?? current.reducesNet,
            countsAsSaving: carried.countsAsSaving ?? current.countsAsSaving,
          }
    const flags: Flags =
      one.countsAs === undefined ? following : one.countsAs === 'guess' ? defaultFlags(kind) : COUNTS_AS[one.countsAs]
    const flagsWritten = type === undefined || one.countsAs !== undefined || (one.kind !== undefined && one.kind !== type.kind)

    const changes: string[] = []
    if (type === undefined) {
      changes.push(`new: ${KIND_LABEL[kind]}`)
    } else {
      if (one.name !== undefined && one.name !== type.name) changes.push(`renamed ${one.name}`)
      if (one.kind !== undefined && one.kind !== type.kind) changes.push(`kind ${KIND_LABEL[kind]}`)
    }
    if (one.onTheSlip !== undefined && one.onTheSlip !== (type?.hebrewName ?? null)) {
      changes.push(one.onTheSlip === null ? 'nothing on the paycheck' : `on the paycheck: ${one.onTheSlip}`)
    }

    const base = {
      ...blank,
      typeName: type?.name ?? name,
      change: changes.join('; '),
      kind,
      kindChanged: type !== undefined && one.kind !== undefined && one.kind !== type.kind,
      flags: flagsWritten ? flags : undefined,
      countsNow: current === undefined || type === undefined ? '—' : countsWords(current, type.kind),
      countsThen: countsWords(flags, kind),
      paysNow: type === undefined ? '—' : linkOf(type),
    }
    if (clash !== undefined) return { ...base, target: undefined, paysThen: base.paysNow, note: clash }

    if (one.paysInto === undefined) return { ...base, target: undefined, paysThen: base.paysNow, note: undefined }
    if (one.paysInto === null) return { ...base, target: null, paysThen: '—', note: undefined }

    const wanted = one.paysInto
    const matches = targets.filter(
      (target) => (one.paysIntoKind === undefined || target.kind === one.paysIntoKind) && same(wanted, target.id, target.name),
    )
    if (matches.length === 0) {
      const what = one.paysIntoKind ?? 'fund, goal or debt'
      return { ...base, target: undefined, paysThen: wanted, note: `no ${what} called "${wanted}"; \`funds\`, \`savings\` and \`debts\` list them` }
    }
    const kinds = [...new Set(matches.map((match) => match.kind))]
    if (matches.length > 1) {
      return {
        ...base,
        target: undefined,
        paysThen: wanted,
        note: `"${wanted}" names ${kinds.length > 1 ? `a ${kinds.join(' and a ')}` : `${matches.length} of them`}; say \`pays_into_kind\` or give the id`,
      }
    }
    const target = matches[0] as Target
    const paysThen = `${target.kind}: ${target.name}`
    // The screen's two gates, as refusals by name (M36 U10, U11).
    if (target.kind === 'debt' && kind !== 'LOAN_REPAYMENT') {
      return {
        ...base,
        target: undefined,
        paysThen,
        note: `${base.typeName} is not a loan repayment, so it cannot pay off the debt ${target.name}; a fund or a goal takes a saving line`,
      }
    }
    if (target.kind !== 'debt' && !flags.countsAsSaving) {
      return {
        ...base,
        target: undefined,
        paysThen,
        note:
          `${base.typeName} does not count as saving, so it cannot pay into the ${target.kind} ${target.name}` +
          (kind === 'LOAN_REPAYMENT' ? '; a repayment line pays off a debt' : '; say `counts_as` too, if it is a saving'),
      }
    }
    return { ...base, target, paysThen, note: undefined }
  })

  // The order, against the list as it will be: renames and new types by their
  // new names, removed types gone.
  const after = [
    ...types
      .filter((type) => !removed.has(type.id))
      .map((type) => {
        const index = renamedIn.get(type.id)
        const one = index === undefined ? undefined : batch[index]
        const slip = one?.onTheSlip === undefined ? type.hebrewName : one.onTheSlip
        return { key: type.id, name: one?.name ?? type.name, slip }
      }),
    ...batch.flatMap((one, index) =>
      one.type === undefined && !one.remove ? [{ key: `new:${String(index)}`, name: one.name ?? '', slip: one.onTheSlip }] : [],
    ),
  ]
  const orderProblems: string[] = []
  const orderKeys: string[] = []
  const orderNames: string[] = []
  for (const wanted of order ?? []) {
    const matches = after.filter((one) => same(wanted, one.key, one.name, one.slip))
    if (matches.length === 0) {
      const gone = types.find((type) => removed.has(type.id) && same(wanted, type.id, type.name, type.hebrewName))
      orderProblems.push(gone === undefined ? `\`order\` names "${wanted}", and there is no such type` : `\`order\` names ${gone.name}, which this call removes`)
    } else if (matches.length > 1) {
      orderProblems.push(`\`order\`'s "${wanted}" names ${String(matches.length)} types; give the id`)
    } else {
      const match = matches[0] as (typeof after)[number]
      if (orderKeys.includes(match.key)) orderProblems.push(`\`order\` names ${match.name} twice`)
      else {
        orderKeys.push(match.key)
        orderNames.push(match.name)
      }
    }
  }

  return { entries, order: order === undefined ? undefined : orderKeys, orderNames, orderProblems }
}

function describeBatch(plan: Plan): string {
  return paragraphs(
    plan.entries.length === 0
      ? undefined
      : table(
          ['Deduction type', 'Change', 'Counts as now', 'Will count as', 'Pays into now', 'Will pay into', 'Note'],
          plan.entries.map((entry) => [
            entry.typeName,
            entry.change,
            entry.countsNow,
            entry.remove ? '—' : entry.countsThen,
            entry.paysNow,
            entry.remove ? '—' : entry.paysThen,
            entry.note ?? '',
          ]),
        ),
    plan.order === undefined || plan.orderNames.length === 0
      ? undefined
      : `**Order**: ${plan.orderNames.join(', ')} first, in that order; the rest follow as they are.`,
    plan.orderProblems.length === 0 ? undefined : plan.orderProblems.map((problem) => `- ${problem}`).join('\n'),
  )
}

const refuses = (plan: Plan): boolean => plan.entries.some((entry) => entry.note !== undefined) || plan.orderProblems.length > 0

function linkEdit(target: Target | null): Pick<DeductionTypeEdit, 'linkedFundId' | 'linkedSavingGoalId' | 'linkedDebtId'> {
  return {
    linkedFundId: target?.kind === 'fund' ? target.id : undefined,
    linkedSavingGoalId: target?.kind === 'goal' ? target.id : undefined,
    linkedDebtId: target?.kind === 'debt' ? target.id : undefined,
  }
}

function applyBatch(document: OpenDocument, plan: Plan): string {
  if (refuses(plan)) {
    return paragraphs(describeBatch(plan), '**Nothing was written**: the batch applies whole or not at all.')
  }
  const db = document.db
  const now = Date.now()
  let linked = false
  // Removals first, so a name a removed type held is free for a rename or a new type.
  for (const entry of plan.entries) {
    if (entry.remove && entry.type !== undefined) deleteDeductionType(db, entry.type.id, now)
  }
  for (const entry of plan.entries) {
    if (entry.remove || entry.type === undefined) continue
    const edit: DeductionTypeEdit = {
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(entry.onTheSlip === undefined ? {} : { hebrewName: entry.onTheSlip ?? undefined }),
      ...(entry.kindChanged ? { kind: entry.kind } : {}),
      ...(entry.flags ?? {}),
      ...(entry.target === undefined ? {} : linkEdit(entry.target)),
    }
    updateDeductionType(db, entry.type.id, edit, now)
    if (entry.target !== undefined) linked = true
  }
  const made = new Map<string, string>()
  plan.entries.forEach((entry, index) => {
    if (entry.remove || entry.type !== undefined || entry.name === undefined) return
    const created = createDeductionType(
      db,
      {
        name: entry.name,
        hebrewName: entry.onTheSlip ?? undefined,
        kind: entry.kind,
        ...(entry.flags ?? defaultFlags(entry.kind)),
        ...(entry.target == null ? {} : linkEdit(entry.target)),
      },
      now,
    )
    made.set(`new:${String(index)}`, created.id)
    if (entry.target != null) linked = true
  })
  if (plan.order !== undefined && plan.order.length > 0) {
    const first = plan.order.map((key) => made.get(key) ?? key)
    const rest = listDeductionTypes(db)
      .map((type) => type.id)
      .filter((id) => !first.includes(id))
    reorderDeductionTypes(db, [...first, ...rest], now)
  }
  // What a link sets off on the screen: the payments a debt's payslip lines
  // already imply. Idempotent, so a fund or a goal costs nothing here.
  if (linked) syncPayroll(db, now)

  const removedCount = plan.entries.filter((entry) => entry.remove).length
  const changed = plan.entries.filter((entry) => !entry.remove && entry.type !== undefined).length
  return paragraphs(
    describeBatch(plan),
    [
      made.size > 0 ? `Made ${plural(made.size, 'deduction type')}.` : undefined,
      changed > 0 ? `Set ${plural(changed, 'deduction type')}.` : undefined,
      removedCount > 0 ? `Removed ${plural(removedCount, 'deduction type')}.` : undefined,
      plan.order !== undefined && plan.order.length > 0 ? 'Reordered the list.' : undefined,
      linked
        ? 'A fund finds its paycheck lines through this link: `funds` checks what they say was deducted against what its report says arrived.'
        : undefined,
    ]
      .filter((part) => part !== undefined)
      .join(' '),
  )
}

export const setDeductionTypesTool: PluginTool = {
  definition: {
    name: 'set_deduction_types',
    title: 'Make, rename, order and remove deduction types, and say what each counts as and pays into',
    description:
      'Everything the deduction types screen does, for **several types in one call**: **make** a ' +
      'type (its name, what the paycheck calls it, its kind), **rename** one, change its kind, **remove** ' +
      'one, put the list in **order**, and say what each type **counts as** (out of net, saving — the ' +
      'two flags every paycheck figure turns on) and what it **pays into** — a fund or a goal for ' +
      'a saving line, a debt (a payroll loan) for a loan repayment. **This link is how a fund finds its ' +
      'paycheck lines**: a pension line is a deposit into a fund only because its type names the fund, ' +
      'and `funds` checks those deposits against the fund’s own report. A new type starts as its ' +
      'kind’s guess, and a kind change carries the flags along while they are still the guess; one ' +
      'that differs is shown as set by hand, and `guess` puts it back. One destination per type — naming ' +
      'one clears the others, and `pays_into: null` links nothing. Refused by name: a target of the wrong ' +
      'kind (a fund or a goal takes a line that counts as saving, a debt a loan repayment), a name ' +
      'another type has, and removing a built-in type, a type a stored paycheck line names, or one ' +
      'another row links to. Types and their ids are listed by `paychecks`; funds by `funds`, goals by ' +
      '`savings`, debts by `debts`. **Dry-runs by default**; the batch applies whole or not at all, and ' +
      'the document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        types: {
          type: 'array',
          description:
            `One entry per deduction type, up to ${String(BATCH_MAX)} in a call. With \`type\` it changes or ` +
            'removes that type; without it, it makes a new one, which needs `name` and `kind`.',
          items: {
            type: 'object',
            properties: {
              type: stringProp('An existing deduction type, by id (`ded:pension`), by name, or by what the paycheck calls it. Leave it out to make a new type.'),
              name: stringProp('The new type’s name, or the new name of the type in `type`.'),
              on_the_slip: {
                type: ['string', 'null'],
                description: 'What the paycheck calls it, as printed; null clears it. Leave it out to keep it.',
              },
              kind: {
                type: 'string',
                enum: [...DEDUCTION_KINDS],
                description: 'What kind of line it is. Needed for a new type; on an existing one it changes the kind.',
              },
              counts_as: {
                type: 'string',
                enum: [...COUNTS_AS_VALUES],
                description:
                  'What its amounts count as: out_of_net_saving (a pension, a study fund), out_of_net ' +
                  '(a tax, a repayment), saving (employer money that never touches net — severance), ' +
                  'not_cash (a benefit in kind), or guess — what its kind says. Leave it out to keep it ' +
                  '(a new type takes its kind’s guess).',
              },
              pays_into: {
                type: ['string', 'null'],
                description: 'A fund, a goal or a debt, by id or by name; null to link nothing. Leave it out to keep the link.',
              },
              pays_into_kind: {
                type: 'string',
                enum: [...TARGET_KINDS],
                description: 'Only when the name is both a fund and a goal, say: which one is meant.',
              },
              remove: booleanProp('True removes the type in `type`, and the entry takes nothing else.'),
            },
            additionalProperties: false,
          },
        },
        order: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Types by id or by name — the names they will have after this call, new ones included. These ' +
            'come first in the list, in this order, and the rest follow as they are.',
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const { batch, order } = readBatch(args)
    const mutation: Mutation<Plan> = {
      plan: (document) => planBatch(document, batch, order),
      refuses,
      describe: (plan) =>
        paragraphs(
          describeBatch(plan),
          refuses(plan) ? 'Nothing will be written while any entry has a note: the batch applies whole or not at all.' : undefined,
        ),
      apply: applyBatch,
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
