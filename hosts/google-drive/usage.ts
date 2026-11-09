/**
 * **The cap, and the five fields that hold it** (M57 U4, D-561, D-562, D-565).
 *
 * The Google Drive connector allows **200 calls a day per person**, and keeps,
 * per Google account, exactly five fields in Firestore and nothing else:
 *
 * 1. `account` — a one-way hash (SHA-256) of the person's Google email address,
 *    lowercased (D-566): one-way, so the address is not kept, and of the
 *    address rather than the account id, so a person who writes to ask for
 *    their record to be deleted names it by writing from it;
 * 2. `day` — today's date, which is the last day they used it;
 * 3. `calls` — how many calls they made on that day;
 * 4. `first_day` — the first day they used it;
 * 5. `later_day` — whether they used it again on a later day (the kill
 *    criterion counts these, D-562).
 *
 * Never a call, its arguments, a tool's name, a file's name or anything from
 * the document: `fields()` writes these five and refuses a record with any
 * other, and `usage.test.ts` fails when a write carries a sixth.
 *
 * **A record unused for 90 days is deleted** (D-565). Firestore's TTL deletes a
 * document once the time in a field has passed — an expiry, which would be a
 * sixth field — so instead `sweep` deletes every record whose `day` is more
 * than 90 days back: on an instance's first call of each day, and on Cloud
 * Scheduler's knock if U6 sets one (`/sweep`).
 *
 * Days are UTC, and the cap resets at midnight UTC.
 */

import { createHash } from 'node:crypto'

import type { Fetch } from './drive.ts'

/** Calls a day per person (D-562). */
export const DAILY_CALLS = 200
/** Days a record may go unused before it is deleted (D-565). */
export const KEPT_DAYS = 90
/** The collection the records are in. */
export const ACCOUNTS = 'accounts'
/** The five fields, and no others (D-562). */
export const FIELDS = ['account', 'day', 'calls', 'first_day', 'later_day'] as const

export interface UsageRecord {
  readonly account: string
  /** `YYYY-MM-DD`, UTC: the last day used. */
  readonly day: string
  readonly calls: number
  readonly first_day: string
  readonly later_day: boolean
}

/** The record's key: SHA-256 of the email address, lowercased and trimmed, in hex (D-566). */
export function accountKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/** A moment's day, UTC. */
export function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** What counting one call comes to. */
export type Counted =
  | { readonly allowed: true; readonly record: UsageRecord; /** The person's first call — the warning's moment. */ readonly first: boolean }
  | { readonly allowed: false; /** When the cap resets: the next midnight, UTC. */ readonly resets: Date }

/**
 * One more call by `account` at `now`, given what was kept: the record to keep,
 * or the refusal when today's calls are used. A refused call is not counted.
 */
export function counted(previous: UsageRecord | undefined, account: string, now: Date): Counted {
  const today = dayOf(now)
  if (previous === undefined) {
    return { allowed: true, first: true, record: { account, day: today, calls: 1, first_day: today, later_day: false } }
  }
  if (previous.day !== today) {
    return {
      allowed: true,
      first: false,
      record: { account, day: today, calls: 1, first_day: previous.first_day, later_day: previous.later_day || today !== previous.first_day },
    }
  }
  if (previous.calls >= DAILY_CALLS) {
    const resets = new Date(`${today}T00:00:00.000Z`)
    resets.setUTCDate(resets.getUTCDate() + 1)
    return { allowed: false, resets }
  }
  return { allowed: true, first: false, record: { ...previous, calls: previous.calls + 1 } }
}

/** The refusal of a call over the cap, saying when it resets. */
export function overTheCap(resets: Date, now: Date): string {
  const hours = Math.max(1, Math.ceil((resets.getTime() - now.getTime()) / 3_600_000))
  return (
    `The Google Drive connector allows ${String(DAILY_CALLS)} calls a day per person, and today's are used, ` +
    `so this call did nothing. It resets at midnight UTC (${resets.toISOString().slice(0, 16)}Z), ` +
    `in about ${String(hours)} hour${hours === 1 ? '' : 's'}. Your document in Google Drive is as it was.`
  )
}

/** Where the records are kept. */
export interface UsageStore {
  /** Count one call by `account` at `now`, keeping the record it comes to. */
  count(account: string, now: Date): Promise<Counted>
  /** Delete every record unused for more than `KEPT_DAYS` days before `now`; how many went. */
  sweep(now: Date): Promise<number>
}

/** The first day a record is still kept on: older `day`s are swept. */
export function keptFrom(now: Date): string {
  const from = new Date(`${dayOf(now)}T00:00:00.000Z`)
  from.setUTCDate(from.getUTCDate() - KEPT_DAYS)
  return dayOf(from)
}

// --- Firestore, over its REST API -------------------------------------------

type FirestoreValue = { stringValue: string } | { integerValue: string } | { booleanValue: boolean }

/** The record as Firestore's fields — **exactly the five**, or it throws. */
export function fields(record: UsageRecord): Record<string, FirestoreValue> {
  const keys = Object.keys(record).sort()
  if (keys.join() !== [...FIELDS].sort().join()) {
    throw new Error(`A usage record holds exactly ${FIELDS.join(', ')}; this one held ${keys.join(', ')}.`)
  }
  return {
    account: { stringValue: record.account },
    day: { stringValue: record.day },
    calls: { integerValue: String(record.calls) },
    first_day: { stringValue: record.first_day },
    later_day: { booleanValue: record.later_day },
  }
}

interface FirestoreDocument {
  readonly name: string
  readonly updateTime: string
  readonly fields?: Record<string, Record<string, unknown>>
}

function recordOf(document: FirestoreDocument): UsageRecord | undefined {
  const field = (name: string): Record<string, unknown> | undefined => document.fields?.[name]
  const account = field('account')?.['stringValue']
  const day = field('day')?.['stringValue']
  const calls = Number(field('calls')?.['integerValue'])
  const first = field('first_day')?.['stringValue']
  const later = field('later_day')?.['booleanValue']
  if (typeof account !== 'string' || typeof day !== 'string' || !Number.isInteger(calls) || typeof first !== 'string') return undefined
  return { account, day, calls, first_day: first, later_day: later === true }
}

export interface FirestoreOptions {
  /** The Google Cloud project. */
  readonly project: string
  /** `host:port` of the Firestore emulator, for a local run. */
  readonly emulator?: string
  readonly fetch: Fetch
}

/** Cloud Run's metadata server: the service account's token, for Firestore. */
const METADATA_TOKEN = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'

/** Writes that lost a race to another instance's are tried again this many times. */
const ATTEMPTS = 5

/** The records in Firestore, by its REST API (`firestore.googleapis.com`, or the emulator). */
export function firestoreUsage(options: FirestoreOptions): UsageStore {
  const database = `projects/${options.project}/databases/(default)`
  const root =
    options.emulator === undefined ? 'https://firestore.googleapis.com/v1' : `http://${options.emulator}/v1`
  let token: { value: string; until: number } | undefined

  const authorization = async (): Promise<string> => {
    // The emulator takes any bearer; `owner` is the one it documents.
    if (options.emulator !== undefined) return 'Bearer owner'
    if (token === undefined || token.until < Date.now() + 60_000) {
      const response = await options.fetch(METADATA_TOKEN, { headers: { 'Metadata-Flavor': 'Google' } })
      if (!response.ok) throw new Error(`Cloud Run's metadata server gave no token (${String(response.status)}).`)
      const given = (await response.json()) as { access_token: string; expires_in: number }
      token = { value: given.access_token, until: Date.now() + given.expires_in * 1000 }
    }
    return `Bearer ${token.value}`
  }

  const send = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', await authorization())
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')
    return options.fetch(url, { ...init, headers })
  }

  // The status alone: what Firestore says back may quote the record.
  const failed = (response: Response, doing: string): Error => new Error(`Firestore refused ${doing} (${String(response.status)}).`)

  return {
    async count(account, now) {
      const name = `${database}/documents/${ACCOUNTS}/${account}`
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const got = await send(`${root}/${name}`)
        let previous: FirestoreDocument | undefined
        if (got.status === 404) previous = undefined
        else if (got.ok) previous = (await got.json()) as FirestoreDocument
        else throw failed(got, 'reading a usage record')

        const result = counted(previous === undefined ? undefined : recordOf(previous), account, now)
        if (!result.allowed) return result

        // Written only over what was read: a record made or changed by another
        // instance since is read again rather than overwritten.
        const precondition =
          previous === undefined
            ? 'currentDocument.exists=false'
            : `currentDocument.updateTime=${encodeURIComponent(previous.updateTime)}`
        const put = await send(`${root}/${name}?${precondition}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: fields(result.record) }),
        })
        if (put.ok) return result
        // Lost the race: ALREADY_EXISTS is 409, FAILED_PRECONDITION is 400 (or 412).
        if (put.status !== 409 && put.status !== 400 && put.status !== 412) throw failed(put, 'counting a call')
      }
      throw new Error('Firestore kept changing a usage record under this call.')
    },

    async sweep(now) {
      const query = await send(`${root}/${database}/documents:runQuery`, {
        method: 'POST',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: ACCOUNTS }],
            where: { fieldFilter: { field: { fieldPath: 'day' }, op: 'LESS_THAN', value: { stringValue: keptFrom(now) } } },
            select: { fields: [{ fieldPath: '__name__' }] },
            limit: 500,
          },
        }),
      })
      if (!query.ok) throw failed(query, 'finding records unused for 90 days')
      const found = (await query.json()) as readonly { document?: { name: string } }[]
      const names = found.flatMap((each) => (each.document === undefined ? [] : [each.document.name]))
      if (names.length === 0) return 0
      const commit = await send(`${root}/${database}/documents:commit`, {
        method: 'POST',
        body: JSON.stringify({ writes: names.map((name) => ({ delete: name })) }),
      })
      if (!commit.ok) throw failed(commit, 'deleting records unused for 90 days')
      return names.length
    },
  }
}
