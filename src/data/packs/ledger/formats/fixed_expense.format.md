---
format: fixed_expense
title: Bill
language: 13
claims: none
pack: ledger
written: on Plan, or with `track_fixed_expenses`
---

Rent, a subscription, anything that recurs. How it is matched is a pattern, a category or a deduction type, and the kind says which — the category it is matched by is not always the one it is filed under, so the two are two columns (M25 U7). Detecting one is pack code (D-265).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| category | link | category |  |  |  | no | no |  |  |  |  |
| match_kind | enum |  |  |  |  | yes | no | MERCHANT_PATTERN, CATEGORY, PAYCHECK_DEDUCTION, MANUAL_ONLY |  |  |  |
| match_pattern | text |  |  |  |  | no | no |  |  |  |  |
| match_category | link | category |  |  |  | no | no |  |  |  |  |
| match_deduction | link | deduction_type |  |  |  | no | no |  |  |  |  |
| expected | money |  |  |  |  | yes | no |  |  |  |  |
| amount_variability | enum |  |  |  |  | yes | no | FIXED, VARIABLE |  |  |  |
| cadence | enum |  |  |  |  | yes | no | MONTHLY, BIMONTHLY, QUARTERLY, YEARLY, IRREGULAR |  |  |  |
| day_of_month_hint | integer |  |  |  |  | no | no |  | 1 | 31 |  |
| is_discretionary | boolean |  |  |  |  | yes | no |  |  |  |  |
| source | enum |  |  |  |  | yes | no | USER_DEFINED, DETECTED_CONFIRMED |  |  |  |
| is_active | boolean |  |  |  |  | yes | no |  |  |  |  |
| started | date |  |  |  |  | no | no |  |  |  |  |
| ended | date |  |  |  |  | no | no |  |  |  |  |

| constraint | note |
| --- | --- |
| match_pattern is required only when match_kind is MERCHANT_PATTERN |  |
| match_category is required only when match_kind is CATEGORY |  |
| match_deduction is required only when match_kind is PAYCHECK_DEDUCTION |  |

## rows
