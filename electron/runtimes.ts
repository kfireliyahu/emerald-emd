/**
 * Looking for a local model runtime, and the one rule that makes looking safe.
 *
 * M10's first question is *what is already on this machine* — Ollama and LM
 * Studio both sit on a loopback port and both will list what they have for the
 * asking. Answering it costs two HTTP requests to `127.0.0.1` and nothing else,
 * which is why detection comes before any offer to install anything.
 *
 * **This file is the only place in Emerald that opens a socket, and the guard
 * below is the only thing standing there.** That deserves saying plainly,
 * because it is a departure from how the rule has been kept until now:
 *
 * - The renderer cannot do this and must not learn how. `electron/network.ts`
 *   cancels every request from the page that is not `app://`, `blob:` or
 *   `data:` — `localhost` included, with a test naming Ollama's port (D-124).
 *   That line does not move. The page asks the main process a question over
 *   IPC; the main process is what holds the connection.
 * - The main process's `fetch` is Node's, not Chromium's, so it does **not**
 *   pass through the session guard that protects the renderer. Routing it
 *   through `net.fetch` instead would put it back under that guard — and would
 *   mean loosening the guard to allow loopback, which would hand the same
 *   permission straight back to the page. So the request stays outside, and
 *   `isLoopbackOrigin` is what keeps it honest: pure, string-in, boolean-out,
 *   and a test rather than a comment. Nothing here builds a URL from anything
 *   the document contains.
 *
 * Everything in here is off until something calls it. No probe runs at launch.
 */

import { RUNTIME_KINDS, type ModelCard, type RuntimeKind, type RuntimeProbe } from './bridge.ts'

/**
 * Where each runtime lives when nobody has moved it.
 *
 * Both numbers are the runtime's own default and neither is ours to choose: an
 * Ollama on 11434 and an LM Studio server on 1234 are what a person who
 * installed either one already has running. A person who moved theirs will get
 * `absent` and will have to say where it is, which is the next unit's problem.
 */
export const DEFAULT_ORIGINS: Readonly<Record<RuntimeKind, string>> = {
  ollama: 'http://127.0.0.1:11434',
  lmstudio: 'http://127.0.0.1:1234',
}

/**
 * A runtime that is not there refuses the connection immediately; one that is
 * answers a list from memory. Neither case is slow, so a short ceiling costs
 * nothing and stops a wrong port — one that accepts and then says nothing —
 * from making the app look hung.
 */
const PROBE_TIMEOUT_MS = 2000

/** Enough for a list of models; anything longer is not one. */
const MAX_RESPONSE_BYTES = 1_000_000

/**
 * Is this a URL on this machine's loopback interface, and nothing else?
 *
 * Strict on purpose, and the strictness is the feature. Every host that is not
 * one of three shapes is refused:
 *
 * - `localhost` exactly — never `localhost.example.com`, which is an ordinary
 *   name on the ordinary internet that happens to start with the word.
 * - `127.0.0.0/8` — the whole block, because a runtime bound to `127.0.0.2` is
 *   still on this machine. `URL` normalises the decimal, octal and hex spellings
 *   of an IPv4 address before we ever see it, so `http://2130706433/` and
 *   `http://0x7f.1/` arrive here as `127.0.0.1` and are allowed for the right
 *   reason rather than rejected for the wrong one.
 * - `[::1]` — IPv6 loopback, which `URL` normalises from every longer spelling.
 *
 * `http:` only. Both runtimes serve plaintext on loopback, where there is no
 * wire to listen to, and allowing `https:` would only widen what a mistyped
 * origin could reach. Credentials in the URL are refused as well: nothing
 * local needs them, and `http://ollama@example.com/` is a shape worth having a
 * test say no to out loud.
 */
export function isLoopbackOrigin(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'http:') return false
  if (parsed.username !== '' || parsed.password !== '') return false

  const host = parsed.hostname
  if (host === 'localhost' || host === '[::1]') return true

  // Already normalised to dotted-quad by `URL` if it is an IPv4 address at all.
  const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  return quad !== null && quad[1] === '127'
}

/** What a runtime's list endpoint gave back, or why we are not using it. */
type Listing =
  | { readonly ok: true; readonly models: readonly ModelCard[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Ollama's `GET /api/tags`.
 *
 * `size` is the blob on disk in bytes, which is the number a disk budget needs
 * and the only reason this endpoint is preferred over the OpenAI-compatible
 * `/v1/models` Ollama also serves.
 */
export function readOllamaTags(body: unknown): Listing {
  const models = (body as { models?: unknown } | null)?.models
  if (!Array.isArray(models)) return { ok: false, reason: 'answered, but not with a model list' }

  const cards: ModelCard[] = []
  for (const entry of models) {
    const row = entry as { name?: unknown; model?: unknown; size?: unknown }
    const id = typeof row.name === 'string' ? row.name : row.model
    if (typeof id !== 'string' || id === '') continue
    cards.push({
      id,
      label: id,
      ...(typeof row.size === 'number' && Number.isFinite(row.size) ? { sizeBytes: row.size } : {}),
    })
  }
  return { ok: true, models: cards }
}

/**
 * LM Studio's `GET /api/v0/models` — its own REST surface, not the
 * OpenAI-compatible `/v1/models` beside it.
 *
 * The native one is chosen for one reason: `/v1/models` gives an id and nothing
 * else, and this gives the size on disk and the kind. The kind matters here —
 * an LM Studio install usually holds embedding models too, and offering one as
 * something to transcribe a payslip with is offering a wrong answer.
 */
export function readLmStudioModels(body: unknown): Listing {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return { ok: false, reason: 'answered, but not with a model list' }

  const cards: ModelCard[] = []
  for (const entry of data) {
    const row = entry as { id?: unknown; type?: unknown; size_on_disk?: unknown }
    if (typeof row.id !== 'string' || row.id === '') continue
    // Absent means an older build that does not say; only a stated non-`llm`
    // is excluded, so a runtime that stops printing the field lists everything
    // rather than nothing.
    if (typeof row.type === 'string' && row.type !== 'llm' && row.type !== 'vlm') continue
    const size = row.size_on_disk
    cards.push({
      id: row.id,
      label: row.id,
      ...(typeof size === 'number' && Number.isFinite(size) ? { sizeBytes: size } : {}),
    })
  }
  return { ok: true, models: cards }
}

/** How each runtime is asked, and how its answer is read. */
const LISTINGS: Readonly<
  Record<RuntimeKind, { readonly path: string; readonly read: (body: unknown) => Listing }>
> = {
  ollama: { path: '/api/tags', read: readOllamaTags },
  lmstudio: { path: '/api/v0/models', read: readLmStudioModels },
}

/** Only Ollama prints one, and only as a courtesy. */
const VERSION_PATHS: Readonly<Partial<Record<RuntimeKind, string>>> = {
  ollama: '/api/version',
}

/** Narrow enough that a test can hand over a function and no server. */
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>

/** Nothing is listening on that port — which is the ordinary answer, not a fault. */
const NOTHING_THERE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'EADDRNOTAVAIL'])

/**
 * `fetch` reports what actually happened one or two levels down: the throw is
 * a flat `TypeError: fetch failed` and the `code` is on its `cause`, or inside
 * an `AggregateError` when a name resolved to more than one address. Reading
 * the chain is sturdier than matching the message, which is not ours.
 */
function* causes(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    yield current
    if (current instanceof AggregateError) for (const inner of current.errors) yield* causes(inner)
    current = current instanceof Error ? current.cause : undefined
  }
}

/**
 * A connection that was refused is `absent`; anything else that went wrong is
 * `unusable` and says so. The split is what stops the app telling somebody to
 * install what they already have running on a port something else took.
 */
function failureFrom(runtime: RuntimeKind, origin: string, error: unknown): RuntimeProbe {
  for (const link of causes(error)) {
    const code = (link as { code?: unknown }).code
    if (typeof code === 'string' && NOTHING_THERE.has(code)) {
      return { kind: 'absent', runtime, origin }
    }
    if (link instanceof Error && link.name === 'TimeoutError') {
      return {
        kind: 'unusable',
        runtime,
        origin,
        reason: 'something is listening on that port but did not answer',
      }
    }
  }
  const detail = error instanceof Error ? (error.cause ?? error) : error
  return { kind: 'unusable', runtime, origin, reason: String(detail) }
}

async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new Error('that is not a model list')
  }
  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) throw new Error('that is not a model list')
  return JSON.parse(text) as unknown
}

/**
 * Ask one runtime what it has.
 *
 * The guard is applied here rather than at the call site, so there is one place
 * a non-loopback origin can be refused and it is the place the request is made.
 */
export async function probeRuntime(
  runtime: RuntimeKind,
  origin: string,
  fetchLike: FetchLike = fetch,
): Promise<RuntimeProbe> {
  if (!isLoopbackOrigin(origin)) {
    return {
      kind: 'unusable',
      runtime,
      origin,
      reason: 'a model runtime is reached on this machine or not at all',
    }
  }

  const listing = LISTINGS[runtime]
  let body: unknown
  try {
    const response = await fetchLike(`${origin}${listing.path}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) {
      return {
        kind: 'unusable',
        runtime,
        origin,
        reason: `answered ${response.status} — something else may be on that port`,
      }
    }
    body = await readJson(response)
  } catch (error) {
    return failureFrom(runtime, origin, error)
  }

  const read = listing.read(body)
  if (!read.ok) return { kind: 'unusable', runtime, origin, reason: read.reason }

  const version = await readVersion(runtime, origin, fetchLike)
  return {
    kind: 'ready',
    runtime,
    origin,
    models: read.models,
    ...(version === undefined ? {} : { version }),
  }
}

/** Never a reason to fail the probe — a runtime that lists models is usable. */
async function readVersion(
  runtime: RuntimeKind,
  origin: string,
  fetchLike: FetchLike,
): Promise<string | undefined> {
  const path = VERSION_PATHS[runtime]
  if (path === undefined) return undefined
  try {
    const response = await fetchLike(`${origin}${path}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const value = ((await readJson(response)) as { version?: unknown } | null)?.version
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Look at every runtime we know of, at once, and answer for all of them.
 *
 * In parallel because the slow case is the one where nothing is installed and
 * two timeouts in a row is the worst thing a person could be made to sit
 * through for an answer of "no". Always one entry per runtime, in
 * `RUNTIME_KINDS` order: a screen has to be able to draw "we looked here and
 * found nothing", which is not the same as an empty list.
 */
export async function detectRuntimes(
  origins: Readonly<Record<RuntimeKind, string>> = DEFAULT_ORIGINS,
  fetchLike: FetchLike = fetch,
): Promise<readonly RuntimeProbe[]> {
  return Promise.all(
    RUNTIME_KINDS.map((runtime) => probeRuntime(runtime, origins[runtime], fetchLike)),
  )
}
