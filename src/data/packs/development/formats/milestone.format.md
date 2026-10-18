---
format: milestone
title: Milestone
language: 13
claims: none
---

A milestone of docs/07-roadmap.md, as a row (M27 U1). Until this format a milestone was text on a unit, so a roadmap had nothing to order and nothing to say about the milestone itself — what it was for, and whether it was still open.

`unit.milestone` links here and names a milestone by its `ref`, which is why `ref` is unique: a document stored as text writes a link as its target's name.

`position` is the order and `ref` is not. Since D-249 the numbers are not the sequence, and a plan that is reordered changes positions rather than renaming milestones.

A milestone makes no claim.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes | yes |  |  |  | The milestone as the roadmap names it — `M27`. What a unit's `milestone` names it by, so it is unique. |
| title | text |  |  |  | yes | no |  |  |  | The roadmap heading's clause, verbatim — `The development pack, the first pack after the ledger`. |
| goal | text |  |  |  | yes | no |  |  |  | What the milestone is for, in a sentence or two: what is true when it is done. |
| state | enum |  |  |  | yes | no | planned, open, closed |  |  | `planned` is scoped and not started; `open` is the one being built; `closed` was closed by the maintainer — never by a session. A milestone dissolved or stopped short is `closed`, and its goal says so. |
| position | integer |  |  |  | yes | yes |  |  |  | Where it sits in the plan, so a roadmap has something to order by. Not the number in `ref`: since D-249 numbers are not the sequence. Gaps are left on purpose, so a milestone can be put between two. |

## rows
