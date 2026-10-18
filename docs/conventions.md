---
type: conventions
project: Emerald
---

# Working conventions

Instructions for any Claude session working on Emerald. This file is the contract between
sessions. `CLAUDE.md` at the repo root points here.

## What this project is

**Excel that reads your documents and won't let you be wrong quietly** ([product](./product.md) is
the short version, and the sentence said first). Underneath, it is the domain layer between a
person, a model, and their own data. A person and a model work
something out — what a kind of thing is, which fields it has, what has to add up — and Emerald is
where that goes to stay true. TypeScript, React, SQLite in the browser via sql.js. No backend, no
accounts, no network call (D-308).

**The app is document-based.** The user opens a `.emd` file — a real SQLite database, stored as
SQLite bytes or as text and chosen per file (D-246) — works, and
saves it. See [the decision log](./09-decision-log.md) D-021 and D-115 before touching anything
storage-related.

Ships as an **unsigned desktop download** (D-115, D-124); the same `dist/` is also a static site.

**A personal-finance app is the first pack**, and it is most of `src/`. It is
[parked](./packs/ledger/README.md) — do not take work from it — and **since M25 it is a pack in the
full sense**: declared formats and the code that writes them, kept per document, shown in the rail
when the open document keeps it (D-266, D-282). It is also the
on-ramp, the demo, and the whole evidence base.

## Before you start

1. Read this file and **`start_here`** on `docs/memory.emd` — where the build is: the open
   milestones, the units ready to take, the open questions, the latest decisions. **The
   `SessionStart` hook has already printed it** (M47 U1), and the `UserPromptSubmit` one prints a
   new inbox row in full the first time a session meets it and a one-line count after (M51 U6), so neither is a call and the inbox is never polled; call it only
   when it is missing (`dist-plugin/` not built). Those two are the
   whole orientation, and there is no status file (D-434); [the index](./00-index.md) is the map if
   you need to find a note. **A review session asks for its milestone's open `review_entry` rows**
   (the `review-phase` skill).
2. Read the specific note for the thing you're touching, plus [04 Data Model](./04-data-model.md).
3. Do **not** read every note in the folder. Context is the scarce resource. There is no roadmap
   note: the plan is the `milestone` rows, in `position` order (D-438). Never read the decision log
   whole: it opens with an index of every decision, one line each, and you grep from there.
4. If a decision is missing, check [the decision log](./09-decision-log.md) before inventing one.

**The full record of earlier milestones is kept privately**; every decision is a `decision` row in
`docs/memory.emd` (`format_rows decision search:"…"`).

**`docs/packs/ledger/` is parked**, except for M25's units (D-265). Read it when you are touching
finance code, which outside M25 you usually are not. Its notes describe a real, working, thirty-table application — they are accurate, and
they are not the plan.

**A code comment that cites `docs/fNN` or `docs/04-data-model.md` for a ledger table means
`docs/packs/ledger/`.** Those citations were written before the pack existed and were left alone
rather than rewritten across two hundred files; the note is here so nobody reads one as a missing
file.

**A code comment that cites `docs/conventions.md` for a rule** — *every import is idempotent*, *nothing is
auto-accepted*, *routing is hash-based* — **means the `rule` rows** (D-435): the lists moved out of
this note and the comments were left alone, for the same reason. **One that cites `docs/11` for a
rule means the `scope: ui` rows** (D-437). **One that cites `docs/05` means
[`packs/ledger/05`](./packs/ledger/05-domain-rules-and-calculations.md), and one that cites
`docs/07-roadmap.md` or `docs/review.md` means the `milestone` and `review_entry` rows** (D-438).

## The rules

**They are rows, not this note** (M40 U2, D-435). What were this
note's *Non-negotiable rules*, *Style*, *Things that will bite you* (the shell's with them) and *The
findings that outlive the milestone that found them* — and CLAUDE.md's *Rules that are easy to break
by accident*, which said half of them again — are rows of the project's own `rule` format in
`docs/memory.emd`, merged where two notes said one thing. Each carries its `why`, the decisions
behind it (`decided_by`) and the test that fails when it breaks (`enforced_by`). CLAUDE.md carries
the few marked `always`; ask for the rest:

```
format_rows rule match:{scope:engine, state:live} columns:[statement, why]   # engine app ui shell plugin practice product
format_rows rule match:{kind:law} columns:[statement, why]                    # law non_negotiable trap style
format_rows rule search:"<the thing>"
```

**The pack's traps are not rows here**: they are in [`packs/ledger/README.md`](./packs/ledger/README.md),
where every trap about statements, installments, payroll and fund reports went.

**A new rule is a row** (`record_format_rows rule`), never a bullet in a note. `npm run docs:check`
fails when a live rule's `enforced_by` names a file that is gone, warns when one rests on a
superseded decision, and fails when CLAUDE.md's block differs from the `always` rows
(`npm run docs:check -- --write` renders it).

## When you change things

- Schema change → update [04 Data Model](./04-data-model.md), add a migration entry, note it in
  [the decision log](./09-decision-log.md). **A declared format is not a schema change** — the
  reconciler makes the document's tables match its declarations on open, which is the whole point
  of there being no migration chain for them (D-214, D-216).
- New architectural decision → append it to the **Open milestones** section of
  [the decision log](./09-decision-log.md), with date, decision, rationale and alternatives
  rejected, and add its row to the index. Never edit past entries; supersede them. **Numbering
  continues across both indexes** — the next decision is the next number whether it belongs to the
  engine or to the pack.
- Closed a milestone (the maintainer's call) → **`node scripts/archive-decisions.mjs`** in the same
  commit: it moves the milestone's log entries out of the log into the private record and repoints
  their index rows and every link to them. `docs:check` fails while a closed milestone has an entry left in the log —
  thirteen closures went by without the move before it did (M43 U5).
- New term, or a name changed → a `term` row in `docs/memory.emd` (`record_format_rows term`,
  D-436); there is no glossary note. `format_rows term search:"<word>"`
  before naming anything, so a thing gets one name.
- Finished a unit → **its `unit` row is the record** (D-286): `state: built`, `landed`, `decision`,
  and its `files` corrected to what was actually touched — with its decision rows and review entries,
  **one `land_units` call** (M47 U3). Taking one is `claim_units`. A fact is written once, in the row, and the decision
  log keeps the argument.
- Planned a unit → its **`files`** column names the files a session should open first, so the
  next one starts there rather than rediscovering them with grep (D-286), and its **`paths`** the
  same files one per line, which `dispatch_plan` compares to say which units can run at once (D-486). Units a session writes are
  listed in its closing message, one line each with the question it is least sure of: **the maintainer
  sees a unit before any session builds it.**
- **Testing during a unit → only the tests near the change** (`npx vitest run <paths>`); the full
  suite, `npm run typecheck` and `npm run docs:check` run **once, before the commit** (2026-10-04). A unit costs its tool calls × its context, and the ~4,700-test suite run several
  times a unit was a large share of the calls.
- **`npm run check:tours` → only when the unit touches what a tour drives or shows**: `src/ui/`,
  `src/demo/`, the tours' data, or the words on a screen a tour passes through. A unit in
  `electron/`, `src/plugin/`, `hosts/`, `scripts/` or the docs alone skips it and says so; it rebuilds
  the demo and plays nine runs, about four minutes, and no CI job runs it (it needs a display), so
  skipping it where nothing it watches changed costs nothing (2026-10-18).
- Finished every unit of a milestone → say so, and **stop**. Closing it is the review phase, and
  the review phase is the maintainer's.
- Handing a finding to another project → a row in **its** inbox, written once with `state: new`,
  with `about` naming the row it concerns (`../shop/shop.emd S1 U5`, D-461), and only what it lacks: read its `start_here` and latest decisions first (the inbox format's notes
  have the rest, and a document older than the pack gets the inbox by `keep_packs`).
- **Before you commit → the closing pass below.**

## The closing pass

At a commit seam, not as a separate sweep. Three things and one command, and none of them asks you
to read `docs/` in order to audit it — the pass is scoped to what you touched.

1. **Write the rows, and nowhere else.** The unit's row goes `built` with `landed`, `decision` and
   its `files` corrected; each new decision gets its row beside its log entry. The `milestone`
   row changes only when a *milestone* does (D-286). There is no status file to
   update — `start_here` reads the rows (D-434).
2. **Grep for what you just made false.** One search over `docs/` for the claim you changed. This
   is the only item no script can do for you and it is the one that keeps costing sessions: *"the
   installer has never been run"*, *"next is the desktop shell"*, *"M9 has one unit left"* each
   outlived the commit that falsified them. A superseded claim in a note is worse than no note,
   because it is read as current.
3. **End the closing message with what's next** (D-258): the next unit, what is the maintainer's to do
   or decide first, and a request to try something only when it really matters. **If the host offers a
   next-step box, end with it** (D-490): the recap is what landed and what is not verified, a
   decision of the maintainer's is the question, and the first button is *Start <next ready unit>*, sending its
   ref and the instruction to claim it; where there is no box, the message stays prose.

```
npm run docs:check
```

covers the mechanical half. **Errors fail; budgets only warn** — over a budget means condense
something before adding more, never delete something that belongs.

## Showing the maintainer — and why this is no longer a phase

**The finding stands: four times a real document destroyed a green test suite** and each time
rewrote a rule the code is still built on — the payslip (D-142), the pension report (D-152), the
broker statement that found seven units inside a finished milestone (D-194), and a vault of
notes kept by hand, which turned out to be this engine implemented by hand (D-210). Tests say the code does what the
session believed; they have never once said the feature was right.

**What failed was the deferral, not the finding** ([D-238](./09-decision-log.md)). A queue read a
fortnight later by a session that built none of it does not get read: thirty entries, and M19's
still unspent when M20 piled thirteen more on top.

So, from 2026-09-20:

- **The closing message ends with what's next** (D-258), not a test
  script: the next unit and why, anything that is the maintainer's to do or decide first, and whether the
  next session can simply start. **It asks the maintainer to try something only when it really
  matters** — when the unit's rightness rests on something only the maintainer can judge or only a
  real document shows (a working `.emd`, a change the maintainer will see and might not want) — and
  then in a line or two.
- **The old queue is retired** (D-438). What was still live in
  it is `review_entry` rows, because the missing column was always `state`; nothing new is written
  to it.
- **A milestone is still closed by the maintainer and never by a session.** That part was right.

## Definition of done

- Domain logic has Vitest unit tests, including the edge cases the note lists.
- Anything that reads a document has a fixture-based test with a real (anonymized) file.
- The screen handles empty, loading, error, and "no data yet" states.
- Nothing crashes on an empty database.
- **It still works with the network off**, which the shell enforces rather than hopes for.
- Keyboard navigation works on any screen with a table — `useRowCursor` is the movement.
- `npm run docs:check` is clean and the closing pass is done.
- **The closing message says what's next** (D-258).

## Related

[00 Index](./00-index.md) · [engine](./engine.md) · [the decision log](./09-decision-log.md)
