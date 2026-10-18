---
name: review-phase
description: Run Emerald's review phase — the maintainer drives a finished milestone against real documents, criticizes it, and decides what comes next; the session puts the milestone's open review_entry rows in front of the maintainer and writes down what is found. Use when a milestone is built and waiting, or when asked to "review M16", "run the review", "do the review phase", "close the milestone", or "let's go through what's built".
---

# The review phase

**This session does not build.** It has one job: put each open entry in front of the maintainer,
in order, with the route open and the figure ready to compare — and write down the verdict.

**Since D-238 it is not a deferred phase**: a unit shows the maintainer the thing in its closing message,
while it is warm. What is left for a review is a built milestone the maintainer wants to close, and
the `review_entry` rows earlier trials or its units left open. The old prose queue is
retired (D-438) and is never where the queue is.

A milestone is closed here and nowhere else. Every expensive finding in this project came out of an
afternoon like this one: a real payslip (D-142), a real pension report (D-152), and a real broker
statement that found seven units inside an M16 every test passed (D-194).

## 1. Read the queue, and only the queue

```
format_rows unit match:{milestone:M34} columns:[ref, title, state]
format_rows review_entry match:{state:open} columns:[unit, do, should, breaks, not_tried]
```

Keep the entries whose `unit` is the milestone's. **Do not read the decision log to prepare** —
open an entry's decision only when it names something you cannot find. If the maintainer has not said
which milestone, ask; `format_rows milestone match:{state:open}` says which are open.

## 2. Work the entries in order

For each: say what to do in one or two sentences, have the route or the file ready, and then be
quiet. The maintainer is the instrument here. Where the shell is involved, drive it with the
`verify-in-shell` skill rather than asking for clicks.

## 3. Write down each verdict as you go

On the row itself, as you finish it — `update_format_rows review_entry`, not from memory at the end:

- **accepted** — it did what the entry said.
- **fault** — it did not. Put what was seen, in the maintainer's words, in `breaks` before moving on.
- **dropped** — no longer worth driving, and say why in `breaks`.

## 4. A fault becomes a unit, not a commit

**This session criticizes; it does not fix.** A fault becomes a `unit` row in the milestone,
`state: planned`, with a `brief` and its `files` — `M28 F1` is the shape — ordered by `blocks` the
way M16's seven were (D-194). Something a single edit wide can be fixed in place; anything needing
a decision cannot.

## 5. Close the milestone, if no fault is left open

Set its `milestone` row to `closed`, then run `node scripts/archive-decisions.mjs`: it moves the
milestone's decision entries out of the log into the private record, repoints their index rows and rewrites
every link to them. Then `npm run docs:check`, which fails while a closed milestone still has an
entry in the log.

## 6. Ask what is next, and write the answer down

The review is the seam where the milestone *after* this one is chosen — a session takes the next
unit inside a milestone, it never chooses the milestone. Whatever the maintainer decides goes into the
`milestone` rows (`state`, `position`) in this commit, so the next session's `start_here` opens on
it.

Then commit and stop.
