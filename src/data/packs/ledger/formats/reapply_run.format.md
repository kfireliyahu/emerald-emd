---
format: reapply_run
title: Re-apply run
language: 13
claims: none
pack: ledger
written: by re-applying the rules on the Rules screen, and by undoing it
---

One run of the rules over transactions already in the ledger — what its undo reads. The scope is kept in the words the panel showed, because the accounts and categories it names can be renamed afterwards.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scope | text |  |  |  |  | yes | no |  |  |  | As the panel said it |
| changed | integer |  |  |  |  | yes | no |  | 0 |  |  |
| at | instant |  |  |  |  | no | no |  |  |  | Missing on one made before the moment was kept |
| undone | instant |  |  |  |  | no | no |  |  |  | Set once, never cleared |

## rows
