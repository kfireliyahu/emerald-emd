---
format: saving_goal
title: Goal
language: 16
claims: none
pack: ledger
written: on the Savings screen, or with `create_goals`
---

What money is being put aside for. A goal finds its deposits from the bank through one **Money moved category** (`deposit_category`, one goal per category): a transaction filed under it is a `FROM_TRANSACTION` deposit, worked out on read and never stored (M28 U8, D-324; M36 U05, D-381). **Or** it is fed by its holding (`fed_by_holding`): every row that names its `default_holding` — a buy or a sale inside an account with holdings — is a deposit, and the bank's end of the transfer feeds nothing. **Or** its money is a bank or cash account's own Cash and it is fed by the transfers into that account (`fed_by_transfers`): each confirmed transfer pair arriving there is a deposit, one leaving it a withdrawal (M30 F4, D-364). **One feed per goal, never two**, and one goal per category, holding or account, so nothing counts twice (M30 U4, D-357). **The totals below are over what a person typed**: what a feed brings — and a payslip's lines, and a reading's growth — is never stored, so the ledger's code adds it to `balance`, `growth` and `liquid` on read, and works `put_in` and `progress` out again from those (D-381).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| kind | enum |  |  |  |  | yes | no | EMERGENCY, SHORT_TERM, LONG_TERM, RETIREMENT, EARMARKED |  |  |  |
| target | money |  |  |  |  | no | no |  |  |  |  |
| target_date | date |  |  |  |  | no | no |  |  |  |  |
| default_holding | link | holding |  |  |  | no | no |  |  |  |  |
| deposit_category | link | category |  |  |  | no | yes |  |  |  | The Money moved category whose transactions are this goal's deposits from the bank (M28 U8) |
| fed_by_holding | boolean |  |  |  |  | no | no |  |  |  | True: its deposits are the rows that name its default holding, bought or sold there; never beside a deposit_category (M30 U4) |
| fed_by_transfers | boolean |  |  |  |  | no | no |  |  |  | True: its default holding is a bank or cash account's own Cash, and every confirmed transfer into that account is a deposit, one out of it a withdrawal; never beside another feed (M30 F4) |
| paused_until | date |  |  |  |  | no | no |  |  |  | The month a paused goal takes money again; until then its amount goes back to Plan (M28 U8) |
| is_closed | boolean |  |  |  |  | yes | no |  |  |  |  |
| priority | integer |  |  |  |  | yes | no |  |  |  |  |
| note | text |  |  |  |  | no | no |  |  |  |  |

| aggregate | of | over | works out | unit | note |
| --- | --- | --- | --- | --- | --- |
| balance | sum | saving_deposit.goal | amount |  | Every deposit a person typed, opening balance and typed growth included (M36 U03); what a feed brings is added on read (D-381) |
| opening | sum | saving_deposit.goal where source_kind is OPENING_BALANCE | amount |  | What was already there when the goal was made |
| growth | sum | saving_deposit.goal where source_kind is GROWTH | amount |  | What the market added, or took back |
| liquid | sum | saving_deposit.goal where holding.is_liquid is true | amount |  | What sits where it can be reached |

| derived | works out | note |
| --- | --- | --- |
| put_in | balance - growth | What the deposits put in, growth left out |
| progress | balance / target | The balance as a share of the target; empty with no target |

## rows
