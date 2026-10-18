---
format: debt
title: Debt
language: 16
claims: none
pack: ledger
written: on the Debts screen, or with `create_debts`
---

A mortgage, a loan, installments. What tracks it automatically is a pattern or a category — two columns, and the kind says which (D-259), where the old table had one reference for both.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| kind | enum |  |  |  |  | yes | no | MORTGAGE, BANK_LOAN, CARD_INSTALLMENTS, PAYROLL_LOAN, PERSONAL, OTHER |  |  |  |
| principal | money |  |  |  |  | yes | no |  |  |  |  |
| opened | date |  |  |  |  | yes | no |  |  |  |  |
| expected_end | date |  |  |  |  | no | no |  |  |  |  |
| monthly_payment | money |  |  |  |  | no | no |  |  |  |  |
| linked_account | link | account |  |  |  | no | no |  |  |  |  |
| auto_track_kind | enum |  |  |  |  | yes | no | NONE, MERCHANT_PATTERN, CATEGORY, CARD_INSTALLMENT_GROUP |  |  |  |
| auto_track_pattern | text |  |  |  |  | no | no |  |  |  | A merchant pattern or an installment group key |
| auto_track_category | link | category |  |  |  | no | no |  |  |  |  |
| is_closed | boolean |  |  |  |  | yes | no |  |  |  |  |
| note | text |  |  |  |  | no | no |  |  |  |  |

| constraint | note |
| --- | --- |
| auto_track_pattern is required only when auto_track_kind is MERCHANT_PATTERN, CARD_INSTALLMENT_GROUP |  |
| auto_track_category is required only when auto_track_kind is CATEGORY |  |

| aggregate | of | over | works out | unit | note |
| --- | --- | --- | --- | --- | --- |
| principal_paid | sum | debt_payment.debt | principal_part |  | What the payments took off what is owed, confirmed or not (M36 U03) |
| total_paid | sum | debt_payment.debt | amount |  | What left the account, interest included |
| unconfirmed | sum | debt_payment.debt where is_confirmed is false | principal_part |  | How much of what was paid off is still the app's reading, not yet confirmed |
| unconfirmed_count | count | debt_payment.debt where is_confirmed is false |  |  | How many payments are still awaiting an answer |

| derived | works out | note |
| --- | --- | --- |
| outstanding | principal - principal_paid | What is still owed; below zero when overpaid. It comes down by principal, never by what left the account |
| interest_paid | total_paid - principal_paid | What the payments paid in interest |
| progress | principal_paid / principal | How much of the principal is paid off, as a share; empty when the principal is zero |

## rows
