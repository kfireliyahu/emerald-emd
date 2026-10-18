/**
 * **A view drawn in the conversation updates in place** (M44 U4, D-442).
 *
 * Emerald's own window redraws when its document changes on disk (D-127);
 * this is the frame's half of the same. Two ways to hear of a change, and the
 * frame finds out which its host gives it rather than assuming:
 *
 * - **push** — the frame sends `resources/subscribe` with the document's URI
 *   (M44 U2) through the host, and asks for the document again only on
 *   `notifications/resources/updated`. MCP Apps (2026-01-26) lets a host
 *   forward any request that is not `ui/` and says nothing of forwarding a
 *   notification back, so a host that takes the subscription is believed until
 *   it is caught not passing the word on: a check when the frame comes back
 *   into view that finds a change no notification announced moves it to
 *   **check**, and says so.
 * - **check** — where the host refuses the subscription, one `frame_copy` call
 *   with the stamp the copy was read under, which answers with the stamp alone
 *   when nothing moved: on coming back into view or into focus, and every
 *   `CHECK_EVERY_MS` while in view. Never while hidden, never a tight poll.
 * - **off** — a host that passes on neither (the stand-in replaying one
 *   call): the copy stays as it was when shown, and the frame says that.
 *
 * Whichever it chose is said once in the host's log (`notifications/message`).
 * Nothing here touches the DOM or a timer it was not handed, so a test plays
 * the host and the clock.
 */

import { COPY_META, COPY_TOOL, NOT_THIS_VIEW, type CopyPayload } from './contract.ts'
import { fromBase64, type Answer } from './host.ts'

type LiveMode = 'push' | 'check' | 'off'

export interface LiveState {
  readonly mode: LiveMode
  /** The file is no longer on disk: what is drawn is the copy as it last was. */
  readonly gone: boolean
}

/** A modest interval, and only while the view is in sight. */
export const CHECK_EVERY_MS = 15_000
/** How long a push may trail the change a check found before the host is judged not to send them. */
export const PUSH_GRACE_MS = 3_000
/** Checks prompted by focus or sight come no closer together than this. */
const CHECK_GAP_MS = 2_000
/** A host that has not answered a subscribe in this long has refused it. */
const SUBSCRIBE_WAIT_MS = 5_000

export interface LiveTarget {
  readonly path: string
  readonly uri: string
  readonly stamp: string
  /** What `frame_copy` asks for before it hands anything over: the page's key (M41 F3, D-447). */
  readonly key: string
}

/** How long the first fetch may take: a megabyte and more, through the host. */
const FIRST_COPY_WAIT_MS = 30_000

/** The document a drawn view fetched, or a sentence a person reads saying why there is none. */
type FirstCopy =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly stamp: string; readonly name?: string; readonly uri?: string }
  | { readonly ok: false; readonly reason: string }

type CallResult = { isError?: boolean; content?: { text?: unknown }[]; structuredContent?: unknown; _meta?: Record<string, unknown> }

/**
 * `frame_copy`'s answer: in `structuredContent` since M41 F3, which a host
 * passes on where it may drop `_meta`, and under `_meta` before that.
 */
function copyOf(result: CallResult): Partial<CopyPayload> | undefined {
  const structured = result.structuredContent as Partial<CopyPayload> | undefined
  if (typeof structured === 'object' && structured !== null && typeof structured.stamp === 'string') return structured
  return result._meta?.[COPY_META] as Partial<CopyPayload> | undefined
}

/**
 * What the frame says when the server would not hand over the document
 * because the page's key is not this server's (M41 F3): the page came from an
 * Emerald that has since restarted — or from a host that kept it from then.
 */
export const STALE_KEY =
  'The server did not know this view’s key, so it would not hand over the document: the page was served by an ' +
  'Emerald that has since restarted, or the host kept an old copy of it. Ask for it to be shown again; if this ' +
  'line comes back, reload the host’s window (in VS Code, Developer: Reload Window).'

/** What the frame says when the page it was served carries no key at all. */
export const NO_PAGE_KEY =
  'This view’s page carries no key from the server, so the server will not hand it the document. ' +
  'The answer is in the conversation as text.'

/**
 * **The document, fetched once the view is drawn** (M41 F2, D-446). No tool
 * result carries a copy: the view asks the host to call `frame_copy` with the
 * key its page carries (M41 F3, D-447), and draws what comes back. When
 * nothing does, it says which hop failed — the host, the server, a stale key,
 * or the answer's parts lost on the way — rather than only that there is
 * nothing to draw.
 */
export async function firstCopy(
  target: { readonly path: string; readonly key: string | undefined },
  ask: LiveDeps['ask'],
): Promise<FirstCopy> {
  if (target.key === undefined) return { ok: false, reason: NO_PAGE_KEY }
  const answer = await ask(
    'tools/call',
    { name: COPY_TOOL, arguments: { path: target.path, key: target.key } },
    FIRST_COPY_WAIT_MS,
  )
  const text = ' The answer is in the conversation as text.'
  if (!answer.ok) {
    return { ok: false, reason: `The host did not pass on this view’s request for the document (${answer.message}), so there is nothing to draw.${text}` }
  }
  const result = answer.result as CallResult
  if (result.isError === true) {
    const said = result.content?.[0]?.text
    if (typeof said === 'string' && said.startsWith(NOT_THIS_VIEW)) return { ok: false, reason: STALE_KEY }
    return { ok: false, reason: `The server did not hand over the document: ${typeof said === 'string' ? said : 'it failed.'}` }
  }
  const copy = copyOf(result)
  if (copy === undefined || typeof copy.bytes !== 'string') {
    return { ok: false, reason: `The host passed on the document’s answer without its structuredContent or _meta, so there is nothing to draw.${text}` }
  }
  return {
    ok: true,
    bytes: fromBase64(copy.bytes),
    stamp: typeof copy.stamp === 'string' ? copy.stamp : '',
    ...(typeof copy.name === 'string' ? { name: copy.name } : {}),
    ...(typeof copy.uri === 'string' ? { uri: copy.uri } : {}),
  }
}

export interface LiveDeps {
  readonly ask: (method: string, params: Record<string, unknown>, wait?: number) => Promise<Answer>
  readonly log: (text: string) => void
  /** Draw these bytes in place of the copy shown; settles once they are open. */
  readonly redraw: (bytes: Uint8Array) => Promise<void>
  readonly onState: (state: LiveState) => void
  readonly now?: () => number
  readonly setTimer?: (run: () => void, ms: number) => unknown
  readonly clearTimer?: (timer: unknown) => void
}

export interface Live {
  /** Settles once the mode is chosen. */
  readonly started: Promise<LiveMode>
  /** The view came into sight or left it — the host's tab, or scrolled past. */
  sight(visible: boolean): void
  /** The frame's window gained focus. */
  focus(): void
  /** `notifications/resources/updated`, as the host forwarded it. */
  updated(uri: string): void
  stop(): void
}

type Fetched = 'changed' | 'same' | 'gone' | 'refused' | 'stopped'

export function startLive(target: LiveTarget, deps: LiveDeps): Live {
  const now = deps.now ?? (() => Date.now())
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms))
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))

  let stamp = target.stamp
  let mode: LiveMode | undefined
  let gone = false
  let visible = true
  let stopped = false
  let lastCheck = Number.NEGATIVE_INFINITY
  let lastPush = Number.NEGATIVE_INFINITY
  let interval: unknown
  /** One call at a time; a change heard during one asks once more after it. */
  let inFlight: Promise<Fetched> | undefined
  let again = false

  const state = (): void => {
    if (mode !== undefined) deps.onState({ mode, gone })
  }

  async function fetchOnce(): Promise<Fetched> {
    const answer = await deps.ask('tools/call', {
      name: COPY_TOOL,
      arguments: { path: target.path, key: target.key, since: stamp },
    })
    if (stopped) return 'stopped'
    if (!answer.ok) return 'refused'
    const result = answer.result as CallResult
    if (result.isError === true) {
      const said = result.content?.[0]?.text
      if (typeof said === 'string' && said.startsWith('No document at')) {
        if (!gone) {
          gone = true
          deps.log(`${target.path} is gone from disk; the view stays as it last was.`)
          state()
        }
        return 'gone'
      }
      return 'refused'
    }
    const copy = copyOf(result)
    if (copy === undefined || typeof copy.stamp !== 'string') return 'refused'
    const wasGone = gone
    gone = false
    if (wasGone) state()
    if (typeof copy.bytes !== 'string') {
      stamp = copy.stamp
      return 'same'
    }
    await deps.redraw(fromBase64(copy.bytes))
    stamp = copy.stamp
    return 'changed'
  }

  function fetchCopy(): Promise<Fetched> {
    if (inFlight !== undefined) {
      again = true
      return inFlight
    }
    const run = async (): Promise<Fetched> => {
      let outcome = await fetchOnce()
      while (again && !stopped) {
        again = false
        const next = await fetchOnce()
        if (next === 'changed' || outcome !== 'changed') outcome = next
      }
      return outcome
    }
    inFlight = run().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  async function check(): Promise<void> {
    if (stopped || !visible || mode === 'off' || mode === undefined) return
    if (now() - lastCheck < CHECK_GAP_MS) return
    const at = now()
    lastCheck = at
    const outcome = await fetchCopy()
    if (mode === 'push' && outcome === 'changed') {
      // A change no notification brought — or one whose notification is still
      // on its way. Wait for it before judging the host.
      setTimer(() => {
        if (stopped || mode !== 'push' || lastPush >= at - PUSH_GRACE_MS) return
        mode = 'check'
        deps.log(
          'The host took the subscription but passed on no notifications/resources/updated for a change; ' +
            `checking the file's stamp with ${COPY_TOOL} instead, on focus and every ${String(CHECK_EVERY_MS / 1000)} s while in view.`,
        )
        state()
        arm()
      }, PUSH_GRACE_MS)
    }
  }

  /** The interval runs in check mode while the view is in sight, and at no other time. */
  function arm(): void {
    if (interval !== undefined) clearTimer(interval)
    interval = undefined
    if (stopped || mode !== 'check' || !visible) return
    const tick = (): void => {
      interval = setTimer(() => {
        void check().finally(() => {
          if (interval !== undefined) tick()
        })
      }, CHECK_EVERY_MS)
    }
    tick()
  }

  const started = (async (): Promise<LiveMode> => {
    const subscribed = await deps.ask('resources/subscribe', { uri: target.uri }, SUBSCRIBE_WAIT_MS)
    if (stopped) return 'off'
    if (subscribed.ok) {
      mode = 'push'
      deps.log(`Live by push: the host took resources/subscribe for ${target.uri}; the view is drawn again on notifications/resources/updated.`)
      state()
      return mode
    }
    // Refused: is a check possible at all?
    const probe = await fetchCopy()
    if (stopped) return 'off'
    if (probe === 'refused') {
      mode = 'off'
      deps.log(
        `Not live: the host refused resources/subscribe (${subscribed.message}) and the call to ${COPY_TOOL}; ` +
          'the view is a copy as the file was when shown.',
      )
    } else {
      mode = 'check'
      deps.log(
        `Live by check: the host refused resources/subscribe (${subscribed.message}); checking the file's stamp ` +
          `with ${COPY_TOOL} on focus and every ${String(CHECK_EVERY_MS / 1000)} s while in view, never while hidden.`,
      )
      lastCheck = now()
      arm()
    }
    state()
    return mode
  })()

  return {
    started,
    sight(next) {
      const was = visible
      visible = next
      if (mode === 'check') arm()
      if (next && !was) void check()
    },
    focus() {
      void check()
    },
    updated(uri) {
      if (stopped || uri !== target.uri) return
      lastPush = now()
      void fetchCopy()
    },
    stop() {
      if (stopped) return
      stopped = true
      if (interval !== undefined) clearTimer(interval)
      interval = undefined
      if (mode === 'push') void deps.ask('resources/unsubscribe', { uri: target.uri })
    },
  }
}
