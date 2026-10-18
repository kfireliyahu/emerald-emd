---
format: paycheck_line
title: Paycheck line
language: 13
claims: none
pack: ledger
written: on the Paychecks screen, or with `record_paychecks`
---

One line of a payslip: what the employee paid, and what the employer paid beside it (D-048).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| paycheck | link | paycheck |  |  |  | yes | no |  |  |  |  |
| deduction_type | link | deduction_type |  |  |  | yes | no |  |  |  |  |
| employee | money |  |  |  |  | yes | no |  |  |  |  |
| employer | money |  |  |  |  | no | no |  |  |  |  |
| basis | money |  |  |  |  | no | no |  |  |  |  |
| note | text |  |  |  |  | no | no |  |  |  |  |
| sort_order | integer |  |  |  |  | yes | no |  |  |  |  |

## rows
