import { describe, expect, it } from 'vitest'

import { COPY_META, COPY_TOOL, NOT_THIS_VIEW } from './contract.ts'
import type { Answer } from './host.ts'
import { CHECK_EVERY_MS, firstCopy, NO_PAGE_KEY, PUSH_GRACE_MS, STALE_KEY, startLive, type LiveDeps, type LiveState } from './live.ts'

/**
 * **M44 U4**: the frame finds out which way its host keeps it live — a
 * subscription it forwards, or a change check through `frame_copy` — and says
 * which; a check costs a stamp, not a copy; nothing is asked while hidden.
 * The host and the clock are played.
 */

const TARGET = { path: 'F:/notes/memory.emd', uri: 'file:///F:/notes/memory.emd', stamp: 's1', key: 'k3y' }
const BYTES = btoa('new bytes')

interface Played {
  readonly deps: LiveDeps
  readonly asked: { method: string; params: Record<string, unknown> }[]
  readonly logs: string[]
  readonly states: LiveState[]
  readonly drawn: string[]
  /** Run every timer due by then. */
  advance(ms: number): Promise<void>
  /** What the file is now, as `frame_copy` would see it. */
  file: { stamp: string; gone: boolean }
}

function played(host: { subscribe: boolean; tools: boolean }): Played {
  let clock = 0
  let timers: { at: number; run: () => void; id: number }[] = []
  let ids = 0
  const file = { stamp: 's1', gone: false }
  const asked: Played['asked'] = []
  const logs: string[] = []
  const states: LiveState[] = []
  const drawn: string[] = []
  const answer = (method: string, params: Record<string, unknown>): Answer => {
    if (method === 'resources/subscribe' || method === 'resources/unsubscribe') {
      return host.subscribe ? { ok: true, result: {} } : { ok: false, message: 'Method not found' }
    }
    if (method !== 'tools/call' || !host.tools) return { ok: false, message: 'Not forwarded' }
    expect(params['name']).toBe(COPY_TOOL)
    expect((params['arguments'] as { key?: string }).key).toBe(TARGET.key)
    if (file.gone) return { ok: true, result: { isError: true, content: [{ type: 'text', text: `No document at ${TARGET.path}.` }] } }
    const since = (params['arguments'] as { since?: string }).since
    const copy = since === file.stamp ? { stamp: file.stamp } : { stamp: file.stamp, bytes: BYTES }
    return { ok: true, result: { content: [{ type: 'text', text: '' }], structuredContent: copy } }
  }
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  return {
    asked,
    logs,
    states,
    drawn,
    file,
    deps: {
      ask: async (method, params) => {
        asked.push({ method, params })
        return answer(method, params)
      },
      log: (text) => logs.push(text),
      redraw: async (bytes) => {
        drawn.push(new TextDecoder().decode(bytes))
      },
      onState: (state) => states.push(state),
      now: () => clock,
      setTimer: (run, ms) => {
        const id = ++ids
        timers.push({ at: clock + ms, run, id })
        return id
      },
      clearTimer: (id) => {
        timers = timers.filter((timer) => timer.id !== id)
      },
    },
    advance: async (ms) => {
      const until = clock + ms
      await flush()
      for (;;) {
        const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0]
        if (due === undefined) break
        timers = timers.filter((timer) => timer !== due)
        clock = due.at
        due.run()
        await flush()
      }
      clock = until
      await flush()
    },
  }
}

const calls = (host: Played): number => host.asked.filter((one) => one.method === 'tools/call').length

describe('a drawn view stays live (M44 U4)', () => {
  it('subscribes when the host takes it, and asks again only when told', async () => {
    const host = played({ subscribe: true, tools: true })
    const live = startLive(TARGET, host.deps)
    expect(await live.started).toBe('push')
    expect(host.asked[0]).toEqual({ method: 'resources/subscribe', params: { uri: TARGET.uri } })
    expect(host.logs[0]).toContain('Live by push')
    expect(host.states.at(-1)).toEqual({ mode: 'push', gone: false })

    // No timer runs in push mode: a minute passes and nothing is asked.
    await host.advance(60_000)
    expect(calls(host)).toBe(0)

    host.file.stamp = 's2'
    live.updated('file:///F:/notes/other.emd')
    await host.advance(0)
    expect(calls(host)).toBe(0)
    live.updated(TARGET.uri)
    await host.advance(0)
    expect(host.drawn).toEqual(['new bytes'])
    expect(host.asked.at(-1)?.params).toEqual({ name: COPY_TOOL, arguments: { path: TARGET.path, key: TARGET.key, since: 's1' } })

    // The next word names the stamp the frame now holds.
    live.updated(TARGET.uri)
    await host.advance(0)
    expect(host.asked.at(-1)?.params).toEqual({ name: COPY_TOOL, arguments: { path: TARGET.path, key: TARGET.key, since: 's2' } })
    expect(host.drawn).toHaveLength(1)

    live.stop()
    expect(host.asked.at(-1)).toEqual({ method: 'resources/unsubscribe', params: { uri: TARGET.uri } })
  })

  it('falls back to a stamp check where the host refuses the subscription — in sight only, never a tight poll', async () => {
    const host = played({ subscribe: false, tools: true })
    const live = startLive(TARGET, host.deps)
    expect(await live.started).toBe('check')
    expect(host.logs[0]).toContain('Live by check')
    expect(host.logs[0]).toContain('Method not found')
    const probe = calls(host)
    expect(probe).toBe(1)

    // Unchanged: a check carries the stamp back and no copy.
    await host.advance(CHECK_EVERY_MS)
    expect(calls(host)).toBe(2)
    expect(host.drawn).toEqual([])

    host.file.stamp = 's2'
    await host.advance(CHECK_EVERY_MS)
    expect(host.drawn).toEqual(['new bytes'])

    // Hidden: nothing is asked however long it stays hidden.
    live.sight(false)
    const hidden = calls(host)
    await host.advance(CHECK_EVERY_MS * 10)
    expect(calls(host)).toBe(hidden)

    // Back in sight: one check at once, then the interval again.
    live.sight(true)
    await host.advance(0)
    expect(calls(host)).toBe(hidden + 1)
    // Focus straight after asks nothing more: checks are spaced.
    live.focus()
    await host.advance(0)
    expect(calls(host)).toBe(hidden + 1)
    await host.advance(CHECK_EVERY_MS)
    expect(calls(host)).toBe(hidden + 2)
    live.stop()
    await host.advance(CHECK_EVERY_MS * 3)
    expect(calls(host)).toBe(hidden + 2)
  })

  it('stays a copy as it was, and says so, where the host passes neither on', async () => {
    const host = played({ subscribe: false, tools: false })
    const live = startLive(TARGET, host.deps)
    expect(await live.started).toBe('off')
    expect(host.logs[0]).toContain('Not live')
    expect(host.states.at(-1)).toEqual({ mode: 'off', gone: false })
    await host.advance(CHECK_EVERY_MS * 4)
    expect(calls(host)).toBe(1)
  })

  it('moves to the check when a host takes the subscription and then passes no word on', async () => {
    const host = played({ subscribe: true, tools: true })
    const live = startLive(TARGET, host.deps)
    await live.started
    live.sight(false)
    host.file.stamp = 's2'
    // Back in sight, the check finds a change no notification brought.
    live.sight(true)
    await host.advance(PUSH_GRACE_MS)
    expect(host.drawn).toEqual(['new bytes'])
    expect(host.states.at(-1)).toEqual({ mode: 'check', gone: false })
    expect(host.logs.at(-1)).toContain('passed on no notifications/resources/updated')
    const before = calls(host)
    await host.advance(CHECK_EVERY_MS)
    expect(calls(host)).toBe(before + 1)
    live.stop()
  })

  it('keeps push when the word was only on its way', async () => {
    const host = played({ subscribe: true, tools: true })
    const live = startLive(TARGET, host.deps)
    await live.started
    live.sight(false)
    host.file.stamp = 's2'
    live.sight(true)
    await host.advance(100)
    live.updated(TARGET.uri)
    await host.advance(PUSH_GRACE_MS)
    expect(host.states.at(-1)).toEqual({ mode: 'push', gone: false })
    live.stop()
  })

  it('says once that the file is gone, and draws it again when it is back', async () => {
    const host = played({ subscribe: false, tools: true })
    const live = startLive(TARGET, host.deps)
    await live.started
    host.file.gone = true
    await host.advance(CHECK_EVERY_MS * 2)
    expect(host.states.at(-1)).toEqual({ mode: 'check', gone: true })
    expect(host.logs.filter((line) => line.includes('gone from disk'))).toHaveLength(1)
    host.file.gone = false
    host.file.stamp = 's3'
    await host.advance(CHECK_EVERY_MS)
    expect(host.states.at(-1)).toEqual({ mode: 'check', gone: false })
    expect(host.drawn).toEqual(['new bytes'])
    live.stop()
  })
})

/**
 * **M41 F2**: no result carries the copy, so a drawn view fetches it first —
 * and when it cannot, says which hop failed, in a line a person reads. **M41
 * F3**: with the key its page carries, and the copy in `structuredContent`.
 */
describe('a drawn view fetches its document (M41 F2)', () => {
  it('asks frame_copy with its page’s key, and draws what comes back', async () => {
    const host = played({ subscribe: false, tools: true })
    const copy = await firstCopy(TARGET, host.deps.ask)
    expect(copy).toEqual({ ok: true, bytes: new TextEncoder().encode('new bytes'), stamp: 's1' })
    expect(host.asked[0]?.params).toEqual({ name: COPY_TOOL, arguments: { path: TARGET.path, key: TARGET.key } })
  })

  it('reads the copy, its name and its URI from structuredContent, and from _meta where only that came', async () => {
    const answered = (result: Record<string, unknown>): LiveDeps['ask'] => async () => ({ ok: true, result })
    const copy = { stamp: 's2', name: 'memory.emd', uri: TARGET.uri, bytes: BYTES }
    expect(await firstCopy(TARGET, answered({ content: [], structuredContent: copy }))).toMatchObject({
      ok: true,
      stamp: 's2',
      name: 'memory.emd',
      uri: TARGET.uri,
    })
    expect(await firstCopy(TARGET, answered({ content: [], _meta: { [COPY_META]: copy } }))).toMatchObject({ ok: true, stamp: 's2' })
  })

  it('says the host refused, the server refused, the key is stale, or the answer was emptied — never only that there is nothing', async () => {
    const refusing = played({ subscribe: false, tools: false })
    expect(await firstCopy(TARGET, refusing.deps.ask)).toEqual({ ok: false, reason: expect.stringContaining('The host did not pass on') })
    const failing: LiveDeps['ask'] = async () => ({ ok: true, result: { isError: true, content: [{ type: 'text', text: 'No document at F:/x.emd.' }] } })
    expect(await firstCopy(TARGET, failing)).toEqual({ ok: false, reason: 'The server did not hand over the document: No document at F:/x.emd.' })
    // A page from before the server restarted: a person reads what to do.
    const stale: LiveDeps['ask'] = async () => ({
      ok: true,
      result: { isError: true, content: [{ type: 'text', text: `${NOT_THIS_VIEW}, by the server that drew it, while it runs.` }] },
    })
    expect(await firstCopy(TARGET, stale)).toEqual({ ok: false, reason: STALE_KEY })
    expect(STALE_KEY).toContain('Ask for it to be shown again')
    const stripped: LiveDeps['ask'] = async () => ({ ok: true, result: { content: [{ type: 'text', text: 'A copy.' }] } })
    expect(await firstCopy(TARGET, stripped)).toEqual({ ok: false, reason: expect.stringContaining('without its structuredContent or _meta') })
  })

  it('asks nothing of a page served without a key', async () => {
    const host = played({ subscribe: false, tools: true })
    expect(await firstCopy({ path: TARGET.path, key: undefined }, host.deps.ask)).toEqual({ ok: false, reason: NO_PAGE_KEY })
    expect(host.asked).toEqual([])
  })
})
