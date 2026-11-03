---
format: open_question
title: Open question
language: 4
claims: none
---

A question the project is deliberately carrying: docs/engine.md's H-numbers, docs/status.md's "Open, and carried" list, and the parity gaps that src/parity.test.ts keeps honest.

These live in three files today and the three disagree, because closing one in status.md does not close it in engine.md and nothing checks. A question that is answered in one place and open in another is worse than a question nobody wrote down, and that is what this format is for.

`opened_by` and `answered_by` are both links to a decision, and the pair is the whole shape: a question exists because some decision left it open, and it stops existing because some later decision answered it. A question with an `answered_by` and a `state` of `open` is a contradiction the document can now be asked for.

Both links are optional, and in this migration that is not tidiness — H10 was opened by D-226, which belongs to M19 and has not been migrated, so its `opened_by` is empty because the engine refuses a link to a row that is not there rather than dangling. A partial migration leaves real holes, and they are visible rather than silently wrong.

An open question makes no claim.

| column | type | points at | unit | per | required | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes |  |  |  | How the project already names it — `H10`, `parity gap #11`. Not the row id. |
| question | text |  |  |  | yes |  |  |  | The question itself, as a question. A statement of a problem is not one and cannot be answered. |
| opened_by | link | decision |  |  | no |  |  |  | The decision that left this open. Empty when that decision is not in this document — which is what a partial migration looks like from the inside. |
| answered_by | link | decision |  |  | no |  |  |  | The decision that answered it. Empty while it is open; a row carrying one with `state: open` is a contradiction worth asking for. |
| state | enum |  |  |  | yes | open, answered, dropped |  |  | `dropped` is the third state — a question that stopped being worth answering, which is different from one that was answered and different again from one still live. |
| answer | text |  |  |  | no |  |  |  | The answer in words, for a question answered by a fact rather than a decision — an npm name being free, a support case closed (M44 U5, D-444). A question a decision answered names it in `answered_by`; one answered by a fact says it here, and needs no decision row made up to hold it. |

## rows
