/**
 * The window half of `scripts/check-tours.mjs` (M33 U3): opens the demo's
 * frame (`tour.html`) with `?check` at each size, in a window nobody sees, waits
 * for what it publishes as `window.emeraldTourCheck`, and prints one JSON line
 * per tour and size. The first load names every tour; each other tour is a load
 * of its own. Then Emerald's page (M33 U8), the folder's `index.html`, is opened
 * once at the first size and must hear a step from each of the frames it embeds.
 *
 * **Nothing leaves the page** (M33 U4, D-418): every request any frame makes
 * is seen here, and one for anything but the folder being served — or a
 * `data:` or `blob:` URL the page made itself — is refused and fails the check,
 * named, as a run of its own.
 *
 * `.cjs` because the main process hangs on `app.whenReady()` when the entry is
 * an ES module (`make-icons.cjs`, `make-demo-receipt.cjs`).
 */

const { app, BrowserWindow, session } = require('electron')

const BASE = process.env.TOURS_BASE ?? ''
const SIZES = (process.env.TOURS_SIZES ?? '1280x800').split(',').filter(Boolean)
/**
 * Longer than the runner's own `LOST_AFTER` (10 s) for one missing anchor, so a
 * failing tour reports which step rather than timing out here.
 */
const PER_TOUR = Number(process.env.TOURS_PER_TOUR ?? 60_000)

async function checkOne(size, tour) {
  const [width, height] = size.split('x').map(Number)
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    // Offscreen, so the page paints and its animation frames run with no window shown:
    // a hidden window says it is visible and paints nothing, and the runner waits on paint.
    webPreferences: { backgroundThrottling: false, offscreen: true },
  })
  // What the page says when it goes wrong is the first thing to read when a check fails.
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') console.error(`  [${size}] ${event.message}`)
  })
  try {
    const query = tour === undefined ? '?check' : `?check&tour=${encodeURIComponent(tour)}`
    await window.loadURL(`${BASE}tour.html${query}`)
    const until = Date.now() + PER_TOUR
    for (;;) {
      const found = await window.webContents.executeJavaScript('window.emeraldTourCheck ?? null')
      if (found !== null && process.env.TOURS_DEBUG !== undefined && !found.result.ok) {
        console.error(await window.webContents.executeJavaScript(process.env.TOURS_DEBUG))
      }
      if (found !== null) return found
      if (Date.now() > until) {
        const where = await window.webContents.executeJavaScript(
          `[document.visibilityState, document.querySelector('.tour-say')?.textContent ?? document.body.innerText.slice(0, 200)].join(' | ')`,
        )
        return { tour: tour ?? '', tours: [], result: { ok: false, said: `No answer in ${String(PER_TOUR / 1000)} s (${where}).`, ms: PER_TOUR } }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } finally {
    window.destroy()
  }
}

/**
 * Emerald's page: loaded whole, with its frames playing as a visitor would see
 * them, until every frame has posted a step to it (`window.emeraldPageCheck`).
 */
async function checkPage(size) {
  const [width, height] = size.split('x').map(Number)
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  })
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') console.error(`  [page ${size}] ${event.message}`)
  })
  const started = Date.now()
  try {
    await window.loadURL(BASE)
    const until = started + PER_TOUR
    for (;;) {
      const found = await window.webContents.executeJavaScript('window.emeraldPageCheck ?? null')
      if (found !== null && found.frames > 0 && found.stepped >= found.frames) {
        return { tour: 'the page', result: { ok: true, steps: found.frames, ms: Date.now() - started } }
      }
      if (Date.now() > until) {
        const said = found === null ? 'the page published nothing' : `${String(found.stepped)} of ${String(found.frames)} frames stepped`
        return { tour: 'the page', result: { ok: false, said: `No answer in ${String(PER_TOUR / 1000)} s (${said}).`, ms: PER_TOUR } }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } finally {
    window.destroy()
  }
}

/** Whatever was asked for outside the folder, in the order it was asked. */
const strayed = []

app.whenReady().then(async () => {
  let code = 0
  const served = new URL(BASE).origin
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const own = url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:') || new URL(url).origin === served
    if (!own) strayed.push(url)
    callback({ cancel: !own })
  })
  try {
    for (const size of SIZES) {
      const first = await checkOne(size)
      const runs = [first]
      for (const tour of first.tours.filter((name) => name !== first.tour)) runs.push(await checkOne(size, tour))
      for (const run of runs) process.stdout.write(`${JSON.stringify({ size, tour: run.tour, result: run.result })}\n`)
    }
    const page = await checkPage(SIZES[0] ?? '1280x800')
    process.stdout.write(`${JSON.stringify({ size: SIZES[0] ?? '1280x800', tour: page.tour, result: page.result })}\n`)
    const said = strayed.length === 0 ? undefined : `asked for what the folder does not serve: ${[...new Set(strayed)].join(', ')}`
    const network = said === undefined ? { ok: true, steps: 0, ms: 0 } : { ok: false, said, ms: 0 }
    process.stdout.write(`${JSON.stringify({ size: 'every size', tour: 'nothing leaves the page', result: network })}\n`)
  } catch (error) {
    console.error(error)
    code = 1
  }
  app.exit(code)
})

app.on('window-all-closed', () => {
  // Every window is destroyed by hand; the app exits once the last check is printed.
})
