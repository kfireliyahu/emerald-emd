---
name: run-milestone
description: Drive a milestone's planned units, each built by a fresh session of the host's (or a subagent where the host has none), one after another or in parallel where they share no path, while this session only relays, lands, records the maintainer's verdicts and keeps its own context small (D-287, D-490). Use when asked to "run M26", "run the milestone", "drive the units", "next unit" inside a driver session, or invokes /run-milestone.
---

# Run a milestone

**This session does not build.** It hands each planned unit to a fresh session, which starts cold
exactly as a new session would, so its cost is the same as typing "do the next unit" in a new window.
The difference is that nobody has to, and the maintainer's verdicts land in the rows where the
next unit will read them. D-287 has the reasoning; D-490 how the units are handed over now.

## 1. Read the queue, once

```
format_rows unit match:{milestone:"<M>", state:"planned"} columns:[ref, title, brief]
dispatch_plan units:[<every planned ref>]
```

against `docs/memory.emd` by its absolute path, in one turn. Order by `ref`. Read nothing
in `docs/` yourself. The child does its own orientation, and your context is the thing to keep small.

`dispatch_plan` (M51 U4, D-486) says which of them can run at once: the units under *At once* share
no path; a group under *One after another* does; a unit under *Unknown* has no `paths` and runs
alone. **One after another is the default**, and the only mode where the host has no sessions.

## 2. Claim, then hand it over

**Claim first** (M27 U6, M47 U3): one `claim_units` against memory.emd, by `ref` — never by an id
from step 1, which a text document renews on every write (D-247). It is refused unless the unit is
still `planned`; units started together are claimed in the same call:

```
claim_units units:["<ref>", …] taken_by:"run-milestone driver" branch:"<git branch --show-current>" commit:true
```

Refused means somebody else took it: say so and stop, rather than building it twice. The roadmap
open in the app moves the unit as you write (`#/formats/milestone/roadmap`).

### Who builds it: the host's sessions when it offers them, the Agent tool when not

**If the host offers a sessions tool** — in the Claude desktop app, `mcp__ccd_session__start_session`
— **each unit is a session of its own** (D-490): a row the maintainer can open, watch, stop and talk to,
and a note back to this driver when it ends a turn. Start it with `initiation:"user_asked"` (the
milestone was asked to be run), `context:"fresh"`, a `title` of `<ref> — <title>`, a `name` like
`m51-u8`, `wake_when_done:true`, the prompt below and a `background` of a few lines (the milestone,
that a driver is running it, that the unit is already claimed). Leave `model` out: it inherits this
session's, and this session runs on Opus.

**Effort follows the unit** (2026-10-18). Leave `effort` out, so the child inherits this session's,
for a unit that designs, decides or touches the engine. Pass `effort:"medium"` for a mechanical one,
where the brief already says every change and there is nothing to choose: a version cut, a rename
already ruled, copy already written, files moved, a dependency bump. A unit measured that day took
13 to 40 minutes, and most of it was the model thinking through work that was already decided.

- **One after another → `use_worktree:false`.** It shares this checkout, commits on `main` and lands
  its own unit, exactly as a subagent did. The next starts only after this one has landed.

**One writer per checkout** (M51 F5). While a child works in this checkout, **this session writes no
row in `docs/memory.emd` and commits nothing here** — not a brief, not a verdict, not a pin. A change
you need either goes into the child's prompt, for its own landing to carry, or waits until the child
has landed. On 2026-10-18 the driver committed `docs/memory.emd` while a child had uncommitted work in
the same folder; it was safe only because the child had not written its rows yet. A commit that must
not wait touches only files the child's `paths` do not name, stages them by name and never
`docs/memory.emd`, and the child's prompt says so (*"the driver may push one commit touching only
X; pull before you push and never stage it"*).
- **At once → `use_worktree:true`, one worktree each**, only for units `dispatch_plan` put under
  *At once*. **A worktree on Windows costs its own `npm install`** (minutes and disk), and
  `node_modules` is **never** junctioned into one — `git worktree remove` deletes through the
  junction, and it wiped half of this repository's on 2026-10-15. So run at once only units long
  enough to pay for that, two or three, never a list of small ones.

**If the host has no sessions**, spawn with the `Agent` tool as before: `run_in_background: true` (a
usage limit then costs a resume, not a restart; you are notified when it reports), `model: "opus"`,
no worktree, one at a time. Sonnet built the units from 2026-10-02 until its Wealth unit missed its
mockup; they have run on Opus since 2026-10-03. Don't ask which model to use.

### The prompt

Self-contained, whichever tool carries it:

> Build **<ref> — <title>** in the Emerald repo at <this checkout's path>, on `main`.
> Follow `CLAUDE.md`; read `docs/conventions.md` first, and nothing else in
> `docs/` that the unit does not need. The unit is already claimed for you — do not claim it again.
> The brief, from `docs/memory.emd`:
>
> <brief, verbatim>
>
> Start from the files the brief names. Build it, test it — the tests related to the change
> (`npx vitest related <changed files> --run`) while you build and before the commit, with
> `src/privacy.test.ts`, typecheck and docs:check before it; the full suite only when the change is
> broad, and once; `check:tours` only if the unit touches what a tour drives (`docs/conventions.md`);
> CI runs the rest — verify it in the browser where it renders,
> then run the closing pass (the `closing-pass` skill) in its order: commit the work, then
> `land_units` with that commit's hash and your `report`, then commit the landing; push to origin
> main. Stage only your own files, never `git add -A`. **Do not start another unit.** You are run by
> a driver: end with a report, not the host's next-step box. Your full report goes in the unit's
> `report` column.
> Report back in under 15 lines, **the commit hash and whether docs:check is green first**: what
> landed; the decision number, if any; what the maintainer should look at to judge it (the route, and
> what would be wrong), or "nothing to look at"; and anything left undone or found along the way.

**A unit in its own worktree** gets, in place of "commit and push to origin main":

> You are in a git worktree of your own. Run `npm install` there first, and never junction
> `node_modules` from the main checkout. Commit on your worktree's branch and do not push or touch
> `main`. Your closing pass lands nothing: it proposes the landing as one `inbox` row to the document
> path your hooks printed (the closing-pass skill says how) — report that row's id. Your decision
> number is **D-<n>** (more: D-<n+1>, … only if this list says so) — the driver hands out numbers so
> two worktrees do not take the same one.

Give each worktree child its own decision numbers, from the next free one in the log's index.

## 3. After each unit

1. **Check it landed, whatever the report says.** A session's note back is only its first 400
   characters, and a subagent's report is its own account, so read the facts: `git log --oneline -3`,
   `git status --short`, `npm run docs:check` and `gh run list --workflow test.yml --branch main
   --limit 2` (CI on what was pushed — a run still going is checked again before the next unit, and a
   red one is a stop: fixing it is the next unit, M51 F6), in one call, and the unit's row
   (`format_rows unit match:{ref:"<ref>"} columns:[ref, state, commit, report]`). **The full report
   is the row's `report` column** (M51 F4), never the child's transcript paged through. No commit, or
   a red check, means **stop and say so**. Do not repair it yourself. One still `in_progress` after its child
   ended is a unit that did not land, and it stays `in_progress` with its `started` date for the
   maintainer to see — `start_here` lists it under *Stalled*. A session that ended its turn on a question, or waiting on a permission, is waiting in its
   own row: say so, and that it is the maintainer's to answer there.
   **Taking a stalled unit over** is for when the maintainer says so, or the child is gone (stopped,
   failed, out of usage): first `git status --short` and `git log --oneline -3` to see what it left —
   uncommitted work is the child's and goes into the next prompt as *"<these files> are a stopped
   session's; keep or finish them"*, never discarded — then `claim_units units:["<ref>"]
   take_over:"<its taken_by>" taken_by:"…" branch:"…" commit:true`, which is refused unless that
   taker still holds it, and hand it to a fresh child as in step 2.
2. **A worktree child's work reaches `main` through you.** When every unit started together has
   reported: `git merge --no-edit <its branch>` for each, in `ref` order — a merge keeps the child's
   commit hash, which its proposal names; a rebase would not. A conflict that is only both sides
   appending (decision-log entries and their index rows) is resolved by keeping both, in number
   order; any other conflict is a stop. Then `npm run docs:check`, then **one `land_units
   inbox:[{id, other_branch:true}, …]`** for every proposal (M51 U3, D-485) — dry run, then `commit:
   true` — never a landing rebuilt from a report's prose. A proposal names its worktree's branch and
   the claim names `main`, so without `other_branch` each is refused (found in M42 U7's dry run). Commit `docs/memory.emd`, push to origin main, and remove
   each worktree once its branch is merged (`git worktree remove`, with no junction inside it).
3. Relay the report, shorter: what landed, and what to look at.
4. **Stop and wait for the maintainer's verdict when the unit is the maintainer's to judge.** That is every unit of a milestone
   that is about how things look or feel (all of M26), and any unit whose brief says to ask. For
   engine-only work with nothing to look at, go straight on to the next unit.
5. Write down the verdict, **before** the next unit starts:
   - It's right → nothing to write.
   - A change wanted to a later unit → append it to that unit's brief, as `Maintainer, <date>: …`.
   - It's wrong → a new `unit` row (`<M> F1`, …) planned next, with the verdict's words in the brief. Small
     enough to be one edit → the next child's prompt carries it as a first task.

## 4. When to stop

- The maintainer says stop, or every planned unit is built. **Say the milestone is built and stop.
  Closing it is the maintainer's** (`CLAUDE.md`).
- A child failed, or left the tree dirty or red.
- This session's own context passes ~150k. Say so, and ask for a fresh driver. It resumes from
  the rows, since nothing lives in this session that isn't in them.

End with what's next, as every session does (D-258) — **and if the host offers a next-step box, the
driver's stops end with it** (the `closing-pass` skill, step 4): the recap is what landed and what is
not verified; a verdict that is the maintainer's is the question, its buttons the likely answers; a stop with
nothing for the maintainer to decide (stop was said, the context is full) offers `Start <next ready unit>` first. When the milestone is built there is no
start button: closing it and choosing the next is the maintainer's.
