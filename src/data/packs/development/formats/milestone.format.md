---
format: milestone
title: Milestone
language: 13
claims: none
---

A milestone of the project's plan, as a row: what it is for, where it sits in the order, and whether it is still open. Units link to it, so a roadmap is milestones in order with their units under each.

`unit.milestone` names a milestone by its `ref`, which is why `ref` is unique: a document stored as text writes a link as its target's name.

`position` is the order and `ref` is not. Plans get reordered, and a reordered plan changes positions rather than renaming milestones.

A milestone makes no claim.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes | yes |  |  |  | The milestone's short name — `M2`. What a unit's `milestone` names it by, so it is unique. |
| title | text |  |  |  | yes | no |  |  |  | What the milestone is, in a clause — `Checkout works without an account`. |
| goal | text |  |  |  | yes | no |  |  |  | What the milestone is for, in a sentence or two: what is true when it is done. |
| state | enum |  |  |  | yes | no | planned, open, closed |  |  | `planned` is scoped and not started; `open` is being built; `closed` is done, and closed by whoever owns the project, never by a session on its own. A milestone stopped short is `closed`, and its goal says so. |
| position | integer |  |  |  | yes | yes |  |  |  | Where it sits in the plan, so a roadmap has something to order by. Not the number in `ref`. Leave gaps — 10, 20, 30 — so a milestone can be put between two. |

## rows
