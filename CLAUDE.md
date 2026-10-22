# Emerald

**Excel that reads your documents and won't let you be wrong quietly** — and, underneath, the
domain layer between a person, a model, and their own data. A person works something out
with a model — what a thing is, which fields it has, what has to add up — and Emerald is where
that goes to stay true. It is local-first and document-based: no backend, no accounts, no network
call. The user opens a `.emd` file — a real SQLite database, **stored as text or as SQLite bytes and
chosen per file** ([D-246](./docs/09-decision-log.md)) — works, and saves it. Ships
as an unsigned desktop download; the same `dist/` is also a static site.

The spec is three arrows:

> **read a document / talk with a model → format (which is the data) → make connections to other
> formats**

**Intake · Format · Links.** A *format* is a kind of thing, declared rather than hand-written,
compiling to a real table with real types and real `CHECK`s. Prior structure is a dial rather
than two adapters — a card statement, a payslip, a photograph, an intent with no structure at
all — and the output is always a format.

The test the name buys: **if it is about presentation or storage, it is not the domain layer.**

## The ledger is a pack, and it is where all this came from

`src/` is still mostly a personal-finance app, and that is not debt — it is the **first pack** and
the on-ramp for an idea that is otherwise foreign to a newcomer. It also happens to be the entire
evidence base: four times, a real document destroyed a green test suite and taught the engine one
of its rules. **Since M25 it is nothing but declared formats, identities, links and pack code**
(D-214, D-282): a document keeps the ledger by declaring its formats, and the rail shows it when the
open document does. M20 U0's staging switch is gone.

**Its notes live in [`docs/packs/ledger/`](./docs/packs/ledger/README.md) and it is parked** — except
for M25's units, which move it onto declared formats (D-265). Take no other work from it.

## Read this first

The specification lives in [`docs/`](./docs/00-index.md). Two things orient a session:
[`docs/conventions.md`](./docs/conventions.md) — the contract between sessions — and **`start_here`** on `docs/memory.emd` (below) — where the build is: the
open milestones, the units ready to take, the open questions, the latest decisions. Read the one and call the other, then only the notes
the task needs. There is no status file: it repeated the rows and fell behind them (D-434).

Do **not** read all of `docs/`, and do not read the decision log end to end.
The full record of earlier milestones is kept privately; every decision is a `decision` row in
`docs/memory.emd` (`format_rows decision search:"…"`).

## Ask the document before you grep the docs

**`docs/memory.emd` holds this project's own memory as rows** — `decision`, `unit`,
`milestone`, `review_entry` and `open_question`, the development pack's declared formats in a real `.emd` (M22, D-240) — and
`rule` and `term`, the project's own formats beside them (D-435, D-436). The engine eating its own notes, and the `emerald` MCP server in `.mcp.json` is how you reach it.

**`start_here` is the first call** (M27 U5, D-303) — and **the `SessionStart` hook in `.claude/settings.json` makes it before you do** (M47 U1), while the `UserPromptSubmit` one prints a new inbox row in full once per session, then a one-line count (M51 U6), so never poll the inbox. **The hook's text drew nothing: asked to
*see* what is ready, the roadmap or the board, call `start_here` or `show_format` anyway — in the
Claude desktop app on `emerald-ledger`**, since the app draws only the servers it runs itself, never
`emerald` from `.mcp.json` (D-489, M51 F2) — and its first line is for you: follow it, say nothing to the person about drawing, servers or tools, and where it drew, never retype what the view shows (D-493). One answer says what is ready (planned,
and nothing it is blocked by still open), which milestones are open, what is still open, what is left
to review and the latest decisions. **The table is the pack's, not prose** — generated from the development pack's views
(`src/data/packs/development/views.md`); `pack.test.ts` fails when it drifts and prints the new one.

<!-- start-here: generated from the development pack's views; pack.test.ts checks it -->
| `start_here` answers | The whole list |
|---|---|
| **Ready to start** `unit`: state is planned, and nothing in blocks is still open (open is anything but built or dropped) | only `start_here` |
| `decision`: the 5 latest by date | `format_rows decision order:date descending:true limit:5` |
| `inbox`: state is new | `format_rows inbox match:{state:new}` |
| `milestone`: state is open | `format_rows milestone match:{state:open}` |
| `open_question`: state is open | `format_rows open_question match:{state:open}` |
| `review_entry`: state is open | `format_rows review_entry match:{state:open}` |
<!-- /start-here -->

Two questions take an argument, so they stay calls of their own: *what did a milestone build?*
`format_rows unit match:{milestone:M20, state:built}`, and *why is something the way it is?*
`format_rows decision search:"<the thing>"`. Every planned unit carries a `brief`.

*What is open?* was the sharpest measurement: in markdown those questions are spread over six
files and **one of them was written down nowhere at all**; the document answers it in ~450 tokens.

**It holds M19 onward — every decision from D-209 on, M19's units and review entries — plus every
engine decision before it, D-001 to D-208, and the ledger's M5-M7 and M13-M17.** That is where M22 U2
stopped, on purpose: **the ledger's M1-M4 decisions (D-001 to D-059 in `docs/packs/ledger/decisions.md`),
and units and review entries before M19, stay in the ledger notes and the private record — a miss
there means grep, never that the answer does not exist.** It is stored as text (D-246), so it diffs in git like any other file.

**If you make a decision, write the row as well as the entry** — and `npm run docs:check` now
fails when you don't (M22 U5): any `## D-xxx` in the log at or above the lowest decision the
document holds needs a row. **The columns are the document's, and `start_here` ends with them** (M47 U2,
D-460): one line per format, generated from its declaration — required in bold, the members, what a link
points at — and every write dry-runs until `commit: true`. `formats` with a `format` is the whole
declaration, with what each column means.

**The rules moved; the arguments did not** (D-435, reversing what this paragraph said since M22): the
item-shaped lists became `rule` rows, and `conventions.md`, `engine.md` and `product.md` keep what is
argument and procedure, which markdown is right for.

| Need | Read |
|---|---|
| What it is, who it is for, the finish line | [`docs/product.md`](./docs/product.md) — short, and plain on purpose |
| Working rules, style, gotchas, the laws | the `rule` rows — the queries under *Rules that are easy to break by accident* |
| What a thing is called, and what it must not be called | the `term` rows — `format_rows term search:"<word>"` before naming anything (D-436) |
| How a session works: before you start, the closing pass, done | [`docs/conventions.md`](./docs/conventions.md) |
| Where the build is, what is open, what is next | `start_here` on `docs/memory.emd`; the order of what is planned is `format_rows milestone order:position` |
| What Emerald *is* and is for, and the questions still open | [`docs/engine.md`](./docs/engine.md) |
| Stack, layering, the shell and what each build makes | [`docs/02-architecture.md`](./docs/02-architecture.md); the folder layout is the code itself, and how it is written is `format_rows rule match:{kind:style}` |
| The engine's tables | [`docs/04-data-model.md`](./docs/04-data-model.md) |
| Visual style | the `rule` rows with `scope: ui` (D-437); the values are `src/ui/theme/tokens.css`, and [`docs/11-ui-design-language.md`](./docs/11-ui-design-language.md) says which is where |
| The MCP plugin | [`docs/plugin.md`](./docs/plugin.md) |
| Reading a document onto a table | [`docs/mapping-templates.md`](./docs/mapping-templates.md) |
| Why something is the way it is | [`docs/09-decision-log.md`](./docs/09-decision-log.md) — every core decision indexed, the open milestones in full |
| Anything about money, categories, payslips, funds, and the ledger's math | [`docs/packs/ledger/`](./docs/packs/ledger/README.md) — parked |

## What a session costs

Measured over 67 sessions: 22,890 turns, and 6.28B tokens of context re-read to produce 4.7M
tokens of tool output. **A tool call costs the context it re-reads, not the size of what it
returns** — on a 400k context, a `wc -l` printing one line costs 400k. The bill is turns ×
context, so it grows quadratically with session length: a 700-turn session costs roughly four
times a 350-turn one for the same work.

- **Never read a large note whole** — grep for the anchor, then `sed -n 'X,Yp'` that section.
  The roadmap was read end to end 28 times and the decision log 26; those two were the largest
  entries in a Read column that was 22% of the bill.
- **Screenshot only when the answer is visual.** 168 screenshots were 16% of the bill.
  `read_page` and `get_page_text` cost a tenth and answer most of what a screenshot was asked.
- **Batch probes into one call.** Five one-line commands are five full context re-reads; the
  same five in one `Bash` call are one. Bash was 51% of the bill across 7,746 calls whose
  median result was under 2k chars — volume, not size.
- **Stop at the seam.** One unit per session, then commit and start fresh. The largest lever,
  because of the quadratic.

## Stack

TypeScript (strict) · React · Vite · sql.js (SQLite in WASM) · SheetJS · pdf.js (loaded on
demand) · Tailwind v4 · Zustand · React Router (HashRouter) · hand-rolled SVG charts · Vitest ·
Electron (the desktop shell — `electron/`, of which `src/` imports **`bridge.ts` and nothing
else**).

## Commands

```
npm run dev            # dev server
npm run build          # the app → dist/  (also what the shell serves)
npm run build:plugin   # the MCP server → dist-plugin/server.mjs
npm run check:package  # the built package's handshake, hooks and npx install on this Node
npm run build:electron # the shell's main + preload → dist-electron/ (two passes)
npm run dev:desktop    # dev server + the shell, with hot reload in the window
npm run desktop        # build everything and open the shell
npm run icons          # the app + document icons, cut from src/ui/emerald.svg → build/
npm run dist:win       # the Windows installer → release/  (registers .emd)
npm run dist:mac       # the macOS disk image → release/   (needs a Mac)
npm run test           # Vitest
npm run typecheck      # tsc --noEmit
npm run docs:check     # the closing pass, mechanical half — run it before you commit

node scripts/inspect-pdf.mjs <file.pdf> [--numbers-only]
                       # why a document read wrongly: its fonts, what they decode to, and
                       # every run's position. Prints; writes nothing; stays on the machine.
```

## Rules that are easy to break by accident

**The project's rules are rows of its own `rule` format in `docs/memory.emd`** (M40 U2, D-435) —
one place per rule, each with why it holds, the decisions behind it and the test that fails when it
breaks. Below are the few a session breaks before it would think to ask, rendered from the rows
marked `always`. The rest are a query, and it is cheaper than a read:

- **before touching an area** — `format_rows rule match:{scope:shell, state:live} columns:[statement, why]`
  (scopes: `engine`, `app`, `ui`, `shell`, `plugin`, `practice`, `product`)
- **before arguing with one** — `format_rows rule search:"<the thing>"`
- **all of them** — `format_rows rule match:{state:live} columns:[statement, kind, scope] limit:100`

<!-- rules: the rule rows marked always, rendered by `npm run docs:check -- --write`; docs:check fails when they differ -->
- **A diff on `docs/memory.emd` is somebody's write, never your debris: commit it or ask.** — `scripts/guard-memory-emd.mjs`
- **What a model may produce is a mapping, a position or a declaration — never a value, and never a program.** (D-132, D-137)
- **Anything a person can do on a screen, a conversation can do too, and a new engine write is a failing test until both halves exist.** (D-227, D-234) — `src/parity.test.ts`
- **Another product is described by its category, never named — except a host Emerald runs inside, a runtime it speaks to, and the maintainer's own story.** (D-450)
- **Hebrew strings need bidi isolation: use the `Bidi` component, and never render a raw string that came out of a document.**
- **Planning a milestone lists the maintainer's decisions before any brief is written: every default, every behaviour where nothing is set, and where a thing gets made. Briefs carry only what was answered, and a unit that meets an unlisted one stops and asks instead of guessing.**
- **Money is never a `number`.** (D-003, D-204)
- **Offline is not optional and is not on trust: the page makes no request it did not serve itself.** (D-124, D-133, D-134, D-136, D-308, D-502, D-503) — `electron/network.test.ts, electron/runtimes.test.ts, electron/generate.test.ts, electron/updates.test.ts, electron/windowsUpdater.test.ts`
- **Real documents never enter the repo, and nor do their names and figures.** (D-390) — `src/privacy.test.ts`
- **`src/domain/` imports nothing from React, sql.js, or the DOM.**
- **The engine touches none of the pack, and it is checked: `src/domain/format/` imports nothing from the ledger, and nothing in the ledger imports it.** (D-216, D-221) — `src/domain/format/boundary.test.ts`
<!-- /rules -->

A new rule is a row (`record_format_rows rule`), never a bullet here. Mark it `always` only when a
session would break it before thinking to ask, then `npm run docs:check -- --write`.

## Keeping docs and code together

`docs/` is the specification and it is versioned with the code. When behavior changes, update the
relevant note in the same commit. Schema changes go in `docs/04-data-model.md` plus a migration;
architectural decisions append to `docs/09-decision-log.md` and never edit past entries.

**Before you commit, run the closing pass** — [`docs/conventions.md`](./docs/conventions.md) has
it in full, and it is three things: write the unit and decision rows (and nothing else for a unit, D-286),
**grep for the claim you just made false**, and end the closing message with what's next. `npm run docs:check` does the
mechanical half.

## And end with what's next

**A session's closing message ends with what's next** (D-258):
the next unit and why it is next, anything that is the maintainer's to do or decide before it (restart a
server, back up a file, pick between two options), and whether the next session can simply start.
**If the host offers a next-step box, it ends with that** (D-490): the recap, the maintainer's decision as
the question, and *Start <next ready unit>* as the first button.

**A milestone's units can be driven** (D-287, D-490): `/run-milestone M26` hands each planned unit to a
fresh session of the host's (a subagent where it has none), one at a time unless `dispatch_plan` says
they share no path, and stops after each one that is the maintainer's to judge. A single session
told *"do the next unit"* still works. **Whoever takes a unit claims it** (M27 U6): `claim_units
units:[ref] taken_by branch` — refused unless still `planned` — and the closing pass lands it with one
`land_units` call: the unit `built` with its `commit`, its decisions and review entries, all or nothing (M47 U3, M51 U2).

**Ask the maintainer to try something only when it really matters** — when whether the unit is
*right* rests on something only the maintainer can judge or only a real document can show: a real
statement, a working `.emd`, a change the maintainer will see and might not want. Then it is a line or two: what to open, and what would be
wrong. Otherwise, nothing about trying at all — not a script, not a list of routes.

What is still open from the old review queue is `review_entry` rows (D-238, D-438). **A milestone is
still closed by the maintainer and never by a session.**

Tests and a browser check prove the code does what the session believed; they have never been what
caught the expensive bugs here. Four real documents did.
