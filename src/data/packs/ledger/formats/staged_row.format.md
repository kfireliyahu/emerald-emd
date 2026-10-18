---
format: staged_row
title: Staged row
language: 13
claims: none
pack: ledger
written: by importing a statement — the review on the Transactions screen, or `import_statement`
---

One line of a statement as the review holds it, before anything is committed. Kept in the document so a review survives the app being closed mid-import (F01, D-277).

**A suggestion and a choice are two columns** so a person's pick is never mistaken for a rule's guess (D-009). `natural_key` and `status` are what the file itself says and an edit of the figures leaves them alone.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| merchant_raw | text |  |  |  |  | no | no |  |  |  | As the statement printed it |
| statement | link | statement |  |  |  | yes | no |  |  |  | The import this row is part of |
| row_index | integer |  |  |  |  | yes | no |  | 0 |  |  |
| raw_cells | text |  |  |  |  | yes | no |  |  |  | JSON: the cells as the file held them |
| status | enum |  |  |  |  | yes | no | NEW, DUPLICATE_EXACT, DUPLICATE_SIMILAR, UPDATED, PARSE_ERROR, SKIPPED |  |  |  |
| user_decision | enum |  |  |  |  | yes | no | PENDING, ACCEPT, SKIP, EDIT |  |  |  |
| error_message | text |  |  |  |  | no | no |  |  |  |  |
| suggested_category | link | category |  |  |  | no | no |  |  |  | A rule's guess |
| suggested_rule | link | category_rule |  |  |  | no | no |  |  |  |  |
| chosen_category | link | category |  |  |  | no | no |  |  |  | A person's pick |
| transaction_date | date |  |  |  |  | no | no |  |  |  |  |
| charge_date | date |  |  |  |  | no | no |  |  |  |  |
| billing_period | month |  |  |  |  | no | no |  |  |  |  |
| amount | money |  |  |  |  | no | no |  |  |  |  |
| direction | enum |  |  |  |  | no | no | OUTFLOW, INFLOW, TRANSFER |  |  |  |
| merchant_normalized | text |  |  |  |  | no | no |  |  |  |  |
| provider_category | text |  |  |  |  | no | no |  |  |  |  |
| card_last4 | text |  |  |  |  | no | no |  |  |  |  |
| reference | text |  |  |  |  | no | no |  |  |  |  |
| note | text |  |  |  |  | no | no |  |  |  |  |
| installment_sequence | integer |  |  |  |  | no | no |  | 1 |  |  |
| installment_total | integer |  |  |  |  | no | no |  | 1 |  |  |
| installment_group_key | text |  |  |  |  | no | no |  |  |  |  |
| original_total | money |  |  |  |  | no | no |  |  |  |  |
| foreign_amount | money |  |  |  |  | no | no |  |  |  |  |
| exchange_rate | decimal |  |  |  | 6 | no | no |  | 0 |  |  |
| natural_key | text |  |  |  |  | no | no |  |  |  |  |
| source_row_ref | text |  |  |  |  | no | no |  |  |  |  |
| holding | link | holding |  |  |  | no | no |  |  |  | What the row's cash turns into, carried to the transaction (M30 U2) |
| quantity | decimal |  |  |  | 6 | no | no |  |  |  | How much of the holding: bought is positive, sold negative |

| constraint | note |
| --- | --- |
| amount is at most 0 when direction is OUTFLOW | The sign rule, one hop before the ledger |
| amount is at least 0 when direction is INFLOW |  |

## rows
