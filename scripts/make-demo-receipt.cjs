/**
 * The grocery receipt the custom tour shows beside the sheet (M33 U2), drawn
 * from `fixtures/synthetic/demo/receipt.json` into `receipt.png` beside it.
 *
 *   npm run demo:receipt
 *
 * **Drawn, never photographed.** The shop is made up and every figure is round;
 * the lines add up to the printed total and nothing else here is true of any
 * shop. Run it again after changing the JSON — the PNG is committed so a build
 * needs no Electron, and the JSON is what it says.
 *
 * **Electron is the rasterizer**, as in `make-icons.cjs` and for its reason:
 * Chromium is already in this repo, and a canvas inside the page draws exactly
 * the size asked for. `.cjs` for the same reason too — the main process hangs
 * on `app.whenReady()` when the entry is an ES module.
 *
 * The tour never says the app read this picture. It is shown beside the sheet
 * while the ring types what it says, as a person would.
 */

const { app, BrowserWindow } = require('electron')
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const DEMO = join(__dirname, '..', 'fixtures', 'synthetic', 'demo')

/** The page-side drawing: one canvas, a paper-white slip, monospace like a till's. */
function drawing(receipt) {
  return `(async () => {
    const r = ${JSON.stringify(receipt)}
    const scale = 2
    const width = 300
    const line = 22
    const height = 238 + r.lines.length * line + 46
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const g = canvas.getContext('2d')
    g.scale(scale, scale)
    g.fillStyle = '#fbfaf7'
    g.fillRect(0, 0, width, height)
    // A torn edge at the foot, the one thing that says "slip of paper".
    g.fillStyle = '#e9e6df'
    for (let x = 0; x < width; x += 10) {
      g.beginPath(); g.moveTo(x, height); g.lineTo(x + 5, height - 6); g.lineTo(x + 10, height); g.fill()
    }
    g.fillStyle = '#26241f'
    const mono = (size, weight = 400) => { g.font = weight + ' ' + size + 'px "Courier New", Consolas, monospace' }
    const centre = (text, y) => { g.textAlign = 'center'; g.fillText(text, width / 2, y) }
    const pair = (left, right, y) => {
      g.textAlign = 'left'; g.fillText(left, 24, y)
      g.textAlign = 'right'; g.fillText(right, width - 24, y)
    }
    const rule = (y) => {
      g.save(); g.strokeStyle = '#8d877b'; g.setLineDash([3, 3]); g.beginPath()
      g.moveTo(24, y); g.lineTo(width - 24, y); g.stroke(); g.restore()
    }
    let y = 46
    mono(20, 700); centre(r.shop.toUpperCase(), y)
    y += 24; mono(13); centre(r.address, y)
    y += 34; mono(14)
    const [yy, mm, dd] = r.date.split('-')
    pair(dd + '/' + mm + '/' + yy, r.time, y)
    y += 20; rule(y); y += 30
    for (const each of r.lines) { pair(each.item, each.price, y); y += line }
    y += 4; rule(y); y += 32
    mono(17, 700); pair('TOTAL', r.currency + ' ' + r.total, y)
    y += 36; mono(13); pair('CARD', '**** ' + r.card, y)
    y += 36; centre('THANK YOU', y)
    return canvas.toDataURL('image/png')
  })()`
}

app.whenReady().then(async () => {
  let failed
  try {
    const receipt = JSON.parse(await readFile(join(DEMO, 'receipt.json'), 'utf8'))
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await window.loadURL('data:text/html,<!doctype html><html><body></body></html>')
    const url = await window.webContents.executeJavaScript(drawing(receipt))
    if (!url.startsWith('data:image/png;base64,')) throw new Error('the canvas produced no PNG')
    await writeFile(join(DEMO, 'receipt.png'), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    window.destroy()
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error)
  }
  if (failed !== undefined) await writeFile(join(DEMO, 'receipt.log'), `failed: ${failed}\n`, 'utf8')
  app.exit(failed === undefined ? 0 : 1)
})
