import { describe, expect, it } from 'vitest'

import type { Provider, RuntimeProbe } from '../../electron/bridge.ts'
import {
  diskUsed,
  diskUsedIsComplete,
  formatBytes,
  modelChoices,
  resolveProvider,
  sameProvider,
} from './provider.ts'

const OLLAMA = 'http://127.0.0.1:11434'
const LM = 'http://127.0.0.1:1234'

const chosen: Provider = { runtime: 'ollama', origin: OLLAMA, model: 'qwen3:8b' }

const ready: RuntimeProbe = {
  kind: 'ready',
  runtime: 'ollama',
  origin: OLLAMA,
  version: '0.32.15',
  models: [
    { id: 'qwen3:30b-a3b', label: 'qwen3:30b-a3b', sizeBytes: 18_556_699_314 },
    { id: 'qwen3:8b', label: 'qwen3:8b', sizeBytes: 5_225_388_164 },
  ],
}

const lmAbsent: RuntimeProbe = { kind: 'absent', runtime: 'lmstudio', origin: LM }

describe('resolveProvider', () => {
  it('is unsupported without a shell, whatever else is true', () => {
    expect(resolveProvider(chosen, [ready], false)).toEqual({ kind: 'unsupported' })
    expect(resolveProvider(undefined, undefined, false)).toEqual({ kind: 'unsupported' })
  })

  it('is off when nothing was chosen, which is where everybody starts', () => {
    expect(resolveProvider(undefined, [ready, lmAbsent], true)).toEqual({ kind: 'off' })
  })

  it('is ready when the chosen model is in the last look', () => {
    const state = resolveProvider(chosen, [ready, lmAbsent], true)
    expect(state).toEqual({
      kind: 'ready',
      provider: chosen,
      model: { id: 'qwen3:8b', label: 'qwen3:8b', sizeBytes: 5_225_388_164 },
    })
  })

  it('trusts a choice nobody has looked at yet rather than calling it missing', () => {
    // Nothing probes at launch (D-134), so "not checked" is the ordinary state.
    // Reporting `missing` here would be the app blaming the user's setup for
    // its own decision not to open a socket.
    const state = resolveProvider(chosen, undefined, true)
    expect(state).toMatchObject({ kind: 'ready', provider: chosen })
  })

  it('says the runtime is not running when nothing answered', () => {
    const gone: RuntimeProbe = { kind: 'absent', runtime: 'ollama', origin: OLLAMA }
    expect(resolveProvider(chosen, [gone], true)).toEqual({
      kind: 'missing',
      provider: chosen,
      reason: 'that runtime is not running',
    })
  })

  it('passes on what an unusable runtime said, rather than inventing a reason', () => {
    const probe: RuntimeProbe = {
      kind: 'unusable',
      runtime: 'ollama',
      origin: OLLAMA,
      reason: 'answered 404 — something else may be on that port',
    }
    expect(resolveProvider(chosen, [probe], true)).toEqual({
      kind: 'missing',
      provider: chosen,
      reason: 'answered 404 — something else may be on that port',
    })
  })

  it('is the case this file exists for: the model was deleted from underneath it', () => {
    const thinner: RuntimeProbe = {
      ...ready,
      models: ready.models.filter((model) => model.id !== 'qwen3:8b'),
    }
    expect(resolveProvider(chosen, [thinner], true)).toEqual({
      kind: 'missing',
      provider: chosen,
      reason: 'that model is no longer installed',
    })
  })

  it('does not follow a runtime that moved to another port', () => {
    // The same model name at a different origin is a different thing to
    // connect to, and following it would be the app choosing where to send a
    // request nobody authorised.
    const moved: RuntimeProbe = { ...ready, origin: 'http://127.0.0.1:11500' }
    expect(resolveProvider(chosen, [moved], true)).toEqual({
      kind: 'missing',
      provider: chosen,
      reason: 'that runtime has moved',
    })
  })

  it('is missing when the chosen runtime was not looked at at all', () => {
    expect(resolveProvider(chosen, [lmAbsent], true)).toMatchObject({ kind: 'missing' })
  })
})

describe('sameProvider', () => {
  it('compares all three fields', () => {
    expect(sameProvider(chosen, { ...chosen })).toBe(true)
    expect(sameProvider(chosen, { ...chosen, model: 'qwen3:30b-a3b' })).toBe(false)
    expect(sameProvider(chosen, { ...chosen, origin: 'http://127.0.0.1:11500' })).toBe(false)
    expect(sameProvider(chosen, { ...chosen, runtime: 'lmstudio' })).toBe(false)
  })
})

describe('what there is to choose from', () => {
  it('flattens across runtimes and keeps where each one came from', () => {
    const lm: RuntimeProbe = {
      kind: 'ready',
      runtime: 'lmstudio',
      origin: LM,
      models: [{ id: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct' }],
    }
    expect(modelChoices([ready, lm]).map((choice) => [choice.runtime, choice.model.id])).toEqual([
      ['ollama', 'qwen3:30b-a3b'],
      ['ollama', 'qwen3:8b'],
      ['lmstudio', 'qwen2.5-7b-instruct'],
    ])
  })

  it('offers nothing from a runtime that is installed and empty, and does not fail', () => {
    const empty: RuntimeProbe = { kind: 'ready', runtime: 'lmstudio', origin: LM, models: [] }
    expect(modelChoices([empty, lmAbsent])).toEqual([])
  })
})

describe('the disk budget', () => {
  it('adds what the runtimes stated', () => {
    expect(diskUsed([ready, lmAbsent])).toBe(18_556_699_314 + 5_225_388_164)
    expect(diskUsedIsComplete([ready, lmAbsent])).toBe(true)
  })

  it('says it is a floor when a model did not state its size', () => {
    const partial: RuntimeProbe = {
      ...ready,
      models: [...ready.models, { id: 'mystery', label: 'mystery' }],
    }
    expect(diskUsed([partial])).toBe(18_556_699_314 + 5_225_388_164)
    expect(diskUsedIsComplete([partial])).toBe(false)
  })

  it('is zero and complete when nothing was found', () => {
    expect(diskUsed([lmAbsent])).toBe(0)
    expect(diskUsedIsComplete([lmAbsent])).toBe(true)
  })
})

describe('formatBytes', () => {
  it('drops to one decimal below a hundred and none above', () => {
    expect(formatBytes(5_225_388_164)).toBe('4.9 GB')
    expect(formatBytes(18_556_699_314)).toBe('17.3 GB')
    expect(formatBytes(512 * 1024 ** 3)).toBe('512 GB')
    expect(formatBytes(84_000_000)).toBe('80.1 MB')
  })

  it('never prints a fraction of a byte', () => {
    expect(formatBytes(512)).toBe('512 bytes')
    expect(formatBytes(1024)).toBe('1.0 KB')
  })

  it('says nothing rather than NaN for a size that is not one', () => {
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(-1)).toBe('0 MB')
    expect(formatBytes(Number.NaN)).toBe('0 MB')
  })
})
