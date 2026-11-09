/**
 * **The Google Drive connector, as the file Google Cloud runs** (M57 U4, D-568).
 *
 * `npm run build:hosted` bundles this to `dist-hosted/index.mjs`, with a
 * `package.json` beside it naming it, so the folder deploys as it is:
 *
 * - **as a Cloud Run function**, whose entry point is `emerald` — a Node
 *   `(request, response)` handler, which is what the Functions Framework calls;
 * - **or run by Node** — `node dist-hosted/index.mjs` serves the endpoint on
 *   `PORT`, the way a Cloud Run service runs a container.
 *
 * Two more things it runs, from a terminal:
 *
 * - `--local` — the endpoint on `http://localhost:8787` against Google in
 *   memory (`fakeGoogle.ts`): Drive and the sign-in faked, and Firestore faked
 *   too unless `FIRESTORE_EMULATOR_HOST` names the emulator. A chat app pointed
 *   at it signs in with no Google page at all, as `person@example.com` or the
 *   address after `--as`;
 * - `key <email>` — the id of that person's record in Firestore, so a request
 *   to delete it, written from that address, finds it (D-566).
 *
 * **It installs the guard as the process's `fetch`** (`network.ts`): whatever
 * in the bundle sends a request, it reaches Google's APIs or nothing.
 */

import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

import { endpoint, type Handler } from './endpoint.ts'
import { FakeGoogle } from './fakeGoogle.ts'
import { googleOnly } from './network.ts'
import { sealKey } from './seal.ts'
import { GOOGLE_AUTHORIZE, GOOGLE_CALLBACK, GOOGLE_TOKEN } from './signIn.ts'
import { accountKey, firestoreUsage } from './usage.ts'

/** Where the connector answers (D-562). */
export const ORIGIN = 'https://mcp.getemerald.dev'

const emulator = process.env['FIRESTORE_EMULATOR_HOST']?.trim() || undefined
const localHosts = emulator === undefined ? [] : [emulator]
const send = googleOnly(globalThis.fetch.bind(globalThis), localHosts)
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
  send(input instanceof Request ? input.url : String(input), init ?? {})) as typeof fetch

/** The environment the endpoint needs, by name. */
export const ENVIRONMENT = {
  clientId: 'EMERALD_GOOGLE_CLIENT_ID',
  clientSecret: 'EMERALD_GOOGLE_CLIENT_SECRET',
  key: 'EMERALD_SEAL_KEY',
  project: 'EMERALD_FIRESTORE_PROJECT',
  origin: 'EMERALD_ORIGIN',
  sweepKey: 'EMERALD_SWEEP_KEY',
} as const

/** The endpoint as the environment configures it, or what is missing. */
export function configured(env: NodeJS.ProcessEnv): Handler | string {
  const value = (name: string): string | undefined => env[name]?.trim() || undefined
  const key = sealKey(value(ENVIRONMENT.key))
  const clientId = value(ENVIRONMENT.clientId)
  const clientSecret = value(ENVIRONMENT.clientSecret)
  const project = value(ENVIRONMENT.project) ?? value('GOOGLE_CLOUD_PROJECT')
  const missing = [
    ...(clientId === undefined ? [ENVIRONMENT.clientId] : []),
    ...(clientSecret === undefined ? [ENVIRONMENT.clientSecret] : []),
    ...(key === undefined ? [`${ENVIRONMENT.key} (32 bytes, base64)`] : []),
    ...(project === undefined ? [ENVIRONMENT.project] : []),
  ]
  if (clientId === undefined || clientSecret === undefined || key === undefined || project === undefined) {
    return `The connector is not configured: ${missing.join(', ')}.`
  }
  const sweepKey = value(ENVIRONMENT.sweepKey)
  return endpoint({
    origin: (value(ENVIRONMENT.origin) ?? ORIGIN).replace(/\/+$/, ''),
    key,
    google: { clientId, clientSecret, authorize: GOOGLE_AUTHORIZE, token: GOOGLE_TOKEN },
    fetch: send,
    now: () => new Date(),
    usage: firestoreUsage({ project, ...(emulator === undefined ? {} : { emulator }), fetch: send }),
    ...(sweepKey === undefined ? {} : { sweepKey }),
  })
}

/** A Node request as a web one, and the web answer written back. Body read once, from `rawBody` if a framework already read it. */
export async function serveNode(handle: Handler, origin: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body: Buffer | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const raw = (request as IncomingMessage & { rawBody?: unknown }).rawBody
    if (Buffer.isBuffer(raw)) body = raw
    else {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      body = Buffer.concat(chunks)
    }
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value)
    else if (Array.isArray(value)) for (const each of value) headers.append(name, each)
  }
  // The address the request was made to is the configured one, never its Host header.
  const answer = await handle(
    new Request(new URL(request.url ?? '/', origin), {
      method: request.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body: new Uint8Array(body) }),
    }),
  )
  response.statusCode = answer.status
  answer.headers.forEach((value, name) => response.setHeader(name, value))
  response.end(Buffer.from(await answer.arrayBuffer()))
}

let handler: Handler | string | undefined

/** **The Cloud Run function's entry point.** */
export async function emerald(request: IncomingMessage, response: ServerResponse): Promise<void> {
  handler ??= configured(process.env)
  if (typeof handler === 'string') {
    response.statusCode = 503
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.end(handler)
    return
  }
  const origin = (process.env[ENVIRONMENT.origin]?.trim() || ORIGIN).replace(/\/+$/, '')
  await serveNode(handler, origin, request, response)
}

/** The endpoint on this machine, against Google in memory. */
function local(port: number, as: string): Handler {
  const origin = `http://localhost:${String(port)}`
  const google = new FakeGoogle()
  const handle = endpoint({
    origin,
    // A fresh key each run: what a chat app was handed lapses when this stops.
    key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
    google: { clientId: 'google-client', clientSecret: 'google-secret', authorize: `${origin}/local-google`, token: GOOGLE_TOKEN },
    fetch: google.fetch,
    now: () => new Date(),
    usage: firestoreUsage({ project: 'emerald-local', ...(emulator === undefined ? {} : { emulator }), fetch: emulator === undefined ? google.fetch : send }),
  })
  return async (request) => {
    const url = new URL(request.url)
    // Google's page, stood in for: signed in as `as`, straight back.
    if (url.pathname === '/local-google') {
      const back = new URL(`${origin}${GOOGLE_CALLBACK}`)
      back.searchParams.set('code', google.signIn({ email: as }))
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      return new Response(null, { status: 302, headers: { Location: back.toString() } })
    }
    return handle(request)
  }
}

const argv = process.argv.slice(2)
const runAsMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (runAsMain && argv[0] === 'key') {
  if (argv[1] === undefined) {
    process.stderr.write('Usage: node index.mjs key <email>\n')
    process.exitCode = 2
  } else process.stdout.write(`accounts/${accountKey(argv[1])}\n`)
} else if (runAsMain) {
  const port = Number(process.env['PORT']) || 8787
  const asAt = argv.indexOf('--as')
  const handle = argv.includes('--local') ? local(port, (asAt >= 0 ? argv[asAt + 1] : undefined) ?? 'person@example.com') : configured(process.env)
  if (typeof handle === 'string') {
    process.stderr.write(`${handle}\n`)
    process.exitCode = 2
  } else {
    const origin = argv.includes('--local') ? `http://localhost:${String(port)}` : (process.env[ENVIRONMENT.origin]?.trim() || ORIGIN).replace(/\/+$/, '')
    httpServer((request, response) => {
      void serveNode(handle, origin, request, response).catch(() => {
        response.statusCode = 500
        response.end()
      })
    }).listen(port, argv.includes('--local') ? '127.0.0.1' : undefined, () => {
      process.stderr.write(`Emerald's Google Drive connector answers at ${origin}\n`)
    })
  }
}
