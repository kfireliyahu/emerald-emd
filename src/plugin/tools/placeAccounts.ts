/**
 * `set_place_accounts` — the conversation half of a place naming its account
 * (M30 U1, D-354).
 *
 * A place **links** to the account whose statements show its money; it is not
 * merged with one, and a place with no statements (a deposit, cash at home)
 * names none. The account's own cash is a holding in the place, made with the
 * link unless the call picks one already there. The Money map's place editor
 * is the screen half, and both write through `setPlaceAccount`.
 */

import { listAccounts, type Account } from '@/data/repositories/accountRepository.ts'
import {
  cashHoldingOf,
  listHoldingPlaces,
  listHoldings,
  placeAccountProblem,
  setPlaceAccount,
} from '@/data/repositories/savingsRepository.ts'
import type { Holding, HoldingPlace } from '@/domain/model/savings.ts'

import { type OpenDocument } from '../document.ts'
import { paragraphs, plural, table } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 60

interface Requested {
  readonly place: string
  /** `null` unlinks. */
  readonly account: string | null
  readonly cashHolding: string | undefined
}

interface LinkPlan {
  readonly placeName: string
  readonly placeId: string | undefined
  readonly was: string
  readonly accountId: string | undefined
  readonly accountName: string
  readonly cashHoldingId: string | undefined
  readonly cash: string
  readonly note: string | undefined
}

function readLinks(args: Args): readonly Requested[] {
  const raw = args['links']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`links` must be a non-empty array, one entry per place.')
  }
  if (raw.length > BATCH_MAX) throw new ToolInputError(`That is ${raw.length} entries; the ceiling is ${BATCH_MAX}.`)
  return raw.map((entry, index): Requested => {
    if (typeof entry !== 'object' || entry === null) throw new ToolInputError(`\`links[${index}]\` must be an object.`)
    const record = entry as Record<string, unknown>
    const place = optionalString(record, 'place')
    if (place === undefined) throw new ToolInputError(`\`links[${index}]\` needs a \`place\`.`)
    const account = record['account']
    if (account !== null && (typeof account !== 'string' || account.trim() === '')) {
      throw new ToolInputError(`\`links[${index}].account\` is an account's id or name, or null to name none.`)
    }
    return { place, account: account === null ? null : account.trim(), cashHolding: optionalString(record, 'cash_holding') }
  })
}

function byIdOrName<T extends { readonly id: string; readonly name: string }>(
  rows: readonly T[],
  wanted: string,
): T | undefined {
  const lower = wanted.trim().toLowerCase()
  return rows.find((row) => row.id === wanted) ?? rows.find((row) => row.name.trim().toLowerCase() === lower)
}

function planLinks(document: OpenDocument, batch: readonly Requested[]): readonly LinkPlan[] {
  const places = listHoldingPlaces(document.db, { includeArchived: true })
  const accounts = listAccounts(document.db, { includeArchived: true })
  const nameOf = (id: string | undefined): string =>
    id === undefined ? '—' : (accounts.find((one) => one.id === id)?.name ?? id)
  const claimed = new Map<string, string>()

  return batch.map((one): LinkPlan => {
    const place: HoldingPlace | undefined = byIdOrName(places, one.place)
    const base = {
      placeName: place?.name ?? one.place,
      placeId: place?.id,
      was: nameOf(place?.accountId),
    }
    if (place === undefined) {
      return { ...base, accountId: undefined, accountName: '—', cashHoldingId: undefined, cash: '—', note: 'no such place; `savings` lists them' }
    }
    if (one.account === null) {
      return { ...base, accountId: undefined, accountName: 'none', cashHoldingId: undefined, cash: '—', note: undefined }
    }
    const account: Account | undefined = byIdOrName(accounts, one.account)
    if (account === undefined) {
      return { ...base, accountId: undefined, accountName: one.account, cashHoldingId: undefined, cash: '—', note: 'no such account; `document_info` lists them' }
    }
    const inPlace = listHoldings(document.db, { placeId: place.id, includeArchived: true })
    const picked: Holding | undefined = one.cashHolding === undefined ? undefined : byIdOrName(inPlace, one.cashHolding)
    if (one.cashHolding !== undefined && picked === undefined) {
      return { ...base, accountId: account.id, accountName: account.name, cashHoldingId: undefined, cash: one.cashHolding, note: `no holding called "${one.cashHolding}" in ${place.name}` }
    }
    const twice = claimed.get(account.id)
    const problem =
      twice !== undefined
        ? `${account.name} is named by ${twice} earlier in this call`
        : placeAccountProblem(document.db, place.id, account.id, picked?.id)
    claimed.set(account.id, place.name)
    const already = inPlace.find((held) => held.accountId === account.id)
    // A bank account's own cash is in no place (M36 U08), and naming it here moves it in.
    const own = already === undefined ? cashHoldingOf(document.db, account.id) : undefined
    const cash = picked?.name ?? already?.name ?? (own === undefined ? 'Cash — **new**' : `${own.name} — moves here`)
    return { ...base, accountId: account.id, accountName: account.name, cashHoldingId: picked?.id, cash, note: problem }
  })
}

function describeLinks(entries: readonly LinkPlan[]): string {
  return table(
    ['Place', 'Names now', 'Will name', 'Its cash', 'Note'],
    entries.map((entry) => [entry.placeName, entry.was, entry.accountName, entry.cash, entry.note ?? '']),
  )
}

export const setPlaceAccountsTool: PluginTool = {
  definition: {
    name: 'set_place_accounts',
    title: 'Name the account a place’s money is shown by',
    description:
      'Say which account each place on Net worth is — the bank account, the broker, the ' +
      'savings account whose statements show its money — **several in one call**. A place ' +
      '*links* to an account and is not merged with it: a deposit or cash at home has no ' +
      'statements and names none (`account: null` takes a link away). A card cannot be named, ' +
      'and an account is named by one place at most. The account gets its own cash holding in ' +
      'the place, made with the link — or `cash_holding` picks one already there, such as the ' +
      'holding goal deposits already land in. Unlinking keeps the holding. A bank account or ' +
      'cash has a place named as it and its own cash from the moment it is made; naming it from ' +
      'another place moves it there while its own place holds nothing. A place that names one ' +
      'account is not re-pointed to another in one call: set it to `null` first. Nothing here moves ' +
      'a figure. Places and holdings are listed by `savings`; accounts by `document_info`. ' +
      '**Dry-runs by default**; the document is copied to a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        links: {
          type: 'array',
          description: `One entry per place. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              place: stringProp('The place, by id or by name.'),
              account: {
                type: ['string', 'null'],
                description: 'The account, by id or by name; null to name none.',
              },
              cash_holding: stringProp(
                'Optional: a holding already in the place, by id or name, to be the account’s cash instead of a new one.',
              ),
            },
            required: ['place', 'account'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews; true writes.'),
      },
      required: ['path', 'links'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readLinks(args)

    const mutation: Mutation<readonly LinkPlan[]> = {
      plan: (document) => planLinks(document, batch),
      refuses: (entries) => entries.some((entry) => entry.note !== undefined),
      describe: (entries) =>
        paragraphs(
          describeLinks(entries),
          entries.some((entry) => entry.note !== undefined)
            ? 'Nothing will be written while any entry has a note: the batch applies whole or not at all.'
            : undefined,
        ),
      apply: (document, entries) => {
        if (entries.some((entry) => entry.note !== undefined)) {
          return paragraphs(describeLinks(entries), '**Nothing was written**: the batch applies whole or not at all.')
        }
        const now = Date.now()
        let made = 0
        // Unlinks first, so an account moving from one place to another is free
        // by the time the other names it.
        const ordered = [...entries].sort((a, b) => Number(a.accountId !== undefined) - Number(b.accountId !== undefined))
        for (const entry of ordered) {
          if (entry.placeId === undefined) continue
          const done = setPlaceAccount(document.db, entry.placeId, entry.accountId, now, {
            cashHoldingId: entry.cashHoldingId,
          })
          if (done.createdCash) made += 1
        }
        return (
          `Linked ${plural(entries.filter((entry) => entry.accountId !== undefined).length, 'place')}` +
          (entries.some((entry) => entry.accountId === undefined)
            ? `, unlinked ${plural(entries.filter((entry) => entry.accountId === undefined).length, 'place')}`
            : '') +
          (made === 0 ? '.' : `, and made ${plural(made, 'cash holding')}.`) +
          ' `savings` shows each place with its account.'
        )
      },
    }
    return mutatingCall(path, args['commit'] === true, mutation)
  },
}
