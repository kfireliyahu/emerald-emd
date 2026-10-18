/**
 * Asking a PDF's embedded fonts what their own glyphs say, when the document's
 * `ToUnicode` map lies about them.
 *
 * **The failure this exists for.** A subsetted Hebrew font arrived with a
 * `ToUnicode` table that is a *subsetter's boilerplate Latin table* — it maps
 * code 0x99 to `∑`, 0x9a to `∏`, 0x9c to `∫`, and so on down a MacRoman-ish
 * list — while the glyphs those codes actually select are Hebrew letters. Every
 * reader in the world obeys the document and prints `ª»«¬ª »≈` where the page
 * shows `מס הכנסה`. It is not pdf.js being wrong; it is the file being wrong
 * about itself.
 *
 * **And the file also contains the correction.** The embedded font program
 * carries its own `cmap`, which says which Unicode character each glyph *is* —
 * on the measured slip, all twenty-seven Hebrew letters, correctly. So the
 * document contradicts itself, and one of the two statements is made by the
 * font that drew the shapes. That one wins.
 *
 * **pdf.js cannot hand this over**, which is why the PDF is opened a second
 * time here. It sanitises every font it loads and rebuilds the `cmap` from the
 * `ToUnicode` it was given — so by the time a font object reaches the page, the
 * evidence has been overwritten by the thing it would have corrected.
 *
 * Deliberately narrow: this reads `cmap` tables out of font programs and
 * nothing else. It is not a PDF parser, it does not resolve the cross-reference
 * table, and it never has to — a font program is always a stream object of its
 * own, so finding one is finding an inflated stream that begins with an sfnt
 * signature.
 */

/** What one embedded font says its glyphs are: glyph id → the character. */
export type GlyphChart = ReadonlyMap<number, string>

/** The sfnt signatures: TrueType, the older Apple spelling, and CFF-flavoured. */
const SFNT = new Set([0x00010000, 0x74727565, 0x4f54544f])

/**
 * Every embedded font's glyph chart, in the order the fonts appear.
 *
 * Order is all the association there is: this does not know which chart belongs
 * to which font on the page, and does not need to — the caller tries each and
 * keeps the one that produces words. That is a cheap loop over four fonts and
 * it avoids resolving object references, which is where a real PDF parser
 * starts.
 */
export async function glyphChartsFromPdf(bytes: Uint8Array): Promise<readonly GlyphChart[]> {
  const charts: GlyphChart[] = []

  for (const stream of streamsIn(bytes)) {
    // Compressed is the ordinary case; a font embedded with no filter at all is
    // legal and some producers do it, so the raw bytes are tried too.
    const font = isSfnt(stream) ? stream : await inflate(stream)
    if (font === undefined || !isSfnt(font)) continue

    const chart = glyphChartOf(font)
    if (chart !== undefined && chart.size > 0) charts.push(chart)
  }

  return charts
}

/**
 * The byte ranges between `stream` and `endstream`.
 *
 * A byte scan, because the alternative is the cross-reference table and every
 * way a PDF can hide one — a compressed xref, an object stream, an incremental
 * update, a file with a broken table that every reader repairs by scanning
 * anyway. What is wanted here is a handful of font programs, and a font program
 * is a stream whose bytes announce themselves.
 */
function* streamsIn(bytes: Uint8Array): Generator<Uint8Array> {
  const keyword = [0x73, 0x74, 0x72, 0x65, 0x61, 0x6d] // "stream"
  const end = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d] // "endstream"

  for (let at = 0; at + keyword.length < bytes.length; at++) {
    if (!matches(bytes, at, keyword)) continue
    // "endstream" contains "stream"; skip the tail of one.
    if (at >= 3 && matches(bytes, at - 3, [0x65, 0x6e, 0x64])) continue

    let begin = at + keyword.length
    if (bytes[begin] === 0x0d) begin++
    if (bytes[begin] === 0x0a) begin++

    let stop = indexOf(bytes, end, begin)
    if (stop < 0) return
    const after = stop
    // The end-of-line a writer puts between the data and `endstream` is not
    // part of the data, and `DecompressionStream` calls it trailing junk and
    // refuses the whole stream over it.
    while (stop > begin && isEol(bytes[stop - 1])) stop--
    yield bytes.subarray(begin, stop)
    at = after
  }
}

function isEol(byte: number | undefined): boolean {
  return byte === 0x0d || byte === 0x0a
}

function matches(bytes: Uint8Array, at: number, needle: readonly number[]): boolean {
  for (let i = 0; i < needle.length; i++) if (bytes[at + i] !== needle[i]) return false
  return true
}

function indexOf(bytes: Uint8Array, needle: readonly number[], from: number): number {
  for (let at = from; at + needle.length <= bytes.length; at++) {
    if (matches(bytes, at, needle)) return at
  }
  return -1
}

/**
 * Zlib, through the platform's own decompressor.
 *
 * `DecompressionStream` is in both the shell's Chromium and Node, so no
 * dependency is added for this — and a stream that does not inflate is simply
 * not a font, which is the ordinary case for most streams in a PDF.
 */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  const Decompressor = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream
  if (Decompressor === undefined) return undefined

  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      // Copied rather than enqueued in place: a subarray of the whole PDF is
      // typed as a view over an `ArrayBufferLike`, and the stream wants a view
      // over an `ArrayBuffer`.
      const copy = new Uint8Array(bytes)
      const source = new ReadableStream<BufferSource>({
        start(controller) {
          controller.enqueue(copy)
          controller.close()
        },
      })
      const stream = new Response(source.pipeThrough(new Decompressor(format)))
      return new Uint8Array(await stream.arrayBuffer())
    } catch {
      // Not this format, or not compressed at all. Try the next.
    }
  }
  return undefined
}

function isSfnt(font: Uint8Array): boolean {
  if (font.length < 12) return false
  return SFNT.has(new DataView(font.buffer, font.byteOffset, font.byteLength).getUint32(0))
}

/** Glyph id → character, inverted out of the font's own Unicode `cmap`. */
function glyphChartOf(font: Uint8Array): GlyphChart | undefined {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)

  let cmapAt = -1
  try {
    const count = view.getUint16(4)
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16
      const tag = String.fromCharCode(font[at] ?? 0, font[at + 1] ?? 0, font[at + 2] ?? 0, font[at + 3] ?? 0)
      if (tag === 'cmap') cmapAt = view.getUint32(at + 8)
    }
  } catch {
    return undefined
  }
  if (cmapAt < 0 || cmapAt >= font.length) return undefined

  const chart = new Map<number, string>()
  try {
    const subtables = view.getUint16(cmapAt + 2)
    for (let i = 0; i < subtables; i++) {
      const at = cmapAt + 4 + i * 8
      const platform = view.getUint16(at)
      const encoding = view.getUint16(at + 2)
      // Unicode subtables only. A (1,0) Macintosh table is a byte encoding and
      // says nothing about what a glyph means.
      const unicode =
        (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0
      if (!unicode) continue

      const sub = cmapAt + view.getUint32(at + 4)
      if (view.getUint16(sub) !== 4) continue
      readFormat4(view, font, sub, chart)
    }
  } catch {
    return undefined
  }

  return chart
}

/**
 * Format 4, which is what every subsetted TrueType carries.
 *
 * The first character to claim a glyph keeps it: a font may map two code points
 * to one shape — a Hebrew letter and its presentation form — and the earlier is
 * the one a reader wants back.
 */
function readFormat4(
  view: DataView,
  font: Uint8Array,
  sub: number,
  chart: Map<number, string>,
): void {
  const segments = view.getUint16(sub + 6) / 2
  const ends = sub + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const ranges = deltas + segments * 2

  for (let segment = 0; segment < segments; segment++) {
    const end = view.getUint16(ends + segment * 2)
    const start = view.getUint16(starts + segment * 2)
    const delta = view.getInt16(deltas + segment * 2)
    const rangeOffset = view.getUint16(ranges + segment * 2)
    if (start === 0xffff) continue

    for (let code = start; code <= end; code++) {
      let glyph: number
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff
      } else {
        const at = ranges + segment * 2 + rangeOffset + (code - start) * 2
        if (at + 1 >= font.length) continue
        glyph = view.getUint16(at)
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff
      }
      if (glyph !== 0 && !chart.has(glyph)) chart.set(glyph, String.fromCodePoint(code))
    }
  }
}
