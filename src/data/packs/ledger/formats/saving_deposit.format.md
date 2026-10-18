---
format: saving_deposit
title: Saving deposit
language: 13
claims: none
pack: ledger
written: on a goal's page, or with `record_deposits`
---

Money put towards a goal — **what a person typed, and nothing else** (M36 U05, D-381): a deposit, a plan's, an opening balance, a gain or loss. What a goal's feed brings (`FROM_TRANSACTION`), a payslip's line (`FROM_PAYCHECK_DEDUCTION`) and a reading's growth are worked out on read by the ledger's code and never stored here, so they can never lag behind the rows they come from; the kinds stay in the list because the code hands them out under them. **`source_key` is a key code derives** — a plan and its month and bucket — rather than a link, because what it names is not one row (D-279).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| goal | link | saving_goal |  |  |  | yes | no |  |  |  |  |
| date | date |  |  |  |  | yes | no |  |  |  |  |
| amount | money |  |  |  |  | yes | no |  |  |  |  |
| holding | link | holding |  |  |  | yes | no |  |  |  |  |
| source_kind | enum |  |  |  |  | yes | no | MANUAL, FROM_TRANSACTION, FROM_PAYCHECK_DEDUCTION, FROM_PLAN, OPENING_BALANCE, GROWTH |  |  |  |
| source_key | text |  |  |  |  | no | no |  |  |  |  |
| transfer_group_key | text |  |  |  |  | no | no |  |  |  |  |
| confirmed_on | date |  |  |  |  | no | no |  |  |  | The day a person said a set-aside amount was still in the balance (M28 U8) |
| note | text |  |  |  |  | no | no |  |  |  |  |

| constraint | note |
| --- | --- |
| one row per source_kind, source_key when source_kind is FROM_TRANSACTION, FROM_PAYCHECK_DEDUCTION, FROM_PLAN, OPENING_BALANCE, GROWTH | A source is counted once; a manual deposit has none |

## rows
