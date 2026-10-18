---
format: document_template
title: Reader (PDF or text)
language: 13
claims: none
pack: ledger
written: by the payslip, fund report and broker statement readers when a person confirms a reading, and renamed or removed on the Mappings screen
---

How a document with no header row is read: a payslip, a fund report or a broker statement. The schema of such a page is its labels, so a template is found again by the labels it was saved for, and says where each figure is — never the figure (D-132, D-139).

**Superseded rather than edited** (D-139): last year's slips still need the map that read them, so a re-derivation keeps the old row as `SUPERSEDED` and starts the next version. A removed template is `REMOVED` and stays, for the same reason. One current template per kind and signature.

`anchors` and `pinned_fields` are JSON: their meaning is the readers', and a table's roles are the document's own `column_role` rows (D-213).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  | What a person calls it: an employer, a provider |
| kind | enum |  |  |  |  | yes | no | PAYSLIP, FUND_REPORT, INVESTMENT |  |  |  |
| label_signature | text |  |  |  |  | yes | no |  |  |  | The labels it is found again by |
| anchors | text |  |  |  |  | yes | no |  |  |  | JSON: where each field is, shaped by kind |
| derived_by | enum |  |  |  |  | yes | no | LOCAL_MODEL, PLUGIN, SEED, MANUAL |  |  |  |
| confirmed | instant |  |  |  |  | no | no |  |  |  | Empty until a person agreed to it; the reader refuses one that is |
| pinned_fields | text |  |  |  |  | yes | no |  |  |  | JSON: the fields a person corrected, carried to the next version |
| version | integer |  |  |  |  | yes | no |  | 1 |  |  |
| state | enum |  |  |  |  | yes | no | CURRENT, SUPERSEDED, REMOVED |  |  |  |
| superseded | instant |  |  |  |  | no | no |  |  |  |  |
| last_used | instant |  |  |  |  | no | no |  |  |  |  |
| use_count | integer |  |  |  |  | yes | no |  | 0 |  |  |

| constraint | note |
| --- | --- |
| one row per kind, label_signature when state is CURRENT | One current template per document format |

## rows
