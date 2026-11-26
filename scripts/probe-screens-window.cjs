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

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')

const BASE = process.env.PROBE_BASE ?? ''
const URL_TO_OPEN = process.env.PROBE_URL ?? ''
const OPTIONS = process.env.PROBE_OPTIONS ?? '{}'
const [WIDTH, HEIGHT] = (process.env.PROBE_SIZE ?? '1280x800').split('x').map(Number)
/** Where `--shots` puts its pictures, and what each file's name starts with (M64 U2). */
const SHOTS = process.env.PROBE_SHOTS ?? ''
const PREFIX = process.env.PROBE_PREFIX ?? 'screen'
/** A picture is never taller than this, however long the screen. */
const MAX_SHOT = 8000
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
  if (!SHOTS) {
    const results = await window.webContents.executeJavaScript(`window.emeraldProbe(${OPTIONS})`)
    process.stdout.write(`${JSON.stringify({ results, refused, shots: [] })}\n`)
    return
  }
  // **A picture of every route and theme** (M64 U2, D-612): each one measured on
  // its own and left on screen (`stay`), the window stretched to the screen's
  // whole length, captured, and put back to its size before the next.
  const options = JSON.parse(OPTIONS)
  const routes = options.routes?.length ? options.routes : ['#/']
  const themes = options.themes?.length ? options.themes : ['light']
  const results = []
  const shots = []
  fs.mkdirSync(SHOTS, { recursive: true })
  for (const route of routes) {
    for (const theme of themes) {
      const one = { ...options, routes: [route], themes: [theme], stay: true }
      const [result] = await window.webContents.executeJavaScript(`window.emeraldProbe(${JSON.stringify(one)})`)
      results.push(result)
      // The longest thing that scrolls on its own, past the window's height.
      const past = await window.webContents.executeJavaScript(
        "Math.max(0, ...[...document.querySelectorAll('*')].map((el) => { const o = getComputedStyle(el).overflowY; return o === 'auto' || o === 'scroll' ? el.scrollHeight - el.clientHeight : 0 }))",
      )
      const height = Math.min(HEIGHT + past, MAX_SHOT)
      if (height !== HEIGHT) {
        window.setContentSize(WIDTH, height)
        await still(window)
        // A stretched page has twice painted its Hebrew with the letters in
        // reverse order (M64 F33) — never at the window's own height, and never
        // in the browser, where the language is set before anything is drawn.
        // The probe switches the language on a page already drawn in English,
        // so after the stretch every line is laid out afresh before the picture.
        await relaid(window)
      }
      // An offscreen window's `capturePage` can hand back a stale frame; a frame
      // painted on request is the page as it is now.
      const image = await new Promise((resolve) => {
        window.webContents.once('paint', (_event, _dirty, frame) => resolve(frame))
        window.webContents.invalidate()
      })
      const file = `${PREFIX}--${slug(result.route)}--${theme}.png`
      fs.writeFileSync(path.join(SHOTS, file), image.toPNG())
      shots.push({ route: result.route, theme, file, height })
      if (height !== HEIGHT) {
        window.setContentSize(WIDTH, HEIGHT)
        await still(window)
      }
    }
  }
  process.stdout.write(`${JSON.stringify({ results, refused, shots })}\n`)
}

/** `#/formats/card_charge/entry/new` as a file's name, `formats-card_charge-entry-new`; `#/` is `home`. */
function slug(route) {
  return route.replace(/^#\/?/, '').replace(/[^a-z0-9_]+/gi, '-').replace(/^-|-$/g, '') || 'home'
}

/**
 * Every line of text laid out afresh (M64 F33): the fonts loaded, the
 * document's direction turned over and back with a layout between, so no line
 * keeps an ordering worked out before the language changed or the window grew.
 */
async function relaid(window) {
  await window.webContents.executeJavaScript(
    "(async () => { await document.fonts.ready; const html = document.documentElement; const dir = html.getAttribute('dir'); html.setAttribute('dir', dir === 'rtl' ? 'ltr' : 'rtl'); void document.body.offsetHeight; if (dir === null) html.removeAttribute('dir'); else html.setAttribute('dir', dir); void document.body.offsetHeight })()",
  )
  await still(window)
}

/** The page laid out again at its new size, and painted. */
function still(window) {
  return window.webContents.executeJavaScript(
    'new Promise((done) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 50))), 350))',
  )
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
