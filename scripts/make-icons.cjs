/**
 * The two icons an installed app needs, cut from `src/ui/emerald.svg` (D-123).
 *
 *   npm run icons     ->  build/icon.png · icon.ico · icon.icns
 *                         build/document.png · document.ico · document.icns
 *
 * The application icon *is* the mark. The document icon is a page with the mark
 * on it, composed here rather than kept as a second file, so there is still one
 * source for the shape: change `emerald.svg` and both icons follow.
 *
 * **Electron is the rasterizer**, which is why this script runs under it rather
 * than under Node. Chromium is already in this repo and it renders SVG exactly
 * as the app's own window does; the alternative was a native image dependency
 * for the sake of a dozen PNGs. `.ico` and `.icns` are then assembled by hand —
 * both formats are a header and a table of offsets around payloads that may be
 * PNG, which is a page of code rather than another package.
 *
 * **`.cjs`, and that is not a leftover.** Electron's main process hangs on
 * `app.whenReady()` when the entry is an ES module: the promise never settles
 * and the process sits there with no window and no error. Every other script in
 * this folder is `.mjs` because every other script runs under Node.
 *
 * The check at the end is the point of doing it this way: every file written is
 * read back through the operating system's own icon decoder, so a malformed
 * container fails here rather than showing up as a blank page in Explorer.
 */

const { app, BrowserWindow, nativeImage } = require('electron')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const BUILD = join(ROOT, 'build')
const MARK = join(ROOT, 'src', 'ui', 'emerald.svg')

/** What an `.ico` may hold: 256 is the format's ceiling, and 0 means 256. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** The PNG-carrying `icns` types, and the square each one means. */
const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]

/** The largest thing anything asks for. */
const MASTER = 1024

async function markBody() {
  const svg = await readFile(MARK, 'utf8')
  const opening = svg.indexOf('>')
  const closing = svg.lastIndexOf('</svg>')
  return svg.slice(opening + 1, closing)
}

/** The application icon: the mark, edge to edge, on nothing. */
function applicationSvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MASTER}" height="${MASTER}" viewBox="0 0 64 64">${body}</svg>`
}

/**
 * The document icon: a page, a folded corner, and the mark.
 *
 * Drawn to be legible at 16px, which is the size Explorer and Finder actually
 * use in a list — so the page is a plain silhouette with one fold, and the mark
 * takes 40% of the width rather than sitting decoratively in a corner.
 */
function documentSvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MASTER}" height="${MASTER}" viewBox="0 0 512 512">
  <path d="M124 48 H308 L408 148 V444 a20 20 0 0 1 -20 20 H124 a20 20 0 0 1 -20 -20 V68 a20 20 0 0 1 20 -20 Z"
        fill="#FFFFFF" stroke="#C8CFD6" stroke-width="8" stroke-linejoin="round"/>
  <path d="M308 48 L408 148 H308 Z" fill="#DFE5EA"/>
  <g transform="translate(144 160) scale(3.5)">${body}</g>
</svg>`
}

/**
 * Draws the SVG onto a canvas *inside* the page and reads the PNG back out.
 *
 * Not `capturePage`: a screenshot of a window comes out at the display's scale
 * factor, needs the window transparent and composited, and on an offscreen
 * window never returns at all. A canvas is the renderer doing exactly what it
 * is for, at exactly the size asked for, with the alpha channel intact.
 */
function rasterizer(window) {
  return async function pngAt(svg, size) {
    const url = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image()
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)})
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = ${size}
      canvas.height = ${size}
      canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size})
      return canvas.toDataURL('image/png')
    })()`)

    if (!url.startsWith('data:image/png;base64,')) throw new Error('the canvas produced no PNG')
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  }
}

/**
 * ICONDIR, then one 16-byte ICONDIRENTRY per image, then the PNGs. A byte of 0
 * for width or height means 256, which is why the format stops there.
 */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length

  images.forEach(({ size, png }, index) => {
    const at = index * 16
    directory.writeUInt8(size >= 256 ? 0 : size, at)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1)
    directory.writeUInt8(0, at + 2)
    directory.writeUInt8(0, at + 3)
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })

  return Buffer.concat([header, directory, ...images.map((image) => image.png)])
}

/** `icns`, a total length, then typed chunks whose length includes their header. */
function encodeIcns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })

  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 4, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

async function write(pngAt, name, svg) {
  const ico = []
  for (const size of ICO_SIZES) ico.push({ size, png: await pngAt(svg, size) })

  const icns = []
  for (const [type, size] of ICNS_TYPES) icns.push({ type, png: await pngAt(svg, size) })

  await writeFile(join(BUILD, `${name}.png`), await pngAt(svg, MASTER))
  await writeFile(join(BUILD, `${name}.ico`), encodeIco(ico))
  await writeFile(join(BUILD, `${name}.icns`), encodeIcns(icns))

  // Read back before anything ships. A container this script got wrong is a
  // blank page in Explorer, weeks later, on somebody else's machine.
  const report = []
  for (const extension of ['png', 'ico', 'icns']) {
    const file = join(BUILD, `${name}.${extension}`)

    // `.icns` is a macOS format and Chromium will not decode one anywhere else,
    // so away from a Mac it is checked structurally instead — every chunk a
    // PNG, every length adding up. A decoder is the better check where there
    // is one, and this is the honest check where there is not.
    if (extension === 'icns' && process.platform !== 'darwin') {
      report.push(`${name}.icns ${walkIcns(encodeIcns(icns))} chunks (structure only, not macOS)`)
      continue
    }

    const loaded = nativeImage.createFromPath(file)
    if (loaded.isEmpty()) throw new Error(`${file} is not readable as an image`)
    const { width, height } = loaded.getSize()
    report.push(`${name}.${extension} ${width}x${height}`)
  }
  return report
}

/** Walks an `icns` and throws unless every chunk is a whole PNG. */
function walkIcns(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'icns') throw new Error('icns: wrong magic')
  if (buffer.readUInt32BE(4) !== buffer.length) throw new Error('icns: declared length is wrong')

  let at = 8
  let chunks = 0
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at + 4)
    if (length < 8 || at + length > buffer.length) throw new Error('icns: a chunk runs off the end')
    const payload = buffer.subarray(at + 8, at + length)
    if (payload.readUInt32BE(0) !== 0x89504e47) throw new Error('icns: a chunk is not a PNG')
    at += length
    chunks += 1
  }
  return chunks
}

app.whenReady().then(async () => {
  const lines = []
  try {
    await mkdir(BUILD, { recursive: true })

    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await window.loadURL('data:text/html,<!doctype html><html><body></body></html>')
    const pngAt = rasterizer(window)
    const body = await markBody()

    lines.push(...(await write(pngAt, 'icon', applicationSvg(body))))
    lines.push(...(await write(pngAt, 'document', documentSvg(body))))

    // The desktop extension's icon (scripts/mcpb.mjs): the mark at the 512 its packer asks for.
    await writeFile(join(BUILD, 'extension.png'), await pngAt(applicationSvg(body), 512))
    const extension = nativeImage.createFromPath(join(BUILD, 'extension.png'))
    if (extension.isEmpty()) throw new Error('build/extension.png is not readable as an image')
    lines.push(`extension.png ${extension.getSize().width}x${extension.getSize().height}`)
    window.destroy()
  } catch (error) {
    lines.push(`failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Written rather than logged: a packaged Electron on Windows has no console
  // to write to, and this script is run from one.
  await writeFile(join(BUILD, 'icons.log'), `${lines.join('\n')}\n`, 'utf8')
  app.exit(lines.some((line) => line.startsWith('failed')) ? 1 : 0)
})
