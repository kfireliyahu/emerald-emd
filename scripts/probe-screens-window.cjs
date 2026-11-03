/**
 * The window half of `scripts/probe-screens.mjs` (D-534): opens the demo app at
 * `PROBE_URL` in a window nobody sees, waits for the dev build to publish
 * `window.emeraldProbe`, runs it with `PROBE_OPTIONS`, and prints one JSON line.
 *
 * A request for anything but the server being probed is refused and named, as
 * `check-tours-window.cjs` does, so a probe is also a check that the page makes
 * no request it did not serve itself.
 *
 * `.cjs` because the main process hangs on `app.whenReady()` when the entry is
 * an ES module (`make-icons.cjs`, `check-tours-window.cjs`).
 */

const { app, BrowserWindow, session } = require('electron')

const BASE = process.env.PROBE_BASE ?? ''
const URL_TO_OPEN = process.env.PROBE_URL ?? ''
const OPTIONS = process.env.PROBE_OPTIONS ?? '{}'
const [WIDTH, HEIGHT] = (process.env.PROBE_SIZE ?? '1280x800').split('x').map(Number)
/** Vite compiles the app on the first load; a cold one takes a while. */
const READY_WITHIN = 90_000

async function run() {
  const refused = []
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const own = details.url.startsWith(BASE) || /^(data|blob|devtools|chrome-extension):/.test(details.url)
    // Vite's own reload socket is the dev server's, not the page's; it has nothing to reload here.
    if (!own && !details.url.startsWith('ws://127.0.0.1:')) refused.push(details.url)
    callback({ cancel: !own })
  })
  const window = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    // Offscreen, so the page paints and its animation frames run with no window shown.
    webPreferences: { backgroundThrottling: false, offscreen: true },
  })
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(`  [page] ${event.message}`)
  })
  await window.loadURL(URL_TO_OPEN)
  const until = Date.now() + READY_WITHIN
  while (!(await window.webContents.executeJavaScript("typeof window.emeraldProbe === 'function'"))) {
    if (Date.now() > until) throw new Error(`window.emeraldProbe never appeared at ${URL_TO_OPEN} — is it a dev build?`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  // The document loads after the probe is installed; let the first screen draw.
  await window.webContents.executeJavaScript(
    "new Promise((done) => { const t0 = Date.now(); const tick = () => (document.querySelector('main') || Date.now() - t0 > 15000 ? setTimeout(done, 400) : setTimeout(tick, 100)); tick() })",
  )
  const results = await window.webContents.executeJavaScript(`window.emeraldProbe(${OPTIONS})`)
  process.stdout.write(`${JSON.stringify({ results, refused })}\n`)
}

app.disableHardwareAcceleration()
app.whenReady().then(
  () =>
    run().then(
      () => app.exit(0),
      (error) => {
        console.error(String(error?.message ?? error))
        app.exit(1)
      },
    ),
  () => app.exit(1),
)
