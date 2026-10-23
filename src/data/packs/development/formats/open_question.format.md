---
format: open_question
title: Open question
language: 4
claims: none
---

A question the project is deliberately carrying: something not yet decided, written down so that it is decided on purpose rather than by accident. Kept in notes, the same question ends up open in one file and closed in another, and nothing notices; a question answered in one place and open in another is worse than one nobody wrote down.

`opened_by` and `answered_by` are both links to a decision, and the pair is the whole shape: a question exists because some decision left it open, and stops existing because a later decision answered it. A question with an `answered_by` and a `state` of `open` is a contradiction the document can be asked for.

Both links are optional. A question can come from anywhere — a conversation, a bug, a user — not only from a decision, and some are answered by a fact rather than a decision; `answer` holds that.

An open question makes no claim.

| column | type | points at | unit | per | required | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes |  |  |  | How the project names it — `Q3`. Not the row id. |
| question | text |  |  |  | yes |  |  |  | The question itself, as a question. A statement of a problem is not one and cannot be answered. |
| opened_by | link | decision |  |  | no |  |  |  | The decision that left this open. Empty when no decision did, or when that decision is not in this document. |
| answered_by | link | decision |  |  | no |  |  |  | The decision that answered it. Empty while it is open; a row carrying one with `state: open` is a contradiction worth asking for. |
| state | enum |  |  |  | yes | open, answered, dropped |  |  | `open` is still live. `answered` was settled, by a decision or a fact. `dropped` stopped being worth answering, which is different from being answered. |
| answer | text |  |  |  | no |  |  |  | The answer in words, for a question settled by a fact rather than a decision — a name turned out to be free, a vendor replied. A question a decision answered names it in `answered_by` instead, and needs no decision made up to hold a fact. |

## rows
