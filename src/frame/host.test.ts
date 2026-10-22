import { describe, expect, it } from 'vitest'

import { KEY_META, SHEET_META } from './contract.ts'
import { INLINE_ONLY, PROTOCOL_VERSION, connect, displayOf, handedOver, offersLine, offersOf, pageKey, sheetOf, type Display, type Port } from './host.ts'

/** The host's side of the frame's port: what the frame sent, and a way to answer. */
function playedHost(): { port: Port; sent: unknown[]; say: (message: unknown) => void } {
  const sent: unknown[] = []
  let heard: (message: unknown) => void = () => undefined
  return {
    sent,
    port: {
      post: (message) => sent.push(message),
      listen: (handler) => {
        heard = handler
        return () => undefined
      },
    },
    say: (message) => heard(message),
  }
}

describe('the frame speaks MCP Apps to its host (M41 U1)', () => {
  it('asks ui/initialize, takes the host theme, then says it is initialized', async () => {
    const host = playedHost()
    const themes: string[] = []
    const link = connect(
      host.port,
      { onResult: () => undefined, onContext: (context) => themes.push(context.theme ?? 'none') },
      { name: 'emerald-sheet', version: '1' },
    )

    expect(host.sent).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'ui/initialize',
        params: { protocolVersion: PROTOCOL_VERSION, appInfo: { name: 'emerald-sheet', version: '1' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen', 'pip'] } },
      },
    ])
    host.say({ jsonrpc: '2.0', id: 1, result: { protocolVersion: PROTOCOL_VERSION, hostContext: { theme: 'dark' } } })
    await link.ready
    expect(themes).toEqual(['dark'])
    expect(host.sent[1]).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })

    link.sizeChanged(640, 480)
    expect(host.sent[2]).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 640, height: 480 } })
  })

  it('hands on the tool result and input, answers teardown and ping, and refuses what it does not handle', () => {
    const host = playedHost()
    const results: unknown[] = []
    const inputs: unknown[] = []
    connect(host.port, { onResult: (result) => results.push(result), onInput: (args) => inputs.push(args) }, { name: 'x', version: '1' })

    host.say({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { format: 'milestone' } } })
    host.say({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [] } })
    host.say({ jsonrpc: '2.0', id: 7, method: 'ui/resource-teardown', params: {} })
    host.say({ jsonrpc: '2.0', id: 8, method: 'ui/something-new', params: {} })
    host.say({ jsonrpc: '2.0', id: 9, method: 'ping' })
    host.say('not json-rpc')

    expect(inputs).toEqual([{ format: 'milestone' }])
    expect(results).toEqual([{ content: [] }])
    expect(host.sent).toContainEqual({ jsonrpc: '2.0', id: 7, result: {} })
    expect(host.sent).toContainEqual(expect.objectContaining({ id: 8, error: expect.objectContaining({ code: -32601 }) }))
    expect(host.sent).toContainEqual({ jsonrpc: '2.0', id: 9, result: {} })
  })

  it('hears a cancelled call, so the frame stops saying it is opening (M41 U2)', () => {
    const host = playedHost()
    const cancelled: (string | undefined)[] = []
    connect(host.port, { onResult: () => undefined, onCancelled: (reason) => cancelled.push(reason) }, { name: 'x', version: '1' })
    host.say({ jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled', params: { reason: 'the person stopped it' } })
    host.say({ jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled', params: {} })
    expect(cancelled).toEqual(['the person stopped it', undefined])
    // A notification is never answered.
    expect(host.sent.filter((each) => (each as { error?: unknown }).error !== undefined)).toEqual([])
  })
})

/**
 * **M51 U7**: the two messages a view sends toward the conversation, each only
 * where the host's `ui/initialize` answer offers it.
 */
describe('the frame hands things to the conversation (M51 U7)', () => {
  it('reads what the host offers from its hostCapabilities, absent being no', () => {
    expect(offersOf({ hostCapabilities: { message: { text: {} }, updateModelContext: { text: {} } }, hostInfo: { name: 'h', version: '2' } })).toEqual({
      message: true,
      modelContext: true,
      host: 'h 2',
    })
    expect(offersOf({ hostCapabilities: { openLinks: {} } })).toEqual({ message: false, modelContext: false, host: 'an unnamed host' })
    expect(offersOf(undefined)).toMatchObject({ message: false, modelContext: false })
    expect(offersLine(offersOf({ hostCapabilities: { message: {} }, hostInfo: { name: 'h' } }))).toBe(
      'Host offers (h): ui/message yes, ui/update-model-context no; display modes none named.',
    )
    expect(offersLine(offersOf(undefined), { current: 'inline', available: ['inline', 'pip'], named: true })).toContain('display modes inline, pip.')
  })

  it('offers nothing before the host answers, then says ui/message and ui/update-model-context as the spec shapes them', async () => {
    const host = playedHost()
    const link = connect(host.port, { onResult: () => undefined }, { name: 'x', version: '1' })
    expect(link.offers()).toMatchObject({ message: false, modelContext: false })
    host.say({ jsonrpc: '2.0', id: 1, result: { protocolVersion: PROTOCOL_VERSION, hostCapabilities: { message: {}, updateModelContext: {} } } })
    await link.ready
    expect(link.offers()).toMatchObject({ message: true, modelContext: true })

    const sent = link.say('Start unit M1 U1.')
    expect(host.sent.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'ui/message',
      params: { role: 'user', content: [{ type: 'text', text: 'Start unit M1 U1.' }] },
    })
    host.say({ jsonrpc: '2.0', id: 2, result: {} })
    expect(await sent).toEqual({ ok: true, result: {} })

    // The spec's refusal of a message is a result, not an error.
    const refused = link.say('again')
    host.say({ jsonrpc: '2.0', id: 3, result: { isError: true } })
    expect(await refused).toMatchObject({ ok: false })

    const told = link.tellModel({ content: [{ type: 'text', text: 'these' }], structuredContent: { rows: [] } })
    expect(host.sent.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 4,
      method: 'ui/update-model-context',
      params: { content: [{ type: 'text', text: 'these' }], structuredContent: { rows: [] } },
    })
    host.say({ jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Method not found' } })
    expect(await told).toEqual({ ok: false, message: 'Method not found' })
  })
})

const NAMED = { path: 'F:/a.emd', uri: 'file:///F:/a.emd' }

/**
 * **M41 F3**: VS Code hands a view the result without its `_meta`, so what to
 * draw comes from the call's input, and the result's `_meta` or
 * `structuredContent` only where no input came.
 */
describe('where the view sits (M42 T1, a trial)', () => {
  it('reads the host’s display modes from its context, merging what changed, and leaves out what is malformed', () => {
    expect(displayOf(INLINE_ONLY, {})).toEqual(INLINE_ONLY)
    const offered = displayOf(INLINE_ONLY, { displayMode: 'inline', availableDisplayModes: ['inline', 'pip', 'sidebar'] })
    expect(offered).toEqual({ current: 'inline', available: ['inline', 'pip'], named: true })
    expect(displayOf(offered, { displayMode: 'pip' })).toEqual({ current: 'pip', available: ['inline', 'pip'], named: true })
    expect(displayOf(offered, { displayMode: 'floating' })).toEqual(offered)
  })

  it('asks ui/request-display-mode and takes the mode the host says it set, which may be the one it had', async () => {
    const host = playedHost()
    const seen: Display[] = []
    const link = connect(host.port, { onResult: () => undefined, onDisplay: (display) => seen.push(display) }, { name: 'x', version: '1' })
    host.say({ jsonrpc: '2.0', id: 1, result: { hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'pip'] } } })
    await link.ready
    expect(link.display()).toEqual({ current: 'inline', available: ['inline', 'pip'], named: true })

    const floated = link.requestDisplay('pip')
    expect(host.sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, method: 'ui/request-display-mode', params: { mode: 'pip' } })
    host.say({ jsonrpc: '2.0', id: 2, result: { mode: 'pip' } })
    expect((await floated).ok).toBe(true)
    expect(link.display().current).toBe('pip')

    // A mode it does not offer: the host keeps the one it had, and nothing changes.
    const refused = link.requestDisplay('fullscreen')
    host.say({ jsonrpc: '2.0', id: 3, result: { mode: 'pip' } })
    await refused
    expect(seen.map((display) => display.current)).toEqual(['inline', 'pip'])

    // The host may change it on its own, and says so in its context.
    host.say({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'inline' } })
    expect(link.display().current).toBe('inline')
  })
})

describe('what the frame draws', () => {
  const text = { content: [{ type: 'text', text: 'book as its sheet — 2 rows.' }] }

  it('is the call’s input, with the result stripped of its _meta, as VS Code hands it (M41 F3)', () => {
    expect(sheetOf({ path: 'F:/a.emd', format: 'book' }, text)).toEqual({ ok: true, format: 'book', view: 'sheet', path: 'F:/a.emd', filter: {}, columns: {}, from: 'input' })
    // The rows asked for come with the input too (M44 U6), and the columns chosen (M37 U5).
    expect(sheetOf({ path: 'F:/a.emd', format: 'book', match: { shelf: 'read' }, search: 'du' }, text)).toMatchObject({
      filter: { match: { shelf: 'read' }, search: 'du' },
    })
    expect(sheetOf({ path: 'F:/a.emd', format: 'milestone', view: 'roadmap', columns: { unit: ['title', 'state'], bad: 'x' } }, text)).toMatchObject({
      view: 'roadmap',
      columns: { unit: ['title', 'state'] },
    })
    // `start_here` names no format, and its view is the picture.
    expect(sheetOf({ path: 'F:/a.emd' }, text)).toMatchObject({ ok: true, format: '', view: 'start' })
    // A saved view's name (M53 U5): kept for the frame to read from the document; the table's word is not one.
    expect(sheetOf({ path: 'F:/a.emd', format: 'task', view: 'Due today' }, text)).toMatchObject({ view: 'sheet', saved: 'Due today' })
    expect(sheetOf({ path: 'F:/a.emd', format: 'task', view: 'table' }, text)).not.toHaveProperty('saved')
    // A dashboard (M53 U7): a format's, and with no format the document's — never a saved view's name.
    expect(sheetOf({ path: 'F:/a.emd', format: 'task', view: 'dashboard' }, text)).toMatchObject({ format: 'task', view: 'dashboard' })
    expect(sheetOf({ path: 'F:/a.emd', format: 'task', view: 'dashboard' }, text)).not.toHaveProperty('saved')
    expect(sheetOf({ path: 'F:/a.emd', view: 'dashboard' }, text)).toMatchObject({ format: '', view: 'dashboard' })
    // A view this frame does not know — a newer server — is the sheet.
    expect(sheetOf({ path: 'F:/a.emd', format: 'book', view: 'gantt' }, text)).toMatchObject({ view: 'sheet' })
  })

  it('is the result’s _meta, then its structuredContent, where no input came (M41 F2)', () => {
    const named = { name: 'books.emd', format: 'book', ...NAMED }
    expect(sheetOf(undefined, { ...text, _meta: { [SHEET_META]: named } })).toEqual({
      ok: true,
      format: 'book',
      view: 'sheet',
      path: 'F:/a.emd',
      filter: {},
      columns: {},
      from: '_meta',
    })
    expect(sheetOf(undefined, { ...text, _meta: { [SHEET_META]: { ...named, match: { shelf: 'read' } } } })).toMatchObject({
      filter: { match: { shelf: 'read' } },
    })
    expect(sheetOf(undefined, { ...text, structuredContent: { [SHEET_META]: { ...named, view: 'board' } } })).toMatchObject({
      view: 'board',
      from: 'structuredContent',
    })
    expect(sheetOf(undefined, { _meta: { [SHEET_META]: { ...named, format: '', view: 'start' } } })).toMatchObject({ view: 'start' })
  })

  it('says why there is nothing to draw, and what the host handed over, rather than drawing nothing', () => {
    expect(sheetOf(undefined, text)).toEqual({
      ok: false,
      reason: expect.stringContaining('tool-input no; the result’s content yes, structuredContent no, _meta no'),
    })
    expect(sheetOf(undefined, { content: [], _meta: {} })).toMatchObject({ ok: false, reason: expect.stringContaining('_meta yes') })
    // A failed call is said in its own words, input or not.
    expect(sheetOf({ path: 'F:/a.emd', format: 'book' }, { isError: true, content: [{ type: 'text', text: '`path` is required.' }] })).toEqual({
      ok: false,
      reason: '`path` is required.',
    })
    expect(handedOver({ path: 'x' }, { content: [{ type: 'text', text: '' }], structuredContent: {}, _meta: {} })).toBe(
      'tool-input yes; the result’s content yes, structuredContent yes, _meta yes',
    )
  })

  it('reads the key the server wrote into its page, and none from a page without one (M41 F3)', () => {
    // The page's own `querySelector`, played: one meta, or none.
    const page = (content: string | undefined) =>
      ({
        querySelector: (selector: string) =>
          selector === `meta[name="${KEY_META}"]` && content !== undefined ? { getAttribute: () => content } : null,
      }) as unknown as ParentNode
    expect(pageKey(page('k3y'))).toBe('k3y')
    expect(pageKey(page(undefined))).toBeUndefined()
    expect(pageKey(page(''))).toBeUndefined()
  })
})

describe('the frame asks the host for the server, and hears it back (M44 U4)', () => {
  it('asks, and settles with the answer or the refusal — never a throw', async () => {
    const host = playedHost()
    const link = connect(host.port, { onResult: () => undefined }, { name: 'x', version: '1' })
    const subscribed = link.ask('resources/subscribe', { uri: 'file:///F:/a.emd' })
    expect(host.sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri: 'file:///F:/a.emd' } })
    host.say({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } })
    expect(await subscribed).toEqual({ ok: false, message: 'Method not found' })

    const called = link.ask('tools/call', { name: 'frame_copy', arguments: {} })
    host.say({ jsonrpc: '2.0', id: 3, result: { content: [] } })
    expect(await called).toEqual({ ok: true, result: { content: [] } })

    // A host that never answers has refused.
    expect(await link.ask('resources/subscribe', {}, 5)).toMatchObject({ ok: false })
  })

  it('hears notifications/resources/updated and the teardown, and says a line in the host’s log', () => {
    const host = playedHost()
    const updated: string[] = []
    let torn = 0
    const link = connect(
      host.port,
      { onResult: () => undefined, onUpdated: (uri) => updated.push(uri), onTeardown: () => (torn += 1) },
      { name: 'x', version: '1' },
    )
    host.say({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: 'file:///F:/a.emd' } })
    host.say({ jsonrpc: '2.0', id: 4, method: 'ui/resource-teardown', params: {} })
    expect(updated).toEqual(['file:///F:/a.emd'])
    expect(torn).toBe(1)
    link.log('Live by push.')
    expect(host.sent.at(-1)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'info', logger: 'emerald-frame', data: 'Live by push.' },
    })
  })
})
