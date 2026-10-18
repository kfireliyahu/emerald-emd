---
type: feature
project: Emerald
milestone: M1
status: built
---

# F01 — Card Statement Import

Import credit-card statements from spreadsheet files into the ledger. The user maps the
file's columns to the fields the app needs, once per format; every later import of that
format reuses the saved mapping.

This is the foundation feature: nothing else works until this does.

**Built, and closed with M1.** The whole path runs on real Cal and Max files: SheetJS reads
`.xlsx`/`.xls`/`.csv` into a typed cell grid, the header row and column roles are guessed, the
mapper shows the file with a live parse preview, and the mapping is saved and matched on later
files by header signature (D-031). Amounts, dates and Hebrew merchant names are normalized;
import is idempotent, deduped by natural key; rows land in a staging area with a keyboard-first
review screen that survived the tab closing (D-028) — **gone since M28 U5 (D-313)**: a file is judged on Home's Read files, ticked when it adds up and written with Write, and only one whose checks disagree is shown its gap; the parsed total is checked against the one
the file prints for itself, and both real files reconcile exactly. Installments and
foreign-currency rows are columns on `transaction` rather than tables (migration `007`, D-035),
and the currency the amounts are read as is guessed from the file rather than assumed (D-039).

What the sections below still describe as future is marked where it is: the deferred pieces are
the `feeAmount` a real file has yet to state, and the review screen's merchant grouping, which
arrives with bulk categorize in M2.

## Design decision: the user maps the columns

Rather than shipping a hardcoded parser per provider, **the app imports the file first, shows
the user what it found, and asks them to map each column to a field the app needs.** The
mapping is saved and reused.

Why this is the better architecture:

- **Cal and Max change their exports.** A hardcoded parser breaks silently in a year; a mapping
  the user can fix takes 30 seconds to repair.
- **Card products differ.** Different cards from the same issuer export different columns.
- **Any provider works on day one.** Isracard, Amex, a foreign card, a CSV the user built
  themselves — all supported without an app update.
- **The failure mode is recoverable.** "I don't understand this file" becomes "here's what I
  see, tell me what's what" instead of a dead end.

The app still helps: it **guesses** the mapping from header names and pre-fills it. The user
confirms or corrects. In the common case, mapping is one tap.

## The mapping

A saved `ImportMapping` describes how one file format maps to the ledger:

| Element | What the user sets (or confirms) |
|---|---|
| Header row | Which row contains the column names. Guessed; adjustable by tapping a row in the preview. |
| Data range | Where the data starts and ends. Trailing total rows are excluded here. |
| Column roles | For each column: what it is, or "ignore". See the role list below. |
| Amount convention | Single signed column · single column where positive means a charge · separate debit/credit columns. |
| Default currency | What the amounts are denominated in, for every row the `currency` column does not speak for. Guessed from the file; a select in the mapper, beside the amount convention, overrides it. Saved with the mapping. |
| Date formats | Guessed per date column from the values; overridable. |
| Decimal/thousands separators | Guessed; overridable. |
| Sheet selection | Which sheet(s), when the file has more than one. |
| Row filters | Patterns for subtotal/junk rows to skip. Pre-filled from what the app detected. |
| Account binding | Which `Account` this format's files belong to, or "ask each time". |

### Column roles

**Required:** date · amount · merchant/description.
**Optional:** charge date · currency · original amount · original currency · exchange rate ·
provider category · installment text · installment number · installment total · card last-4 ·
reference/asmachta · balance · notes.

**Two dates, not three.** `date` is when the purchase happened and `charge date` is when it hit
the account, which is the whole of what a transaction stores. A format that separates the
purchase date from the row's *own* transaction date — a third date, on top of those two — is
**not supported**: there is nowhere to put the extra value. Map the purchase date to `date` and
leave the qualified column unmapped; it stays in the row's raw cells. A header that names one,
`תאריך עסקה מקורי` or `original transaction date`, is guessed as `date`, since that is what it
states. There used to be an "original date" role here for the hypothetical format; the mapper
accepted it and the parser ignored it, which is worse than not offering it. See D-036.

**Original currency earns its place.** The "original amount" column states two different things
depending on the row — the foreign amount on a converted purchase, and the **whole purchase
price** on an installment slice — and the currency is the only thing that separates them. Cal's
`סכום עסקה` matches the same alias as Max's `סכום עסקה מקורי`, so without it a ₪1,200 sofa
charged in twelve ₪100 slices reads as a conversion from shekels into shekels. See D-035.

Anything unmapped is ignored but retained in the staged row's raw cells, so a mapping can be
improved and the file re-imported.

### How the app guesses

1. **Header-name matching** against a maintained alias table (Hebrew and English) — `תאריך
   עסקה`, `סכום חיוב`, `שם בית עסק`, `Date`, `Amount`, `Merchant`, and so on. This alias table
   is the useful part of what used to be a "provider profile": it's a hint source, not a parser.
2. **Value-shape inference** for anything unmatched: a column of parseable dates is a date
   column; a column of numbers with two decimals is an amount; a column of mostly-Hebrew text
   is a description. Shape inference is what makes unknown formats work.
3. **Existing mappings** — if a saved mapping's header signature matches this file, use it
   directly and skip the mapper entirely.
4. **A derived template** — **built** (D-150). When the alias table misses and shape inference
   cannot say what a column *means*, **Work out the columns** on the mapper asks a local model for
   the whole map at once and the user confirms it on the grid, after which it is an ordinary saved
   mapping ([F17](../../mapping-templates.md), D-132). It is **asked for rather than offered**: the
   guesser is right most of the time and free, and the button is worth its call exactly when the
   preview shows it is not. This is the rung that makes an unknown issuer in an unknown market
   work, and it is why the alias table is a **floor rather than the mechanism**: it stays because
   it is free and instant when it hits, and it is never extended by hand to cover a new market.

**The currency is guessed as well**, in the same spirit — the amount column's own displayed text
first, the preamble second, and ILS when neither says anything. The text is where the evidence
actually is: `$1,234.56` and `1,234.56 ₪` state it outright, and Cal's amounts are number cells
under a `[$₪] #,##0.00` format, so the shekel sign is in what the cell *displays* and nowhere
else. Only the amount column and the preamble are read. A currency named in a note or an
original-amount column is a fact about one row, and letting it vote would import a whole shekel
statement as dollars on the strength of one Amazon purchase. A majority decides, so one foreign
row does not carry the column. See D-039.

The mapper screen shows a live preview of the first 20 parsed rows as the user changes the
mapping, with errors highlighted per cell. The user sees the result before committing to it.

### Matching a file to a saved mapping

A mapping stores a **header signature**: the header row's cell values, in order, each put
through the same `normalizeHeader` the alias table matches on — so Cal's `תאריך\r\nעסקה` signs
identically to `תאריך עסקה`, and a sheet's trailing blank columns, which belong to the used
range rather than to the format, are dropped. On import, signatures are compared:

- Exact match → use the mapping, skip the mapper's grid entirely, and say **"using your Cal
  mapping"** with a **"map this file anyway"** escape hatch. Never silent.
- Close match (a column added or renamed) → use it, but open the mapper with the changed
  columns marked. This is how format changes get caught rather than silently mis-parsed.
- No match → full mapper flow, pre-filled by guessing.

Three details that turned out to matter:

**Every candidate row is signed, not just the one the guesser picks.** A provider that adds a
line to its preamble has not changed its format, and trusting the stored header row index would
call the same file a new one. Signing the top twenty rows is twenty string joins and takes the
guesser out of the recognition path entirely.

**Closeness is measured by alignment, not by position.** A renamed column changes one column,
but an *inserted* one shifts every column after it — and a column-by-column diff would report a
one-column change as a fourteen-column one, highlighting the whole right-hand side of the grid.
A longest-common-subsequence alignment tells a shift apart from a change. It also yields the
saved-index → current-index map, so the saved roles move with their columns instead of being
re-entered by hand; a role whose column is gone is dropped rather than left pointing at whatever
now occupies that index.

**A close match needs to be close on both counts.** At least 70% of the wider header unchanged,
*and* at least three columns in common. Two unrelated three-column CSVs that both open with a
date agree on 67% of their columns, which is high enough to look convincing and low enough to be
a coincidence; handing over another file's mapping there would silently re-role the columns.

Saving is explicit and named, and it upserts on the signature: re-saving a corrected mapping
repairs the existing row rather than leaving two rows for one format. The mappings screen was
built expecting to retire that, and it did not — the reason changed rather than expiring. Two
rows carrying one signature do not make the match ambiguous to the user, who can now see and
delete both; they make it ambiguous to the *matcher*, which resolves a file to a single mapping
and would be picking between equals. Saving from the mapper says "this is how this format is
read", so it lands in the row that already says so (D-031).

**Duplicate** is the one place that deliberately makes two rows for one format, because it is the
user asking for a second copy of a recipe. The tie is then broken by "most recently used", and
the mappings screen marks both rows so the choice is visible rather than discovered.

### Shipped starter mappings

The app ships alias tables and a few starter mappings for Cal and Max as **pre-fill hints
only**. They can be wrong without breaking anything, because the user confirms the preview.
The user's existing mapping spreadsheet is the source for authoring these.

**Starter mappings for other markets are welcome** (D-132). A seed only ever saves a derivation,
so being wrong about one costs nothing — but a seed is an accelerator and never the mechanism, and
no market is ever *reached* by writing one.

## The format problem (why the mapper needs to be this flexible)

Cal and Max exports are made for humans:

- The real header row is not row 1. There's a preamble: card name, cardholder, billing period,
  totals, merged cells, blank rows.
- A file may contain several sheets or sections (local charges, foreign charges, installments).
  Each section can be its own mapping.
- Amounts appear as `1,234.56`, `₪1,234.56`, `-1,234.56`, `1,234.56-`, or as real number cells.
  Some files use a positive "debit" column.
- Dates appear as real date cells or as text in a variety of separators and year widths.
- Hebrew text carries directional marks and non-breaking spaces.
- Totals and subtotal rows are interleaved with data rows.

### What the first real files actually looked like

Checked 2026-08-09 against one real Cal export and one real Max export. Three of the
assumptions above were wrong in ways that matter, and the two providers disagree on the single
most important axis.

**Dates: Cal stores date cells, Max stores text.** The Max file contains no date cells at all —
every date is the string `dd-MM-yyyy`. Cal stores real serials, under a locale-tagged number
format (`[$-,101]d/m/yy;@`) rather than a plain `dd/mm/yyyy`. So value-shape inference needs a
string-date parser as a first-class path, not a fallback, and date detection has to go through
the number format rather than pattern-matching the format string.

**Amounts are already numbers in both.** Neither file needed string parsing for amounts. Cal
formats them as currency (`[$₪] #,##0.00`), which means the shekel sign and the thousands
separator live in the *number format*, not in the value. Two failure modes to avoid: treating
"has a number format" as "is a date", and treating "displays a ₪" as "is text". The
string-amount shapes listed above are still worth supporting, but they are not the common case.

**Max's two sheets share one header.** `עסקאות במועד החיוב` and `עסקאות חו"ל ומט"ח` are separate
sheets with byte-identical 16-column headers — not sections within a sheet, and not differing
headers. One mapping covers both. The "detect a section by a repeated header row" approach is
not what these files need.

Also observed, and cheaper to know now than to discover in the mapper:

- The header row was **row 4** in both files, with three preamble rows. The plan's
  first-20-rows scan is generous.
- **Cal's header cells contain embedded newlines** — `תאריך\r\nעסקה`, not `תאריך עסקה`. Alias
  matching must normalize newlines or every Cal header misses.
- Both files present charges as **positive** numbers, confirming the sign rule in
  [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md).
- Neither file contained a refund, a negative amount, or an installment. Those shapes are still
  unexercised by real data, and the mapper will look finished before it has seen a hard row.
  *Since D-035 the installment and foreign shapes are covered by a synthetic fixture
  (`fixtures/synthetic/installments.xlsx`) built to the column layout these two files have —
  which is a test, not a sighting. The first real installment row is still owed a look, and the
  thing to check is whether the slice or the whole purchase sits in `סכום חיוב`.*

## Pipeline

1. **Acquire** — `<input type="file">` or drag-and-drop anywhere in the window returns bytes +
   filename.
2. **Read** — SheetJS turns bytes into a `SheetTable` (rows of typed cells). Supports `.xlsx`,
   `.xls`, `.csv`. Everything downstream is plain TypeScript over that grid.
3. **Signature** — compute the header signature; look for a matching saved `ImportMapping`.
4. **Guess** — if no match, run header-alias matching and value-shape inference to build a
   draft mapping.
5. **Map** — show the mapper screen with a live preview. User confirms or corrects. Mapping is
   saved (named, e.g. "Cal – Visa 1234") by Read it, the mapper's one button (M31 U2, D-368).
6. **Parse rows** — apply the mapping; produce a draft transaction or a row-scoped error per row.
7. **Normalize** — amounts to `Money` with the correct sign, dates to `LocalDate`, merchant to
   `merchantNormalized` per [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md).
8. **Resolve account** — from the mapping's binding, or from a mapped last-4 column, or from the
   last-4 the file states in its own name or preamble, or ask. Never from the file name as a
   whole: an export is named after the day it was downloaded, so that identifies a download
   rather than a card (D-033).
9. **Derive billing period** — from a mapped column, then the account's billing day, then the
   charge date.
10. **Dedupe** — natural keys; classify each row new / exact duplicate / similar duplicate /
    updated.
11. **Categorize** — run the rules engine over every parsed row and attach the suggestion, with
    the id of the rule that made it ([F03 Auto Categorization Engine](./f03-auto-categorization-engine.md)). A suggestion is not a decision: it
    fills the review screen's picker, marked `rule`, and the user can overrule it before anything
    is committed. Rules are loaded once per file, so editing a rule does not change a review
    already open (D-038).
12. **Stage** — persist `ImportSession` + `StagedRow`s, status `AWAITING_REVIEW`.
13. **Review** — user accepts, edits, or skips per row or in bulk.
14. **Commit** — one database transaction.

Steps 3–11 are pure functions, testable in Vitest from a fixture file with no browser.

## Verification

Statement files print their own totals. After parsing, the app compares the sum of parsed
amounts against any number it can find that looks like a total, and shows the comparison on the
review screen. A mismatch is the cheapest possible signal that the mapping is wrong — and with
a user-defined mapping, wrong mappings are the main risk.

The total is **not** reliably in the preamble, and is **not** a number cell in either real file
checked:

- Cal buries it in prose in the preamble: `עסקאות בחיוב מיידי 2,600.00 ₪`.
- Max puts the label `סך הכל` in a trailing row and the value in the row *below* it, as the
  string `1200.00₪` — after the data, not before it.

So the scan has to cover trailing rows as well as the preamble, and has to pull a number out of
a surrounding string. Both files' totals reconciled exactly against the sum of their parsed
amounts, so the check is worth having.

As built: a label list (`סך הכל`, `סה"כ`, `עסקאות בחיוב מיידי`, `total`, …) is looked for in the
preamble and in the rows after the last one that parsed — **not** in the data rows, because
"Total Wine & More" is a real shop and scanning the data would turn one of its charges into the
file's own total. Around a label, the value is looked for in the same cell, then to its right,
then in the row beneath: Cal, Max, and the ordinary spreadsheet layout, in that order of
confidence. Inside a string, the figure with a decimal point wins over a bare integer beside it
(a total line often carries a year or a count too); with no decimals anywhere, the largest
number wins, because a total is the big number on its line by construction.

The comparison is on **magnitude**, since the sign is the app's convention rather than the
file's — both files print charges as positive and the importer is what makes them negative
(D-004). Comparing signed values would report every correct import as a mismatch.

The figure is scanned once, when the rows are staged, and stored on the `ImportSession`. By the
time the review screen asks, the sheet is gone: a resumed import has rows in the document and no
file in memory, and a verification figure that disappears when you close the tab is not one you
can rely on. It compares against the *accepted* rows, so it moves from mismatch to match as the
user accepts them — the agreement that matters is the one at the moment of importing.

## Screens

- **Pick file** → **Mapper** (skipped when a saved mapping matches) → **Review** → **Result**.
- **Mapper screen** — the file preview as a full-width scrollable grid; click a row to mark it as
  the header; click a column header to assign its role; unmapped columns greyed; raw cells in a
  mono face so stray spaces and directional marks are visible; a live preview strip showing
  three fully parsed transactions; the total-verification figure; the reader's name, kept by Read it. The toolbar
  states what was guessed about the amount column — the header row, the sign convention, and a
  currency select that is the one editable control among them.
  **This screen is why the app is desktop-first.**
- **Review screen** — virtualized table, status chip per row, inline category picker, expandable
  raw-row view, filter by status, shift-click multi-select, bulk "accept all new", persistent
  summary bar. Keyboard-first: `J`/`K` to move, `C` to categorize, `Enter` to accept.

  As built: `J`/`K` move, `Enter` accepts and advances, `S` skips, `X` selects, `C` opens the
  category picker, `A` accepts every new row, `R` shows the raw row, `Escape` clears the
  selection. Two ways out, because they are different things — **Finish later** leaves the
  session at `AWAITING_REVIEW` and the ledger offers it back, **Discard** cancels it. Neither
  writes to the ledger.

  The raw-cell view is a **panel under the table rather than an inline expansion**. The
  virtualization needs every row to be the same height, and a row that grows makes every scroll
  offset below it wrong. Following the cursor turns out to be better anyway: it is already
  showing the row you are looking at by the time you want it.

  **And the panel is where the row's figures are corrected** (D-206). The mapping is a proposer
  like every other reader in the app — a role is a claim about a file, and a model asked for one
  has put a reference column where the amount goes (D-114) — so the date, the merchant and the
  amount the mapping produced are fields, directly beneath the cells they were read out of. Which
  way the money went follows the sign and is said rather than asked: `staged_row` and the ledger
  both refuse a direction that disagrees with it (D-004). An edit leaves the row's **natural key
  and status** alone, which is what keeps a re-import idempotent — the correction is about what the
  row says, not about which row it is.
- **Readers** (one list beside Read files, `#/read/readers`, since M36 U10, D-387; `#/transactions/readers` and `#/settings/mappings` redirect) — list saved mappings, rename, duplicate,
  delete, and see which account each is bound to and when it was last used.

  As built: most recently used first, each row carrying the account it is bound to — a select
  whose null option is "ask each time", which is F12 filling in `ImportMapping.accountId` (D-034);
  the binding is a fallback behind the card number a file states about itself, never an override —
  when it last imported anything and how often,
  and **what it reads** — the header cells recovered from the signature, in sheet order, each
  labelled with its role. A header that already names its role prints once, so an English file
  reads `date · description merchant · charge amount` rather than `date date`.

  There is no **new mapping** button and no column editing here. A mapping only means something
  against a file, so both belong to the mapper: to change what one reads, import a file of that
  format and map it again — saving updates the mapping in place. The screen says so at the top,
  rather than offering a re-map button that would only open a file picker.

  **Delete is the wide door here**, the inverse of the Categories screen. A category holds
  history and its delete refuses; a mapping holds a convenience, so its delete explains instead —
  the next file with those columns opens the mapper again, and nothing already imported changes.
  Soft, like every delete in the document, so a session that used the mapping still resolves it.

## Data touched

Creates: `ImportMapping`, `ImportSession`, `StagedRow`, `Transaction`, `Installment`,
`ForeignAmount`. May create `Account`.
Reads: `CategoryRule`, `Category`, existing `Transaction` natural keys.

## Edge cases and required behaviors

| Case | Behavior |
|---|---|
| Same file imported twice | Every row is a duplicate by its natural key, so nothing is written twice. The file-hash notice was unreachable after M25 and went in M45 U2. |
| Format changed since last import | Close-signature match opens the mapper with changed columns highlighted. Never silently mis-parses. |
| Amended statement | Matching natural key, different amount → `UPDATED`, before/after diff, user's category preserved. |
| Row fails to parse | Row-scoped error; import continues; error visible in review with raw cells. |
| User maps a column wrongly | Caught by the live preview and the total check; the mapping is editable and the file re-importable. |
| Multi-section file | Each section gets its own mapping within one file mapping. Sections may be separate sheets sharing one header (Max) rather than repeated headers within a sheet. |
| Foreign currency row | ILS charge as `amount`, original in `ForeignAmount` when those columns are mapped. |
| Installments | One transaction per slice charged; `Installment` links slices by group key, parsed from the mapped installment column(s). |
| Refund / credit | Positive amount, `direction = INFLOW`; must not silently reduce category spend. |
| Empty statement | Valid; session commits with zero rows. |
| Tab closed mid-import | Staged rows are in the database. The banner that offered the session back was unreachable after M25 and went in M45 U2. Unsaved work is covered by the crash snapshot ([02 Architecture](../../02-architecture.md)). |
| 5,000-row file | Virtualize the review table; cap in-memory raw-cell retention. If parsing blocks the UI, move it to a Web Worker — measure first. |
| Mapping deleted while files still use it | Next import falls back to guessing. |

## Acceptance criteria

- A real Cal file and a real Max file import correctly, verified against the totals printed in
  each file.
- A format the app has never seen (an arbitrary CSV) can be imported by mapping it manually,
  with no code change.
- The second import of a known format skips the mapper entirely.
- Importing any fixture twice yields an identical ledger (property test).
- A file with one corrupted row imports every other row.

## Deferred, with a reason

- **`SEPARATE_DEBIT_CREDIT` amount convention.** Not implemented. It needs two column roles that
  the role list above does not have, and neither real card file uses it — it is a bank-statement
  shape. Add it with [F06 Bank Statement Import](./f06-bank-statement-import.md), against a real bank export.
- **Data range / end marker.** The mapper currently finds the end of the data by failing on it:
  a trailing total row whose value sits under the amount column parses as an error rather than
  being excluded. That is visible and recoverable, but `dataEndMarker` in the mapping is the
  real answer, and it is the user's to set.

- **Editing a mapping's column roles from the Mappings screen.** The screen lists, renames,
  duplicates and deletes; it does not re-map. A role assignment is a claim about a column, and
  the only way to check a claim is to see the column — which means a file, which means the
  mapper. A role editor divorced from a grid would let someone silently point `amount` at the
  reference column with nothing on screen to contradict them. Re-import is the re-map.

- **Exportable mappings as JSON**, and **the guesser learning from corrections**. Both are open
  questions below and neither blocks anything.

## Open questions

- Should mappings be exportable/shareable, so a mapping authored once can be handed to another
  user or restored after reinstall? Recommendation: ~~yes, as JSON, alongside the rule-set export in
  M6.5.~~ **Cut by D-116** — no named reader. Cheap to revive the day one exists.
- Should the guesser learn from corrections — if the user always remaps a given header name,
  update the alias table locally? Recommendation: yes, low cost, and it makes the app better
  the more it's used.
- Multi-section files: is per-section mapping needed in M1, or can sections be handled by
  importing the file once per section? Recommendation: defer; one mapping per file in M1.

## Related

[02 Architecture](../../02-architecture.md) · [04 Data Model](./04-data-model.md) · [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md) · [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md) · [F06 Bank Statement Import](./f06-bank-statement-import.md) · [F12 Onboarding](./f12-onboarding.md)
