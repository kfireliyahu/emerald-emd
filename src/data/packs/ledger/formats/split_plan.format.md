---
format: split_plan
title: Split plan
language: 13
claims: none
pack: ledger
written: on the Splitter screen
---

How a paycheck is divided. The splitter is pack code: money times a percentage needs a rounding rule (D-265). A plan based on one particular paycheck, or on an amount typed, may not have its paycheck or its amount yet: the splitter calls that basis unavailable, and the screen picks the kind before the value — so neither is required by its kind (M25 U7, D-281). What a fixed expense does to a plan is a `plan_fixed_expense` row (D-319), and which plan a month is on is a `plan_month` row (M31 U4).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| basis_kind | enum |  |  |  |  | yes | no | LAST_PAYCHECK, AVERAGE_LAST_N, SPECIFIC_PAYCHECK, CUSTOM_AMOUNT |  |  |  |
| basis_paycheck | link | paycheck |  |  |  | no | no |  |  |  |  |
| basis_months | integer |  |  |  |  | no | no |  | 1 |  |  |
| custom_amount | money |  |  |  |  | no | no |  |  |  |  |
| currency | text |  |  |  |  | yes | no |  |  |  |  |
| is_default | boolean |  |  |  |  | yes | no |  |  |  |  |

## rows
