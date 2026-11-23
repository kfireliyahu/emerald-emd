---
format: export
title: Saved export
language: 24
claims: none
---

One file a document's rows are written to as JSON: which format, which of its rows and columns, in what order, and which child formats are folded into each row. Kept as rows, a project's exports are seen and corrected like any table, rather than listed in a script beside the document. `emerald-mcp export <document.emd>` writes every one, the same bytes every time, and with `--check` writes nothing and names each file that is stale or missing, so a build can fail when a file has drifted from the document.

`file` is relative to the document's folder, and a file outside it is refused while the others are still written: a document someone sends cannot make the export write anywhere else on the machine. It is unique, so two saved exports never write one file.

`columns`, `match` and `nests` hold one entry per line. A `match` line is `column: value`, matched as `format_rows` matches; two lines on one column match either, and an empty value matches an empty cell. A `nests` line is `<child>[.<link>] [as=<key>] [order=<column>] [descending] [columns=a,b]`. A format or a column the document has not got is reported when the export runs, never skipped.

A saved export makes no claim.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| file | text |  |  |  | yes | yes |  |  |  | The file written, relative to the document's folder — `site/data/cards.json`. One outside that folder is refused. |
| format | text |  |  |  | yes | no |  |  |  | The declared format whose rows it writes, by name. |
| columns | text |  |  |  | no | no |  |  |  | The columns written, one per line, computed ones too. Empty writes every stored column. |
| order | text |  |  |  | no | no |  |  |  | The column the rows are sorted by. Empty sorts by the format's first text column; ties go by that column, then the row id. |
| descending | boolean |  |  |  | no | no |  |  |  | Sorts the other way. |
| match | text |  |  |  | no | no |  |  |  | Which rows: one `column: value` per line. Empty writes every row. |
| nests | text |  |  |  | no | no |  |  |  | Child formats folded into each row, one per line, as the command line's `--nest` takes one. |
| note | text |  |  |  | no | no |  |  |  | What the file is for, or who reads it. |

## rows
