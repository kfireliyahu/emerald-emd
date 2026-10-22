---
type: spec
project: Emerald
---

# 04 — Data model, the core

**The engine's tables hold declarations; everything a user declares is made *from* one** by the
reconciler rather than by a migration in `src/data/db/migrations/`, which is the inversion
[D-214](./09-decision-log.md) made and the reason there is no migration chain for declared tables.
032 called its three tables the last hand-written ones the engine needs; U3 added a fourth (D-222),
U4a a fifth (D-223) and U4b a sixth (D-224) — a past migration is never edited, so the correction
lives here: what is unbounded is the set of *declared* tables, not the set of things a declaration is
made of.

The ledger pack's thirty tables — accounts, transactions, categories, paychecks, savings, debts,
funds, investments — are documented in
[`packs/ledger/04-data-model.md`](./packs/ledger/04-data-model.md) and are not repeated here.

The **development pack**'s six — `decision`, `unit`, `milestone`, `open_question`, `review_entry`, `inbox` (M44 U1) —
are `src/data/packs/development/formats/*.format.md` and are what `docs/memory.emd` declares, word
for word (M27 U1; `pack.test.ts` holds the two together). It seeds nothing and declares no owner:
its rows are written by the engine's own tools.

## What `schema_version` governs, and what it does not

`schema_version` governs **the built-in tables and nothing else.** A declared table is governed by
its own declaration, which lives in the document, so on open the app makes the tables match,
idempotently. What has to be version-compatible across builds is therefore **the declaration
language, which is one integer** — not the set of tables, which is unbounded. A document authored
on a newer build opens on an older one as long as the declaration language is understood.

**Migration is the app's job exclusively** (D-094). `openDatabase` migrates unconditionally, which
is correct where the code that migrates is the code that renders; the plugin calls
`openDatabaseWithoutMigrating`, reads the version and stops. Reconciliation is called from the
**document store** rather than from `openDatabase` for the same reason: the plugin opens a
document read-only to answer a question and must not reshape it on the way past.

## The reading vocabularies

### ColumnRole

> **Since M25 U8 (D-282, schema 48) this is the ledger pack's `column_role` format, and it holds only
> the roles a person added** — `role`, `vocabulary`, `position`, one row per vocabulary and role. The
> shipped roles are `SEEDED_ROLES` in code, in their order, and are no longer rows. Its `vocabulary` is
> `STATEMENT` or `DEPOSIT` since M45 F1 (D-456): holdings and trades left with investments (D-283).
> What follows is the table migration 031 made, which 048 drops.

The four reading vocabularies, as rows. Schema 31, migration `031_column_roles.sql`,
[D-212](./09-decision-log.md) — `deduction_type` one level up, and for its reason (D-049): a
vocabulary the user can extend, stored as a real table rather than as a `const` in the binary.

| Field | Type | Notes |
|---|---|---|
| `vocabulary` | enum | `STATEMENT` · `DEPOSIT` · `HOLDING` · `TRADE` — the four tables these documents print. A role is unique within its vocabulary and says nothing about the others: `quantity` is a holding's and a trade's, and they are not the same role. |
| `role` | text | The identifier a mapping stores and a grammar's `enum` carries. `^[a-z][A-Za-z0-9]{0,31}$`, because it goes into a JSON Schema and comes back out of a constrained decoder — a quote or a space is the shape that truncated `סה"כ ברוטו` (D-137). |
| `origin` | enum | `SEEDED` — shipped, and a reader narrows on it. `USER` — added because a real file printed a column no release could name, and **nothing reads it** (D-211). |
| `position` | integer | Offer order, and the order roles enter the grammar. Seeded rows carry their `const` array's order; an added role sorts after them. |

**Primary key** is (`vocabulary`, `role`). There is no `deleted_at` and no delete: removing a role
asks what becomes of the mappings naming it, which is H9 at a smaller scale
([engine](./engine.md)).

**The invariant that matters is not in the schema.** A vocabulary is handed to a model as a closed
`enum`, because unaided a model asked to use an app's vocabulary invents members of it (D-114). These
rows do not open that list — they are *where it is read from*. `modelTasks.ts` builds each task's
`system` and `schema` from the context at ask time, and both halves come from one array so a
hand-kept second copy cannot drift.

**Seeded rows and the `const` arrays must agree**, and `columnRoleRepository.test.ts` asserts it for
all four: if they ever disagree, a model is being asked with a list the code does not understand.
**`HOLDING` deliberately has no `cost`** — that list was not widened (D-208) and seeding
it would be that widening by another mechanism.

## Formats

## Formats — the engine, beside the app

Schema 32, migration `032_formats.sql`, [D-216](./09-decision-log.md), M19 U1; schema 33,
`033_identities.sql`, [D-222](./09-decision-log.md), M19 U3; schema 36, `036_quantities.sql`,
[D-225](./09-decision-log.md), M19 U4c; schema 37, `037_intake.sql`,
[D-226](./09-decision-log.md), M19 U5; schema 38, `038_unique.sql`,
D-255, M24 U4; schema 39, `039_scale_and_time.sql`,
D-257, M24 U6; schema 40, `040_row_constraints.sql`,
D-259, M24 U7; schema 41, `041_aggregate_filter.sql`,
D-260, M24 U8; schema 42, `042_intake_header.sql`,
D-262, M24 U10; schema 43, `043_seed.sql`,
D-264, M24 U12; schema 44, `044_rollup.sql`,
D-271, M25 E2; schema 45, `045_latest.sql`,
D-272, M25 E3; schema 46, `046_rule_set.sql`,
D-273, M25 E4. **Eight hand-written tables holding
declarations**, five more holding what a document wrote into them, and every table above them is
made from a declaration by the reconciler rather than by a migration in that folder. Nothing in the finance app references them and they reference nothing
in it (D-214).

**The inversion.** `schema_version` governs the built-in tables and nothing else. A declared
table is governed by its declaration, which lives in the document — so on open the app makes the
tables match, idempotently, and what has to be version-compatible across builds is **the
declaration language, which is one integer**, rather than the set of tables, which is unbounded.

### Format

| Field | Type | Notes |
|---|---|---|
| `name` | text | `snake_case`, and the table is `fmt_<name>`. **The prefix is load-bearing**: no built-in table carries it, so no plan the reconciler produces can reach one. |
| `title` | text | What a person calls it. |
| `language` | integer | The declaration language. A format from a newer one is **left alone and listed as unreadable**, never read down — `SchemaTooNewError`'s refusal at the scale of one format. |
| `notes` | text | The prose, verbatim, never parsed. Half of the note this design was specified against is the argument, and dropping it would make the declaration a worse artefact than the markdown it replaced. |
| `nothing_must_hold` | bool | **[H3](./engine.md)** (D-222). **Since D-411 it is the default**: a format with no identity is allowed whether or not it said so, `declare_format` sets this when it declares none, a `.format.md` may still say `claims: none` (`checks: none` before D-417, still read), and the editor writes it on Create or Save (D-345). Meaningless once an identity exists, and a declaration carrying both is refused rather than resolved. |
| `pack` / `pack_written` / `pack_columns` | text | **Which pack owns it** (schema 47, language 13, M25 E5, D-274): its name, where its rows are written instead — the tail of every refusal — and the pack's columns, comma-separated. NULL for a person's format. **Rows are read anywhere and written only through the pack**; a person may add a column of their own and may not change or drop one of the pack's, nor delete the format. In the document, not the pack's code, because the engine-only server never loads that code. A `.format.md` says `pack:`, `written:` and `pack columns:`. |
| `created_at` / `updated_at` | instant | **`updated_at` is when the format last changed** (M47 U5, D-462): a row of it added, changed or removed — its own table's or a member table's — or its declaration saved. Moved by SQLite, by three `AFTER` triggers per table named `<table>__changed__insert\|update\|delete`, which `keepChangeMarks` makes after every adopt and reconcile and on every plugin open; no caller sets it. A text document keeps the day in a `changed.md` part (`copy_slot: 2026-10-06`), and a format it gives none is `0`, unmarked. |

### FormatColumn

**Primary key** (`format_name`, `name`). Every property becomes SQL rather than being
interpreted — a type is a storage class, `required` is `NOT NULL`, a bound is a comparison.
**There is no free-text `CHECK`**: a declaration carrying SQL is a program, the ruler forbids a
formula DSL, and a string from a model reaching `db.run` is an injection.

| Field | Type | Notes |
|---|---|---|
| `type` | enum | `text` · `integer` · `real` · `date` · `boolean` · `enum` · `money` · `link` · `quantity` · `decimal` · `month` · `instant` · `links` · `percent` · `time` · `enums` · `elsewhere` · `file`. Closed, and closed for `ColumnRole`'s reason (D-114). **`money` is two SQL columns** — `<name>_minor` and `<name>_currency` — because the app's oldest rule has no exception for a table the user declared. **`link` is the eighth** (D-224) and the first whose meaning is outside the row it is in. **`quantity` is the ninth and the second pair** (D-225) — `<name>` as a `REAL` beside `<name>_unit` — for a figure whose unit is the *row's* rather than the column's: `150 g` on one recipe line and `200 ml` on the next. **Language 6 added three** (schema 39, D-257): `decimal` is an `INTEGER` — the figure times ten to its `scale` — written and read as a decimal string, so a rate or a price per unit is never a float; `month` is `YYYY-MM`; `instant` is UTC to the millisecond, `YYYY-MM-DDTHH:MM:SS.sssZ`, written with its offset or refused. **`links` is the thirteenth** (schema 53, language 14, M27 U2, D-300): the ids of several rows of the `target`, in order, and **no column of the format's table** — each member is a row of `fmt_<format>__<column>` (`row_id`, `member_id`, `position`, primary key on the first two), which the reconciler makes, renames and drops (only when empty) like a column. It cannot be required or unique. **`percent` is the fourteenth** (schema 54, language 15, M29 U3, D-333): an `INTEGER` of millionths of the whole — `12.5%` is `125000` — entered and shown as the percent, four places fixed (no `scale`), more refused, never rounded. **A cell is read as typed** (M29 F3, D-344): `87`, `87%` and `0.87` are all 87% — a `%` makes the figure the percent, a bare figure strictly between -1 and 1 and not zero is the fraction, and `1` is 1%; a bound is always the percent. It takes no `unit`; an identity reads it as its fraction, exactly. **`time` is the fifteenth** (schema 56, language 17, M29 U4, D-335): a time of day as `HH:MM` text, twenty-four hours, `CHECK`ed by shape and `<= '23:59'`; typed plainly (`9`, `9:30pm`), no `unit`. **A `date`, a `time` and an `instant` are points**: the only arithmetic one takes part in is `end - start` with another of its type, a span in `h` (times, instants) or `day` (dates), and two times wrap at midnight. **`enums` is the sixteenth** (schema 59, language 22, M34 U5, D-398): **several members of the column's `values`**, kept as `links` is — no column of the format's table, each member a row of `fmt_<format>__<column>` (`row_id`, `member`, `position`, primary key on the first two) whose `member` is `CHECK`ed `IN` the list, so SQLite refuses a member off it and a member is a row a query finds, never a word in a delimited cell. Written as a list (one member alone is a list of one), each matched case-insensitively and stored as the list spells it; `match` is membership; a text document writes a JSON list. It cannot be required, unique or in a unit. A list changed over members it holds is refused, as an enum's is. **`elsewhere` is the seventeenth** (schema 61, language 23, M47 U4, D-461): **a row in another document**, as `TEXT` — that document's path (absolute, or relative to the holding document's folder) and the row's name, `F:/projects/site/site.emd S1 U5`, `CHECK`ed by shape only. By name and never by id, since a text document renews ids. Never refused for being out of reach: the plugin reads it where it points and prints the row's format, name and state beside it, or *unresolved* and why. No `unit`, no `target`. **`file` is the eighteenth** (schema 62, language 24, M37 U6, D-479): **where a file on this computer is**, as `TEXT` `CHECK`ed non-empty — a path with `/`, relative to the holding document's folder when the file is under it and absolute otherwise, or a local app's own address from an allowlist (`obsidian:`); `http`, `https`, any other scheme and a share on another machine are refused. Never what is in it, and never refused for a file that has gone: a read says *missing*. No `unit`, no `target`. |
| `target` | text? | The format a `link` points at, and NULL for every other type. A **format** name, not a table name: a declaration names declarations. It may name the format it is on. The `REFERENCES` clause it compiles to enforces nothing — this app never sets `PRAGMA foreign_keys = ON` (D-067) — so the refusal that holds is at the moment a row is written, naming the column and the id. A write may give the target's **name** instead of its id when the target's first `text` column is `unique` (D-256); it is resolved to the id before the write, and the id is what is stored. |
| `found_by` | text? | **How a `link` fills itself on a write while it is empty** (schema 58, language 18, M29 F8, D-350): `date in period` — this row's date falls in the target's month (a `month`, or a `date`'s month) — or `date on paid_on`, the same day. NULL for every other column. The link found is **stored**, as if picked; no row or two refuses the write by name; a link a person set is never moved. In a `.format.md` it rides in the `points at` cell: `paycheck, found by date in period`. Rows already there are filled only on demand — `apply_rules` with `link`, or *Apply* in the connection window (D-353). |
| `unit` | text? | `g`, `mg`, `kcal`. **Free text, and interpreted where it is one the document knows** (schema 34, D-223): a unit in `MeasurementUnit` converts and one that is not — `per 100g` — is a label. Kept free text on purpose, so no declaration written before U4a stopped parsing. A unit change alters no SQL and every meaning, which is why the reconciler refuses one it can see. |
| `per` | text? | **The other half of a ratio: this column is `unit` per `per`** (schema 36, D-225). A density is `g` per `ml`; what one of them weighs is `g` per `each`. It is the one thing `unit.ts` refuses to know, written down by the person who knows it, about the thing it is a fact about — and an identity crosses a dimension by naming the column after a `via`. `integer` and `real` only, and never without a `unit`. **Changing it is as dangerous as changing a unit and is refused the same way**: no SQL moves, no row is lost, and every figure bridged through it is out by a factor. |
| `scale` | integer? | **How many places a `decimal` keeps**, 1 to 9, and NULL for every other type (schema 39, D-257). More places than this is refused, never rounded. Changing it re-means every stored figure by ten, so the reconciler refuses it over rows as a `TYPE_CHANGED`. |
| `required` | bool | `NOT NULL`. |
| `is_unique` | bool | **No two rows hold the same value** (schema 38, language 5, D-255): a `UNIQUE` index named `<table>__<column>__unique`, which is how the reconciler finds it again. `text`, `integer`, `date`, `link`, and since language 6 `decimal` and `month`. An empty cell collides with nothing. Adding it over values that repeat is the reconciler's fifth refusal, `NOT_UNIQUE`; a write that would repeat one is refused naming the row that holds it. |
| `minimum` / `maximum` | real? | Inclusive, `integer`, `real`, `decimal` and `percent` only — a decimal's is written as the figure, must fit its places, and compiles onto the stored integer; a percent's is the percent (`100`), compiled to millionths. A `quantity` takes neither: a maximum of 500 means nothing when one row is in grams and the next in kilograms. |
| `note` | text | What the column means, in the declarer's words. |
| `position` | integer | Declaration order, which is the artefact's order and the table's. |

### FormatColumnValue

An enum's members, as rows — (`format_name`, `column_name`, `value`), with a `position`. A
comma-separated string would have been shorter and would have been the untyped storage the whole
design rejects.

### FormatIdentity

**Primary key** (`format_name`, `name`). Schema 33, M19 U3, [D-222](./09-decision-log.md).
**Nothing here becomes SQL**, and that is the whole shape of it:

> A `CHECK` says what cannot be stored. An **identity** says what should add up. The first refuses
> the row; the second reports on it.

A label whose macros come to 61.6 against a printed 62 is a real label, so refusing it would lose
the reading that proves the point. The expression is parsed by the engine's own total parser and
evaluated in TypeScript over numbers; it never reaches `db.run` as anything but a value, and
D-216's refusal of a free-text `CHECK` is untouched. **A verdict is computed on read and never
stored** — a stored one is a fact about a declaration that has since changed, which is the frozen
table of totals the vault already suffered from (D-210).

| Field | Type | Notes |
|---|---|---|
| `name` | text | `snake_case`, unique in the format, and what a verdict is reported by. |
| `expression` | text | One `=`, with `+ - * /`, brackets, numbers, this format's own numeric column names, `<expression> in <unit>` (D-223), **one hop through a `link`** — `analogue.kcal` — and the names of this format's aggregates (D-224). **Stored exactly as it was typed** and never normalized: the artefact exists so two versions of a format can be diffed by a person. |
| `tolerance_kind` | enum | `ABSOLUTE` · `RELATIVE`. |
| `tolerance_amount` | real | `ABSOLUTE` is `\|left − right\| ≤ amount`, where zero is exact and is what money wants; `RELATIVE` is a percentage of the right-hand side, which is what a rounded label wants. **On a money column the amount is in minor units.** |
| `note` | text | Why it has to hold, in the declarer's words. |
| `position` | integer | Declaration order, which is the order a person reads them. |

An identity may only name the numeric columns — `integer`, `real`, `decimal`, `percent`, `money`,
`quantity` — and a date, a time or an instant only as one side of `end - start` with another of its
type, a span (D-335), or **as a whole side against another of its type: `follow_up = last_reviewed + 1
week`**, a date moved by whole days or weeks (`7 days`, `2 weeks`), its tolerance a number of days
(D-471); arithmetic over an enum is a category error. **Money enters as its minor units** with its currency carried beside it,
so two currencies meeting in one sum are `unchecked` rather than added (D-138: nothing invents a
rate inside a proof).

**The verdict has three states** (D-149): `proved`, `failed`, and `unchecked` for a row that cannot
answer — a column the identity names is empty here, a divisor is zero, two currencies met, or a
conversion crossed a dimension. On a half-filled format most rows are `unchecked`, which is the
honest answer and not a failure.

**A conversion is written, never inferred** (D-223). `pack in g = serving * servings` proves a
kilogram against grams; nothing else in the expression consults a unit at all, and that is
deliberate — the flagship identity of this milestone adds grams and compares them to an energy and
is *correct*, because Atwater's 4 is `kcal/g` and no declaration says so. An engine checking
dimensions on every sum would report it as a problem. **An `in` is judged when the declaration is
made**, against the units the document holds, so a conversion that could never work is a refusal a
person reads rather than an `unchecked` on every row for the rest of the format's life — the one
failure mode an identity has that a `CHECK` does not.

### FormatAggregate

**Primary key** (`format_name`, `name`). Schema 35, M19 U4b, [D-224](./09-decision-log.md), and it is
the clause D-210 moved the engine's line to permit.

> A figure this format works out **from the rows of another format that point at it**.

| Field | Type | Notes |
|---|---|---|
| `name` | text | `snake_case`, unique in the format, and what the figure is reported by. **It may not be a column name of the same format**: an identity can name either, and one word meaning two things is the silence this milestone exists to remove. |
| `kind` | enum | `SUM` · `COUNT` · `AVERAGE` · `MINIMUM` · `MAXIMUM` · `LATEST` · `EARLIEST`. Five folds and two picks, each checkable by hand. No `MEDIAN`, no `DISTINCT`. The picks (schema 45, language 11, M25 E3, D-272) read one row by `by_column` — an order over rows already gathered, not a traversal. `AVERAGE` is here rather than left to `SUM ÷ COUNT` because the hand-written version divides a fold that went `unchecked` by one that did not. |
| `over_format` / `over_column` | text | The rows folded: a format, and its `link` column pointing back here. **Both halves are checked when the declaration is made** — a column pointing somewhere else would fold every row of the source into every row of this format, silently, and the figure would look plausible. **An empty `over_column` is every row of the source, on purpose** — written `every course` (language 21, D-397). |
| `expression` | text | Evaluated on each of those rows, **in the source format's vocabulary** — its own columns, its derived columns as each row shows them (D-349), and one hop through its own links: `amount_g / 100 * ingredient.kcal`. A total of money carries its currency; rows in two are `unchecked`. Empty for `COUNT`. Stored exactly as typed, for the reason an identity is. |
| `unit` | text? | What the result is in. Declared rather than derived, because the expression's own unit is something the engine deliberately will not always name (D-223), and it is what lets an identity write `total_kcal in kJ`. |
| `note` | text | Why it is worth computing. Prose, stored, never parsed. |
| `position` | integer | Declaration order. |
| `where_column` / `where_member` | text? | **Only the rows that match** (schema 41, language 8, M24 U8, D-260). One `enum` or `boolean` column of the source row, or one hop through its link — `deduction_type.reduces_net` — and the one member it has to be, `true` / `false` for a boolean. Both empty folds every row. Checked when declared: a member the column has not got would match nothing and sum to zero. **Since language 19** (D-380, M36 U04) `where_member` holds what follows `is`: `not X` (an empty cell passes it), `one of X, Y`, `not one of X, Y`, `empty`, `not empty` — the last two of any column but a list. A member written before reads as it always did. |
| `by_column` | text? | **What `LATEST` and `EARLIEST` pick by** (schema 45, language 11, M25 E3, D-272): a `date`, `month`, `instant` or `integer` column of the source's own row — never a hop. Required for the picks, refused on a fold. In the artefact it follows the source in the `over` cell, before any filter: `security_price.security by as_of`. |

**Nothing here becomes SQL**, which makes three tables in a row that do not. An aggregate is **folded
on read and never stored**, for the reason a verdict is: the vault's own failure was a table of
totals computed once and frozen into prose while its inputs moved underneath it (D-210). So the
reconciler has nothing to say about one, and the editor reports *"already matches — saving changes
the wording and nothing else"*.

**A sum that skipped a row is not a smaller sum.** The whole fold is `unchecked` the moment any row
it covers cannot answer, and it names the row — D-138 in the one place the alternative looks most
reasonable. Zero rows is a different question: a sum of nothing is **zero**, because a recipe with no
lines really has none, but there is no least member of nothing, so the other three say so. **A claim
over a sum that no row points at is `unchecked`, not failed** (M33 F7, D-465) — there is nothing to
prove yet — unless it holds over the zero; rows that point here and that a filter takes none of are a
real zero, and judged. **A row
with nothing in the filter column is a row that cannot answer**, not a row that does not match.

**A pick needs only the row it picked** (D-272). Two rows tied at the greatest order, or one with
nothing in the order column, make it `unchecked` and name them — a tie is two answers, and choosing
one is a guess. With no filter, the repository finds the candidates in SQL (the rows at the extreme
order, and those with none) rather than reading every row.

**An identity may name an aggregate**, and that is what it is for. `total_kcal / servings =
printed_per_serving` is the sentence a recipe card prints. **An aggregate does not satisfy H3**: a
format that works out a total and proves nothing about it has still answered nothing.

### FormatRollup

**Primary key** (`format_name`, `name`). Schema 44, declaration language 10, M25 E2,
D-271.

> A figure **per month**, and per linked row when it says so, over the format's own rows — the
> ledger's statistics, as a declaration.

| Field | Type | Notes |
|---|---|---|
| `name` | text | What the view is asked for by: `spending`. Shared with no column or aggregate of the format. |
| `works_out` | text | The rollup as its one sentence, parsed on read: a kind (`sum`, `count`, `average`, `minimum`, `maximum`), `of` one `integer`, `real`, `decimal` or `money` column, or a derived column that is a number (D-335; read off its view's `SELECT`) (none for `count`; no `average` of money), `by` a `month` column or `month of` a `date` column with at most one `or` fallback, optionally `and` one `link`, optionally `where` filters as an aggregate's, joined by `and`. |
| `note` | text | Why it is worth declaring. Prose, never parsed. |
| `position` | integer | Declaration order. |

**Compiled to one `GROUP BY` when read, never stored** (D-222): by the month, the link and, for
money, the currency — money is never added across two. **A row that cannot answer makes its own
group `unchecked`** and no other: nothing in the folded column, or nothing where a filter reads.

### FormatDerived

**Primary key** (`format_name`, `name`). Schema 55, declaration language 16, M29 U3b,
D-334.

> A column **worked out from other columns** rather than typed — a spreadsheet's formula, in the
> identity grammar.

| Field | Type | Notes |
|---|---|---|
| `name` | text | The view's column. Shared with no column, stored column or aggregate of the format. |
| `expression` | text | As typed, parsed on every read: an identity's side with no `=` — this format's numbers, one hop `link.column`, an aggregate's name, another derived column, `x in g`, `end - start` of two points (D-335), or a date moved by whole days, `last_reviewed + 7 days` — a computed date, `date(d, '+7 days')` in the view, which sorts and filters like a typed one (D-471). One that reads `today` (`due - today`) is left out of the view and worked out by the reader with its own day (D-472). |
| `note` | text | Why. Prose, never parsed. |
| `position` | integer | Declaration order. |

**Stores no cell.** The reconciler compiles a format's derived columns into one view,
**`fmt_<name>__derived`** — `t.*` and every derived column — from the parsed tree, never the text:
dropped before any table changes and before a migration, rebuilt after (`buildDerivedViews`). A
money result is two columns, `<name>_minor` (rounded once, halves away from zero, D-333) and
`<name>_currency`; anything else is one. An empty input, `x / 0`, two currencies or an aggregate
over a row that cannot answer is `NULL`. **Since language 20** (D-381, M36 U05) an aggregate it names may be a
`latest` or `earliest`: the one row picked by its order, `NULL` on a tie, an undated row or none.

### FormatRuleSet

**Primary key** (`format_name`, `name`). Schema 46, declaration language 12, M25 E4,
D-273.

> A format's rows **as rules that set a link of another format** when a text column matches —
> the ledger's category rules, as a declaration. Declared on the format whose rows are the rules.

| Field | Type | Notes |
|---|---|---|
| `format_name` | text | The rule format: `category_rule`. |
| `name` | text | What it is asked for by: `categories`. Shared with no column, aggregate or rollup of the format. |
| `sets` | text | The rule set as its one sentence, parsed on read: `transaction.category from target when merchant_normalized matches pattern by kind (EXACT_MERCHANT equals, CONTAINS contains, REGEX regex) first by origin then priority where is_enabled is true and scope_account is empty, recorded in category_source as RULE, never over MANUAL, noting matched_rule`. The target link and the rule's link name one format; what it reads is text (`or` for several); the kind is `as <kind>` for all, or an enum of the rule's members named against `equals`, `contains`, `starts with`, `regex`; `first by` required integer, date, month, instant or enum columns (an enum by its declared order); filters are the rule's own row, and `is empty` besides; the source an enum of the target holding both members; `noting` a link to the rule format. |
| `note` | text | Why it is worth declaring. Prose, never parsed. |
| `position` | integer | Declaration order. |

**Applied, never stored beyond the sentence**: on a generic write of the target (the format's
page, `record_format_rows`, `update_format_rows`, `read_onto_format`) before the row is judged, and
on demand by `apply_rules` and the rule format's *Apply*. **Not in `insertRows`** — a text document's
rows come back through it on open, and opening must change nothing. A rule's pattern that is empty,
over 200 characters or a regex that does not compile refuses the rule's own write.
**A row is the rules' while its source is empty or the rule member, or while its link is empty and a
person did not empty it**; a link a writer changes is recorded as the person member. Rules tied at
the top of the order naming different rows leave the row as it is and are named.

### FormatConstraint

**Primary key** (`format_name`, `position`). Schema 40, declaration language 7, M24 U7,
D-259.

> What has to be true **across the columns of one row** — the three things the ledger's
> cross-column `CHECK`s say, and the one its composite `UNIQUE` indexes say (D-270).

| Field | Type | Notes |
|---|---|---|
| `rule` | text | The constraint as its one sentence, parsed on read: `ref is required when kind is A, B` (with `required only when`, *and empty otherwise*), `at most one of a, b, c`, `amount is at most 0 when direction is OUTFLOW` (or `at least`), `one row per a, b` (optionally `when kind is A, B`) on any type a column may be `unique` on, and `instant`, `enum` or `boolean` too. The deciding column is an enum of the same format and the members are its own; a sign goes on `integer`, `real`, `decimal`, `money` or `quantity`, and reads a money column's minor units. A rule that no longer parses makes its format unreadable rather than quietly unconstrained. |
| `note` | text | Why it has to hold. Prose, stored, never parsed. |
| `position` | integer | Declaration order. |

**Compiled to triggers, never typed as SQL** (D-216). Each constraint is a `BEFORE INSERT` and a
`BEFORE UPDATE` trigger on the declared table, named `<table>__check_<key>__insert` / `__update`
(the key hashes the sentence), raising the sentence itself. A trigger rather than a table `CHECK`
because SQLite cannot add a `CHECK` to a table that exists. **Every write surface refuses first**,
in `row.ts`'s `brokenConstraints`, so a dry run names the rule and the row; the trigger is what holds
for anything that reaches SQLite another way. **At most one of** is how a row points at one of
several formats: several ordinary links, never a link to *any of N* (D-252). **One row per** is the
exception (M25 E1, D-270): a `CREATE UNIQUE INDEX <table>__check_<key>__index` over its columns,
partial (`WHERE kind IN (…)`) when it has a `when`, since it is a fact about the table and a
trigger could only ask it with a subquery. Empty cells collide with nothing, as SQLite's `UNIQUE`.
`repeatedValues` refuses it first, naming the row that already holds the values.

### FormatIntake

**Primary key** `id`. Schema 37, M19 U5, [D-226](./09-decision-log.md).

> One file, read onto one format: which file it was, the reading that read it, and when.

| Field | Type | Notes |
|---|---|---|
| `format_name` | text | The format read onto. **No foreign key**, for 035's reason: this app never runs `PRAGMA foreign_keys = ON` (D-067), so one would enforce nothing while making `deleteFormat` depend on a pragma nobody sets. `forgetIntakes` is the rule that holds. |
| `file_name` | text | What the file was called, so the offer to supersede names something a person recognises — and, since schema 60, **what makes it the same source**: a corrected export has a new hash and is read again over the rows the last one wrote (M38 U3, D-408). Indexed with `format_name`. |
| `file_hash` | text | What makes this **the same file** rather than a similar one. *What makes two rows the same row* is a fact about the format, so the engine takes it only from what the format already says — a unique column, or a note's file name (`format_intake_row.source_key`, D-408) — and never invents one: that would be the density mistake H7 exists to prevent (D-223). |
| `signature` | text | The header cells, normalized and sorted. **Kept as text rather than hashed** (D-139 one level up): a hash answers *same or not*, and the ladder needs *how close*. |
| `header_row` / `date_order` | integer / enum | The reading's two whole-file answers. `dmy` · `mdy` · `ymd`. |
| `read_at` | integer | Epoch milliseconds. |
| `row_count` | integer | **Nothing once superseding has run, and the row stays.** Removing the rows a file wrote and forgetting how to read that file are two acts, and the ordinary flow is supersede → correct → read again. Counts the lines, never the header row. |
| `header_format` / `header_link` | text? | **The one row of another format this file also wrote** (schema 42, M24 U10, D-262) — a statement's printed total, period and card — and the lines' link that points at it. Both empty is a reading of lines alone. |
| `header_cells` | text? | The header **in the file's own order**, a JSON array of normalized cells (schema 51, M26 F1, D-293). The signature is sorted; this is what lets a reader follow a moved column by its name. Empty for an older reading, whose reader then fits nothing until it is made again. |
| `forgotten` | 0/1 | Its reader was forgotten (schema 51): the reading is no longer offered, and its rows and `format_intake_row` stay, so superseding still works. |

### FormatReader

**Primary key** (`format_name`, `signature`). Schema 51, M26 F1, D-293.

> The name a person gave a reader. A reader is a format's readings grouped by `signature` (D-292), so
> its name is kept by the same pair; without a row it is named by the file it last read. Forgetting a
> reader and `deleteFormat` clear it. A text document carries it in the `readings.md` part, with the
> intake tables (D-408).

| Field | Type | Notes |
|---|---|---|
| `format_name` / `signature` | text | The reader. No foreign key, for 035's reason. |
| `name` | text | `CHECK` not blank; an empty rename deletes the row. |

### FormatIntakeColumn

**Primary key** (`intake_id`, `key_name`). Schema 37, M19 U5.

> The reading itself: one row per key that gets filled, and where its value comes from.

| Field | Type | Notes |
|---|---|---|
| `key_name` | text | A member of `offeredKeysOf` — a column's own name, or the companion key of a two-column type (`paid_currency`, `amount_unit`). **A key and not a column** is what carries `money` and `quantity` with no special case. |
| `source_index` | integer? | The column of the file that fills it. |
| `fixed_value` | text? | Or the same value on every row: a currency for a file that holds one, a unit for a file measured in grams, or **a link** for the whole file. Since D-261 a link may also come from a column (`source_index`), matched by the target's unique name. |
| `separator` | text? | What splits one cell into members, for a column read onto an `enums` key (schema 59, D-398) — `,` for `vegan, quick`. Stated by the reading, never guessed; NULL is a cell holding one member. |

The `CHECK` is the whole grammar of a binding: `(source_index IS NULL) <> (fixed_value IS NULL)`. A
key is filled by a column **or** by one value for every row, never both and never neither.

### FormatIntakeHeaderCell

**Primary key** (`intake_id`, `key_name`). Schema 42, M24 U10, D-262.

> Where the header row's values come from: one cell of the file, or one value for the file.

| Field | Type | Notes |
|---|---|---|
| `key_name` | text | A key the header format offers, as in `FormatIntakeColumn`. |
| `source_row` / `source_index` | integer? | **A position, never a value** (D-137): a model says where the total is and code reads it. A row **below zero counts from the file's last row that holds anything**, because a printed total sits under the lines and its row moves with every statement while its distance from the end does not. |
| `fixed_value` | text? | Or one value for the file — a currency, or the card, by id or unique name. |

Two `CHECK`s: a position is both halves or neither, and a key is a position **or** a value.

### FormatIntakeRow

**Primary key** (`intake_id`, `row_id`). Schema 37, M19 U5; `format_name` schema 42, M24 U10.

> Which rows that reading wrote — **and the header row, with `format_name` saying which table it is
> in** (empty is the intake's own format). That is what lets superseding take a statement back with
> its lines, and refuse rather than take back only the lines.

| Field | Type | Notes |
|---|---|---|
| `source_key` | text? | **Which line of its source the row is** (schema 60, M38 U3, D-408): a note's file name, or the value of the format's unique column the reading fills (its name column when that is unique). A second read of a file of the same name updates the row whose key its line holds, adds a row for a new key, and names — never removes unasked — a row whose key is gone. NULL for a read with no key, which adds to what it wrote as every read did. |
| `written` | text? | **The mark of what the read put in the row**: a hash of its filled cells less its links, then the keys it covers (`<hash>:name,kcal`). A row that no longer matches it was changed by a person since, and a later read leaves it and says so — a manual value is never overwritten by a re-import. Links are left out because a text document re-mints ids (D-247). |

A source read again moves its rows' records to the new reading; a gone row stays under the reading
that wrote it, and `row_count` of every reading of that source is its records.

**The rows themselves carry nothing about where they came from**, and that is not an omission: a
declared table has exactly the columns somebody declared, and an engine that quietly added a
`_came_from_file` column to one would be the untyped storage D-209 refused, arriving through the
back. Provenance is a fact about the *import*, so it is kept beside the import — which is what makes
superseding possible at all, and what makes *what did reading this file actually do to my document*
answerable.

**A text document carries all of it** in a `readings.md` part (D-408): a block per reading, headed
by the file, its mapping and its rows as one line of JSON each, every row by its name and which of
that name it is in the text (`RowRef`) since the text holds no ids. A reading's id is derived from
its format, file, hash and moment, so the same text gives the same id on every open. Before schema
60 a read into a text document could not be saved at all.

### FormatSeed

**Primary key** (`format_name`, `seed_key`). Schema 43, M24 U12, D-264.

> Which rows of a declared table a pack put there — kept beside the table for `FormatIntakeRow`'s
> reason.

| Field | Type | Notes |
|---|---|---|
| `format_name` | text | The seeded format. |
| `seed_key` | text | The row's name under the format's **unique** naming column — not its id, which a text document re-mints (D-247). |
| `state` | text | `SEEDED` — the pack's, and a later build may correct it. `REMOVED` — a person took it away and a reseed does not bring it back. **A row a person edited has no record**: it is theirs. |

`updateRow` deletes the record on an edit that changes a cell, and `deleteRows` sets `REMOVED`. A
text document carries the records in a `seeds.md` part when there are any.

### FormatColumnView

**Primary key** (`format_name`, `column_name`). Schema 49, M26 U2, D-289.

> How wide a format's sheet draws a column. **Presentation, so beside the declaration and never in
> it**; kept per document by request (D-289).

| Field | Type | Notes |
|---|---|---|
| `format_name` | text | The format. `deleteFormat` clears its rows. |
| `column_name` | text | No foreign key: a declaration is rewritten whole on every save, and a width for a column that has gone is read by nobody. |
| `width` | integer | CSS pixels, `CHECK` 48 to 1200. |

A text document carries the widths in a `views.md` part, only for columns that still exist. No tool
writes here (D-289).

### FormatSavedView

**Primary key** (`format_name`, `name`). Schema 63, M53 U5, D-514, D-520.

> A format's filter, order, columns and kind of view under a name — what a view's address holds,
> kept so the rail opens it again and a conversation draws it by name. **Presentation, never the
> declaration**, and not a format (D-514).

| Field | Type | Notes |
|---|---|---|
| `format_name` | text | The format. `deleteFormat` clears its rows. |
| `name` | text | 1 to 60 characters, one line, never opening with `?` nor a view's own word (`savedNameRefusal`). What a dashboard points at, with the format. |
| `kind` | text | `table` · `board` · `list` · `roadmap` · `ready`, `CHECK`ed: the view it opens as. |
| `address` | text | The address's query as `addressFilter.ts` spells it, in one spelling — `?due=today&state!=done&order:due=ascending`, or empty for every row; at most 2,000 characters. Kept as words, so a window around today (`today`, `within 7 days`) is worked out the day it is opened. No foreign key to a column: an address naming a column that has gone draws every row and says why. |

Not more rows of `format_view_column`: a setting there is one word of at most 32 characters for one
column. Written by the FilterBand's *Save this view* and the rail's rename and delete, and by
`arrange_views view:saved` (D-520). A text document carries each as a block of its `views.md` part
under `### <format> saved` — `name`, `kind`, `address`.

### FormatDashboardBlock

**No key; one row per block.** Schema 64, M53 U7, D-514, D-521.

> A dashboard's blocks, in order — a format's (`dashboard` its name) or the document's (`dashboard`
> NULL). A block is a saved view drawn compact in its kind, a rollup's chart, or a headline total,
> **and nothing else** (D-514): no free text, no embed. **Presentation, never the declaration**, and
> not a format.

| Field | Type | Notes |
|---|---|---|
| `dashboard` | text, nullable | The format whose dashboard it is on, or NULL for the document's. |
| `position` | integer | Its place, from 0; every write renumbers the dashboard's blocks. |
| `format_name` | text | The format the block reads — always `dashboard` on a format's (`setDashboardBlocks` refuses another). |
| `kind` | text | `saved` · `rollup` · `total`, `CHECK`ed. |
| `name` | text | 1 to 60 characters: the saved view's name, the rollup's, or the headline total's own. Unique with `format_name` on one dashboard (`format_dashboard_block_one`, on `ifnull(dashboard, '')`). |
| `sum` | text, nullable | A headline total's column summed — a number or money column; NULL is a count. Only on `total`. |
| `address` | text | A headline total's filter as `addressFilter.ts` spells it (`?state!=done`), empty for every row; at most 2,000 characters. Only on `total`. |

Not more rows of `format_view_column`, for 063's reason. A saved view's rename renames its blocks and
its delete deletes them; a rollup a declaration drops leaves its block drawn as gone, with the
sentence, until it is removed; `deleteFormat` clears the format's dashboard and every block that reads
it. Written by the dashboard's own screen (Add a block, drag, Move earlier and later, Remove from this
dashboard) and by `arrange_views view:dashboard` (D-521). A text document carries each block in its
`views.md` part in order, under `### <format> dashboard` or, for the document's, `### Document
dashboard` (a capital no format's name has) — `kind`, `name`, the `format` it reads on the document's,
and a headline total's `sum` and `address`.

### FormatGraphPlace

**Primary key** (`kind`, `name`). Schema 50, M26 U4, D-291.

> Where a bubble sits on the connections canvas — `FormatColumnView`'s kind of thing, kept its way.

| Field | Type | Notes |
|---|---|---|
| `kind` | text | `FORMAT` — one format's bubble; `deleteFormat` clears it. `PACK` — the one bubble a pack's formats fold into (D-269); a pack is not a row anywhere, so there is no foreign key. |
| `name` | text | The format's name, or the pack's. |
| `x`, `y` | integer | Canvas pixels before zoom, `CHECK` within ±100,000. |

A format with no place is put by the rank layout. A text document carries the places in a
`graph.md` part, only for formats and packs still there. No tool writes here (D-291).

### MeasurementUnit

**Primary key** `symbol`. Schema 34, M19 U4a, [D-223](./09-decision-log.md), and it is
[H7](./engine.md)'s answer in a table.

> **The engine owns dimension and conversion. A factor that crosses a dimension is a column
> somebody declared.**

`kg` to `g` is arithmetic — true in every domain, needing nothing from the document but the two
symbols — and a pack that rebuilt it would rebuild it badly, which is the `cost`-role bug (D-208)
one level up. `ml` to `g` is not arithmetic: it needs a density, and a density is a fact about
*pasta* rather than about volume. So a conversion inside a dimension happens and one across a
dimension stops and names what it would need.

**U4c gave that refusal a way through without moving it** (D-225). An identity writes `amount in g
via ingredient.density`, and the engine crosses the dimension by doing arithmetic on the ratio that
column declares — `unit` per `per`, one hop away. The engine still knows no density: it performs a
fact it was handed and refuses every crossing it was not. A build that ever puts one in `unit.ts`
has made the mistake H7 was opened to prevent, whatever `convertAcross` says.

| Field | Type | Notes |
|---|---|---|
| `symbol` | text | `kg`, `tbsp`, `µg` — as written on a column and after an identity's `in`. **Case is kept**: `mg` and `Mg` are a thousandfold apart in every table that has ever printed both. |
| `dimension` | enum | `MASS` · `VOLUME` · `LENGTH` · `TIME` · `ENERGY` · `COUNT` · `RATIO`. `RATIO` (schema 39, D-257) is seeded with `%`, its base, and `bp`; nothing converts a ratio into money. **Physics, not food** — the list reaches past the three the recipe vault needs so the engine's unit model is not shaped by one pack. `COUNT` is seeded with `each` alone: one clove and one can are both one thing, and what a clove weighs is the far side of the line above. |
| `per_base` | real | How many of that dimension's base unit — `g`, `ml`, `mm`, `s`, `kJ`, `each` — one of these is. A ratio of measurements is not money, and a `money` column carries no unit at all, so there is no path from this multiply to an amount. |
| `origin` | enum | `SEEDED` · `USER`, as `ColumnRole` draws it (D-212), so a later build can correct a factor it got wrong without overwriting a number a person entered. |
| `note` | text | What it is, or which convention it follows. Prose, stored, never parsed. |
| `created_at` | instant | |

**Rows rather than a `const`, and there are two reasons.** The first is D-212's: a vocabulary
compiled into the binary cannot name a thing a real document measures in, and somebody weighing in
`oz` or portioning in `slice` would be at the wall that cost M16 ₪3,639 with a release as the fix.
The second is new. **A tablespoon is 15 ml here and 20 ml in Australia**; a cup is 240 ml and also
250; a fluid ounce is two volumes on two sides of an ocean. Those are conventions rather than facts
the engine gets to be right about, so every seeded row that is a convention says so in its note —
which is what tells a person the row is theirs to change. `record_units` is how they change it.

**Nothing here becomes DDL, a `CHECK` or a trigger**, and a column's `unit` is *not* a foreign key
into this table: `per 100g` is a label somebody wrote, and refusing it would have broken every
declaration written before schema 34.

**`in` is the one symbol this table may never hold.** It is the word an identity converts with —
`serving_weight in g` — so the inch cannot be seeded and a column may be called neither `in` nor
`via`, the word that names the fact a conversion crosses a dimension through (D-225). That is
the whole price of the syntax.

### DocumentSetting

**Primary key** `key`. Schema 57, M29 F3, D-344. What a document
says about itself, beside its formats — and the second exception to *the engine keeps no settings in
the document*, by request, as widths were the first.

| Field | Type | Notes |
|---|---|---|
| `key` | text | One so far: `currency`. A key and a value rather than a column per setting, for D-034's reason. |
| `value` | text | For `currency`, three capital letters, `CHECK`ed: what a new amount on a screen starts in until a row says otherwise. Chosen on a money column's panel the first time one is made, changeable there or with `record_units`. A row already kept never moves with it. |

A text `.emd` writes it as `settings.md` (`currency: ILS`), and only when one was chosen.

### What the reconciler will not decide by itself

D-214 named two; building it found four, and M24 two more. Each ends the same way — **nothing is written, the plan
says why, a person answers** — and each becomes an ordinary step when the column holds no data,
which is what makes redrafting a format the ordinary work [H9](./engine.md) says it is.

1. **Dropping a column that holds data.**
2. **Changing a column's type, or its unit.**
3. **Re-constraining a column that holds data** — required, enum members, bounds. SQLite cannot
   alter a constraint in place. **Loosening `required` is not one** (M36 U08, D-384): the column is
   copied through a nullable twin and every value kept (`LOOSEN_COLUMN`).
   **Nor is a list every row fits** (M38 U6, D-412): an enum re-listed, a text made an enum or an enum
   made a text is the table made again with every row copied (`REBUILD_TABLE`), on any format, once each
   held value is checked against the new list — refused, naming the values, when one is off it.
   **A pack may vouch for its own table** (M36 U09, D-386): `adoptFormat`'s `vouched` names columns the
   owning pack's install may drop with their data. Ignored on a format no pack owns; the ledger names its
   own in `REBUILT_COLUMNS`.
4. **Adding a required column to a table that already has rows.** SQLite refuses it outright.
5. **Making a column unique over values that repeat** — `NOT_UNIQUE` (D-255).
6. **Adding a row constraint that rows already break** — `NOT_HELD` (D-259); `extend_format` lists
   the rows by id, as it does for a column it would drop with values or a list a row does not fit (D-412).

A `fmt_` table with no declaration behind it is an **orphan** and is left strictly alone.

**An identity is none of the four, and nor is a derived column** (D-334), which is a view rebuilt
from the declarations rather than a table altered. An identity compiles to no SQL, so changing or removing one loses
nothing and the plan for it is empty — the mirror image of a unit change, which alters no SQL and
re-means every stored figure.

**In a document stored as text, the text is the way round the second.** The declaration and its
rows are re-read from the text on open, so a column's type changed in the text — where its values
already read correctly as the new type — is a new table with no plan to refuse it. M27 U1 proved it
on `unit.milestone`, text to a link to `milestone`: a link in text is its target's name, and the
cells already held the names. It was put back, because `match` compared a link by its row id — and
went in for good in M27 U2, when `match` learned to take a link's name (D-300). No tool and no
screen retypes a column that holds data.

## Cross-cutting, in the core

- **The engine keeps no settings in the document** (D-115). The theme, the local-model preference and
  the price-fetch switch are the machine's, in `localStorage`. **One exception, by request:**
  a sheet's column widths are the document's, in `format_column_view` (D-289), and so are the
  connections canvas's places, in `format_graph_place` (D-291), and the way each column is
  shown on a format's entry (Show as, D-294, D-402), in `format_view_column`, and its currency, in `document_setting` (D-344) — one table for every view, and
  a board is more rows of it: `lanes` on the enum its lanes are, `card` on a column a card shows (D-301), and so are a roadmap (`order`, `under`, `line`) and a page (`body`, `line`) (D-302, retired by D-401: still read, drawn by nothing), a ready view (`waits`, `ready <members> done <members>`, `line`, and `stalls <days>` on a date, D-501) and a start view (`is <member>`, `latest <count>`, `line`) (D-303), and an agenda (`date`, `done <members>`, `line`) (D-473), and a list (`group`, `line`, `done <members>`, words one column holds together, D-519); a view saved under a name is its own table, `format_saved_view` (D-520), and so is a dashboard's block, `format_dashboard_block` (D-521). An entry's `setting` is a way to show the column (`figure`, `bar`, `steps`… — a worked-out column's too; the retired `field` and `search` read as none, D-402), a place on the page
  (`#2`), `header` (in the line under the title, D-401), `hidden` (kept off this entry view even when it holds a value, never the title or a required column) and `new` (a new entry asks for it) (D-517), or several (`line #1 header`): the page's order is the view's and never the declaration's (D-296). The screens write these and so does a conversation, through `arrange_views` (D-403) — Show as, `header`, `hidden`, `new_entry`, the order, a board's `lanes` and a width, and since D-469 every roadmap, ready and start word as a column's `setting`, one column holding a sole word (`order`, `waits`, `ready …`, `latest`) at a time; the roadmap's *In the order of* is the screen's too, and a word is at most 32 characters (052's CHECK); a canvas place stays the screen's (D-291). **A pack's settings are a format it
  declares** (D-282): the ledger's `setting`, a unique `key` and a JSON `value`, which is what
  `app_setting` (migration 006, D-034) was until migration 048 dropped it.
- **Schema 48 drops every table the ledger made before M25** (D-282): a document holds the engine's
  tables and `fmt_` tables, and nothing else.
- **Instants are epoch milliseconds**; date-only values are `YYYY-MM-DD` strings and never a
  `Date` carrying a zone (D-023). A declared `date` column is checked with the same `GLOB` the
  built-in tables use.
- **Money is two columns wherever it appears**, including in a table the user declared — a minor
  units integer beside a three-letter code, with a `CHECK` on the code's shape.

## Related

[conventions](./conventions.md) · [05 Domain Rules](./packs/ledger/05-domain-rules-and-calculations.md) · [engine](./engine.md) · [the decision log](./09-decision-log.md) · [the ledger's tables](./packs/ledger/04-data-model.md)
