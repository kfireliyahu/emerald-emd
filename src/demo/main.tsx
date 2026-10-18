import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, useNavigate } from 'react-router-dom'
import '@/ui/theme/tokens.css'
import { App } from '@/App.tsx'
import { stageRows } from '@/data/repositories/formatBatchRepository.ts'
import { adoptFormat, listFormats, readFormat } from '@/data/repositories/formatRepository.ts'
import { insertRows } from '@/data/repositories/formatRowRepository.ts'
import { setColumnWidth } from '@/data/repositories/formatViewRepository.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import { declarationRejection } from '@/domain/format/declaration.ts'
import { declarationChangeRefusal } from '@/domain/format/owner.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { initTheme } from '@/ui/theme/useTheme.ts'
import { containScrolling } from './contained.ts'
import type { DemoHandle } from './contract.ts'
import { declarationFrom } from './tour/declare.ts'

/**
 * **The demo's entry** (M33 U1, D-413): the app's own screens, hash-routed,
 * over one document opened on start through the store's own `openBytes` — the
 * same engine, the same reconciler and the same refusals as the app, with no
 * file behind it.
 *
 * What it leaves out is said once, in `src/ui/edition.ts`, and is true only in
 * this build (`vite build --mode demo`): New, Open…, Save, the recents and their
 * shortcuts, the crash snapshot and the close guard. It has no shell — nothing
 * here reaches `electron/` — and so no model runtime, which only the shell can
 * reach (D-134).
 *
 * **It lives in somebody else's page** (M33 U4): a cross-origin iframe, where
 * reading `localStorage` can throw. Every read the app makes is guarded, and
 * nothing the demo needs is stored — the document is these bytes, every time.
 */

/**
 * Beside the page, written by `scripts/make-demo-document.mjs` at build time:
 * one document per tour, named by the frame as `?document=custom.emd` (M33 U2),
 * and the ledger's `demo.emd` when nothing is named — U1's page, unchanged.
 * Only a plain name beside the page is taken, never a path or an address.
 */
const DOCUMENT_NAME = documentNamed(new URLSearchParams(window.location.search).get('document'))
const DOCUMENT_URL = `./${DOCUMENT_NAME}`

function documentNamed(asked: string | null): string {
  return asked !== null && /^[a-z0-9-]+\.emd$/.test(asked) ? asked : 'demo.emd'
}

containScrolling(window)
initTheme()
requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'))

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App />
      <RouterHand />
    </HashRouter>
  </StrictMode>,
)

/** The router's own way home, set by `RouterHand` once it renders. */
let goHome: (() => void) | undefined

/** Lends `reopen` the router's `navigate`, which the page outside the tree has not got. */
function RouterHand() {
  const navigate = useNavigate()
  useEffect(() => {
    goHome = () => navigate('/', { replace: true })
    return () => {
      goHome = undefined
    }
  }, [navigate])
  return null
}

/** The bytes as fetched, kept so a reopen is these bytes again and never a second fetch. */
let fetched: Uint8Array | undefined

const ready = openDemoDocument()

/**
 * **The frame's handle on this page** (M33 U2): the tour reopens the bytes to
 * start over, and hears every write so it can tell a visitor that going back to
 * Watch throws theirs away.
 */
const handle: DemoHandle = {
  ready,
  async reopen() {
    await ready
    // Home first, so the screen that was open unmounts with whatever it held
    // unwritten, and the document opened next is met where a visitor first was.
    // **Through the router, never by writing the hash**: a hash written by hand
    // comes back as a location with the router's `default` key — the very one
    // it started on — so a redirect from the root that was still loading looked
    // already done, and the demo stayed on a blank root (M33 U2).
    goHome?.()
    // A turn for the router to render Home before the document under it changes.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (fetched !== undefined) await useDocumentStore.getState().openBytes(fetched.slice(), DOCUMENT_NAME)
  },
  onWrite(listener) {
    return useDocumentStore.subscribe((now, before) => {
      if (now.isDirty && now.revision !== before.revision && now.db === before.db) listener()
    })
  },
  record(format, rows) {
    const store = useDocumentStore.getState()
    if (store.db === undefined) throw new Error('No document is open.')
    const declaration = readFormat(store.db, format)
    if (declaration === undefined) throw new Error(`The document declares no ${format}.`)
    const batch = stageRows(store.db, declaration, rows)
    if (batch.refusals.length > 0) {
      throw new Error(batch.refusals.map(({ index, reason }) => `Row ${String(index + 1)}: ${reason}`).join(' '))
    }
    store.mutate((db) =>
      insertRows(
        db,
        declaration,
        batch.accepted.map((each) => each.cells),
        batch.accepted.map((each) => each.id),
      ),
    )
  },
  declare(input) {
    const store = useDocumentStore.getState()
    const db = store.db
    if (db === undefined) throw new Error('No document is open.')
    const held = readFormat(db, input.format)
    const made = declarationFrom(input, held)
    if (!made.ok) throw new Error(made.error)
    const neighbours = listFormats(db).filter((each) => each.name !== input.format)
    const refused =
      declarationRejection(made.value, neighbours, listUnits(db)) ??
      (held === undefined ? undefined : declarationChangeRefusal(held, made.value))
    if (refused !== undefined) throw new Error(refused)
    store.mutate((open) => {
      const plan = adoptFormat(open, made.value, Date.now())
      if (plan.refusals.length > 0) throw new Error(plan.refusals.map((each) => each.detail).join(' '))
      for (const [column, width] of Object.entries(input.widths ?? {})) setColumnWidth(open, input.format, column, width)
    })
  },
}
window.emeraldDemo = handle

async function openDemoDocument(): Promise<void> {
  try {
    const response = await fetch(DOCUMENT_URL)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    fetched = new Uint8Array(await response.arrayBuffer())
    // A copy: sql.js takes the buffer it is handed, and a reopen needs these bytes untouched.
    await useDocumentStore.getState().openBytes(fetched.slice(), DOCUMENT_NAME)
  } catch (error) {
    useDocumentStore.setState({
      error: `The demo document could not be opened. ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}
