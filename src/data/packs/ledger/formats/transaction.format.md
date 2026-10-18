---
format: transaction
title: Transaction
language: 19
claims: none
pack: ledger
written: by importing a statement — on the Transactions screen, or with `import_statement`
---

One line of a statement. The one table with sixty thousand rows in a real document.

**`natural_key` is unique per account** — one row per account and key (D-270), which is what refuses a re-import.

**`spending` is the one rule for what counts as spent** (D-271, M36 U04): what went out, by month and category, by the charge date, else the transaction date (D-006) — and not a line the person left out (`is_excluded_from_stats`), not a card's bill whose charges are counted on the card (`counted_on_card`, the settlement's answer), not a line that names a holding or is on an account with holdings (D-355, D-358), and not one filed under a Money moved category (D-316). An uncategorised line passes `is not`, so it counts. The Statistics screen and the Plan's actuals read these filters rather than saying them again. What only code can say stays code beside them: a line a person's own format links, and both ends of an answered transfer (D-309, D-356) — rows pointing *at* a line, which a filter does not read.

**`is_excluded_from_stats` is the person's answer and nothing else's** (M36 U04): a card settlement writes `counted_on_card`, and a salary deposit the slip already counts is read off the match (D-317), so taking either back never undoes what the person said.

**A row that names a `holding` is cash turning into that holding inside one account** (M30 U2): a buy or a sale. It counts in neither came in, went out nor moved, and the holding's `quantity` is the sum of its rows'.

**Every line links to the statement it was read from** (D-262's shape), which is where the file, the sheet and the printed total are.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| merchant_raw | text |  |  |  |  | yes | no |  |  |  | As the statement printed it |
| account | link | account |  |  |  | yes | no |  |  |  |  |
| transaction_date | date |  |  |  |  | yes | no |  |  |  |  |
| charge_date | date |  |  |  |  | no | no |  |  |  |  |
| billing_period | month |  |  |  |  | no | no |  |  |  |  |
| amount | money |  |  |  |  | yes | no |  |  |  | Negative out, positive in |
| direction | enum |  |  |  |  | yes | no | OUTFLOW, INFLOW, TRANSFER |  |  |  |
| merchant_normalized | text |  |  |  |  | yes | no |  |  |  | Written by code |
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
| is_excluded_from_stats | boolean |  |  |  |  | yes | no |  |  |  |  |
| natural_key | text |  |  |  |  | yes | no |  |  |  | Derived by code; what refuses a re-import as a duplicate |
| statement | link | statement |  |  |  | no | no |  |  |  | The file it was read from |
| source_row_ref | text |  |  |  |  | no | no |  |  |  |  |
| category | link | category |  |  |  | no | no |  |  |  |  |
| category_source | enum |  |  |  |  | yes | no | MANUAL, RULE, AI, INHERITED, NONE |  |  |  |
| matched_rule | link | category_rule |  |  |  | no | no |  |  |  |  |
| holding | link | holding |  |  |  | no | no |  |  |  | What this row's cash turned into, inside its own account — a buy or a sale (M30 U2) |
| quantity | decimal |  |  |  | 6 | no | no |  |  |  | How much of the holding: bought is positive, sold negative (M30 U2) |
| counted_on_card | boolean |  |  |  |  | no | no |  |  |  | A bank line paying a card's bill, answered as already counted in the card's own rows: the settlement's answer, never the person's (M36 U04) |

| constraint | note |
| --- | --- |
| amount is at most 0 when direction is OUTFLOW | The sign rule the old table checked |
| amount is at least 0 when direction is INFLOW |  |
| one row per account, natural_key | What refuses a re-import as a duplicate |

| rollup | works out | note |
| --- | --- | --- |
| spending | sum of amount by month of charge_date or transaction_date and category where direction is OUTFLOW and is_excluded_from_stats is false and counted_on_card is not true and holding is empty and account.kind is not HOLDINGS and category.kind is not one of TRANSFER, SAVING | What was spent, per month and category: the rule the Statistics screen reads |

## rows
