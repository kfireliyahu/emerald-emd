---
type: spec
project: Emerald
---

# 02 — Architecture

A desktop-first web app, shipped inside an Electron shell. No backend, no accounts, and no
network call (D-308). One codebase produces `dist/` — which the shell serves
over `app://`, and which is also a static site for local use.

## The constraint that shaped everything, and the choice it left behind

For most of this project's life the second output was a **single self-contained HTML file**,
opened from `file://`. **IndexedDB is blocked on `file://` in Chrome** — each local file gets a
unique opaque origin, so browser-database storage was unavailable there. Being document-based was
not chosen; it was the only thing left.

**That output is retired** (D-133) and the constraint went with it. What did not go is the model
it forced, because the model was right:

> **Your data is a file you own.** You open it, you work, you save it. Like the spreadsheet
> this replaces — except the app understands what's in it.

For a finance app whose entire pitch is local-first data ownership, a portable database file is
a better artifact than an invisible browser store. It backs up, syncs through a sync folder, opens in
any SQLite tool, and survives clearing your browser.

## Two runtime modes, one codebase

| | **Shell mode** | **Hosted mode** |
|---|---|---|
| How it's opened | The desktop app, or a double-click on a `.emd` | Static site over `https://` or `localhost` |
| Who uses it | Everyone, including you | You, when you are working on the app itself |
| Database | SQLite in memory (sql.js) | Same |
| Durability | Silent Save, written as a sibling and renamed over the document (D-127) | Explicit Save, silent where the File System Access API exists |
| Noticing an outside change | A watch on the document's **directory**, pushed to the page (D-127) | An mtime check on window focus, where there is a handle to check (D-103) |
| Crash recovery | localStorage snapshot | Same |
| Save discipline | The app writes it, debounced on idle (D-155); the indicator reports rather than warns | The same where the File System Access API has a handle; a download-only browser still asks |

Both modes run identical application code — the renderer is `dist/` unchanged, served from a
registered `app://` scheme so it keeps a real origin (D-126). Storage is one interface with
**three** adapters chosen at startup by feature detection — **not** by a build flag, so every
path gets exercised: `desktop` when the shell's bridge is there, `file-system` when the browser
has the File System Access API, `download` otherwise.

**The mode that retired is the third one**, and it is worth naming so nobody re-derives it:
`file://`, the single HTML, no handle to save through and no way to watch anything. Its
constraints are in D-133 and its adapter was never separate — it was `download`.

**A fourth adapter auto-persisting to IndexedDB is still not built**, and is in no hurry. D-021
planned it for hosted mode; it would give the two modes genuinely different durability stories,
and the user who opens the same document in both would learn two different answers to "is my
work safe". The crash snapshot is written after **every mutation**, not on a 30-second timer,
which covers the case that timer existed for at a fraction of the complexity.

## The stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | |
| UI | React 18 | Largest ecosystem, and the app is form-and-table heavy, which React is good at |
| Build | Vite | Fast dev loop; one config produces the app, the plugin server and the shell |
| Database | **sql.js** (SQLite compiled to WebAssembly) | Keeps every schema, query, and migration decision in [04 Data Model](./04-data-model.md) intact. Statistics stay SQL aggregations. The saved file is a real `.sqlite`. |
| Spreadsheet reading | **SheetJS** (`xlsx`) | Reads `.xlsx`, `.xls`, `.csv` in the browser. Replaces the entire Apache POI + platform-seam problem. |
| Styling | Tailwind CSS v4 with a CSS-variable token layer | CSS-first config, no config file, purges to almost nothing. Suits a token-driven monochrome system. See [11 UI Design Language](./11-ui-design-language.md). |
| State | Zustand | Small, no boilerplate, no context gymnastics |
| Routing | React Router with **HashRouter** | Path routing broke on `file://`, and there is nothing behind `app://` to resolve one either. Kept as a choice (D-133). |
| Charts | **Hand-rolled SVG**, scales and paths included | Six simple chart types. Any charting library would fight the design language rather than serve it. |
| Dates | `src/core/time.ts` — calendar parts, never `Date` (D-023) | No timezone surprises for date-only values |
| IDs | `crypto.randomUUID()` | Available in every target browser |
| Tests | Vitest | Same config as Vite |

**Target browser: current Chrome or Edge on desktop.** Stating this plainly removes a large
amount of defensive work. Safari and Firefox should function; they lose the File System Access
niceties and fall back to download-based saving.

## Layers

```
┌───────────────────────────────────────────────────────────┐
│  ui/       React components and screens                   │
└──────┬─────────────────────┬──────────────────────┬───────┘
       │ store selectors     │ plain calls          │ plain calls
┌──────▼──────────┐   ┌──────▼───────────┐          │
│  state/         │   │  data/           │◄─────────┘
│  the open       │──►│  repositories,   │
│  document       │   │  importer, SQL,  │
└─────────────────┘   │  storage         │
                      └──────┬───────────┘
                             │ types and pure functions
                      ┌──────▼───────────┐
                      │  domain/ + core/ │
                      │  no React, no    │
                      │  sql.js, no DOM  │
                      └──────────────────┘
```

**pdf.js is loaded on demand and never eagerly** (D-141). `data/importer/pdfText.ts` is the only
file that imports it, through a dynamic `import()`, so it is two chunks nobody who never opens a
payslip fetches — and it runs on the main thread, because the shell's CSP has no `worker-src` in it
and widening that header is the trade D-124 refuses.

**The one dependency rule that matters: `domain/` and `core/` import nothing from React, sql.js,
or the DOM.** That is what makes them testable in Vitest with no setup, and it is enforced by
review rather than by tooling.

The rest is deliberately flatter than the original drawing. **A screen calls a repository
directly** — `Transactions.tsx` imports `listTransactions` — rather than going through the store
or through a use-case layer. `state/` holds exactly one store, the open document, because that
is the only state genuinely shared between screens; everything else is read fresh from SQLite on
the store's `revision` counter, which at this data size is cheaper than keeping a second copy
correct. There is **no `ports/` layer**: repositories take a `Database` and export plain
functions, and an interface with exactly one implementation and no test double asking for a
second would be indirection charging rent. See D-044.

## The storage adapter

The only place the two runtime modes differ. One interface:

- `load()` — read a database into memory
- `save(bytes)` — persist it
- `canSaveSilently` — whether saving is silent or needs a user gesture, and therefore whether the app may write on its own (D-155)
- `describe()` — what the UI tells the user about where their data is

Three implementations, all built, plus a snapshot that is not an adapter:

| Adapter | Available when | Behavior |
|---|---|---|
| `DesktopAdapter` | The shell's bridge is present (D-127) | A real path. Save writes a sibling and renames over the document; a watch on the directory reports an outside change without waiting for focus. |
| `FileSystemAdapter` | Chrome/Edge, File System Access API present | Keeps a file handle. "Save" writes silently to the same file. |
| `DownloadAdapter` | Any browser | Load via `<input type="file">`, save via a download. Always works. |
| ~~`IndexedDbAdapter`~~ | Hosted mode only | **Not built.** See the note under "Two runtime modes". |

`crashCache.ts` is the third piece and is deliberately not an adapter: it writes a localStorage
snapshot after every mutation and offers it back on startup when it is newer than anything on
screen. It is a recovery path, not a place the document lives — restoring is always offered,
never silent, because the snapshot may be from a session the user abandoned on purpose.

## Data flow: importing a statement

```
User picks file (<input type="file"> or drag-and-drop)
   → SheetJS reads bytes → SheetTable (rows of typed cells)
   → header signature computed → matching saved ImportMapping?
        yes → apply it (mapper skipped)
        no  → guess header row + column roles → user confirms in the mapper → mapping saved
   → mapping applied → raw rows
   → normalize: Money, dates, cleaned merchant names
   → dedupe by natural key
   → categorization rules assign categories + record the matched rule
   → judged in memory on Home's Read files: printed total, running balance (D-313)
   → a sheet that adds up is ticked; one that does not shows its gap and failed rows
   → Write: staged, new rows accepted and committed inside one SQL transaction
   → storage adapter persists
```

Everything from `SheetTable` onward is pure and unit-testable from a fixture file.

**The `expect`/`actual` seams from the previous plan are gone.** File input, spreadsheet parsing,
and database access are all just browser APIs now. That was three of the hardest pieces of
infrastructure in the old design.

## Persistence rules

Unchanged from the SQLite-based original, because the database is still SQLite:

- UUID primary keys generated in the domain, not by the database.
- `created_at` / `updated_at` (epoch millis, UTC) on every table.
- Soft delete (`deleted_at`) on anything the user can remove and would regret removing.
- Numbered, additive migrations. A `schema_version` row; migrations run on load, in order,
  inside a transaction. **A file saved by a newer version must refuse to open in an older one**
  with a clear message rather than corrupting itself.

## Save model

Getting this right is what makes a document-based app tolerable:

- A persistent indicator in the title bar — never a modal. Since D-155 it says what happened
  rather than what is wrong: *unsaved → saving… → saved 14:32*.
- **The app writes the document itself**, debounced on idle with a ceiling, **only where a path
  already exists** (D-155). It never creates a file — a new document stays unsaved until *Save as*
  names it, because a document with nowhere to write is the decision D-115 protects and not a gap
  to fill. It refuses into the external-change notice rather than overwriting (D-092, D-127), and
  the download adapter is untouched and says so.
- `Ctrl/Cmd+S` saves, and still does exactly what it did. With a file handle, silently; otherwise
  it downloads.
- Autosave a snapshot to localStorage **after every mutation** — D-021 said every 30 seconds and
  the implementation went further, because the most expensive thing to lose is a just-committed
  import and a timer can miss it by 29 seconds. On startup, if the snapshot is newer than the
  last save, offer to restore. Never restore silently.
- `beforeunload` warning when there are unsaved changes — in a browser. In the shell it cancels
  the close without showing anything, so the shell asks in a native box instead, on a dirty flag
  the renderer pushes (D-128).
- The filename carries a date so accidental overwrites are recoverable:
  `untitled-2026-08.emd` — no pack's word, because a new document keeps none (M38 F1).

## Error handling

- Domain operations that can fail return a typed result, not a thrown exception. Import errors
  are the main case and must be displayable **per row**.
- One bad row must never abort a 400-row statement.
- An error boundary at the screen level catches everything unexpected, keeps the app alive, and
  — critically — offers to save the database before anything else. **Built in D-116's audit** as
  `src/ui/ScreenBoundary.tsx`, inside `main` so the title bar and the sidebar survive a screen
  that throws; this note specified it long before it existed, and the app answered a render error
  with a white window until then.

## Performance

- 10 years ≈ 60k transactions. **Measured** (D-118, `src/data/scale.test.ts`): every screen's read
  is double-digit milliseconds except the monthly report at ~390ms, save and open are ~5ms each,
  and importing all 60k in one transaction is ~3.2s. The document is ~26MB.
- **No Web Worker.** sql.js runs on the main thread and stays there: nothing measured blocks the
  UI, and the trigger this note used to name — "if a heavy query ever blocks the UI" — now has a
  number behind it rather than a guess. `scale.test.ts` fails if any read crosses one second on a
  quiet machine — twelve passes over the table, so the ceiling stretches with load (D-347) — which
  is the alarm that would change this line. The nearest is the monthly report, ~0.69s at 60k rows.
- **Statistics are SQL aggregations, never rows loaded into JS**, and that is the rule the
  measurement exists to police rather than a style preference. The one breach it found cost 613ms
  on the home dashboard: `installmentCommitment` built an object per outflow in the document to
  keep the few percent that were installment slices, on a document with no debts in it.
- `dist/` is **4 MB across three chunks**: 2.3 MB of app including the wasm and the fonts, and
  1.7 MB of pdf.js that is only fetched when somebody opens a payslip PDF (D-141). Under 5 MB was
  an enforced budget while the single file existed; it is **kept by hand** now (D-133), with
  `chunkSizeWarningLimit` in `vite.config.ts` as the tripwire rather than the rule.

## Distribution

**The shipping target is the desktop app** (D-115), unsigned on both platforms (D-124), and the
single HTML that preceded it is gone (D-133).

| Output | Command | Use |
|---|---|---|
| The app | `vite build` → `dist/` | What the shell serves over `app://`, and a static site for `localhost` |
| The shell | `npm run build:electron` → `dist-electron/` | Main and preload, two passes into one directory (D-126) |
| The installers | `npm run dist:win` / `dist:mac` → `release/` | What people download. `electron-builder.yml` registers `.emd` (D-129, D-156). A `v*` tag builds them in CI (`.github/workflows/release.yml`) and publishes them with `SHA256SUMS` and build attestations (D-452) |
| The plugin server | `npm run build:plugin` → `dist-plugin/` | The stdio MCP server every client runs, `server.mjs` (F14), and beside it what only Claude Code runs: `hooks.mjs` and `status-line.mjs`, built from `hosts/claude/` (M42 U6, D-494). Nothing in `src/` imports from `hosts/`, and a host reaches the server only through `src/plugin/host.ts` (`src/plugin/hostBoundary.test.ts`) |
| The conversation's views | `vite build --mode frame` → `.frame/frame.html` | One HTML page the MCP server hands a host that draws views in the conversation (M41, D-431, D-432): `src/frame/`, its script and style inlined, sql.js as asm.js because a frame's CSP refuses wasm. `build:plugin` runs it first and compiles the page into `server.mjs` |
| The demo | `npm run build:demo` → `dist-demo/` | Emerald's page at its root (`index.html`, M33 U8, D-459: `src/demo/page/`), the tour frame beside it (`tour.html`, M33 U2) and the app's screens it plays (`app.html`) over a document the plugin builds at build time — one per tour — with no Open or Save (M33 U1, D-413) |

No CDN references at runtime, and every dependency is bundled. This stopped being a rule kept by
discipline when the shell started blocking every request that is not `app://`, `blob:` or `data:`
(D-124, `electron/network.ts`): **the app works with the network off, and now fails visibly if
someone breaks that** rather than degrading for whoever is offline. M16's opt-in price fetch was
the one request that ever left the machine, and it went with investments (D-308): **the app makes
no network call at all**. The only sockets are the shell's two to a local model runtime on loopback
(`electron/runtimes.ts`, `electron/generate.ts`, D-134, D-136).

**Three of the four `file://` constraints are gone with the single file** — IndexedDB blocked,
inlining, the enforced size budget. **Hash routing stays** and so does **document-based**, both
now as choices; D-115 asked for the second to be kept on purpose and D-133 is where it was.

## The desktop shell

`electron/` is the host, and it sits **beside** `src/` rather than inside it: the renderer it opens
is the same bundle `dist/` has always been (D-126). **`src/` imports exactly one file of it —
`bridge.ts`, the contract** — and nothing else (D-127). Each file opens with what it is for; the
shape is:

- `main.ts` — the window, the `app://` handler that serves `dist/` (containment in `appProtocol.ts`),
  the session guard that cancels every request to anywhere else (`network.ts`, D-124), the CSP, and
  the IPC behind the document API. `preload.ts` is the only opening between the page and Node, and
  `bridge.ts` is what it exposes.
- `documents.ts` — the real filesystem: an atomic write, the watcher on the *directory* (D-127), and
  what counts as a document in `argv`. `recents.ts` holds the documents opened before and their
  grants (D-128); `menu.ts` the menu as a testable template (D-128); `windowChrome.ts` the title
  bar's measurements, shared by the window and the page (D-130); `about.ts` what the About says and
  the one address the shell hands the system browser, the repository, on Help → Source Code (D-452).
- `runtimes.ts` and `generate.ts` — the only two places in the app that open a socket, to a local
  model runtime on loopback and nowhere else (D-134, D-136); `generate.ts` re-checks the origin
  because it arrives from `localStorage` (D-135).

All but `main.ts`, `preload.ts` and `bridge.ts` are tested without an Electron process; `documents`
and `recents` run against a real temporary directory, because an atomic write and a directory watch
are claims about the operating system. **Built in two passes into one directory**, because a
sandboxed preload cannot require the shared chunk one build with two entries would make.

## What is deliberately absent

- No backend, no API, no accounts, no sync, no telemetry.
- No service worker. The shell serves the app from disk over `app://` and there is nothing to
  cache for offline that is not already there.
- No mobile-first layout. Desktop is the target; see [06 Navigation and Screens](./packs/ledger/06-navigation-and-screens.md).

## Related

[04 Data Model](./04-data-model.md) · [05 Domain Rules and Calculations](./packs/ledger/05-domain-rules-and-calculations.md) · [11 UI Design Language](./11-ui-design-language.md) · [09 Decision Log](./09-decision-log.md)
