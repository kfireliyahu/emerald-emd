---
name: declare-a-format
description: Work out a format with the user and declare it into their document with the MCP tool, or write the .format.md they import — the authoring half of a declared format (M19 U1). Use when they want to start tracking a new kind of thing (ingredients, products they try, books, workouts, anything), when they say "declare a format", "add a format", "I want to track…", or when they ask to change the columns of a format they already have.
---

# Declaring a format

**The output of this session is one file**, an artefact the user imports into Emerald at
`#/formats`. Not a screen, not a table, not a migration — a `.format.md` they can read, diff, and
keep in version control beside their own notes.

This is the first arrow at the zero-structure end. For a card statement, arrow 1 is how the data
gets in; **for an intent there is no data yet, only the intent, so eliciting the format *is* arrow
1** (D-215). Nothing about a schema is personal, so this conversation can happen anywhere.

## What you are producing

```
---
format: ingredient
title: Ingredient
language: 1
---

Whatever the user wants said about this format — why it exists, what the figures are measured on,
what they decided and why. This prose is kept verbatim in the document. Write it; half of a good
note is the argument.

| column | type | points at | unit | per | required | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes |  |  |  | What it is called |
| kcal | real |  | kcal |  | yes |  | 0 |  | Energy per the stated basis |
| density | real |  | g | ml | no |  |  |  | What a millilitre of it weighs |
| micros_basis | enum |  |  |  | yes | label, analogue, mixed |  |  | Where these came from |
| price | money |  |  |  | no |  |  |  | What it cost |
| verified | date |  |  |  | no |  |  |  | When somebody last checked |
```

`fixtures/synthetic/ingredient.format.md` is the worked example — thirty-one columns, and the note
this whole design was specified against.

### The rules the app enforces, so get them right here

- **Names are `snake_case` ASCII**, starting with a letter. `Cost`, `עלות` and `two words` are all
  refused: a name goes into SQL and into a grammar handed to a model.
- **Twelve types and no others**: `text`, `integer`, `real`, `date`, `boolean`, `enum`, `money`,
  `link`, `quantity`, `decimal` (with a `scale`), `month`, `instant`.
- **What must be true across two columns of one row is a constraint**, one of four sentences:
  `ref is required when kind is A, B` (`required only when` adds *and empty otherwise*),
  `at most one of a, b, c` (how a row points at one of several formats),
  `amount is at most 0 when direction is OUTFLOW` (or `at least`), and `one row per account, day`
  — unique together, which is how *one reading per fund and day* is said; `when mode is REMAINDER`
  counts only those rows. Ask what a thing is *per* — it is the key a re-import collides on. The deciding column is an enum
  of the same format. A row that breaks one is refused — unlike an identity, which reports.
- **A figure per month is a rollup** (D-271), `{ name, works_out, note }`: `sum of amount by month
  of bought_on and shop where kind is OUT`. One column, never an expression; `month of` a date or a
  month column, one `or` fallback; at most one link after `and`; filters joined by `and`. Ask what
  they total *per month* — the question a spreadsheet's pivot table was answering.
- **Rules that sort another format are a rule set** (D-273), `{ name, sets, note }` on the format
  whose rows are the rules: `product.shelf from shelf when label matches pattern by kind (WHOLE
  equals, PART contains) first by priority, recorded in shelf_source as RULE, never over PERSON`.
  The target needs an enum saying who set the value — ask for one; it is what keeps a person's
  choice from being overwritten. Kinds are `equals`, `contains`, `starts with`, `regex`. Ask how
  they sort things *by name* today — a list of keywords in a spreadsheet is a rule set.
- **A `link` holds the id of a row of another format**, and needs a `target` saying which. It may
  point at the format it is on. Ask what the thing *belongs to* — a recipe line belongs to a recipe
  and names an ingredient — because that question is how a second format gets found, and two linked
  formats are worth far more than one wide one. **Make the target's first `text` column `unique`
  when it is what people call a row** (`ref`, `name`) — then a link can be written as that name
  instead of an id (D-256).
- **`enum` must name its values** and nothing else may. Comma-separated in the `values` cell.
- **`min`/`max` only on `integer` and `real`.** They become real `CHECK`s.
- **`money` takes no unit** — it stores minor units plus a currency per row, because money is never
  a float anywhere in this app.
- **A `quantity` is a figure and the unit it is in, *per row*** — `150 g` on one recipe line and
  `200 ml` on the next. Two columns, like money, and it takes no unit of its own. **Use it only when
  the unit genuinely varies between rows**: where every row is in grams, a `real` with `unit: g` says
  the same thing, says it once, and can be bounded. A quantity takes no `min`/`max`, because a
  maximum of 500 means nothing across two units.
- **A number column may be a *ratio*: a `unit` **and** a `per`.** `density` is `g` per `ml`;
  `egg_weight` is `g` per `each`. That pair is the one fact the app will never supply itself — the
  factor that crosses a dimension — and writing it down is what lets an identity cross one. Ask for
  it whenever a format will be measured two ways.
- **A `unit` is free text, and one the document knows can be converted.** `g`, `kg`, `ml`, `tbsp`,
  `kcal` are conversions; `per 100g` is a label. `formats` prints the ones this document has, and
  `record_units` teaches it one it has not got — slices, IU, a 20 ml tablespoon. Ask what they
  measure in rather than talking them into grams.
- **`date` is `YYYY-MM-DD`**, checked.
- **`required` is `yes` or `no`**, and becomes `NOT NULL`.
- **The header row is fixed and positional.** Ten cells, that order, every row.
- There is **no free-text `CHECK`**. A declaration that carried SQL would be a program.
- **A format also declares what has to add up** — its identities. Each is a `name` in `snake_case`,
  an `expression` with one `=` and arithmetic (`+ - * /`, brackets, numbers) over *this format's own*
  `integer`, `real` and `money` columns, an optional `tolerance` (`exactly`, `2`, or `2%` of the
  right-hand side) and a `note` saying why it holds. `4*protein_g + 4*(carbs_g - fiber_g) +
  9*fat_g + 2*fiber_g = kcal` within `2%` is the worked one.
- **An identity converts with `in`, and only inside a dimension.** `pack in g = serving * servings`
  proves a kilogram against grams; it binds tighter than `*`, so bracket a whole side to convert it.
  `volume in g` is **refused when you declare it** — that needs a density, and a density is a fact
  about the thing rather than about the units, so it belongs in a column of the format. Nothing else
  in an expression looks at a unit: `4*protein_g … = kcal` adds grams and compares them to an
  energy and is correct, because the 4 is `kcal/g`.
- **To cross a dimension, name the fact after a `via`**: `amount in g via ingredient.density`. The
  ratio may be on this row or one hop away, and **it is read only when it is needed** — a line
  already in grams converts without it, which is what lets one identity cover a recipe measured in
  grams, millilitres and eggs. A `via` naming a column that relates the wrong two dimensions is
  refused when you declare it. **A column may be called neither `in` nor `via`.**
- **An expression may follow one link**: `ingredient.kcal` is the `kcal` of the row this row's
  `ingredient` column names. **One hop and no more** — a second is a parse error, because a
  traversal is the thing this language will not be.
- **A format may work out a figure from the rows that point at it** — an *aggregate*. A `name`, one
  of `sum`, `count`, `average`, `minimum`, `maximum`, the format and the link column that points
  back here, an expression evaluated on each of those rows **in their own columns**, and a unit.
  `total_kcal = sum over recipe_line.recipe of amount_g / 100 * ingredient.kcal`, in `kcal`.
  **Then write an identity about it** — `total_kcal / servings = printed_per_serving` — because a
  total nobody checks is the thing a spreadsheet already does. A fold where one row has a gap is
  `unchecked` **in whole**, on purpose: a sum that skipped a row is a smaller number and not a
  truer one.
- **An aggregate may fold only the rows that match** — `where deduction_type.reduces_net is true`,
  or `where direction is OUTFLOW` (D-260). One enum or boolean of the source row, or one hop through
  its link, and one member: no `or`, no list, no range. A row with nothing in that column makes the
  whole fold `unchecked`. Net pay is the case: gross less the lines that reduce it, not every line.
  In the artefact it goes in the `over` cell after the source; in a tool it is the aggregate's `where`.
- **Or it may pick one row: the `latest` or `earliest` by an order** (D-272) — a security's price
  is the one with the greatest `as_of`, a fund's balance its latest report, a task's figure its
  newest entry. `by` names a date, month, instant or integer of the source's own row
  (`security_price.security by as_of` in the `over` cell, before any `where`). Only that row has to
  answer. **Two rows tied at the top make it `unchecked`** — if a person's data can hold two on one
  day (two sources, two readings), say so when you declare it, and ask whether a `where` should pick
  the source rather than letting every tie read as unchecked.
- **An identity never refuses a row.** A `CHECK` says what cannot be stored; an identity says what
  should add up, and a label that does not add up is a real label. Every row a format holds gets a
  verdict when it is read: proved, failed, or **unchecked** when the row has nothing in a column the
  identity names.
- **A format with no identity is allowed, and needs no flag** (D-411): send no `identities`. Ask
  the question anyway.

## How to run the conversation

1. **Ask what one row is.** "One ingredient", "one product I tried", "one workout". If the answer
   is two things, that is two formats and probably a link. Links are built, so declare both — but
   see the ordering note below, because `declare_format` creates and never alters.
2. **Ask what they would want to ask of it later.** The columns fall out of the questions, and it
   is the only way to find the ones they would not have listed.
3. **Propose the table and argue for it.** Name the columns you added that they did not ask for,
   and say why. Their answer to *"do I need that"* is the design.
4. **Ask what has to add up, and mean it.** This is the question that makes a format worth having
   here rather than in a spreadsheet, and it is worth asking properly: *which of these figures is
   computable from the others?* A total against its parts, a price against a quantity, a label's own
   arithmetic. Propose the identity, say what tolerance it needs and why — a printed label rounds,
   so `2%`; money in minor units is `exactly` — and put the reason in its `note`. **If two columns
   are in different units, say `in` rather than doing the arithmetic yourself**: a factor written
   into the equation is a figure nobody can see moving.

   **Do not put a conversion factor in the expression that the engine already knows.** `pack * 1000
   = serving * servings` and `pack in g = serving * servings` say the same thing, and only the second
   one is still right when somebody edits the column to kilograms.

   **If there is genuinely nothing, say so out loud and send no identities.** That is allowed and
   it is often the honest answer; what is not allowed is leaving the question unasked. **Do not let
   them believe a column is proved when it is only stored.**
5. **Put it in the document.** If the Emerald plugin is connected and you know the path, call
   `declare_format` — the dry run prints the columns, they say yes, and the table exists. Otherwise
   hand over the file and tell them where it goes: `#/formats` → **Import a declaration**, paste,
   then **Open it in the editor**, where it arrives as fields with its plan (D-219). Either way
   nothing reaches the document unread, and either way they can also press **New format** and type
   it themselves — this session is worth having when the columns are the hard part, not the typing.

   The dry run prints the identities beside the columns, so what is being agreed to is both.

   **Two linked formats do not both fit in one call, and the order matters.** A line links to the
   thing it belongs to, and that thing folds the lines — so whichever you declare second can carry
   the link, and `declare_format` **creates and never alters**, which means the *aggregate* on the
   first one is added afterwards at `#/formats` → Edit. Say that out loud rather than letting them
   discover it: declare the parent, declare the line with its links, then open the parent and add
   what it works out. Adding an aggregate changes no table and loses nothing — the editor will say
   *already matches*.

   **`declare_format` creates and never alters.** Changing a format they already have is
   `#/formats` → **Edit**, because that plan is drawn against the rows the table already holds and
   four kinds of change are refused rather than guessed.
   The app shows exactly what it will do before it does anything.
6. **Then offer to fill it.** Once it compiles, the format is real and this server can put rows in
   it: `formats` says what a row looks like, `record_format_rows` writes them, `format_rows` reads
   them back, and `update_format_rows` corrects one. A format nobody fills was not worth declaring,
   and the first row is what finds the column that is wrong. **Collect the rows and write them in
   one call** — every write takes a list. While the rows are still being worked out and the document
   is stored as text, type them into it instead (`### name`, then `column: value` lines, under the
   format's `## rows`) and check the lot with one `format_problems` call: a bad value refuses the
   document with its line, so nothing is lost quietly. **If they already have the thing in a
   spreadsheet, ask for the file** — `read_onto_format` reads an `.xlsx` or `.csv` onto the format
   a row at a time, shows the mapping and the verdict before writing, and is the difference between
   a format with three rows in it and one with four hundred.

## Changing a format that already exists

Ask them to press **Edit** on the format in `#/formats` — that puts the current declaration in the
box — and work from that text, so the diff is real. Then:

- **An identity is the safe change.** It compiles to no SQL, so adding, editing or removing one
  loses nothing and takes effect on the next read. It is the opposite of the four below.

- **Adding a column is easy**, unless it is `required` and the table already has rows. SQLite
  refuses that outright. Make it optional, or have them fill it in and require it afterwards.
- **Four things the app will refuse** on a column that holds data, and it is right to: dropping it,
  changing its type, **changing its unit**, and tightening its constraints. The refusal is a
  sentence on screen; nothing is written.
- **A unit change is the dangerous one, and changing a `per` is the same change.** It alters no
  SQL, loses no row, and makes every figure wrong by a factor. If a unit is wrong, the honest fix is a new column beside the old one and a
  decision about the stored figures — not a quiet edit.
- On a column holding **nothing**, all four are allowed and happen without asking.

## What not to do

- **Do not write rows before it compiles.** The table does not exist until they press Compile, and
  a refused declaration is a table that never arrived. Offer the rows after, not instead.
- **Do not promise that anything is checked across rows.** An identity is checked *within* one row
  and that is all it can see: nothing yet adds a column up, compares two rows, or notices when one
  of them stops agreeing with another. What *is* declarable is an **aggregate** over the rows that
  point here, and an identity about it — that is the one way a figure crosses rows.
- **Do not reach for a format when a note would do.** The test is *is this enumerable, typed,
  comparable* — a list of thoughts is not a format, and Emerald does not organize thinking.
- **Do not put money in a `real` column** to avoid the two-column shape. That is the one rule with
  no exceptions anywhere in this codebase.
- **Do not invent a tenth type.** If something genuinely has nowhere to go, say so — that is a
  finding for the roadmap, not a cell to fudge.
- **Do not reach for `quantity` because a column has a unit.** It is for a unit that changes from
  row to row and nothing else; used anywhere else it loses the bound and gains a cell to fill in
  every row.
