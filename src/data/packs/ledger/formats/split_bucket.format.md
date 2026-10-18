---
format: split_bucket
title: Split bucket
language: 13
claims: none
pack: ledger
written: on the Splitter screen
---

Where a share of a paycheck goes. Its target is at most one of a category, a goal, a debt, a fund and an account (D-252, D-319), and its kind names which; `FREE` is a plan and nothing else.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| target_kind | enum |  |  |  |  | yes | no | CATEGORY, SAVING_GOAL, DEBT, FUND, ACCOUNT, FREE |  |  |  |
| target_category | link | category |  |  |  | no | no |  |  |  |  |
| target_saving_goal | link | saving_goal |  |  |  | no | no |  |  |  |  |
| target_debt | link | debt |  |  |  | no | no |  |  |  |  |
| target_holding | link | holding |  |  |  | no | no |  |  |  | The fund a FUND bucket pays into: a fund is a holding (D-389) |
| target_account | link | account |  |  |  | no | no |  |  |  |  |
| color | text |  |  |  |  | no | no |  |  |  |  |
| sort_order | integer |  |  |  |  | yes | no |  |  |  |  |
| is_buffer | boolean |  |  |  |  | yes | no |  |  |  |  |
| in_cushion | boolean |  |  |  |  | no | no |  |  |  | Counted among the months of expenses the cushion holds, beside the fixed expenses (M28 F10). |
| share | enum |  |  |  |  | no | no | NEEDS, WANTS, SAVING |  |  | Which of 50 / 30 / 20 it was made for, and the heading it is under on Plan (M31 U4). |

| constraint | note |
| --- | --- |
| at most one of target_category, target_saving_goal, target_debt, target_holding, target_account |  |
| target_category is required only when target_kind is CATEGORY |  |
| target_saving_goal is required only when target_kind is SAVING_GOAL |  |
| target_debt is required only when target_kind is DEBT |  |
| target_holding is required only when target_kind is FUND |  |
| target_account is required only when target_kind is ACCOUNT |  |

## rows
