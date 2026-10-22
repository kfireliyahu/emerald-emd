---
name: closing-pass
description: In a project that keeps Emerald's development pack, at a git commit that finishes a unit — commit the work, land the unit with its decisions, review entries, commit and report in one land_units call, grep for the claim you just made false, run the project's checks, and end with what's next. Use before a commit that finishes a unit, or when asked to "close out", "wrap up", "do the closing pass", or "land this unit"; never before calling a tool or answering a question.
---

# The closing pass

Run this **at the seam, before the commit** — not as a separate sweep later. It is scoped to what you
touched: don't read the project's notes to audit them.

**The project's document** is the path the plugin's session-start hook printed (`start_here on
<path>`). Where none was printed, it is the `document` `.claude/emerald.json` names, or else the one
`.emd` in the project's folder — and in a git worktree, the main checkout's copy at the same place,
never the worktree's own.

## 1. A fact is written once

**The unit's `unit` row is the record of what landed** (step 3). Do not touch the `milestone` row
for a unit: its `state` and `position` change only when a milestone opens, closes or changes order.
There is no status note to update — `start_here` reads the rows, so where the build is is never
written twice. The row keeps what to act on, the commit message says what changed, and a longer
argument, if the project keeps one, stays in its notes: three places with three jobs.

## 2. Grep for what you just made false

One search over the project's notes and source for the claim you changed. **No script can do this
one**, and it is the step that keeps costing sessions: *"the installer has never been run"*, *"next is
the desktop shell"*, *"M9 has one unit left"* each outlived the commit that falsified it. A superseded
claim is worse than no claim, because it reads as current. Never grep build output or dependencies.

## 3. Land it — the order is always the same

A commit cannot name itself, and a landing without its commit leaves the row pointing nowhere. So:

1. **Run the project's checks once** — the tests related to what you changed (with Vitest,
   `npx vitest related <changed files> --run`; most runners have the same), its typecheck, and
   whatever else its `CLAUDE.md` or README says runs before a commit. **The full suite only when the
   change is broad** — the core everything imports, a dependency, the test setup — and once: where CI
   runs the suite on every push, it runs the rest, and a red CI run is the next session's first task.
   Red here means fix it or stop and say so, never commit around it.
2. **Commit the work**, staging only your own files by name — never `git add -A`. Leave the document
   out of this commit.
3. **`land_units` with `commit:` that commit's short hash** (`git rev-parse --short HEAD`) and your
   `report`: dry run, read the diff, then `commit: true`.
4. **Commit the landing**: the document alone, in a commit of its own (*"<unit> landed: built at
   <hash>"*), then push both if the project pushes. Pull first when another session may have pushed;
   a push that fails is reported, never forced.

The landing is one call, by `ref` — never an id, which a text document renews on every write:

```
land_units units:[{unit:"M3 U2", files:"…", commit:"<hash>", branch:"<branch>", report:"…",
  decisions:[{ref:"D-12", title, question, answer}], review_entries:[{do, should}]}]
```

- **Every decision you made → one of `decisions`.** `question` and `answer` are what a later session
  acts on without reading the argument — not a transcription of it. `date`, `milestone`, `scope` and
  `state: live` default to the unit's. The next ref is the one after the highest the document's
  `decision` rows hold, unless a driver handed you one.
- **The unit goes `built`** with `landed` (today unless said), `files` corrected to what you actually
  changed, and `decision` — its first new decision, or `decision:"D-xxx"` for one that exists. It is
  refused if the unit is already built or dropped.
- **`review_entries`** only when there is something the maintainer should drive; `close_milestone`
  only when the maintainer closed it.
- **`branch`** is the branch you land from; a unit claimed on another is refused unless
  `other_branch: true`. **`report`** is your closing report as plain text (up to 4,000 characters),
  which stays on the unit for the driver and the maintainer to read with one `format_rows` call.

A landing without `commit` is refused unless it says `same_commit: true`, which puts the landing in
its work's own commit and leaves `commit` empty for good. Prefer the order above.

**Run for a manager, in a worktree? Propose, do not land.** Commit your work, then write one `inbox`
row with `record_format_rows` to **the document path your hooks printed** (the main checkout's copy,
never one under the worktree's folder), `from` that same path, with `subject`, `sent_on`,
`refs:"<your unit>"`, `state:"new"`, and a `body` of a line for a person then one fenced `json` block
holding exactly what `land_units`' `units` would: `unit`, `files`, `commit`, `branch`, `decisions`,
`review_entries`, `report` — no `close_milestone`. `land_units inbox:["<its id>"]` without `commit`
checks it; report the id. Write no other format.

**Anything else** — a unit you planned, a question you opened or answered — is `record_format_rows`
or `update_format_rows`, one call per format, dry run first:

- **A unit you planned → a `unit` row with `files`** (the files to open first) and `paths` (the same
  files one per line, which `dispatch_plan` compares to say what can run at once). List every unit you
  wrote in the closing message, one line each with what you are least sure of: the maintainer sees a
  unit before a session builds it.
- **A question you opened or answered → an `open_question` row**, or its `state` and `answered_by`
  changed.

The columns are the last section of `start_here`, so no `formats` call first. **A diff on the
document is somebody's write, never debris**: commit it or ask, never discard it.

## 4. End the message with what's next

The closing message ends with **what's next**: the next unit (`start_here` — its *Ready to start*
answer) and why it is next, anything that is the maintainer's to do or decide before it (restart a
server, back up a file, choose between options), and whether the next session can simply start.

**Ask the maintainer to try something only when it really matters** — when whether the unit is
*right* rests on something only the maintainer can judge or only a real document can show. Then one or
two lines: what to open, what would be wrong. Otherwise say nothing about trying — the session's own
checks are the session's business.

### If the host offers a next-step box

Some hosts draw what's next themselves: a box at the end of the turn with a short recap, one question
and buttons whose click sends a message as the person (in the Claude desktop app, `wrap_up` —
`recap`, `ask`, `actions`). **If the host offers one, end with it**; never assume it.

- **`recap`** — what landed (the unit, its commit) and what is *not* verified: not tried, not pushed,
  a check skipped. Two or three sentences; no recommendation.
- **The first button is `Start <next ready unit>`** — the *Ready to start* answer of `start_here`
  after your landing, by `ref` and title. Its message carries the ref and the instruction to claim it:
  *"Start M3 U4 — <title>. Claim it with claim_units first (refused unless still planned), then build
  it per its brief."* Nothing ready → no start button.
- **`ask`** — only when something is the maintainer's: a decision between options, a thing to try, a
  server to restart. Then that is the question, and the buttons answer it.
- **A session run for a driver** (by the `run-milestone` skill, or any manager) **does not draw it**:
  its report goes to the driver, and the driver's own turn ends with the box.

Where the host has no such box, the closing message is prose, ending with what's next.

**Do not close the milestone.** That is the maintainer's (the `review-phase` skill), and it is where
the next one gets chosen.

## 5. End the session

After the landing's commit, stop. Don't start the next unit in the same session: a session's cost is
turns × context, so it grows quadratically with length, and the seam you just reached is the cheapest
place to start fresh.
