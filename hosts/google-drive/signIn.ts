/**
 * **Signing in: the endpoint is the authorization server a chat app expects,
 * and Google is the one that signs the person in** (M57 U4, D-567).
 *
 * A chat app that adds a remote MCP server finds out how to sign in from the
 * server (the protected-resource and authorization-server metadata), registers
 * itself (dynamic client registration), sends the person to `/authorize` with a
 * PKCE challenge, and trades the code it gets back at `/token`. Here `/authorize`
 * hands the person on to Google for three scopes — `openid email` and
 * `drive.file`, which shows the connector only the files it made — and Google
 * sends them back to `/oauth/google`, where the endpoint trades Google's code
 * for Google's tokens and hands the chat app a code of its own.
 *
 * **Nothing is stored** (D-562): the registration, the sign-in on its way
 * through Google, the code, and the token the chat app then holds are each
 * sealed under the endpoint's key (`seal.ts`). The token the chat app holds is
 * Google's token, sealed, with the hash that names the person's record
 * (`usage.ts`); the refresh token is Google's refresh token, sealed. The email
 * address is read from Google's answer once, hashed, and dropped.
 */

import { createHash } from 'node:crypto'

import type { Fetch } from './drive.ts'
import { seal, unseal } from './seal.ts'
import { accountKey } from './usage.ts'

export const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
/** What Google is asked for: who the person is, by their address, and the files the connector makes. */
export const GOOGLE_SCOPES = `openid email ${DRIVE_FILE_SCOPE}`
/** Where Google sends the person back to — the OAuth client's one redirect URI. */
export const GOOGLE_CALLBACK = '/oauth/google'

/** How long a sign-in may take at Google, and a code may wait to be traded, in seconds. */
const SIGN_IN_SECONDS = 600
const CODE_SECONDS = 120
/** A token is let go a minute before Google's own lapses, so a call never carries a dead one. */
const EARLY_SECONDS = 60

export interface SignInConfig {
  /** Where the endpoint answers, with no slash: `https://mcp.getemerald.dev`. */
  readonly origin: string
  /** The sealing key (`seal.ts`). */
  readonly key: Buffer
  readonly google: {
    readonly clientId: string
    readonly clientSecret: string
    /** Google's authorization page; a local run points it at its stand-in. */
    readonly authorize: string
    /** Google's token endpoint. */
    readonly token: string
  }
  readonly fetch: Fetch
  readonly now: () => Date
}

/** What the chat app's token carries: Google's token, and whose record it counts against. */
export interface Access {
  /** Google's access token. */
  readonly g: string
  /** The person's record (`accountKey`). */
  readonly a: string
}

interface Client {
  /** The redirect URIs it registered. */
  readonly u: readonly string[]
}

interface PendingSignIn {
  /** The client's id, hashed. */
  readonly i: string
  readonly u: string
  readonly s?: string
  /** The PKCE challenge. */
  readonly k: string
}

interface Code extends Access {
  readonly r?: string
  /** When Google's access token lapses, seconds. */
  readonly x: number
  readonly i: string
  readonly u: string
  readonly k: string
}

interface Refresh {
  readonly r: string
  readonly a: string
  readonly i: string
}

const seconds = (config: SignInConfig): number => Math.floor(config.now().getTime() / 1000)
const short = (text: string): string => createHash('sha256').update(text).digest('base64url').slice(0, 22)

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

function oauthError(status: number, error: string, description: string): Response {
  return json(status, { error, error_description: description })
}

/** A page for a person whose sign-in cannot go back to their chat app. */
function page(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } })
}

function back(to: string, params: Record<string, string | undefined>): Response {
  const url = new URL(to)
  for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value)
  return redirect(url.toString())
}

/** The resource the chat app's token is for: the endpoint's root. */
export function resource(config: Pick<SignInConfig, 'origin'>): string {
  return `${config.origin}/`
}

export function resourceMetadataUrl(config: Pick<SignInConfig, 'origin'>): string {
  return `${config.origin}/.well-known/oauth-protected-resource`
}

/** RFC 9728: what the endpoint is, and who signs a person in to it. */
export function protectedResource(config: SignInConfig): Response {
  return json(200, {
    resource: resource(config),
    authorization_servers: [config.origin],
    bearer_methods_supported: ['header'],
    resource_name: 'Emerald — Google Drive connector',
    resource_documentation: 'https://getemerald.dev/',
  })
}

/** RFC 8414: how a chat app signs a person in. */
export function authorizationServer(config: SignInConfig): Response {
  return json(200, {
    issuer: config.origin,
    authorization_endpoint: `${config.origin}/authorize`,
    token_endpoint: `${config.origin}/token`,
    registration_endpoint: `${config.origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
}

/**
 * A redirect URI a chat app may register: `https`, `http` on this machine's
 * loopback only, or an app's own scheme — never one that runs or embeds.
 */
export function acceptableRedirect(uri: unknown): uri is string {
  if (typeof uri !== 'string') return false
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.hash !== '') return false
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  return !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'].includes(url.protocol)
}

/** RFC 7591: a chat app registers, and its id is its redirect URIs, sealed. */
export async function register(request: Request, config: SignInConfig): Promise<Response> {
  let body: { redirect_uris?: unknown; client_name?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return oauthError(400, 'invalid_client_metadata', 'The registration was not JSON.')
  }
  const uris = body.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every(acceptableRedirect)) {
    return oauthError(400, 'invalid_redirect_uri', 'Give one to ten redirect URIs, each https, http on loopback, or an app scheme.')
  }
  const client: Client = { u: uris }
  return json(201, {
    client_id: seal(config.key, 'client', client),
    client_id_issued_at: seconds(config),
    redirect_uris: uris,
    ...(typeof body.client_name === 'string' ? { client_name: body.client_name.slice(0, 200) } : {}),
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  })
}

/** `/authorize`: checked, then on to Google with the sign-in sealed into Google's `state`. */
export function authorize(request: Request, config: SignInConfig): Response {
  const query = new URL(request.url).searchParams
  const clientId = query.get('client_id') ?? ''
  const client = unseal<Client>(config.key, 'client', clientId, seconds(config))
  if (client === undefined) {
    return page(400, 'This chat app is not registered with the Emerald connector. Remove the connector and add it again.')
  }
  const given = query.get('redirect_uri')
  const redirectUri = given ?? (client.u.length === 1 ? client.u[0] : undefined)
  if (redirectUri === undefined || !client.u.includes(redirectUri)) {
    return page(400, 'This sign-in names a return address its chat app did not register, so it stops here.')
  }
  const state = query.get('state') ?? undefined
  const refuse = (error: string, description: string): Response =>
    back(redirectUri, { error, error_description: description, state })
  if (query.get('response_type') !== 'code') return refuse('unsupported_response_type', 'Only the code flow is offered.')
  const challenge = query.get('code_challenge')
  if (challenge === null || query.get('code_challenge_method') !== 'S256') {
    return refuse('invalid_request', 'A PKCE challenge, by S256, is required.')
  }
  const named = query.get('resource')
  if (named !== null && named.replace(/\/$/, '') !== config.origin) {
    return refuse('invalid_target', `This server signs in for ${resource(config)} alone.`)
  }

  const pending: PendingSignIn = { i: short(clientId), u: redirectUri, ...(state === undefined ? {} : { s: state }), k: challenge }
  const google = new URL(config.google.authorize)
  google.searchParams.set('client_id', config.google.clientId)
  google.searchParams.set('redirect_uri', `${config.origin}${GOOGLE_CALLBACK}`)
  google.searchParams.set('response_type', 'code')
  google.searchParams.set('scope', GOOGLE_SCOPES)
  // Offline and consent, so Google gives a refresh token and the chat app need not sign in hourly.
  google.searchParams.set('access_type', 'offline')
  google.searchParams.set('prompt', 'consent')
  google.searchParams.set('state', seal(config.key, 'state', pending, seconds(config) + SIGN_IN_SECONDS))
  return redirect(google.toString())
}

interface GoogleTokens {
  readonly access_token?: string
  readonly expires_in?: number
  readonly refresh_token?: string
  readonly id_token?: string
  readonly scope?: string
  readonly error?: string
}

async function askGoogle(config: SignInConfig, form: Record<string, string>): Promise<GoogleTokens> {
  const response = await config.fetch(config.google.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...form }).toString(),
  })
  const tokens = (await response.json().catch(() => ({}))) as GoogleTokens
  return response.ok ? tokens : { error: tokens.error ?? `status ${String(response.status)}` }
}

/**
 * The address in Google's ID token. Read without checking its signature: it
 * came straight from Google's token endpoint over TLS, which OpenID Connect
 * (Core §3.1.3.7) counts as checked.
 */
export function emailOf(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1]
  if (payload === undefined) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown }
    return typeof claims.email === 'string' && claims.email.includes('@') ? claims.email : undefined
  } catch {
    return undefined
  }
}

/** `/oauth/google`: Google's code traded for Google's tokens, and the chat app handed a code of ours. */
export async function googleCallback(request: Request, config: SignInConfig): Promise<Response> {
  const query = new URL(request.url).searchParams
  const pending = unseal<PendingSignIn>(config.key, 'state', query.get('state') ?? '', seconds(config))
  if (pending === undefined) {
    return page(400, 'This sign-in took too long or did not start here. Start it again from your chat app.')
  }
  const refuse = (error: string, description: string): Response =>
    back(pending.u, { error, error_description: description, state: pending.s })
  const code = query.get('code')
  if (code === null) return refuse('access_denied', 'Signing in with Google was cancelled.')

  const tokens = await askGoogle(config, { grant_type: 'authorization_code', code, redirect_uri: `${config.origin}${GOOGLE_CALLBACK}` })
  if (tokens.error !== undefined || tokens.access_token === undefined) {
    return refuse('server_error', 'Google did not finish the sign-in. Try again.')
  }
  // Google lets a person untick a scope; without drive.file there is no document to reach.
  if (!(tokens.scope ?? '').split(' ').includes(DRIVE_FILE_SCOPE)) {
    return refuse('access_denied', 'Emerald needs to see the files it makes in your Google Drive. Sign in again and allow it.')
  }
  const email = emailOf(tokens.id_token)
  if (email === undefined) return refuse('access_denied', 'Google did not say which account signed in. Sign in again.')

  const ours: Code = {
    g: tokens.access_token,
    ...(tokens.refresh_token === undefined ? {} : { r: tokens.refresh_token }),
    x: seconds(config) + (tokens.expires_in ?? 3600),
    a: accountKey(email),
    i: pending.i,
    u: pending.u,
    k: pending.k,
  }
  return back(pending.u, { code: seal(config.key, 'code', ours, seconds(config) + CODE_SECONDS), state: pending.s })
}

async function formOf(request: Request): Promise<URLSearchParams> {
  const text = await request.text()
  if ((request.headers.get('Content-Type') ?? '').includes('application/json')) {
    try {
      return new URLSearchParams(Object.entries(JSON.parse(text) as Record<string, string>))
    } catch {
      return new URLSearchParams()
    }
  }
  return new URLSearchParams(text)
}

function issued(config: SignInConfig, access: Access, lapses: number, refresh: string | undefined): Response {
  const until = Math.max(seconds(config) + 60, lapses - EARLY_SECONDS)
  return json(200, {
    access_token: seal(config.key, 'access', access, until),
    token_type: 'Bearer',
    expires_in: until - seconds(config),
    ...(refresh === undefined ? {} : { refresh_token: refresh }),
  })
}

/** `/token`: a code, or a refresh token, traded for the chat app's token. */
export async function token(request: Request, config: SignInConfig): Promise<Response> {
  const form = await formOf(request)
  const clientId = form.get('client_id')
  const now = seconds(config)

  if (form.get('grant_type') === 'authorization_code') {
    const code = unseal<Code>(config.key, 'code', form.get('code') ?? '', now)
    if (code === undefined) return oauthError(400, 'invalid_grant', 'The code is not one of ours, or it lapsed.')
    if (clientId !== null && short(clientId) !== code.i) return oauthError(400, 'invalid_grant', 'The code was given to another client.')
    if (form.get('redirect_uri') !== null && form.get('redirect_uri') !== code.u) {
      return oauthError(400, 'invalid_grant', 'The redirect URI is not the one the code was given to.')
    }
    const verifier = form.get('code_verifier') ?? ''
    if (createHash('sha256').update(verifier).digest('base64url') !== code.k) {
      return oauthError(400, 'invalid_grant', 'The PKCE verifier does not match.')
    }
    const refresh = code.r === undefined ? undefined : seal(config.key, 'refresh', { r: code.r, a: code.a, i: code.i } satisfies Refresh)
    return issued(config, { g: code.g, a: code.a }, code.x, refresh)
  }

  if (form.get('grant_type') === 'refresh_token') {
    const refresh = unseal<Refresh>(config.key, 'refresh', form.get('refresh_token') ?? '', now)
    if (refresh === undefined) return oauthError(400, 'invalid_grant', 'The refresh token is not one of ours.')
    if (clientId !== null && short(clientId) !== refresh.i) return oauthError(400, 'invalid_grant', 'The refresh token was given to another client.')
    const tokens = await askGoogle(config, { grant_type: 'refresh_token', refresh_token: refresh.r })
    if (tokens.error !== undefined || tokens.access_token === undefined) {
      return oauthError(400, 'invalid_grant', 'Google no longer accepts this sign-in. Sign in again.')
    }
    // Google may hand a new refresh token; the old one then stops working.
    const next = tokens.refresh_token === undefined ? form.get('refresh_token') ?? undefined : seal(config.key, 'refresh', { ...refresh, r: tokens.refresh_token } satisfies Refresh)
    return issued(config, { g: tokens.access_token, a: refresh.a }, now + (tokens.expires_in ?? 3600), next)
  }

  return oauthError(400, 'unsupported_grant_type', 'A code or a refresh token.')
}

/** The person behind a call, from its `Authorization` header; undefined for none, or one that does not open. */
export function bearer(request: Request, config: SignInConfig): Access | undefined {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (match?.[1] === undefined) return undefined
  return unseal<Access>(config.key, 'access', match[1], seconds(config))
}
