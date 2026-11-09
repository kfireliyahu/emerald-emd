/**
 * **The Google Drive connector's endpoint: MCP over HTTP at the root of
 * mcp.getemerald.dev** (M57 U4, D-560, D-562, D-568).
 *
 * One function from a request to a response, the same whether Cloud Run runs
 * it or a local run does (`main.ts`). It answers:
 *
 * - `POST /` — MCP, Streamable HTTP, stateless: each request makes a server
 *   with the connector's tools (U2) and a store over the person's Drive (U3),
 *   answers in JSON, and keeps nothing. **At the root, with no `/mcp` path**,
 *   as PRIVACY.md says (D-565). Without a token that opens, 401 and where to
 *   sign in;
 * - the sign-in (`signIn.ts`): the two metadata documents, `/register`,
 *   `/authorize`, `/oauth/google` and `/token`;
 * - `POST /sweep` — the 90-day deletion, for Cloud Scheduler, only when a sweep
 *   key is set and given.
 *
 * Each `tools/call` is counted first (`usage.ts`): over 200 today it is refused
 * saying when the cap resets, and nothing reaches Drive. **The person's first
 * call** — the one that makes their record — carries D-565's warning above its
 * answer, word for word.
 *
 * **It logs nothing.** Not a call, its arguments, a tool's name or a word of the
 * document: Google Cloud's request log holds a request's time, address and
 * status, and this code adds no line to it (D-565).
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { createServer, err, type DocumentStore, type Result } from '@/plugin/host.ts'

import type { Fetch } from './drive.ts'
import { openDriveDocument, type DriveDocument } from './store.ts'
import {
  authorizationServer,
  authorize,
  bearer,
  GOOGLE_CALLBACK,
  googleCallback,
  protectedResource,
  register,
  resourceMetadataUrl,
  token,
  type SignInConfig,
} from './signIn.ts'
import { dayOf, overTheCap, type UsageStore } from './usage.ts'

/**
 * **The first-use warning, D-565's words exactly**: shown once, above the
 * answer to the person's first call.
 */
export const FIRST_USE_WARNING =
  'Before you start: your Emerald document is Emerald/Emerald.emd in your own Google Drive. ' +
  'Each call reads it from your Drive, works on it at mcp.getemerald.dev and writes it back, and nothing of it is kept there. ' +
  "It offers Emerald's own tools for formats and their rows; the ledger and the development pack stay in the desktop app and the plugin on your computer. " +
  "Earlier copies are in Drive's version history, and what is kept about you is in Emerald's privacy policy."

/** The largest request body read: a batch of rows fits many times over; a document never travels in one. */
export const BODY_LIMIT = 4 * 1024 * 1024

export interface EndpointConfig extends SignInConfig {
  readonly usage: UsageStore
  /** The bearer `/sweep` takes; without one, `/sweep` is not there. */
  readonly sweepKey?: string
}

export type Handler = (request: Request) => Promise<Response>

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers } })
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * The Drive store, opened on the first read or write rather than for every
 * request: `initialize` and `tools/list` never reach the person's Drive.
 */
export function lazyDriveStore(accessToken: string, fetch: Fetch): DocumentStore {
  let opened: Promise<Result<DriveDocument, string>> | undefined
  const document = (): Promise<Result<DriveDocument, string>> => (opened ??= openDriveDocument({ accessToken, fetch }))
  return {
    async read(path) {
      const found = await document()
      return found.ok ? found.value.store.read(path) : err(found.error)
    },
    async write(path, bytes, version) {
      const found = await document()
      return found.ok ? found.value.store.write(path, bytes, version) : err(found.error)
    },
    async exclusive(path, work) {
      const found = await document()
      // Not found: the work runs, and its read says why.
      return found.ok ? found.value.store.exclusive(path, work) : work()
    },
  }
}

interface Message {
  readonly jsonrpc?: unknown
  readonly id?: string | number | null
  readonly method?: unknown
}

function rpcError(id: Message['id'], code: number, message: string, status = 400): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status })
}

/** The endpoint, as one function. */
export function endpoint(config: EndpointConfig): Handler {
  /** The day this instance last swept, so it sweeps once a day. */
  let swept = ''

  const unauthorized = (expired: boolean): Response =>
    text(401, 'Sign in to the Emerald connector from your chat app.', {
      'WWW-Authenticate':
        `Bearer ${expired ? 'error="invalid_token", ' : ''}resource_metadata="${resourceMetadataUrl(config)}"`,
    })

  const mcp = async (request: Request): Promise<Response> => {
    const access = bearer(request, config)
    if (access === undefined) return unauthorized(request.headers.has('Authorization'))

    const declared = Number(request.headers.get('Content-Length') ?? '0')
    if (declared > BODY_LIMIT) return rpcError(null, -32600, 'The request is too large.', 413)
    const body = await request.text()
    if (body.length > BODY_LIMIT) return rpcError(null, -32600, 'The request is too large.', 413)
    let message: Message
    try {
      message = JSON.parse(body) as Message
    } catch {
      return rpcError(null, -32700, 'The request was not JSON.')
    }
    // One message a request: batches went with MCP's 2025-06-18 revision.
    if (Array.isArray(message) || typeof message !== 'object' || message === null) {
      return rpcError(null, -32600, 'Send one JSON-RPC message per request.')
    }

    let first = false
    if (message.method === 'tools/call') {
      const now = config.now()
      if (swept !== dayOf(now)) {
        swept = dayOf(now)
        // The 90-day deletion (usage.ts); a failure here never fails the call.
        await config.usage.sweep(now).catch(() => 0)
      }
      const counted = await config.usage.count(access.a, now)
      if (!counted.allowed) {
        return Response.json({
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: { content: [{ type: 'text', text: overTheCap(counted.resets, now) }], isError: true },
        })
      }
      first = counted.first
    }

    const server = createServer({ connector: true, store: lazyDriveStore(access.g, config.fetch) })
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    try {
      await server.connect(transport)
      const response = await transport.handleRequest(new Request(request.url, { method: 'POST', headers: request.headers }), {
        parsedBody: message,
        authInfo: { token: access.g, clientId: 'chat', scopes: [] },
      })
      if (!first || !response.ok) return response
      // The warning above the first answer (D-565).
      const answer = (await response.json()) as { result?: { content?: unknown[] } }
      answer.result?.content?.unshift({ type: 'text', text: FIRST_USE_WARNING })
      return Response.json(answer, { status: response.status })
    } finally {
      await server.close().catch(() => undefined)
    }
  }

  return async (request) => {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    let response: Response
    try {
      if (path === '/' && request.method === 'POST') response = await mcp(request)
      else if (path === '/')
        // Stateless: no stream to open, no session to end.
        response = text(405, 'This is the address of Emerald’s Google Drive connector: add it to your chat app as a connector. https://getemerald.dev', { Allow: 'POST' })
      else if (path.startsWith('/.well-known/oauth-protected-resource')) response = protectedResource(config)
      else if (path.startsWith('/.well-known/oauth-authorization-server')) response = authorizationServer(config)
      else if (path === '/register' && request.method === 'POST') response = await register(request, config)
      else if (path === '/authorize' && request.method === 'GET') response = authorize(request, config)
      else if (path === GOOGLE_CALLBACK && request.method === 'GET') response = await googleCallback(request, config)
      else if (path === '/token' && request.method === 'POST') response = await token(request, config)
      else if (path === '/sweep' && request.method === 'POST' && config.sweepKey !== undefined && request.headers.get('Authorization') === `Bearer ${config.sweepKey}`) {
        response = Response.json({ deleted: await config.usage.sweep(config.now()) })
      } else response = text(404, 'Not here.')
    } catch {
      // Nothing of the request is said or logged (D-565).
      response = text(500, 'The connector failed on this request. Nothing was written. Try again.')
    }
    return withCors(response)
  }
}
