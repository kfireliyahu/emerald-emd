import { describe, expect, it } from 'vitest'

import type { GenerateRequest, Provider } from './bridge.ts'
import {
  cancelGeneration,
  generate,
  isGenerating,
  readChunk,
  requestBody,
  stripReasoning,
  type Transport,
} from './generate.ts'

const ollama: Provider = { runtime: 'ollama', origin: 'http://127.0.0.1:11434', model: 'qwen3:8b' }
const lm: Provider = { runtime: 'lmstudio', origin: 'http://127.0.0.1:1234', model: 'qwen2.5-7b' }

function ask(provider: Provider, extra: Partial<GenerateRequest> = {}): GenerateRequest {
  return { provider, system: 'You map fields.', prompt: 'Where is the net?', ...extra }
}

/** Ollama's NDJSON: one object a line, the last one `done`. */
function ollamaStream(pieces: readonly string[], done = true): readonly string[] {
  const lines = pieces.map((text) => JSON.stringify({ message: { content: text }, done: false }))
  return done ? [...lines, JSON.stringify({ message: { content: '' }, done: true })] : lines
}

/** The OpenAI-compatible surface's SSE. */
function sseStream(pieces: readonly string[]): readonly string[] {
  return [
    ...pieces.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`),
    'data: [DONE]',
  ]
}

/**
 * A transport that plays lines and never opens a socket. `hold` leaves the
 * stream open after them, which is how a timeout and a cancel are tested
 * without waiting for a real one.
 */
function playing(lines: readonly string[], hold = false): Transport {
  return (_url, _body, handlers) => {
    let stopped = false
    queueMicrotask(() => {
      for (const line of lines) {
        if (stopped) return
        handlers.onLine(line)
      }
      if (!hold && !stopped) handlers.onEnd()
    })
    return {
      abort: () => {
        stopped = true
      },
    }
  }
}

describe('the body each runtime is sent', () => {
  it('turns reasoning off for Ollama, which is the most expensive default there is', () => {
    // D-114: one payslip with reasoning on produced 21,864 tokens over 38
    // minutes and no answer.
    expect(requestBody(ask(ollama))).toMatchObject({ think: false, stream: true })
  })

  it('asks Ollama for a context window, because its own default is 4096', () => {
    const body = requestBody(ask(ollama)) as { options: Record<string, unknown> }
    expect(body.options).toMatchObject({ num_ctx: 32_768, num_predict: 4096, temperature: 0 })
  })

  it('takes the ceilings it is given', () => {
    const body = requestBody(
      ask(ollama, { limits: { maxTokens: 128, contextTokens: 8192 } }),
    ) as { options: Record<string, unknown> }
    expect(body.options).toMatchObject({ num_ctx: 8192, num_predict: 128 })
  })

  it('hands the schema over as a grammar, in each runtime’s spelling', () => {
    const schema = { type: 'object', properties: { net: { type: 'string' } } }
    expect(requestBody(ask(ollama, { schema }))).toMatchObject({ format: schema })
    expect(requestBody(ask(lm, { schema }))).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { strict: true, schema } },
    })
  })

  it('asks for free text when no shape was named, rather than an empty grammar', () => {
    expect(requestBody(ask(ollama))).not.toHaveProperty('format')
    expect(requestBody(ask(lm))).not.toHaveProperty('response_format')
  })
})

describe('reading a chunk off either stream', () => {
  it('reads Ollama’s NDJSON', () => {
    expect(readChunk('ollama', JSON.stringify({ message: { content: 'ab' }, done: false }))).toEqual(
      { text: 'ab', done: false },
    )
    expect(readChunk('ollama', JSON.stringify({ message: { content: '' }, done: true }))).toEqual({
      text: '',
      done: true,
    })
  })

  it('reads SSE, and knows when it is finished', () => {
    expect(readChunk('lmstudio', 'data: {"choices":[{"delta":{"content":"ab"}}]}')).toEqual({
      text: 'ab',
      done: false,
    })
    expect(readChunk('lmstudio', 'data: [DONE]')).toEqual({ text: '', done: true })
    expect(
      readChunk('lmstudio', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'),
    ).toEqual({ text: '', done: true })
  })

  it('ignores what is not a chunk rather than failing the stream', () => {
    expect(readChunk('ollama', '')).toBeUndefined()
    expect(readChunk('ollama', 'not json')).toBeUndefined()
    expect(readChunk('lmstudio', ': keep-alive comment')).toBeUndefined()
    expect(readChunk('lmstudio', 'data: {broken')).toBeUndefined()
  })
})

describe('stripReasoning', () => {
  it('removes a closed narration block', () => {
    expect(stripReasoning('<think>hmm, the net…</think>{"net":"B14"}')).toBe('{"net":"B14"}')
  })

  it('removes one the model never closed, which is what a cap leaves behind', () => {
    expect(stripReasoning('{"a":1}<think>and now I will keep going forever')).toBe('{"a":1}')
  })

  it('leaves an ordinary answer alone', () => {
    expect(stripReasoning('  {"net":"B14"}  ')).toBe('{"net":"B14"}')
  })
})

describe('generate', () => {
  it('returns what the model said, and parses it against the schema asked for', async () => {
    const result = await generate(
      ask(ollama, { schema: { type: 'object' } }),
      () => {},
      playing(ollamaStream(['{"net"', ':"B14"}'])),
    )
    expect(result).toMatchObject({
      kind: 'answer',
      stop: 'complete',
      text: '{"net":"B14"}',
      value: { net: 'B14' },
    })
  })

  it('drops the narration before parsing', async () => {
    const result = await generate(
      ask(ollama, { schema: { type: 'object' } }),
      () => {},
      playing(ollamaStream(['<think>let me see</think>', '{"net":"B14"}'])),
    )
    expect(result).toMatchObject({ kind: 'answer', value: { net: 'B14' } })
  })

  it('reads the other runtime’s stream through the same path', async () => {
    const result = await generate(ask(lm), () => {}, playing(sseStream(['hello ', 'there'])))
    expect(result).toMatchObject({ kind: 'answer', stop: 'complete', text: 'hello there' })
  })

  it('stops at the token cap rather than letting a loop fill the context', async () => {
    // The failure this ceiling exists for: 21,864 tokens over 38 minutes.
    const forever = Array.from({ length: 500 }, () => 'aaaaaaaaaaaaaaaa')
    const result = await generate(
      ask(ollama, { limits: { maxTokens: 8 } }),
      () => {},
      playing(ollamaStream(forever, false), true),
    )
    expect(result).toMatchObject({ kind: 'answer', stop: 'capped' })
    expect(result.kind === 'answer' && result.tokens).toBeGreaterThanOrEqual(8)
    // And it stopped early rather than reading all 500 lines.
    expect(result.kind === 'answer' && result.text.length).toBeLessThan(200)
  })

  it('does not parse a capped answer, because half a document is not one', async () => {
    const result = await generate(
      ask(ollama, { schema: { type: 'object' }, limits: { maxTokens: 2 } }),
      () => {},
      playing(ollamaStream(['{"net":"B14","gross"'], false), true),
    )
    expect(result).toMatchObject({ kind: 'answer', stop: 'capped' })
    expect(result).not.toHaveProperty('value')
  })

  it('gives up at the deadline and keeps what it had', async () => {
    const result = await generate(
      ask(ollama, { limits: { deadlineMs: 60 } }),
      () => {},
      playing(ollamaStream(['partial'], false), true),
    )
    expect(result).toMatchObject({ kind: 'answer', stop: 'timedOut', text: 'partial' })
  })

  it('is cancellable, and says so rather than reporting an error', async () => {
    const pending = generate(
      ask(ollama, { limits: { deadlineMs: 10_000 } }),
      () => {},
      playing(ollamaStream(['some of it'], false), true),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(isGenerating()).toBe(true)
    cancelGeneration()
    await expect(pending).resolves.toMatchObject({ stop: 'cancelled', text: 'some of it' })
    expect(isGenerating()).toBe(false)
  })

  it('reports tokens while it runs, which is what keeps a slow answer legible', async () => {
    const seen: number[] = []
    await generate(ask(ollama), (tokens) => seen.push(tokens), playing(ollamaStream(['aaaa', 'bbbb', 'cccc'])))
    expect(seen.length).toBe(3)
    // Monotonic: a progress line that goes backwards is worse than none.
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('refuses a second question while one is in flight', async () => {
    const first = generate(
      ask(ollama, { limits: { deadlineMs: 10_000 } }),
      () => {},
      playing(ollamaStream(['working'], false), true),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(generate(ask(ollama), () => {}, playing([]))).resolves.toMatchObject({
      kind: 'failed',
      reason: 'a model is already answering',
    })
    cancelGeneration()
    await first
  })

  it('refuses an origin that is not on this machine, and opens nothing', async () => {
    // The provider comes from localStorage, which the machine's owner can
    // edit (D-135). The guard is applied again here for exactly that reason.
    let opened = false
    const result = await generate(
      ask({ ...ollama, origin: 'http://models.example.com' }),
      () => {},
      () => {
        opened = true
        return { abort: () => {} }
      },
    )
    expect(opened).toBe(false)
    expect(result).toMatchObject({
      kind: 'failed',
      reason: 'a model runtime is reached on this machine or not at all',
    })
  })

  it('passes on a transport failure as a result, never as a rejection', async () => {
    const result = await generate(ask(ollama), () => {}, (_url, _body, handlers) => {
      queueMicrotask(() => handlers.onEnd(new Error('the runtime answered 500')))
      return { abort: () => {} }
    })
    expect(result).toMatchObject({ kind: 'failed', reason: 'the runtime answered 500' })
  })

  it('takes an ended stream with no done marker as the answer it is', async () => {
    const result = await generate(ask(ollama), () => {}, playing(ollamaStream(['all of it'], false)))
    expect(result).toMatchObject({ kind: 'answer', stop: 'complete', text: 'all of it' })
  })

  it('leaves nothing running after any of the ways it can end', async () => {
    await generate(ask(ollama), () => {}, playing(ollamaStream(['a'])))
    expect(isGenerating()).toBe(false)
    await generate(ask(ollama, { limits: { deadlineMs: 40 } }), () => {}, playing([], true))
    expect(isGenerating()).toBe(false)
    await generate(ask({ ...ollama, origin: 'http://example.com' }), () => {}, playing([]))
    expect(isGenerating()).toBe(false)
  })
})
