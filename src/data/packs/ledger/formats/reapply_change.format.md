---
format: reapply_change
title: Re-apply change
language: 13
claims: none
pack: ledger
written: by re-applying the rules on the Rules screen
---

What one transaction held before a run changed it — so an undo puts back exactly that.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run | link | reapply_run |  |  |  | yes | no |  |  |  |  |
| transaction | link | transaction |  |  |  | yes | no |  |  |  |  |
| previous_category | link | category |  |  |  | no | no |  |  |  |  |
| previous_source | enum |  |  |  |  | yes | no | MANUAL, RULE, AI, INHERITED, NONE |  |  |  |
| previous_rule | link | category_rule |  |  |  | no | no |  |  |  |  |

| constraint | note |
| --- | --- |
| one row per run, transaction |  |

## rows
