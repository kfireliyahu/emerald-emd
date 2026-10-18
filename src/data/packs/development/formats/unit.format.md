---
format: unit
title: Unit
language: 14
claims: none
---

One unit of work, as docs/07-roadmap.md writes it: a checkbox, a clause, a date and the decision it produced. The roadmap is the plan of record and it is read end to end far too often — twenty-eight times, measured — because a session that wants to know what U4 was has no way to ask for one line.

A unit is where the project's own cadence lives: one unit per session, then commit and start fresh. So the questions this format has to answer are "which units of M20 are built", "what landed on this date" and "which decision came out of this one", and they are three `match` calls rather than three greps.

`decision` is optional and that is a real state rather than missing data: a unit that was dropped before it was built produced no decision, and a unit still open has not produced one yet. `landed` is empty for the same reason.

`ref` carries its milestone — `M20 U0` rather than `U0` — because a unit id is only unique inside its milestone and a link printed on another format's row has to be readable on its own. `milestone` is kept beside it anyway, because that is what gets filtered on.

`milestone` links to a row of `milestone` and a text document writes it as that row's `ref` (M27 U1); `match:{milestone:M20}` finds it by that name (M27 U2). `files` is what a unit touches, written when it is planned and corrected when it lands, and it replaced the `Files:` line a brief used to end with. `paths` is the same files as a machine reads them, one path per line (M51 U4): `files` keeps the prose — *docs/mapping-templates.md if the reading changes* — and `paths` is what `dispatch_plan` compares, so units that share a path are not handed out at once. `undone_by` is the decision that reversed a unit after it was built, so work undone is counted rather than reconstructed (D-286). `blocks` is the units it waits on, a link to several rows (M27 U2). `in_progress`, `taken_by` and `started` are a session at work on it (M27 U6): a session takes a unit with `update_format_rows`, addressing it by `ref` and expecting it still `planned`, so two that try at once cannot both get it.

`branch` and `commit` are where a unit was worked and what it became, in plain git (M51 U2): `claim_units` writes the branch a session took it on, and `land_units` the commit that carries its work, refusing a landing from another branch unless told. `taken_by` stays whatever the host calls its session; the pack depends on no host's session API, which is why these two are git's words rather than a session's. So `match:{state:in_progress}` is a live list of who is where.

A claim can be taken over, and an old one shows itself (M51 F4). `claim_units` with `take_over` names whose claim it replaces and is refused unless the unit is `in_progress` under that taker; the new taker gets the unit with `started` reset, and the one it replaced goes onto `taken_over_from`. The ready view lists a unit `in_progress` taken more than a day ago as stalled, so a session that died mid-unit is seen at the next `start_here` rather than found by somebody hand-editing `taken_by`. `report` is the closing report of the session that built it, as `land_units` was given it, so a driver reads a child's report with one `format_rows` call rather than paging its transcript.

A unit makes no claim.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes | yes |  |  |  | The unit as the roadmap names it, with its milestone — `M20 U0`, `M20 T1`. Unique on its own, which `U0` is not. |
| milestone | link | milestone |  |  | yes | no |  |  |  | `M20` — the `milestone` row it belongs to, written by its `ref`. What gets filtered on, which is why it is a column of its own as well as part of `ref`; `match` takes the name as well as the id. |
| scope | text |  |  |  | yes | no |  |  |  | `engine`, or the pack the unit belongs to — `ledger`. So `match:{state:planned, scope:engine}` is the engine's handoff and a parked pack's planned units never show up in it. |
| title | text |  |  |  | yes | no |  |  |  | The clause the roadmap gives it, verbatim — `the pack is staged, and the rail is the engine's`. |
| landed | date |  |  |  | no | no |  |  |  | The day it was committed. Empty for a unit that is open or was dropped, which is a state rather than a missing figure. |
| decision | link | decision |  |  | no | no |  |  |  | The decision this unit produced. Empty for a unit that produced none — dropped before it was built, or not built yet. |
| state | enum |  |  |  | yes | no | planned, in_progress, built, dropped |  |  | `built` is committed and in the roadmap as ticked. `in_progress` is a session working on it now, set when it is handed out and moved on when it lands (M27 U6). `dropped` was scoped and then deliberately not built — M20's tail has seven of those and they are the reason this column is not a boolean. |
| brief | text |  |  |  | no | no |  |  |  |  |
| files | text |  |  |  | no | no |  |  |  | What the unit touches: written when it is planned and corrected when it lands (D-286). It replaces the `Files:` line a brief used to end with. |
| undone_by | link | decision |  |  | no | no |  |  |  | The decision that reversed this unit after it was built — M25 U4 by D-283 — so work undone is counted rather than reconstructed from transcripts (D-286). Empty for work that stands. |
| blocks | links | unit |  |  | no | no |  |  |  | The units that have to be built before this one can be — M27 U3 waiting on U2 (M27 U2, D-300). Several, in order, and empty for a unit nothing holds up. A unit is ready when every one of these is built. |
| taken_by | text |  |  |  | no | no |  |  |  | Who took it — the driver or the session that set it `in_progress` (M27 U6). Kept after it lands, so a unit says who built it. Called `claimed_by` until D-420: a format's band says Claims, and one word meant two things on one screen. |
| started | date |  |  |  | no | no |  |  |  | The day it went `in_progress` (M27 U6). Shown beside the state, because a session that dies leaves its unit `in_progress` for ever and only the date says so. |
| branch | text |  |  |  | no | no |  |  |  | The git branch a session took the unit on — `main`, or a worktree's own (M51 U2). Written by `claim_units` and kept after it lands; a landing from another branch is refused unless it says so. Empty for a unit claimed without one. |
| commit | text |  |  |  | no | no |  |  |  | The git commit that carries the unit's work, as `land_units` was given it (M51 U2) — a hash, short or full. Empty when the landing went in the same commit as the work, since a commit cannot name itself; `git log --grep` on the ref finds that one. A unit built before the first public commit names a commit of the history kept privately (D-495). |
| paths | text |  |  |  | no | no |  |  |  | The files and folders it touches, one repository path per line — `src/plugin/catalog.ts`, or `src/plugin/tools/` for a whole folder (M51 U4). Written when it is planned, beside `files`, which keeps the prose; what every unit appends to — the decision log, `docs/memory.emd` — is left out, or every pair shares it. What `dispatch_plan` compares: a unit with none is unknown, never safe. |
| taken_over_from | text |  |  |  | no | no |  |  |  | Who held the claim before a take-over, oldest first, each with the day they took it — `session A (2026-10-16)` (M51 F4). Written by `claim_units` with `take_over`; empty for a unit nobody took over. |
| report | text |  |  |  | no | no |  |  |  | The closing report of the session that built it — what landed, what is left, what it found — as `land_units` was given it, plain text (M51 F4). The host cuts a child's note to its driver short; this is the whole of it, one `format_rows` call away. |

## rows
