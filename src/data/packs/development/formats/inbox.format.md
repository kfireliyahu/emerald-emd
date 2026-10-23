---
format: inbox
title: Inbox
language: 23
claims: none
---

What another project's session hands this document: a fact it found, a finding about this project, a gate it knows of. A message to another session lasts only as long as that session; a row lasts as long as the document.

`from` is the sending document's absolute path — `/work/shop/plan.emd` — and never a session's title, because a title means nothing once the session ends and a path is where the sender's own record can be read. `refs` is the sender's names for the same things in its own document, so the owner can ask that document rather than the session that wrote it.

The rules are a convention, not a guarantee: nothing knows which session writes a row, so nothing here can enforce them. A sender writes a row once, with `state: new`, and never edits it. The owner moves `state` and fills what it became. A session from another project writes to no other format of this document.

`about` is the row the hand-off concerns, in whichever document holds it — the sender's own unit, a decision of a third project — written as that document's path and the row's name: `/work/site/plan.emd M2 U3`. It is an `elsewhere` column: `format_rows` and `start_here` read the other document and print what the row holds now beside it — `unit M2 U3 · built` — so the owner sees that the thing a row asks about is already done without asking the sender. A document that is not there, or a name it has no row for, reads *unresolved* and is never refused, because the other file may be closed, moved or on another machine. By name and never by id: a text document renews its ids on every write.

What it became is three columns, because a link names its target by that format's first text column and only some formats have a unique one: `answered_by` and `became_unit` are links, to a decision and a unit; `became` is text for everything else — an open question or a review entry by its ref, or why it was dropped.

A row written from another project while a session here is writing is the ordinary case of two writers: writers take the document's lock in turn, a batch applies whole or not at all, and a copy is taken before it. A session is told a row arrived without asking: the plugin's prompt hook prints the rows in state `new` before every prompt, and nothing when there are none, so a session never polls; the row is printed again until the owner moves its `state`. A session that must wake between prompts can watch the document for `state=new` instead.

**A row is for what the receiver lacks.** Before writing, the sender reads the receiver's document — `start_here`, its latest decisions — and writes only what it does not already hold. A document made before the pack changed is brought up to date by `keep_packs`, which declares what the pack added since and renames what it renamed, values kept; a kept pack does not update itself.

**A session run by a driver proposes its landing here.** It lands nothing itself: it writes one row, `state: new`, whose `refs` is its unit's ref and whose `body` is a line or two for a person and then one fenced `json` block in the shape of one of `land_units`' `units` — `unit`, `files`, `commit`, `branch`, `decisions`, `review_entries` — and never `close_milestone`, which is the project owner's. It writes to the document path its hooks printed, which in a worktree is the main checkout's copy, never one under the worktree's own folder. `land_units inbox:[ids]` lands every proposal named as one dry run and one commit, refuses the batch by name for any that is not a proposal or not `new`, and moves each to `applied` with `became_unit` and `answered_by` filled. The proposing session writes no other format of this document.

An inbox row makes no claim.

| column | type | points at | unit | per | required | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| subject | text |  |  |  | yes |  |  |  | The hand-off in a line: what `start_here` lists and what a text document heads the row with. |
| from | text |  |  |  | yes |  |  |  | The sending document's absolute path — `/work/shop/plan.emd`. Not a session's title: a title means nothing once the session ends. |
| sent_on | date |  |  |  | yes |  |  |  | The day it was sent. |
| body | text |  |  |  | no |  |  |  | The fact or finding in full, in markdown, written for a session that has none of the sender's context. |
| refs | text |  |  |  | no |  |  |  | The sender's own refs for it, in its own document — `plan.emd D-10, D-18`. |
| about | elsewhere |  |  |  | no |  |  |  | The row it concerns, in the document that holds it — `/work/site/plan.emd M2 U3`. Read back with what that row holds now, or unresolved. |
| state | enum |  |  |  | yes | new, triaged, applied, dropped |  |  | A sender writes `new`, and `start_here` lists those. `triaged`: the owner has read it and knows what it will become. `applied`: it became that. `dropped`: read and not acted on, and `became` says why. |
| answered_by | link | decision |  |  | no |  |  |  | The decision it became or answered. |
| became_unit | link | unit |  |  | no |  |  |  | The unit it became. |
| became | text |  |  |  | no |  |  |  | Anything else it became, by ref or name — an open question, a review entry — or why it was dropped. |

## rows
