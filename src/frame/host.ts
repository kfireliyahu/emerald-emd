/**
 * **The frame's half of the MCP Apps protocol, written by hand** (M41 U1).
 *
 * The official `@modelcontextprotocol/ext-apps` package would do this, and it
 * is a dependency for five messages: the frame asks `ui/initialize`, says
 * `ui/notifications/initialized`, hears `ui/notifications/tool-result` (and
 * `tool-input`, a change of the host's theme and styles, and `tool-cancelled`), answers `ui/resource-teardown` and `ping`, and says
 * how tall it is. JSON-RPC 2.0 over `postMessage` to the parent window.
 *
 * **Two messages go the other way, toward the conversation** (M51 U7): a line
 * the person sends (`ui/message`) and what the model is told the view has in
 * front of it (`ui/update-model-context`) — each only where the host's
 * `ui/initialize` answer offers it (`Offers`), so a host that offers neither
 * gets the frame as it was.
 *
 * **And one about where the view sits** (M42 T1, a trial): the frame says it
 * can be drawn inline, full screen or floating (`pip`), reads which of those the
 * host offers from its context, and asks with `ui/request-display-mode`. The
 * host decides, and says the mode it set.
 *
 * The port is an interface so a test plays the host without a browser.
 */

import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import type { ColumnChoice } from '@/ui/formats/addressFilter.ts'

import { FRAME_VIEWS, KEY_META, SHEET_META, type FrameView, type SheetPayload } from './contract.ts'
import { contextOf, mergeContext, type HostContext } from './hostStyle.ts'

/** The protocol version this frame speaks — the spec's stable one. */
export const PROTOCOL_VERSION = '2026-01-26'

/** Where messages go and come from: the parent window, in the page. */
export interface Port {
  post(message: unknown): void
  listen(handler: (message: unknown) => void): () => void
}

interface HostHandlers {
  /** A tool's result, as the host hands it over: a `CallToolResult`. */
  readonly onResult: (result: unknown) => void
  /** The tool's arguments, which may arrive before the result does. */
  readonly onInput?: (args: Record<string, unknown>) => void
  /**
   * The host's context as it stands (M41 F1): its theme, style variables and
   * fonts — at the start, and whenever `host-context-changed` changes them,
   * merged onto what came before (the spec sends only what changed).
   */
  readonly onContext?: (context: HostContext) => void
  /**
   * The call was cancelled before it answered (M41 U2): no result is coming,
   * and a frame still saying "Opening…" would wait for ever.
   */
  readonly onCancelled?: (reason: string | undefined) => void
  /**
   * The server said a resource this frame subscribed to changed (M44 U4):
   * `notifications/resources/updated`, forwarded by a host that forwards it.
   * The spec (2026-01-26) neither requires nor forbids that.
   */
  readonly onUpdated?: (uri: string) => void
  /** The host is taking the frame down: stop whatever the frame keeps running. */
  readonly onTeardown?: () => void
  /** Where the view sits, and where else the host offers (M42 T1): at the start and on every change. */
  readonly onDisplay?: (display: Display) => void
}

/** The spec's three display modes (2026-01-26). */
export type DisplayMode = 'inline' | 'fullscreen' | 'pip'

const DISPLAY_MODES: readonly DisplayMode[] = ['inline', 'fullscreen', 'pip']

/**
 * **Where the view sits, and where else it could** (M42 T1): `current` is the
 * host's `displayMode`, `available` its `availableDisplayModes` — both from its
 * context, which may send only what changed. A host that names none offers
 * inline only, which is where every view starts.
 */
export interface Display {
  readonly current: DisplayMode
  readonly available: readonly DisplayMode[]
  /** Whether the host named its modes at all — the trial's question. */
  readonly named: boolean
}

export const INLINE_ONLY: Display = { current: 'inline', available: ['inline'], named: false }

const isMode = (value: unknown): value is DisplayMode => DISPLAY_MODES.includes(value as DisplayMode)

/** A context's display fields merged onto what the frame had; anything malformed is left out. */
export function displayOf(before: Display, raw: unknown): Display {
  if (typeof raw !== 'object' || raw === null) return before
  const box = raw as { displayMode?: unknown; availableDisplayModes?: unknown }
  const listed = Array.isArray(box.availableDisplayModes) ? box.availableDisplayModes.filter(isMode) : undefined
  return {
    current: isMode(box.displayMode) ? box.displayMode : before.current,
    available: listed === undefined ? before.available : listed,
    named: listed !== undefined || before.named,
  }
}

/**
 * **What the host said it takes from a view** (M51 U7): its
 * `hostCapabilities.message` and `.updateModelContext`, from the answer to
 * `ui/initialize`. The spec makes both optional, so absent is no.
 */
export interface Offers {
  /** `ui/message`: a line the person sends into the conversation. */
  readonly message: boolean
  /** `ui/update-model-context`: what the model is told the view has in front of it. */
  readonly modelContext: boolean
  /** The host's `hostInfo`, as a line for the log. */
  readonly host: string
}

const NO_OFFERS: Offers = { message: false, modelContext: false, host: 'an unnamed host' }

/** Read from the answer to `ui/initialize`; a capability is offered when it is an object, as the spec's are. */
export function offersOf(result: Record<string, unknown> | undefined): Offers {
  const capabilities = result?.['hostCapabilities']
  const has = (key: string): boolean =>
    typeof capabilities === 'object' && capabilities !== null && typeof (capabilities as Record<string, unknown>)[key] === 'object' && (capabilities as Record<string, unknown>)[key] !== null
  const info = result?.['hostInfo'] as { name?: unknown; version?: unknown } | undefined
  const host = typeof info?.name === 'string' ? `${info.name}${typeof info.version === 'string' ? ` ${info.version}` : ''}` : NO_OFFERS.host
  return { message: has('message'), modelContext: has('updateModelContext'), host }
}

/** The line the frame says in the host's log about what it offers, once: how a host this machine cannot open is measured. */
export function offersLine(offers: Offers, display: Display = INLINE_ONLY): string {
  const yes = (has: boolean): string => (has ? 'yes' : 'no')
  const modes = display.named ? display.available.join(', ') : 'none named'
  return `Host offers (${offers.host}): ui/message ${yes(offers.message)}, ui/update-model-context ${yes(offers.modelContext)}; display modes ${modes}.`
}

/** An answer the host gave to something the frame asked. */
export type Answer = { readonly ok: true; readonly result: Record<string, unknown> } | { readonly ok: false; readonly message: string }

interface HostLink {
  /** Settles once the host answered `ui/initialize`, or failed to. */
  readonly ready: Promise<void>
  /** Tell the host how much room the page wants. */
  sizeChanged(width: number, height: number): void
  /**
   * Ask the host something it passes to the server (M44 U4) — `tools/call`,
   * `resources/subscribe` — and settle with its answer or its refusal, never
   * a throw. A host that has not answered in `wait` ms has refused.
   */
  ask(method: string, params: Record<string, unknown>, wait?: number): Promise<Answer>
  /** Say a line in the host's log (`notifications/message`), for whoever reads it. */
  log(text: string): void
  /** What the host offers a view (M51 U7) — none until `ready` settles. */
  offers(): Offers
  /** Where the view sits and where else the host offers (M42 T1). */
  display(): Display
  /**
   * Ask the host to draw the view another way (`ui/request-display-mode`, M42
   * T1). The host answers with the mode it set, which may be the one it had.
   */
  requestDisplay(mode: DisplayMode): Promise<Answer>
  /**
   * Send a line into the conversation as the person (`ui/message`, M51 U7).
   * The spec's answer may be `{ isError: true }`, which is a refusal too.
   */
  say(text: string): Promise<Answer>
  /**
   * Tell the model what the view has in front of it (`ui/update-model-context`,
   * M51 U7). Each call replaces the last; empty content clears it.
   */
  tellModel(context: ModelContext): Promise<Answer>
  close(): void
}

/** What `ui/update-model-context` carries: text the model reads, and the same as data. */
export interface ModelContext {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly structuredContent?: Record<string, unknown>
}

/** How long a request to the host may go unanswered before it counts as refused. */
const ASK_WAIT_MS = 10_000

interface Message {
  readonly jsonrpc?: string
  readonly id?: number | string
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { readonly message?: string }
}

export function connect(port: Port, handlers: HostHandlers, app: { name: string; version: string }): HostLink {
  let next = 1
  const waiting = new Map<number | string, (message: Message) => void>()

  const request = (method: string, params: Record<string, unknown>): Promise<Message> =>
    new Promise((resolve) => {
      const id = next++
      waiting.set(id, resolve)
      port.post({ jsonrpc: '2.0', id, method, params })
    })
  const notify = (method: string, params: Record<string, unknown> = {}): void =>
    port.post({ jsonrpc: '2.0', method, params })

  let context: HostContext = {}
  let offered: Offers = NO_OFFERS
  let display: Display = INLINE_ONLY
  const displayChanged = (raw: unknown): void => {
    const next = displayOf(display, raw)
    if (next.current === display.current && next.named === display.named && next.available.join() === display.available.join()) return
    display = next
    handlers.onDisplay?.(display)
  }
  const contextChanged = (raw: unknown): void => {
    context = mergeContext(context, contextOf(raw))
    handlers.onContext?.(context)
    displayChanged(raw)
  }

  const stop = port.listen((raw) => {
    if (typeof raw !== 'object' || raw === null) return
    const message = raw as Message
    if (message.jsonrpc !== '2.0') return
    // An answer to something this frame asked.
    if (message.method === undefined && message.id !== undefined) {
      const settle = waiting.get(message.id)
      waiting.delete(message.id)
      settle?.(message)
      return
    }
    switch (message.method) {
      case 'ui/notifications/tool-result':
        handlers.onResult(message.params)
        return
      case 'ui/notifications/tool-input': {
        const args = message.params?.['arguments']
        if (typeof args === 'object' && args !== null) handlers.onInput?.(args as Record<string, unknown>)
        return
      }
      case 'ui/notifications/tool-cancelled': {
        const reason = message.params?.['reason']
        handlers.onCancelled?.(typeof reason === 'string' && reason.trim() !== '' ? reason : undefined)
        return
      }
      case 'ui/notifications/host-context-changed':
        contextChanged(message.params)
        return
      case 'notifications/resources/updated': {
        const uri = message.params?.['uri']
        if (typeof uri === 'string') handlers.onUpdated?.(uri)
        return
      }
      case 'ping':
        // MCP's own liveness check, which a host may send either way: an empty
        // answer, never "not handled" (found by `npm run frame:try`).
        if (message.id !== undefined) port.post({ jsonrpc: '2.0', id: message.id, result: {} })
        return
      case 'ui/resource-teardown':
        // Nothing is held that outlives the frame but its subscription and its
        // check (M44 U4), which stop here; the document is a copy in memory.
        handlers.onTeardown?.()
        if (message.id !== undefined) port.post({ jsonrpc: '2.0', id: message.id, result: {} })
        return
      default:
        // A request this frame has no answer for is told so, never left hanging.
        if (message.id !== undefined && message.method !== undefined) {
          port.post({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Not handled: ${message.method}` } })
        }
    }
  })

  const ready = request('ui/initialize', {
    protocolVersion: PROTOCOL_VERSION,
    appInfo: app,
    // A view may say where it can be drawn, and a host draws it nowhere else (M42 T1).
    appCapabilities: { availableDisplayModes: [...DISPLAY_MODES] },
  }).then((answer) => {
    offered = offersOf(answer.result)
    contextChanged(answer.result?.['hostContext'])
    notify('ui/notifications/initialized')
  })

  const ask = (method: string, params: Record<string, unknown>, wait = ASK_WAIT_MS): Promise<Answer> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, message: `The host did not answer ${method} in ${String(wait / 1000)} s.` }), wait)
      void request(method, params).then((answer) => {
        clearTimeout(timer)
        resolve(
          answer.error !== undefined
            ? { ok: false, message: answer.error.message ?? `The host refused ${method}.` }
            : { ok: true, result: answer.result ?? {} },
        )
      })
    })

  return {
    ready,
    sizeChanged: (width, height) => notify('ui/notifications/size-changed', { width, height }),
    ask,
    // Also to the page's own console: a host that drops the notification still
    // shows it in its developer tools (VS Code: Developer: Open Webview
    // Developer Tools).
    log: (text) => {
      console.info(`[emerald-frame] ${text}`)
      notify('notifications/message', { level: 'info', logger: 'emerald-frame', data: text })
    },
    offers: () => offered,
    say: async (text) => {
      const answer = await ask('ui/message', { role: 'user', content: [{ type: 'text', text }] })
      return answer.ok && answer.result['isError'] === true ? { ok: false, message: 'The host did not take the message.' } : answer
    },
    tellModel: (said) => ask('ui/update-model-context', { ...said }),
    display: () => display,
    requestDisplay: async (mode) => {
      const answer = await ask('ui/request-display-mode', { mode })
      if (answer.ok) displayChanged({ displayMode: answer.result['mode'] })
      return answer
    },
    close: stop,
  }
}

/**
 * Which document to draw and which view — or the sentence saying why there is
 * none. **The result carries no copy** (M41 F2, D-446): the frame fetches it
 * with `frame_copy` (`live.ts`'s `firstCopy`).
 *
 * **Taken from the call's input first** (M41 F3, D-447). VS Code hands a view
 * the result without its `_meta`, which is where M41 F2 named the document, and
 * the frame said it did not know what to draw. The input is the tool's own
 * arguments — `show_format`'s path, format and view, `start_here`'s path —
 * and the spec has a host hand it over before the result. The result's `_meta`,
 * then its `structuredContent`, answer only where no input came.
 */
type Sheet =
  | {
      readonly ok: true
      readonly format: string
      readonly view: FrameView
      /** What `frame_copy` names, and the file the frame subscribes to once it has its URI. */
      readonly path: string
      /** The rows asked for (M44 U6), which the frame opens the format's address on. */
      readonly filter: RowFilter
      /** Which columns each format's lines draw (M37 U5), in the same address. */
      readonly columns: ColumnChoice
      /**
       * A saved view's name, when `show_format`'s `view` named one (M53 U5,
       * D-520): the frame reads it from the document once it has it, and opens
       * on its kind and its address.
       */
      readonly saved?: string
      /** Where it was read from, for the host's log. */
      readonly from: 'input' | '_meta' | 'structuredContent'
    }
  | { readonly ok: false; readonly reason: string }

interface ResultBox {
  readonly _meta?: Record<string, unknown>
  readonly structuredContent?: Record<string, unknown>
  readonly isError?: boolean
  readonly content?: unknown
}

export function sheetOf(input: Record<string, unknown> | undefined, result: unknown): Sheet {
  const box = result as ResultBox | undefined
  if (box?.isError === true) {
    const said = Array.isArray(box.content) ? (box.content[0] as { text?: unknown } | undefined)?.text : undefined
    return { ok: false, reason: typeof said === 'string' ? said : 'The tool failed.' }
  }
  const path = input?.['path']
  if (typeof path === 'string' && path !== '') {
    // `show_format` names a format; `start_here` names none, and its view is
    // the picture of where to start.
    const format = typeof input?.['format'] === 'string' ? input['format'] : ''
    const asked = input?.['view']
    const saved =
      format !== '' && typeof asked === 'string' && asked !== 'table' && !FRAME_VIEWS.includes(asked as FrameView) ? asked : undefined
    return {
      ok: true,
      format,
      view: format === '' ? 'start' : viewOf(asked, 'sheet'),
      path,
      filter: filterOf(input?.['match'], input?.['search']),
      columns: columnsOf(input?.['columns']),
      ...(saved === undefined ? {} : { saved }),
      from: 'input',
    }
  }
  for (const [from, holder] of [
    ['_meta', box?._meta],
    ['structuredContent', box?.structuredContent],
  ] as const) {
    const payload = holder?.[SHEET_META] as Partial<SheetPayload> | undefined
    if (payload !== undefined && typeof payload.format === 'string' && typeof payload.path === 'string' && payload.path !== '') {
      return {
        ok: true,
        format: payload.format,
        view: viewOf(payload.view, payload.format === '' ? 'start' : 'sheet'),
        path: payload.path,
        filter: filterOf(payload.match, payload.search),
        columns: columnsOf(payload.columns),
        from,
      }
    }
  }
  return {
    ok: false,
    // No input and no result naming a document: either the server named none —
    // no such format, a document it refused — or the host passed on neither.
    reason:
      `The host handed this view neither the call’s input nor an answer naming a document (${handedOver(input, result)}), ` +
      'so it does not know which document to draw. The answer is in the conversation as text.',
  }
}

/**
 * `show_format`'s `match` and `search` as the frame keeps them (M44 U6) —
 * anything else is no filter, since the server has already refused a filter it
 * cannot read and drawn nothing over the refusal.
 */
function filterOf(match: unknown, search: unknown): RowFilter {
  return {
    ...(typeof match === 'object' && match !== null && !Array.isArray(match) ? { match: match as Record<string, unknown> } : {}),
    ...(typeof search === 'string' && search.trim() !== '' ? { search } : {}),
  }
}

/** `show_format`'s `columns` as the frame keeps them (M37 U5): lists of names, and anything else left out. */
function columnsOf(asked: unknown): ColumnChoice {
  if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) return {}
  return Object.fromEntries(
    Object.entries(asked as Record<string, unknown>)
      .filter(([, value]) => Array.isArray(value))
      .map(([name, value]) => [name, (value as unknown[]).filter((each): each is string => typeof each === 'string')]),
  )
}

/** A view this frame does not know — a newer server — is the fallback, which every format has. */
function viewOf(asked: unknown, fallback: FrameView): FrameView {
  return FRAME_VIEWS.includes(asked as FrameView) ? (asked as FrameView) : fallback
}

/**
 * **What the host handed this view, in a line** (M41 F3): whether the input
 * came, and which of the result's parts. Said in the host's log once the
 * result is in, and in the frame's own line when it cannot draw — which is how
 * a host this machine cannot run is measured.
 */
export function handedOver(input: Record<string, unknown> | undefined, result: unknown): string {
  const box = result as ResultBox | undefined
  const yes = (has: boolean): string => (has ? 'yes' : 'no')
  return (
    `tool-input ${yes(input !== undefined)}; the result’s content ${yes(Array.isArray(box?.content) && box.content.length > 0)}, ` +
    `structuredContent ${yes(box?.structuredContent !== undefined)}, _meta ${yes(box?._meta !== undefined)}`
  )
}

/**
 * **The key the server wrote into this page** (M41 F3, D-447): what
 * `frame_copy` asks for before it hands over a document, and which no model is
 * shown. Undefined in a page served without one.
 */
export function pageKey(page: ParentNode): string | undefined {
  const content = page.querySelector(`meta[name="${KEY_META}"]`)?.getAttribute('content')
  return content === null || content === undefined || content === '' ? undefined : content
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The page's own port: the parent window, which is the host. */
export function parentPort(view: Window): Port {
  return {
    post: (message) => view.parent.postMessage(message, '*'),
    listen: (handler) => {
      const listener = (event: MessageEvent): void => {
        if (event.source === view.parent) handler(event.data)
      }
      view.addEventListener('message', listener)
      return () => view.removeEventListener('message', listener)
    },
  }
}
