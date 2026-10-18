---
format: statement
title: Statement
language: 13
claims: none
pack: ledger
written: by importing a statement — on the Transactions screen, or with `import_statement`
---

One file read into the ledger: the header of a statement, and every transaction it wrote links to it (D-262's shape). What the detail panel's "row 47 of cal-2026-07.xlsx" is read from.

**The total the file printed for itself is kept beside the lines it totals**, so checking a statement against its own figure has both halves in one place. `balance_check` is what the running balance said at stage time, as the JSON one strip reads whole.

**The days it covers are the file's, not its surviving rows'** (M28 F26): a statement whose overlap with another was dropped as duplicates still ran to its own last row, and its closing balance is that day's. `covers_from`/`covers_to` are the span of every row it read; `printed_from`/`printed_to` the period it printed above its header, kept only when the rows fall inside it and it had ended before the day it was read.

`mapping` is the importer's mapping that read the file (D-277); removing a mapping clears it.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| file_name | text |  |  |  |  | yes | no |  |  |  |  |
| account | link | account |  |  |  | yes | no |  |  |  |  |
| file_hash | text |  |  |  |  | yes | no |  |  |  | What recognises the same file read twice |
| sheet_name | text |  |  |  |  | no | no |  |  |  |  |
| mapping | link | import_mapping |  |  |  | no | no |  |  |  | The mapping that read it |
| status | enum |  |  |  |  | yes | no | PARSING, AWAITING_REVIEW, COMMITTED, CANCELLED, FAILED |  |  |  |
| rows_total | integer |  |  |  |  | yes | no |  | 0 |  |  |
| rows_new | integer |  |  |  |  | yes | no |  | 0 |  |  |
| rows_duplicate | integer |  |  |  |  | yes | no |  | 0 |  |  |
| rows_failed | integer |  |  |  |  | yes | no |  | 0 |  |  |
| started | instant |  |  |  |  | yes | no |  |  |  |  |
| committed | instant |  |  |  |  | no | no |  |  |  |  |
| printed_total | money |  |  |  |  | no | no |  |  |  | The total the file printed for itself |
| printed_total_text | text |  |  |  |  | no | no |  |  |  | The text it was read out of |
| printed_total_source | text |  |  |  |  | no | no |  |  |  | Where in the file |
| balance_check | text |  |  |  |  | no | no |  |  |  |  |
| covers_from | date |  |  |  |  | no | no |  |  |  | The first day of the file's own rows — every one it read, those another statement already held among them (M28 F26) |
| covers_to | date |  |  |  |  | no | no |  |  |  | The last day of the file's own rows, on the same terms |
| printed_from | date |  |  |  |  | no | no |  |  |  | The first day of the period the file printed for itself, when it printed one |
| printed_to | date |  |  |  |  | no | no |  |  |  | The last day of that period |

## rows
