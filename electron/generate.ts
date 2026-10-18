/**
 * Asking a local model a question, under ceilings, without letting it take the
 * app with it.
 *
 * M10's "done when" is two clauses and this file is the second one: *a runaway
 * generation cannot hang the UI or fill a disk*. Every ceiling here is a
 * measured failure rather than a precaution — D-114 ran a payslip through
 * qwen3 with reasoning on and got **21,864 tokens over 38 minutes and no
 * answer**, which is the exact shape of a thing that must not be possible from
 * inside the app.
 *
 * **Three decisions the rest of the file follows from.**
 *
 * *It streams, and not for the reason streaming is usually chosen.* Nothing
 * here renders a token as it arrives. It streams because a non-streaming
 * request holds the socket open with no headers until the whole answer exists,
 * and D-114 already lost a run to exactly that: Node's `fetch` gives up after
 * 300 seconds waiting for headers, and a model that does not fit in VRAM takes
 * longer than that per turn. Streaming makes the headers arrive at once, turns
 * the token cap into something enforced *as it happens* rather than measured
 * afterwards, and makes cancelling instant instead of theoretical.
 *
 * *It uses `node:http`, not `fetch`.* Same finding: the header timeout is
 * undici's and is not configurable per request. A cold 17 GB model can be
 * minutes from its first byte while the runtime loads weights, and that is a
 * normal first request, not a fault.
 *
 * *The answer's shape is a grammar, not an instruction.* Both runtimes will
 * constrain decoding to a JSON schema. A model that is asked in prose for JSON
 * sometimes returns prose; a model whose decoder cannot emit anything else
 * cannot. Under D-132 every question this app asks has a known answer shape —
 * a mapping template — so there is never a reason not to.
 *
 * **The origin is re-checked here, and that is not paranoia about our own
 * code.** The provider reaches this file from the renderer, which read it out
 * of `localStorage` (D-135) — a place the machine's owner can edit and anything
 * with DevTools can write. `isLoopbackOrigin` is applied to it again before a
 * socket opens, because "the renderer would not do that" is not a property the
 * main process can check and this is (D-134).
 */

import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'

import type { GenerateRequest, GenerateResult, GenerateStop, Provider } from './bridge.ts'
import { isLoopbackOrigin } from './runtimes.ts'

/**
 * Defaults, each one a number D-114 arrived at rather than picked.
 *
 * `maxTokens` is generous for a mapping template and nowhere near a runaway.
 * `deadlineMs` is five minutes: long enough for a cold load plus a slow answer
 * on a card the model does not fit on, short enough that nobody watches 38
 * minutes of nothing. `contextTokens` is the one that is not a ceiling but a
 * floor — Ollama's own default is 4096, and a prompt carrying preloaded
 * context runs past that silently, with everything above the cut simply not
 * there and the model looking far worse than it is.
 */
const DEFAULTS = { maxTokens: 4096, deadlineMs: 300_000, contextTokens: 32_768 } as const

/**
 * A hard stop on accumulated characters, in case a runtime reports tokens in a
 * way we are not counting. Belt to the token cap's braces, and the reason the
 * word "disk" in the milestone's done-when has an answer here even though
 * nothing in this file writes one: unbounded accumulation is the same fault
 * pointed at memory.
 */
const MAX_CHARS = 4_000_000

/** Reasoning blocks are narration, and the app has no use for them (D-114). */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim()
}

/**
 * The body each runtime wants, from one request.
 *
 * Ollama takes its ceilings in `options` and its schema in `format`; the
 * OpenAI-compatible surface takes `max_tokens` and a `response_format`. The
 * shapes differ and neither is ours, so the translation lives in one function
 * with both spellings visible side by side.
 */
export function requestBody(request: GenerateRequest): Record<string, unknown> {
  const limits = {
    maxTokens: request.limits?.maxTokens ?? DEFAULTS.maxTokens,
    contextTokens: request.limits?.contextTokens ?? DEFAULTS.contextTokens,
  }
  const messages = [
    { role: 'system', content: request.system },
    { role: 'user', content: request.prompt },
  ]

  if (request.provider.runtime === 'ollama') {
    return {
      model: request.provider.model,
      messages,
      stream: true,
      // Off by default, and the single most expensive default there is: with
      // it on, one payslip produced 21,864 tokens over 38 minutes and no
      // answer. Nothing this app asks benefits from narration it discards.
      think: false,
      ...(request.schema === undefined ? {} : { format: request.schema }),
      options: {
        temperature: 0,
        num_ctx: limits.contextTokens,
        num_predict: limits.maxTokens,
      },
    }
  }

  return {
    model: request.provider.model,
    messages,
    stream: true,
    temperature: 0,
    max_tokens: limits.maxTokens,
    ...(request.schema === undefined
      ? {}
      : {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'answer', strict: true, schema: request.schema },
          },
        }),
  }
}

/** Where each runtime takes a chat request. */
function chatPath(provider: Provider): string {
  return provider.runtime === 'ollama' ? '/api/chat' : '/v1/chat/completions'
}

/**
 * One line of a stream → the text it carries, if any.
 *
 * Ollama streams NDJSON, one object per line. The OpenAI-compatible surface
 * streams Server-Sent Events — `data: {…}` lines, ending with `data: [DONE]`.
 * Both are read here so nothing downstream knows which it is.
 */
export function readChunk(
  runtime: Provider['runtime'],
  line: string,
): { readonly text: string; readonly done: boolean } | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return undefined

  if (runtime === 'ollama') {
    try {
      const parsed = JSON.parse(trimmed) as {
        message?: { content?: unknown }
        done?: unknown
      }
      const content = parsed.message?.content
      return { text: typeof content === 'string' ? content : '', done: parsed.done === true }
    } catch {
      return undefined
    }
  }

  if (!trimmed.startsWith('data:')) return undefined
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return { text: '', done: true }
  try {
    const parsed = JSON.parse(payload) as {
      choices?: readonly { delta?: { content?: unknown }; finish_reason?: unknown }[]
    }
    const choice = parsed.choices?.[0]
    const content = choice?.delta?.content
    return {
      text: typeof content === 'string' ? content : '',
      done: choice?.finish_reason != null,
    }
  } catch {
    return undefined
  }
}

/**
 * Roughly how many tokens a piece of text is, for enforcing a cap we are not
 * told the true count of mid-stream.
 *
 * Four characters per token is the usual English approximation and it is wrong
 * for Hebrew, which tokenises worse — so this **overestimates** for the text
 * this app actually handles, and a cap that trips early is the safe direction
 * for a ceiling whose whole job is to stop a runaway. The exact count comes
 * back with the final chunk when the runtime sends one; this is what governs
 * until then.
 */
function approximateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/** A generation in flight, and the handle that stops it. */
interface Running {
  readonly abort: () => void
}

let running: Running | undefined

/** Whether something is generating right now — one at a time is the rule. */
export function isGenerating(): boolean {
  return running !== undefined
}

/** Stop whatever is running. Its promise resolves with `cancelled`. */
export function cancelGeneration(): void {
  running?.abort()
}

/** Injectable so a test can hand over a stream and never open a socket. */
export type Transport = (
  url: string,
  body: unknown,
  handlers: {
    readonly onLine: (line: string) => void
    readonly onEnd: (error?: Error) => void
  },
) => { readonly abort: () => void }

/** The real one: `node:http`, streaming, no header timeout of its own. */
const httpTransport: Transport = (url, body, handlers) => {
  const target = new URL(url)
  const payload = JSON.stringify(body)
  let request: ClientRequest | undefined
  let done = false

  const finish = (error?: Error): void => {
    if (done) return
    done = true
    handlers.onEnd(error)
  }

  request = httpRequest(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    },
    (response: IncomingMessage) => {
      if (response.statusCode !== undefined && response.statusCode >= 400) {
        response.resume()
        finish(new Error(`the runtime answered ${response.statusCode}`))
        return
      }
      response.setEncoding('utf8')
      let buffer = ''
      response.on('data', (piece: string) => {
        buffer += piece
        let cut = buffer.indexOf('\n')
        while (cut !== -1) {
          handlers.onLine(buffer.slice(0, cut))
          buffer = buffer.slice(cut + 1)
          cut = buffer.indexOf('\n')
        }
      })
      response.on('end', () => {
        if (buffer !== '') handlers.onLine(buffer)
        finish()
      })
      response.on('error', (error: Error) => finish(error))
    },
  )

  request.on('error', (error: Error) => finish(error))
  request.write(payload)
  request.end()

  return {
    abort: () => {
      request?.destroy()
      // Not an error: the caller asked for this, and the stop reason it wants
      // is `cancelled` rather than "socket hang up".
      finish()
    },
  }
}

/**
 * Ask the model, and come back with an answer or a reason there is not one.
 *
 * **This never rejects for anything the model or the runtime did.** A refusal,
 * a cap, a timeout and a cancel are all results, because every one of them is
 * a sentence a screen has to be able to say. The only thing that throws is
 * being asked to do two at once, which is a caller mistake rather than a
 * condition of the world.
 */
export async function generate(
  request: GenerateRequest,
  onProgress: (tokens: number) => void = () => {},
  transport: Transport = httpTransport,
): Promise<GenerateResult> {
  const started = Date.now()
  const since = (): number => Date.now() - started

  if (running !== undefined) {
    return { kind: 'failed', reason: 'a model is already answering', elapsedMs: since() }
  }
  if (!isLoopbackOrigin(request.provider.origin)) {
    // The provider came from `localStorage`, which is editable. See the header.
    return {
      kind: 'failed',
      reason: 'a model runtime is reached on this machine or not at all',
      elapsedMs: since(),
    }
  }

  const limits = {
    maxTokens: request.limits?.maxTokens ?? DEFAULTS.maxTokens,
    deadlineMs: request.limits?.deadlineMs ?? DEFAULTS.deadlineMs,
  }

  return new Promise<GenerateResult>((resolve) => {
    let text = ''
    let tokens = 0
    let stop: GenerateStop = 'complete'
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (result: GenerateResult): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      running = undefined
      resolve(result)
    }

    const answer = (): void => {
      const cleaned = stripReasoning(text)
      let value: unknown
      if (request.schema !== undefined && stop === 'complete') {
        try {
          value = JSON.parse(cleaned)
        } catch {
          // Left undefined. A truncated answer is the ordinary way this
          // happens and the caller can see `stop` for itself; throwing here
          // would turn "the model ran out of room" into an exception.
          value = undefined
        }
      }
      settle({
        kind: 'answer',
        stop,
        text: cleaned,
        ...(value === undefined ? {} : { value }),
        tokens,
        elapsedMs: since(),
      })
    }

    const connection = transport(
      `${request.provider.origin}${chatPath(request.provider)}`,
      requestBody(request),
      {
        onLine: (line) => {
          if (settled) return
          const chunk = readChunk(request.provider.runtime, line)
          if (chunk === undefined) return

          if (chunk.text !== '') {
            text += chunk.text
            tokens = approximateTokens(text.length)
            onProgress(tokens)
          }

          if (tokens >= limits.maxTokens || text.length >= MAX_CHARS) {
            stop = 'capped'
            connection.abort()
            answer()
            return
          }
          if (chunk.done) {
            connection.abort()
            answer()
          }
        },
        onEnd: (error) => {
          if (settled) return
          if (error !== undefined) {
            settle({ kind: 'failed', reason: error.message, elapsedMs: since() })
            return
          }
          // The stream ended without a done marker. Whatever arrived is the
          // answer, and `stop` already says if a ceiling ended it.
          answer()
        },
      },
    )

    running = connection
    timer = setTimeout(() => {
      if (settled) return
      stop = 'timedOut'
      connection.abort()
      answer()
    }, limits.deadlineMs)

    // A cancel that arrives before the first byte still has to land.
    running = {
      abort: () => {
        if (settled) return
        stop = 'cancelled'
        connection.abort()
        answer()
      },
    }
  })
}
