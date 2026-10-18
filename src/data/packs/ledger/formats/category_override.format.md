---
format: category_override
title: Category override
language: 13
claims: none
pack: ledger
written: on the Transactions and Categorize screens, or with `assign_category`
---

A person re-categorised a transaction by hand. What it was before is kept, which is what learning from a correction reads.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| transaction | link | transaction |  |  |  | yes | no |  |  |  |  |
| previous_category | link | category |  |  |  | no | no |  |  |  |  |
| previous_source | enum |  |  |  |  | yes | no | MANUAL, RULE, AI, INHERITED, NONE |  |  |  |
| new_category | link | category |  |  |  | no | no |  |  |  |  |
| at | instant |  |  |  |  | no | no |  |  |  | Missing on one made before the moment was kept |

## rows
