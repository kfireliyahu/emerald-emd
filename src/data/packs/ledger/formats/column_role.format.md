---
format: column_role
title: Column role
language: 13
claims: none
pack: ledger
written: from the importer's mapper and the fund report's table mapper
---

A role somebody added to one of the two reading vocabularies, because a document printed a column this build has no name for (D-208, D-211). **Named, not stored**: nothing narrows on an added role, and it exists so a model has a right answer that is not `value`.

**The roles this build ships are not rows** (M25 U8). Their meaning is compiled in — a reader switches on them — so their list is the code's, and a row here is only ever a person's addition, after them in the order a model is offered them.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| role | text |  |  |  |  | yes | no |  |  |  |  |
| vocabulary | enum |  |  |  |  | yes | no | STATEMENT, DEPOSIT |  |  |  |
| position | integer |  |  |  |  | yes | no |  | 0 |  | After the shipped roles |

| constraint | note |
| --- | --- |
| one row per vocabulary, role | A role is unique within its reading |

## rows
