---
name: run-milestone
description: Drive a milestone's planned units in a project that keeps Emerald's development pack — each unit built by a fresh session of the host's (or a subagent where the host has none), one after another or in parallel where they share no path, while this session only claims, relays, lands and writes down the maintainer's verdicts. Use when asked to "run M3", "run the milestone", "drive the units", or "next unit" inside a driver session.
---

# Run a milestone

**This session does not build.** It hands each planned unit to a fresh session, which starts cold
exactly as a new session would, so a unit costs what typing "do the next unit" in a new window
costs. The difference is that nobody has to, and the maintainer's verdicts land in the rows where the
next unit will read them. Your own context is the thing to keep small: read rows, never the project's
notes.

## 0. The project's document

Every call below takes the project's `.emd` by its absolute path. It is **the path the plugin's
session-start hook printed** (`start_here on <path>`). Where no hook printed one, find it as the hook
does: the `document` that `.claude/emerald.json` names (relative to the project's folder), or else the
one `.emd` in the folder — and in a git worktree, the same place in the main checkout
(`git rev-parse --git-common-dir`, its parent), because every worktree reads and writes that one copy.
A document without the `unit` format does not keep the development pack: say so and stop, or offer
`keep_packs packs:[development]`.

## 1. Read the queue, once

```
format_rows unit match:{milestone:"<M>", state:"planned"} columns:[ref, title, brief, paths]
dispatch_plan units:[<every planned ref>]
```

in one turn. Order by `ref`. The child does its own orientation.

`dispatch_plan` says which of them can run at once: the units under *At once* share no path; a group
under *One after another* does; a unit under *Unknown* has no `paths` and runs alone. **One after
another is the default**, and the only mode where the host can start neither sessions nor isolated
subagents.

## 2. Claim, then hand it over

**Claim first**, by `ref` — never by an id from step 1, which a text document renews on every
write. It is refused unless the unit is still `planned`; units started together are claimed in the
same call:

```
claim_units units:["<ref>", …] taken_by:"run-milestone driver" branch:"<git branch --show-current>" commit:true
```

Refused means somebody else took it: say so and stop, rather than building it twice.

### Who builds it: the host's sessions when it offers them, a subagent when not

**If the host offers a sessions tool** (the Claude desktop app's `start_session`), **each unit is a
session of its own**: a row the maintainer can open, watch, stop and talk to, and a note back to this
driver when it ends a turn. Start it as asked-for work (the milestone was asked to be run), with fresh
context, a title of `<ref> — <title>`, a short name like `m3-u2`, the prompt below and a few lines of
background (the milestone, that a driver is running it, that the unit is already claimed). Leave the
model out, so it inherits this session's.

**Effort follows the unit.** Leave effort out, so the child inherits this session's, for a unit that
designs or decides. Pass a lower effort for a mechanical one, where the brief already says every
change and there is nothing to choose: a version bump, a rename already ruled, copy already written,
files moved. Most of a mechanical unit's time is the model thinking through work that was already
decided.

- **One after another → in this checkout.** The child commits on this branch and lands its own unit.
  The next starts only after this one has landed.
- **At once → one git worktree each**, only for units `dispatch_plan` put under *At once*. A worktree
  costs its own dependency install, and the main checkout's dependency folder is **never** linked
  into one: removing the worktree deletes through the link. So run at once only units long enough to
  pay for that, two or three, never a list of small ones.

**One writer per checkout.** While a child works in this checkout, **this session writes no row in
the document and commits nothing here** — not a brief, not a verdict. A change you need either goes
into the child's prompt, for its own landing to carry, or waits until the child has landed. A commit
that must not wait touches only files the child's `paths` do not name, stages them by name and never
the document, and the child's prompt says so (*"the driver may push one commit touching only X; pull
before you push and never stage it"*).

**If the host has no sessions**, use a subagent: in the background (a usage limit then costs a
resume, not a restart), on the strongest model, one at a time — or, for units under *At once* and
only where the subagent tool offers its own worktree, one each, as above.

### The prompt

Self-contained, whichever tool carries it:

> Build **<ref> — <title>** in <this checkout's path>, on `<branch>`. Follow the project's
> `CLAUDE.md` (or its README), and read nothing the unit does not need. The unit is already claimed
> for you — do not claim it again. The brief, from <the document's path>:
>
> <brief, verbatim>
>
> Start from the files the brief names. While you build and before the commit, run the tests related
> to the change and the project's other checks; the full suite only when the change is broad, and
> once — CI runs the rest where the project has it. Then run the closing pass
> (the `closing-pass` skill) in its order: commit the work, then `land_units` with that commit's hash
> and your `report`, then commit the landing; push if the project pushes. Stage only your own files,
> never `git add -A`. **Do not start another unit.** You are run by a driver: end with a report, not
> the host's next-step box. Your full report goes in the unit's `report` column.
> Report back in under 15 lines, **the commit hash and whether the checks are green first**: what
> landed; the decision ref, if any; what the maintainer should look at to judge it (and what would be
> wrong), or "nothing to look at"; and anything left undone or found along the way.

**A unit in its own worktree** gets, in place of "commit and push":

> You are in a git worktree of your own. Install the project's dependencies there first, and never
> link the main checkout's. Commit on your worktree's branch and do not push or touch the main
> branch. Your closing pass lands nothing: it proposes the landing as one `inbox` row to the document
> path your hooks printed (the closing-pass skill says how) — report that row's id. Your decision ref
> is **D-<n>** (more: D-<n+1>, … only if this list says so) — the driver hands out refs so two
> worktrees do not take the same one.

Give each worktree child its own decision refs, from the next after the highest `ref` the document's
`decision` rows hold.

## 3. After each unit

1. **Check it landed, whatever the report says.** A session's note back is only its first few
   hundred characters, and a subagent's report is its own account, so read the facts: `git log
   --oneline -3`, `git status --short`, the project's checks and, where CI runs on push, its latest
   run on the main branch (red is a stop: fixing it is the next unit), in one call, and the unit's row
   (`format_rows unit match:{ref:"<ref>"} columns:[ref, state, commit, report]`). **The full report is
   the row's `report` column**, never the child's transcript paged through. No commit, or a red
   check, means **stop and say so**. Do not repair it yourself. One still `in_progress` after its child
   ended is a unit that did not land, and it stays `in_progress` with its `started` date for the
   maintainer to see — `start_here` lists it under *Stalled*. A session that ended its turn on a
   question, or waiting on a permission, is waiting in its own row: say so, and that it is the
   maintainer's to answer there.
   **Taking a stalled unit over** is for when the maintainer says so, or the child is gone (stopped,
   failed, out of usage): first `git status --short` and `git log --oneline -3` to see what it left —
   uncommitted work is the child's and goes into the next prompt as *"<these files> are a stopped
   session's; keep or finish them"*, never discarded — then `claim_units units:["<ref>"]
   take_over:"<its taken_by>" taken_by:"…" branch:"…" commit:true`, which is refused unless that taker
   still holds it, and hand it to a fresh child as in step 2.
2. **A worktree child's work reaches the main branch through you.** When every unit started together
   has reported: `git merge --no-edit <its branch>` for each, in `ref` order — a merge keeps the
   child's commit hash, which its proposal names; a rebase would not. A conflict that is only both
   sides appending to one list is resolved by keeping both, in order; any other conflict is a stop.
   Then the project's checks, then **one `land_units inbox:[{id, other_branch:true}, …]`** for every
   proposal — dry run, then `commit: true` — never a landing rebuilt from a report's prose. A proposal
   names its worktree's branch and the claim names yours, so without `other_branch` each is refused;
   the merge is what made it yours. Commit the document, push if the
   project pushes, and remove each worktree once its branch is merged.
3. Relay the report, shorter: what landed, and what to look at.
4. **Stop and wait for the maintainer's verdict when the unit is the maintainer's to judge** — a unit
   about how something looks or feels, and any unit whose brief says to ask. For work with nothing to
   look at, go straight on to the next unit.
5. Write down the verdict, **before** the next unit starts:
   - It's right → nothing to write.
   - A change wanted to a later unit → append it to that unit's brief, as `Maintainer, <date>: …`.
   - It's wrong → a new `unit` row (`<M> F1`, …) planned next, with the verdict's words in the brief.
     Small enough to be one edit → the next child's prompt carries it as a first task.

## 4. When to stop

- The maintainer says stop, or every planned unit is built. **Say the milestone is built and stop.
  Closing it is the maintainer's** (the `review-phase` skill).
- A child failed, or left the tree dirty or red.
- This session's own context is getting long. Say so, and ask for a fresh driver. It resumes from the
  rows, since nothing lives in this session that isn't in them.

End with what's next — **and if the host offers a next-step box, the driver's stops end with it**
(the `closing-pass` skill, step 4): the recap is what landed and what is not verified; a verdict that
is the maintainer's is the question, its buttons the likely answers; a stop with nothing for the
maintainer to decide offers `Start <next ready unit>` first. When the milestone is built there is no
start button: closing it and choosing the next is the maintainer's.
