/**
 * **What the server and the frame agree on** (M41 U1): one address, one media
 * type, and where in a tool's result the document travels.
 *
 * An MCP App (SEP-1865) is a tool whose definition names a `ui://` resource;
 * a client that draws them reads that resource — an HTML page — and draws it
 * in a sandboxed frame beside the tool's result, then hands the frame the
 * result. A client that does not draws nothing and shows the text, which is
 * the same answer `format_rows` gives.
 *
 * Pure data and no import, so both sides take it: `src/plugin/` runs in Node
 * and the frame in a browser, and neither may reach into the other.
 */

/** The page the server serves, and the one a tool's `_meta.ui.resourceUri` names. */
export const SHEET_URI = 'ui://emerald/sheet.html'

/** The media type an MCP App's page is served as. The spec's, verbatim. */
export const APP_MIME = 'text/html;profile=mcp-app'

/**
 * The key in a tool result's `_meta` that says which document the page draws
 * and how to fetch it (`SheetPayload`) — **never the document itself** (M41
 * F2, D-446): the page fetches that with `frame_copy`.
 *
 * **`_meta` rather than `structuredContent`**: the spec keeps both out of the
 * model's context only as guidance, and `_meta` is the one no client is
 * expected to show a model.
 */
export const SHEET_META = 'emerald/sheet'

/**
 * The capability a client that draws MCP Apps advertises (SEP-1865), under
 * `capabilities.extensions`, with the media types it draws. **Nothing turns on
 * it any more** (M41 F2, D-446): VS Code's chat drew a page without saying it
 * in the form M41 U2 read, so the server logs what each client advertised and
 * hands every client the same answer.
 */
export const UI_EXTENSION = 'io.modelcontextprotocol/ui'

/**
 * Which of the engine's views the frame opens on (M41 U2) — the ones the app
 * routes for a format, chosen by the format's own views, and `start`, which is
 * `start_here`'s picture: the roadmaps the ready rows fold under, then what is
 * ready. An entry is not opened from a tool; it is a row clicked in any of them.
 */
export type FrameView = 'sheet' | 'board' | 'roadmap' | 'ready' | 'start' | 'agenda'

export const FRAME_VIEWS: readonly FrameView[] = ['sheet', 'board', 'roadmap', 'ready', 'start', 'agenda']

/**
 * What travels under `SHEET_META`: which document and which view (M41 F2).
 * **Never how to fetch it** (M41 F3, D-447): VS Code passes a view the result
 * without its `_meta`, so the frame takes what to draw from the call's input
 * and reads this only where the input did not come; the proof that the caller
 * is the drawn view is `KEY_META`, in the page.
 */
export interface SheetPayload {
  /** The file's name, as the app's title would say it. */
  readonly name: string
  /** The declared format to draw; empty for `start`, which draws several. */
  readonly format: string
  /** The view to open on. Absent is the sheet, which is what M41 U1 sent. */
  readonly view?: FrameView
  /**
   * The file's absolute path, as the tools take it, and its resource URI
   * (M44 U2's `file://` URI) — what the frame names in `frame_copy` to fetch
   * the document, and subscribes to, to be drawn again when it changes (M44 U4).
   */
  readonly path: string
  readonly uri: string
  /**
   * The rows asked for (M44 U6): `show_format`'s `match` and `search`, which
   * the frame writes into the address it opens on. Read only where the input
   * did not come, as the rest of this is.
   */
  readonly match?: Readonly<Record<string, unknown>>
  readonly search?: string
  /** Which columns each format's lines draw (M37 U5): `show_format`'s `columns`, also written into the address. */
  readonly columns?: Readonly<Record<string, readonly string[]>>
}

/**
 * **The page carries the proof, not the result** (M41 F3, D-447): the server
 * writes a key it makes at start into the page it serves, as
 * `<meta name="emerald-frame-key" content="…">`, and `frame_copy` hands the
 * document only to a caller presenting it. A host reads the page with
 * `resources/read` and draws it; no host puts that in a model's context.
 */
export const KEY_META = 'emerald-frame-key'

/**
 * How `frame_copy`'s refusal of a caller without the key begins, so the frame
 * can tell it from any other failure and say what it means to a person: the
 * page came from an Emerald that has since restarted.
 */
export const NOT_THIS_VIEW = 'frame_copy answers only a view drawn in the conversation'

/**
 * **The frame's own tool** (M44 U4, M41 F2): the document, or word that it has
 * not changed since a stamp. Visible to the app and never to the model
 * (`_meta.ui.visibility: ["app"]`), listed to every client, and refused
 * without the key the page carries (M41 F3). Its answer is a `CopyPayload` in
 * `structuredContent`, which a host passes on where it may drop `_meta`.
 */
export const COPY_TOOL = 'frame_copy'

/**
 * Where `frame_copy`'s answer rode until M41 F3 — `_meta` — read by the frame
 * still where `structuredContent` did not come.
 */
export const COPY_META = 'emerald/copy'

/**
 * What `frame_copy` hands back: the stamp, and the bytes only when it moved —
 * and since M41 F3 the file's name and URI, which the frame no longer has from
 * the result.
 */
export interface CopyPayload {
  readonly stamp: string
  readonly name?: string
  readonly uri?: string
  /** Base64; absent when the file is still the one `since` named. */
  readonly bytes?: string
}
