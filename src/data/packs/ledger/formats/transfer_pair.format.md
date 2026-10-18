---
format: transfer_pair
title: Transfer
language: 13
claims: none
pack: ledger
written: by the importer, when a row leaving one of your accounts and a row arriving in another match; answered on the Accounts screen, in a row's detail, or with `answer_transfers`
---

Money moved between two of your own accounts: the row that left one and the row that arrived in the other, matched by amount and date and answered once (M30 U3).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| out_transaction | link | transaction |  |  |  | yes | yes |  |  |  | The row that left one account |
| in_transaction | link | transaction |  |  |  | yes | yes |  |  |  | The row that arrived in the other |
| user_decision | enum |  |  |  |  | yes | no | PAIRED, NOT_PAIRED, PENDING |  |  | PAIRED: one transfer, in no income and no spending. NOT_PAIRED: two rows that only looked like one, never suggested again |

## rows
