---
type: feature
project: Emerald
feature: F17
milestone: M11
---

# F17 — Mapping Templates

How a source document becomes rows in the database, and where a model is and is not allowed to
stand. The decision is [D-132](./09-decision-log.md); this note is the design.

**Since M19 U5 it applies to a target the pack does not own**: a format the user declared
([D-226](./09-decision-log.md)). The tabular half is retargeted there — the roles become the
declaration's own keys — and the label-value ladder below is not, because no declared format has ever
been read from a PDF and `LadderShape` is not worth guessing at without one.

Applies to every document the app ingests: card and bank statements
([F01](./packs/ledger/f01-card-statement-import.md), [F06](./packs/ledger/f06-bank-statement-import.md)), payslips
([F04](./packs/ledger/f04-paycheck-tracking.md)), pension, hishtalmut and savings fund reports
([F13](./packs/ledger/f13-pension-and-hishtalmut.md)). Broker statements were read too
([F18](./packs/ledger/f18-investments.md), D-188) until investments left the ledger with their
readers (M28 U1, D-308).

## The rule

**A model produces a template. It never produces a value.**

A template says *which fields exist and where they live*. Executing it produces the values, and
executing it is plain code. The user confirms the template once; every later document of the same
format is read with no model involved.

> A model decides the schema; code moves the data. Which column holds the amount is judgement and
> worth a model. Reading nine hundred rows out of that column is `parseFloat`.

## Two shapes, one concept

| | Tabular | Label-value |
|---|---|---|
| Documents | `.xlsx` / `.csv` statements | payslip and fund-report PDFs |
| Signature | the normalized header row | the document's **static labels** |
| Map | column index → role | label anchor → field |
| Exists today | `import_mapping` + `signature.ts` | `document_template` + `labelTemplate.ts` (D-139) |

**A folder of Markdown notes is tabular too** (M34 U7, D-400): a note
a row, its header `title` (the frontmatter's, else the file name — never a heading, D-404),
`file`, each frontmatter key, `inline tags` when a body writes `#tags`, `body links` when it links to a note, and `body` whole
(`src/domain/format/notes.ts`), so it takes the same guessed mapping a spreadsheet's header does. A
hidden file (`._name.md`) is no note. A link is read from `[[name]]` or
`[text](file.md)` as the title of the note it names, then filled by exact unique name or refused — or, when the target is one row per a parent and its name and the read fills that parent, by the name within it (D-467). **A body link is prose** (D-406): `body links` is guessed onto the one `links` column pointing where the links resolve, and one naming no row is left out and named in the report — the note is still read. A link
between two notes of one folder is filled (D-410): it holds the line it
names until the commit draws that row's id, in the same transaction. With `recursive: true` the read
takes every folder under it too, never a hidden one, and each note carries a `folder` column — its
path under the folder read — and a link to a file that is not a note (`![[Pasted image.png]]`) is no
link, counted rather than named (D-468).

**A .json file of rows is tabular as it stands** (M48 U2, D-468): an
array of objects, or an object holding one (each such key a sheet), read by `jsonRows.ts` into the
table a `.csv` becomes — the keys the header, an array of plain values a list split by `;`.

**A note's list items, or a table in its body, are rows of another format** (M38 U4,
D-410). `items: "list"` (or `"table"`, and `under` a heading) reads a
folder's items as a table of their own — `note`, `section`, `position`, then `item`, `checked`,
`figure`, `unit`, `link` and `text` for a list, or the table's own header — one row per item. `note`
fills the link back to the note's row **by the key that row was written under** (its file name), so
a title need not be unique; the parts are guessed by what they are (a figure and a known unit onto
the one `quantity`, a link onto the one other `link`, a checkbox onto the one `boolean`). An item is
keyed by its note and place (`Pancakes.md, item 3`). On the Read screen a folder's items are a row
of their own, offered when one format links to the folder's, with the heading they are read from.

**Read again, a source updates what it wrote** (M38 U3, D-408). Each
line has a key — a note's file name, or the value of the format's unique column the reading fills —
and a second read of a file of the same name changes the rows whose line changed, adds the new ones,
and names the rows whose line is gone, removing them only when asked (`remove_gone`, or *Remove it*
on the screen). A row a person edited since the last read is left and named. A source with no key
adds to what it wrote, and `supersede_reading` still takes a reading back.
Nothing in it knows which program wrote the folder. A guess is now **shown in place** on the Read
screen and kept as the reader when the file is written; and a link column is guessed when a
header names it and its target is called by a unique name.

**Both label-value documents take one ladder** (D-149). `documentLadder.ts` is the rungs;
`payslipLadder.ts` and `fundLadder.ts` are twenty lines each saying what their document is, and
`DocumentTextInput` + `openDocumentText.ts` are one way in from a file — so a fund report gets
D-141 through D-147's PDF handling rather than a second copy of it that falls behind.

The label-value case works because **the words that do not change between months are the schema
and the numbers are the data**. Field labels, the employer or provider name, and the page
boilerplate are identical across every slip from one payroll system; normalize them and sort them,
and that is a signature in the same sense `signature.ts` already means it.

The map anchors to those labels — *the value for `net` is the number nearest this label* — and
never to coordinates, so it survives a moved logo, a new page size, or a reflowed footer. An
anchor carries an **occurrence ordinal** with its label, because a slip prints `מס הכנסה` in its
deductions table and again under the year-to-date totals; without it those are one anchor and the
template reads the cumulative figure for the monthly one.

**And it keeps those labels rather than hashing them** (D-139). Hashing was the one step too far
in the first draft of this note: a hash answers *same or not*, and what a stored template needs is
*how close* — one changed month name must not read as a new employer. So it stores the sorted
labels, as `headerSignature` stores its cells, and comparison is the intersection over the union.

**The one thing on these pages that has no labels is a table, and it takes the other shape**
(D-153, and D-188 for the second document that has one). A fund report's deposit table is rows whose every cell is data, and whose row *count*
changes every quarter — so anchoring a row is wrong by construction the next time one is read. What
is stable is the **heading line**, which is words, and the **order of its columns**, which is the
tabular map above. So the template stores those two, and the rows are found by shape on the
document: a line whose cells number the table's columns, and whose declared date and month columns
parse, is a row; the first line that is not one ends the table. It is the two shapes in this note
meeting inside one document, and it needed no second reader.

**A broker statement once needed two more table readers, and they are gone** (D-308). Its
holdings table loosened all three of those rules (D-194) and its trades table read a row as a dated
line plus whatever followed it (D-196); both left with investments in M28 U1, and nothing reads a
PDF holdings or trades table now. The deposit table's stricter rule is the one that stands. **Since
M30 U6 a conversation reads a broker's PDF itself** and writes it with `record_holdings_statement`
(D-359) — no app reader, by choice.

> [!important] The stored template anchors to labels; the model does not emit them (D-137)
> Do not ask a model to copy a label. Measured on a real runtime, a JSON grammar truncated the
> Hebrew for "total gross" at the double quote inside it, and Hebrew financial vocabulary is full
> of those. The model answers with a **line number** and code reads the label off that line —
> the same rule as the tabular side, which was always column *indexes*. What gets stored is
> unchanged.

## The ladder

Every document takes the first rung that works, and the ladder always terminates.

1. **Signature matches a stored template** → execute it. No model, no network. **Built**
   (D-139): `matchLabelTemplate` finds it, `readAnchoredPayslip` executes it, and
   `readableTemplates` is the gate — a template nobody has confirmed is not on this rung.
2. **Signature misses, or the template no longer verifies** → derive a new template. The deriving
   step is pluggable and all three implementations emit the same artifact: the local provider
   (M10), Claude through the plugin ([F14](./plugin.md)), or a **shipped seed** for a
   format the app already knows. **Built for payslips** (D-140), with the deriver as a parameter —
   `readSlipByLadder` cannot tell which of the three answered, and that is what makes every rung
   testable on a machine with nothing installed.
3. **Nothing derives one** → the user points at the fields by hand. Being wrong here is cheap and
   being silent is not (D-013). For a payslip that is the paycheck form and for a fund report the
   reading form, which is where the accept lands anyway — both are pages of a dozen figures a
   person can retype. A broker statement, a table of thirty rows, had a rung of its own
   (`TableMapper`, D-188) until it left with investments (D-308).

**And beside the ladder rather than on it, the user names the format** (D-148). The rungs choose;
`readSlipWithTemplate` is what "not that one, use this one" means, and it is neither a rung nor a
failure — the anchors are executed as given and the arithmetic judges the choice exactly as it
judges a match nobody made. Accepting one stores a **second row carrying the same anchors** under
this document's labels, because the labels that failed to reach the right format are unchanged and a
correction that has to be repeated every month is not a correction. Narrow on purpose
(`storesTemplate`): a *close automatic* match stores nothing, or a signature drifting one label a
month would breed a row a month.

## Verification is what makes reuse safe

A template is trusted only while it reconciles, and a non-zero result invalidates it and drops to
rung 2. **This is what lets a template be reused without asking.** It is a rule about the *store*,
so the store is where it is kept: a template that read a slip which does not add up is not written,
and one that failed is not credited with a use (D-140).

- **Payslips** — `reconciliationDelta` (F04): `gross − Σ(net-reducing lines) − net`. Zero means the
  itemization accounts for every agora. A payslip carries its own proof internally.
- **Statements** — `findPrintedTotal` against the file's own stated total (F01), which is weaker
  only because the total has to be printed at all.
- **Broker statements** — the strongest (D-188, and D-359 since the reader left): each movement's
  printed balance is the one before it plus the row, and the holdings table's cost, quantity and
  cash are checked against the rows.
  `proved` and `failed` are the common answers here and `unchecked` is the exception, which is the
  reverse of a fund report.
- **Fund reports** — the weakest of the three, and honestly so (D-149): **three** equations, each
  run only where the report printed its terms — opening + deposits + yield − fees = closing, the
  three components summing to the balance, and (D-153) the deposit table's rows summing to what was
  paid in. A reading is `proved`, `failed`, or **`unchecked`** when none could run — still the
  ordinary case, and the reason the store's rule here is "never on `failed`" rather than "only on
  verified". **What no equation covers is named on the surface**, which on a deposit table is the
  salary month each row is *for*: the sum proves the money and says nothing about the column every
  later deposit check is keyed on (D-138).

**And where nothing checks, the person checking now has the page** (D-168). A reading records
which line each field came off, and the confirm surface draws the document beside itself: point at
a figure, a deduction row or a doubt and the line it was read from is marked on the page. The
sentences this note's ladder produces — *"taken from line 34, beside the line 33 the template
names"* — were unverifiable inside the app until then. It is a button rather than the default,
because a slip read under a stored format is the case where nobody needs to look.

**And a reader is a *proposer*, so it is not the last word either** (D-205, D-206). Three of the
rungs above are proposals about a page — a local model's roles, a person's own pointing, a template
that executed somebody's pointing months ago — and a proposer wrong about one column is wrong about
every figure downstream of it, silently. So on **every** confirm surface **each figure a reader
produced is an editable field**, the mapping is reachable from that surface without reading the
document again, and the arithmetic re-runs over what was typed: what is edited is what is written.

Two rules hold across all four of them. **A figure the reader did not find is a blank field rather
than a missing row** — the remedy and the gap in one place, which is what turns "no management fee
was read" from a doubt into something a person can answer. And **a reading's verdict is a function
of the figures it holds, not something it stated once**: `restateStatement`, `restateSlip` and
`restateReport` are the one arithmetic both the reader and the surface run, so a screen can never
prove one set of numbers while another is written. What is *derived* stays text — an employer
total, a deposit row's total, a transaction's direction — because the place to correct it is
whichever input is wrong.

A format change therefore needs no prediction. Either the signature misses or the arithmetic
fails; both mean the same thing and both route to re-derivation. Nobody has to know in advance
that the user changed jobs or that a provider redesigned its report.

## What a template stores

*(Built for the label-value shape as `document_template`, schema 21 — see
[04 Data Model](./04-data-model.md).)*

- The **signature** it matches, and its shape (tabular or label-value).
- The **field map** — roles to columns, or fields to label anchors, plus a deposit table's
  heading anchor and column order where the document has one (D-153).
- **Provenance**: derived by which rung, and confirmed by the user when.
- A **version**. Templates are versioned and old ones are kept: last year's slips still need the
  map that read them.

Templates live **in the document**, like the user's own rules. Seeds ship **in the bundle**, like
`il-core.json`. That is the same split rulepacks already use, and it is what keeps a template
private without keeping it useless.

**And they have a screen** (D-148) — one Readers list at `#/read/readers` beside Read files since
M36 U10 (D-387), with the statement readers — which lists them with what each reads in
the slip's own words, renames and deletes them, and flags two formats a single slip could match
either of. Nothing is created or confirmed there — a set of anchors means nothing away from a
document carrying those labels, and the confirmation `readableTemplates` gates on is a person
agreeing to anchors they watched read a slip.

**A field the user corrected is never re-derived over.** This is the existing "user overrides win"
rule (a `rule` row in `memory.emd`, D-435) applied to templates — `pinnedFields` and
`carryPinnedFields`, and a pinned field the fresh derivation *lost* is kept rather than dropped.

## What stays out of a model's reach

**Deduction types.** The template says a deduction line lives at this label and which side of the
slip it falls on. **The user says it is pension, and what it pays into.** Naming and kind are the
user's; the "Pays into" link is the user's or is derived by reconciliation, never guessed from a
name. This is why D-112's invented deduction-type ids stop being a problem to compensate for —
the local model is no longer on that path at all. It still writes payslip lines on the *plugin's*
side, where D-112 stands unchanged.

**The splitter.** No AI in it ([F05](./packs/ledger/f05-paycheck-splitter.md)). It has no source document to
transcribe and it is the case D-114 measured local models as worst at.

## Definition of done

- A second document of a known format imports with **no model involved** — the condition that
  proves a template was stored and reused rather than a document re-read. **The reading half is
  done** (D-139), and so is the surface (D-140): `payslip-2026-08.txt` is July's format with a row
  inserted above every field, and in the running app it reads and reconciles to ₪0.00 through
  July's stored template **with the model call counter at zero**. What is left is the same for
  statements and fund reports.
- A template that stops verifying is re-derived rather than silently trusted.
- Every path works with the model provider off, falling to the mapper. **Held for payslips**: with
  no provider chosen the ladder goes stored-template-or-nothing, and the surface says so.
- Nothing is written without a human action. **Held structurally**: accepting a read slip fills in
  the paycheck form, and the form's own save button is the only thing that writes a paycheck.

**A deduction row's name is stored with it** (D-145). The template says where a row is *and*, once
a person has said so, what it is — the only field in a template that is an answer rather than a
location, and it is there because it is the one field on a payslip no arithmetic can check. A
deriver never writes it: D-132 is unchanged, and what a model produces still has no name on it.

## Open Questions

- ~~**Fund reports have the weakest verifier**~~ **Answered** (D-149) and then **corrected by the
  first real one** (D-152). A report is `proved`, `failed` or **`unchecked`**; the closing balance
  alone is not enough of a check; and the equation has more terms than a synthetic fixture showed —
  the movements block is **exhaustive**, a charge is a **magnitude** whatever sign the page prints,
  and a report that rounds to the shekel is allowed half a unit per term.
- **What a template holds is still only locations, and D-152 is the test of that.** The two facts no
  equation runs through — the fee rate and the employer — are the two a model got wrong twice, so
  they are corrected by hand on the surface; `retargetToValue` then moves the *anchor* to the line
  carrying what was typed, rather than storing the value. A correction sticks to the format, and the
  template stays a map (D-145, one level down).
- **Scanned slips, which is all that is left of "native-text versus scanned".** A generated PDF is
  read (D-141, D-142): `pdfText.ts` rebuilds the lines from glyph positions, splits them where a
  page's panels meet, and pdf.js handles the embedded fonts and the bidi pass. A **photograph or a
  scan** has no text layer, is told so in a sentence, and waits for a vision path that does not
  exist.
- **A document that states no text at all** is read from its glyph order (D-146) — no `ToUnicode`,
  no `cmap`, no `post`, which is four of the seven real slips and which `pdftotext` cannot read
  either — and its **words** from a local OCR pass over the drawn page (D-147), because glyph order
  recovers the letters exactly and their *order* not at all. Each side supplies what it is exact at:
  every figure from the file, every label from the picture. Said out loud on the surface, because it
  is inference rather than reading. **A printed-back-to-PDF copy is still beyond it**: printing
  turns the page into a picture with no text layer, so the original download is always the file to
  use.
- **A document that lies about its own text** is repaired from its embedded fonts (D-144): the
  `ToUnicode` table a subsetter wrote can be boilerplate Latin over Hebrew glyphs, and the font's
  own `cmap` says what those glyphs are. Where even that is missing the app says so and the user
  names the rows once. Whether the boilerplate table is common across Israeli payroll systems or
  particular to one wants more real slips to decide.

## Related

[D-132](./09-decision-log.md) · [F01](./packs/ledger/f01-card-statement-import.md) ·
[F04](./packs/ledger/f04-paycheck-tracking.md) · [F13](./packs/ledger/f13-pension-and-hishtalmut.md) ·
[04 Data Model](./04-data-model.md)
