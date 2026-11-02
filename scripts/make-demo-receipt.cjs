/**
 * The papers the tours show beside the app (M33 U2, M54 F12): the grocery
 * receipt the custom tour types in, drawn from `fixtures/synthetic/demo/receipt.json`,
 * and the paper timesheet the timesheet tour types in, drawn from the `paper`
 * of `timesheet.json` — each as `<name>.png` and `<name>-dark.png` beside them.
 *
 *   npm run demo:receipt
 *
 * **Drawn, never photographed.** The shop and the job are made up and every
 * figure is round; the receipt's lines add up to its printed total, and the
 * timesheet's two days are the paycheck's gross. Run it again after changing
 * the JSON — the PNGs are committed so a build needs no Electron, and the JSON
 * is what they say.
 *
 * **Drawn for the column they sit in** (M54 F12): at a 1024 px frame the column
 * is about 160 px wide, so a paper is drawn narrow with large type — a figure
 * there is as tall as the app's own text beside it. **Dark is its own paper**,
 * not an inversion (the `ui` rule): a dim slip a step above the page, ink a
 * warm grey rather than white, so it never glares beside a dark app.
 *
 * **Electron is the rasterizer**, as in `make-icons.cjs` and for its reason:
 * Chromium is already in this repo, and a canvas inside the page draws exactly
 * the size asked for. `.cjs` for the same reason too — the main process hangs
 * on `app.whenReady()` when the entry is an ES module.
 *
 * The tour never says the app read these pictures. Each is shown beside the
 * app while the ring types what it says, as a person would.
 */

const { app, BrowserWindow } = require('electron')
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const DEMO = join(__dirname, '..', 'fixtures', 'synthetic', 'demo')

/** The two papers' colours. Pen is what was written on a printed form by hand. */
const INKS = {
  light: { paper: '#fbfaf7', edge: '#e9e6df', ink: '#26241f', rule: '#8d877b', pen: '#1f3f8f' },
  dark: { paper: '#24231f', edge: '#1a1917', ink: '#dedad2', rule: '#77725f', pen: '#a9bdf0' },
}

/** The page-side helpers every drawing shares: one canvas, its width and height in CSS pixels, drawn at 3x. */
const HELPERS = `
  const scale = 3
  const make = (width, height, inks) => {
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const g = canvas.getContext('2d')
    g.scale(scale, scale)
    g.fillStyle = inks.paper
    g.fillRect(0, 0, width, height)
    // A torn edge at the foot, the one thing that says "slip of paper".
    g.fillStyle = inks.edge
    for (let x = 0; x < width; x += 10) {
      g.beginPath(); g.moveTo(x, height); g.lineTo(x + 5, height - 6); g.lineTo(x + 10, height); g.fill()
    }
    g.fillStyle = inks.ink
    const font = (size, weight = 400, face = '"Courier New", Consolas, monospace') => { g.font = weight + ' ' + size + 'px ' + face }
    const centre = (text, y) => { g.textAlign = 'center'; g.fillText(text, width / 2, y) }
    const pair = (left, right, y, margin) => {
      g.textAlign = 'left'; g.fillText(left, margin, y)
      g.textAlign = 'right'; g.fillText(right, width - margin, y)
    }
    const rule = (y, margin, dashed = true) => {
      g.save(); g.strokeStyle = inks.rule; if (dashed) g.setLineDash([3, 3]); g.beginPath()
      g.moveTo(margin, y); g.lineTo(width - margin, y); g.stroke(); g.restore()
    }
    return { canvas, g, font, centre, pair, rule }
  }
`

/** The receipt: a till's slip, monospace, narrow. */
function receiptDrawing(receipt, inks) {
  return `(async () => {
    ${HELPERS}
    const r = ${JSON.stringify(receipt)}
    const inks = ${JSON.stringify(inks)}
    const width = 240
    const margin = 16
    const line = 27
    const height = 258 + r.lines.length * line + 20
    const { canvas, g, font, centre, pair, rule } = make(width, height, inks)
    let y = 38
    font(21, 700); centre(r.shop.toUpperCase(), y)
    y += 24; font(14); centre(r.address, y)
    y += 34; font(16)
    const [yy, mm, dd] = r.date.split('-')
    pair(dd + '/' + mm + '/' + yy, r.time, y, margin)
    y += 16; rule(y, margin); y += 30
    font(18)
    for (const each of r.lines) { pair(each.item, each.price, y, margin); y += line }
    y += 2; rule(y, margin); y += 32
    font(19, 700); pair('TOTAL', r.currency + ' ' + r.total, y, margin)
    y += 38; font(15); pair('CARD', '**** ' + r.card, y, margin)
    y += 38; centre('THANK YOU', y)
    return canvas.toDataURL('image/png')
  })()`
}

/** The timesheet: a printed form, its days filled in by hand — and the 14th's end left empty. */
function timesheetDrawing(paper, inks) {
  return `(async () => {
    ${HELPERS}
    const p = ${JSON.stringify(paper)}
    const inks = ${JSON.stringify(inks)}
    const width = 240
    const margin = 14
    const row = 40
    const height = 180 + p.days.length * row + 14
    const { canvas, g, font, centre, rule } = make(width, height, inks)
    const sans = 'Arial, Helvetica, sans-serif'
    const hand = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'
    // Three columns, each figure centred in its own; the rate is printed once, at the foot.
    const span = (width - 2 * margin) / 3
    const columns = ['DATE', 'START', 'END'].map((label, index) => ({ at: margin + span * (index + 0.5), label }))
    // The hand as large as the widest figure lets it be in its column.
    let size = 20
    for (; size > 12; size -= 1) {
      font(size, 700, hand)
      if (g.measureText('00:00').width <= span - 10 && g.measureText('00/00').width <= span - 10) break
    }
    let y = 36
    font(19, 700, sans); centre(p.title.toUpperCase(), y)
    y += 24; font(14, 400, sans); centre(p.employer, y)
    y += 20; centre(p.month, y)
    y += 20; rule(y, margin, false)
    y += 26; font(12, 700, sans); g.textAlign = 'center'
    for (const column of columns) g.fillText(column.label, column.at, y)
    y += 10; rule(y, margin, false)
    g.fillStyle = inks.pen
    for (const day of p.days) {
      y += row - 10
      const [, mm, dd] = day.date.split('-')
      font(size, 700, hand); g.textAlign = 'center'
      g.fillText(dd + '/' + mm, columns[0].at, y)
      if (day.start) g.fillText(day.start, columns[1].at, y)
      if (day.end) g.fillText(day.end, columns[2].at, y)
      y += 10
      g.fillStyle = inks.ink; rule(y, margin); g.fillStyle = inks.pen
    }
    g.fillStyle = inks.ink
    y += 28; font(14, 400, sans); g.textAlign = 'left'; g.fillText('Rate: ' + p.currency + ' ' + p.rate + ' an hour', margin, y)
    return canvas.toDataURL('image/png')
  })()`
}

app.whenReady().then(async () => {
  let failed
  try {
    const receipt = JSON.parse(await readFile(join(DEMO, 'receipt.json'), 'utf8'))
    const timesheet = JSON.parse(await readFile(join(DEMO, 'timesheet.json'), 'utf8'))
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await window.loadURL('data:text/html,<!doctype html><html><body></body></html>')
    const papers = []
    for (const [theme, inks] of Object.entries(INKS)) {
      const suffix = theme === 'light' ? '' : '-dark'
      papers.push([`receipt${suffix}.png`, receiptDrawing(receipt, inks)])
      papers.push([`timesheet${suffix}.png`, timesheetDrawing({ ...timesheet.paper, currency: timesheet.currency }, inks)])
    }
    for (const [name, drawing] of papers) {
      const url = await window.webContents.executeJavaScript(drawing)
      if (!url.startsWith('data:image/png;base64,')) throw new Error(`the canvas produced no PNG for ${name}`)
      await writeFile(join(DEMO, name), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    }
    window.destroy()
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error)
  }
  if (failed !== undefined) await writeFile(join(DEMO, 'receipt.log'), `failed: ${failed}\n`, 'utf8')
  app.exit(failed === undefined ? 0 : 1)
})
