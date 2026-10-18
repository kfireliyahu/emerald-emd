---
format: debt_payment
title: Debt payment
language: 16
claims: none
pack: ledger
written: on a debt's page, or with `record_debt_payments`
---

A payment against a debt. One found in a transaction names it with a link; one from a payslip or a plan names its source with a key code derives, as a saving deposit's does, because neither is one row (D-279). The kind says which is set.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| debt | link | debt |  |  |  | yes | no |  |  |  |  |
| date | date |  |  |  |  | yes | no |  |  |  |  |
| amount | money |  |  |  |  | yes | no |  |  |  |  |
| interest | money |  |  |  |  | yes | no |  |  |  |  |
| source_kind | enum |  |  |  |  | yes | no | MANUAL, TRANSACTION, PAYCHECK, INSTALLMENT_SLICE, FROM_PLAN |  |  |  |
| transaction | link | transaction |  |  |  | no | no |  |  |  |  |
| source_key | text |  |  |  |  | no | no |  |  |  |  |
| is_confirmed | boolean |  |  |  |  | yes | no |  |  |  |  |
| note | text |  |  |  |  | no | no |  |  |  |  |

| constraint | note |
| --- | --- |
| transaction is required only when source_kind is TRANSACTION, INSTALLMENT_SLICE |  |
| source_key is required only when source_kind is PAYCHECK, FROM_PLAN |  |
| one row per debt, source_kind, transaction when source_kind is TRANSACTION, INSTALLMENT_SLICE | A row pays a debt once |
| one row per debt, source_kind, source_key when source_kind is PAYCHECK, FROM_PLAN | A payslip or a plan's month pays a debt once; a manual payment has none |

| derived | works out | note |
| --- | --- | --- |
| principal_part | amount - interest | What came off what is owed: the payment less its interest. Empty when the two are in different currencies (M36 U03) |

## rows
