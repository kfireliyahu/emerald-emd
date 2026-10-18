---
format: import_mapping
title: Reader (spreadsheet)
language: 13
claims: none
pack: ledger
written: by the importer's mapper, and renamed, bound or removed on the Mappings screen — or with `import_statement`
---

How the importer reads one provider's file: which column is which, how its amounts are signed and how its dates are ordered. Saved when a person confirms a mapping, and found again by the header it was saved for.

**Not the engine's `format_intake`** (D-277): an intake is the record of one file read onto one format, with one date order for the file. A mapping is reused across every file of its header, and says what an intake cannot — an amount convention, a date order per column, the account the files belong to and how often it was used.

`column_roles` and `date_orders` are JSON, keyed by column index and by role: their meaning is the importer's, and the roles are the document's own `column_role` rows (D-213).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| account | link | account |  |  |  | no | no |  |  |  | The account its files belong to; none means ask each time |
| header_signature | text |  |  |  |  | yes | no |  |  |  | What a file's header is matched on |
| sheet_name | text |  |  |  |  | no | no |  |  |  |  |
| header_row_index | integer |  |  |  |  | yes | no |  | 0 |  |  |
| data_start_row_index | integer |  |  |  |  | yes | no |  | 0 |  |  |
| column_roles | text |  |  |  |  | yes | no |  |  |  | JSON: column index to role |
| amount_convention | enum |  |  |  |  | yes | no | SIGNED_SINGLE, POSITIVE_IS_CHARGE, SEPARATE_DEBIT_CREDIT |  |  |  |
| date_orders | text |  |  |  |  | yes | no |  |  |  | JSON: role to DMY, MDY or YMD |
| default_currency | text |  |  |  |  | yes | no |  |  |  |  |
| last_used | instant |  |  |  |  | no | no |  |  |  |  |
| use_count | integer |  |  |  |  | yes | no |  | 0 |  |  |

## rows
