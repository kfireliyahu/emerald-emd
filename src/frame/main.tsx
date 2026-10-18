import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, matchPath, useLocation, useNavigate } from 'react-router-dom'
import '@/ui/theme/tokens.css'
import './frame.css'
import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import type { ColumnChoice } from '@/ui/formats/addressFilter.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { readRow } from '@/data/repositories/formatRowRepository.ts'
import { viewSettings } from '@/data/repositories/formatViewRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import type { StoredRow } from '@/domain/format/row.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ReadOnly } from '@/ui/formats/readOnly.ts'
import { Conversation } from '@/ui/formats/conversation.ts'
import { initTheme, setThemePreference } from '@/ui/theme/useTheme.ts'
import type { FrameView } from './contract.ts'
import { aboutMessage, selectionContext, startMessage, type Handed, type Where } from './handOff.ts'
import { connect, handedOver, INLINE_ONLY, offersLine, pageKey, parentPort, sheetOf, type Display, type DisplayMode, type Offers } from './host.ts'
import { applyHostStyle, describeApplied, handedLine } from './hostStyle.ts'
import { firstCopy, startLive, type Live, type LiveState, type LiveTarget } from './live.ts'
import { FrameRoutes, firstPath } from './routes.tsx'

/**
 * **The frame's entry** (M41 U1): the app's own format page, drawn inside a
 * conversation by a client that draws MCP Apps.
 *
 * The same shape as the demo's entry (M33 U1): the document arrives as bytes —
 * here fetched through the host with `frame_copy` (M41 F2, F3) rather than
 * beside the page — and is opened with
 * the store's own `openBytes`, so the reconciler, the repositories and
 * `FormatRows` with its `RowSheet` are the app's and not a view rewritten for
 * a frame. **Nothing is a second data path.**
 *
 * **The one difference is which build of sql.js**: the frame bundles its
 * asm.js build (`vite build --mode frame`), because the spec's default CSP for
 * a frame has no `'wasm-unsafe-eval'` and a page cannot declare one, so the
 * wasm build cannot compile there. Same package, same SQLite, compiled to
 * JavaScript instead.
 *
 * **A copy, and read-only** (M41 U2): the server opened the file read-only and
 * the frame never writes it back, so every format page is drawn under
 * `ReadOnly` — locked as a pack's format is, and saying so once, at the top.
 * Which view it opens on is the tool's (`show_format`'s `view`, or
 * `start_here`'s picture); every other view is a click away, at the app's own
 * paths (`routes.tsx`).
 */

initTheme()
requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'))

type Shown =
  | { readonly kind: 'WAITING'; readonly format: string | undefined }
  | {
      readonly kind: 'OPEN'
      readonly name: string
      /** The file's path, which a line handed to the conversation names (M51 U7). */
      readonly path: string
      readonly format: string
      readonly view: FrameView
      /** The rows `show_format` asked for, held in the address it opens on (M44 U6). */
      readonly filter: RowFilter
      /** Which columns each format's lines draw (M37 U5). */
      readonly columns: ColumnChoice
      /** Whether, and how, it is drawn again when the file changes (M44 U4). */
      readonly live?: LiveState
    }
  | { readonly kind: 'FAILED'; readonly reason: string }

let show: (next: Shown) => void = () => undefined
let shown: Shown = { kind: 'WAITING', format: undefined }
const update = (next: Shown): void => {
  shown = next
  show(next)
}

let live: Live | undefined
let lastSaid: string | undefined
let lastHanded: string | undefined

/**
 * **Drawn again in place** (M44 U4): the new copy opens through the same
 * `openBytes`, and every view re-reads on the store's revision as the app's
 * own window does when its watcher reloads (D-127). The router, the open
 * entry and every scroll region stay mounted, so nothing the person was
 * looking at moves but the rows that changed; the page's own scroll is put
 * back if the new height moved it. The copy it replaces is closed once the
 * views have let go of it.
 */
async function redraw(bytes: Uint8Array): Promise<void> {
  if (shown.kind !== 'OPEN') return
  const before = useDocumentStore.getState().db
  const { scrollX, scrollY } = window
  await useDocumentStore.getState().openBytes(bytes, shown.name)
  requestAnimationFrame(() => {
    if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY)
  })
  if (before !== undefined && before !== useDocumentStore.getState().db) {
    setTimeout(() => {
      try {
        before.close()
      } catch {
        // Already closed: nothing held it.
      }
    }, 1000)
  }
}

/** In sight: the host's tab is showing and the frame is not scrolled out of the conversation. */
let intersecting = true
const inSight = (): boolean => document.visibilityState === 'visible' && intersecting

function goLive(target: LiveTarget): void {
  live?.stop()
  live = startLive(target, {
    ask: link.ask,
    log: link.log,
    redraw,
    onState: (state) => {
      if (shown.kind === 'OPEN') update({ ...shown, live: state })
    },
  })
  live.sight(inSight())
}

document.addEventListener('visibilitychange', () => live?.sight(inSight()))
window.addEventListener('focus', () => live?.focus())
new IntersectionObserver((entries) => {
  intersecting = entries.some((entry) => entry.isIntersecting)
  live?.sight(inSight())
}).observe(document.body)

/**
 * **What the host handed over: the call's input, and its result** (M41 F3,
 * D-447). The input says what to draw — VS Code passes the result without its
 * `_meta` — and the result says whether the call failed. The spec has the
 * input come first; a host that sends the result first is waited on for
 * `INPUT_GRACE_MS` before the frame says what it lacks.
 */
let input: Record<string, unknown> | undefined
let result: { readonly value: unknown } | undefined
let begun = false
let waited = false
const INPUT_GRACE_MS = 1_000

function begin(): void {
  if (begun || result === undefined) return
  const sheet = sheetOf(input, result.value)
  const failed = (result.value as { isError?: unknown } | undefined)?.isError === true
  if (!sheet.ok && input === undefined && !failed && !waited) {
    waited = true
    setTimeout(begin, INPUT_GRACE_MS)
    return
  }
  begun = true
  // Said once, in the host's log: what this host hands a view. It is how a
  // host this machine cannot run is measured.
  link.log(`Handed over: ${handedOver(input, result.value)}${sheet.ok ? `; drawing ${sheet.path} from the ${sheet.from}.` : '.'}`)
  if (!sheet.ok) {
    update({ kind: 'FAILED', reason: sheet.reason })
    return
  }
  const key = pageKey(document)
  void (async () => {
    const copy = await firstCopy({ path: sheet.path, key }, link.ask)
    if (!copy.ok) {
      link.log(copy.reason)
      update({ kind: 'FAILED', reason: copy.reason })
      return
    }
    const name = copy.name ?? sheet.path.split(/[\\/]/).pop() ?? 'document.emd'
    await useDocumentStore.getState().openBytes(copy.bytes, name)
    const { error, db } = useDocumentStore.getState()
    // A format the document does not declare: the server answered with
    // `format_rows`' own sentence and named nothing to draw, which a frame
    // drawing from the input finds out here.
    const missing = error === undefined && sheet.format !== '' && db !== undefined && !listFormats(db).some((each) => each.name === sheet.format)
    update(
      error !== undefined
        ? { kind: 'FAILED', reason: error }
        : missing
          ? { kind: 'FAILED', reason: `${name} declares no format named ${sheet.format}. The answer is in the conversation as text.` }
          : { kind: 'OPEN', name, path: sheet.path, format: sheet.format, view: sheet.view, filter: sheet.filter, columns: sheet.columns },
    )
    if (error === undefined && !missing && key !== undefined) goLive({ path: sheet.path, uri: copy.uri ?? '', key, stamp: copy.stamp })
  })()
}

const link = connect(
  parentPort(window),
  {
    onInput: (args) => {
      input = args
      if (shown.kind === 'WAITING' && typeof args['format'] === 'string') update({ kind: 'WAITING', format: args['format'] })
      begin()
    },
    // **What to draw comes with the input; the view fetches the document**
    // (M41 F2, F3): no result carries a copy, and the result's `_meta` is read
    // only where no input came.
    onResult: (value) => {
      result = { value }
      begin()
    },
    // The host's look (M41 F1): its theme first, so `light-dark()` values
    // resolve to the right side, then its variables and fonts; again on every
    // host-context-changed, which is how a theme switch reaches an open view.
    // What it handed is said first (M41 F4), so a host this machine cannot
    // open — VS Code's palette — is read from its log; each line only when it
    // changed.
    onContext: (context) => {
      if (context.theme !== undefined) setThemePreference(context.theme)
      const done = applyHostStyle(context)
      for (const said of [handedLine(context), describeApplied(done)]) {
        if (said === lastHanded || said === lastSaid) continue
        if (said.startsWith('Host context:')) lastHanded = said
        else lastSaid = said
        void link.ready.then(() => link.log(said))
      }
    },
    onUpdated: (uri) => live?.updated(uri),
    // Where the view sits (M42 T1): the copy bar's buttons follow it.
    onDisplay: (now) => {
      const back = now.current === 'inline' && display.current !== 'inline'
      display = now
      if (shown.kind === 'OPEN') update({ ...shown })
      // Back in the chat, the host needs the height again.
      if (back) sayHowBig()
    },
    onTeardown: () => live?.stop(),
    // A cancelled call answers nothing: say so rather than wait (M41 U2).
    onCancelled: (reason) => {
      if (shown.kind === 'WAITING') {
        update({ kind: 'FAILED', reason: reason === undefined ? 'The call was cancelled, so there is nothing to draw.' : `The call was cancelled: ${reason}` })
      }
    },
  },
  { name: 'emerald-sheet', version: '1' },
)

/**
 * **What the host takes from the view** (M51 U7), known once it answered
 * `ui/initialize` — said once in its log, which is how a host this machine
 * cannot open is measured.
 */
let offers: Offers = link.offers()
/** Where the view sits and where else the host offers (M42 T1, a trial). */
let display: Display = INLINE_ONLY
void link.ready.then(() => {
  offers = link.offers()
  display = link.display()
  link.log(offersLine(offers, display))
  if (shown.kind === 'OPEN') update({ ...shown })
})

// The host sizes the frame to what the page asks for; the page says it every
// time it changes, never more often than a frame.
// Only inline (M42 T1): floating or full screen, the host sets the size, and a
// view that kept saying its own height there was a resize loop in the stand-in.
let asked = 0
function sayHowBig(): void {
  cancelAnimationFrame(asked)
  asked = requestAnimationFrame(() => {
    if (display.current !== 'inline') return
    const page = document.documentElement
    link.sizeChanged(Math.ceil(page.scrollWidth), Math.ceil(document.body.scrollHeight))
  })
}
new ResizeObserver(sayHowBig).observe(document.body)

function Frame() {
  const [now, setNow] = useState<Shown>(shown)
  useEffect(() => {
    show = setNow
    setNow(shown)
    return () => {
      show = () => undefined
    }
  }, [])

  if (now.kind === 'WAITING') {
    return <p className="p-4 text-[13px] text-ink-tertiary">Opening {now.format ?? 'the format'}…</p>
  }
  if (now.kind === 'FAILED') {
    return <p className="p-4 text-[13px] text-ink-secondary">{now.reason}</p>
  }
  return (
    <MemoryRouter initialEntries={[firstPath(now.view, now.format, now.filter, now.columns)]}>
      <ReadOnly.Provider value="Read only here.">
        <Handing where={{ name: now.name, path: now.path }}>
          <CopyBar name={now.name} live={now.live} />
        </Handing>
      </ReadOnly.Provider>
    </MemoryRouter>
  )
}

/**
 * What the frame says about itself, once: a copy, read-only. And the way back
 * to where the answer opened, since a frame has no browser's Back — every view
 * of the app has its own way to its sheet, and none to a page that is only the
 * frame's, like `start_here`'s picture.
 */
function CopyBar({ name, live }: { name: string; live: LiveState | undefined }) {
  const navigate = useNavigate()
  const { key } = useLocation()
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 px-6 pt-2.5 pb-1 text-caption text-ink-tertiary">
      {key !== 'default' && (
        <button
          type="button"
          className="text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
      )}
      <span>
        {live?.gone === true ? (
          <>
            <Bidi>{name}</Bidi> is gone from disk; this is the copy as it last was.
          </>
        ) : live !== undefined && live.mode !== 'off' ? (
          <>
            A copy of <Bidi>{name}</Bidi>, drawn again when the document changes.
          </>
        ) : (
          <>
            A copy of <Bidi>{name}</Bidi> as it was when shown.
          </>
        )}{' '}
        It reads only: nothing can be changed here.
      </span>
      <DisplayBar />
    </div>
  )
}

const MODE_LABEL: Readonly<Record<DisplayMode, string>> = { pip: 'Float', fullscreen: 'Full screen', inline: 'Back in the chat' }

/**
 * **Where the view sits** (Later T-pip): a button for each other mode the host
 * offers — *Float* (`pip`), *Full screen*, and *Back in the chat* once it is
 * not inline — and nothing at all where it offers inline only, as the Code tab
 * does. Which modes a host named is said in its log (`offersLine`).
 */
function DisplayBar() {
  const [asking, setAsking] = useState(false)
  const others = display.available.filter((mode) => mode !== display.current)
  if (others.length === 0) return null
  const ask = (mode: DisplayMode): void => {
    setAsking(true)
    void link.requestDisplay(mode).then((answer) => {
      setAsking(false)
      if (!answer.ok) link.log(`ui/request-display-mode ${mode} refused: ${answer.message}`)
      else if (answer.result['mode'] !== mode) link.log(`Asked for ${mode}; the host kept ${String(answer.result['mode'])}.`)
    })
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-3">
      {others.map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={asking}
          className="text-ink-secondary hover:text-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => ask(mode)}
        >
          {MODE_LABEL[mode]}
        </button>
      ))}
    </span>
  )
}

/** The entry routes, whose row *Ask about this* names. */
const ENTRY_ROUTES = ['/formats/:name/entry/:entry', '/formats/:name/page/:entry'] as const

/**
 * **The view hands things to the conversation** (M51 U7), as far as the host
 * offers: *Start this unit* on a ready row and *Ask about this* on an open
 * entry send a line as the person (`ui/message`); the rows a person
 * Ctrl-clicks (or `x` on a table's cursor) are what the model is told
 * "these" means (`ui/update-model-context`). A host that offers neither gets
 * the frame as it was: no button, no selection, no line about either.
 * **Nothing here writes the document.**
 */
function Handing({ where, children }: { where: Where; children: ReactNode }) {
  const db = useDocumentStore((state) => state.db)
  const { pathname, search } = useLocation()
  const [picked, setPicked] = useState<ReadonlyMap<string, { format: FormatDeclaration; row: StoredRow }>>(new Map())
  const [said, setSaid] = useState<string | undefined>(undefined)
  const { message, modelContext } = offers

  const handed = (format: FormatDeclaration, row: StoredRow): Handed => ({
    format,
    row,
    entry: db === undefined ? new Map<string, string>() : viewSettings(db, format.name, 'entry'),
  })
  const send = (text: string): void => {
    setSaid('Sending to the conversation…')
    void link.say(text).then((answer) => {
      setSaid(answer.ok ? 'Sent to the conversation.' : `The conversation did not take it: ${answer.message}`)
      if (!answer.ok) link.log(`ui/message refused: ${answer.message}`)
    })
  }

  const conversation = useMemo<Conversation>(
    () => ({
      ...(message ? { start: (format: FormatDeclaration, row: StoredRow) => send(startMessage(handed(format, row), where)) } : {}),
      ...(modelContext
        ? {
            selection: {
              has: (id: string) => picked.has(id),
              toggle: (format: FormatDeclaration, row: StoredRow) =>
                setPicked((before) => {
                  const next = new Map(before)
                  if (next.has(row.id)) next.delete(row.id)
                  else next.set(row.id, { format, row })
                  return next
                }),
            },
          }
        : {}),
    }),
    // `send` and `handed` read `db` and `where`, which these name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message, modelContext, picked, db, where.name, where.path],
  )

  // The model is told on every change of the selection, and of the view it is
  // in while it holds rows; never before the first pick, and an emptied
  // selection is said as empty, which clears what was said.
  const told = useRef(false)
  const view = pathname + search
  useEffect(() => {
    if (!modelContext || (picked.size === 0 && !told.current)) return
    told.current = picked.size > 0
    const rows = [...picked.values()].map((each) => handed(each.format, each.row))
    void link.tellModel(selectionContext(rows, where, view)).then((answer) => {
      if (!answer.ok) link.log(`ui/update-model-context refused: ${answer.message}`)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelContext, picked, view])

  // The open entry, which *Ask about this* names.
  const entry = useMemo(() => {
    if (!message || db === undefined) return undefined
    for (const route of ENTRY_ROUTES) {
      const at = matchPath(route, pathname)
      const name = at?.params['name']
      const id = at?.params['entry']
      if (name === undefined || id === undefined) continue
      const format = listFormats(db).find((each) => each.name === name)
      const row = format === undefined ? undefined : readRow(db, format, id)
      return format === undefined || row === undefined ? undefined : { format, row }
    }
    return undefined
  }, [message, db, pathname])

  return (
    <Conversation.Provider value={conversation}>
      <div className="flex flex-col">
        {children}
        {(message || modelContext) && (
          <div className="flex flex-wrap items-baseline gap-x-3 px-6 pb-1 text-caption text-ink-tertiary" aria-live="polite">
            {entry !== undefined && (
              <button
                type="button"
                className="text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => send(aboutMessage(handed(entry.format, entry.row), where))}
              >
                Ask about this {entry.format.title.toLowerCase()}
              </button>
            )}
            {modelContext &&
              (picked.size === 0 ? (
                <span>Ctrl-click rows to tell the conversation which ones you mean.</span>
              ) : (
                <span>
                  {picked.size === 1 ? 'One row' : `${String(picked.size)} rows`} selected — the conversation knows these.{' '}
                  <button
                    type="button"
                    className="text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => setPicked(new Map())}
                  >
                    Clear
                  </button>
                </span>
              ))}
            {said !== undefined && <span className="text-ink-secondary">{said}</span>}
          </div>
        )}
        <FrameRoutes />
      </div>
    </Conversation.Provider>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <Frame />
  </StrictMode>,
)
