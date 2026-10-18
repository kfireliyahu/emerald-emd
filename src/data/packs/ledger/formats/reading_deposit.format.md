---
format: reading_deposit
title: Reported deposit
language: 13
pack: ledger
written: on a fund's page, or with `record_fund_readings`
---

One line of the per-deposit table a fund's report prints, kept with the reading it came from (D-153, D-389). It is the fund's side of the deposit check: the payslip lines that name the fund are the other, worked out on read, and each salary month is set against the rows that name it — **a month whose payslips put in an employer's part and whose rows show none fails, by name**. **Its parts against its total are the same identity as a reading's** (D-280): a deposit table prints the three parts and their sum on every row.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reading | link | holding_reading |  |  |  | yes | no |  |  |  | The report that printed it |
| employer_name | text |  |  |  |  | no | no |  |  |  |  |
| deposit_date | date |  |  |  |  | no | no |  |  |  | When the money reached the fund |
| salary_month | month |  |  |  |  | no | no |  |  |  | The salary month it is for — the column the table is read for |
| employee | money |  |  |  |  | no | no |  |  |  |  |
| employer | money |  |  |  |  | no | no |  |  |  |  |
| severance | money |  |  |  |  | no | no |  |  |  |  |
| total | money |  |  |  |  | no | no |  |  |  | The row's own total, as printed — never a sum worked out here |
| salary | money |  |  |  |  | no | no |  |  |  | The salary the deposit was worked out on, where printed |
| note | text |  |  |  |  | no | no |  |  |  |  |

| claim | holds | tolerance | note |
| --- | --- | --- | --- |
| parts | employee + employer + severance = total | ± 100 | In minor units: the table rounds each part to a whole unit |

## rows
