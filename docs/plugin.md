---
type: feature
project: Emerald
milestone: M7 — complete. F11 no longer follows as M8 (D-116); the plugin is the cloud AI path
status: complete (D-093 through D-104), plus D-109 to D-111 from real use — reads and writes, onboarding and ingestion. The surface has grown four times since and **the count is deliberately not written down here**: it went stale twice, and `TOOLS` in `src/plugin/server.ts` is the list, in one screenful, on purpose (D-109). The app-side mtime check landed with D-103, the categorization evidence with D-104, `create_category` and the wiring with D-109, the batching, the ungating and the server instructions with D-110, F09's detector with D-111, the payslips and funds with D-112, the savings and debts with D-113, and the investments with D-207.
created: 2026-08-13
---

# F14 — Claude Plugin

AI features reached from **Claude**, not from inside the app. A plugin opens the user's
`.emd` file directly, exposes the app's own repositories as tools, and lets the
conversation do the reasoning. The web app gains nothing and loses nothing: no key storage,
no consent flow, no network code, no bundle weight.

This is the alternative route to everything the retired F11 AI Assist
described. The two used to be split by who would install something — F11 for whoever was handed a
single HTML file and never would, F14 for whoever already talks to Claude. **That split is gone**
(D-115, D-116): the single file retired with the desktop shell (D-133), so everyone installs, and F11
stopped being a milestone. **D-124 finished the job** and retired F11 outright: the app has no
remote AI path and will not get one, so this plugin plus the local model of M10/M11 is the whole of
the AI story. The manual paths still carry the app.

> [!note] The shape is settled; the code has started
> Written before any of it existed, to record why it is cheap and where the traps are. Promoted
> from an idea to **M7** on 2026-08-23, with the four decisions it left open now answered
> (D-092): it lives **in this repo** as a third build output, it **writes** without an app-side
> review step, its safety net is a chat diff plus a backup plus provenance, and a write while the
> app is open **warns** rather than refusing.
>
> **Tier 0 is built** (D-093). The bet held with nothing to spare: `src/plugin/` is four files,
> contains no SQL, and reaches the ledger only through `data/repositories/`. The one thing that
> could not be borrowed was a *read-only* way to ask a document its schema version — `migrate`
> creates the table it is about to write to — so `readSchemaVersion` was extracted next to it.
>
> **Tier 1 is built too** (D-094), and the bet held again: seven of the eight shaped tools needed
> nothing new from the layer below, and each goes through the single summary call its screen
> already makes, so a figure in a conversation and the same figure on screen are the same
> arithmetic rather than two answers that agree today. The document is now opened with
> `PRAGMA query_only`, which makes "this is a read tool" a fact SQLite enforces rather than a
> claim the code makes.

## Why it is cheap

**The data layer already runs in Node.** The test suite proves it — repositories are tested
against a real in-memory sql.js instance, outside a browser, through Vite's pipeline. A plugin
is therefore: read the file with `fs` → `new SQL.Database(bytes)` → call the **existing
repositories** → `db.export()` → write back atomically.

Nothing is reimplemented. The rule that `domain/` and `core/` import nothing from React, sql.js,
or the DOM — enforced by review since the beginning — is what makes this a wrapper rather than a
fork. A plugin that hand-rolled its own SQL would put the money rules, the merchant
normalization and the natural key in a second place and let them drift; that version should not
be built.

**The landing zones already exist, inert.** `CategorySource` includes `AI`
(`data/repositories/categoryRepository.ts`) and `RULE_ORIGINS` includes `AI_SUGGESTED`
(`domain/model/rules.ts`), which the engine already ranks. They were specced for F11 and cost
nothing to reuse.

## The shape: confirm in the conversation, and keep the batch reversible

**Superseded.** This section used to read *propose, don't dispose* — the plugin never commits, and
every write lands in a queue the app's review screens already watch. That was the right design for
a plugin nobody had used yet, and it was rejected on the first real reading of it (D-092): a review
queue that must be emptied by hand is the plugin's whole value handed straight back. If
categorizing four hundred merchants from a conversation ends with four hundred rows to confirm on
a screen, nothing was saved.

**So the plugin commits, and the confirmation moves into the conversation** — where Claude shows
what it is about to do and the user answers, which is a real gate in the place the user already
is. What the review queue was protecting against has to be protected against somewhere else, and
it is three things rather than one:

- **A dry run by default.** Every mutating tool computes its change and returns the diff without
  writing. Committing is a second, explicit call. Claude has something concrete to show, and the
  expensive mistake is visible before it is made rather than after. **This one is a property of the
  client, not of this server** — see "What a client that is not Claude does with it" below, where a
  local model committed on the first call. Against Claude Code it holds; the server cannot enforce
  it and does not try (D-114).
  **And a yes covers one dry run** (M34 U1, D-394): the next batch of
  the same shape gets its own, and fewer stops come from a bigger batch shown once, never from a
  commit nobody saw.
- **A backup before any mutating batch.** The plugin copies the document to a `.bak` stamped to
  the millisecond (`<name>.emd.20261009T121112.315.bak`, then `-2` if that is taken) in Emerald's
  own per-user folder of earlier copies, one folder per document, the last five kept, and names
  the full path in its answer (D-455, which moved it from
  beside the document). The desktop app's File › *Earlier copies of this document* lists them and
  restores one — a person's act on a screen, with no tool for it. It costs a file copy. **Each copy
  also sweeps** (D-457): a folder whose recorded document is gone goes
  30 days after its newest copy, the answer says when one did, and the Windows uninstaller takes
  the whole folder; Help › About shows where it is and how large.
  **And a named copy before a large one** (M34 U6, D-399): a read
  or batch of 100 rows or more, or the first rows into an empty document, first keeps
  `<name>.before-<when>-<what>.emd` in the same folder of earlier copies — never beside the document
  since M48 U4 (D-470) — the last three, apart from the rolling five,
  so the copy from before an import survives the writes after it; the answer names its path and the
  File menu lists it, marked as named. `keep_copy` keeps one whenever asked; on a
  screen it is *Back up now* (Document commands), and a large read on `#/formats/<name>/read` keeps one too.
  **A write puts the file back in the shape it was found** (D-246); `store_document_as` (M47 U7)
  is the app's *Save as text* / *Save as SQLite*, dry-run gated and refused with the app's own
  sentence when the text would not carry the document (a ledger). **A rename the app's hold
  refuses is tried again for about a second** (`writeAtomically`, `EPERM`/`EACCES`/`EBUSY`) before
  the answer says the app has the file.
- **Provenance, reinterpreted.** Categories still land as `categorySource = 'AI'` and rules still
  as `origin = 'AI_SUGGESTED'` — but as a **label recording how the row got there**, not as a
  pending state something is waiting to confirm. That is a real change of meaning and it is worth
  saying out loud, because it is what lets a whole batch be found and reversed afterwards without
  a queue. It also keeps the convention that has held since M2: every category is explainable.

The conventions that survive unchanged do so because the plugin writes **through** the existing
functions rather than around them — a user override still wins, and the money rules, the merchant
normalization and the natural key are still written once.

**Rules are the exception that keeps a gate.** A rule is a standing instruction rather than one
row's edit, and it is the only write whose blast radius is the entire history. It lands enabled,
but never before the transactions it would match come back as evidence — which is what makes
confirming it in a conversation an answer rather than a rubber stamp.

**Built, and the gate had to be stronger than a default** (D-099). Dry-running by default is enough
for a row's edit and not for a standing instruction: a default is precisely what a caller can step
past. So `create_rule` issues a **confirmation token** from its preview, bound to the matching row
ids, and refuses to commit without it — which makes "never before the matches come back"
mechanically true rather than aspirational, and makes a token stale the moment the match set moves.

Same argument
F11 AI Assist made about showing a proposal against the user's own
history, arriving through the other door.

**Ingestion commits too, and inherits the app's own refusal.** The plugin runs the existing
pipeline — mapping, dedupe by natural key, total verification — and reports the reconciliation. A
file whose printed total does not reconcile is **refused**.

**One correction to that paragraph, from building it** (D-100): the refusal is *stricter* than the
app, not identical to it. The app shows a mismatch in red on the review screen and lets the user
commit anyway, which is right when they are looking at the rows. From a conversation nobody is
looking at anything, so this refuses by default and takes `ignore_printed_total` to override. The
app's behaviour is not wrong; the two callers are in different positions.

## Traps

**1. The plugin must never migrate.** `openDatabase` migrates upward unconditionally, which is
right inside the app — the code that migrates is the code that renders — and wrong in a plugin.
A user on plugin v1.4 (schema 015) and app v1.2 asks a read-only question and their app then
correctly refuses to open the file via `SchemaTooNewError`. They lose the document to a question.
The plugin reads `schema_version` and **stops** if the file is behind, telling the user to open
it in the app once. Migration stays the app's job, exclusively. This has to be true from the
first commit.

**True from the first commit** (D-093). The plugin does not call `openDatabase` at all; it calls
`openDatabaseWithoutMigrating`, whose name is long on purpose, and `readSchemaVersion`, which is
read-only where `migrate`'s own version check is not — that one creates `schema_version` because
it is about to write to it, and a reader doing the same would leave a footprint in every document
it merely glanced at. It refuses **both** directions, with different advice each way. The test
that carries the trap is not the refusal: it is that the refused file hashes the same afterwards.

**A pack's growth is not a migration** (M36 U02, D-378). Every open, a read or a write, brings
the ledger up to what this build declares — `bringUpToDate` in `data/packs/packs.ts`, the same step
the app takes on open — into the copy in memory. A read never saves it; a write saves it with its
own change, under the lock. So a document made before the latest pack change takes a write with no
app open, and no repository carries a probe for an older shape. An older *text* document is refused
from its header alone: its text is only ever read into this build's own schema.

**2. Two writers, one file.** The app holds the database in memory and overwrites on save, and it
keeps a `FileHandle` with **no mtime check anywhere** — so a plugin write made while the app is
open is silently lost the next time the user hits Save. Sharper now that the plugin really writes.
**Answered (D-092), and the app's half is built (D-103).** The app compares the file's mtime and
size before every save and on every window focus; a save that would overwrite a file changed
underneath it refuses, and offers to reload, to save a copy, or to overwrite deliberately.
Refusing to write while the app is open was rejected — it is app-side friction of exactly the kind
removing the review queue was meant to remove — and the app-side check is worth having on its own
regardless, since two tabs or a sync client cause the same loss with no plugin in sight.
**The plugin's warning is not built**: nothing the app writes says "I am open" — no lock file, no
journal, the document is held in memory — so the warning would be a guess. Left unbuilt rather
than faked.

**3. The privacy contract is a different one — and it is now the only one.**
F11 AI Assist promised minimum-viable payloads: merchant names, no
amounts, no dates, no ledger. Through a plugin, whatever Claude reads enters the user's own
conversation, and "summarize my spending" means the ledger goes with it. That is the user's choice
to make with their own account and a third-party client.

> Since D-124 retired F11 there is no in-app route left for its payload rules to bind. What
> replaces them is simpler and easier to keep: **the app sends nothing about your money, ever** —
> it makes no network call at all since M16's opt-in price fetch went with investments (D-308). The plugin's
> honest line is the one above — the tools make no network calls (a test proves it), and the only
> thing that leaves the machine is what the user puts in the conversation, which is theirs to
> decide. D-120's read-side restraint stands on its own merits and was kept.

**4. The tool surface becomes public.** *Now real: the nine names of tier 1 exist and are asserted
as a list in the tests, so adding or removing one has to be a deliberate line in a diff. It is also
the trap that removed the general `query` (D-095) — the surface is what is exposed, and a query is
everything at once.*
Repositories are internal functions today and get renamed
freely. Once strangers' conversations depend on a tool named `assign_category`, it is an API with
a compatibility cost. Consequence for M7: the tool set is chosen **once, deliberately, and kept
small**, and shaped tools are preferred over a general `query` precisely because a shaped tool can
be reimplemented over a changed schema while a query someone wrote cannot.

**5. The server itself makes zero network calls.** Same standard F11 sets for the app, and worth
a test. The only thing that leaves the machine is what Claude puts in the conversation.

## What the client can do, and what it must not require

Verified against the running client rather than assumed (D-096): **Claude Code advertises
`elicitation: { form: {} }` and `roots`**, and the SDK exposes `server.elicitInput()` with a form
and a URL variant. So a server here can put a real multi-select or a real form in front of the
user, which is worth having for the steps that are a *choice from a list* — picking institutions
most of all.

**It is never a requirement, and that is the rule rather than a caution.** The same probe returned
`action: "cancel"` with nothing interactive attached, which is an everyday outcome and not an
error. So: elicitation is attempted only when the client declares it, every tool takes the same
answers as ordinary arguments, and a cancel, a decline or a client without the capability falls
back to the conversation with nothing lost. `roots` is worth reading for the same class of reason
— to *suggest* where a new document might go, never to decide it.

## A format's views, drawn in the conversation (M41)

**`show_format` is an MCP App** (D-431): its definition names
`ui://emerald/sheet.html`, the server's one listed resource, and a client that draws MCP Apps draws that
page in a sandboxed frame beside the answer. **The page is the app**: `FormatRows` over the store's
own `openBytes`, opening a copy of the file it fetches once drawn (below, M41 F2). Its text names
every row the view shows and nothing longer, which is what a client that draws nothing shows.

- **sql.js runs as asm.js in the frame**, because a frame's default CSP refuses wasm and a page
  cannot ask otherwise. `vite build --mode frame` writes `.frame/frame.html`, script and style
  inline, fonts dropped; `build:plugin` builds it first and compiles it into `server.mjs`.
- **Shipped inside the server** (D-433): the page is a string in
  `server.mjs`, not a separate download, and what it draws is chosen by the document's views —
  **no pack carries UI**. **No request leaves the frame**: one file, every asset inline, under the
  spec's default CSP (`connect-src 'none'`).
- **Which hosts draw it** — MCP Apps is an open extension, and MCP's own extension page and
  client matrix (community-kept, read 2026-10-08) list Claude (web, desktop, and the desktop
  Code tab), ChatGPT, VS Code with GitHub Copilot, Goose and others. **That is reported, not seen
  here** beyond the two below. A web chat draws only from a remote connector, which this server is
  not. **Every other host, and the claude CLI in a terminal, gets the same answer as text.**
  **Seen in a real host, 2026-10-08: VS Code's Copilot Chat (agent mode) on a Windows
  machine draws `show_format` inline as a full frame**, with the server configured in the
  workspace's `.vscode/mcp.json` (gitignored; `node ${workspaceFolder}/dist-plugin/server.mjs
  --engine-only`). **The Claude desktop app's Code tab draws it only from a server the app runs
  itself** — the one its `claude_desktop_config.json` names, here `emerald-ledger`, which it attaches to
  every Code session — **and never from one a project's `.mcp.json` starts**, here `emerald`
  (M51 F1, D-489; the evidence is in the host table under M51 U7
  below). What drew on 2026-10-09 was `emerald-ledger`'s `start_here`. Claude Desktop's own chat on
  Windows showed local servers' views as text only from about 2026-09-22
  (anthropics/claude-ai-mcp#1069 — its bridge drops `_meta.ui`); the issue was still open on
  2026-10-09, and that chat has not been tried here since.

### When a model draws, and what each line is for (M51 F1-F3)

- **When a model draws** is in both instruction blocks, **within their first 2,000 characters**
  (D-482): `show_format` and `start_here` when a person asks to *see*
  something; `format_rows` for rows it will filter, count or reason over. A host may keep only the head
  of the instructions — the desktop Code tab kept 2,038 characters of the engine-only block — and one
  that defers tools shows a model only a tool's name, which is why the tool was renamed from
  `format_sheet` (M43 U11). `server.test.ts` pins both.
- **The answer says first whether anything was drawn** (M51 F1,
  D-489), because neither the model nor this server can see the
  person's screen: on 2026-10-18 a session told the person the ready list was "drawn above" when the
  Code tab had drawn nothing. `show_format`'s and `start_here`'s answers open with one line from what
  the client declared at `initialize` (`drawnLine` in `src/plugin/tools/sheet.ts`): a client that
  advertised `io.modelcontextprotocol/ui` *should* show the view beside the answer; a client without
  it drew nothing, and *if this session has this tool on a server you have not called it on, call it
  there instead* — which is the Code tab's case, where the session's other server is
  `emerald-ledger`. It reads only what the client declared, never its name, so the server stays
  host-neutral (M42 U6). The frame cannot tell the server it was drawn in time for the answer —
  it loads after the answer is sent, and in the desktop app its calls reach the server through the
  app's own client, not the model's — so the line says only what the server knows.
- **A hook's text is not a drawing, and says so first** (M51 F2, D-492).
  After F1 a new session, asked to show what is ready, retyped the `SessionStart`
  hook's `start_here` text as a table: no drawing tool ran on either server, so no `drawnLine` reached
  it. The hook's output now opens with *a hook printed this as text, and nothing was drawn*, and that a
  request to see calls `start_here` or `show_format` instead, on a server the host runs itself where the
  session has one; both instruction blocks say the same before 2,000 characters. Both stay
  host-neutral; that the Claude desktop app's Code tab means `emerald-ledger` is said in `CLAUDE.md`.
- **Both lines are the model's, and the person never hears them** (M51 F3,
  D-493). After F2 the board was drawn, and the session still told the
  person which server it had called and that the server could not check whether a view appeared: a
  line worded as a disclaimer is relayed as one. Each now opens with `FOR_THE_MODEL` — *for you, never
  the person — do not repeat or paraphrase this line* — and is an instruction: where the client draws,
  the view is the answer — say nothing about drawing, views, servers or tools, never retype its rows
  as a list or table (drawn, the session still gave the details as text), and reply with at most a
  line the view does not show, or nothing; the rows stay in the text for the model to reason over and
  for a client that draws nothing; where
  it does not, answer with the rows as text, never call anything drawn or "above", and at most say in
  one plain sentence that it is a list here when a board was asked for. Saying nothing about drawing
  is how F1's protection holds: a model that never mentions a view never claims one that was not
  drawn. Both instruction blocks and `CLAUDE.md` say the same.

### What is drawn, and how the rows reach it (D-432, M41 F2)

- **Every view, read-only, and no control leads nowhere** (D-432):
  the frame routes the app's own format pages at the app's own paths — sheet, entry, board, list (D-519),
  roadmap, ready, and the agenda (D-473) — under `ReadOnly`, and **read-only is where it stays**: edits in the frame (M41
  U3) went to Later on 2026-10-08. `ReadOnly` locks every format as a pack's is locked: no add, no edit, no
  remove, no change of shape. `show_format` takes `view` (one the format has — or, for a
  roadmap, the one its rows fold under: `unit view:roadmap match:{milestone:M9}` draws the
  milestone roadmap at M9 with its units named, M47 U7; or `agenda`, which takes no format, D-473;
  or a saved view's name, `view:"Due today"`, drawn as its kind with its address, D-520 — the frame,
  handed a name it does not know as a view, reads the saved view from the document it fetches), and
  **`match` and `search`, read exactly as `format_rows` reads them** (M44 U6): one
  `filterQuery` (`src/data/repositories/formatFilterRepository.ts`) turns them into the
  `RowQuery` `listRows` answers for both tools and for the app's format screen, so there is no
  second filter. The frame opens on the format's address with the filter in it —
  `#/formats/finding?action=maintainer&state=open&search=bidi`, every key a column held to a value
  but `search`, a `columns:` choice and the table's sort, `order:date=descending`, which the app
  keeps there so an entry opened and left comes back to the table in its order (M42 F14;
  `src/ui/formats/addressFilter.ts`) — or to several, `?state=planned,in_progress`,
  or to none of them, `?state!=built` (M37 U3, D-476) — and every view of the format reads it back,
  says what it is filtered by and how many of how many, offers Clear, and keeps it when the file
  changes and the view is drawn again. The text answer says the same and names the
  `format_rows` call that reads those rows whole. **The app sets the same filter in place**
  (M44 U7): on every view of a format, *Filter by…* names a column and then offers its values
  as ticks (an enum's members, a link's rows by name, the values a column holds), with *is* /
  *is not* and *empty* (M37 U3) — each counted in SQL under the other filters, the same menu a
  table's header opens, an amount held by a range in its currency or unit (`?cost=10..50+ILS`), and
  `format_rows values:<column>` the same counts in a conversation (M37 U4, D-477) — the search box writes
  `search`, × drops one and Clear drops all — into the address, so back, a reload and a bookmark
  keep it. The frame has no *open in the app* link, so nothing carries it out of one. And
  **`start_here` is a page too**: the roadmaps the ready rows fold under, cut to the open
  milestone, then what is ready. `src/frame/routes.test.ts` fails on an app route the frame
  neither draws nor names in `NOT_IN_FRAME`, and on any link or writing control its pages render.
- **No result carries the document; the drawn view fetches it** (M41 F2,
  D-446). It once rode in
  `_meta` only to a client advertising `io.modelcontextprotocol/ui` (D-432), and VS Code's Copilot
  Chat drew the page without advertising it in the form the server read: a frame with nothing to
  draw. **What to draw is the call's input** (M41 F3,
  D-447): VS Code hands a
  view the result *without its `_meta`*, so the frame reads the path, format and view from
  `ui/notifications/tool-input` (`start_here`'s path alone draws its picture), and the result's
  `_meta["emerald/sheet"]` — name, format, view, path, URI, for every client — or its
  `structuredContent` only where no input came. The frame asks the host to call `frame_copy` with
  the path and **the key the server wrote into the page it served** (`<meta
  name="emerald-frame-key">`, made at start, written nowhere else); no result carries it, and a host
  reads the page with `resources/read`, which it puts in no model's context. **`frame_copy` is
  listed to every client** (a host refuses a page's call to a tool it was never listed) **and
  refuses anyone without the key**, with a sentence pointing at `format_rows`; it answers in
  `structuredContent` — stamp, name, URI, and the bytes when they moved — in case a host drops
  `_meta` from those too. A page from before a server restart carries the old key: the frame says
  to ask for it again and, if the line comes back, to reload the host's window (the spec lets a
  host cache a page; whether VS Code does across a restart is unmeasured). Without a document the
  frame says which hop failed — the host did not pass the call on, the server refused, the key is
  stale, or the answer was emptied — in a line a person reads, and it says once in the host's log
  what it was handed (*tool-input yes; the result's content yes, structuredContent no, _meta no*).
  **The server logs each client** on `initialized`, to stderr: name, version, the MCP Apps
  entry and every capability it declared — in VS Code, *Output → MCP: emerald* (the server's name
  in `.vscode/mcp.json`). Nothing turns on that entry any more.
- **The text beside a drawn view is short** (M41 F2): every row the view shows by its name, with
  its state — a board's rows by lane, a roadmap's in order with what folds under each counted by
  state, a ready list's ready and held — then the `format_rows` call that has every column. No cut
  at 25 (500 names, then a count). `docs/memory.emd`'s milestone roadmap went from 15,292 bytes,
  cut at 25 of 27 rows, to ~1.1 KB naming all 27. `start_here`'s text is its own and unchanged.

### The host's look, and trying it without a host (M41 F1)

- **The frame wears the host's look and keeps Emerald's meaning** (M41 F1,
  D-445). A host hands it `hostContext.theme`, `styles.variables`
  (the spec's standard names) and `styles.css.fonts` at `ui/initialize`, and again — only what
  changed — in `ui/notifications/host-context-changed`, so a theme switch restyles an open view.
  `src/frame/hostStyle.ts` maps background-primary/secondary, text-primary/secondary/tertiary,
  the borders, `--border-radius-sm/md/lg` and `--font-sans`/`--font-mono` onto Emerald's
  surfaces, ink, hairlines, small radii and type; every token the host leaves out stays
  Emerald's. **The accent, the action fill, `positive`, `negative`, the flows, the categories and
  the square cards and controls never take the host's**, and must each read at 4.5:1 on the
  host's surface or the frame keeps Emerald's colours whole (it says which, with the ratios, in
  the host's log). **The page paints no background of its own in any host** (M41 F4,
  D-448): the
  conversation is what it sits on, and a named surface need not be the chat's (VS Code names its
  editor's). Without a host surface the frame cannot measure contrast and assumes the theme's usual
  one, Emerald's own. **No backdrop either**: a browser lays an opaque `Canvas` under a frame
  whose root colour scheme differs from its iframe element's — the dark panel VS Code showed, whose
  webview schemes nothing — so the root takes the host's theme, and inside VS Code's webview
  (`body[data-vscode-theme-kind]`) none, with the theme on `body`. The resource is
  `prefersBorder: false`. **The frame says what the host handed** — theme, every variable's name,
  what the ones it reads resolve to, fonts, the page's `--vscode-*` count — in the host's log
  (VS Code: *Output → MCP: emerald*, `[App UI]`) and its own console (*Developer: Open Webview
  Developer Tools*). **Type**: the host's
  family when it names one; a font *file* it serves (`css.fonts` with a URL) is refused by the
  frame's CSP, which declares no `resourceDomains` — that would also open `script-src` to that
  origin, and no request leaves the frame (D-433). Without a host family, `src/frame/frame.css`
  names the closest system faces (Segoe UI, San Francisco). `--host-theme=vscode[-light|-dark]`
  plays a themed host on the stand-in (`src/frame/hostThemes.json`, plausible, not captured; a
  `vscode` host leaves its iframe unschemed and marks the page as VS Code's webview does), and
  `--no-styles` one that sends the theme alone (the page's *theme only* entry);
  `launch.json`'s `frame-live-vscode` draws the roadmap that way on 4187.
  A cancelled call (`ui/notifications/tool-cancelled`) is said, not waited on.
- **Trying it without a host**: after `npm run build:plugin`, `npm run frame:try -- <absolute .emd
  path> <format>` plays a host on this machine — `scripts/try-frame.mjs` starts the built server
  (`--engine-only`; `--full` for the ledger's tools), says it draws MCP Apps, calls `show_format`
  (`--view=board`; `--start` calls `start_here`),
  reads the page, and writes `.frame-try/host.html` (gitignored: it holds a copy of the document)
  and opens it. That page draws the frame as the spec says a host must — a `srcdoc` iframe,
  `sandbox="allow-scripts"`, the default CSP — answers `ui/initialize` with a host context whose
  theme follows the system, hands over the input and the result, sizes the frame to what it asks,
  and logs every message both ways under it, in red where a real host would trip. It replays one
  call and reaches no server — answering only the frame's first `frame_copy`, recorded when the
  page was written — unless `--live` (M44 U4, below). **`--no-ui` plays a host that draws without
  advertising MCP Apps** in its `initialize` (M41 F2), and **`--strip-meta` one that hands the frame
  every result without its `_meta`** (M41 F3); `launch.json`'s `frame-live-noui` plays VS Code as
  last seen (no advertisement, `_meta` stripped, no forwarded subscription, its dark theme) on 4188. `.claude/launch.json`'s `frame-try`
  serves it on `127.0.0.1:4183`.
  It found one thing: the frame refused MCP's `ping`, which now gets an empty answer.
  `--server=<path>` starts a copy installed elsewhere instead of this checkout's: a clean copy of
  `dist-plugin/` in a scratch folder, beside only the packages it then kept external, answered
  `show_format`, served its page, and drew `start_here` here (M41 U4); since M42 U2 it needs none.

## A drawn view updates in place (M44 U4)

**The frame is drawn again when the document changes** (D-442), as the
app's own window is through its watcher (D-127), instead of staying the moment the tool was called.
`show_format`'s and `start_here`'s answer carries the file's `path` and its `uri` (U2's), and the
copy `frame_copy` hands the frame carries its `stamp` — `watch.ts`'s mark, size:time:id (M41 F2
moved the copy out of the answer) — and the frame finds out from its host which way it
stays live, and says which in the host's log (`notifications/message`):

- **push** — it sends `resources/subscribe` with the document's URI through the host, and asks for
  the document again only on `notifications/resources/updated`.
- **check** — where the host refuses that, it calls **`frame_copy`** with the stamp it holds: the
  stamp alone comes back while the file has not moved (~150 bytes), and the copy rides in the same
  answer when it has. On coming back into view or focus, and every 15 s while in view; never while
  hidden (the host's tab, or the frame scrolled out of the conversation). A host that takes the
  subscription and then passes no word on is caught by the check on coming back into view, and the
  frame moves to **check** and says so.
- **off** — a host that forwards neither: the copy as it was when shown, and the frame says that.

**`frame_copy` is the frame's, never the model's**: `_meta.ui.visibility: ["app"]`, so a host keeps
it out of the model's list and lets only this server's frame call it — and since M41 F2 it is
listed to every client and refuses a call without the key the drawn view's page carries, so the
claude CLI, which knows no visibility, hands its model a tool that answers it with a refusal
(D-446, D-447). The redraw goes through the same `openBytes`, so the router, an open entry and every
scroll region stay mounted: the entry stays open when its row did not change, and what moves is
what the app's own motion moves on a reload.

**What a real host does is not known.** MCP Apps (2026-01-26) lists `tools/call`,
`resources/read`, `notifications/message` and `ping` as what a view uses, lets a host forward
anything not `ui/`, and says nothing of `resources/subscribe` from a view or of passing a server's
notification back to one; `hostCapabilities` has `serverResources.listChanged` and no `subscribe`.
So the frame asks rather than reads a capability, and **which way each real host goes is written
down as each one draws here.** The Code tab of the Claude desktop app draws it from a server the app
runs itself (M51 F1); which of the three paths it takes is not written down yet. **VS Code's Copilot Chat, 2026-10-08:** a
roadmap of `docs/memory.emd` drawn in the chat caught a write made elsewhere (a milestone closed)
a few seconds later, or as soon as focus came back to VS Code — the check path's timing (on
regaining focus, else within 15 s), not the push path's ~1 s. So VS Code most likely does not
forward a view's `resources/subscribe` or the server's `updated`; the frame's message log, which
VS Code does not show, would confirm it.

**The stand-in plays both.** `npm run frame:try -- <document> <format> --live` stays up, serves the
page itself on `127.0.0.1:4184` (`--port=`), and forwards the frame's `tools/call` and
`resources/subscribe` to the server and `notifications/resources/updated` back; `--no-push` forwards
the calls and refuses the subscription. It prints what the frame says and every call it forwards.
`launch.json`'s `frame-live` and `frame-live-check` draw `open_question` of `docs/memory.emd` that
way on 4184 and 4185. Measured there: a row written by another process appeared ~330 ms after the
save by push and within one 15 s interval by check, with no new tool call; a check that found
nothing was one 148-byte answer; the open entry stayed open across the redraw; deleting the row
left `memory.emd` byte-identical. **That proves our side only.**

## The frame hands rows to the conversation (M51 U7)

**Still read-only, and only as far as the host offers** (D-488). A
host's answer to `ui/initialize` may carry `hostCapabilities.message` (a view may send a line into
the conversation as the person, `ui/message`) and `.updateModelContext` (a view may tell the model
what it has in front of it, `ui/update-model-context`). The frame reads both and says them once in the
host's log — *Host offers (…): ui/message yes, ui/update-model-context no.* — and draws only what was
offered:

- **`message`**: each row of a ready view — and of `start_here`'s picture — offers **Start this
  unit** (the format's title: another format's ready view says its own), and an open entry offers
  **Ask about this unit** under the copy line. Each sends one line, written by `src/frame/handOff.ts`
  from what the format declares: the row's label column (a unit's `ref`), the column its entry view
  draws as its line (`title`), every column its entry draws as markdown (`brief`, `files`), and the
  document's name and path. *Start unit M41 U3 — Acting from the view…*, then the brief, then where it
  is. The bar says *Sent to the conversation.* or why it was not.
- **`updateModelContext`**: **Ctrl-click** (⌘ on a Mac) a sheet's row, a board's card or a line, or `x`
  on a sheet's cursor, selects it, tinted `accent-soft`; the bar says how many, *the conversation knows
  these*, and offers Clear. Every change of the selection, and of the view while it holds rows,
  replaces what the model is told: the rows by name, *"these" means them*, the view's address, and the
  `format_rows unit match:{ref:[…]}` that reads them whole (`structuredContent` carries the same with
  ids). An emptied selection sends empty content, which clears it.
- **Neither**: no button, no selection, no line about either — the frame as it was.

Nothing here writes: a line sent is a line the person could have typed, and D-234 gains no write.
`src/ui/formats/conversation.ts` is what the views read; only the frame provides it, so no screen of
the app changes.

**Which host does what** — written down as each is measured:

| Host | `message` | `updateModelContext` | How it is known |
|---|---|---|---|
| The stand-in (`npm run frame:try`) | offered, shown | offered, shown | Measured 2026-10-18: *Start this unit* on a ready row sent the unit's ref, title, brief and files as one `ui/message` with `role: user`; two Ctrl-clicked rows reached `ui/update-model-context` by name; Clear sent it empty; *Ask about this unit* on an entry sent its line. `--no-hand-off` plays a host that offers neither, and the frame drew as before M51 U7. |
| The Claude desktop app's Code tab | **unmeasured** | **unmeasured** | **Draws only from a server the app runs itself** (M51 F1, D-489), measured on one machine 2026-10-08 to 10-18 by matching every drawing call in the claude CLI's MCP logs (`%LOCALAPPDATA%/claude-cli-nodejs/Cache/<project>/mcp-logs-<server>/`) to the app's own log of frames mounted (below): of 28 `show_format`, `format_sheet` and `start_here` calls to `emerald` since the frame shipped, started by the project's `.mcp.json`, **none** mounted a frame — the 2026-10-18 ready list among them; of 24 to `emerald-ledger`, from `claude_desktop_config.json`, 21 mounted one, most within seconds. The claude CLI's own client says nothing of MCP Apps at `initialize` (its binary adds the `io.modelcontextprotocol/ui` entry only when `CLAUDE_CODE_MCP_APPS_HOST` is set, and the desktop app does not set it), while the app's own clients (`claude-ai`, `local-agent-mode-emerald-ledger`) advertise it — which is what `drawnLine` reads. Not U7 and not the rename: the `emerald` server never drew, before either. The app's cached host module names `ui/message` and `ui/update-model-context`; whether this host offers them is the frame's *Host offers* line, on a frame drawn from `emerald-ledger`. |
| VS Code's Copilot Chat | unmeasured | unmeasured | Not tried; its frame's log line is in *Output → MCP: emerald*, `[App UI]`. |

**Where the view sits is a trial** (M42 T1, 2026-10-18). MCP Apps names three display modes —
`inline`, `fullscreen` and `pip`, a small window that floats while the conversation scrolls — and
nothing else: no side panel and no view pinned to the end of a chat. The frame says at
`ui/initialize` that it can be drawn all three ways (`appCapabilities.availableDisplayModes`), reads
the host's `availableDisplayModes` and `displayMode` from its context, and its copy bar shows *Float*
and *Full screen* only where the host offers them, and *Back in the chat* once it is not inline; where
a host offers inline only the bar shows nothing. During the trial the bar also said *Display modes
here: …*, on screen because the desktop app's log withholds what a frame says; once the Code tab's
answer was read, it was dropped, and the modes a host named are said in its log only. Floating or full screen it stops sending `size-changed`: the host sets the size there,
and a frame that kept saying its height looped in the stand-in. `npm run frame:try --
--display-modes=inline,fullscreen,pip` plays a host that offers all three (by default it offers
inline only): measured 2026-10-18, *Float* floated the frame in a corner while the page scrolled
under it, and *Back in the chat* put it back at its height. **The Claude desktop app's Code tab
offers inline only**: *Display modes here: inline.* was read on a frame drawn from
`emerald-ledger` on 2026-10-18, so the frame shows no button there and floats nowhere yet. **So does
VS Code's Copilot Chat**, read the same day on a frame drawn from this repo's `.vscode/mcp.json`. Other
hosts are unmeasured until their *Host offers* line is read.

**The probe of a drawn frame is the app's log, not the CLI's** (M51 F1): a frame's own calls reach the
server through the desktop app's client, so no `frame_copy` line ever appears in the claude CLI's MCP
log, drawn or not. The desktop app's `claude.ai-web.log` (in the Microsoft Store install,
`%LOCALAPPDATA%/Packages/Claude_<id>/LocalCache/Local/Claude/logs/`) writes `[MCP Apps] oncalltool
handler replaced` each time it mounts a frame, then `[MCP App: mcp__<n>__<n>][info] payload withheld
(N chars)` for each line the frame says in the host's log (`notifications/message`) — the *Host
offers* line among them. A session reads those to tell whether a frame was drawn, without anyone
looking; their times, against the call's in the CLI's log, are how the table above was measured.
Re-checked 2026-10-18 (M51 F2): `%APPDATA%/Claude/logs/` is a stale copy that ends on 2026-08-22;
the live log is the `%LOCALAPPDATA%` one above (also reachable as `%LOCALAPPDATA%/Claude/logs/`). Its
last frame before 10-18 is 10-15 because no `emerald-ledger` drawing call came after, not because the
log stopped: a call at 08:25:24Z on 10-18 mounted one two seconds later.

## A document is a resource you can subscribe to (M44 U2)

**A listener, not a poll** (D-440). The server declares
`resources.subscribe`, and a document is addressed by its path: a client sends
`resources/subscribe` with `{ uri: "file:///F:/notes/memory.emd" }` — the document's `file://` URI,
or its absolute path as the tools take it — and from then on receives
`notifications/resources/updated` carrying **that same string** each time the file changes on disk,
whoever wrote it: the app, another session's server, or this server's own write.
`resources/unsubscribe` with the same `uri` stops it, and so does the client going. A URI that is
not a document, or names no file, is refused with the shape above.

- **The directory is watched, not the file** (D-127): every writer here saves by renaming a sibling
  over the document, which a per-file watch goes deaf to. `src/plugin/watch.ts` is the watch —
  `watchDocument(path, onChange)`, one `fs.watch` per document however many listen, a burst settled
  for 150 ms and reported only when the file's size, time or id moved. It is the shell's idea
  rebuilt for plain Node, not its code, and it is what M44 U3 and U4 listen through.
- **The only state the server holds**: which documents this connection subscribed to — and, for a
  format's subscription (U3, below), that format's last reading. Tools stay stateless, and a
  document's subscription holds nothing of the document.
- **Read with the tools.** `resources/read` of a document's URI is refused; what changed is a
  `format_rows` or `start_here` away. Measured over stdio in `subscriptions.test.ts`: a rename-save
  by another process arrives ~200 ms later, the process's own start included.
- **Claude Code neither subscribes nor listens** (2.1.177, read from its binary 2026-10-08): it
  carries the SDK's `subscribeResource` and the notification's schema, but nothing calls the one or
  registers a handler for the other — it handles `list_changed` for tools, prompts and resources,
  and elicitation, and drops `resources/updated`. So a session does not learn of another writer from
  this alone; the `watch` command below is the way in for a session.

## One format, and how a session watches its inbox (M44 U3)

**A format of a document is a resource too** (D-441): the document's
URI with the format's name as its fragment — `file:///F:/notes/memory.emd#inbox`, or
`F:/notes/memory.emd#inbox` as a path. A fragment because a format is a part of the document, and
because the part before `#` stays exactly U2's URI. Its subscriber is told only when that format's
rows differ from the last reading: on each change the server opens the document read-only and reads
the format's rows **as `format_rows` prints them** — a link by its row's name, never by id, since a
text document renews every id on every write — and compares the two readings as multisets. A write
to any other format is silence. A format the document does not declare is refused at subscribe.

**What wakes a session is a line, not a notification** — Claude Code drops the notification (above),
but its Monitor tool wakes on every line a command prints. So the server ships a subcommand:

```
node dist-plugin/server.mjs watch docs/memory.emd --format inbox --match state=new
```

run under Monitor (it expires after at most 30 minutes; re-arm it) — for a session that must wake between prompts; at a prompt the hooks below already say it. It prints one line per change —
`inbox (state=new): 1 new row in F:/projects/financial-companion/docs/memory.emd — "<subject>"` —
then the session reads the row with `format_rows inbox match:{state:new}`. `--match column=value`
(repeatable, needs `--format`) keeps only rows holding those values, and **a row leaving the match
is silent**: that is the session's own triage, and waking it for its own write is the gap this
closes. Without `--format` it says `document: <path> changed.` on every change. It reads and never
writes, makes no network request and does not poll (the only timer keeps the process alive); a
refusal while running is said once and it keeps watching; **when the document goes away it says so
and exits 0**. Once up it says `Watching inbox (state=new) in …` on stderr, which wakes nobody; bad
arguments or a missing document or format exit 2 there.

A subcommand rather than a second bin because the server is one file a person already has;
it takes the same watch in-process rather than subscribing to a second server over a pipe.
Measured: under this repo's Monitor, an inbox row written by a script outside the repo through the
built server woke the session ~380 ms after the save, an `open_question` row before it woke nothing,
and deleting the row (leaving `state=new`) woke nothing. `formatWatch.test.ts` runs the same over a
real child process.

## The hooks: start_here and the inbox, in context without being asked (M47 U1)

**A watch that nobody starts reaches nobody** (D-460). On 2026-10-08
nine servers were up and none was a watcher; on 2026-10-11 one session made thirteen empty inbox
polls and fourteen Monitor calls at 360K context each, and still missed the row twice. A Claude Code
hook needs no session to remember anything: the host runs it, and what it prints is in context
before the model's turn. So `dist-plugin/hooks.mjs` answers two questions from the command line:

```
node dist-plugin/hooks.mjs start-here <document.emd | folder>
node dist-plugin/hooks.mjs rows <document.emd | folder> <format> [--match <column>=<value>]...
```

`start-here` prints what the `start_here` tool answers, headed `start_here on <path>:` under one
line saying it is text and nothing was drawn (M51 F2, D-492). `rows`
prints what `format_rows` answers, headed `inbox (state=new): 1 row in <path>` — **and nothing at
all when no row matches**, because a line saying "none" before every prompt would be the poll this
replaces, paid in context instead of turns. Each is one process and ~0.8 s: one read-only open, no
MCP round trip, no turn (`hosts/claude/hooks/commands.ts`).

**A hook is Claude's alone, so it lives in `hosts/claude/` and the server imports none of it** (M42 U6,
D-494). MCP has no hooks: another client never runs one, and the server stays what every client gets —
the frame included, since MCP Apps is an open extension. Until M42 U6 these were subcommands of
`server.mjs` beside `watch`; now `hosts/claude/hooks/main.ts` is an entry of its own, built by
`vite build --mode claude-hooks` into `dist-plugin/hooks.mjs` beside the server, and it bundles the
tools it answers with rather than starting the server. `hosts/claude/` is the one home for what only
Claude reads: the hooks and the status line, the skills a stranger gets (`skills/declare-a-format`, the
same file as this repo's `.claude/skills/` copy, which `skills.test.ts` holds; and since M42 U7 the
development pack's `run-milestone`, `closing-pass` and `review-phase`, generic copies of this repo's
own, which stay in `.claude/skills/` — `skills.test.ts` fails when a generic one names a decision,
unit, note, script or npm script of this repo's), and the plugin's
manifest (M42 U4, below). A second host later is `hosts/<name>/`. A host reaches the server only through
`src/plugin/host.ts` (and the shell's constants through `electron/bridge.ts`); nothing in `src/` or
`electron/` imports from `hosts/`; `src/plugin/hostBoundary.test.ts` fails on either. This repo's own
`.claude/` stays the configuration for developing Emerald.

**A folder means the project's document** (`hosts/claude/hooks/project.ts`): the `document` that
`.claude/emerald.json` names (`{ "document": "docs/memory.emd" }`, relative to the folder), or else
the one `.emd` in it — not counting the named copies Emerald kept beside a document before D-470
moved them (`planner.before-….emd`, D-399), or the first one would silence the hooks. A folder that means no
document, and a document without the format asked for, are **silence and exit 0**: a plugin's hooks
run in every folder a person opens. A document named outright or in `emerald.json` that is not
there is said on stderr with **exit 1, never 2** — to Claude Code a 2 from `UserPromptSubmit`
blocks the person's prompt.

**A git worktree means the main checkout's copy** (M51 U1). A worktree holds its branch's copy of
the document, so a session there read rows as they stood at its branch point — none recorded since
and not committed — and wrote into a copy that had to be merged back as text. So a document found
inside a linked worktree is taken at the same place in the main working tree, the parent of
`git rev-parse --git-common-dir`, when it is there; the main checkout, a folder outside git and a
bare repository's worktrees are as before, and the lock (D-304) already makes several writers safe.
The heading names both files — `start_here on <main>/docs/memory.emd — the main checkout's copy,
which every worktree reads and writes; write to this path, not to this worktree's <copy>` — because
the tools take the path a session gives them, and that path is the one to give. **The worktree's copy
is never committed**: `scripts/guard-memory-emd.mjs` refuses a `git commit` in a linked worktree
while the copy is staged, or while it has changed and `-a` or a pathspec would take it.

The hook set is `hosts/claude/hooks/hooks.json`, the plugin's (`npx -y --prefer-offline -p
emerald-mcp@<version> emerald-hooks …`, M42 U4); this repo runs the same two from `.claude/settings.json`
against `dist-plugin/`, and `hosts/claude/hooks/commands.test.ts` fails when the two differ. `SessionStart`
matches `startup|clear|compact` (a resumed session has the answer already); `UserPromptSubmit`
runs before every prompt with `--once-per-session`, below.
`npm run docs:check` fails when `.claude/settings.json` loses either line or `emerald.json` names
no document. Another project uses them today by putting the same two commands, with the server's
absolute path to `hooks.mjs`, in its own `.claude/settings.local.json` — machine-specific, so not in a file it
commits.

### Told once per session, and the status line (M51 U6)

**One untriaged row entered one conversation four times** (D-487): the
hook printed every `new` row before every prompt, and every later turn re-read every copy. So
`rows … --once-per-session` reads the hook's input from stdin for the session's id and remembers, in
`<document>.told` beside the writers' lock and never in the document, which rows that session was
shown — by what they say, since a text document renews its ids on every write. A row is printed in
full the first time a session meets it; after that the hook says one line —
`inbox (state=new): 1 row in <path>, every one printed in full earlier this session.` — once, and
then nothing until the rows change. A row that arrives between prompts is printed in full, alone,
with how many were shown before; a new session (or `/clear`) is told again, and `start_here` at
`SessionStart` still lists every new row. Without a session id it prints every row, as before.

**The status line is for the person, and costs the model nothing**: a hook's stdout is context, a
status line's is a strip under the prompt.

```
node dist-plugin/status-line.mjs [<document.emd | folder>]     # inbox 1 new · in progress: M51 U6
```

With no argument it takes the folder from the host's input (`workspace.project_dir`). It must answer
in a fifth of a second and a bundle holding the tools takes a third to load, so it is a build of its own of a few
kilobytes (`vite build --mode claude-status-line`, from `hosts/claude/hooks/statusLineMain.ts`) that never opens the document: it prints what
`<document>.status` says, written by `hooks.mjs status <document>`, and when the document has
changed since it prints that anyway and starts the slow half once, detached, in the background
(`hosts/claude/hooks/statusLine.ts`, `statusCache.ts`). Measured on this repo's `docs/memory.emd`: ~100 ms
with a folder argument, ~150 ms reading the host's input. Units in progress are named latest-started
first, two of them, and the rest counted. Wiring it is a person's choice, one setting:

```json
"statusLine": { "type": "command", "command": "node \"<path to>/dist-plugin/status-line.mjs\"" }
```

### A repository set up by one command: `init` (M50 U1)

**The study of 2026-10-13** (17 sessions on three documents) measured `formats` called up to eight
times a session and the columns learned again every session, because those projects' CLAUDE.md said
nothing about the document, where this repository's has the start-here table and `start_here` ends
with the columns. `init` writes that for any repository, as a subcommand of the server's bin like
`watch` (`src/plugin/init.ts`):

```
npx -y emerald-mcp init [path/to/document.emd]        # run in the repository's folder
```

1. **The document**: the one named, else the one `.claude/emerald.json` names, else the one `.emd`
   in the folder, else `docs/memory.emd`. One that is not there is created keeping the development
   pack — **as text inside the repository**, to be committed and diffed, and as SQLite bytes
   outside it, reached by its path. One that is there is only read, and said: how it is stored, and
   `keep_packs` when it lacks the development pack. `.claude/emerald.json` is written to name it —
   relative inside the repository, absolute outside — which is how a hook finds it.
2. **A marked section of `CLAUDE.md`**, between `<!-- emerald-init: … -->` and
   `<!-- /emerald-init -->`: the `start_here` questions from the document's own views, in the
   table this repository's CLAUDE.md carries (`startTableOf`, beside `startHereTable` in the
   development pack), and the one-line-per-format column lines `start_here` ends with
   (`compactDeclarations`, D-460). Added at the end of a CLAUDE.md that has none, written again in
   place in one that has, in the file's own line endings; nothing outside the markers is touched,
   and a section opened and never closed is refused.
3. **The two hooks**, the plugin's own commands pinned to this package's version, merged into
   `.claude/settings.json` — **only when no `emerald@…` plugin is enabled** in the person's settings
   (`CLAUDE_CONFIG_DIR`, else `~/.claude`) or the repository's, since the plugin brings the same
   two. A hook it wrote is re-pinned; a hook it did not write that already prints the same thing
   (this repository's `node dist-plugin/hooks.mjs start-here`, say) is left as it is and said.
4. **What it wrote, and what a session there now sees first**: start_here on the document.

**Idempotent by comparison**: every file is compared before it is written, so a second run leaves
CLAUDE.md, the settings, `.claude/emerald.json` and the document byte-identical, and after a format
changes only the section is written. `scripts/check-package.mjs` runs it from the packed tarball in
an empty folder, runs the hook it wrote and checks a second run changes nothing; `init.test.ts` has
the rest. The published package has it from 0.2.0.

## Claiming and landing a unit, a call each (M47 U3)

**The closing pass was a write per row** (D-460): 302 of 346 writes
across a week's three documents carried one row, most of them the unit to `built`, a decision or
two, review entries. Two shaped tools over the development pack (`tools/landing.ts`):

- **`claim_units`** — refs to `in_progress` with `taken_by` and `started`, each `expect`ing
  `planned`: `update_format_rows`'s own mutation, for a list.
- **`land_units`** — per unit, its new `decisions` (date, milestone, scope and `live` default to
  the unit's), the unit to `built` with `landed`, `files` and `decision`, its `review_entries`, and
  `close_milestone`. A unit already built or dropped is refused before anything is judged.

**Where a unit was worked, in git's words** (M51 U2, D-484): `claim_units`
takes an optional `branch`, written on every unit it takes, and `land_units` takes per unit the
`commit` that carries the work (7 to 40 hex digits) and the `branch` it lands from. A landing that
names its branch is refused before anything is judged when the unit was claimed on another, unless
it says `other_branch: true`; one that names none is not checked. `taken_by` stays whatever the host
calls its session, so `format_rows unit match:{state:in_progress}` is who is where, and the roadmap
and board show the branch beside it.

**A stalled claim is taken over, and a landing names its commit and keeps its report** (M51 F4,
D-501). `claim_units` with `take_over: "<taker>"` takes units already `in_progress` — a session that
stopped mid-unit — refused, by unit, unless each is held by exactly that taker (a plain claim of
one is still refused, so a take-over is always said); `started` is reset, and the taker it replaced
goes onto `taken_over_from` with the day they took it, oldest first. The pack's ready view says
`started: stalls 1`, so `start_here` lists, under **Stalled**, every unit `in_progress` taken more
than a day ago — or with no `started` at all — and a dead session is seen at the next session's
first call. `land_units` refuses a landing with no `commit` unless it says `same_commit: true`:
commit the work, land with its hash, then commit the landing; `same_commit` is for the landing
that goes in with its work, and leaves `commit` empty, since a commit cannot name itself. And a
landing takes the builder's `report`, plain text up to 4,000 characters, kept on the unit's
`report` column — the host cuts a child's note to its driver at a few hundred characters, and
`format_rows unit match:{ref:"<ref>"} columns:[report]` is the whole of it. A child's proposal
carries its `report` like any other key.

**A child proposes, its manager lands** (M51 U3, D-485). A session run
for a manager — a worktree's child — does not call `land_units`: it writes **one `inbox` row**,
`state: new`, whose `refs` is its unit's ref and whose `body` is a line for a person and then one
fenced `json` block holding one of `land_units`' `units` — `unit`, `files`, `commit` (or `same_commit`), `branch`,
`decisions`, `review_entries`, `landed`, `decision`, `report`; never `close_milestone` (the maintainer's) or
`other_branch` (the manager's). It writes it **to the document path its hooks printed** — in a
worktree that is the main checkout's copy (D-483), never a path built from the worktree's own folder,
since the tools write whatever path they are handed. `land_units inbox:[ids]` (beside `units`, or
alone) reads every proposal named and lands them as **one dry run and one commit**; each row goes
`applied` with `became_unit` and `answered_by` filled, and only from `new`, so a proposal lands once.
A row that is not there, not `new`, has no single `json` block, does not parse, carries a key a
proposal has not got, or whose `refs` name another unit refuses the whole batch, by its id and
subject. Its `branch` is checked against the claim like any landing's; `{id, other_branch: true}`
lands it anyway. By id is safe here although a text document derives ids from content (D-247): a
proposal is never edited. A child can dry-run `land_units inbox:[its id]` to check its own row, and
writes no other format.

**A composition, not a write** — each step is `record_format_rows` or `update_format_rows`'s
mutation, refused for the same reasons, in the order decision → unit → review_entry → milestone → inbox,
because each may name a row the one before wrote. The dry run judges each step on what the steps
before it left by **writing them and taking them back** (`rehearse`, D-395), the commit runs the
same steps in one transaction, and the answer is the diff by format. So the engine gains no write
and parity (D-227) is met by the sheet; `parity.test.ts` lists both as compositions and fails if
`landing.ts` calls a repository write itself. A general batch of mixed writes was rejected: a
general query by another name (D-095).

## Which ready units can run at once (M51 U4)

**A manager checked by eye that four of five units touched one file** (D-486),
because `files` is prose. A unit now carries **`paths`** beside it — one repository path per line, a
folder ending in `/`, written when it is planned; `files` keeps the prose, and what every unit appends to
(the decision log, `docs/memory.emd`) stays out. **`dispatch_plan`** (`tools/dispatch.ts`, read-only)
takes up to fifty unit refs, or none for every ready unit, and answers in one call:

- **At once** — ready units sharing no path with another listed, nor with a unit `in_progress`.
- **One after another** — units joined by a shared path, directly or through a third, in the order
  given; a unit in progress on one of their paths is drawn first, and a table names each pair and what it
  shares. Two paths are shared when they are one (without case) or one is a folder holding the other.
- **Unknown** — a unit with no paths. Nothing says what it touches, so it is never put beside another.
- **Not ready** — not `planned`, waiting on a unit still open, or no unit by that ref.

Then each ready unit as a session handed it would start: its paths (a line holding a space or a comma is
named, since it reads as one path), `files`, the units it waits on, the decisions it is linked to or its
brief names, and the brief. **Every answer ends saying overlap is only as good as the paths written at
planning.** Rows written before M51 U4 keep `files` alone and come back unknown.

## A row in another document, read where it is (M47 U4)

**An `elsewhere` column names a row in another document** — its path and the row's name,
`F:/projects/shop/shop.emd S1 U5` or `../shop/shop.emd S1 U5` beside the holding document
(D-461). The plugin can reach the disk, so it is the one that reads
it: `format_rows` prints `… → unit S1 U5 · built` beside the value, `start_here` prints
`shop.emd: unit S1 U5 · built` on the line, and the hooks' `rows` says the same. Each document named
is opened once per call, read-only (`src/plugin/elsewhere.ts`). **Unresolved is an answer and never
a refusal**: a file that is not there, one at another schema, a name no row has or two rows share —
the read says which, and a write of the value is never refused for it. The development pack's inbox
carries one, `about`, so a hand-off names the row it is about and the owner sees it is already done.

## A file on this computer (M37 U6)

**A `file` column holds where a file is** — `scans/receipt.pdf` beside the document, an absolute
path elsewhere, or a note app's own address (D-479).
`record_format_rows` and `update_format_rows` keep a path under the document's folder relative to
it, so the folder can move; a web address is refused with the reason. `format_rows` looks each path
up and prints `scans/receipt.pdf · missing` when the file has gone (`src/plugin/fileCells.ts`) —
never a refusal. Opening one is the desktop app's: the conversation names the file, the person clicks.

## Searching the whole document, and the scan before it is shared (M47 U6)

**`search_document`** takes `terms` and answers every row of every declared format that holds any of
them, by format, row and column, each column searched as `format_rows` searches it — one call where
that is one a format (D-463). A link is not a hit; the row it names
is. The rest of the file — a format's notes, a column's choices, the files it read — is counted by
table and column, not shown. **Given `denylist`** (a `--replace-text` file) instead, it is the scan
before a document is committed or handed on: hits only, a term named by its line, case kept, and
the file's bytes read for a deleted value still in them. `src/privacy.test.ts` scans every tracked
`.emd` through it. The repository, `searchDocument`, is the one the palette's search across the document reads too (M37 U2c), so a person and a conversation find the same entries.

## What a client that is not Claude does with it

Measured, not assumed (D-114), with a local-model harness (`scripts/local-host.mjs`, deleted in M45 F1
once nothing ran it) — the same stdio server, driven by
`qwen3:8b` and `qwen3:30b-a3b` on a local endpoint. It matters because anything that speaks MCP can
connect to this, and because a local model would leave *nothing* in a conversation at all.

**It reads well and decides badly.** A synthetic payslip came back reconciling **to the agora**,
with the employer-only line as a `0` rather than dropped and the line the vocabulary cannot name on
`ded:other`. Hebrew merchant names survived byte-exact through `assign_category`, and nine
assignments arrived batched in one call. Then the same model imported a bank statement into the
**credit card**, and left a reference-number column mapped to `amount` after saying in prose that
it should not be. Every failure was a judgement; none was a reading.

**The dry-run gate did not hold.** It survived "work out what they are" and gave way to "record it"
and "get it imported" — `commit: true` on the first call, no preview. So the safeguard that
replaced the review screen is the client's discipline, and `getClientCapabilities()` reports
elicitation, not discipline. A host that wants the gate must enforce it itself.

**The tool list costs speed.** ~13.8k tokens of schema and instructions, re-sent every turn, forces
a context that pushed an 8B model off an 8GB card — 62% resident, ~170s a turn. The same task with
five tools exposed ran at ~37s a turn. `tools/list` returns what it returns, so only a client can
apply that fix.

**And the rulepack beat both models.** `il-core.json` filed 29 of 38 rows with no model at all;
both models then made the same three Israeli-brand errors on the tail, unchanged by four times the
parameters. Merchant identity is a rulepack problem.

## What the reach actually is, measured rather than assumed

Worth recording because it was checked (D-101): a local MCP server reaches **Claude Desktop and
Claude Code only** — never web or mobile, and Cowork only when it runs inside the desktop app. So
this surface is for people who will install something, which is what the table below always said,
now with the boundary drawn precisely.

An in-app AI calling the API directly was explored as the way to reach everyone else, and
**deferred** (D-102): it is a bigger product than this one, and it points the app straight at what
a bank-connected budgeting subscription already does. **D-124 removed it rather than leaving it unscheduled** — it required a hosted
proxy and a subscription to fund one, and Emerald sells nothing. Its notes, F15 AI Intake and
F16 AI Conversation, are retired; everyone else is reached by the local
model of M10/M11, in the app, with no account at all.

## The tell that finds the next gap: a read with no write

D-109 found `create_category` missing because a conversation could not add a name. D-111 found the
whole fixed-expense detector missing for the same reason in a different costume: `fixed_expenses`
listed what was already confirmed, which is the *answer* to a question nothing here could ask. Both
times the surface had a **read tool with no matching write**, and both times the missing piece was
one wrapper over code that already existed and was already tested — one file and seven tests, then
one file and fourteen.

So that is the thing to look for when asking what to expose next, and by it the remaining gaps are
plain: `savings`, `debts` and the paycheck figures are all readable and none of them is writable.

## Three surfaces

They differ in what they can reach, which is a platform constraint rather than a packaging
choice. A hosted bridge would reach the third at the cost of the whole local-first story; it is
rejected.

| Surface | Reaches the local file | Cost |
|---|---|---|
| **Claude Code plugin** | Yes — bundled stdio MCP server, read and write | Lowest. Build here first; iteration is in minutes. |
| **Claude Desktop extension** | Yes — the same server, double-click install, no terminal | Shipped as `emerald.mcpb` on each release, on the app's own Node (M42 F9, D-509). |
| **claude.ai web / mobile** | **No.** Web chat reaches only remote MCP servers. | — |

The third has a fallback worth confirming: a `.emd` is a plain SQLite file, so a user
can attach it to a conversation and Claude's code execution can read it with Python's stdlib
`sqlite3`. Read-only, no write-back beyond handing back a copy. If it works, the whole
deliverable for that surface is a **skill** carrying the schema and the domain vocabulary —
money in minor units, `merchantNormalized`, the category-source enum — which the MCP server
wants anyway.

## Tiers

All three are **in M7**. They were written as a staging plan for a plugin that might stop after
the first one; the answer to "what should the first version be good at" was categorizing, rules
and ingestion — which is tiers 2 and 3 — so the tiers are now build order within one milestone
rather than three decisions.

0. ~~**The server and the schema gate.**~~ **Built** (D-093). `document_info` and nothing else, so
   that trap 1 is true from the first commit rather than retrofitted. It refuses in **both**
   directions — an older document is fixed by opening it in the app, a newer one by rebuilding the
   plugin — and the assertion that matters is that the refused file is byte-identical afterwards.
   The name was chosen against `open_document`, which is the obvious name and the wrong one: the
   plugin holds nothing open between calls, and `open` would promise a handle, a session and a
   matching `close` that the design does not want to make.
1. ~~**Read-only.**~~ **Built** (D-094), ~~with a guarded `query`~~ **without one** (D-095). Shaped tools — uncategorized
   merchants, the category tree, a month summary, a filtered transaction list. Claude does the
   analysis in the conversation, so there is no analysis code to write. This alone makes the ledger
   conversational, and everything above it needs the reads anyway.

   Nine names, and the ones worth recording as decisions: `transactions` returns a **page of rows
   and, separately, the totals over every matching row**, because a total under a fifty-row page
   that summed the page would be quietly, plausibly wrong; and `uncategorized_merchants` carries
   what the user has **already filed other rows of the same merchant under**, which is their own
   past decision rather than a suggestion.
2. ~~**Onboarding, and the first write.**~~ **Built** (D-097). `create_document` makes a `.emd` that does not
   exist yet and refuses one that does, then the plugin walks [F12 Onboarding](./packs/ledger/f12-onboarding.md)'s own step machine in
   chat (D-096). **Since M28 U9 (D-330) there is no step machine**: `guide_status` reads the app's
   Guide me list, and `import_statement`'s `new_account` makes the first account. Taken **before** the general write tools, because it is the only write that needs
   no backup, no dry run and no provenance — there is nothing to lose — so the write path itself
   gets proven on a file where a bug costs nothing. Claude Code renders a real form for it
   (`elicitation: { form: {} }`, verified), and the form is an enhancement rather than a
   requirement: the same answers are ordinary tool arguments, and a cancel falls back to chat.
3. **Writes.** ~~`assign_category`~~ **built** (D-098), and with it the three safeguards
   themselves: a dry run by default, a timestamped `.bak` before the batch, and provenance on
   every row. `create_rule` and `add_paycheck` follow, through the same `mutatingCall` shape and
   the same existing domain functions. Three things the note did not anticipate and that are worth
   carrying forward: the dry run is **read-only by the engine** rather than by intention; the order
   is **gate, then copy, then write**, so a refused document leaves no `.bak` behind; and the plan
   is **recomputed at commit time**, so a document that moved between the two calls gets an honest
   answer rather than a stale one applied blind.
   **The evidence beside the writes came last** (D-104): `uncategorized_merchants` carries the
   provider's own heading on the rows being looked at, and what a previous conversation already
   suggested about each name — the latter written by `note_merchant_suggestions`, the twentieth
   tool and the only write with no dry run and no `.bak`, because it touches one `app_setting`
   key and can overwrite nothing but a note it wrote itself.
4. ~~**Ingestion.**~~ **Built** (D-100), for statements. Claude reads the payslip PDF or the statement file itself — SheetJS runs in Node
   too, so the importer is reusable. The plugin runs the real pipeline and commits; it does not
   park rows for a screen.

## Seven that are about no subject, and what they cost the surface's oldest claim

> **M19 U2** ([D-217](./09-decision-log.md)), a sixth at U2b ([D-220](./09-decision-log.md)) and a
> seventh at U4a ([D-223](./09-decision-log.md)).
> Every tool above is a capability somebody wrote by hand about a thing the app knows. `formats`,
> `declare_format`, `format_rows`, `record_format_rows`, `update_format_rows`,
> `delete_format_rows` and `record_units` are about **whatever the document declares** —
> their vocabulary comes from the file rather than from the build, which is why `formats` is the
> one to call first and why the rest refuse a column by naming the ones that exist.
>
> **They are still shaped.** They can name nothing but a declared format, reach nothing but a
> `fmt_` table, and take no SQL from anybody; D-095's rule is that a question no tool answers is a
> new shaped tool, and a vocabulary the user wrote down is not the general query wearing a hat.
> What a declaration could *not* generate is the tool list itself — `tools/list` carries no
> document, so a per-format tool name would be about a table nobody had pointed at.
>
> **And this is where "everything here adds" stops being true of the whole surface.** That claim
> was never about safety; it is about where an edit belongs, and every app-only edit below is
> app-only because a screen exists for it. A declared format’s **rows** have no screen, so the
> conversation is the only place one can be corrected or taken back. The assertion in
> `server.test.ts` was narrowed to name the two exceptions rather than deleted, so a third would
> fail out loud.
>
> **The rows have a screen now** (M20 U1, [D-229](./09-decision-log.md)), and the tools did not
> retire with the reason for them. `#/formats/<name>` reads, adds, corrects and removes rows, and
> it goes through the same `coerceRow` these tools do, so a refusal reads the same on both —
> which is M20's parity rule rather than a coincidence. What changed is the argument: they are
> the exception because a format the user declared is *theirs*, both halves of it, not because
> there was nowhere else to send them.
>
> **The declaration does have one now** (D-219), and D-220 put the line there: `declare_format`
> creates and never alters, because a new format can lose nothing while a changed one is a plan
> drawn against rows that already exist. The same entry fixed a sentence in `mutatingCall` — a dry
> run that was going to refuse no longer invites a `commit: true` — which is one fix to every
> mutating tool that can refuse in advance.

### What the rows prove, where they come from and what they point at (M19 U3, U4)

> **U3 gave those rows something to prove** ([D-222](./09-decision-log.md)). `formats` prints what
> a format claims about one of these; `format_rows` carries a **verdict** with every row it returns —
> `proved`, `failed`, or `unchecked` when the row has nothing in a column the identity names — and
> that is deliberately beside the row rather than in a summary underneath, because a proof about
> something the reader has to go and find is the shape D-138 keeps catching. `declare_format` takes
> `identities`, and refused a format that neither declared one nor said `nothing_must_hold` —
> **until M38 U5** (D-411), when no identity became the default and the
> key left the schema. **Since M33 U3a an identity is a *claim* to a model too**
> (D-417): the key is `claims`, a derived column is `computed`, and
> `identities` and `derived` are still read.

> **U4a gave a conversion somewhere to come from** ([D-223](./09-decision-log.md)). `formats` now
> ends with what this document can convert between, grouped by what each unit measures, because a
> conversion is resolved against **the document's rows and not this build's array** — a caller that
> assumed the array would be wrong in exactly the kitchen where `tbsp` is 20 ml. `record_units`
> teaches it one it has not got and corrects a factor that was a convention rather than a
> definition, and it **refuses to change what a unit measures**: a `tbsp` that became a mass would
> keep every figure and make every one of them wrong by a factor, which is the reconciler's
> `UNIT_CHANGED` refusal met in another table. It exists at all because a unit table nobody can add
> to is D-208 again — a vocabulary compiled into the binary that cannot name what a real document
> measures in. **Since M29 F3 it also takes `currency`** (D-344) —
> the document's, what a new amount on a screen starts in — and `formats` prints it under the units.
> A row a conversation writes still names its own currency: the document's is offered by a form,
> never assumed by the engine.

> **U4b gave a row somewhere else to point** ([D-224](./09-decision-log.md)). A column may be a
> `link`, so `declare_format` takes a `target` and refuses a link without one; `format_rows` prints
> every aggregate the format declares beside the row it is about, above the verdicts, because an
> identity may name one and the reader following `per_serving: failed` needs the figure that went
> into it already on the page. **A row naming an id the other format has not got is refused when it
> is written** — the `REFERENCES` clause enforces nothing here (D-067), so this is the check that
> holds, and it names the column and the id.

### Joining formats, and the engine owing no tool (M20 U5, M24)

> **The one thing this surface cannot do on its own**: `recipe_line` links to `recipe` and `recipe`
> folds `recipe_line`, so neither can be declared first by a tool that creates and never alters. A
> conversation sets up the link and **Connections** adds the aggregate — on the graph, where both
> formats are on the screen and the ordering has nowhere to go wrong (M20 U5,
> [D-233](./09-decision-log.md); it was the editor until then). It is asserted in a test rather than
> worked around, because widening `declare_format` to dodge D-220's divide is a decision that
> belongs to the maintainer.
>
> **M24 U2 closed it without widening it** (D-253).
> `connect_formats` joins two formats that both exist — a `link` on one, and optionally the
> aggregate the other folds back along it — through the same `adoptFormat` the graph calls, and it
> **only adds**: a plan with any step but `ADD_COLUMN` is refused, a required link on a format
> with rows is the reconciler's own refusal, and re-pointing or removing stays at `#/connections`.
> **U3 added the other two** (D-254): `extend_format` adds columns and
> identities on the same only-adds terms (lifted by M38 U6, D-412:
> it renames, retypes and removes as the sheet does), and `delete_format` removes a whole format, refused while
> another refers to it. The engine now owes no tool ([`parity.md`](./parity.md)).
> **U4 made a column able to be unique** (D-255): `declare_format`
> and `extend_format` take it, and every row write refuses a repeat naming the row that holds it.
> **U5 lets a link be written by name** (D-256): `record_format_rows`
> and `update_format_rows` take `supersedes: "D-240"` wherever the target's naming column is unique,
> and a batch may name its own rows — no `format_rows` call to find an id first.
> **M38 U5 widened it** (D-411): a name one row holds names it in any
> naming column, and two rows sharing a name are told apart by columns — `ingredient: {name: "Salt",
> brand: "Fine"}`, exactly one row or refused. `format_rows` takes an `offset` and says the next one,
> and a total or derived column by name in `columns`; `document_info` leads with the formats.
> **M27 U6 made a write conditional** (D-304): an `update_format_rows`
> edit names its row by `where: {ref: "M27 U6"}` instead of an id, and `expect: {state: "planned"}`
> refuses the batch unless the row still holds that. Every plugin write holds `<document>.lock` from
> read to rename, so two sessions claiming one unit cannot both get it.
> **U6 added three types** (D-257): `decimal` takes a `scale` and a
> figure as `"3.5"`, stored as a whole number and refused rather than rounded past its places;
> `month` is `2026-09`; `instant` is written with its offset. `bp` and `%` are units.
> **U7 added row constraints** (D-259): `declare_format` and
> `extend_format` take `constraints: [{ rule, note }]` — `x is required [only] when kind is A`,
> `at most one of a, b`, `amount is at most 0 when direction is OUTFLOW` — and every row write
> refuses a row that breaks one, quoting the rule.
> **U8 lets an aggregate fold only the rows that match** (D-260): an
> aggregate takes `where: "deduction_type.reduces_net is true"` in `declare_format`,
> `extend_format` and `connect_formats` — one enum or boolean, one hop at most, one member — and
> the figure beside a row says which rows it folded. **M36 U04** (D-380)
> added `is not X` (an empty cell passes), `is one of X, Y` and `is empty` / `is not empty`, to a
> total and a rollup alike.
> **M26 F1 added `readers`** (D-293): a format's readers with an id
> each, `rename` and `forget` lists, dry-run until `commit`. Forgetting takes back no row.
> **M29 U2 lets a conversation move columns** (D-332): `extend_format`
> takes `order`, every column once, the new ones included; no row changes, and the answer says when
> the rows are called by another column afterwards. A pack's naming column stays first.
> **M25 E5 locked a pack's formats** (D-274): `format_rows` and
> `formats` read them as ever, and every generic write — `record_format_rows`, `update_format_rows`,
> `delete_format_rows`, `read_onto_format`, `supersede_reading`, `apply_rules` onto one,
> `delete_format` — refuses in the dry run with the pack's own sentence saying where instead.
> `extend_format` and `connect_formats` still add a person's own column to one.
> **M29 F11 taught `apply_rules` a `link`** (D-353): with `format` the
> format the link is on, it fills that link's empty cells by its `found_by`, dry run first — a set link
> is never moved, and a row with no match or two is named and left empty.
> **M25 E4 added `apply_rules`** (D-273) and `rule_sets` on
> `declare_format` and `extend_format`: a format's rows as rules setting a link of another format —
> `transaction.category from target when merchant_normalized matches pattern as contains first by
> priority, recorded in category_source as RULE, never over MANUAL`. A write of the target applies
> them by itself; `apply_rules` runs one over the rows already there, dry run first. A person's value
> is never overwritten, and a tie is named rather than picked. It cost the engine-only surface its
> margin: `declare_format`'s description was tightened to stay under the 30,000-character budget.
> **M34 U4 added every row** (D-397): an aggregate may say
> `every: true` in place of `over_column` — every row of `over_format`, on `declare_format` and on
> `extend_format`, which takes `aggregates` now. A degree states its average; an identity proves it.
> **M25 E3 added two picks** (D-272): an aggregate's `of` may be
> `latest` or `earliest`, with a `by` naming a date, month, instant or integer of the source —
> `{ of: latest, by: as_of, works_out: price }` — on `declare_format`, `extend_format` and
> `connect_formats`. Beside a row it says which day it came from; a tie at the top is `unchecked`.
> **M25 E2 added `format_rollup`** (D-271): a figure per month, and
> per linked row, that a format declares as `rollups: [{ name, works_out }]` on `declare_format` or
> `extend_format` — `sum of amount by month of charge_date or transaction_date and category where
> direction is OUTFLOW`. One `GROUP BY`; money per currency; a month with a row that cannot answer
> is `unchecked` and names it. The format's page shows the same table.

### Derived columns, the list, the agenda and a fourth constraint

> **M29 U3b added derived columns** (D-334): `derived: [{ name,
> works_out, note }]` on `declare_format` and `extend_format` — `price * (1 + vat)`. `formats` lists
> each with what it comes out as; `format_rows` prints it marked *(derived)*, or names the empty
> input. Anything that opens the file reads them in the view `fmt_<name>__derived`.
> **M29 U4 added `time`** (D-335): a column type taking `"09:30"` (or
> `"9:30pm"`), and `end - start` of two times or two dates in a derived column — hours, past
> midnight too, or days — which a rollup may sum.
> **M49 U1 added a date moved by whole days** (D-471): `last_reviewed + 7 days`, `start + 2 weeks`
> as a computed date or one side of a claim; `format_rows` sorts by a computed column and holds a
> computed date to a value in `match`.
> **M49 U2 added today, in questions only** (D-472): `match:{due: "within 14 days"}` (or `before
> today`, `after today`, `today`) in `format_rows` and `show_format`, the same words in a rollup's
> `where`, and `days_left = due - today` as a computed column; the day is the plugin's own clock. A
> claim, a declared total or a rule set naming today is refused.
> **M37 U3 held a column to several values** (D-476): in `format_rows` and `show_format`,
> `match:{state:[planned, in_progress]}` is any of them (a list column, holding any), `{state:{not:
> built}}` or `{not:[a, b]}` none of them with an empty cell let through, and `null` the empty cell
> — `{owner:null}`, `{owner:{not:null}}`, `[planned, null]`: D-380's words for a declared filter, in
> a question. `where` and `expect` still name one value per column.
> **M53 U7 added dashboards** (D-521): `arrange_views view:dashboard format:task add:[{saved:"Due
> today"}, {rollup:done_by_month}, {total:"Open", count:true, match:{state:{not:done}}}]` puts
> blocks on a format's dashboard — a saved view, a rollup's chart, a headline total (a `count`, or the
> `sum` of a number or money column, under a `match`) and nothing else — and `order` and `remove`
> take blocks' names; with no `format` it is the document's, each block naming its `format`.
> `show_format view:dashboard` (no `format`: the document's) draws it, its text naming every block
> with what it holds now. `start_here` is unchanged.
> **M53 U5 added saved views** (D-520): `arrange_views view:saved name:"Due today" kind:list
> match:{due:"today"}` keeps a format's filter, folds, columns, sort and kind under a name — the
> address as the app spells it, so `today` stays the phrase — and `rename` and `delete: true` change
> one; `show_format view:"Due today"` draws it and `format_rows view:"Due today"` reads it, a `match`
> given beside it added to the view's. `formats` with a `format` lists them.
>
> **M53 U4 added the list** (D-519): `show_format view:list` draws a format's rows one line each,
> grouped as `arrange_views view:list` says (`group`, `line`, `done <members>` — words one column
> holds together, `group line`), each row named with its tick; every format has one. **A row has a
> tick only where `done <members>` is set** (M53 F1, D-524): nothing guesses it, and a list with none
> is plain lines.
>
> **M49 U3 added the agenda** (D-473): `show_format view:agenda` (no `format`) draws every dated
> format's rows from today grouped by day, overdue above it where a format says what finished is;
> `match:{date: "within 14 days"}` holds each format by its own agenda date. `arrange_views
> view:agenda` sets `date`, `done <members>` and `line`, and `start_here` asks what is due within 7
> days of the formats whose date was chosen.
> **M37 U5 chose what a line draws** (D-478): `show_format`'s `columns:{unit:[title,state]}` is
> which columns a format's lines and cards draw, written into the frame's address as
> `?columns:unit=title,state`; on a roadmap `match:{"unit.state": planned}` holds the rows it folds.
>
> **M25 E1 added a fourth constraint** (D-270): `one row per account,
> natural_key`, and `one row per plan when mode is REMAINDER` — unique together, an index rather than
> triggers. Every row write refuses a repeat naming the row that holds the values, and
> `extend_format` refuses adding one over rows that already share them, listing which.

### What is missing, intake, and the first call (M19 U6, U7, M27 U5)

> **U6 counted what is missing rather than arguing about it** ([D-234](./09-decision-log.md)).
> `src/parity.test.ts` derives the engine's capabilities from the writes both halves share and
> names the half each one lacks. Each gap carries the assertion that keeps it honest, so the day one
> is built the audit goes red rather than the prose going stale — **which is exactly how U7 closed
> two of the six** ([D-235](./09-decision-log.md)). The four left were what **M21** was scoped from, and since D-249 the tool halves are **M24**'s:
> **no tool alters a declaration, connects two formats that already exist or deletes one — and no
> screen writes a unit.**

> **U7 gave intake its tool half** ([D-235](./09-decision-log.md)), and it is the pack's reader
> generalized rather than the pack's screens rewritten. Since M24 U10 a reading may also write
> **one header row of another format** — `header: { format, link, cells, fixed }`, cells as
> positions with a negative row counted from the end — and every line links to it
> (D-262). `read_onto_format` takes any `.xlsx`,
> `.xls` or `.csv` — and since M34 U7 a Markdown note or a folder of them, a note a row
> (D-400), with its subfolders on
> `recursive`, and since M48 U2 a `.json` file of rows (D-468) — onto a declared format and `supersede_reading` takes back exactly what one file
> wrote, keeping the mapping; since M38 U3 a source read again updates its rows by a key, naming
> what changed, was added and is gone (D-408), and since M50 U3 a unique column keys any file against every row of the format, so next month's export updates last month's rows (D-522). Since M38 U4 `items` reads a note's list items or table rows onto a second format, each linked back to its note's row (D-410). **Nothing in either parses anything** — `readWorkbook` reads the
> file, `sheetReading.ts` is the seam, and `readRows` and `tally` are the screen's own functions —
> and **the dry run is the preview**, which is why this is two tools where the pack needs
> `statement_preview` beside `import_statement`. Two things a grid gave a person for free are the
> whole of what was new: the mapping printed as *column · the file's own header · key · first
> value*, so a moved column is visible, and **a fixed `link` checked against the rows that exist**,
> which the screen gets from its select and which `insertRows` would otherwise write dangling.
> **Since M34 U2 it reads many files in one call** (`files`, D-395),
> each onto its format, in the order their links need, the plan the write rehearsed and rolled back.
> **Since M34 U3 every read says what looks wrong, unasked** (D-396):
> every line of the file accounted for (heading, read, refused, empty, summing to its lines), and
> what the engine sees in each format written — a link empty where most rows fill it, rows the same
> in every column, identities failed or unchecked. `format_problems` says the same on demand.

> **`start_here` is the first call of a session** (M27 U5, D-303). It
> takes a path and nothing else, and answers every question the document's own views declare: each
> `ready` view (rows in a ready member whose `waits` link names nothing still open) and each `start`
> view (`is <member>` on an enum, `is true`/`is false` on a boolean, `latest <count>` on a date or
> number). The ledger declares three — transfers, card settlements, payments to confirm (D-382). Shaped in D-095's sense by
> construction — one format, one member, one count, no join — and each answer prints the
> `format_rows` call that lists it whole. **On a document that keeps the ledger, or that declares no
> question at all, it then says where new work begins** — `formats`, then
> `read_onto_format` (a spreadsheet, a `.json` of rows or a folder of Markdown notes) or `declare_format`
> (M34 U1; reworded in M42 F5, D-506, so it no longer measures the work against money). **And it ends with what a row looks like** (M47 U2,
> D-460): one line per format the document declares, generated from the declaration by
> `compactDeclarations` — required columns in bold, types, enum members, what a link points at, the
> key a money or quantity takes, bounds, worked-out columns — and the line that every write dry-runs
> until `commit: true`. A pack's locked formats are named, not spelled out. A week on three documents
> found every session calling `formats` once per format before it could write a row; `formats` stays
> the whole declaration, with its prose. `CLAUDE.md`'s *Ask the document* table is written from
> the same `startQuestions`, and `pack.test.ts` fails when the two disagree.

## The twenty-first tool, and what adding one costs

> **Five more at M16 U12** (D-207), and the same accounting held: `investments` and its four writes
> cost one file and one test file, and the one thing worth carrying back into this note is that a
> **write can be a confirm surface**. `record_positions` runs the app's own `holdingReconciles` and
> `pricePossible` over the figures it is about to store and prints both verdicts in the dry run —
> because the model transcribing a broker statement is a proposer like any other, and the dry run
> was already the place a person says yes. The gate gained something to look at.


`create_category` (D-109). `choose_categories` keeps or archives the shipped list and nothing on
the surface added to it, so a conversation that needed a category the list never had had nowhere to
go. D-095 answered this case before it happened — a question no tool answers is a request for a new
shaped tool, never a reason to reopen the general query — and this was the first time obeying that
cost anything. **It cost one file and seven tests**, which is the cheapness D-095 asserted, now
measured rather than assumed.

It takes no dry run and no backup, and not because it is small: the write is *additive*, so there
is no prior state a `.bak` could hold. An archived category of the same name is **brought back**
rather than twinned, which is the case that matters — onboarding archives most of the shipped list,
so the name a conversation cannot find is usually right there with its history attached.

**Since M28 U6 (D-315) the rest is here too**: `edit_categories` renames, moves, reorders, archives,
colours, sets a monthly budget (its Plan bucket) on, merges and deletes categories (merge and delete alone in an entry;
a delete of a category in use needs `move_to`, a category of its kind, and is refused by name when there is none — D-340), and four tools do what the Transactions screen's
row menu does — `set_excluded_from_totals`, `set_transaction_notes`, `set_card_payers` and
`skip_merchants`. All take a list and dry-run until `commit: true`. `transactions` prints each row's
id, whether it counts, and its note, so ids come from it. Still screen-only: undoing a filing.
Since M30 U2 (D-355) `set_transaction_holdings` names the holding a row bought or sold inside its
account and how much — the detail panel's *Bought or sold*; such a row is in no total.
Since M30 U3 (D-356) `transfers` lists the pairs every import suggests between two of the person's own
accounts and `answer_transfers` answers them — the accounts screen's queue and a row's *Transfer*.
Since M31 U1 (D-367) `count_card_charges` counts a card charged in the bank with no statement read as spending, and
`set_no_pay_months` says a month had no pay — the two answers of Home's *Waiting for an answer* that had none.
Since M30 U5 (D-358) `record_holding_readings` writes what a statement printed a holding was worth on a day —
a goal's *What the statements say it is worth*; each reading's checks (cost, quantity, quantity × price, a
cash line against its account) are in its answer and in `savings`.
Since M30 U6 (D-359) `record_holdings_statement` writes a broker statement the conversation read — the
movements onto the account and the holdings table as readings, in one batch. Each row's printed balance
must be the one before it plus the row, and is its key (value date, amount, balance after), so an
overlapping file adds only what is new. No screen reads a broker PDF, on purpose (D-359).

**Since M28 U7 (D-319) the Plan screen is here whole**: `plans` reads each plan with what every fixed
expense does to it (out of net, part of the split, ignored) and its buckets; `plan_month` works one plan
out for a month and, with `commit`, records its planned deposits and payments and gives the month the plan,
and with `months` / `back_to_default` gives months the plan or puts them back on the default (M31 U4);
`set_plan` makes, copies, resizes and deletes plans and points their buckets; `set_fixed_expense_roles`
sets the per-plan choice (a payslip deduction is refused); `edit_fixed_expenses` edits, ends or stops
tracking a bill. Each takes a list and dry-runs until `commit: true`; ids come from `plans`.

**Since M36 F1 (D-391) `set_deduction_types` is how a fund finds its payslip lines.** A pension
line is a deposit into a fund only because its deduction type names the fund, and until then only the
deduction types screen could say so. It takes a list of types (by id, name or what the slip calls it)
and sets, per type, what the screen sets: *Counts as* (out of net, saving — marked *set by hand* when it
is not the kind's guess, and `guess` puts that back) and *Pays into* — one fund, goal or debt, the other
two cleared. A fund or a goal takes a saving line and a debt a loan repayment, and a target of the wrong
kind is refused by name. Whole batch or nothing, a dry run until `commit: true`, through
`updateDeductionType` — the screen's write — and the same `syncPayroll` after a link. **Since M36 F2
(D-392) it is the whole screen**: an entry without `type` makes one (name, `on_the_slip`, kind, and the
kind's guess for its flags), `name` renames, `kind` changes the kind with the flags following while they
are the guess, `remove: true` removes, and `order` puts the types it names first. A built-in, a type a
stored payslip line names, a type another row links to, and a name another type has are refused by name.

## What the first real session cost, measured

Three findings, all from using it rather than reading it (D-110). Worth keeping in this note
because each one is a shape decision that would otherwise be re-argued from taste.

**The bill is round trips.** The whole surface is 24KB of JSON, about 5.9k tokens, sent once per
conversation and cached; a complete onboarding run returned 6.8KB. Neither is the expense. **Every
tool call is a model turn that re-sends the entire transcript**, and the tools were shaped so one
intent took dozens: one merchant per `assign_category` call and a dry run by default meant forty
merchants was eighty turns. So `assign_category`, `create_category` and `add_institutions` take
**lists**, and one list means one preview, one confirmation and one `.bak` for the batch. An
onboarding that sets up two named accounts went from **8 calls and 6.8KB to 4 calls and 1.8KB**.

The old single-argument forms are **refused with the sentence that rewrites them** rather than kept
alongside. Two ways to say the same thing is a surface nobody can keep honest, and the window for
that change is now, before a stranger's conversation depends on the old shape.

**The gate was in the wrong place.** `NO_ONBOARDING` (D-097) says a document in its first run holds
nothing older than the current conversation — which justifies *skipping the backup*, and was
written as a *refusal*. So a card opened last month could not be added and a category could not be
archived from a conversation, both things the app allows on any day. The invariant now picks
between two protections rather than between doing it and not: `writeWithBackup` copies the document
outside onboarding and skips the copy inside — *the document holds no account or transaction* since
D-330, when onboarding went.

`keep_ids` stayed behind on purpose. "Keep these, archive the rest" is right on a fresh document and
a wrecking ball on one holding a year of filed rows. The argument decides the semantic and the state
decides which arguments are legal — `archive_ids` and `restore_ids` always, `keep_ids` during the
first run only. **Ungating is not the same as discarding the reasoning behind the gate.**

**Nothing said what the helper was for.** Twenty-one accurate tool descriptions, and a conversation
that waited to be told rather than asking for the payslip in the user's downloads folder. MCP's
`initialize` carries `instructions` and **Claude Code renders them** — verified, not assumed. They
are sent once and cached, which makes them the right home for the goal (ask for statements,
payslips and fund reports **by name**), the working practices (batch; decide then confirm once; do
not re-read what a tool just told you), and the vocabulary.

The instructions also say plainly **what is not here** — paychecks, funds, savings, debts, the
splitter, and category management. That is the sentence that went stale twice already, so the test
over it asserts the *capability*: every tool it names must exist, and every screen it calls app-only
must have no tool matching. The day `record_paycheck` lands, the assertion goes red in the same diff.

## The tool that lied about itself

The onboarding flow's import step told its reader **the plugin cannot import** — true when it was
written (D-096), false from the moment D-100 built ingestion, and still on screen weeks later. A
conversation reached that step, believed it, and skipped an import the plugin could have done,
telling the user to go drop the file on the app window instead.

The test suite did not catch it. It *pinned* it: the onboarding walkthrough asserted
`toContain('cannot do it yet')`, so the green suite was certifying the absence of a feature that
had shipped. Building ingestion did not make one test fail, because no test connected the tools to
the sentence describing them.

**This is the second instance of one failure mode**, and that is what makes it worth a section
rather than a fix. D-104 found `document_info` printing no account ids while three tool
descriptions sent their caller there. Both times: the capability was built, the prose around it was
not updated, and *the prose is the interface*. A tool description is not documentation that a
reader may skip — it is an instruction the caller follows, so a stale one does not go unread, it
actively talks a conversation out of a capability sitting in the same tool list.

**The rule that follows:** a test over prose asserts the *capability*, not the wording. The import
step's test now checks that the step names `statement_preview` and `import_statement`, which is a
claim that goes false the day either tool is renamed or removed, rather than a string match that
survives the feature changing underneath it.

## What a tool says it does to the machine (M42 U1)

**Every tool on both servers carries a title and the hints a directory's review checks**, and
`src/plugin/annotations.test.ts` fails one without them. What each hint claims here: `readOnlyHint`
— never writes, so a write that dry-runs until `commit: true` is not read-only; `destructiveHint` —
can take away something a person kept (a row, a column or claim, a saved reader, a plan, a
category), which correcting a value is not, since a committed write copies the document first;
`idempotentHint`, on every write — the same committed call twice leaves the document as the first
left it; `openWorldHint` — false on all of them. `tools/list` copies each title into
`annotations.title`, so an older client reads it too. **Nothing a model reads cites a decision or a
milestone** — the same test greps every description and both instructions for one, because a
stranger cannot look it up.

## Installing it

**`.mcp.json` is checked in**, at the repo root, running `node dist-plugin/server.mjs
--engine-only` with a **relative** path. A Claude Code session started in this directory finds it
and asks to approve the server once.

**`--engine-only` since M22 U0** ([D-239](./09-decision-log.md)): it offers the engine's nine tools
and not the ledger's thirty-seven. Measured against the built server — **46 tools and ~23,890
tokens become 9 and ~4,970** — and that number is paid on *every turn* of every session the server
is loaded in, not once. This entry is the **repo's** config, for sessions working on the engine;
a person using the ledger on their own document registers the server themselves, without the flag,
which is what `claude mcp add` below is for. **The two registrations are not a duplicate to clean
up — they are different jobs**, and the only thing worth checking is that a stale one is not
loading the full surface into engine sessions by accident.

**The app shows the same thing at `#/mcp`**, the rail's *Assistants* (M26 U7, D-295; named in M43 U3, D-451): every
tool in plain words, grouped, and both registrations with the open document's path filled in.
Its list is `src/plugin/catalog.ts`, which `catalog.test.ts` pins to the server's definitions.

Relative rather than absolute because the file is versioned and shared — an absolute path would be
one machine's, and the first person to clone this would get a server that cannot start. The cost is
that the entry only works from a session rooted here; reaching the document from anywhere else is
`claude mcp add emerald -- node <absolute path>`, which is the user's own config and
not this repo's business.

**The wiring was the gap between "built" and "usable".** M7 delivered the server and never said how
a client reaches it, which made a complete feature unreachable by anyone who had not read
`build:plugin`'s output path. Verified end to end rather than asserted: a headless session against
this `.mcp.json` created a document and read it back at schema 20.

What a user needs, in order: Node, and `npx emerald-mcp` (below) or `npm run build:plugin` once in a
checkout — `dist-plugin/` is **self-contained** since M42 U2; a `.emd` at the app's current schema, or
`create_document` to make one — with the `packs` it should keep, none by default in either mode
(D-506, reversing D-405's ledger on the full server), and `keep_packs` for one later, which also brings a
kept pack up to date: its new columns and renames, and its formats' notes and views' settings
wherever the document still holds an earlier build's, keeping and naming what a person changed
(D-491); and an absolute path to it, since every tool takes one.

**How it ran until M42 U2** (M41 U4): `node dist-plugin/server.mjs`, with three packages resolvable
from where it sat — `@modelcontextprotocol/sdk`, `sql.js` and `xlsx`, the imports it kept external.
Now every package is bundled and the folder is the npm package, below. The conversation views ride
inside it. **The Claude plugin runs this package** (M42 U4, below), and the desktop extension packs
its `server.mjs` for a double-click install (M42 F9, D-509), never for the directory, which no
longer takes one (D-498).

### The npm package, `emerald-mcp` (M42 U2, D-497)

**`dist-plugin/` is the package, as it is built.** The repository's `package.json` is the app's and
stays private; `npm run build:plugin` ends with `scripts/npm-package.mjs`, which writes a manifest and
a README beside the three files — the version, licence (AGPL-3.0-only, D-430), author and repository
read from the root manifest rather than kept twice. **No dependencies**: each pass bundles every
package it reaches (`published` in `vite.config.ts`, with `sql.js` as its browser build — the same
wasm, handed over as bytes), so an `npx` downloads one 2.9 MB tarball and installs nothing else, and
`THIRD_PARTY_NOTICES.txt` travels with it. Node's own modules are the only imports left. Engines:
`>=20.19.0`, the oldest Node CI runs it on (D-510): `.github/workflows/package.yml` builds it on Node 24
and runs `scripts/check-package.mjs` on 20.19.0, 22 and 24 — the server's handshake, a document written
and read back, both hooks, and an `npx` install of the packed tarball, which fails on npm's
`EBADENGINE` warning. That warning is printed before every hook on a Node below the range; the
range was `>=24` until 0.1.6, and a cloud host's Node 22 showed it at every prompt.

**One package, a bin each** — not one bin with subcommands, and not two packages:

| Bin | File | What runs it |
| --- | --- | --- |
| `emerald-mcp` | `server.mjs` | `npx -y emerald-mcp` — every tool; `--engine-only` for the engine's alone; `watch` as above |
| `emerald-hooks` | `hooks.mjs` | `npx -y -p emerald-mcp emerald-hooks start-here <folder>`, `… rows <folder> inbox --match state=new --once-per-session` |
| `emerald-status-line` | `status-line.mjs` | `npx -y -p emerald-mcp emerald-status-line [<folder>]` |

The full and engine-only servers are one file and a flag, as they always were: two packages would be
the same 7.5 MB twice for a difference `tools/list` makes at run time. The hooks and the status line
are bins of their own because each is already its own entry (D-494) and both are on a clock — the
inbox hook runs on every prompt and the status line has 200 ms — so a dispatcher in front would
either load the server's bundle to reach them or be a fourth file. The status line spawns
`hooks.mjs` beside itself to refresh its cache, which holds inside the package as it did in
`dist-plugin/`.

**What an npx call costs, once cached** — measured 2026-10-18 on the maintainer's Windows machine,
Node 24, npm 12, the inbox hook against a synthetic document: **~0.35 s** as `node hooks.mjs`, **~2.1 s**
through `npx` with the package installed in the folder, **~2.7 s** through `npx -y -p <tarball>` from
the npx cache with nothing installed. npm's own start-up is the difference, and it is paid on every
prompt. And for a registry spec npx asks the registry about it each time — `libnpmexec` fetches the
manifest with `preferOnline` — unless `--prefer-offline` is passed, which wins in
`npm-registry-fetch`'s cache mode; a pinned version never changes, so the plugin can pass it safely:
`npx -y --prefer-offline emerald-mcp@<version> --engine-only`. The plugin pays it on every hook, by
the maintainer's choice (D-499, below).

**Publishing is the maintainer's act** on the project's npm account: `npm run build:plugin`,
`npm run check:package` (the CI check, on whichever Node runs it), then `npm publish --access public`
from `dist-plugin/` (`npm pack` there makes the tarball to try first).
The done-test, run from the tarball: installed in an empty folder, `npx emerald-mcp --engine-only`
answered `initialize`, listed 28 tools (85 without the flag), created a document with the
development pack and answered `start_here` on it with the unit recorded there; `npx emerald-hooks`
printed `start_here` and the inbox row, and `npx emerald-status-line` printed `inbox 1 new`.

### The desktop extension, `emerald.mcpb` (M42 F9, D-509)

**The same `server.mjs`, as a file a person double-clicks** to add Emerald to the Claude desktop
app — chat, and Cowork on that computer — with no Node to install and no configuration to edit.
`npm run build:mcpb` (after `build:plugin`, `scripts/mcpb.mjs`) packs `release/emerald.mcpb`: the
server, its licence files, `build/extension.png` and a manifest whose tools are the server's own
list. `server.type: "node"`, `node ${__dirname}/server.mjs --engine-only`, darwin and win32,
`runtimes.node` `>=20.19.0`, the package's floor. The release workflow builds it on every tag and attaches it beside the
installers: `releases/latest/download/emerald.mcpb`. It is not submitted anywhere (the directory
takes none) and does not update itself.

**Which Node runs it** (measured on Windows, 2026-10-20): the desktop app 2.42304 ships Node 24.21.0
(Electron 44.7.2), and installed, the extension ran in the app's own utility process — *built-in
node is compatible*, its log said — serving chat and Cowork from that one process. By the app's code
it does so whenever its Node satisfies the manifest's range or it finds no system Node, unless
`isUsingBuiltInNodeForMcp` is off. Claude Code — the Code tab — runs a plugin's `.mcpb` on the
system `node` and fails without one, so the plugin below keeps `npx`.

### The Claude plugin (M42 U4, D-498)

```
/plugin marketplace add kfireliyahu/emerald-emd
/plugin install emerald@emerald-emd
```

**The plugin is `hosts/claude/`, and nothing builds it.** `.claude-plugin/marketplace.json` at the
repository's root lists it, so it installs from the public repository with no review; what it ships
is the manifest (`.claude-plugin/plugin.json`), the hook set, the `declare-a-format` skill, the
development pack's three workflows (M42 U7), the `emerald-setup` skill (M42 F8) and a README for a stranger. **Everything it runs is the published package, through `npx`, pinned** — the
maintainer's *use npm for it* (D-499, amending D-498's launcher) — but one hook, below:

- **The server**: `npx -y --prefer-offline emerald-mcp@<version> --engine-only`, once a session.
  Claude Code on Windows starts it as written. The views draw from it with nothing else to set up —
  they ride inside the server (M41).
- **The hooks**: `npx -y --prefer-offline -p emerald-mcp@<version> emerald-hooks …`, the same
  arguments as this repo's. npm's `npm notice run …` lines go to stderr, which a hook that exits 0
  keeps out of context.
- **The status line** is a person's setting, not a plugin's:
  `npx -y --prefer-offline -p emerald-mcp@<version> emerald-status-line`.

**Where the host starts no plugin server** (M42 F8, D-508). Chat and Cowork take a plugin from the
person's claude.ai account, and a Cowork task in the cloud loads its skills and hooks but skips its
MCP server on purpose. The log says `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS is set` (found on the
maintainer's work Mac, 2026-10-20). An Emerald installed in the Claude desktop app itself (the
`.mcpb`, or `emerald-mcp` in its own `claude_desktop_config.json`) runs on that computer and reaches
chat and Cowork there. A cloud task reaches it too, through the app's bridge to the computer, as
`mcp__remote-devices__emerald__*` (seen on the work Mac the same day, M42 F10). That is how the maintainer's Windows PC has run it
in Cowork all along. The plugin says so twice, both from its own folder, so a change needs a plugin
release and never a new package:
- **The `emerald-setup` skill** holds the steps once: find `npx`, the file on macOS and Windows,
  the entry (`cmd /c npx …` on Windows), quit and reopen. Its description fires on a session asked
  about a `.emd` that has no Emerald tools.
- **A third `SessionStart` hook**, `node "${CLAUDE_PLUGIN_ROOT}/hooks/no-server.mjs"`, plain Node
  with no imports but Node's, prints that skill when `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS` is set
  and nothing otherwise. A hook can't see the session's tools, so both open by telling the model to
  check its own: any tool with `emerald` in its name, under any prefix, is the person's Emerald, and
  the steps are skipped (M42 F10). The first version said the tools were missing while the bridged
  ones worked.

`scripts/pin-plugin.mjs` moves the skill's `emerald-mcp@<version>` with the other pins.

**What npx costs, accepted** (measured 2026-10-18 on the maintainer's Windows machine, cache warm):
the inbox hook **~1.95 s before every prompt** (against ~0.35 s for `node` on the file), `start-here`
~2 s once a session, the server's start ~2.2–2.6 s once a session, and the status line ~1.7 s — over
its 200 ms, so it shows the line late rather than not at all. The first run of a version also
downloads the 2.9 MB tarball.

**The pin is written once**, as the manifest's `version` before any `+`: every pin — the server's
and each hook's — equals it, and it never leads the root `package.json`'s, which `build:plugin`
stamps on the package (`hosts/claude/plugin.test.ts`). The marketplace serves `main`, and a pin
pushed before its publish installs nothing, so **the pins follow the publish** (D-500): the version
is cut and pushed, the maintainer publishes it, and `node scripts/pin-plugin.mjs` — which refuses
until npm has the version — moves the pins, in a commit of their own.

**The manifest's `version` is how an installed plugin learns of an update** (M42 U7, D-504). Claude
Code computes a version for an installed plugin — the manifest's `version` first — and replaces its
cached copy only when that differs from the one it installed; auto-update is off by default for any
marketplace but Anthropic's own, so a person turns it on (`/plugin` → Marketplaces) or runs `claude
plugin update emerald@emerald-emd`, and the new version loads in the next session or after
`/reload-plugins`. So a change to what the plugin ships cuts a new version even with no package
behind it: **`<pin>+<n>`**, the n-th plugin release on that pin, by `node scripts/pin-plugin.mjs
--plugin`, which asks npm nothing; a pin move makes it the bare package version again. Both record
`hosts/claude/release.ts`'s digest of the shipped files — the manifest without its version, the hook
set, the skills, the README — in `hosts/claude-plugin-release.json`, and `plugin.test.ts` fails when
the digest has moved under an unchanged version. Leaving `version` out (so the commit is the version)
was rejected: every push to `main` would be an update.

### The MCP Registry (M42 U3, D-500)

**Listed as `io.github.kfireliyahu/emerald`** in the official registry, from `server.json` at the
repository's root: the npm package `emerald-mcp` at one version, run by `npx`, over stdio. The
registry keeps only that metadata, and takes a version only once npm has it and the published
manifest's `mcpName` is the listing's `name` — which `scripts/npm-package.mjs` stamps from
`server.json`, so 0.1.0, published before it, can never be listed. A version is cut in the root
`package.json`, `server.json` and `PLUGIN_VERSION` together (`src/plugin/registry.test.ts`).

**`.github/workflows/registry.yml` keeps it in step with npm**, with no secret and no tag: on a push
to `main` that changes `server.json` or the plugin's manifest, daily, or `gh workflow run
registry.yml`, it asks npm and the registry, and only when npm has a version the registry lacks
does it run `mcp-publisher` (pinned, checksum-checked) to `validate` against the live schema, `login
github-oidc` and `publish`. A release, then: cut the version and push; `npm run build:plugin` and
`npm publish --access public` from `dist-plugin/` (the maintainer's); `node scripts/pin-plugin.mjs`,
commit and push — and that push lists it. The check: `curl
"https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.kfireliyahu/emerald"`.

**Proved on 2026-10-18**, in a throwaway `CLAUDE_CONFIG_DIR`: `claude plugin validate` passes (the
directory's link fields warn on this CLI, 2.1.177, and are accepted from 2.1.281); the plugin
installs from the marketplace on GitHub; `claude mcp list` shows `plugin:emerald:emerald`
connected; the manifest's own command created a document with the development pack and answered
`start_here` with its ready unit; a headless session with the plugin loaded called
`mcp__plugin_emerald_emerald__start_here`; and in a session's hook events, both npx hooks exited 0
with `start_here` and the inbox row on stdout. **The directory**, if it is ever submitted to, would
hold it for a reviewer (a pinned npx package) and would block the hooks'
`"$CLAUDE_PROJECT_DIR"` argument in a plugin that is a subfolder of its repository.

### A cold read before a release (M42 F7)

**What a stranger's model makes of the server is checked here, not learned from one** — D-506's
*built for money first* and D-507's *its main strength is checking numbers add up* were both found by
a session at the maintainer's workplace. After `npm run build:plugin`:

```
node scripts/ask-cold.mjs                  # both modes; --only engine|full, --model <m>, --out <file>
node scripts/ask-cold.mjs --question planning --server <a build kept aside>   # one question, an earlier build
```

Each question in the script's list is its own fresh `claude -p` in a new empty temp folder, with
`--strict-mcp-config` naming only `dist-plugin/server.mjs` (once `--engine-only`, once full),
settings from `project` only and no built-in tools — so no CLAUDE.md, skill, memory, hook or plugin
of this machine's reaches it, and a run that sees another MCP server fails. **It drops the
`CLAUDE*` and `MCP_*` variables of the session that runs it and sets `MCP_CONNECTION_NONBLOCKING=false`**:
the desktop app sets it `true`, and then `-p` starts the first turn before the server has connected —
four of ten runs answered with no Emerald at all (*which Emerald do you mean?*) before that. It prints each answer with
the tools it called, the **red flags** matched mechanically (*money first*, *built for*, *main
strength is checking*, *add up*, numbers as the reason, *not designed for*, advice against moving
notes) and which of D-506/D-507's points it said; the answers go to a file in the OS temp folder,
never the repository. **A flag asks for judgment, it is not a failure** — the session reads the
answers against D-506 and D-507: any kind of thing; asking for rows instead of re-reading files; typed
fields and links; the same rows for every session; checks one benefit; a Markdown folder read in
place; packs optional. A question a session somewhere got wrong goes into the list.

**The planning question has its own flags and points** (M42 F16, D-513): a model at the
maintainer's work refused to keep a team's development planning here until argued out of it. Its
answer is flagged for *git or a tracker already covers it*, *binary, so not committed*, *not in
worktrees or the cloud*, *documents cannot talk* and *per-repository process*, and read for what
both instruction blocks now say right after their head: plans nobody owns (`PLAN.md`, notes) are
what it is for; one document across repositories; stored as text and committed, or one file outside
every repository; an inbox and an `elsewhere` column; a worktree session's landing proposed to the
main document's inbox. `--server` reads a build kept aside, so one session compares before and
after. **The `claude` CLI has to be logged in itself**: it drops the `CLAUDE*` variables of the
session that runs it, so a session whose host lends it its own sign-in gets *Not logged in* until
someone runs `claude` in a terminal and signs in.

It spends the maintainer's Claude usage through their own `claude` CLI (ten runs, $0.74 on the
default model on 2026-10-19), so it is a session's tool only: never in CI, never imported by `src/`, and the app and
the server still make no network call (D-124).

## Sequencing

**Now — M7**, taken ahead of M6's remaining lines (D-092). The original note said "after M4" and
that has been true since M4 closed; what changed is priority, not readiness. The reasons it is
safe to interleave: it wraps the repository layer, which M6's leftovers do not touch — those are
screens over queries that already exist — and it shares no file with them. The reason it is worth
interleaving: its risk is a runtime and packaging risk, and M0's principle is to prove the hardest
thing before building around it.

## Open questions

- ~~How the Desktop extension supplies a Node runtime~~ — **answered (D-509)**: the desktop app runs
  `emerald.mcpb` on the Node it ships, so chat needs none installed; the Claude plugin, in Claude
  Code and the Code tab, still runs on the person's own `node`, and so would a `.mcpb` named by it.
- Whether the web-chat fallback actually works end to end. **Still open**, and worth a cheap test
  before writing the skill: attach a `.emd` to a conversation and see whether code
  execution's `sqlite3` reads it.
- ~~Whether the plugin lives in this repo or its own~~ — **resolved (D-092): in this repo**, as a
  build output of its own beside the app's. Coupled release cadences is the cheaper
  problem; a published domain package, or worse a vendored copy, is the version the note already
  said should not be built.
- ~~Whether a plugin write should require the app to be closed~~ — **resolved (D-092): no**, and
  the app's mtime check is **built (D-103)**. See trap 2. What is still open, and deliberately
  parked: whether the app should write a lock file so the plugin's warning has anything to read.
- ~~How many `.bak` files to keep, and where they live~~ — **resolved (D-098)**: named with a UTC
  timestamp, **the last five kept**, and the tool says where the copy went in its own output. D-098
  put them beside the document; **D-455 moved them** to Emerald's own
  per-user folder, pruned by the moment in the name, and gave the app a list to restore from;
  D-457 sweeps a gone document's folder after 30 days.

## Related

[02 Architecture](./02-architecture.md) · [F03 Auto Categorization Engine](./packs/ledger/f03-auto-categorization-engine.md) · [F04 Paycheck Tracking](./packs/ledger/f04-paycheck-tracking.md)
