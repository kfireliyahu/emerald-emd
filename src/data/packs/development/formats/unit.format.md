---
format: unit
title: Unit
language: 14
claims: none
---

One unit of work: a piece of a milestone small enough for one session to build, commit and hand over. The questions a plan is asked — "which units of M2 are built", "what is ready to start", "which decision came out of this one" — are each one `match` call rather than a read of the whole plan.

`decision` is optional, and empty is a real state rather than missing data: a unit dropped before it was built produced no decision, and a unit still open has not produced one yet. `landed` is empty for the same reason.

`ref` carries its milestone — `M2 U3` rather than `U3` — because a unit's number is only unique inside its milestone, and a link printed on another row has to be readable on its own. `milestone` is kept beside it anyway, because that is what gets filtered on; it links to a `milestone` row, which a text document writes as that row's `ref`, and `match:{milestone:M2}` finds it by that name.

`brief` is what a session needs to build the unit without the conversation that planned it. `files` is what the unit touches, in prose, written when it is planned and corrected when it lands. `paths` is the same files as a machine reads them, one path per line: `dispatch_plan` compares them, so units that share a path are not handed out at once. `blocks` is the units it waits on; a unit is ready when every one of them is built. `undone_by` is the decision that reversed a unit after it was built, so work undone is counted rather than reconstructed.

`in_progress`, `taken_by` and `started` are a session at work on it. `claim_units` takes a unit only while it is still `planned`, so two sessions that try at once cannot both get it; it writes the git `branch` the session took it on. `land_units` moves it to `built` with the `commit` that carries its work and the session's closing `report`, and refuses a landing from another branch unless told. `taken_by` is whatever the host calls its session — the pack depends on no host's session API, which is why `branch` and `commit` are git's words. So `match:{state:in_progress}` is a live list of who is where.

A claim can be taken over. `claim_units` with `take_over` names whose claim it replaces, and is refused unless the unit is `in_progress` under that taker; the new taker gets the unit with `started` reset, and the old one goes onto `taken_over_from`. A unit `in_progress` for more than a day is listed as stalled, so a session that stopped mid-unit is seen at the next `start_here`.

A unit makes no claim.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes | yes |  |  |  | The unit's name, with its milestone — `M2 U3`. Unique on its own, which `U3` is not. |
| milestone | link | milestone |  |  | yes | no |  |  |  | `M2` — the `milestone` row it belongs to, written by its `ref`. What gets filtered on, which is why it is a column of its own as well as part of `ref`; `match` takes the name as well as the id. |
| scope | text |  |  |  | yes | no |  |  |  | Which part of the project it belongs to — `api`, `web`, or whatever the project's own parts are called. So `match:{state:planned, scope:api}` is one part's next work, and another part's never shows up in it. |
| title | text |  |  |  | yes | no |  |  |  | What the unit does, in a clause — `the cart survives a reload`. |
| landed | date |  |  |  | no | no |  |  |  | The day it was committed. Empty for a unit that is open or was dropped, which is a state rather than a missing figure. |
| decision | link | decision |  |  | no | no |  |  |  | The decision this unit produced. Empty for a unit that produced none — dropped before it was built, or not built yet. |
| state | enum |  |  |  | yes | no | planned, in_progress, built, dropped |  |  | `planned` is scoped and waiting. `in_progress` is a session working on it now, set when it is taken and moved on when it lands. `built` is committed. `dropped` was scoped and then deliberately not built — which is why this column is not a boolean. |
| brief | text |  |  |  | no | no |  |  |  |  |
| files | text |  |  |  | no | no |  |  |  | What the unit touches, in prose: written when it is planned and corrected when it lands, so the next session opens those files first rather than searching for them. |
| undone_by | link | decision |  |  | no | no |  |  |  | The decision that reversed this unit after it was built, so work undone is counted rather than reconstructed. Empty for work that stands. |
| blocks | links | unit |  |  | no | no |  |  |  | The units that have to be built before this one can be — `M2 U2`. Several, in order, and empty for a unit nothing holds up. A unit is ready when every one of these is built. |
| taken_by | text |  |  |  | no | no |  |  |  | Who took it — the session or the driver that set it `in_progress`. Kept after it lands, so a unit says who built it. |
| started | date |  |  |  | no | no |  |  |  | The day it went `in_progress`. Shown beside the state, because a session that stops leaves its unit `in_progress` for ever and only the date says so. |
| branch | text |  |  |  | no | no |  |  |  | The git branch a session took the unit on — `main`, or a worktree's own. Written by `claim_units` and kept after it lands; a landing from another branch is refused unless it says so. Empty for a unit claimed without one. |
| commit | text |  |  |  | no | no |  |  |  | The git commit that carries the unit's work, as `land_units` was given it — a hash, short or full. Empty when the landing went in the same commit as the work, since a commit cannot name itself; `git log --grep` on the ref finds that one. |
| paths | text |  |  |  | no | no |  |  |  | The files and folders it touches, one repository path per line — `src/cart/store.ts`, or `src/cart/` for a whole folder. Written when it is planned, beside `files`, which keeps the prose; a file every unit appends to, such as a changelog, is left out, or every pair shares it. What `dispatch_plan` compares: a unit with none is unknown, never safe. |
| taken_over_from | text |  |  |  | no | no |  |  |  | Who held the claim before a take-over, oldest first, each with the day they took it — `session A (2026-03-02)`. Written by `claim_units` with `take_over`; empty for a unit nobody took over. |
| report | text |  |  |  | no | no |  |  |  | The closing report of the session that built it — what landed, what is left, what it found — as `land_units` was given it. A host may cut a session's note to its driver short; this is the whole of it, one `format_rows` call away. |

## rows
