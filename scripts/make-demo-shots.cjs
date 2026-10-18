/**
 * **The ledger's pictures** (M33 F12): four of its screens — the split, where a
 * paycheck went, wealth and the year — taken from the made-up year in
 * `showcase.emd`, in the light scheme and the dark, for the ledger's section of
 * Emerald's page, which shows the pair matching its own theme:
 *
 *   npm run build:demo && npm run demo:shots
 *
 * writes eight pictures into `fixtures/synthetic/demo/` (`ledger-<view>.png` and
 * `ledger-<view>-dark.png`), committed beside the posters and copied beside the
 * page by the demo build. Run it again when one of these screens or the
 * showcase's figures change.
 *
 * Each picture is a region of the screen rather than the window — from the
 * element a view begins at to the one it ends at, the width of the app's main
 * column — so the sidebar, the address bar and Home's waiting line stay out.
 * Drawn at twice the pixels through the devtools protocol (a device scale of 2,
 * in a viewport emulated taller than any region), so it stays sharp on a dense
 * screen and a screen shorter than the region cannot cut it.
 *
 * `dist-demo/` is served on loopback, as `check-tours` serves it, and the
 * window is offscreen, so nothing is shown and nothing leaves the machine. A
 * profile of its own, and a session of its own per picture, as the posters
 * have. `.cjs`: the main process hangs on `app.whenReady()` when the entry is
 * an ES module (`make-icons.cjs`).
 */

const { app, BrowserWindow, nativeTheme } = require('electron')
const { createReadStream, mkdtempSync, statSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')
const FOLDER = path.join(REPO, 'dist-demo')
const OUT = path.join(REPO, 'fixtures', 'synthetic', 'demo')
const DOCUMENT = 'showcase.emd'
/** CSS pixels the app lays out at, and how many device pixels each is drawn with. */
const WIDTH = 1200
const HEIGHT = 1500
const SCALE = 2

/**
 * Each view: where it is, what has to be on screen before it is taken, what to
 * do first, and the two elements its region runs from and to — found by their
 * text, as a person finds them, so a renamed heading fails here rather than
 * cropping the wrong thing.
 */
const VIEWS = [
  {
    name: 'split',
    route: '#/plan',
    ready: 'Every shekel has a job',
    from: `heading('The split')`,
    to: `containing('Every shekel has a job')`,
  },
  {
    name: 'where-it-went',
    route: '#/paychecks',
    ready: 'Out of the gross, before you saw it',
    from: `containing('Where it went')`,
    to: `last(containing('Severance'))`,
  },
  {
    name: 'wealth',
    route: '#/wealth',
    ready: 'Everything you own, each once',
    from: `heading('Net worth')`,
    to: `last(containing('Net worth'))`,
  },
  {
    name: 'year',
    route: '#/year',
    ready: 'months in this document',
    // The whole of 2025 is in the showcase; the newest year is not.
    prepare: `document.querySelector('nav[aria-label="Year"] button[aria-label="Previous"]').click()`,
    after: '12 of 12 months',
    from: `heading('2025')`,
    to: `containing('A month opens it in Month')`,
  },
]

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
}

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'emerald-shots-')))

/** The helpers a view's `from` and `to` are written in, defined in the page. */
const HELPERS = `
  window.__leaves = () => [...document.querySelectorAll('main *')].filter((element) => element.children.length === 0 || element.matches('h1, h2, h3, p, td, th, span'))
  window.containing = (text) => {
    const wanted = text.toLowerCase()
    const found = window.__leaves().filter((element) => element.textContent.trim().toLowerCase().startsWith(wanted))
    if (found.length === 0) throw new Error('nothing on the screen says ' + JSON.stringify(text))
    return found
  }
  window.heading = (text) => {
    const found = [...document.querySelectorAll('main h1, main h2, main h3')].filter((element) => element.textContent.trim() === text)
    if (found.length === 0) throw new Error('no heading says ' + JSON.stringify(text))
    return found
  }
  window.last = (list) => list.slice(-1)
`

/** Waits until the screen says `text`, then for fonts, charts and two paints. */
const SETTLED = (text) => `(async () => {
  const wanted = ${JSON.stringify(text.toLowerCase())}
  for (const until = Date.now() + 60000; ; ) {
    if ((document.querySelector('main')?.innerText ?? '').toLowerCase().includes(wanted)) break
    if (Date.now() > until) throw new Error('the screen never said ' + JSON.stringify(wanted) + ': ' + (document.querySelector('main')?.innerText ?? document.body.innerText).slice(0, 200))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await document.fonts.ready
  await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  await new Promise((resolve) => setTimeout(resolve, 400))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
})()`

/** The region from the first element to the last, the width of the main column, in CSS pixels. */
const REGION = (view) => `(() => {
  ${HELPERS}
  const top = (${view.from})[0]
  const pad = 24
  top.scrollIntoView({ block: 'start' })
  // The app scrolls its column, not the window: back that off by a margin.
  let scroller = top.parentElement
  while (scroller !== null && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement
  if (scroller !== null) scroller.scrollTop -= pad
  // Measured after scrolling. The region never starts above the column: the line
  // Home's questions keep sits over it, outside \`main\`.
  const main = document.querySelector('main').getBoundingClientRect()
  const first = top.getBoundingClientRect()
  const end = (${view.to})[0].getBoundingClientRect()
  const y = Math.max(Math.ceil(main.top), Math.floor(first.top - pad))
  // Whatever scrolls the column ends at its right edge; its scrollbar is that wide.
  const bar = Math.max(0, ...[...document.querySelectorAll('*')]
    .filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY) && Math.abs(element.getBoundingClientRect().right - main.right) < 2)
    .map((element) => element.offsetWidth - element.clientWidth))
  // The capture's region is in the document's pixels, which the window's own scroll offsets.
  return {
    x: Math.max(0, Math.floor(main.left)) + window.scrollX,
    y: y + window.scrollY,
    // The column's scrollbar is not the screen: the region stops where it starts.
    width: Math.floor(main.width - bar),
    height: Math.ceil(end.bottom + pad - y),
  }
})()`

app.whenReady().then(async () => {
  let code = 0
  setTimeout(() => {
    console.error('Gave up after 5 minutes; nothing more written.')
    app.exit(1)
  }, 5 * 60 * 1000).unref()
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    const file = path.join(FOLDER, pathname === '/' ? 'index.html' : pathname)
    if (!file.startsWith(FOLDER) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  })
  try {
    if (!statSync(path.join(FOLDER, DOCUMENT), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`No dist-demo/${DOCUMENT} — run npm run build:demo first.`)
    }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    for (const view of VIEWS) {
      for (const scheme of ['light', 'dark']) {
        nativeTheme.themeSource = scheme
        const file = `ledger-${view.name}${scheme === 'dark' ? '-dark' : ''}.png`
        const window = new BrowserWindow({
          show: false,
          width: WIDTH,
          height: 900,
          useContentSize: true,
          webPreferences: { backgroundThrottling: false, offscreen: true, partition: `shots-${file}` },
        })
        window.webContents.on('console-message', (event) => {
          if (event.level === 'error') console.error(`  [page] ${event.message}`)
        })
        // The protocol answers once there is a page to answer for.
        await window.loadURL('about:blank')
        const devtools = window.webContents.debugger
        devtools.attach('1.3')
        await devtools.sendCommand('Emulation.setDeviceMetricsOverride', {
          width: WIDTH,
          height: HEIGHT,
          deviceScaleFactor: SCALE,
          mobile: false,
        })
        await window.loadURL(`http://127.0.0.1:${String(port)}/app.html?document=${DOCUMENT}${view.route}`)
        await window.webContents.executeJavaScript(SETTLED(view.ready))
        if (view.prepare !== undefined) {
          await window.webContents.executeJavaScript(view.prepare)
          await window.webContents.executeJavaScript(SETTLED(view.after ?? view.ready))
        }
        const region = await window.webContents.executeJavaScript(REGION(view))
        await window.webContents.executeJavaScript(SETTLED(view.ready))
        if (region.height > HEIGHT) throw new Error(`${file}: the region is ${String(region.height)} px tall, more than the window's ${String(HEIGHT)}.`)
        const shot = await devtools.sendCommand('Page.captureScreenshot', {
          format: 'png',
          clip: { ...region, scale: 1 },
          captureBeyondViewport: false,
        })
        const out = path.join(OUT, file)
        await writeFile(out, Buffer.from(shot.data, 'base64'))
        console.log(`${path.relative(REPO, out)}: ${String(region.width * SCALE)}x${String(region.height * SCALE)}, ${scheme}, ${view.route}`)
        devtools.detach()
        window.destroy()
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    code = 1
  }
  server.close()
  app.exit(code)
})

app.on('window-all-closed', () => {
  // Each window is destroyed by hand; the app exits once the pictures are written.
})
