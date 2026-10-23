---
name: review-phase
description: Review a built milestone in a project that keeps Emerald's development pack — put the milestone's open review_entry rows in front of the maintainer one at a time, write each verdict on its row, turn faults into planned units, and close the milestone when none is left open. Use when a milestone is built and waiting, or when asked to "review M3", "run the review", "do the review phase", "close the milestone", or "let's go through what's built".
---

# The review phase

**This session does not build.** It has one job: put each open entry in front of the maintainer, in
order, with what to open ready — and write down the verdict. A unit already shows the maintainer what
it built in its closing message, while it is warm; what is left for a review is a built milestone the
maintainer wants to close, and the `review_entry` rows its units or earlier trials left open.

A milestone is closed here and nowhere else. Tests say the code does what the session believed; an
afternoon with the real thing — a real file, a real screen — is what finds whether it was right.

**The project's document** is the path the plugin's session-start hook printed (`start_here on
<path>`); where none was printed, the `document` `.claude/emerald.json` names, or else the one `.emd`
in the project's folder.

## 1. Read the queue, and only the queue

```
format_rows unit match:{milestone:"<M>"} columns:[ref, title, state]
format_rows review_entry match:{state:open} columns:[unit, do, should, breaks, not_tried]
```

Keep the entries whose `unit` is the milestone's. **Do not read the project's notes to prepare** —
open a unit's decision only when an entry names something you cannot find. If the maintainer has not
said which milestone, ask; `format_rows milestone match:{state:open}` says which are open. A unit
still `planned` or `in_progress` means the milestone is not built: say so before going on.

## 2. Work the entries one at a time

For each: say what to do in one or two sentences, have the file, the screen or the command ready, and
then be quiet. The maintainer is the instrument here. Never put two entries in one message.

## 3. Write down each verdict as you go

On the row itself, as you finish it — `update_format_rows review_entry`, not from memory at the end.
In a document stored as text, editing the row's `state` and `breaks` lines in the file is the same
write without a call; one `format_problems` call at the end checks every edit, and refuses the
document at the line of a bad one:

- **accepted** — it did what the entry said.
- **fault** — it did not. Put what was seen, in the maintainer's words, in `breaks` before moving on.
- **dropped** — no longer worth driving; say why in `breaks`.

## 4. A fault becomes a unit, not a commit

**This session criticizes; it does not fix.** A fault becomes a `unit` row in the milestone, `state:
planned`, with a `brief` in the maintainer's words, its `files` and `paths` — `<M> F1` is the shape —
ordered by `blocks` where one must come before another. Something a single edit wide can be fixed in
place; anything needing a decision cannot.

## 5. Close the milestone, if no fault is left open

Only the maintainer closes it, and only when every entry is accepted or dropped and every fault unit
is built: then set its `milestone` row to `closed`. Anything the project does at a closing (moving a
milestone's notes aside, a check that runs) its `CLAUDE.md` or README says.

## 6. Ask what is next, and write the answer down

The review is the seam where the milestone *after* this one is chosen — a session takes the next unit
inside a milestone, it never chooses the milestone. Whatever the maintainer decides goes into the
`milestone` rows (`state`, `position`) now, so the next session's `start_here` opens on it.

Then commit the document and stop.
