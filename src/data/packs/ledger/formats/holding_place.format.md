---
format: holding_place
title: Holding place
language: 13
claims: none
pack: ledger
written: on the Money map screen, or with `set_place_accounts`
---

Where money with no statements of its own is held — cash at home, a deposit, investments — and where an account with holdings keeps them. A pension or a study fund is in no place: it is a holding of its own (D-389). `institution` is the name as typed, not a link: the old table never linked it.

**A place is an account's because the account's own cash is in it** (M36 U08): that holding names the account, so the place needs no link of its own. A bank account's own cash is in no place at all.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| kind | enum |  |  |  |  | yes | no | CHECKING, DEPOSIT, INVESTMENT, CASH, OTHER |  |  |  |
| institution | text |  |  |  |  | no | no |  |  |  |  |
| note | text |  |  |  |  | no | no |  |  |  |  |
| is_archived | boolean |  |  |  |  | yes | no |  |  |  |  |

## rows
