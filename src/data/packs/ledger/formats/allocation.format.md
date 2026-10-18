---
format: allocation
title: Allocation
language: 13
claims: none
pack: ledger
written: on the Splitter screen
---

A bucket's share of a plan. The mode decides which figure is required. One per plan and bucket, and one remainder per plan (D-270).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plan | link | split_plan |  |  |  | yes | no |  |  |  |  |
| bucket | link | split_bucket |  |  |  | yes | no |  |  |  |  |
| mode | enum |  |  |  |  | yes | no | PERCENTAGE, FIXED_AMOUNT, REMAINDER |  |  |  |
| share | decimal |  | % |  | 2 | no | no |  | 0 | 100 | The old basis points, as a percentage |
| amount | money |  |  |  |  | no | no |  |  |  |  |
| is_locked | boolean |  |  |  |  | yes | no |  |  |  |  |

| constraint | note |
| --- | --- |
| share is required when mode is PERCENTAGE |  |
| amount is required when mode is FIXED_AMOUNT |  |
| one row per plan, bucket |  |
| one row per plan when mode is REMAINDER | One bucket takes what is left |

## rows
