---
format: setting
title: Setting
language: 13
claims: none
pack: ledger
written: by the ledger's screens and tools that remember an answer — a dismissal, a skip, onboarding's progress
---

**Where a pack's settings go** (M25 U8): a format of the pack's own, a key and a JSON value, the way `app_setting` was one table for every preference rather than a migration per preference (D-034). The value's meaning is the feature's that wrote it.

A pack's, not the engine's: a document that keeps no ledger has no ledger settings, and the engine keeps none of its own in the document (D-115).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| key | text |  |  |  |  | yes | yes |  |  |  |  |
| value | text |  |  |  |  | yes | no |  |  |  | JSON, the feature's own |

## rows
