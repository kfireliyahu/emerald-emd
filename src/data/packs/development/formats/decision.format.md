---
format: decision
title: Decision
language: 13
claims: none
---

One entry of docs/09-decision-log.md, which is 2,770 lines of markdown and which CLAUDE.md tells every session not to read end to end. That instruction is the admission this format exists to answer: prose does not scale as memory.

The log's own laws are kept rather than replaced. A past entry is never edited — a decision that stops being true is superseded by a later one, which is what `supersedes` and `state` are for, and why there is no `amended_at` and nothing to overwrite. `question` and `answer` are the two halves an entry always had in its prose; here they are columns, so a session can be handed the answer without reading the argument, and can go and read the argument when the answer is not enough.

`ref` is the decision's own number and is not the row's `id`, because `id` is the column every declared table already has and a declaration may not name it. That is the first thing this migration found (M22 U1): the name a person uses for a row and the identity a link resolves through are two different columns, and every `supersedes` here was written in a second pass once the first pass had handed back its ids.

A decision makes no claim. That is said on purpose and it is the first of the four gaps D-238 predicted: claims are arithmetic, and a note's invariants are "not empty" and "this link resolves", which the declaration already enforces.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes | yes |  |  |  | The decision's own number, as the log writes it — `D-227`. Not the row id: `id` is the column every declared table already has. |
| date | date |  |  |  | yes | no |  |  |  | The day it was decided, which is the day the entry was written. |
| milestone | text |  |  |  | yes | no |  |  |  | The milestone it belongs to — `M20`. Text rather than an enum: milestones are still being added. |
| scope | text |  |  |  | yes | no |  |  |  | Whose decision this is: `engine`, or the name of the pack whose rule it is — `ledger`. Text rather than an enum because packs are still being added. Split by what the decision governs, not by the milestone that produced it (D-218): the reading traps were decided during finance milestones and are `engine`. Filter on it so pack work and engine work never read each other's rows. |
| title | text |  |  |  | yes | no |  |  |  | The headline, verbatim from the entry's own heading. It is a sentence on purpose. |
| question | text |  |  |  | yes | no |  |  |  | What was undecided before this — the thing a later session would otherwise decide differently by accident. |
| answer | text |  |  |  | yes | no |  |  |  | What was decided. Enough on its own that a session need not read the argument to act correctly. |
| supersedes | link | decision |  |  | no | no |  |  |  | The earlier decision this one replaces or amends. A chain of these is the case D-224's one-hop rule cannot follow, and that is a question rather than a licence to change the rule. |
| state | enum |  |  |  | yes | no | live, amended, superseded |  |  | Whether this is still the decision of record. `amended` means a later entry changed part of it and the rest still stands; `superseded` means it does not. A past entry is never edited, so this column is the only way to ask. |

## rows
