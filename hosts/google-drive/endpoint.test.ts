import { createHash, randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { endpoint, FIRST_USE_WARNING, type EndpointConfig, type Handler } from './endpoint.ts'
import { FakeGoogle } from './fakeGoogle.ts'
import { GOOGLE_HOSTS, googleOnly, sendsTo } from './network.ts'
import { seal } from './seal.ts'
import { GOOGLE_AUTHORIZE, GOOGLE_TOKEN } from './signIn.ts'
import { accountKey, counted, DAILY_CALLS, fields, FIELDS, firestoreUsage, type UsageRecord } from './usage.ts'

/**
 * **The endpoint** (M57 U4, D-560, D-562, D-565): a chat app signs a person in
 * through Google and calls the connector's tools at the root of the address —
 * against Google in memory (`fakeGoogle.ts`), so no request leaves the process.
 * The cap, the five fields, the 90 days, the first-use warning, and the two
 * promises PRIVACY.md makes of the code: no request but to Google's APIs, and
 * nothing of a call logged.
 */

const ORIGIN = 'https://mcp.getemerald.dev'
const CALLBACK = 'https://chat.example/oauth/callback'
const KEY = Buffer.alloc(32, 7)
const BOOK = {
  format: 'book',
  title: 'Book',
  columns: [{ name: 'title', type: 'text', required: true }],
  nothing_must_hold: true,
  commit: true,
}

let google: FakeGoogle
let now: Date
let config: EndpointConfig
let handle: Handler

beforeEach(() => {
  google = new FakeGoogle()
  now = new Date('2026-11-09T10:00:00Z')
  const send = googleOnly(google.fetch)
  config = {
    origin: ORIGIN,
    key: KEY,
    google: { clientId: 'google-client', clientSecret: 'google-secret', authorize: GOOGLE_AUTHORIZE, token: GOOGLE_TOKEN },
    fetch: send,
    now: () => now,
    usage: firestoreUsage({ project: 'emerald-test', fetch: send }),
  }
  handle = endpoint(config)
})

const at = (path: string, init?: RequestInit): Promise<Response> => handle(new Request(`${ORIGIN}${path}`, init))

interface Tokens {
  readonly access_token: string
  readonly refresh_token?: string
  readonly expires_in: number
}

/** A chat app's whole sign-in, as `email`: register, authorize, Google, back, token. */
async function signIn(email = 'Person@Example.com'): Promise<{ tokens: Tokens; clientId: string }> {
  const registered = await at('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [CALLBACK], client_name: 'A chat app' }),
  })
  expect(registered.status).toBe(201)
  const clientId = ((await registered.json()) as { client_id: string }).client_id

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'chat-state',
    resource: `${ORIGIN}/`,
  })
  const toGoogle = await at(`/authorize?${query.toString()}`)
  expect(toGoogle.status).toBe(302)
  const googlePage = new URL(toGoogle.headers.get('Location') ?? '')
  expect(googlePage.origin + googlePage.pathname).toBe(GOOGLE_AUTHORIZE)
  expect(googlePage.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/drive.file')
  expect(googlePage.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/oauth/google`)

  const fromGoogle = await at(
    `/oauth/google?${new URLSearchParams({ code: google.signIn({ email }), state: googlePage.searchParams.get('state') ?? '' }).toString()}`,
  )
  const toChat = new URL(fromGoogle.headers.get('Location') ?? '')
  expect(toChat.origin + toChat.pathname).toBe(CALLBACK)
  expect(toChat.searchParams.get('state')).toBe('chat-state')

  const traded = await at('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: toChat.searchParams.get('code') ?? '',
      code_verifier: verifier,
      redirect_uri: CALLBACK,
      client_id: clientId,
    }).toString(),
  })
  expect(traded.status).toBe(200)
  return { tokens: (await traded.json()) as Tokens, clientId }
}

let ids = 0

/** One MCP request, as a chat app sends it. */
async function rpc(token: string | undefined, method: string, params: unknown = {}, path = '/'): Promise<Response> {
  ids += 1
  return at(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ids, method, params }),
  })
}

interface CallAnswer {
  readonly result?: { content: { type: string; text: string }[]; isError?: boolean; tools?: { name: string; inputSchema: { properties?: object } }[] }
  readonly error?: unknown
}

async function call(token: string, name: string, args: Record<string, unknown> = {}): Promise<CallAnswer> {
  const response = await rpc(token, 'tools/call', { name, arguments: args })
  expect(response.status).toBe(200)
  return (await response.json()) as CallAnswer
}

const firstText = (answer: CallAnswer): string => answer.result?.content[0]?.text ?? ''

function record(account: string): UsageRecord | undefined {
  const found = [...google.firestore.documents].find(([name]) => name.endsWith(`/accounts/${account}`))?.[1]
  if (found === undefined) return undefined
  const f = found.fields as Record<string, Record<string, unknown>>
  return {
    account: String(f['account']?.['stringValue']),
    day: String(f['day']?.['stringValue']),
    calls: Number(f['calls']?.['integerValue']),
    first_day: String(f['first_day']?.['stringValue']),
    later_day: f['later_day']?.['booleanValue'] === true,
  }
}

describe('the endpoint (M57 U4)', () => {
  it('answers at the root and says where to sign in; there is no /mcp', async () => {
    const unsigned = await rpc(undefined, 'tools/list')
    expect(unsigned.status).toBe(401)
    expect(unsigned.headers.get('WWW-Authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`)
    const resource = (await (await at('/.well-known/oauth-protected-resource')).json()) as Record<string, unknown>
    expect(resource).toMatchObject({ resource: `${ORIGIN}/`, authorization_servers: [ORIGIN] })
    const server = (await (await at('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>
    expect(server).toMatchObject({
      issuer: ORIGIN,
      registration_endpoint: `${ORIGIN}/register`,
      code_challenge_methods_supported: ['S256'],
    })
    const { tokens } = await signIn()
    expect((await rpc(tokens.access_token, 'tools/list', {}, '/mcp')).status).toBe(404)
  })

  it('signs a person in through Google, lists the connector’s tools without touching Drive, and warns once, on the first call', async () => {
    const { tokens } = await signIn()
    expect(tokens.refresh_token).toBeDefined()

    const initialized = await rpc(tokens.access_token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'chat', version: '1' },
    })
    expect(initialized.status).toBe(200)
    const listed = (await (await rpc(tokens.access_token, 'tools/list')).json()) as CallAnswer
    const tools = listed.result?.tools ?? []
    expect(tools).toHaveLength(17)
    expect(tools.every((tool) => !Object.hasOwn(tool.inputSchema.properties ?? {}, 'path'))).toBe(true)
    // Listing reads no document, and is not a call against the cap.
    expect(google.drive.requests).toHaveLength(0)
    expect(google.firestore.writes).toHaveLength(0)

    const first = await call(tokens.access_token, 'declare_format', BOOK)
    expect(firstText(first)).toBe(FIRST_USE_WARNING)
    expect(first.result?.content).toHaveLength(2)
    expect(google.drive.named('Emerald.emd')).toHaveLength(1)

    const second = await call(tokens.access_token, 'record_format_rows', { format: 'book', rows: [{ title: 'Dune' }], commit: true })
    expect(second.result?.isError).toBeFalsy()
    expect(firstText(second)).not.toContain('Before you start')
    const rows = await call(tokens.access_token, 'format_rows', { format: 'book' })
    expect(firstText(rows)).toContain('Dune')

    expect(record(accountKey('person@example.com'))).toEqual({
      account: accountKey('person@example.com'),
      day: '2026-11-09',
      calls: 3,
      first_day: '2026-11-09',
      later_day: false,
    })
  })

  it('refuses a tool the connector leaves out, by name, and a token that does not open', async () => {
    const { tokens } = await signIn()
    const refused = await call(tokens.access_token, 'keep_copy', {})
    expect(refused.result?.isError).toBe(true)
    expect(refused.result?.content.at(-1)?.text).toContain('keep_copy is not offered on the Google Drive connector')

    const tampered = `${tokens.access_token.slice(0, -4)}AAAA`
    const response = await rpc(tampered, 'tools/list')
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
    // A code, or a refresh token, is not a token: each is sealed as what it is.
    expect((await rpc(tokens.refresh_token, 'tools/list')).status).toBe(401)
  })

  it('refuses the 201st call of a day, saying when it resets, and reaches no Drive for it', async () => {
    const { tokens } = await signIn()
    await call(tokens.access_token, 'formats')
    const account = accountKey('person@example.com')
    const [name, stored] = [...google.firestore.documents][0] ?? []
    if (name === undefined || stored === undefined) throw new Error('no record')
    stored.fields = fields({ ...(record(account) as UsageRecord), calls: DAILY_CALLS })

    const before = google.drive.requests.length
    const over = await call(tokens.access_token, 'formats')
    expect(over.result?.isError).toBe(true)
    expect(firstText(over)).toContain('allows 200 calls a day per person')
    expect(firstText(over)).toContain('resets at midnight UTC (2026-11-10T00:00Z), in about 14 hours')
    expect(google.drive.requests).toHaveLength(before)
    expect(record(account)?.calls).toBe(DAILY_CALLS)

    // The next day it resets, and the person has come back on a later day.
    now = new Date('2026-11-10T00:00:01Z')
    // Google's token lapsed overnight: the chat app signs in again, as the same person.
    const next = await call((await signIn()).tokens.access_token, 'formats')
    expect(next.result?.isError).toBeFalsy()
    expect(firstText(next)).not.toContain('Before you start')
    expect(record(account)).toMatchObject({ day: '2026-11-10', calls: 1, first_day: '2026-11-09', later_day: true })
  })

  it('keeps exactly the five fields: every write Firestore takes carries them and no other', async () => {
    const { tokens } = await signIn()
    await call(tokens.access_token, 'declare_format', BOOK)
    await call(tokens.access_token, 'format_rows', { format: 'book' })
    expect(google.firestore.writes.length).toBeGreaterThan(0)
    for (const write of google.firestore.writes) expect(Object.keys(write).sort()).toEqual([...FIELDS].sort())
    // Nothing of a call goes in: no tool, no format, no address.
    const kept = JSON.stringify(google.firestore.writes)
    for (const word of ['declare_format', 'book', 'Emerald.emd', 'example.com', 'Person']) expect(kept).not.toContain(word)
    // And a record with a sixth field is refused before it is sent.
    const sixth = { ...(record(accountKey('person@example.com')) as UsageRecord), tool: 'declare_format' }
    expect(() => fields(sixth)).toThrow(/exactly account, day, calls, first_day, later_day/)
  })

  it('deletes records unused for 90 days, on the first call of a day, and keeps the rest', async () => {
    const usage = config.usage
    await usage.count('old', new Date('2026-08-10T12:00:00Z'))
    await usage.count('ninety', new Date('2026-08-11T12:00:00Z'))
    await usage.count('recent', new Date('2026-11-01T12:00:00Z'))
    const { tokens } = await signIn()
    await call(tokens.access_token, 'formats')
    const left = [...google.firestore.documents.keys()].map((name) => name.split('/').at(-1))
    expect(left.sort()).toEqual([accountKey('person@example.com'), 'ninety', 'recent'].sort())
  })

  it('refreshes a token through Google, and stops when Google does', async () => {
    const { tokens, clientId } = await signIn()
    const refresh = (token: string | undefined): Promise<Response> =>
      at('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token ?? '', client_id: clientId }).toString(),
      })
    now = new Date(now.getTime() + 2 * 3_600_000)
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401)
    const renewed = (await (await refresh(tokens.refresh_token)).json()) as Tokens
    expect((await rpc(renewed.access_token, 'tools/list')).status).toBe(200)
    google.revoke()
    const refused = await refresh(tokens.refresh_token)
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('refuses a sign-in that fails its checks', async () => {
    const registered = await at('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }),
    })
    expect(registered.status).toBe(400)
    // Not registered: it stops at the endpoint, sending nobody anywhere.
    expect((await at('/authorize?client_id=nobody&redirect_uri=https%3A%2F%2Fevil.example%2F')).status).toBe(400)
    // A registration names its return addresses; another one stops here too.
    const clientId = seal(KEY, 'client', { u: [CALLBACK] })
    expect((await at(`/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example/')}`)).status).toBe(400)
    // Without PKCE it goes back to the chat app refused.
    const noPkce = await at(`/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(CALLBACK)}&response_type=code`)
    expect(new URL(noPkce.headers.get('Location') ?? '').searchParams.get('error')).toBe('invalid_request')
  })

  it('goes back refused when the person keeps Drive from it', async () => {
    const challenge = createHash('sha256').update('v').digest('base64url')
    const clientId = seal(KEY, 'client', { u: [CALLBACK] })
    const toGoogle = await at(
      `/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' }).toString()}`,
    )
    const state = new URL(toGoogle.headers.get('Location') ?? '').searchParams.get('state') ?? ''
    const back = await at(`/oauth/google?${new URLSearchParams({ code: google.signIn({ email: 'a@b.example', drive: false }), state }).toString()}`)
    expect(new URL(back.headers.get('Location') ?? '').searchParams.get('error')).toBe('access_denied')
  })
})

describe('what the endpoint promises (D-565)', () => {
  let written: string[]
  beforeEach(() => {
    written = []
    const keep = (...args: unknown[]): boolean => {
      written.push(args.map(String).join(' '))
      return true
    }
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(keep)
    vi.spyOn(process.stdout, 'write').mockImplementation(keep)
    vi.spyOn(process.stderr, 'write').mockImplementation(keep)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends to Google’s APIs alone and logs nothing, through a sign-in, calls, a refusal and a failure', async () => {
    const { tokens } = await signIn()
    await call(tokens.access_token, 'declare_format', BOOK)
    await call(tokens.access_token, 'record_format_rows', { format: 'book', rows: [{ title: 'A secret title' }], commit: true })
    await call(tokens.access_token, 'keep_copy', {})
    await call(tokens.access_token, 'format_rows', { format: 'nothing declared' })
    vi.restoreAllMocks()
    expect(written).toEqual([])
    expect(google.sent.length).toBeGreaterThan(0)
    for (const url of google.sent) expect(sendsTo(url), url).toBe(true)
  })

  it('refuses a request anywhere else before it is sent', async () => {
    const sent: string[] = []
    const guarded = googleOnly(async (url) => {
      sent.push(url)
      return new Response('')
    })
    await expect(guarded('https://example.com/', {})).rejects.toThrow(/Google's APIs alone; refused example\.com/)
    await expect(guarded('https://www.googleapis.com.evil.example/', {})).rejects.toThrow()
    await expect(guarded('http://www.googleapis.com/drive/v3/files', {})).rejects.toThrow()
    await guarded('https://www.googleapis.com/drive/v3/files', {})
    expect(sent).toEqual(['https://www.googleapis.com/drive/v3/files'])
    expect(sendsTo('http://localhost:8080/v1', ['localhost:8080'])).toBe(true)
  })

  it('names no address in its code but Google’s, its own and the site’s', () => {
    const folder = fileURLToPath(new URL('.', import.meta.url))
    const allowed = new Set([...GOOGLE_HOSTS.keys(), 'accounts.google.com', 'mcp.getemerald.dev', 'getemerald.dev'])
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.startsWith('fake'))) {
      for (const [, host] of readFileSync(join(folder, file), 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        if (host === 'localhost') continue
        expect(allowed.has(host ?? ''), `${file}: ${String(host)}`).toBe(true)
      }
    }
  })
})

describe('the record and its key (D-566)', () => {
  it('is a SHA-256 of the address, lowercased, so a request written from it finds it', () => {
    const expected = createHash('sha256').update('person@example.com').digest('hex')
    expect(accountKey('Person@Example.com ')).toBe(expected)
    expect(accountKey('person@example.com')).toBe(expected)
  })

  it('counts a day, resets the next, and remembers a later day', () => {
    const a = counted(undefined, 'k', new Date('2026-11-09T23:59:00Z'))
    expect(a).toMatchObject({ allowed: true, first: true, record: { calls: 1, later_day: false } })
    if (!a.allowed) throw new Error('refused')
    const b = counted({ ...a.record, calls: DAILY_CALLS }, 'k', new Date('2026-11-09T23:59:30Z'))
    expect(b).toEqual({ allowed: false, resets: new Date('2026-11-10T00:00:00Z') })
    const c = counted({ ...a.record, calls: DAILY_CALLS }, 'k', new Date('2026-11-10T00:00:00Z'))
    expect(c).toMatchObject({ allowed: true, first: false, record: { day: '2026-11-10', calls: 1, first_day: '2026-11-09', later_day: true } })
  })
})
