import { describe, expect, it } from 'vitest'

import { RUNTIME_KINDS } from './bridge.ts'
import {
  DEFAULT_ORIGINS,
  detectRuntimes,
  isLoopbackOrigin,
  probeRuntime,
  readLmStudioModels,
  readOllamaTags,
  type FetchLike,
} from './runtimes.ts'

/**
 * A server that is not there. `routes` maps a full URL to what it answers;
 * anything not in it fails the way a refused connection does, which is what
 * `absent` has to be recognised from.
 */
function serving(routes: Readonly<Record<string, unknown>>, status = 200): FetchLike {
  return (url) => {
    const body = routes[url]
    if (body === undefined) {
      const error = new TypeError('fetch failed')
      error.cause = Object.assign(new Error(`connect ECONNREFUSED ${url}`), {
        code: 'ECONNREFUSED',
      })
      return Promise.reject(error)
    }
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    )
  }
}

const OLLAMA = DEFAULT_ORIGINS.ollama
const LM = DEFAULT_ORIGINS.lmstudio

const OLLAMA_TAGS = {
  models: [
    { name: 'qwen3:8b', model: 'qwen3:8b', size: 5_225_000_000 },
    { name: 'llama3.2:3b', model: 'llama3.2:3b', size: 2_019_000_000 },
  ],
}

const LM_MODELS = {
  data: [
    { id: 'qwen2.5-7b-instruct', type: 'llm', size_on_disk: 4_683_000_000 },
    { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings', size_on_disk: 84_000_000 },
  ],
}

describe('isLoopbackOrigin — the only thing standing between this app and the network', () => {
  it('allows this machine, by every spelling of it', () => {
    expect(isLoopbackOrigin('http://localhost:11434')).toBe(true)
    expect(isLoopbackOrigin('http://127.0.0.1:11434')).toBe(true)
    expect(isLoopbackOrigin('http://[::1]:1234')).toBe(true)
    // The whole of 127/8, because a runtime may be bound anywhere in it.
    expect(isLoopbackOrigin('http://127.0.0.2:1234')).toBe(true)
    expect(isLoopbackOrigin('http://127.94.0.17:1234')).toBe(true)
  })

  it('allows the obfuscated spellings of 127.0.0.1, because URL normalises them first', () => {
    // Refusing these would look like caution and be the opposite: they are the
    // loopback address, and a guard that rejects them has not understood the
    // host it is inspecting.
    expect(isLoopbackOrigin('http://2130706433:11434')).toBe(true)
    expect(isLoopbackOrigin('http://0x7f.1:11434')).toBe(true)
    expect(isLoopbackOrigin('http://[0:0:0:0:0:0:0:1]:1234')).toBe(true)
  })

  it('refuses a name that merely begins or ends with a loopback one', () => {
    expect(isLoopbackOrigin('http://localhost.example.com/api/tags')).toBe(false)
    expect(isLoopbackOrigin('http://127.0.0.1.example.com/api/tags')).toBe(false)
    expect(isLoopbackOrigin('http://notlocalhost/api/tags')).toBe(false)
    expect(isLoopbackOrigin('http://mylocalhost:11434')).toBe(false)
  })

  it('refuses the address that looks local and is not', () => {
    // The address a server binds to, never one a client connects to.
    expect(isLoopbackOrigin('http://0.0.0.0:11434')).toBe(false)
    // The private ranges are somebody else's machine on the same wire.
    expect(isLoopbackOrigin('http://192.168.1.9:11434')).toBe(false)
    expect(isLoopbackOrigin('http://10.0.0.4:11434')).toBe(false)
    expect(isLoopbackOrigin('http://169.254.169.254/latest/meta-data/')).toBe(false)
  })

  it('refuses credentials in the URL, which is where a host can be hidden', () => {
    expect(isLoopbackOrigin('http://localhost@example.com/api/tags')).toBe(false)
    expect(isLoopbackOrigin('http://user:pass@127.0.0.1:11434')).toBe(false)
  })

  it('refuses every scheme but http, and every string that is not a URL', () => {
    expect(isLoopbackOrigin('https://127.0.0.1:11434')).toBe(false)
    expect(isLoopbackOrigin('file:///etc/passwd')).toBe(false)
    expect(isLoopbackOrigin('ws://127.0.0.1:11434')).toBe(false)
    expect(isLoopbackOrigin('app://emerald/index.html')).toBe(false)
    expect(isLoopbackOrigin('')).toBe(false)
    expect(isLoopbackOrigin('127.0.0.1:11434')).toBe(false)
  })

  it('is what the defaults are held to', () => {
    for (const runtime of RUNTIME_KINDS) {
      expect(isLoopbackOrigin(DEFAULT_ORIGINS[runtime])).toBe(true)
    }
  })

  it('reaches every runtime by literal address, so no name is ever resolved', () => {
    // M10's "done when" is that this works with no network up, and this is the
    // structural half of it. `localhost` is a *name*: resolving it means a
    // resolver, a hosts file, and on a misconfigured machine a DNS query going
    // out of the box. A literal 127.0.0.1 has nothing to look up, so there is
    // nothing for a network to be up for. The guard accepts `localhost` because
    // a person may type it; the app never does.
    for (const runtime of RUNTIME_KINDS) {
      expect(new URL(DEFAULT_ORIGINS[runtime]).hostname).toMatch(/^127\./)
    }
  })
})

describe('reading a runtime’s list', () => {
  it('takes the name and the size on disk from Ollama', () => {
    const read = readOllamaTags(OLLAMA_TAGS)
    expect(read).toEqual({
      ok: true,
      models: [
        { id: 'qwen3:8b', label: 'qwen3:8b', sizeBytes: 5_225_000_000 },
        { id: 'llama3.2:3b', label: 'llama3.2:3b', sizeBytes: 2_019_000_000 },
      ],
    })
  })

  it('leaves out an LM Studio model that is not something you can talk to', () => {
    const read = readLmStudioModels(LM_MODELS)
    expect(read).toEqual({
      ok: true,
      models: [
        {
          id: 'qwen2.5-7b-instruct',
          label: 'qwen2.5-7b-instruct',
          sizeBytes: 4_683_000_000,
        },
      ],
    })
  })

  it('keeps a model whose kind the runtime did not state', () => {
    // An older build that stops printing `type` should list everything rather
    // than nothing, which is the failure mode of filtering on an absent field.
    const read = readLmStudioModels({ data: [{ id: 'some-model' }] })
    expect(read).toEqual({ ok: true, models: [{ id: 'some-model', label: 'some-model' }] })
  })

  it('omits a size rather than inventing one', () => {
    const read = readOllamaTags({ models: [{ name: 'qwen3:8b' }] })
    expect(read).toEqual({ ok: true, models: [{ id: 'qwen3:8b', label: 'qwen3:8b' }] })
    expect(read.ok && read.models[0]).not.toHaveProperty('sizeBytes')
  })

  it('says so when the answer is not a model list at all', () => {
    expect(readOllamaTags({ ok: true })).toEqual({
      ok: false,
      reason: 'answered, but not with a model list',
    })
    expect(readLmStudioModels(null)).toEqual({
      ok: false,
      reason: 'answered, but not with a model list',
    })
    expect(readOllamaTags({ models: 'qwen3' })).toEqual({
      ok: false,
      reason: 'answered, but not with a model list',
    })
  })
})

describe('probing one runtime', () => {
  it('reports what Ollama has, and its version when it prints one', async () => {
    const probe = await probeRuntime(
      'ollama',
      OLLAMA,
      serving({
        [`${OLLAMA}/api/tags`]: OLLAMA_TAGS,
        [`${OLLAMA}/api/version`]: { version: '0.5.7' },
      }),
    )
    expect(probe).toEqual({
      kind: 'ready',
      runtime: 'ollama',
      origin: OLLAMA,
      version: '0.5.7',
      models: [
        { id: 'qwen3:8b', label: 'qwen3:8b', sizeBytes: 5_225_000_000 },
        { id: 'llama3.2:3b', label: 'llama3.2:3b', sizeBytes: 2_019_000_000 },
      ],
    })
  })

  it('is ready without a version, because a version was never the question', async () => {
    const probe = await probeRuntime('ollama', OLLAMA, serving({ [`${OLLAMA}/api/tags`]: OLLAMA_TAGS }))
    expect(probe.kind).toBe('ready')
    expect(probe).not.toHaveProperty('version')
  })

  it('is ready with no models — installed and empty is not the same as absent', async () => {
    const probe = await probeRuntime('lmstudio', LM, serving({ [`${LM}/api/v0/models`]: { data: [] } }))
    expect(probe).toEqual({ kind: 'ready', runtime: 'lmstudio', origin: LM, models: [] })
  })

  it('calls a refused connection absent', async () => {
    const probe = await probeRuntime('ollama', OLLAMA, serving({}))
    expect(probe).toEqual({ kind: 'absent', runtime: 'ollama', origin: OLLAMA })
  })

  it('calls something else on that port unusable, not absent', async () => {
    // The distinction the app is built on: "install Ollama" is the wrong thing
    // to say to somebody whose port 11434 is taken by something else.
    const probe = await probeRuntime(
      'ollama',
      OLLAMA,
      serving({ [`${OLLAMA}/api/tags`]: '<!doctype html><title>hello</title>' }),
    )
    expect(probe.kind).toBe('unusable')
  })

  it('calls a status that is not 200 unusable, and says what it was', async () => {
    const probe = await probeRuntime(
      'lmstudio',
      LM,
      serving({ [`${LM}/api/v0/models`]: { data: [] } }, 404),
    )
    expect(probe).toMatchObject({ kind: 'unusable', reason: expect.stringContaining('404') })
  })

  it('refuses an origin that is not on this machine, without opening anything', async () => {
    let asked = false
    const probe = await probeRuntime('ollama', 'http://models.example.com', () => {
      asked = true
      return Promise.reject(new Error('should never be called'))
    })
    expect(asked).toBe(false)
    expect(probe).toEqual({
      kind: 'unusable',
      runtime: 'ollama',
      origin: 'http://models.example.com',
      reason: 'a model runtime is reached on this machine or not at all',
    })
  })

  it('reads the code out of the chain fetch actually throws', async () => {
    const aggregate = new AggregateError(
      [Object.assign(new Error('connect ECONNREFUSED ::1:11434'), { code: 'ECONNREFUSED' })],
      'all attempts failed',
    )
    const probe = await probeRuntime('ollama', OLLAMA, () =>
      Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: aggregate })),
    )
    expect(probe).toEqual({ kind: 'absent', runtime: 'ollama', origin: OLLAMA })
  })

  it('calls a port that accepts and then says nothing unusable', async () => {
    const probe = await probeRuntime('ollama', OLLAMA, () =>
      Promise.reject(new DOMException('The operation was aborted', 'TimeoutError')),
    )
    expect(probe).toMatchObject({
      kind: 'unusable',
      reason: 'something is listening on that port but did not answer',
    })
  })
})

describe('detecting every runtime at once', () => {
  it('answers for all of them, in order, whatever it found', async () => {
    const probes = await detectRuntimes(
      DEFAULT_ORIGINS,
      serving({ [`${LM}/api/v0/models`]: LM_MODELS }),
    )
    expect(probes.map((probe) => probe.runtime)).toEqual([...RUNTIME_KINDS])
    expect(probes.map((probe) => probe.kind)).toEqual(['absent', 'ready'])
  })

  it('finds nothing at all without failing', async () => {
    const probes = await detectRuntimes(DEFAULT_ORIGINS, serving({}))
    expect(probes).toEqual([
      { kind: 'absent', runtime: 'ollama', origin: OLLAMA },
      { kind: 'absent', runtime: 'lmstudio', origin: LM },
    ])
  })
})
