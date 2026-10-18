---
name: closing-pass
description: For a session changing this repository's code or docs, at a git commit — write the unit and decision rows, grep for the claim you just made false, run docs:check, end the closing message with what's next. Use only before a git commit in this repository, or when asked to "close out", "wrap up", "do the closing pass", or "commit this"; never before calling a tool or answering a question.
---

# The closing pass

Run this **at the seam, before the commit** — not as a separate sweep later. The reasoning for
each step is in [`docs/conventions.md`](../../../docs/conventions.md) under "The closing pass";
this file is the procedure. Don't read `docs/` to audit it — the pass is scoped to what you
touched.

## 1. Record it once, in the rows

**D-286: a fact is written once.** The unit's `unit` row is the record of what landed (step 2a).
**Do not touch the `milestone` row for a unit**: its `state` and `position` change only when a
milestone opens, closes or changes order, and there is no roadmap note (D-438). There is no status file — `start_here` reads
the rows, so where the build is is never written twice (D-434). The decision log keeps the argument; the row keeps what to act on; the
commit message says what changed. That is three places with three jobs, not six with one.

## 2. Grep for what you just made false

One search over `docs/` for the claim you changed. **No script can do this one**, and it is the
step that keeps costing sessions. Real examples that outlived the commit that falsified them:

- *"the installer has never been run"*
- *"next is the desktop shell"*
- *"M9 has one unit left"*

A superseded claim is worse than no claim, because it reads as current. Scope the grep to
`docs/` and `src/`, never `dist/` or `node_modules/`.

## 2a. Write the rows — the other half of every entry

`docs/memory.emd` is the project's memory, and it lags the moment a decision goes to markdown
alone. **This step writes them; you do not remind anyone to.** The unit you finished is **one
`land_units` call** (M47 U3) against `docs/memory.emd`, by its absolute path — its
decisions, the unit, its review entries, as one batch that applies whole or not at all:

```
land_units units:[{unit:"M47 U3", files:"…", decisions:[{ref:"D-461", title, question, answer}],
  review_entries:[{do, should}]}]
```

- **Every `## D-xxx` you added to the log → one of `decisions`.** `question` and `answer` are what
  a later session acts on without reading the argument — not a transcription of it. `date`,
  `milestone`, `scope` and `state: live` default to the unit's.
- **The unit goes `built`** with `landed` (today unless said), `files` corrected to what you
  actually changed, and `decision` — its first new decision, or `decision:"D-xxx"` for one that
  exists. It is refused if the unit is already built or dropped, and is addressed by `ref`, never
  an id: a text document renews every id on a write (D-247).
- **`review_entries`** only when there is something the maintainer should drive; `close_milestone`
  only when the maintainer closed it.
- **`branch`** is the branch you land from, and a unit claimed on another is refused unless
  `other_branch: true` (M51 U2). **`commit`** is the git commit that carries the work, and
  **`report`** your closing report as plain text (up to 4,000 characters), which stays on the unit
  for the driver and the maintainer to read with one `format_rows` call (M51 F4, D-501).

**The order is always the same three steps** (M51 F5), because a commit cannot name itself and a
landing without its commit leaves the row pointing nowhere — M42 U2 and U4 did, M42 F2 did not:

1. **Commit the work** — code, notes, the decision-log entry — staging only your own files.
2. **`land_units` with `commit:` that commit's short hash** (`git rev-parse --short HEAD`) and your
   `report`: dry run, then `commit: true`.
3. **Commit the landing**: `docs/memory.emd` alone, in a commit of its own (*"<unit> landed: built at
   <hash>"*), then push both.

A landing without `commit` is refused unless it says `same_commit: true` (M51 F4), which puts the
landing in its work's own commit and leaves `commit` empty for good. The tool allows it for a
project that wants it; this one does not — the three steps above, always.
- **Run for a manager, in a worktree? Propose, do not land** (M51 U3, D-485). Commit your work, then
  write one `inbox` row with `record_format_rows` to **the document path your hooks printed** (the
  main checkout's copy, never one under the worktree's folder), `from` that same path, with `subject`,
  `sent_on`, `refs:"<your unit>"`, `state:"new"`, and a `body` of a line for a person then
  one fenced `json` block holding exactly what `land_units`' `units` would: `unit`, `files`, `commit`
  (`git rev-parse --short HEAD`), `branch`, `decisions`, `review_entries` — no `close_milestone`.
  `land_units inbox:["<its id>"]` without `commit` checks it; report the id. Write no other format.

- **A unit you planned → a `unit` row with `files`**, the files to open first (a column since M27 U1).
  List every unit you wrote in the closing message, one line each with what you are least sure
  of: the maintainer sees a unit before a session builds it.
- **A question you opened or answered → an `open_question` row**, or its `state` and
  `answered_by` changed.

Anything else — a planned unit, an open question — is `record_format_rows` or `update_format_rows`,
one call per format. The columns are the last section of `start_here` (M47 U2), so no `formats` call
first. Dry-run, read the diff, then `commit: true`. **Commit `docs/memory.emd`** — with the landing,
in the order above: a diff on it is somebody's write, never debris, and a hook refuses discarding it.

## 3. Run the mechanical half

```bash
npm run docs:check
```

It covers: links between notes resolving, every decision written out in full having a row in the
index **and a row in `docs/memory.emd`** (from the lowest decision the document holds), every `built`
unit having `landed`, every `planned` unit having `files`, size budgets, heading maps, and
the read-cost report.

**Errors fail; budgets and warnings don't.** Over a budget means condense something before
adding more — never delete something that belongs. Budgets are tripwires for "this file is
turning back into a narrative", not rules about length. The `cost` lines are not a problem to
fix; they are there so the price of a whole-file read stays visible.

## 4. End the message with what's next

D-258, 2026-09-24, amending D-238. The closing message
ends with **what's next**: the next unit (`start_here` — its *Ready to start* answer)
and why it is next, anything that is the maintainer's to do or decide before it (restart a server,
back up a file, choose between options), and whether the next session can simply start.

**Ask the maintainer to try something only when it really matters** — when whether the unit is
*right* rests on something only the maintainer can judge or only a real document can show: a real
statement, a working `.emd`, a change the maintainer will see and might not want. Then one or two lines: what to open, what would be wrong.
Otherwise say nothing about trying — the session's own browser check is the session's business.

### If the host offers a next-step box

Some hosts draw what's next themselves: a box at the end of the turn with a short recap, one
question and buttons whose click sends a message as the person (in the Claude desktop app, the
`mcp__ccd_turn__wrap_up` tool — `recap`, `ask`, `actions`). **If the host offers one, end with it**
(M51 U8, D-490); never assume it, and never name the tool as the only way. What goes in it:

- **`recap`** — what landed (the unit, its commit) and what is *not* verified: not tried in the
  app, not pushed, a test skipped. Two or three sentences; no recommendation.
- **The first button is `Start <next ready unit>`** — the *Ready to start* answer of `start_here`
  after your landing, by `ref` and title. Its message carries the ref and the instruction to claim
  it: *"Start M51 U9 — <title>. Claim it with claim_units first (refused unless still planned),
  then build it per its brief."* Nothing ready → no start button.
- **`ask`** — only when something is the maintainer's: a decision between options, a thing to try
  with a real document, a server to restart. Then that is the question, and the buttons answer it, the
  start button first only when starting is the answer you recommend. Nothing the maintainer's →
  recap and the start button, no question.
- **A session run for a driver** (by the `run-milestone` skill, or any manager) **does not draw it**:
  its report goes to the driver, and the driver's own turn ends with the box.

Follow the host's own rule for text around the box (the desktop app's: a box that asks ends the
turn, so nothing is written after it; one without a question is followed by the closing text). And
**where the host has no such box, the closing message is exactly what this section said before
it** — prose, ending with what's next.

**The old review queue is retired (D-238, D-438).**
The deferred queue failed: read a fortnight later by a session that built none of it, it reached
thirty entries and 1,214 lines with M19's still unspent. What was still live in it is `review_entry`
rows, and so is what the maintainer's trials find.

>>>>

Tests and a browser check prove the code does what the session believed. They have never been
what caught the expensive bugs in this project — a real payslip did (D-142), a real pension
report did (D-152), and an afternoon against a real broker statement found seven units inside a
finished milestone (D-194).

**Do not close the milestone.** That is still the maintainer's, and it is still where the next one
gets chosen.

## 5. End the session

The work's commit, then the landing's (step 2a's order), **and push to `origin main`** (every commit is
pushed to main, 2026-10-03); pull first when another session may have pushed, then stop. Don't start the
next unit in the same session. A push that fails is reported, never forced.

A session's cost is turns × context, so it grows **quadratically** with length: a 700-turn
session costs roughly four times a 350-turn one for the same work. Measured over 67 sessions,
this is the single largest lever on the weekly limit, and the seam you just reached is the
cheapest place to act on it. See "What a session costs" in `CLAUDE.md`.
