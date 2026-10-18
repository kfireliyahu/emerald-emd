---
format: plan_fixed_expense
title: Bill in a plan
language: 13
claims: none
pack: ledger
written: on the Plan screen, or with `set_fixed_expense_roles`
---

What one fixed expense does to one plan: comes out of net before the split, is one share of the split, or is ignored by this plan (M28 U7, D-319). A fixed expense with no row here is ignored by that plan, and a bill taken from the payslip is outside the choice whatever a row says (D-053).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plan | link | split_plan |  |  |  | yes | no |  |  |  |  |
| fixed_expense | link | fixed_expense |  |  |  | yes | no |  |  |  |  |
| role | enum |  |  |  |  | yes | no | NET, SPLIT, IGNORE |  |  |  |

| constraint | note |
| --- | --- |
| one row per plan, fixed_expense |  |

## rows
