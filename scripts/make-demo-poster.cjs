/**
 * **The poster** (M33 U4, D-418): the custom tour at the end of its first
 * scene, 1600 x 1000 — what a page embedding it shows before a visitor clicks,
 * and all a phone there sees. Drawn from the built demo, so it is the frame as
 * it is and not a picture of it:
 *
 *   npm run build:demo && npm run demo:poster
 *
 * writes four pictures into `fixtures/synthetic/demo/` (committed beside the
 * receipt, so a site embedding the tour can take them without building anything):
 * `poster.png` and `poster-dark.png`, the first scene in each scheme, and
 * `poster-claim.png` and `poster-claim-dark.png`, the last scene — the claim
 * not adding up, which is the tour's point — for a site that shows two
 * (2026-10-11). Run it again whenever the frame, the tour's captions or
 * the scenes these are taken from change.
 *
 * **The end of a scene** (2026-10-07: the first frame was a bare
 * list of formats): the tour plays with `autoplay`, and the frame is taken once
 * the scene's outline has finished drawing — for the first, the card statement
 * open, the Corner Market row outlined, the first caption up — while that
 * caption is still held. If the scene has moved on by the time the capture is
 * taken, nothing is written and the script fails.
 *
 * `dist-demo/` is served on loopback, as `check-tours` serves it, and the
 * window is offscreen, so nothing is shown and nothing leaves the machine. A
 * profile of its own, and a session of its own per picture, so no theme a
 * person picked in another Electron window, and no speed one picture leaves,
 * reaches the next. `.cjs`: the main process hangs on `app.whenReady()` when
 * the entry is an ES module (`make-icons.cjs`).
 */

const { app, BrowserWindow, nativeTheme } = require('electron')
const { createReadStream, mkdtempSync, statSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const path = require('node:path')

const REPO = path.join(__dirname, '..')
const FOLDER = path.join(REPO, 'dist-demo')
const OUT = path.join(REPO, 'fixtures', 'synthetic', 'demo')
const TOUR = process.env.POSTER_TOUR ?? 'custom'
const WIDTH = 1600
const HEIGHT = 1000

/** Which scene, counted from 1 as the strip counts; 0 is the tour's last. */
const SHOTS = [
  { file: 'poster.png', scene: 1, scheme: 'light' },
  { file: 'poster-dark.png', scene: 1, scheme: 'dark' },
  { file: 'poster-claim.png', scene: 0, scheme: 'light' },
  { file: 'poster-claim-dark.png', scene: 0, scheme: 'dark' },
]

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'emerald-poster-')))

/** The caption on screen, as the strip shows it. */
const CAPTION = `document.querySelector('.tour-say .tour-fade > span:not(.reserve)')?.textContent ?? ''`

/** The scene on screen, counted from 1 as the strip counts it. */
const SCENE = `([...document.querySelectorAll('.tour-dot')].findIndex((dot) => dot.classList.contains('now')) + 1)`

/**
 * Notes every scene the outline is drawn in, from the moment the page loads —
 * so a scene's own outline is told from the one the scene before left behind.
 */
const WATCH = `(async () => {
  window.__drawn = []
  let look = null
  for (const until = Date.now() + 30000; look === null; ) {
    look = document.querySelector('.tour-look')
    if (look !== null) break
    if (Date.now() > until) throw new Error('the frame never drew: ' + document.body.innerText.slice(0, 200))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  new MutationObserver(() => {
    if (look.classList.contains('drawn') && !look.classList.contains('gone')) window.__drawn.push(${SCENE})
  }).observe(look, { attributes: true, attributeFilter: ['class'] })
})()`

/**
 * Settles at the end of a scene: its outline drawn whole, the fonts in, two
 * paints after. Answers the caption and the scene then, so the caller can tell
 * the scene did not move on.
 */
const END_OF_SCENE = (scene) => `(async () => {
  const want = ${String(scene)} || document.querySelectorAll('.tour-dot').length
  const until = Date.now() + 180000
  for (;;) {
    const look = document.querySelector('.tour-look.drawn:not(.gone)')
    if (look !== null && ${SCENE} === want && window.__drawn.includes(want)) {
      await Promise.all(look.querySelector('rect').getAnimations().map((animation) => animation.finished))
      break
    }
    if (Date.now() > until) throw new Error('scene ' + want + ' never outlined its box: ' + (document.querySelector('.tour-frame')?.dataset.mode ?? document.body.innerText.slice(0, 200)))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await document.fonts.ready
  await document.querySelector('iframe.tour-app').contentWindow.document.fonts.ready
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return [${CAPTION}, want]
})()`

/** Whether the scene is still on screen: its caption, and its outline held. */
const STILL = `[${CAPTION}, document.querySelector('.tour-look.drawn:not(.gone)') !== null]`

app.whenReady().then(async () => {
  let code = 0
  // A hang anywhere is a failure, never a wait: four tours play well inside this.
  setTimeout(() => {
    console.error('Gave up after 8 minutes; nothing more written.')
    app.exit(1)
  }, 8 * 60 * 1000).unref()
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
    if (!statSync(path.join(FOLDER, 'tour.html'), { throwIfNoEntry: false })?.isFile()) {
      throw new Error('No dist-demo/tour.html — run npm run build:demo first.')
    }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    for (const shot of SHOTS) {
      nativeTheme.themeSource = shot.scheme
      const window = new BrowserWindow({
        show: false,
        width: WIDTH,
        height: HEIGHT,
        useContentSize: true,
        webPreferences: { backgroundThrottling: false, offscreen: true, partition: `poster-${shot.file}` },
      })
      window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error(`  [page] ${event.message}`)
      })
      await window.loadURL(`http://127.0.0.1:${String(port)}/tour.html?tour=${encodeURIComponent(TOUR)}&autoplay=1`)
      await window.webContents.executeJavaScript(WATCH)
      const [caption, scene] = await window.webContents.executeJavaScript(END_OF_SCENE(shot.scene))
      let image = await window.webContents.capturePage()
      const [now, held] = await window.webContents.executeJavaScript(STILL)
      if (now !== caption || !held) throw new Error(`Scene ${String(scene)} ended before the capture (now "${now.trim()}"); ${shot.file} not written.`)
      const size = image.getSize()
      if (size.width !== WIDTH || size.height !== HEIGHT) image = image.resize({ width: WIDTH, height: HEIGHT, quality: 'best' })
      const out = path.join(OUT, shot.file)
      await writeFile(out, image.toPNG())
      console.log(`${path.relative(REPO, out)}: ${String(WIDTH)}x${String(HEIGHT)}, ${shot.scheme}, the ${TOUR} tour at the end of scene ${String(scene)}, under "${caption.trim()}"`)
      window.destroy()
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    code = 1
  }
  server.close()
  app.exit(code)
})

app.on('window-all-closed', () => {
  // Each window is destroyed by hand; the app exits once the posters are written.
})
