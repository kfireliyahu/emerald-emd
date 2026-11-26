The history was rewritten once, on 2026-10-15, and origin is the private kfireliyahu/emerald-emd from that day: 712 commits under one identity, no denylist term or old address in any object, the tree at HEAD unchanged; the old repository is never pushed to again, and what still holds the old history is the maintainer's to delete
type: log
project: Emerald
---

# Decision log — the core

Append-only. Never edit a past entry; supersede it with a new one that references it.
Format: date · decision · rationale · alternatives rejected · consequences.

**How this file is organised.** The index below carries every decision that governs **the
engine** — the document, the shell, the intake ladder, the model contract, the plugin harness,
the UI system. Entries for the milestones still open are written out in full further down; a
closed milestone's entries leave this file, and its `decision` rows in `docs/memory.emd` are the
record (`format_rows decision search:"…"`). The long-form entries of earlier milestones are kept
privately and are not in the repository (D-495).

**The ledger pack's decisions are indexed separately**, in
[`packs/ledger/decisions.md`](./packs/ledger/decisions.md). The two indexes are two *views* of
one record: nothing was split, copied or rewritten, so every D-number stays findable from
whichever side you come at it. A handful of entries written during a finance milestone are
indexed here rather than there, because the rule they set turned out to be the engine's — the
reading traps of D-142 to D-153, the confirm surface of D-205 and D-206, the review phase of
D-198.

**Writing a new decision:** append it to the *Open milestones* section below and add its row to
the index. When a milestone closes, `node scripts/archive-decisions.mjs` moves its entries out of this
file in the same commit: its index rows name the milestone, and every Markdown link to them becomes its text;
`npm run docs:check` fails until it has. **Numbering continues** across both
indexes — the next decision is the next number, whichever half it belongs to.

---

## Index

Every core decision, newest at the bottom. "Where" is its milestone, or *below* while the entry is
written out here.

| # | Date | Decision | Where |
|---|---|---|---|
| D-001 | 2026-08-09 | Kotlin Multiplatform — SUPERSEDED by D-019 | M0–M1 |
| D-002 | 2026-08-09 | SQLDelight — SUPERSEDED by D-020 | M0–M1 |
| D-003 | 2026-08-09 | Money as integer minor units | M0–M1 |
| D-005 | 2026-08-09 | User-defined column mapping — SUPERSEDED then RESTATED | M0–M1 |
| D-010 | 2026-08-09 | Everything inferred goes to a confirmation queue | M0–M1 |
| D-012 | 2026-08-09 | AI is optional, opt-in, bring-your-own-key — **superseded by D-124**, no key and no remote path | M0–M1 |
| D-013 | 2026-08-09 | The user maps the columns; the app only guesses | M0–M1 |
| D-017 | 2026-08-09 | Black-on-white minimal UI with functional motion only | M0–M1 |
| D-018 | 2026-08-09 | File import is the architecture, not a stopgap | M0–M1 |
| D-019 | 2026-08-09 | Desktop web app, not a mobile app | M0–M1 |
| D-020 | 2026-08-09 | SQLite in the browser via sql.js, database as a file | M0–M1 |
| D-021 | 2026-08-09 | Document model — your data is a file you own | M0–M1 |
| D-022 | 2026-08-09 | IBM Plex Sans + IBM Plex Sans Hebrew, embedded | M0–M1 |
| D-023 | 2026-08-09 | Date-only values are calendar parts, not `Date` + date-fns | M0–M1 |
| D-024 | 2026-08-09 | The sql.js wasm is compiled into the bundle, not fetched | M0–M1 |
| D-025 | 2026-08-09 | A CSV has no cell types, so none are invented | M0–M1 |
| D-026 | 2026-08-09 | The step ladder is retired; the roadmap is the plan | M0–M1 |
| D-027 | 2026-08-10 | A file is recognised by an aligned header signature, not a stored row | M0–M1 |
| D-028 | 2026-08-10 | The staging area holds a shaped draft, not a blob | M0–M1 |
| D-030 | 2026-08-10 | A real theme toggle, and motion that smooths rather than sits still | M0–M1 |
| D-031 | 2026-08-10 | Upsert-on-signature survives the mappings screen, and duplicate is its exception | M0–M1 |
| D-087 | 2026-08-22 | Zero and unknown are different, and only the caller knows which | M6 |
| D-089 | 2026-08-22 | A gap in a bar chart has to be drawn as nothing | M6 |
| D-090 | 2026-08-22 | An absent figure has to say why it is absent | M6 |
| D-091 | 2026-08-23 | A detail has to add up to the figure above it | M6 |
| D-092 | 2026-08-23 | A review queue you have to empty by hand is the plugin handed back | M7 |
| D-093 | 2026-08-23 | The plugin wraps, and the one thing it could not borrow was a read-only question | M7 |
| D-094 | 2026-08-23 | Read-only is a mode SQLite enforces, not a promise the plugin makes | M7 |
| D-095 | 2026-08-23 | A shaped tool is a capability; a general query is all of them | M7 |
| D-096 | 2026-08-23 | The safest write in the plugin is the one that makes a file that does not exist | M7 |
| D-097 | 2026-08-23 | The second front end is what found the rule in the wrong layer | M7 |
| D-098 | 2026-08-23 | A preview you cannot write from, a copy you can find, a label you cannot lose | M7 |
| D-099 | 2026-08-23 | A rule keeps firing, so a dry run is not enough of a gate | M7 |
| D-100 | 2026-08-23 | The importer runs in Node, so ingestion was the tool set, not the parser | M7 |
| D-101 | 2026-08-23 | The way to reach everyone is the app's own AI, not somebody else's client | M7 |
| D-102 | 2026-08-23 | Deferred: the in-app AI product is a bigger product, and a bank-connected budgeting subscription's | M7 |
| D-103 | 2026-08-23 | A save is a claim about a file you last saw minutes ago | M7 |
| D-104 | 2026-08-23 | A backlog that hands back the same forty names is a conversation with no memory | M7 |
| D-106 | 2026-08-24 | Nothing measured it is not the same as it measured nothing, and neither is a verdict | M6–M7 |
| D-109 | 2026-08-24 | A question no tool answered, answered the way D-095 said to: a twenty-first tool | M6–M7 |
| D-110 | 2026-08-24 | The round trip was the bill, the gate was in the wrong place, and nothing said what the helper was for | M6–M7 |
| D-114 | 2026-08-24 | The write gate is prose, and prose holds only in Claude Code | M9 |
| D-115 | 2026-08-24 | The document-based app gets to open its own documents: a desktop shell | M9 |
| D-117 | 2026-08-25 | The app is called Emerald, the pitch is the tool rather than the ledger, and green stays a signal | M9 |
| D-118 | 2026-08-25 | Ten years of data measured, no Web Worker, and the one read that was loading the ledger into JS | M6.5 |
| D-119 | 2026-08-25 | Two CSVs, a byte-order mark, and a merchant name that is a formula | M6.5 |
| D-120 | 2026-08-25 | The rulepack learns the three brands, the backlog stops printing spending, and a statement is not an instruction | M6.5 |
| D-122 | 2026-08-25 | A model is handed context when it is chosen, and the Israeli parts are found rather than assumed | M9 |
| D-123 | 2026-08-25 | The rename lands, and the mark is the one green that is not a signal | M9 |
| D-124 | 2026-08-25 | The app is free, the download is unsigned, and nothing inside it reaches the network | M9 |
| D-125 | 2026-08-25 | Emerald becomes the accent, and the two greens are separated by role rather than hue | M9 |
| D-126 | 2026-08-25 | The shell opens a window, and the app it opens has not changed a line | M9 |
| D-127 | 2026-08-25 | The document becomes a real file, the save becomes a rename, and the app stops waiting for focus to ask | M9 |
| D-128 | 2026-08-25 | The app opens its own documents, the recents list is what grants them, and the window learns to close | M9 |
| D-129 | 2026-08-25 | Two installers, two icons cut from the mark, and the one line that finally registers the extension | M9 |
| D-130 | 2026-08-25 | The sidebar comes back, because the premise it was rejected on was a browser tab | M9 |
| D-131 | 2026-08-25 | The closing pass, and the half of it a script can do | M9 |
| D-132 | 2026-08-26 | A model produces the mapping template and never the values, and two things stay out of its reach | M9 |
| D-133 | 2026-08-26 | The single file is retired, and three of the four rules it enforced go with it | M9 |
| D-134 | 2026-08-26 | The page never reaches a runtime, the main process does, and loopback is a predicate | M10/M11 |
| D-135 | 2026-08-26 | The provider is a machine preference, and a chosen model is checked rather than assumed | M10/M11 |
| D-136 | 2026-08-26 | The answer's shape is a grammar, the stream is what makes a ceiling enforceable, and every way of stopping is a result | M10/M11 |
| D-137 | 2026-08-26 | A task is what a host can do that a conversation cannot, and the model answers with a line number because a grammar truncated a Hebrew label | M10/M11 |
| D-138 | 2026-08-26 | The slip transcribes, and it proves itself twice — but only where an equation runs | M10/M11 |
| D-139 | 2026-08-26 | The template is stored against the document's own words, and a version chain is what makes re-deriving safe | M10/M11 |
| D-140 | 2026-08-26 | The confirm surface draws the difference between what the slip proved and what only a person can check | M10/M11 |
| D-141 | 2026-08-27 | A payslip is a PDF, so the app reads one — pdf.js on the main thread, and the lines are rebuilt from glyph positions | M10/M11 |
| D-142 | 2026-08-27 | The first real payslip: a page is panels, not lines, and some fonts carry shapes with no record of what they say | M10/M11 |
| D-143 | 2026-08-27 | A boxed total's name and figure are two lines, and a font is judged run by run | M10/M11 |
| D-144 | 2026-08-27 | When a document lies about its own text, the font that drew the shapes is asked instead | M10/M11 |
| D-145 | 2026-08-27 | A deduction row's name is the user's answer, kept against the format rather than asked every month | M10/M11 |
| D-146 | 2026-08-27 | A document that states no encoding at all is read from the order its glyphs are stored in | M10/M11 |
| D-147 | 2026-08-27 | The page says what the figures are and a picture of it says what the words are | M10/M11 |
| D-148 | 2026-08-27 | The formats are a screen, and a wrong match is a click rather than a dead end | M10/M11 |
| D-149 | 2026-08-27 | A fund report is the same document as a payslip, and its proof is a third state | M10/M11 |
| D-150 | 2026-08-27 | A statement's columns are a proposal on the grid, asked for rather than offered | M10/M11 |
| D-152 | 2026-08-27 | The first real fund report: the movements block is exhaustive, and what nothing checks needs a person | M10/M11 |
| D-153 | 2026-08-27 | A deposit table is anchored by its heading and read by shape, and the salary month is what it is for | M10/M11 |
| D-154 | 2026-08-28 | A button may look pressable, and the only thing that can judge it is a person | M13/M14 |
| D-155 | 2026-08-28 | The app saves the document, and the dirty dot stops being a warning | M13/M14 |
| D-156 | 2026-08-28 | The document is a `.emd`, and there is exactly one extension | M13/M14 |
| D-163 | 2026-08-28 | Transcribing a document takes the window, and a flow says so itself | M13/M14 |
| D-164 | 2026-08-28 | Eight reports are a stack, not eight sittings — and dedupe is an ordering as well as a key | M13/M14 |
| D-165 | 2026-08-28 | The movements block is exhaustive, and a line is in it once | M13/M14 |
| D-167 | 2026-08-28 | A figure animates when it changes in front of you, and never when it merely appears | M13/M14 |
| D-168 | 2026-08-28 | The text is made out of the placed lines, so a highlight cannot point at the wrong row | M13/M14 |
| D-170 | 2026-08-28 | A screen four other screens have to point at is not a setting | M13/M14 |
| D-171 | 2026-08-28 | A read belongs to the app, not to the screen that started it | M13/M14 |
| D-172 | 2026-08-28 | A month reads as a month, and the stored form does not move | M13/M14 |
| D-173 | 2026-08-28 | The app's first context menu, and it is on the row rather than on the value | M13/M14 |
| D-178 | 2026-08-29 | A price may be fetched, on purpose and never by default — the page's rule does not move | M16–M17 |
| D-198 | 2026-09-04 | The review is a phase of its own, per milestone, and what a unit leaves it is written down | M16–M17 |
| D-205 | 2026-09-05 | Every figure a reader produces is an editable field on the confirm surface, and what is edited is what is written | M16–M17 |
| D-206 | 2026-09-05 | The same shape on the other three readers, and a reading's arithmetic is a function rather than a fact it stated once | M16–M17 |
| D-208 | 2026-09-07 | The reading vocabulary is the fault rather than the reader, and the investments structure is the maintainer's to redraw | M16–M17 |
| D-209 | 2026-09-07 | Emerald is an engine with four layers, and the line is that a format declares what a document says while code computes what it means | M19 |
| D-210 | 2026-09-15 | A vault of recipes validates the engine against a domain that is not money, redraws the line at stateless-and-relational, and adds provenance as a layer | M19 |
| D-211 | 2026-09-15 | The engine gets its thesis: it is where what a person and a model worked out goes to stay true, reading is one adapter, and the ledger is a pack enabled by default | M19 |
| D-212 | 2026-09-15 | The reading vocabularies move into the document, and the list stays closed at the moment the model is asked | M19 |
| D-213 | 2026-09-15 | A role can be added where the gap is discovered, and every check moves from what the build shipped to what the document declares | M19 |
| D-214 | 2026-09-15 | Three arrows are the spec, the spine is scratched rather than the repo, and a declared table needs a reconciler rather than a migration chain | M19 |
| D-215 | 2026-09-15 | Emerald is the domain layer between a person and a model, prior structure is a dial rather than two adapters, and a format has to be able to come into existence | M19 |
| D-216 | 2026-09-15 | A format is declared in markdown and compiled to a real table, and the reconciler refuses four things rather than guessing | M19 |
| D-217 | 2026-09-15 | A declaration generates a tool's vocabulary rather than the tool list, and the surface stops only adding where nothing else can edit | M19 |
| D-218 | 2026-09-16 | The ledger becomes a pack and the orientation re-centres on the engine; the docs move and the code does not | M19 |
| D-219 | 2026-09-16 | A format is edited in a form, the markdown becomes an import and an export, and a problem is drawn beside the field that caused it | M19 |
| D-220 | 2026-09-17 | A format is declared from the conversation, and the tool creates but never alters | M19 |
| D-221 | 2026-09-17 | A format is worked out from an example, and the grammar it comes back in has no numeric leaf | M19 |
| D-222 | 2026-09-17 | Identities: a `CHECK` says what cannot be stored, an identity says what should add up | M19 |
| D-223 | 2026-09-17 | The engine owns dimension and conversion; a factor that crosses a dimension is a column | M19 |
| D-224 | 2026-09-17 | Links, and the aggregate across one — one hop out, one hop back, and no traversal | M19 |
| D-225 | 2026-09-18 | A quantity carries its own unit per row, and a conversion crosses a dimension through a declared ratio | M19 |
| D-226 | 2026-09-18 | Intake targets a declared format: a reading is a mapping onto its keys, and the proof is the document's own | M19 |
| D-227 | 2026-09-18 | The engine gets its own surface, and the pack is staged behind it | M20 |
| D-228 | 2026-09-18 | The staging flag is per machine, filters only what is offered, and moves the root | M20 |
| D-229 | 2026-09-18 | A format's rows are a screen, the form checks nothing of its own, and a verdict is drawn before the row exists | M20 |
| D-230 | 2026-09-18 | A format begins at three doors, and the app's worked example stops being one domain | M20 |
| D-231 | 2026-09-18 | The nine types get a glyph and a sentence, written once and read by both surfaces | M20 |
| D-232 | 2026-09-18 | An identity is drawn as a balance, and the same balance draws the verdict | M20 |
| D-233 | 2026-09-18 | A connection is a drag between two endpoints, and the ports carry the direction | M20 |
| D-234 | 2026-09-18 | Parity is derived from the writes both halves share, and a gap carries the proof it is still open | M20 |
| D-235 | 2026-09-19 | Intake gets its tool half: the dry run is the preview, and a link a caller names is checked | M20 |
| D-236 | 2026-09-19 | An identity is not an equation: it is one column, and whether the others work it out | M20 |
| D-237 | 2026-09-19 | Declaring a format is a walk of four steps, and a format that exists is added to or removed | M20 |
| D-238 | 2026-09-20 | Emerald is Excel that will not let you be wrong quietly — the ledger is the proof, and the engine's finish line is D-214 | M22 |
| D-239 | 2026-09-20 | An engine-only server: the definitions are the bill, the filter is on what is offered, and it is an argument rather than document state | M22 |
| D-240 | 2026-09-20 | Four formats hold this project's memory: a link resolves by id and not by name, and the proof machinery is idle exactly as predicted | M22 |
| D-241 | 2026-09-20 | A link is read back as a name, the default order is the column a row is named by, and the rule for both had four copies | M22 |
| D-242 | 2026-09-20 | *Won't let you be wrong quietly* is two mechanisms and most formats only get the first | M22 |
| D-243 | 2026-09-20 | A repo's memory is the second crowd, and the markdown is rendered from the document rather than replaced by it | M22 |
| D-244 | 2026-09-20 | The unit is the serializer, not the file — a git filter and a generated markdown are the same work plumbed two ways | M22 |
| D-245 | 2026-09-20 | A serialized row is a block named by what it is called, the id is not written, and the empty string is the one value a tool and a table disagree about | M22 |
| D-246 | 2026-09-20 | A document may be text or SQLite bytes, chosen per file — which retires the rendered file, the git filter and the question between them | M22 |
| D-247 | 2026-09-20 | A text document's row ids are derived from its rows, because a random one is stale before the caller can use it | M22 |
| D-248 | 2026-09-23 | A blank sheet is a door with no steps: types are guessed from the cells, the press says nothing has to add up, and it adds no write | M23 |
| D-249 | 2026-09-23 | Tools first, the ledger second, the development pack third, and every screen waits for one UI milestone — parity keeps the list of what it owes | M23 |
| D-250 | 2026-09-23 | UI before the development pack: M26 is the base UI, M27 is the first pack after the ledger, and its views are what it is for | M23 |
| D-251 | 2026-09-23 | A missing tool is owed or refused, a missing screen is derived, the ledger is a ratchet, and a proof follows imports | M24 |
| D-252 | 2026-09-23 | The ledger needs eleven things from the engine and none is a new shape: polymorphic references are several links with at most one set, reconciliation is declared, and the rest is code | M24 |
| D-253 | 2026-09-23 | A conversation connects two formats that exist, and it only ever adds | M24 |
| D-254 | 2026-09-23 | A conversation adds columns and identities, and removes a whole format no other refers to — a tool, not a refusal | M24 |
| D-255 | 2026-09-23 | A column may be unique: an index the reconciler owns, refused over repeats, and a write that would repeat names the row that holds the value | M24 |
| D-256 | 2026-09-23 | A link may be written as its target's name when that name is unique, and a batch may name its own rows | M24 |
| D-257 | 2026-09-23 | A figure to fixed places is its own type, stored as a whole number and written as a string; a month and a moment are types; a ratio is a dimension | M24 |
| D-258 | 2026-09-24 | A closing message ends with what's next, and asks the maintainer to try something only when it really should be tried | M24 |
| D-259 | 2026-09-24 | A row constraint is one of three sentences, stored as the sentence and compiled to a pair of triggers the reconciler owns | M24 |
| D-260 | 2026-09-24 | An aggregate may fold only the rows that match: one enum or boolean, one hop at most, one member | M24 |
| D-261 | 2026-09-24 | A column of a file fills a link by the target's unique name, exactly, or the line is refused | M24 |
| D-262 | 2026-09-24 | A reading writes one header row of another format, read from positions, and every line links to it | M24 |
| D-263 | 2026-09-24 | A row other rows link to is not removed: the delete is refused, naming what links to it | M24 |
| D-264 | 2026-09-24 | A pack seeds rows by name, and a row is the pack's only while its record says so | M24 |
| D-265 | 2026-09-24 | A pack is declarations, seeded rows and code, and its code writes SQL only against the tables it declares | M25 |
| D-266 | 2026-09-24 | The ledger is on per document, and its seeds wait for the tables they replace | M25 |
| D-267 | 2026-09-24 | Three kinds of logic become declarations — a rollup by period, the latest by an order, and a matching rule — and the rest stays pack code | M25 |
| D-268 | 2026-09-24 | The conversion keeps a row's id, renames a person's clashing name, and the reference tables move first | M25 |
| D-269 | 2026-09-24 | A pack's formats are read anywhere and written only through the pack | M25 |
| D-270 | 2026-09-24 | Unique across several columns is a fourth row constraint, `one row per`, compiled to a unique index | M25 |
| D-271 | 2026-09-24 | A rollup by a month is a fifth table of the declaration, one sentence compiled to one `GROUP BY` | M25 |
| D-272 | 2026-09-25 | `latest` and `earliest` are aggregate kinds that pick one row by an order column, and a tie is unchecked | M25 |
| D-273 | 2026-09-25 | A matching rule is a rule set declared on the rule format, applied on a write of the target and on demand, and never over a person's value | M25 |
| D-274 | 2026-09-25 | A pack's ownership is kept in the document, and the lock sits in the generic callers | M25 |
| D-275 | 2026-09-26 | Transactions and statements move, an import is a `statement` every line links to, and intake is a unit of its own | M25 |
| D-276 | 2026-09-26 | The ledger moves; old documents' data does not come with it | M25 |
| D-277 | 2026-09-26 | Intake moves: the importer's mappings and staged rows are pack formats | M25 |
| D-278 | 2026-09-26 | Holdings, investments and FX move; a trade outlives its position | M25 |
| D-279 | 2026-09-26 | Savings, debts and purchase plans move; a payment found in a transaction links it | M25 |
| D-280 | 2026-09-26 | Funds move, and the ledger declares its first identity | M25 |
| D-281 | 2026-09-26 | Paychecks, splitting and fixed expenses move; net against gross is the paycheck's identity | M25 |
| D-282 | 2026-09-28 | The ledger keeps no table of its own, and is at the front door again | M25 |
| D-283 | 2026-10-01 | M25 closes, and investments leave the ledger whole | M25 |
| D-284 | 2026-10-01 | M26's shape: short verbs, a format's page is a sheet, an entry is a view the format has, and the graph keeps its positions | M26 |
| D-285 | 2026-10-01 | One document is one file; a way out is an export, and a way back in is an import that checks | M26 |
| D-286 | 2026-10-01 | A fact is written once: the unit row is the record, a brief names its files, and the maintainer sees a unit before it is built | M26 |
| D-287 | 2026-10-01 | A milestone is driven: one session relays, a fresh subagent builds each unit, and it stops for the maintainer where a unit needs judging | M26 |
| D-288 | 2026-10-01 | The formats list is cards: the card opens, its other actions are icons, and the corners are square on trial | M26 |
| D-289 | 2026-10-01 | A format's page is a sheet: column widths are kept in the document beside the declaration, and a paste is the tool's batch | M26 |
| D-290 | 2026-10-01 | A format is changed on its sheet: a rename is asked for and keeps its values, and a cell's choices are the app's own list | M26 |
| D-291 | 2026-10-01 | The connections graph is a canvas whose bubbles stay where they are put, and a pack is one bubble until opened | M26 |
| D-292 | 2026-10-01 | A reader is a format's accepted readings grouped by header; files are read in bulk, each by the reader that fits, and a reconciled file is ticked but never written past review | M26 |
| D-293 | 2026-10-01 | A reader keeps its file's column order and follows a moved column by name; it can be renamed and forgotten; a failed check names its lines | M26 |
| D-294 | 2026-10-01 | An entry is a page: a view the format has, its columns in order, each drawn by an input chosen per format and kept beside the declaration | M26 |
| D-295 | 2026-10-01 | The MCP screen reads a plain-words catalog the renderer can import, pinned name for name to the server's own definitions by a test | M26 |
| D-296 | 2026-10-01 | An entry page is headings over inputs, and its order is the view's — dragged, kept beside each column's input, never the declaration's | M26 |
| D-297 | 2026-10-01 | M26 closes on the maintainer's word, with five screen trails carried rather than built | M26 |
| D-298 | 2026-10-01 | M27 is six units, the engine's link risk before its views, and the live roadmap reads while a session writes | M27 |
| D-299 | 2026-10-01 | The development pack is the memory's five declarations, with no seeds and no owner, and `unit.milestone` stays text until `match` reads a link by name | M27 |
| D-300 | 2026-10-01 | A link can name several rows: `links` is a thirteenth type kept in a member table, and `match` takes a link by its target's name | M27 |
| D-301 | 2026-10-01 | A view is a line the pack declares beside its formats, and the first kind is a board: lanes by an enum, a card by its name and the columns that say `card` | M27 |
| D-302 | 2026-10-01 | A roadmap is rows in the order of a number with the rows that name each folded beneath, and a page is one row with its links read one hop each way | M27 |
| D-303 | 2026-10-01 | A ready view is rows in a ready member whose own links name nothing still open, and start_here answers every question a document's views declare in one call | M27 |
| D-304 | 2026-10-01 | A unit is claimed by ref on condition, plugin writes take a lock, and a clean window follows the disk | M27 |
| D-305 | 2026-10-01 | A document keeps a pack by its own test, the development pack only whole, and a kept pack with views is drawn in the rail from them | M27 |
| D-306 | 2026-10-01 | The views are drawn from the approved mockup: a timeline roadmap, motion only for a change, one theme, and accent on live work | M27 |
| D-307 | 2026-10-01 | M27 closes on the maintainer's word, and M28 gets the new design on the ledger's screens, mockup first | M27 |
| D-308 | 2026-10-02 | Investments leave the ledger: the pack retires what it no longer declares, `exchange_rate` stays, and the price socket goes | M28 |
| D-309 | 2026-10-02 | Money moved to something you own is not spent: a transaction a person's declared link names is saved, whatever its category | M28 |
| D-310 | 2026-10-02 | Payslips are read in bulk on Paychecks: a slip's labels choose its reader and its own arithmetic is the fit; the ledger's readers leave Settings for the screens they feed | M28 |
| D-311 | 2026-10-02 | A stored reader whose labels drifted still reads a slip its figures close on; the batch is the store's, not the screen's | M28 |
| D-312 | 2026-10-02 | The frame every screen shares is a tree rail, a split-tile button and the emerald indicator, and Paychecks is one month with three ways between months | M28 |
| D-313 | 2026-10-02 | Home is Month and Year, statements are read in a batch with no review screen, and the four flows carry their own colours on Home's figures | M28 |
| D-314 | 2026-10-02 | Category colours are eleven richer hues drawn as dots beside the name, and none of them is a flow colour | M28 |
| D-315 | 2026-10-02 | Transactions is one page with By merchant and All rows, a row has one menu, Categories is a list and a panel, and a conversation can do all of it | M28 |
| D-319 | 2026-10-03 | Plan is one page: each fixed expense has its own say per plan, a divider trades between its neighbours, a bucket points at six things and wears the colour of what it points at | M28 |
| D-320 | 2026-10-03 | The plan's bar can turn into a ring: one set of outlines, two places for each point, and a preference that is the viewer's | M28 |
| D-321 | 2026-10-03 | A change to a bucket flows only to the right, and a drag snaps to what the bucket is written in | M28 |
| D-322 | 2026-10-03 | Plan deletes buckets and plans, a bill outside the month says so, the comparison covers fixed expenses, and went out is fixed plus the rest | M28 |
| D-323 | 2026-10-03 | Wealth is four places, and a goal's monthly amount is the Plan bucket that points at it | M28 |
| D-324 | 2026-10-03 | A goal reads its bank deposits from one Money moved category, a deposit is derived, set aside or was already there, and the cushion is the Emergency goal | M28 |
| D-327 | 2026-10-03 | A category's target is its Plan bucket: one figure, read from the plan in use for the month, shown on Home as spent / budget | M28 |
| D-326 | 2026-10-03 | Wealth's last slice: a goal can be paused, set-aside money is asked about after 90 days, a fund can carry an agreed return, a split can be suggested, and Points at makes things in place | M28 |
| D-325 | 2026-10-03 | Accounts carry an opening balance that the last statement checks, Debts is the deciding table (no rate, so plain addition), and Funds holds Fee impact as a section and the deposit check as a column | M28 |
| D-328 | 2026-10-03 | Wealth is rebuilt from its mockup's source; a typed goal or debt amount comes from Everything else; the cushion can count Plan's spending buckets | M28 |
| D-329 | 2026-10-03 | Moved against planned counts only the months a goal was taking money: a paused goal is not compared, and the window starts with the goal's first deposit | M28 |
| D-330 | 2026-10-03 | Guide me replaces the ledger's onboarding: a pack declares its steps, a dialog points at the real screens, and a step ticks itself when the document shows it done | M28 |
| D-331 | 2026-10-03 | One editor makes a format and changes it: a new format is the editor on an empty one, the walk and the blank sheet go, and what has to add up is a named band | M29 |
| D-332 | 2026-10-03 | Columns move: the order is the declaration's, a header moves by its grip with a pointer or the arrows, and moving the first text column says the entries are called by another | M29 |
| D-333 | 2026-10-03 | A percent column: millionths of the whole as an integer, entered and shown as 12.5%, read by an identity as its exact fraction, and a money side rounded to the agora, halves away from zero | M29 |
| D-334 | 2026-10-03 | A derived column: an identity's expression producing a value, compiled by the engine into one SQL view per format from the parsed tree, never stored and never editable | M29 |
| D-335 | 2026-10-03 | A time-of-day column, and `end - start` of two times, dates or instants as a span in hours or days, two times wrapping at midnight | M29 |
| D-336 | 2026-10-03 | A text document checks every declaration against all the others, so formats that point at each other reopen | M29 |
| D-337 | 2026-10-03 | Two exports of one bank are one account: a file whose rows another account already holds stops and says so, the mapper offers the existing accounts first, and a reader learns its account on first use | M28 |
| D-338 | 2026-10-03 | A queued file comes out before Write, by its × or Delete, and the window's drop overlay lets go in the capture phase | M28 |
| D-339 | 2026-10-04 | One batch makes its accounts once: every sheet is judged against the sheets before it, the mapper offers the accounts the batch is about to make, and a reader drawn for one file reads the files waiting behind it | M28 |
| D-340 | 2026-10-04 | Deleting a category moves whatever still uses it to a category of the same kind first, and is refused when there is none | M28 |
| D-341 | 2026-10-04 | Use for the month writes no planned deposit into a goal real money already feeds; the ones already written are left for the person | M28 |
| D-342 | 2026-10-04 | A category's group is chosen on the top-level category and inherited below it; Plan's buckets sit under their category's group, read every time | M28 |
| D-343 | 2026-10-04 | Add writes or says which row and cell stops it: the table is asked before the write, a column whose table drifted from its declaration is rebuilt while empty, and a refused foot row stays marked until written | M29 |
| D-344 | 2026-10-04 | A cell is read as it is typed and shows its reading while typed: 87, 87% and 0.87 are 87% and 1 is 1%, a time takes either clock, and the document keeps the currency a new amount starts in | M29 |
| D-345 | 2026-10-04 | A new format asks its name alone first; the sheet marks only the column the panel is open on; a saved column greys out *worked out* with the reason; and a format with no identity is created without a *Nothing does* | M29 |
| D-346 | 2026-10-04 | Worked out and must add up are offered side by side with one time example each; a formula field offers the format's names and marks the ones it knows in positive; a worked-out column is resized like any other and drawn on surface | M29 |
| D-347 | 2026-10-04 | A format sheet header's hidden controls take no width, so a narrow column shows its name; a timing assertion is held to the load it ran under, and a test's default budget is fifteen seconds | M29 |
| D-348 | 2026-10-04 | Groups and top-level categories are one tree, three levels deep: a heading is a top-level category, and a budget on any category counts everything under it | M28 |
| D-349 | 2026-10-04 | A total may fold a worked-out column, as each row shows it; a total of money carries its currency, and two currencies in one are no total | M29 |
| D-350 | 2026-10-04 | A link may be found by a date: written on a write while it is empty, stored as if picked, refused by name when no row or two match, and never over a person's link | M29 |
| D-351 | 2026-10-04 | A fold is called a total wherever a person reads it, a total of money takes no unit, and the link-and-total gesture starts from either end | M29 |
| D-352 | 2026-10-04 | The connection window says what will be true in plain words: belongs to one… / has many…, one/many marks on the line, a headline built from the answers, and a total that opens on a suggested name | M29 |
| D-353 | 2026-10-04 | A link found by a date is applied to the rows already there only when asked: apply_rules with link, and Apply beside Match by date, filling empty links and never a set one | M29 |
| D-354 | 2026-10-04 | A place links to an account, never merges with one: holding_place.account and the account's own cash holding made with it, and an account that holds things read as HOLDINGS beside a stored CASH | M30 |
| D-355 | 2026-10-04 | A row that names a holding is cash turning into it inside one account: transaction.holding and quantity, counted in no flow, and the holding's quantity a declared sum of its rows | M30 |
| D-356 | 2026-10-04 | A transfer between two of your own accounts is one pair: matched by amount and date, suggested on every commit, answered once, and moved at the ordinary end and held at the end that holds things | M30 |
| D-357 | 2026-10-04 | A goal is fed by one source: a Money moved category or the rows that name its holding, never both, and what a holding's rows put in is checked against a printed cost basis | M30 |
| D-358 | 2026-10-04 | A holding is worth its latest reading: a dated reading transcribed from a statement, growth derived from it and keyed by it, quantity × price a check only, and nothing on an account that holds things is income or spending | M30 |
| D-360 | 2026-10-04 | What is in the bank is the ticked accounts' latest statements, split between the goals saved there and the cushion as what is left; parts beyond the balance are a failed check, in the whole and per account, never clamped; the Emergency goal is no longer the cushion | M30 |
| D-361 | 2026-10-05 | In the bank leaves out what an account that holds things holds, and net worth keeps it; Home's Saved lists its three parts; the biggest charges are rows went out counts | M30 |
| D-362 | 2026-10-05 | Every bank account and cash has its place, named as it, and its own Cash — made with the account and held on open; a place is not re-pointed between accounts in one step; a goal's money in a bank account's own Cash is inside its statement and counted once | M30 |
| D-363 | 2026-10-05 | A goal asks one question, where is the money; the answer decides the rest — an account or a place kept by hand asks how much is already there, a holding bought by rows is followed; + New… makes a place in the same write; the category feed is the folded advanced choice; the goal form is one write both halves share | M30 |
| D-364 | 2026-10-05 | A goal whose money is a bank account's own Cash can count the confirmed transfers into it: ticked under the account's answer, off by default; arriving is a deposit, leaving a withdrawal, after the latest Was already there; a third feed, one goal per account, and a pair it reads is no category's | M30 |
| D-365 | 2026-10-05 | A holding with a reading is worth its latest reading wherever it is shown, whether or not a goal follows it; growth is the reading less what went in by its day; the Money map's unseen figures go; an account's bare place goes with it | M30 |
| D-366 | 2026-10-05 | Net worth is everything owned, each once: every holding not liquid and not inside a statement counts on Overview, as it already did in Home's net worth and the savings tool | M30 |
| D-367 | 2026-10-05 | Every question the app has waits in one list at the top of Home and is answered there where the answer is a click or two; the notice bar is one count pointing at it; a month with no pay and a card charge with no statement get an answer of their own | M31 |
| D-368 | 2026-10-05 | Read it keeps the reader, so a statement's columns are mapped once; a statement dropped on a document without the ledger is held and offered one; the empty window says which button keeps money; reader is the one word for reader / mapping / layout / template | M31 |
| D-369 | 2026-10-05 | 50/30/20 lands on the person's top-level categories, each share divided by what went out under them, asking only about headings it cannot place; with no payslip, take-home pay is the salary that came in; a budget set with no plan makes the plan | M31 |
| D-370 | 2026-10-05 | A month's plan is a row, given with a checkbox and kept when the plan is edited; the comparison is the bar itself; a 50/30/20 plan's buckets remember their share | M31 |
| D-371 | 2026-10-05 | Every bank account and cash counts toward the cushion until it is unticked; with no bills the In the bank card tracks them in place, and Plan's cushion line sets the months there | M31 |
| D-372 | 2026-10-05 | A form makes what it needs in place: a select whose last option is + New…, and the category picker always offers it | M31 |
| D-373 | 2026-10-05 | One way to make a rule from a row: the offer, which matches by contains, files the rows already here by default, and asks for its category | M31 |
| D-374 | 2026-10-05 | Putting a pane away steps back to the list's own history entry rather than pushing a new one; Back and Forward arrows by the document's name; Open recent beside Open; the window never scrolls as a page | M31 |
| D-375 | 2026-10-05 | One name for one thing: reader, Where the money is, left out of totals, card payment, bill, and a bucket is for something; Wealth's first tab is Net worth and its accounts section Balances, so Settings › Accounts is the one screen called Accounts | M31 |
| D-376 | 2026-10-05 | A bank or cash account's own place adds up to its statement: each goal saved there is a row with its part, and its own Cash is what no goal has taken; parts beyond the statement are a failed check; nothing stored, and no total moves | M30 |
| D-377 | 2026-10-05 | A link that stops being a card payment leaves the bank row's left-out-of-totals flag as it is; a written payslip runs the same payroll sync from a tool as from a screen | M36 |
| D-378 | 2026-10-05 | Every plugin open brings the ledger up to what this build declares, in memory, and a write saves it with its change; no repository probes for an older shape, and an older text document is refused from its header | M36 |
| D-380 | 2026-10-05 | A filter can say is not, is one of and is empty; the ledger's declared spending is the one rule for what counts, and the person's left-out flag is only theirs | M36 |
| D-381 | 2026-10-05 | A worked-out column reads the latest; a holding's worth is declared, and a goal's feeds are worked out on read, never stored | M36 |
| D-382 | 2026-10-05 | The ledger declares its waiting questions as start views — transfers, card settlements and payments to confirm — and Home counts what they find; a start view's `is` takes true or false on a boolean | M36 |
| D-383 | 2026-10-05 | Net worth is one figure — everything owned, each once, less what is owed — read by Overview, Home and the savings tool from the declared parts plus the statements | M36 |
| D-384 | 2026-10-05 | A bank account's own cash is in no place: a place is an account's because the account's own cash is in it, holding_place.account goes, and a required column made optional keeps its values | M36 |
| D-385 | 2026-10-05 | Net worth is one table — one row per account or place, then the funds and the debts, adding up to netWorth; the cushion is a column of ticks and a line; an account with holdings is one name; and a bank account's own cash is made with it, never on open | M36 |
| D-386 | 2026-10-05 | A pack can rebuild its own table — it vouches for a column it retired or an enum it re-listed, never a person's format — and the ledger's patches go: HOLDINGS and a bucket's FUND and ACCOUNT are real kinds, the inert plan columns and an Emergency goal's months are gone | M36 |
| D-387 | 2026-10-05 | Fewer places to go: one Readers list beside Read files, which reads fund reports too; Rules beside Categories; the whole cushion on Plan; Plan's header one month control; the deposit check a section of Funds; the waiting list opens the thing; Pays into makes what it needs | M36 |
| D-388 | 2026-10-05 | Shorter forms: a goal asks no kind and no kind of goal goes first in a split; a holding asks name, kind and a fee and works out the rest; a deduction type's flags and Pays into are guesses to confirm; Show archived is in each screen's menu | M36 |
| D-389 | 2026-10-05 | A fund is a holding fed by rows: a report is a reading that may carry its parts, its deposit table is reading_deposit rows, payslip lines are its deposits worked out on read, a month whose employer part never arrived fails by name, and the fund formats, inFunds and the Provident and Study fund place kinds go | M36 |
| D-390 | 2026-10-05 | Nothing personal in the repository or its history: synthetic stand-ins in the tree, a denylist kept outside the repo that a test reads, and the history rewritten once with filter-repo plus a callback for the document stored as SQLite bytes | M36 |
| D-391 | 2026-10-05 | A conversation says what a payslip line pays into: set_deduction_types sets a list of deduction types' Counts as and Pays into through the screen's own write, whole batch or nothing, refusing a target of the wrong kind by name | M36 |
| D-392 | 2026-10-05 | set_deduction_types is the whole Deduction types screen: one list makes, renames, re-kinds and removes types and an order puts them first, through the screen's own writes, with removal refused by name where the screen refuses it | M36 |
| D-393 | 2026-10-05 | The cushion shows under a bank account it lives in, read-only: that account's Cash, not for any goal is named the cushion's part, and the whole — total, the other accounts, target, above or short — is said once beneath it, from Plan's own reading, with the way to Plan | M36 |
| D-394 | 2026-10-06 | A yes covers the dry run it answered and nothing after it: a batch of the same shape that follows gets its own dry run and its own yes, and fewer stops come from a bigger batch shown once | M34 |
| D-395 | 2026-10-06 | Many files read in one call, each onto its format, in the order their links need: the plan is the write rehearsed in a transaction that is rolled back, written whole or not at all, a line naming a parent that is not there refused by file and line; declare_format takes several formats the same way | M34 |
| D-396 | 2026-10-06 | What is wrong is said without being asked: every read accounts for each line of the file and reports what the engine can see mechanically in the formats it wrote — a link empty where most rows fill it, rows the same in every column, identities failed or unchecked; format_problems and a band on the format's page say it on demand; nothing is guessed that needs a declared rule | M34 |
| D-397 | 2026-10-06 | A total may fold every row of a format, written `every course` in place of a link — one row states a figure (a degree's average) and an identity proves it against all of them; the total lives on a format and is read by its name, so one hop stays a parse rule | M34 |
| D-398 | 2026-10-06 | Several of a list in one column — `enums`, its members rows of a side table whose CHECK names the list, written as a list, matched on one member, and split from a spreadsheet cell only by a separator the reading states | M34 |
| D-399 | 2026-10-06 | A copy from before — a read or batch of 100 rows or more, and anything somebody asks for, first keeps `<name>.before-<when>-<what>.emd` beside the document, the last three apart from the rolling five, and the answer names it; a browser holds it in the page until it is downloaded | M34 |
| D-400 | 2026-10-06 | A folder of Markdown notes is a table — a note a row (`title`, `file`, each frontmatter key, `body`), a link read from `[[name]]` or `[text](file.md)` as the title of the note it names; a link column is guessed when a header names it; and the Read screen reads a file no reader fits by the guess, shown in place | M34 |
| D-401 | 2026-10-06 | One entry view: a row's page is its entry, in the approved direction A — title, a header line, figures as a grid with their verdicts and worked-out columns, long texts as markdown, and what names it on the right; a field writes when it is left, a new entry is a draft until Add, `page/:id` redirects, and the page's `body`/`line` fold into the entry's `markdown`/`header` | M35 |
| D-402 | 2026-10-06 | Show as, per column type: each type has the approved mockup's set of ways, the first its default and the sheet's look — editing follows from the way, a worked-out column takes its result type's ways, `field` and `search` read as no choice, and a text with inline markdown reads as markdown | M35 |
| D-403 | 2026-10-06 | A conversation arranges a view: `arrange_views` takes a list of settings — an entry's Show as, header line and order, a board's lanes, a sheet column's width — dry-run until `commit`, and `formats` reads the arrangement back; the refusals of D-289, D-294 and D-301 are reversed, the canvas's (D-291) stands | M35 |
| D-404 | 2026-10-06 | The Markdown reader's small faults: a note is called by its frontmatter `title` or its file name and its body is kept whole, a hidden file is never a row, the body's `#tags` are an `inline tags` column, `columns` maps a column to `null` and applies over the mapping shown, a fixed currency or unit goes only to rows with an amount, a dry run cuts long text, and an emoji written as a character reference survives a spreadsheet | M38 |
| D-405 | 2026-10-06 | A document keeps the packs it is asked for: `create_document` takes `packs` (omitted, the ledger on the full server and none engine-only), `keep_packs` and the Packs screen's *Keep this pack here* keep one in a document that exists through one `keepPack`; a format the document holds of the pack is completed when it is the pack's and refused, naming the column, when it only shares the name; a document with rows may keep a pack | M38 |
| D-406 | 2026-10-06 | Links in a note's body: `body links` is a list column of the notes a body links to (`[[name]]`, `![[note#section]]`, `[text](file.md)`), each resolved as D-400 resolves frontmatter; guessed onto the one `links` column pointing at the format they resolve into; and **prose, not a required value** — a link naming no row is left out and named in the read's report, the note still read | M38 |
| D-407 | 2026-10-06 | A new document is called `untitled-YYYY-MM.emd`, and New asks first: the title bar has a New beside Save while a document is open, and every New (it, `Ctrl+N`, the palette, the shell's File menu) goes through `requestNew`, which holds the request in a notice — Save, then new · Discard mine, new · Stay here — when there is unsaved work | M38 |
| D-408 | 2026-10-06 | A source read again updates what it wrote, by a key: a note's file name, or the value of the format's unique column the reading fills; a changed line is written over its row, a new one added, and a row whose line is gone named and removed only on request — a row a person edited since is left and named; the row remembers its line beside it (`format_intake_row.source_key`, `written`), and a text document carries what was read in (`readings.md`) | M38 |
| D-409 | 2026-10-06 | Open… asks before it replaces unsaved work: every Open… through the picker goes through `requestOpenFile`, which holds the request in the same notice as New — Save, then open… · Discard mine, open… · Stay here — before the picker shows | M38 |
| D-410 | 2026-10-06 | A note's list items, or a table in its body, are rows of another format: `items` reads a folder's items as a table of their own — `note`, `section`, `position`, then a list item's `item`, `checked`, `figure`, `unit`, `link` and `text`, or the table's own header — each item's `note` filling the link to its note's row by the key that row was written under; an item is keyed by its note and place; and a link to a row of the same read holds its line until the commit draws the row's id, so two notes of one folder that link each other are both filled | M38 |
| D-411 | 2026-10-06 | The tool surface a stranger tripped on: `format_rows` takes an `offset` and hands back the next one, and a total or derived column by name in `columns`; a link names its row by id, by a name exactly one row holds (unique or not), or by columns of that row — `{name, brand}` — exactly one or refused; the full plugin introduces formats first and `document_info` leads with them; a format with no identity needs no flag — `nothing_must_hold` left `declare_format` and no surface refuses its absence; and the first rows written into a document that holds none take a named copy first, whatever their number | M38 |
| D-412 | 2026-10-06 | A conversation changes a format as its sheet does: `extend_format` takes `rename`, `change` and `remove` through the same `adoptFormat` and reconciler, dry-run until `commit`, refused naming the rows where a value would be lost or re-meant; and a list every row fits — a text made an enum, an enum re-listed or made a text — is rebuilt over its rows on any format | M38 |
| D-413 | 2026-10-07 | The showcase is tours over the real app: a drawn pointer walks a workflow a visitor can take over, a tour's steps are rows the document holds, the document is built at build time by the engine's own tools, and one deployed build serves Emerald's page and the maintainer's site through an iframe with parameters | M33 |
| D-414 | 2026-10-07 | A tour's rows are a document of their own, `tours.emd`, made from the committed `tour.format.md` and `tour_step.format.md` as the two parts of a text document and read by the frame through the engine — never inside the document the tour plays; a caption's reading counts from when it came up, and the first play does not reopen what the page just opened; the app is laid out no narrower than 960, the paper beside it on top of that, and drawn scaled below; and `check-tours` plays the frame itself in a hidden Electron window | M33 |
| D-415 | 2026-10-07 | A tour's caption sets the ring moving at once and is read, capped at 3.5 s, before the first click or keystroke; the app is laid out no narrower than 1120, measured from the sidebar the demo shows; `check-tours` fails a row at which the app scrolls sideways; and below 690 the frame is a crop of the app laid out at desktop size, not the whole app shrunk | M33 |
| D-416 | 2026-10-07 | The tour's ring travels on the app — worked out in the app's own pixels each frame and mapped through the iframe as drawn — never by a CSS transition on its place; and a crop starts at 0.75x until the visitor picks a speed | M33 |
| D-417 | 2026-10-07 | An identity is a claim wherever a person or a model meets it, and a worked-out column is computed: Claims and Computed are two headings on the screen, the band over a format's sheet is Claims, `declare_format` and `extend_format` take `claims` and `computed` with `identities` and `derived` still read, and a `.format.md` writes a `claim` table and `claims: none` and still reads an `identity` table and `checks: none`; `identity` stays the code's word | M33 |
| D-418 | 2026-10-07 | The demo is embedded by a contract of three things: `?tour=` picks the tour and `?autoplay=1` plays it, without which the frame holds the tour's first frame — the poster — under one *Watch the tour* control; the frame tells its parent, as `source: 'emerald-demo'` messages, which step is up, a take-over and a Reset, and nothing else; and `check-tours` refuses and fails any request outside the folder. Pages publishes `dist-demo/` from a public repository only, and the first deploy is the maintainer's | M33 |
| D-419 | 2026-10-07 | The demo's poster is the custom tour at the end of its first scene — the card statement open, the Corner Market row outlined, the first caption up — not its first frame | M33 |
| D-420 | 2026-10-07 | The development pack's `unit.claimed_by` is `taken_by`, its values carried over, and a session takes a unit rather than claiming it | M33 |
| D-421 | 2026-10-07 | App-wide motion is one module, `src/ui/motion/`, of measured FLIPs over the Web Animations API rather than view transitions, keyed by what a row is called; its mockup runs on the dev server only, behind a switch, unapproved | M39 |
| D-422 | 2026-10-07 | A format is a pack's when the document keeps the pack and the pack declares its name; every list of formats puts the person's own first and each pack's under the pack's name, indented, never folded | M33 |
| D-423 | 2026-10-07 | Rows, layout and verdicts move everywhere, figures still count, and the demo's tour waits on what moves layout by its animations' finish, never a delay | M39 |
| D-424 | 2026-10-07 | Navigating is a plain fade keyed by the screen, not the address, and whatever pops in fades out by one page-wide watcher; the mockup's switch is gone | M39 |
| D-425 | 2026-10-07 | What appears enters by a class on the element — `fc-pop-enter` for what opens, a keyed `fc-view-enter` for a step — a keystroke changes no motion key, and the tour check types a key at a time | M39 |
| D-426 | 2026-10-07 | A phone's crop keeps the ring in its window over the outline it holds, may pass the app's right edge under the paper's card, and `check:tours` asks at every anchor | M33 |
| D-427 | 2026-10-07 | A tour can be a conversation: a `chat` line per row in the frame's own panel, said to be written for the tour, and a `write` step whose rows go through `stageRows` and `insertRows` as `record_format_rows`'s do | M33 |
| D-428 | 2026-10-07 | An outline is held only through the rows that only talk — a new scene, or a row that acts without outlining, lets go of it — the newest chat line is outlined as it arrives, and `check:tours` fails on an outline held over a box that has left the screen | M33 |
| D-429 | 2026-10-07 | A tour's `write` can declare a format — made, or added to without a column — and a claim on a pack's format sits on the pack's side, against a link found by date | M33 |
| D-430 | 2026-10-08 | Emerald is AGPL-3.0: the code AGPL-3.0-only, the notes CC BY 4.0, every format declaration, pack and synthetic fixture CC0, the name and mark excluded, a commercial licence on request — published under the maintainer's own name from a fresh repository, after one history rewrite that is the maintainer's act | M33 |
| D-431 | 2026-10-08 | A format's sheet is drawn in the conversation as an MCP App: `format_sheet` names one `ui://` page the server serves from memory, the page is the app's own `FormatRows` over the store's `openBytes`, the file rides in the result's `_meta`, and the frame runs sql.js's asm.js build because a frame's CSP refuses wasm | M41 |
| D-432 | 2026-10-08 | The frame draws every view of a format at the app's own paths, read-only, with a test that fails on a control leading nowhere; `start_here` is a page; the copy goes only to a client that advertises MCP Apps | M41 |
| D-433 | 2026-10-08 | The server draws the engine's views and nothing else draws them: the frame ships inside `server.mjs`, no pack carries UI, nothing leaves the frame, and it is read-only; a model draws when a person asks to see and reads rows with `format_rows` | M41 |
| D-434 | 2026-10-08 | `status.md` is retired: `conventions.md` and `start_here` are the whole orientation, and where the build is lives only in the rows | M40 |
| D-435 | 2026-10-08 | The project's rules are rows of its own `rule` format in `memory.emd`, not lists in conventions.md and CLAUDE.md; CLAUDE.md carries the few marked `always`, rendered and checked by docs:check, and points at the query for the rest | M40 |
| D-436 | 2026-10-08 | The project's names are rows of its own `term` format in `memory.emd` — one name per thing, with what it means, what it must not be confused with, the names turned down, the code's word and the decision that settled it; `docs/10-glossary.md` is deleted | M40 |
| D-437 | 2026-10-08 | The UI's rules are `rule` rows with `scope: ui`, not a second format; the values stay in `tokens.css` and are never copied; `docs/11-ui-design-language.md` is a short note saying which is where | M40 |
| D-438 | 2026-10-08 | What is left in `docs/` is argument, reference the code cannot say, and procedure: the roadmap and `review.md` go to the archive because rows answer them, 03 is deleted into 02 and `rule` rows, 05 moves to the ledger pack, engine.md's H questions become rows, and the decision log keeps its arguments | M40 |
| D-439 | 2026-10-08 | The development pack gains an `inbox` another project's session writes to: `from` is the sending document's path, `start_here` lists what is `new`, and who writes what is a convention its notes state, not a guarantee the engine gives | M44 |
| D-440 | 2026-10-08 | The server holds one kind of state: which documents a connection subscribed to. A document is a resource addressed by its `file://` URI, watched through its directory, and every change is sent as `notifications/resources/updated`; tools stay stateless | M44 |
| D-441 | 2026-10-08 | A subscription can name one format — the document's URI with the format as its fragment — and is told only when that format's rows, compared as printed, differ; `server.mjs watch` prints one line per such change so a session's Monitor wakes on it | M44 |
| D-442 | 2026-10-08 | A drawn view is drawn again when its document changes: the frame subscribes through the host and asks again only when told, and where the host refuses, checks the file's stamp with `frame_copy` — an app-only tool, listed only to a client that draws — on coming into view and every 15 s while in view; it says which in the host's log | M44 |
| D-443 | 2026-10-08 | A pack lists the columns it renamed, and keeping it again renames them in place with their values; a document that keeps a pack already is brought up to date by keeping it again, when this build's pack has grown or renamed a column since | M44 |
| D-444 | 2026-10-08 | The development pack's `open_question` gains `answer`, text: a question answered by a fact says the fact there, and a decision row is written only for a decision | M44 |
| D-445 | 2026-10-08 | The frame wears the host's surfaces, ink, hairlines, small radii and type from `hostContext.styles`, re-applied on `host-context-changed`; the accent, the verdict and figure colours and the square shapes stay Emerald's and must read at 4.5:1 on the host's surface, or the frame keeps Emerald's colours whole; no font origin is allowed in the CSP | M41 |
| D-446 | 2026-10-08 | No tool result carries a copy of the document: the drawn view fetches it with `frame_copy`, now listed to every client and refused without the ticket the view's result carried; the server logs what each client advertised; and the text beside a drawn view names every row it shows and nothing longer | M41 |
| D-447 | 2026-10-08 | The frame takes what to draw from the call's input and proves itself with a key the server writes into the page it serves; no result carries the proof, and `frame_copy` answers in `structuredContent` | M41 |
| D-448 | 2026-10-08 | The frame paints no page of its own in any host, and inside VS Code's webview its root declares no colour scheme, so the browser lays no backdrop under it; it says in the host's log and its own console what the host handed | M41 |
| D-449 | 2026-10-09 | The installers say AGPL and carry every bundled package's licence: a build writes THIRD_PARTY_NOTICES.txt beside what it built, the app's id is `com.kfireliyahu.emerald`, and SheetJS comes vendored from its own CDN at 0.20.3, because npm's 0.18.5 is unpatched | M43 |
| D-450 | 2026-10-09 | Before the repository is public: another product is described by its category, never named, except a host Emerald runs inside, a runtime it speaks to and the maintainer's own story; outside code is not taken for now — issues and discussion are welcome, and a contributor agreement comes first if code ever is; there is no code of conduct; and security reports go to the address LICENSING.md gives | M43 |
| D-451 | 2026-10-09 | The chosen names land everywhere at once: a paycheck is never a payslip or a slip on a screen or in a tool, to categorize is never to file, a bill's form says bill, a link is made under *Links to*, a computed column under *Computed*, the table view is *Table*, a pack's list is *Ready to start*, the rail says *Assistants*, a backup is *Back up now*, a goal is a goal, a reader is never a mapping, and a source read is a file — a document is only the .emd | M43 |
| D-452 | 2026-10-09 | What a downloader is owed: Help opens the license and the third-party notices from the app's own files and an About that names the version, AGPL-3.0-only with no warranty, the source and the not-advice line; Source Code hands the repository — one address, read from package.json — to the system browser on a click; a tag builds the unsigned installers in CI with SHA-256 checksums and attestations; the privacy policy is PRIVACY.md | M43 |
| D-453 | 2026-10-09 | A fresh clone builds the same on every machine: every text file checks out with LF whatever core.autocrlf says, the notices are read from package-lock.json rather than from what npm ls prints, and the three dependencies with install scripts are declined in package.json, because nothing Emerald needs runs at install | M43 |
| D-454 | 2026-10-09 | No known advisory ships: the MCP SDK goes to 1.32 and React Router to 7, because no 6.x release carries the fix; a navigation is drawn as a transition, so the tour runner waits for the routed view to say it drew the address; the dev-only advisories left are major upgrades of build tools that never ship | M43 |
| D-455 | 2026-10-09 | The copy taken before a write goes to Emerald's own per-user folder, one folder per document, and the app lists them to restore; restoring is a person's, on the screen; a named copy stays beside the document | M45 |
| D-456 | 2026-10-09 | The rulings on the survey: the old-document leftovers go, the twins that read differently become one reader each in @/core/ or the engine, a popover is dismissed one way, and a basis point prints one way | M45 |
| D-457 | 2026-10-09 | Earlier copies clean up after themselves: a gone document's folder goes 30 days after its last copy, the Windows uninstaller takes the folder, and Help › About shows it | M45 |
| D-458 | 2026-10-10 | The command palette has a button beside Back and Forward on every screen, its tooltip teaching Ctrl+K (⌘K on a Mac); every item in the shell's menu is a palette command, Help its own group, and a test fails when one is not; the menu bar stays hidden behind Alt | M46 |
| D-459 | 2026-10-12 | Emerald's page is the demo folder's root and the tour frame is `tour.html` beside it; the page is laid out as the app's roadmap and its words are the approved mockup's, the maintainer's to change before rollout; it may make the two requests the app never makes — a form post and a visit count — each only once PRIVACY.md says who processes it and the maintainer has picked the service, so today it offers the maintainer's address and counts nothing; D-124 is unchanged | M33 |
| D-460 | 2026-10-13 | A week of real use on three documents is measured, not remembered, and what it found is M47: the inbox reaches a session by a hook rather than a poll, the first call carries the columns, a unit lands in one call, a link may cross documents, a format says when it last changed, the document is searched whole, and three small faults | M47 |
| D-461 | 2026-10-13 | A column may name a row in another document — `elsewhere`, the seventeenth type: the document's path and the row's name, read there when the file can be read and unresolved, never refused, when it cannot | M47 |
| D-462 | 2026-10-13 | A format says when it last changed: one mark per format, `format.updated_at`, moved by triggers on every write to its rows and kept by a text document as the day in `changed.md` — no migration, no per-row timestamp | M47 |
| D-463 | 2026-10-13 | The whole document is searched in one call, and a scan before it is shared is the same call with a denylist: every row and column by format, the rest of the file counted, the file's bytes read for a deleted value | M47 |
| D-464 | 2026-10-13 | A roadmap asked of rows that fold under one is drawn as that one, the storage choice is a tool, and a rename a held file refuses is tried again for a second | M47 |
| D-465 | 2026-10-13 | A claim over a sum that no row points at is unchecked, not failed, unless it holds over the zero; rows that point here and a filter takes none of are a real zero; and a row with no text column is called by its first date or month | M33 |
| D-466 | 2026-10-13 | The ledger's pictures on Emerald's page are made, not taken, from a made-up year in a document of their own, shown as a reel of four in the page's theme; and a plan's bucket names its goal, debt or category by name as well as by id | M33 |
| D-467 | 2026-10-14 | A filter's member may have spaces — `one of` splits on its commas and a lone one is quoted; a batch of edits is judged by where it ends and written in an order the table takes; a constraint an enum's new list keeps is not reported as dropped; and a name is read within its parent when its format is one row per that parent and name | M48 |
| D-468 | 2026-10-14 | A folder of notes is read with its subfolders on `recursive: true`, each note carrying its `folder`; a body link to a file that is not a note is no link, counted and never named; and a .json file of rows is a kind of file, read as a .csv is | M48 |
| D-469 | 2026-10-14 | `arrange_views` sets a roadmap's, a ready list's and a start view's words as a column's `setting`, refusing one the view would skip; a word only one column may hold moves to the column it is set on; and the roadmap's order is the screen's too | M48 |
| D-470 | 2026-10-14 | A named copy goes to the document's folder of earlier copies, never beside the document, and the File menu lists it marked as named with the same Restore; pruned to its own last three, and swept with a gone document's folder after 30 days (amends D-455) | M48 |
| D-471 | 2026-10-14 | A date moves by whole days and weeks — `last_reviewed + 7 days` — as the whole of a computed column (a computed date, `date()` in the view) or one side of a claim, and either end of `end - start`; never by months; and a computed column sorts, and a computed date filters, on the screen and in `format_rows` alike | M49 |
| D-473 | 2026-10-14 | An agenda is a list of days, not a week's grid: every format with a date column, by its first date or the one its views choose, from today on and grouped by day; above today only the rows a format says it still owes (`done <members>`); `date` in its filter is each format's own; `start_here` asks it only of formats whose date was chosen | M49 |
| D-474 | 2026-10-14 | A bills candidate needs evidence of a bill, not only a repeat: two months need the same figure to the agora on the same day, more need a steady figure or a steady day; and the day is the purchase's, never a card's charge date | M37 |
| D-472 | 2026-10-14 | Today belongs in questions, never in claims: a filter (`due is within 14 days`, `before today`, `after today`, `today`), a sort and a computed column shown on read (`days_left = due - today`) may read the clock; an identity, a declared total, a rule set and the stored view may not, and are refused saying why | M49 |
| D-476 | 2026-10-14 | A filter holds a column to any of several values, to none of them, or to empty — D-380's words in a question: `match:{state:[planned, in_progress]}`, `{not: …}` with an empty cell let through, `null` the empty cell; one `IN` in `listRows`; the address says `?state=planned,in_progress` and `?state!=built`, the screen ticks | M37 |
| D-477 | 2026-10-15 | A column's header lists the values it holds, each with its rows, counted in SQL under the other filters with its own hold set aside — one reading (`columnValues`) for the menu and `format_rows`' `values`; money and a quantity are held by a range in one currency or unit, `10..50 ILS`, words like a window of days | M37 |
| D-478 | 2026-10-15 | Which columns a line or a card draws is chosen per format and held in the address, `?columns:unit=title,state`, beside the filter; a roadmap holds the rows it folds by `?unit.state=planned` and says *n of m shown*; `format_sheet` takes both, `columns:{unit:[title,state]}` and `match:{"unit.state":…}`; saving a choice into the document's views waits for the maintainer | M37 |
| D-479 | 2026-10-15 | A `file` column holds where a file on this computer is, never what is in it: a path, kept relative to the document's folder when the file is under it and absolute otherwise, or a local app's own address from an allowlist of one (`obsidian:`), never `http`; filled by the shell's dialog, a drop or a typed path; opened by the system's own app from the cell, with *show in folder*; a file gone reads *missing* and stops nothing; text columns do not turn paths into links (driver's picks, per the brief) | M37 |
| D-480 | 2026-10-15 | The history was rewritten once, on 2026-10-15, and origin is the private kfireliyahu/emerald-emd from that day: 712 commits under one identity, no denylist term or old address in any object, the tree at HEAD unchanged; the old repository is never pushed to again, and what still holds the old history is the maintainer's to delete | M33 |
| D-481 | 2026-10-16 | The npm package is `emerald-mcp`, because it is the MCP server and nothing else; the repository stays `emerald-emd`, the file format's name, and the plugin and the desktop app ship under the project's name, so the three need no one slug | M43 |
| D-482 | 2026-10-17 | `format_sheet` is `show_format`, with no alias, because a host that defers tools shows a model only the name and the name has to say *show*; and the head of the server's instructions is a budget: both blocks say what Emerald is and when to draw within the first 2,000 characters | M43 |
| D-483 | 2026-10-17 | A session in a git worktree reads and writes the main checkout's document: a document the project names, found inside a linked worktree, is taken at the same place under the parent of the common `.git` when it is there; the hooks' heading names both files; and the guard refuses a worktree's commit of its own copy | M51 |
| D-484 | 2026-10-17 | A unit records where it was worked in git's own words: `branch` and `commit` are text columns of the development pack's `unit`, `claim_units` writes the branch and `land_units` the commit, and a landing that names another branch than the claim's is refused unless it says `other_branch: true` | M51 |
| D-485 | 2026-10-17 | A child session proposes its landing as one `inbox` row — `refs` its unit, its `body` one fenced `json` block in the shape of one of `land_units`' units — and `land_units inbox:[ids]` lands every proposal named as one dry run and one commit, moving each row to `applied` | M51 |
| D-486 | 2026-10-18 | A unit's `paths` are one repository path per line beside its prose `files`, and `dispatch_plan` answers, for a list of unit refs, which can run at once, which share a path and go one after another, and which have no paths and are unknown | M51 |
| D-487 | 2026-10-18 | The inbox hook tells a session each row once: `--once-per-session` remembers, by the session id in the hook's input and in `<document>.told` beside the lock, which rows it printed by what they say, prints a new one in full and then a one-line count once; and a status line, a separate small build reading `<document>.status` that the server's `status` writes, shows the new rows and the units in progress to the person | M51 |
| D-488 | 2026-10-18 | The frame hands rows to the conversation only as far as the host's `ui/initialize` answer offers: with `hostCapabilities.message`, a ready row offers *Start this unit* and an open entry *Ask about this*, each one `ui/message` written from the row's declared label, line and markdown columns; with `.updateModelContext`, Ctrl-click (or `x`) selects rows and the model is told them; with neither, the frame is as it was, and nothing here writes | M51 |
| D-492 | 2026-10-18 | A hook's `start_here` text opens with a line saying it is text and nothing was drawn, and that a request to see calls `start_here` or `show_format` anyway, on a server the host runs itself where the session has one; both instruction blocks say so before 2,000 characters, host-neutral, and the Claude desktop app's case (`emerald-ledger`) is said only in `CLAUDE.md`. D-489's evidence re-checked and holds | M51 |
| D-489 | 2026-10-18 | A drawing tool's answer opens with whether anything was drawn, from what the client declared at `initialize` and never its name: a client advertising MCP Apps should show it and the server cannot see whether it did; one that did not drew nothing as far as the server can tell, and a host may draw only the servers it runs itself, as the Claude desktop app's Code tab does — and the rows follow in every case | M51 |
| D-490 | 2026-10-18 | A closing message ends with the host's next-step box when the host offers one — the recap is what landed and what is not verified, a decision left to the maintainer is the question, and the first button is *Start <next ready unit>*, sending its ref and the instruction to claim it — and a driver hands each unit to a session of the host's when it offers them: sharing the checkout one after another, or each in its own worktree for units `dispatch_plan` says share no path, landing through their inbox proposals; where the host has neither, the message is prose and the driver uses the Agent tool, as before | M51 |
| D-491 | 2026-10-18 | Keeping a pack again brings its formats' notes and its views' settings to this build's wherever the document still holds a value an earlier build of the pack declared there; any other value is the person's, kept, and named in the dry run — and the pack lists what every build declared (`past.ts`), so no session edits a document by hand to catch it up | M51 |
| D-493 | 2026-10-18 | A drawing tool's first line and the hook's are the model's, never the person's: each opens by saying so, and is an instruction — where the client draws, the view is the answer: say nothing about drawing, views, servers or tools, never retype its rows, and add at most a line it does not show; where it does not, answer with the rows as text and no word about why | M51 |
| D-494 | 2026-10-18 | What only Claude reads lives in `hosts/claude/` — the hooks and the status line, the skills a stranger gets, and the plugin's manifest — built beside the server as `hooks.mjs` and `status-line.mjs`; nothing in `src/` or `electron/` imports from `hosts/`, and a host reaches the server only through `src/plugin/host.ts` | M42 |
| D-495 | 2026-10-18 | The repository goes public before the showcase, as one fresh commit with its history kept privately; what a visitor or a new session reads first says what holds, not who decided it; `docs/archive/` leaves the repository; and M33 U4 then deploys with GitHub Pages and a getemerald.dev record at Cloudflare | M42 |
| D-496 | 2026-10-18 | A tour plays only while its frame is seen, and the frame decides it: the player holds the first step and pauses every hold while an `IntersectionObserver` on the frame's own document says less than a third of it is in view or the tab is hidden, so `?autoplay=1` means play when seen on any page that embeds it | M52 |
| D-497 | 2026-10-18 | The MCP server is published as one npm package, `emerald-mcp`, that is `dist-plugin/` as built: every package bundled and no dependencies, a manifest generated from the root one, and a bin each for the server (`emerald-mcp`, full or `--engine-only` by flag), the hooks (`emerald-hooks`) and the status line (`emerald-status-line`) | M42 |
| D-498 | 2026-10-18 | The Claude plugin is `hosts/claude/`, listed by a marketplace at the public repository's root and built by nothing: it pins the published `emerald-mcp` at the manifest's `version`, runs the server through `npx --prefer-offline`, and runs the hooks through `emerald.mjs`, a hand-written launcher that keeps a copy of the package in `${CLAUDE_PLUGIN_DATA}` and starts it with plain `node`; no `.mcpb`, because the directory no longer takes one | M42 |
| D-499 | 2026-10-18 | The Claude plugin runs everything through npm: the hooks are `npx -y --prefer-offline -p emerald-mcp@<version> emerald-hooks …` and the status line `npx … emerald-status-line`, like the server, and `emerald.mjs` is gone; the cost is accepted — ~1.95 s before every prompt for the inbox hook on Windows, against ~0.35 s for `node` | M42 |
| D-500 | 2026-10-18 | The server is listed in the official MCP Registry as `io.github.kfireliyahu/emerald`, from a `server.json` at the repository's root that a workflow publishes, signed in with GitHub OIDC, whenever npm has a version the registry lacks; a version is cut in `package.json`, `server.json` and `PLUGIN_VERSION` and pushed first, and the plugin's pins follow once npm has it, so they may trail the package and never lead it | M42 |
| D-501 | 2026-10-18 | A unit left `in_progress` by a session that stopped is taken over with `claim_units take_over:<its taker>`, refused unless that taker holds it, with `started` reset and the taker replaced kept on `taken_over_from`; `start_here` lists a unit `in_progress` for more than a day as stalled; `land_units` refuses a landing with no `commit` unless it says `same_commit: true`, and keeps the builder's `report` on the unit | M51 |
| D-502 | 2026-10-18 | The desktop app makes no network call unless the person turned updates on, or pressed Check for Updates Now — then one request, to `api.github.com/repos/kfireliyahu/emerald-emd/releases/latest`, from a session of its own that the page never runs in, open only while that check asks; the setting is off by default and the app's, a newer version is a quiet notice in the window whose Download opens the release page, and M42 U9's download will reach `github.com/kfireliyahu/emerald-emd/releases/download/` and the asset hosts it redirects to (`release-assets.githubusercontent.com`, `objects.githubusercontent.com`) only on the same terms; amends D-124 and D-452 | M42 |
| D-503 | 2026-10-18 | On Windows, with updates on, the app downloads the release its check found — `releases/download/v<version>/latest.yml` and `Emerald-Setup.exe` through electron-updater, in its own session, gated to that release while it downloads — checks the installer against the release's sha512, and installs only on Install and restart, after the window closes the ordinary way, reopening the document; macOS stays a notice; the installers lose the version from their names and the page links `releases/latest/download/` | M42 |
| D-504 | 2026-10-18 | The Claude plugin ships the development pack's run-milestone, closing-pass and review-phase as generic skills beside this repo's own; its `version` is how an installed copy learns of an update, so a change to what it ships cuts one — `<pin>+<n>` for a plugin release with no package behind it, by `node scripts/pin-plugin.mjs --plugin`, the bare package version when the pins move — and `plugin.test.ts` fails when the shipped files' digest moves under an unchanged version; amends D-500 | M42 |
| D-505 | 2026-10-19 | The Mac app is signed ad hoc after packing — `codesign --force --deep --sign -` from an `afterPack` hook, with `mac.identity: null` kept — so a download is an app Apple could not verify, which Open Anyway opens, rather than a "damaged" one, which nothing does; the release workflow fails a Mac build whose signature does not verify; no certificate, account or notarization, so D-124's unsigned stands; amends D-124 | M52 |
| D-506 | 2026-10-19 | The MCP server says what Emerald is before it says what a pack is: both instruction blocks open on a format for any kind of thing and on what it reads (a spreadsheet, a `.json` of rows, a folder of Markdown notes read where it is), with `development` and `ledger` as optional packs; no tool or instruction measures work against money; the engine's tools are listed first in both modes; `create_document` keeps no pack unless asked, in both modes; reverses D-405's default | M52 |
| D-507 | 2026-10-19 | The server says first what a model gains from a document — it asks for the matching rows instead of re-reading files, a typed field filters exactly, a link is followed, every session sees the same rows — and checks are one benefit among them, never the reason; whether something belongs is answered by its shape, never by whether it has numbers; amends D-506 | M52 |
| D-508 | 2026-10-20 | Where the host starts a plugin's skills and hooks but not its MCP server (a cloud Cowork task, `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS`), the plugin tells the session how the person adds `emerald-mcp` to the Claude desktop app's own configuration: an `emerald-setup` skill holds the steps once, and a third `SessionStart` hook, plain Node run from the plugin folder, prints it only there; no new package | M52 |
| D-509 | 2026-10-20 | The server also ships as a Claude desktop extension: `emerald.mcpb` on every tagged release, the npm package's `server.mjs` with a manifest and an icon, run `--engine-only` on the Node the Claude desktop app ships, installed by double-click — which registers it in the app itself, where chat and Cowork on that computer reach it; the plugin keeps `npx`, because Claude Code runs a plugin's `.mcpb` on the system `node`; reverses D-498's *no `.mcpb`* for direct install only | M52 |
| D-510 | 2026-10-20 | The npm package's `engines.node` is `>=20.19.0`, the oldest Node a CI job runs it on: `.github/workflows/package.yml` builds it on Node 24 and runs `scripts/check-package.mjs` on 20.19.0, 22 and 24 — the handshake, a document written and read back, both hooks, and an `npx` install that fails on `EBADENGINE`; the desktop extension's `runtimes.node` follows; amends D-497's `>=24` | M52 |
| D-513 | 2026-10-20 | A team weighing Emerald for its development planning is answered before its model objects: both instruction blocks say, right after the 2,000-character head, that plans nobody owns are what it is for, that one document holds work across repositories, stored as text and committed or kept as one file outside every repository, that documents talk through an inbox and an `elsewhere` column, and that a worktree session's landing goes through the main document's inbox; the head says SQLite as bytes or text | M52 |
| D-514 | 2026-10-22 | A view can be saved, and a dashboard holds only views: a saved view is a format's filter, order, columns and kind under a name, kept beside its other views; a dashboard, one per format and one for the document, is an ordered set of saved views, charts of rollups and headline totals, never a free block; neither is a format; recent changes wait and D-462 stands; amends D-402 | M53 |
| D-515 | 2026-10-22 | Tests stop costing more than the work: `.github/workflows/test.yml` runs typecheck and the whole suite on every push to main and the demo deploys only after it (`needs`; demo.yml is gone); a session runs the tests related to its change (`npx vitest related`), `src/privacy.test.ts` and typecheck, and the full suite only when the change is broad; a red CI run is the next session's first task; no slow project, because no few files dominate | M52 |
| D-516 | 2026-10-22 | One general chart draws plain series — labels, series of `Money` or plain figures, and an axis in a currency or a unit — as bars or a line; it draws only what that axis can hold, one series in ink and several in the category palette by key, and a screen reader reads it as a table; a rollup's chart is bars by month (a line on a toggle), one series per linked row, the eight largest drawn and what is left out said under it, never summed into a new figure | M53 |
| D-517 | 2026-10-22 | Hiding a field is the entry view's, beside its order: `hidden` in a column's `format_view_column` setting (and `views.md`) keeps it off the page even when it holds a value, never the title or a required column; `new` marks a column a new entry asks for; one Fields list behind the entry's icon replaces the Arrange mode, and a field moves only within its part, by its label, its row, its menu or Alt+Up/Down; `arrange_views` takes `hidden` and `new_entry`; amends D-296 | M53 |
| D-518 | 2026-10-22 | An entry draws what it holds: on a row that exists a column with no value is not drawn but named on one Empty line at the foot, where a name opens its field in place; a required column is always drawn and says it is needed; a new entry asks for the title, every required column and the ones ticked New entry, starts a required enum nothing implies at its first member, and says what is missing in one line only once Add is pressed; labels read as words without a unit suffix; two plain figures sit in the line under the title | M53 |
| D-519 | 2026-10-22 | Every format has a list: one line per row, a tick, the name and the line's columns, grouped by an enum, a link or a date's buckets; `group`, `line` and `done <members>` are words one column's `format_view_column` setting holds together, `group` and `done` one column's each; the tick writes the done member and an untick the member held before; quick add writes the title, the group's value, the filter's exact values and a required enum's first member as `record_format_rows`' batch, or opens entry/new when a required column is still empty; the list beside an entry is the same list, narrow; the View menu became the format's one tab strip | M53 |
| D-520 | 2026-10-22 | A saved view is its own table, `format_saved_view` (063): a format, a name, a kind (table, board, list, roadmap, ready) and the address as the address spells it, so a window around today stays the phrase; *Save this view* on the FilterBand, the rail lists them under their format and renames and deletes in place; `arrange_views view:saved` saves, renames and deletes, and `show_format` and `format_rows` take `view:"<name>"`; an entry's back link names the view it was opened from | M53 |
| D-521 | 2026-10-22 | A dashboard is an ordered set of blocks in its own table, `format_dashboard_block` (064): a saved view drawn compact in its kind, a rollup's chart, or a headline total (a count, or the sum of a number or money column, under a filter kept as the address spells it), and nothing else; one per format, the last tab of its strip, and one for the document, the rail's *Dashboard* — first and `#/` without a ledger, right under Home with one; arranged in place (Add a block, drag, Move earlier and later, Remove from this dashboard), a block's title opening it in full with `← Dashboard` back; `arrange_views view:dashboard` adds, orders and removes, `show_format view:dashboard` draws it | M53 |
| D-522 | 2026-10-22 | A spreadsheet keyed by a unique column is matched against every row of its format, whichever file or person wrote it: next month's export, renamed, changes the rows last month's wrote and adds what is new, and the dry run and the Read screen say both counts and name the changed cells; only a file's own rows can be gone from it; a row moves to the reading that last wrote it; a read fills only the columns it maps; a format with no unique column the reading fills says so in one sentence and matches on nothing else; amends D-408 | M52 |
| D-524 | 2026-10-22 | A list ticks only where someone said what done is: no default, so a list with no `done` set is plain lines with no tick column in the List tab, beside an entry and on a dashboard; done is set in place from the list's header (*Tick to mark…*, *No ticks*), by `arrange_views` or by a pack's `views.md`; the header says what a tick sets and each circle says it (*Mark done*, *Undo: back to open*); a tick stays in place a moment with an *Undo* that restores the member it held; the development pack declares done for unit, milestone, open_question, review_entry and inbox, the ledger for none; amends D-519 | M53 |
| D-525 | 2026-10-22 | A dashboard makes the view or chart it needs in place: *Add a block* offers *New view* — a list, a table or a board of one format, its filter, order and columns made with the format tab's own pieces and a name — saved and placed in one step, and *New chart* — a count or a sum by month of a date, per a link or not, under a filter — declared as a rollup of its format and placed in one step; picking an existing view or rollup stays; no new write; amends D-521 | M53 |
| D-526 | 2026-10-22 | A chart is listed in the rail under its format, beside the saved views, with a chart glyph: its name opens its tab, and it is renamed and deleted where it stands, Delete asking once; its tab deletes it too; deleting a rollup deletes its dashboard blocks and renaming one takes them along, in `adoptFormat`, so `extend_format remove` and `rename` (which now takes a rollup's name) do the same; a block's *Remove* still leaves the chart and says where to delete it; amends D-521 | M53 |
| D-527 | 2026-10-23 | A dashboard block is resized by dragging its edge — the right edge its width, the bottom its height, the corner both — snapped to the grid's four columns and its rows of 40 pixels (16 between two), from one column and two rows to four columns and twenty rows; a taller view shows more rows and scrolls inside, a wider table more columns and a wider board its lanes side by side, and a chart redraws to its height; the size is kept beside the block's place, `width` and `height` on `format_dashboard_block` (065), written in a text document's dashboard lines, and a block with none keeps the size it had; `arrange_views view:dashboard` `size` sets it and `show_format` names it; amends D-521 | M53 |
| D-528 | 2026-10-23 | A date's filter takes `yesterday`, `tomorrow`, `last N days/weeks` (today and the N−1 days before it) and `this/last/next week/month/year` beside D-472's words, on the local calendar; a date column's filter menu offers them above its ticks, written as a conversation types them, so a view saved from it stays current; the day a week starts on is the document's — `week_start` in `document_setting`, set in Settings › Calendar and by `record_units` `week_starts_on`, and Monday when unset; amends D-472 | M53 |
| D-523 | 2026-10-22 | A repository is set up by `npx emerald-mcp init`, a subcommand of the server's bin: it names or creates the document (with the development pack, as text inside the repository and as bytes outside it), writes CLAUDE.md a section between its own markers holding the start-here table and the column lines from the document, and writes the plugin's two hooks into `.claude/settings.json` only where no Emerald plugin is enabled, never over a hook it did not write; every file is compared before it is written, so a second run changes nothing | M52 |
| D-529 | 2026-11-02 | Design work runs with Impeccable, installed per person and never vendored, its per-edit hook off and its detector run once at the end of a UI unit; it reads a thin `PRODUCT.md` and `DESIGN.md` at the root that point at docs/product.md, tokens.css and the ui rule rows and repeat none of them; the UX-strategy skill set and the design-tool connector are not adopted | M54 |
| D-530 | 2026-11-02 | M54 reviews every surface — the engine's screens, the parked ledger pack's, the desktop shell's chrome, Emerald's page and its tour — against the demo documents in light and dark; each finding is an open `review_entry` row the maintainer judges; a plain breach of a live ui rule row is fixed in place except in the ledger, where it is only recorded; a last unit makes the procedure a project skill | M54 |
| D-531 | 2026-11-02 | M54's rule conflicts answered: needed text is `ink-secondary`, the ramp gains no 13px, a chip is text and a dot everywhere, a chart of several series wears category colours, the entry route replaced the detail pane, the title bar holds no primary, a command has one name in sentence case, the page and the tour keep token sets of their own, and "The database under the chat." leads everywhere | M54 |
| D-532 | 2026-11-02 | M54's faults become thirteen fix units, M54 F1-F13, before M55: shared looks first, each unit sweeping its own files; the ledger's Home, NoLedger and #/read included; a due date only where declared; a window drop onto the open format; recovery as a three-choice notice; the page's first screen leads to Get Emerald; the tour pauses; words are drafted for the maintainer to pick | M54 |
| D-533 | 2026-11-03 | M55's input view is a saved view of kind `input`: the fields it asks are its columns in their order and its defaults are its exact values (a member, a link, a number, or a date word that names one day), kept in `format_saved_view` and `views.md`; one per format may be its default, opened by Add, the list's + and quick add; it stays open after Add and lists what it added; it is in the rail, behind +, and a live block on a dashboard; a conversation makes it with `arrange_views` and uses it with `record_format_rows view:`; M54's fourteen engine-side *Entry:* findings come into M55 and the ledger's stay parked | M55 |
| D-534 | 2026-11-03 | A milestone's units run at once wherever `dispatch_plan` allows, each in its own worktree with its own demo port, by sessions or by the `Agent` tool alike, up to four; a screen is measured by `npm run probe:screens` (`window.emeraldProbe()` in a dev build, in an offscreen Electron window) rather than in the browser pane by hand; a child is handed its files and told to batch its reads; a review writes a rule-backed finding as `fault` and only a judgement as `open`; units under ten minutes that share paths go to one child, and a unit stopped for the maintainer's pick goes on in the same child; amends D-287 and D-490's one-at-a-time for the `Agent` tool | M55 |
| D-535 | 2026-11-03 | M55 U1's picks for the input view, not yet the maintainer's: a page where entry/new opens, beside the list, not a tab; fields in one wrapping row with *Adds as* in entry/new's footer bar; *Just added* with *Undo* under it; made from the format's + (*New input view*, *New view*, *New chart*) with the entry's Fields list carrying *Ask* and *Default*; *Use for Add* marks the one Add opens; the rail lists input views first under the new `input` glyph; a dashboard block's Add is secondary | M55 |
| D-540 | 2026-11-03 | A line a read refused offers Add by hand: the format's Add opens with what the line held, the read is kept for the window's life while it is away, the Add goes back to the read, and the read counts the line added by hand; a row the mapper could not read is skipped from that read only — counted as skipped in the mapper and on Read files, never written, never kept in the reader, and taken back by Put back or by a mapping that reads it | M55 |
| D-538 | 2026-11-03 | A date, a month and an amount read as the table writes them on a dashboard's blocks, a list, a rollup's table and its chart — `2026-07-27`, `2026-09`, `₪60.00` — and a rollup reads in words: its name *Landed by month*, what it counts a sentence; the declaration and every tool keep the name | M55 |
| D-539 | 2026-11-03 | A new column's type is picked from a short list in a person's words — Text · Number · Money · Date · Yes or no · Choice · Link · Computed — with *More types…* one step away under Numbers (Whole number · Exact decimal · Percentage · Quantity), Dates and times (Month · Time of day · Date and time), Several (Several choices · Several links) and Outside this document (File · Row in another document); the picked type shows its name, the stored word is its tooltip, and the declaration's word never changes; the maintainer's pick of three drafts | M55 |
| D-543 | 2026-11-03 | A newcomer's four skills are the plugin's alone, each named for what a person does — `read-a-file`, `what-looks-wrong`, `bring-in-a-plan`, `set-up-a-project` — and setting a project up is a skill of its own beside `emerald-setup`, which fires only where a session has no Emerald tools at all | M56 |
| D-536 | 2026-11-03 | An input view's default mark is a column of `format_saved_view` with a partial unique index (066), on an input view alone; a new row's defaults are one rule, `entryDefaults` — the default input view's, over the address's exact values, over a required enum's first member — read by the table's blank row, entry/new and quick add; a money or quantity default is written `12.90 ILS`; `record_format_rows view:` fills only the keys a row leaves out; `format_rows` refuses an input view; until M55 U3's form, an input view opens a new entry with its address | M55 |
| D-541 | 2026-11-03 | The project pane is a hooks module in the emerald plugin (`hosts/claude/mod/`); it reads only `start_here` and `show_format`, and because Claude Code puts a plugin's `$.mcp.call` to the person's permission check and lets no module allow its own calls, it reads unasked only where `$.tool.check` says the person's rules allow it — `npx emerald-mcp init` writes those two allow rules into the project's `.claude/settings.json` — and otherwise holds a *Read* button whose press raises the dialog; it reads from a timer, never while drawing; `npm run test:mod` runs `claude plugin test` on a copy of the plugin without its Vitest files | M56 |
| D-545 | 2026-11-03 | An entry's refusal sits at its field and says every problem at once — on the form, under each field, outlined and `aria-invalid`, the first focused; in the table's blank row, in a line under the row, each sentence in its own column — and a link left with a name no row holds keeps it, so Add names it; a date is typed as `YYYY-MM-DD` or `today`, `yesterday`, `tomorrow` in the cell and on the form alike, a text field over the platform's calendar; *a* or *an* goes by the word's sound; a placeholder is `ink-secondary` | M55 |
| D-547 | 2026-11-03 | Where Claude Code runs the plugin's hooks module, the module answers SessionStart and UserPromptSubmit itself (start_here; each new inbox row once per session, then the count) and always passes the event on with `emerald_mod_answered` added, and the two npx hook commands start through `hooks/unless-mod.mjs`, which exits on that mark — because a module that answers without `next` silences every settings hook beneath it, the person's own included; it marks only what it answered, watches the document every 5 s for the status line (`$.ui.status`) and a toast, and `init` allows `format_rows` beside the pane's two reads — the unit's pick, for the maintainer to review | M56 |
| D-549 | 2026-11-03 | The plugin's hooks module refuses two write rules at the call — an `Edit` or `Write` on any `.emd` file, and a `git commit` in a linked worktree that would carry the project document's copy — each guard refusing when it fails; `/claim <ref>` and `/land [ref]` write nothing and hand the model the call in the command's `context`, then ask for a turn; the third rule, no `commit: true` without a dry run, is dropped on the maintainer's word | M56 |
| D-550 | 2026-11-03 | A link field opens its rows on focus, in the target's order — the column its roadmap orders by, else its name with numbers read as numbers — each by its name with its entry's title beside it; a name no row has ends the list with *No milestone is called "M9"* and *+ New "M9"*, never the option Enter is on by itself; a target whose required columns its new-row defaults fill is made at once, else a form under the field asks them with the entry's own fields and refusals, Add makes and links it through `stageRows`, and Esc leaves the field as typed; an enum's members read as words in every field | M55 |
| D-552 | 2026-11-03 | Where the Claude plugin starts the server it passes `--skills`, and each how-to a plugin skill carries is one line naming the skill; every other launch keeps the full instructions byte for byte | M56 |
| D-554 | 2026-11-03 | The recordings of the project inside Claude are four clips named in `CLAUDE_RECORDINGS` (`src/demo/page/page.ts`) — the pane opening as a session starts, the same in a terminal, a note from another project arriving, a format declared with its pane filling — each a file in `fixtures/synthetic/demo/` whose poster frame is the PNG of the same name; a clip's figure, and the slot, show only once its file is named, and a test fails when a named clip or its poster is missing | M56 |
| D-556 | 2026-11-03 | An input view's form is its own route, `#/formats/:name/input/:view`, drawn by the format's screen beside its list; with no name it is a new one, a draft until Save; a view or chart made from the format's + is saved and placed on no dashboard; quick add that cannot write a row opens the default input view with what was typed; the frame draws the form read-only | M55 |
| D-557 | 2026-11-03 | An input view's dashboard block judges and writes its row as `record_format_rows` does (`stageRows`, then `insertRows`), every refusal at its field; New input view in Add a block saves the view and its block in one transaction; quick add with the view's fields writes each into its column and opens the input view when a required one is left; the conversation's dashboard text names the block as a form | M55 |
| D-558 | 2026-11-03 | A column's width is one width for the format, dragged in every table of its columns — the format's table, its saved table tab and a saved table placed on a dashboard — with one handle (`ResizeHandle.tsx`); a block wider in columns than its room scrolls inside itself; read-only, the frame included, draws the widths with no handle (amends D-432); a chart's table of months keeps no width | M55 |
| D-559 | 2026-11-03 | Keeping a pack again brings its columns' notes as D-491 brings its formats': the pack's past lists the fingerprint of every note each column had in every build (`PackPast.columns`, under the name the pack uses now), a held note in it becomes this build's, any other is the person's, kept and named; amends D-491 | M52 |
| D-560 | 2026-11-09 | A hosted MCP endpoint that keeps no document: the person's Google Drive holds one `.emd`, made by default where Emerald may see it (`drive.file`); each call reads it, runs the tool and writes it back, and a write to a file changed since it was read is refused and says so; every tool is offered, the ledger's too, with a warning; serverless on Google Cloud, in the project that holds the Drive sign-in; the code lives in this repository | M57 |
| D-561 | 2026-11-09 | The hosted endpoint launches free, with a cap and a kill criterion written before it ships; a paid plan, if one comes, is for the hosted endpoint alone, and the app and the local server stay free and offline (D-124 holds) | M57 |
| D-562 | 2026-11-09 | The Google Drive connector's settings: 200 calls a day and 5 MB per person; stopped if fewer than 5 people use it on two different days within 30 days of going public; at `mcp.getemerald.dev`; one document, `Emerald/Emerald.emd`, stored as text and starting empty; Firestore keeps five fields per Google account and nothing else; invited testers first, the clock starting at public; tools that need a file other than the document are left out; Drive's version history is the earlier copies; getemerald.dev lists it as a feature | M57 |
| D-569 | 2026-11-10 | M58's answers: when two emerald servers are registered the plugin's stays and says once how to remove the other; recording, updating, claiming and landing rows commit on the first call while deleting and changing a format's columns still dry-run first; a decision row may name the files it affects, anywhere on the machine, and the closing pass checks each; the fixes ship as emerald-mcp 0.3.1; M57 is parked on its branch | M58 |
| D-570 | 2026-11-10 | A decision's `affects` is an optional text column of the development pack, one path per line, relative to the repository or absolute anywhere on the machine, rather than a new list type; the closing pass greps each file for the claim made false and names any it cannot read, and docs:check warns on a live decision's path this machine cannot read | M58 |
| D-571 | 2026-11-10 | The plugin notices a second emerald server from its own folder's SessionStart hook (`no-server.mjs`, plain Node, no new emerald-mcp): it reads `~/.claude.json` (user and local scope), the project's `.mcp.json` unless turned off, and — only in a session the desktop app started — the app's `claude_desktop_config.json`; any entry with emerald in its name, command or arguments gets one line on how the person removes it, and nothing is ever written | M58 |
| D-572 | 2026-11-10 | The server's instructions say only what a session needs before its first call — what moved went to the answer that needs it, and how to speak of a view is the drawing tool's first line alone; the SessionStart hook opens with one sentence | M58 |
| D-573 | 2026-11-10 | Recording, updating, claiming and landing rows write on the first call; `commit: false` asks for a preview; deleting and changing a format's columns keep the dry run | M58 |
| D-574 | 2026-11-10 | What stopped the SessionStart hook in the usage report is not known, so the hook is unchanged; what it does that a security tool notices is written down, and the plugin and its message are an open question | M58 |
| D-575 | 2026-11-11 | The ledger is unparked: M59 fixes what a second person hit on first use — a file with two cards made one account per card, the provider's category and leaving a row out working on By merchant, 50 / 30 / 20 shown before it is made, a page that never scrolls into blank, Guide me never opening by itself, and a shape unit that decides what a new document shows; Hebrew is M60, after it | M59 |
| D-576 | 2026-11-11 | A ledger document made before a change keeps opening with its rows: from M59 on, a change to a ledger format or an engine table reaches an existing document as a kept pack already does (D-443) or by a migration, with a test on a document made before it; amends D-276 for documents from here on. Her statement file will not be available, so M59 U2 proves the two-card split on made-up files only | M59 |
| D-577 | 2026-11-11 | A new ledger document holds back the places it has nothing for — Year, Paychecks, Plan, Wealth, Dashboard, and in a ledger-only document Formats, Connections and Agenda — and each comes back with its first row; Home, Transactions and By merchant keep what a first-time person needs and put the rest behind Filter and More (M59 U1's picks, not yet the maintainer's) | M59 |
| D-578 | 2026-11-11 | A statement holding two cards is one account per card: a sheet is cut into sections at a repeated header or a card line, each read with its own header, a section's card column cuts it again, every sheet of a workbook with transactions is read, and the read says how many cards it found before anything is written | M59 |
| D-579 | 2026-11-11 | By merchant's queue is the rows that count: a row left out of totals leaves it, its sums and its ids; the provider's category is an action on each merchant (the editor's draft, as on Transactions) and a heading the list can be grouped by, where Create rule writes one rule for the heading and applies it to rows with no category, with one Undo | M59 |
| D-580 | 2026-11-11 | 50 / 30 / 20 is shown before it is made: every top-level category with its share, its part, what it comes to a month and why, each share changeable in place, the months named once; Make plan writes exactly that and Cancel nothing, and `start_plan` is the same proposal for a conversation | M59 |
| D-581 | 2026-11-11 | The app is a window that never scrolls, and Guide me opens only from a press: the shell is the positioned frame and the page itself cannot scroll; the new document's offer is gone, and Home's Getting started line is dismissed per document with Dismiss | M59 |
| D-582 | 2026-11-11 | A new ledger document shows what M59 U1 picked: the rail holds back each place until the document holds what it shows, Home before a read is the band and Getting started, and Transactions and By merchant put their filters behind Filter and their rarer acts behind More | M59 |
| D-583 | 2026-11-11 | The app in Hebrew: one translation layer for the whole app, Hebrew for everything a ledger document shows after M59, a full right-to-left mirror with English unchanged, the language following the computer until Settings says otherwise and kept per machine, and M59 with M60 shipped as one desktop release after the maintainer tries both | M60 |
| D-584 | 2026-11-11 | The translation layer is hand-rolled in `src/i18n/`: English the source with typed keys, Hebrew one file per area and held complete once it has one, the language the app's entry alone follows, Settings › Language a place of its own, and the shell given its words over the bridge | M60 |
| D-585 | 2026-11-11 | The Hebrew screen's words are a `screen_hebrew` column on the term rows, one word per thing in both languages; a button is a verbal noun, and a word a statement prints is the screen's word | M60 |
| D-586 | 2026-11-11 | Right to left by logical sides: every class and rule that names a side names the start or the end, a chart and a bar placed by measuring stay left to right, a key steps the way its buttons are drawn, and a figure reads as written inside Hebrew | M60 |
| D-587 | 2026-11-11 | A new ledger is seeded in the app's language and keeps it: the categories' Hebrew names sit beside `seededIds.json` under the same ids, a document's seed language is read from its own rows, and the page passes the app's language while `create_document` and `keep_packs` take `language` | M60 |
| D-588 | 2026-11-11 | The shell's words are bundled, not sent: its menu, dialogs and windows' titles are the catalogue's `shell` area, read by `electron/language.ts`, and the page sends only which language — kept in `settings.json`, the computer's until a page has said | M60 |
| D-589 | 2026-11-11 | A translated screen's words are the catalogue's, and a test that parses its files fails on one written inline; a count is a `one`/`other` pair, a sentence holding a document's value is filled with elements, a record the document keeps stays as written, and a card a Hebrew ledger makes in place is `כרטיס 1234` | M60 |
| D-590 | 2026-11-11 | The second half of the screens speaks through the layer: a sentence with a value in it is one word with placeholders drawn by `Phrase`, a word outside a render is `tNow`, a category path's arrow points the way its own words run, a menu opens from its control's start edge, and a test reads the source for typed English | M60 |
| D-595 | 2026-11-16 | One test and one name for what M60 U4 and U5 built twice: `words.test.ts` holds every translated screen, and `Phrase` is the one way to draw a sentence with things in it | M60 |
| D-591 | 2026-11-15 | `start_here` says what a milestone still owes: the milestones nothing under them holds open, and the built units rows still point at, read from views a document already declares, with no new unit state | M61 |
| D-592 | 2026-11-15 | A landing lists the unit's open review entries beside its report and accepts in the same call the ones named by the start of their `do`; nothing picks which the report proves, a child's proposal never accepts, and nothing new is written on an entry | M61 |
| D-593 | 2026-11-15 | A landing takes `follow_ups`, each a planned unit (with a brief, under Later unless it names a milestone), an open question or a review entry, written with the rest; a report that sounds owed and names none is quoted back, never refused | M61 |
| D-594 | 2026-11-16 | Offering a format is a named step of the job: the server's instructions say to offer one, unasked, when one kind of fact keeps turning up as prose, and `start_here` asks the person once where it offers to close a milestone | M61 |
| D-596 | 2026-11-17 | A form's field is sized by dragging its edge, and the width is the form's own: kept in the input view's address as `width:<column>=<px>`, the same on a dashboard's block and on the form's page, set in a conversation with `arrange_views` `widths`, and never the format's table widths | Later |
| D-597 | 2026-11-18 | A row's action is carried by the conversation that wrote the row, through the connectors that conversation already has; a row typed in the app waits, pending in the document, for the next conversation; Emerald holds no login of another service and starts no session of its own | M62 |
| D-598 | 2026-11-18 | A conversation asks once for everything waiting — these rows were added, act on them? — and deleting a row, or moving it to another state, leaves what its action made elsewhere alone | M62 |
| D-601 | 2026-11-23 | A format's rows go out as JSON: a subcommand of the server, a tool that writes only inside the document's folder, and saved exports as rows; money as exact text beside its currency, the same bytes every time | M63 |
| D-602 | 2026-11-23 | The export tool is marked a write: it reads the document and never writes it, so parity counts it a read, but it writes a file, so `readOnlyHint` is false, not destructive, idempotent | M63 |
| D-603 | 2026-11-23 | A nest is one string a person types — `keyword.card as=keywords order=position` — the same on the command line, in the tool and in a saved export's cell; its link back is read off the graph, refused when there are two, and left out of each child | M63 |
| D-604 | 2026-11-23 | Saved exports are the exports pack's one format, `export`, named by its unique `file`; a refused row is reported and the others still written, the run exiting 2, and a document with none exits 2 naming the pack | M63 |
| D-605 | 2026-11-23 | The desktop app writes a document's saved exports from Settings › Export: the page works the bytes out with the command line's own code, moved out of the plugin; the main process holds each file to the open document's folder and compares it on disk without handing its bytes to the page; and Export is offered to a document keeping the ledger or the exports pack | M63 |
| D-606 | 2026-11-25 | The UI is redesigned, not reviewed again: three working directions for the maintainer to pick one, screens built for a newcomer, density measured and budgeted, what leaves a screen kept one click behind, the ledger first and then the engine | M64 |
| D-607 | 2026-11-25 | A month counts a card purchase in the month it was bought, saved is what was put aside from that month's money, and Home opens on the last finished month | M64 |
| D-608 | 2026-11-25 | No session reads the maintainer's own documents any more: a synthetic year stands in, the session picks the design direction, his one look is the real Home in the app, and an Impeccable finish review checks taste in his place | M64 |
| D-609 | 2026-11-25 | How D-607 is built: one basis file every month's figure reads, a card holds a month open until its next statement is read, saved never above a positive left over, and what stays on the charge date | M64 |
| D-611 | 2026-11-25 | The synthetic year is made at build time, ending in the build's own month, its statements written per month from one JSON source and read through the ledger's own import; the specimen page opens in the dev and demo builds only, its panes themed by a class | M64 |
| D-612 | 2026-11-25 | Density is read off one snapshot of `main` by tested arithmetic: a block is a heading-led section, a table, a chart, a list of three rows or a `data-block`, a figure is the secondary-number step or a `data-figure`, a budget is a maximum per route; `--shots` paints each screen at its whole length into `.probe/shots/` beside one contact sheet, and the inventory is `docs/redesign/screens.md` | M64 |
| D-613 | 2026-11-25 | A card statement's printed total is compared with its rows' signed sum, charges less refunds, and every row's magnitude stays only as the second reading | M64 |
| D-614 | 2026-11-25 | Home and the rail take direction A, the report: the month said as one sentence with left over its one figure, a typographic rail, detail in a side panel; with B's month strip as the pager and C's waiting list and palette; the flows leave Home's figures and Plex gains a light weight for the hero | M64 |
| D-615 | 2026-11-25 | The report becomes the design language: A's tokens and two type steps, Plex in four weights, a rail of words whose sections' views are their tab strip, a kit of eight displays chosen by the shape of the data, a side panel and a waiting list, six ui rules rewritten and four added, and a density budget whose exempt list only shrinks | M64 |
| D-616 | 2026-11-25 | Home is rebuilt as the report: the month in one sentence, left over its one figure, what waits one strip below it, four tiles that open their breakdowns beside the page, the fourteen months as the pager, and where it went beside the plan; All months and the by-month chart are the Year screen's, and a redesign-screen skill every later screen follows | M64 |
| D-617 | 2026-11-25 | Where a screen's interactions open: reading more in the side panel, one value in place, a form of several fields in the same panel, a job of several steps on a page of its own with one way back, a choice in a popover, and a dialog only to confirm what cannot be undone | M64 |
| D-618 | 2026-11-25 | Transactions is rebuilt as the report: each tab answers first in one sentence, its views are one tab strip, a row, a rule from a fix and what is left out open beside the rows, a selection acts from the table's own header row, and what was just done keeps its place with its Undo | M64 |
| D-619 | 2026-11-25 | Reading files is the report: the batch said first in one sentence, Write in the list's own header row, a statement's gap beside the list rather than on a page, a removal undone where it was, a reader's delete asked at its button, the mapper's one way back at its head, and Readers one translated list | M64 |
| D-620 | 2026-11-25 | Paychecks is rebuilt as the report: the month's paycheck in one sentence, net pay its one figure, the gross divided into taxes, funds, the rest and the net, each opening its lines beside the page (taxes by deduction type, month and year so far), what waits one strip below, net by month as the pager and every paycheck in a table; Deduction types reads as a table whose rows open their form beside it; a delete deletes at once with Undo where it happened, and the slip's form stays a page of its own | M64 |
| D-621 | 2026-11-25 | Plan is rebuilt as the report: net pay and what the bills take first said as one sentence with whether every shekel has a job, to split its one figure, what waits one strip below it, the split's bar with each bucket held against a month, and the bills one row each with its one choice in place; a bucket, a bill, net pay, the cushion and the plan's months open beside the page | M64 |
| D-622 | 2026-11-26 | Wealth is rebuilt as the report: net worth, funds, goals and debts each answer in one sentence with one display figure and the kit's display for their shape, what waits one list below, then one table whose rows open beside the page; fee impact, the deposit check, a net worth row and the goals' projection move into the side panel, and a removal asks in the row's own menu where no undo is honest | M64 |
| D-623 | 2026-11-26 | Categories, Rules and the Year are rebuilt as the report: each answers its question in a sentence first; the Year is where every month is read and opened (a month opens on Home); a category, a rule, a total and the built-in rules open beside the page; a rename is in place; merging and a delete that moves rows ask at their button; deleting an unused category or a rule and archiving happen at once with Undo where it happened | M64 |
| D-624 | 2026-11-26 | The way in and around is the report: every Settings page and Assistants answer first in one sentence on a shared frame, Accounts reads as rows that open their form beside the page with a delete asked at its button, Assistants' tools open by group beside it, the front door and a document with no ledger say what to do in words with Open… added, the guide's first step names Read files and leaves its note where it stood, the waiting notice speaks only of what changes the month, and the palette says what it can do offline | M64 |
| D-625 | 2026-11-26 | The engine's formats are the report: the formats list and a format's table each answer first in one sentence (how many kinds of things, how many rows and whether they are right), what waits is one strip below, the shape, a rule set's preview and a new view or chart open beside the rows, and a row deletes at once with Undo near it (the next entry opening after a delete from its entry) while a format's delete, which cannot be undone, asks at its button | M64 |
| D-626 | 2026-11-26 | The engine's views are the report: the board, the list, the roadmap, ready, the agenda, the dashboards and the connections each answer their question first in one sentence at the lede step under the title; a card moves at once with Undo in the bar above the lanes, a dashboard's block is removed at once with Undo, and a connection opens as a form in the side panel beside the graph instead of a band across its foot | M64 |
| D-627 | 2026-11-26 | An entry and an input view read as a form: every writable field wears a hairline under it at rest, Add sits under the fields, the list's + is the one way into a new entry, an input view's Fields is a form in the side panel, the table's filter is a funnel beside a boxed search, and the formats screens say every word through the catalogue, in English and Hebrew | M64 |
| D-628 | 2026-11-26 | Undo of a delete on Rules and Categories brings the thing back whole — its id, its place, its count, its colour, the built-in rules that went with it and the rows that named it — through the create that makes one, handed what the delete took, over an engine pair that reads a row before it goes and puts it back; the rule editor, the test box, re-applying and New category choose with ChoiceField and still take a paste | M64 |
| D-629 | 2026-11-26 | Wealth's forms open beside the page and ask the few fields a person types first: the balance and its date for a fund's reading, said back in words against the last reading as it is typed, with the rest of the report one verb further and grown in place; the fund, goal, movement, debt and payment forms take the same shape (`PanelForm`), and the details take the report's ink and ramp | M64 |
| D-630 | 2026-11-26 | The kit catches up with the screens: a small button is the 32px chrome row on the body step, a choice wears a chevron and is never the platform's select, a value-shaped `ValueChoice` replaces Rules' `PickField`, the side panel's first Esc leaves a field and focus returns to the latest opener, a figure keeps its sign in Hebrew, the waiting notice is never filled; and a paycheck by hand is a `PanelForm` in Paychecks' side panel — month, employer, gross and net first, whether it adds up said in words, the slip's lines only if wanted | M64 |
| D-631 | 2026-11-26 | Plan has a Year beside its month, as Home has: each bucket's year is the sum of its months — what each month's plan gave it against what it got, January through the last month that is over, on the plan each month is on and Home's month basis — said first in words with the categories apart from the goals and debts, each bucket a meter whose months open beside the page, a month nobody could measure left out of both sums, and `plan_month` with a `year` answering the same; Plan's bar runs from the inline start, so in Hebrew it mirrors with its drag and arrow keys while the ring stays a clock | M64 |
| D-632 | 2026-11-26 | The engine's other views keep the format's one Add and one strip of controls, and say every word through the catalogue: Roadmap and Ready to start carry the table's Add behind the same refusal; the board's Lanes by, the roadmap's fold filters, In the order of, Columns and Fold all, and the ready list's Columns sit in one strip of the same classes under the tabs; a line or card left at its view's columns drops a state its group already says and a link its name already says; and a sentence the engine builds for a screen is a key and its parts, said by the screen | M64 |
| D-633 | 2026-11-26 | A figure that sums a period up carries its sign's colour — Home's left over and its sentence's two amounts, the Year's left over, Plan's to split, net worth, and a statement's gap in `negative` unless it is nothing — while every other figure stays ink; a list cut short grows in place and never opens the side panel; a plan's meter past its plan draws the plan as a tick and says the share in words; and the probe lays every line out afresh after stretching a page for its picture | M64 |
| D-634 | 2026-11-26 | A rule made outside Rules is made where it was asked for — Transactions and By merchant open Rules' whole editor in their side panel, save it there, and the note says it was made with Undo and *Open in Rules*, which opens that rule in its editor; the platform selects left outside the kit become `ValueChoice`; and a new paycheck opens on the month after the newest slip when last month already has one | M64 |
| D-636 | 2026-11-26 | A file is read through a door named for its kind and drawn with its glyph: Home's header carries *Read bank and card statements* (filled) with *Read paychecks* beside it — one button per kind, not one *Read files* that asks the kind; a fund report is read from its fund as *Read a fund report*; the palette names all three; a waiting line opens its own kind's reader; and a file picked or dropped anywhere is still read as what it is | M64 |
| D-637 | 2026-11-26 | A sentence the engine builds whose parts are sentences of their own is a `Spoken` — a key and parts that may be `Spoken` too — whose English the engine renders from a table the catalogue's English must equal; a helper in `src/ui/formats/` takes a `t` that defaults to English instead; and a sentence says a format by its title in Hebrew, never by an English plural | M64 |
| D-639 | 2026-11-26 | Wealth's details spend only the list's seven type steps — a label is a caption, a figure that does not answer its section is the heading step, the one that does is the kit's tile step — and one primary: the fund detail's Add reading is secondary beside the list's; a detail route is budgeted by `:id`, whichever row it opens; a wealth tag is text and a dot; and a holding reading's refusal is a code and its parts, said by the screen | M64 |
| D-640 | 2026-11-26 | A debt's payoff month is one calculation, `payoffMonth` in `src/domain/debt.ts`, which the debt's detail and the Debts list both read: the payments still to make start in the month after the newest one already recorded, or this month while this month's has not landed | M64 |
| D-642 | 2026-11-26 | Every route is inside its density budget and none is exempt: the last, reading files onto a format, is redesigned with its question as its title and choosing files as its action, and its ceiling counts the two pickers the old measure missed; a question asked where its button was behaves as a popover (`useAskHere`); the page's pictures of the ledger are retaken on the redesigned screens | M64 |
| D-645 | 2026-11-26 | Closing a goal that still holds money asks, at its Close, whether the money was spent: spent, `closeGoal` records the withdrawal of what it holds in each holding (a typed money-out row whose why is *spent on the goal*) and closes it in one write, undoable; not spent, it closes and the money stays held; a goal's panel takes money out beside money in; `close_goals` is the conversation's half | M64 |
| D-475 | 2026-10-14 | Finding an entry, three ways, each landing on the one entry view: a format in the rail is a folder that opens to its first twelve entries in its own order, with a filter line and *All n*; the entry at `entry/:id` keeps the list of its format beside it, the pager made visible, walked with the arrow keys and holding the address's search; and the palette finds entries by name first, then by any column, through `searchDocument` (driver's picks, not yet the maintainer's) | M37 |
| D-379 | 2026-10-05 | The ledger reads the figures its formats declare — a debt's balance, a goal's totals, a payslip's unexplained and saved, a fund's latest — and a reading's price check is an identity | M36 |
| D-359 | 2026-10-04 | A broker statement is read by the conversation and written in one batch: each row keyed by its value date, amount and the printed balance after it, the balances checked row by row, and the holdings table as readings | M30 |
| D-318 | 2026-10-02 | A loan payment is spent, not moved: DEBT_PAYMENT leaves MOVED_KINDS, and its categories sit under Spending | M28 |
| D-317 | 2026-10-02 | A salary comes in once: the slip is the figure, the deposit that paid it proves it, and a gap is shown, never picked | M28 |
| D-316 | 2026-10-02 | A category on the Money moved tab is moved, not spent: inside saved, out of went out, and Home lists it | M28 |

---

## Open milestones

The entries of the milestones that are not closed, in number order — whichever milestone each is
(its `decision` row says). A closed milestone's entries leave this file; the index above names
its milestone, and its `decision` rows are the record. M19's, M20's and those of the eleven
milestones closed after M27 (with D-307, M27's own) left together on 2026-10-08 (M43 U5),
thirteen closures late: the step was remembered by hand and was not.
**Now `npm run docs:check` fails while a closed milestone has an entry here**, and
`node scripts/archive-decisions.mjs` is the fix — it moves the entries, repoints their index rows and
rewrites every link to them.

## D-560 · 2026-11-09 · A hosted MCP endpoint that keeps no document: the person's Google Drive holds one `.emd`, made by default where Emerald may see it (`drive.file`); each call reads it, runs the tool and writes it back, and a write to a file changed since it was read is refused and says so; every tool is offered, the ledger's too, with a warning; serverless on Google Cloud, in the project that holds the Drive sign-in; the code lives in this repository <a id="d-560"></a>

**Context.** Today Emerald reaches a conversation only where the host starts a local server: the
desktop app, Claude Code, local Cowork. A chat on the web or on a phone adds only a remote server
by its address, and cloud Cowork starts no plugin server at all (D-508). *The database under the
chat* (D-531) holds only where the chat is. Asked how a hosted Emerald could keep the local-first
promise, the maintainer chose (2026-11-09) the person's own cloud storage over a store of ours.

**Decision.**

- **The endpoint keeps nothing.** The document is a file in the person's Google Drive; a call
  downloads it, runs the same tool the local server runs, and uploads it when the tool wrote. There
  is no user table and no stored document; the token the host holds can be Google's own, encrypted.
- **One document, made by default** on first use. Emerald asks for `drive.file`, so it sees only
  the files it made or the person opened with it, never the rest of their Drive.
- **A changed file refuses the write and says so** — the upload is conditional on the revision it
  read; nothing merges and nothing retries.
- **Every tool is offered, the ledger pack's too.** What goes in is the person's choice; they are
  warned that the document now lives in their Drive and passes through the endpoint.
- **Serverless on Google Cloud** (Cloud Run functions, Firebase's included), in the same Google
  Cloud project as the Drive sign-in's OAuth client — the cheapest that fits, and the platform the
  maintainer knows.
- **The code lives in this repository** (the driver's recommendation, asked): it is the engine and
  the plugin's tool layer behind another transport, so it shares their tests, the parity rule and
  the AGPL. It is its own build, beside `build:plugin`.

**Rejected.** *A store of ours behind accounts* — data custody, backups and breach risk for a sole
maintainer, and the file stops being the person's. *A stateless endpoint the file travels to and
from on every call* — in a chat the model is the only carrier, `docs/memory.emd` is 2.2 MB, and it
puts the whole document through the conversation, the opposite of asking for rows. *A secret-address
store* — a leaked address is a leaked document. *Emerald as a skill in the chat's sandbox* — no
document survives the conversation.

**Consequences.** The same file syncs to the person's computer through Drive's own client, so the
desktop app and a phone chat work in one document with no sync of ours; two writers at once meet
the refused write above. The offline rule (D-124) stays the app's and the local server's: this is a
separate build, and the plugin's no-network test does not cover it. `PRIVACY.md` gains the
endpoint before Google's app review, which asks for a privacy policy and a homepage on the domain.
Tools that take `path` take a document named in the person's Drive instead.

## D-561 · 2026-11-09 · The hosted endpoint launches free, with a cap and a kill criterion written before it ships; a paid plan, if one comes, is for the hosted endpoint alone, and the app and the local server stay free and offline (D-124 holds) <a id="d-561"></a>

**Context.** The *Monetization* question (opened by D-238) rejected a hosted model because it
reintroduces a backend and data custody. D-560's endpoint keeps no document, so the objection does
not reach it. The maintainer pointed at a personal-sync subscription as the shape.

**Decision.** The endpoint ships free, capped, with its kill criterion written down before launch,
as M33 U9 does for a listing. If people use it, a paid plan for the endpoint follows — a reach
people pay for (the web chat, a phone, other assistants), and later shared documents for a team.
The desktop app and the local MCP server stay free and make no network call; D-124 is unchanged.

**Rejected.** Billing at launch — payments, VAT and support before anyone has shown they want it.
Per-call pricing — a price on every question works against asking instead of reading.

**Consequences.** The cap and the kill criterion are the maintainer's numbers to set before the
endpoint ships (D-562 sets them). Selling it later wants a merchant-of-record payment service for VAT.

## D-562 · 2026-11-09 · The Google Drive connector's settings: 200 calls a day and 5 MB per person; stopped if fewer than 5 people use it on two different days within 30 days of going public; at `mcp.getemerald.dev`; one document, `Emerald/Emerald.emd`, stored as text and starting empty; Firestore keeps five fields per Google account and nothing else; invited testers first, the clock starting at public; tools that need a file other than the document are left out; Drive's version history is the earlier copies; getemerald.dev lists it as a feature <a id="d-562"></a>

**Context.** D-560 and D-561 left M57's numbers and edges to the maintainer, listed before any brief
(the rule on planning a milestone). He answered them on 2026-11-09, and named the feature: the
**Google Drive connector**, a feature beside the app and the local plugin.

**Decision.**

- **Cap:** 200 calls a day and a 5 MB document per person; a call over it is refused, saying when
  it resets.
- **Kill criterion:** the connector is stopped if fewer than 5 people use it on two different days
  within 30 days of going public. It counts use, not curiosity.
- **Address:** `mcp.getemerald.dev`, a subdomain mapped to Google Cloud; the site stays where it is.
- **The document:** a folder `Emerald` holding `Emerald.emd`, stored as text so Drive previews it,
  starting empty with packs added when asked.
- **What is kept:** in Firestore, per Google account, a one-way hash of the account id, today's
  date, calls today, the first day used and whether it was used on a later day. Never a call, its
  arguments, a tool name, a file name or anything from the document.
- **Before Google's review:** testing mode, up to 100 accounts the maintainer invites; the 30 days
  start when it goes public.
- **Tools that need another file** — a statement, a folder of notes, another `.emd`,
  `store_document_as`, `keep_copy`, `create_document` — are not offered: the connector works on the
  one document. This narrows D-560's *every tool*, which was about the packs, not about files.
- **Earlier copies:** Drive's own version history; the connector adds none.
- **How people hear of it:** getemerald.dev lists the Google Drive connector with its address. The
  plugin does not change.

**Rejected.** A higher cap or none (a runaway loop costs the free tier); a sign-in count as the kill
criterion (curiosity, not use); `getemerald.dev/mcp` (the whole site would move to Google Cloud);
storing the document as bytes (Drive could not preview it); counting from request logs (a per-day
cap read from logs is slow and loose); taking a file's text in the call (more to build first).

**Consequences.** PRIVACY.md lists the five fields word for word, and how to have them deleted is
asked when M57 U5 is taken. The connector's instructions and tool list differ from the local
server's, and a test holds the line between them (M57 U2).

## D-596 · 2026-11-17 · A form's field is sized by dragging its edge, and the width is the form's own: kept in the input view's address as `width:<column>=<px>`, the same on a dashboard's block and on the form's page, set in a conversation with `arrange_views` `widths`, and never the format's table widths <a id="d-596"></a>

**Context.** The maintainer, on his own dashboard (2026-11-17): he wanted a field of an input
view's block wider or narrower and could not. A form drew every field at a fixed size by its type —
on the block 160 or 240 pixels, on the page 176 or 288 — while a table's columns, on the format's
table and on a dashboard's saved table alike, have been dragged since M55 F1 (D-558).

**Decision.** (Later U-input-widths. Whose width it is, the maintainer's choice, asked in plain
words; the rest the session's.)

1. **The form's own width** (his pick, over *the same width as the table*): a field's width belongs
   to the input view and is the same pixels wherever the view is drawn — its dashboard block and its
   own page. The format's table widths (`format_column_view`, D-289, D-558) are untouched either way.
2. **Kept in the view's address**, `?columns:charge=merchant,amount&width:merchant=320`, beside the
   fields and defaults it already holds (D-536): no migration, a text document's `views.md` part
   carries it unchanged, and a rename or delete takes it along. Whole pixels inside the table's own
   bounds (`boundedWidth`, 48 to 1200), and only for a field it asks — one no longer asked loses its
   width when the view is next written. Absent is the type's size, as before.
3. **On screen, the table's handle**: `ResizeHandle` on each field's trailing edge, on the block and
   the page — drag, arrows by 16, double-click or Delete back to the type's. A one-column block
   stacks its fields to fill it, and draws no handle. A width dragged never clears what is typed.
4. **In a conversation**, `arrange_views view:saved kind:input` takes `widths: {column: px | null}`;
   a width for a field not asked is refused, and `widths` on a shown view goes with an input view.

**Rejected.** One width per column shared with the table (his call: a form and a table want
different widths); a width per dashboard block (one form on two dashboards is rare, and the page
would not show it); a new table for widths (a migration and a document change for what one address
key holds).

**Consequences.** `InputShape` carries `widths`; `addressView` reads `width:` keys and
`canonicalAddress` keeps them, so a shown view's address would keep one too, unread.

## D-597 · 2026-11-18 · A row's action is carried by the conversation that wrote the row, through the connectors that conversation already has; a row typed in the app waits, pending in the document, for the next conversation; Emerald holds no login of another service and starts no session of its own <a id="d-597"></a>

**Context.** M62 (planned the same day): a format declares an action, a call to a tool on another
MCP server with its inputs filled from the row, and the result kept back in the row. Who makes the
call was M62 #1. Four carriers were weighed in conversation with the maintainer: Emerald as an MCP
client signing in to each server itself; a fresh session started per row; a scheduled sweep; and the
conversation already open. Checked the same day: claude.ai connectors load only inside Claude
sessions on the person's own account, and their sign-ins are not lent to another app; one large
provider's official calendar MCP server accepts only sign-in clients registered with that provider
as agentic, so a direct call means setup per provider; and the Agent SDK's overview says that, unless previously approved,
Anthropic does not allow third-party developers to offer claude.ai login or rate limits in their
products. One real working environment, asked the same question, found almost every sign-in held
inside the assistant and preferred to carry actions itself.

**Decision.** (M62 #1 and #5, the maintainer's choice.)

1. **The conversation that writes the row carries its action.** A write that makes an action due
   answers with it: the tool, and the inputs Emerald filled from the row. The conversation calls
   the tool through its own connector, unchanged, and reports the result back. The model chooses no
   value (D-132); it delivers what the document filled.
2. **A row typed in the app waits.** Its entry stays pending in the document, and the next
   conversation that opens the document is told what is waiting and carries it. Nothing is lost
   and nothing runs in the background.
3. **Emerald holds no other service's sign-in and starts no session.** No code specific to a
   provider, no API key for the person to make, and nothing run on a person's subscription without
   Anthropic's approval. Asking for that approval is a later choice, if app-typed rows waiting for a
   chat proves too slow.

**Rejected.** Emerald signing in to each server itself (generic code, but every provider needs its
own registration and review, which is the specific-code-per-service the maintainer does not want);
a session per row (tokens on every row, and the sign-in it needs is the one the Agent SDK note
rules out without approval); a scheduled sweep (the same sign-in, and not smooth).

**Consequences.** The queue is still written with the row, as the record and the retry for rows
nobody carried yet; it is plumbing the person never manages. M62 #4 (where waiting and failed
actions show) now includes the line a conversation opens with. M62 #7 keeps one door open: a
server that runs on the person's own machine needs no sign-in, so Emerald could call it itself.

## D-598 · 2026-11-18 · A conversation asks once for everything waiting — these rows were added, act on them? — and deleting a row, or moving it to another state, leaves what its action made elsewhere alone <a id="d-598"></a>

**Context.** M62 #2 asked whether every action asks before it does anything outside the document,
and whether one yes covers several; M62 #3 asked what happens to what an action made (an event, a
ticket) when its row is deleted or moves to a state like dropped. Both the maintainer's, answered
the same day as D-597.

**Decision.** (The maintainer's words: "ask in bulk, x was added, should we act on it"; and for
deletes, "nothing".)

1. **One question for everything waiting.** When a write makes actions due, or a conversation
   opens to actions waiting, the conversation asks once, naming them — *Shakshuka, Lentil soup and
   Salad were added: put them on the calendar?* — and one yes carries them all. A no leaves them
   waiting; it does not drop them.
2. **A delete does nothing elsewhere.** Deleting a row, or moving it to any state, leaves what its
   action made where it is. No undo, and no on-delete trigger in the declaration.

**Rejected.** A question per row (the bulk is the point: a week of meals is one decision); actions
declared to go without asking (one question is cheap, and nothing leaves the document unseen);
undoing on delete, or a per-action choice (more to declare, and an event removed by accident is
worse than one left behind).

**Consequences.** M62 U1, the spike, asks in bulk and never touches the calendar on a delete;
its document and calendar were the maintainer's picks too (a new meals document of his own, a
calendar of its own).
Replacing on change (a tool with no update) is unaffected: a changed row is not a deleted one.

## D-601 · 2026-11-23 · A format's rows go out as JSON: a subcommand of the server, a tool that writes only inside the document's folder, and saved exports as rows; money as exact text beside its currency, the same bytes every time <a id="d-601"></a>

**Context.** D-285 named an export as the way out of a document, and none was built. A project
that keeps its data in a `.emd` needed the rows as JSON for its build and a stale-data check, and
the only way out without a model was its own script reading the SQLite tables, which would not
have read a document stored as text. Its list, in order of value: a headless command, the same
filters as `format_rows`, plain values, child rows folded in, the same bytes every time, a
`--check`, saved exports in the document, and the same as a tool.

**Decision.** The maintainer's picks:

1. **Money and quantity as exact text**, `"12.90"`, beside their own `<column>_currency` and
   `<column>_unit` keys: the shape `record_format_rows` takes, so an export reads back in.
2. **Saved exports are rows** of a format the document declares, seen and edited in the app like
   any table, and written from the command line, a conversation and an app button.
3. **The tool writes only inside the document's folder** and the folders under it; the command
   line writes wherever it is told.
4. **M63 goes before M62.**

The planning session's picks, not yet the maintainer's: `export` is a subcommand of the one server
file beside `init` and `watch`; a file is a JSON array of objects with keys in declaration order,
empty columns left out, two-space indent, LF and a trailing newline, rows in the asked order with
ties broken by the label column and then the id; no ids unless asked; a link is its row's label;
`links` and `enums` are arrays in stored order; a percent is a fraction written from its digits,
never through a float; `--check` writes nothing and exits 1 when a file differs or is missing; a
saved export's file outside the document's folder is refused, so a document someone sends cannot
make the command write elsewhere; the app's button is on Settings › Export, desktop shell only.

**Rejected.** A number for money (D-003); minor units (a reader has to know to divide); a tool that
writes anywhere; saved exports kept in each format's declaration.

**Consequences.** M63's four units: one format to a file (U1), child rows folded in (U2), saved
exports as a pack's rows (U3), the app's button (U4).

## D-602 · 2026-11-23 · The export tool is marked a write: it reads the document and never writes it, so parity counts it a read, but it writes a file, so `readOnlyHint` is false, not destructive, idempotent <a id="d-602"></a>

**Context.** M63 U1's brief called `export_format_rows` read-only, since it only reads the document
and gives the engine no write (D-227). But `readOnlyHint` is what a client shows a person before it
approves a call, and `annotations.test.ts` defines it as *the call never writes*; this one puts a file
on disk, and overwrites one already there.

**Decision.** Its hints say it writes: `readOnlyHint: false`, `destructiveHint: false` (it replaces
only the bytes of the export it is asked for, inside the document's folder — D-601), `idempotentHint:
true` (the same call twice leaves the same file, and the second writes nothing). The catalog says
*writes*. Parity is untouched: it reaches no engine write, so no capability row is owed.

**Rejected.** `readOnlyHint: true` — a client could run it unasked and a file would appear; a
destructive mark — it can only replace a file in the document's own folder with rows of that
document, which a person asked for by name.

**Consequences.** `server.test.ts`'s list of reads leaves it out; the engine-only definitions budget
is 60k.

## D-603 · 2026-11-23 · A nest is one string a person types — `keyword.card as=keywords order=position` — the same on the command line, in the tool and in a saved export's cell; its link back is read off the graph, refused when there are two, and left out of each child <a id="d-603"></a>

**Context.** M63 U2 folds a child format's rows into each exported row. The command line needs a way
to give a nest's key, order and columns, and U3 keeps saved exports as rows whose nests column holds
one nest per line — so whatever the command line takes has to be something a person types in one cell.

**Decision.** One string per nest: the child format, or `child.link` to say which link, then any of
`as=<key>`, `order=<column>`, `descending` and `columns=a,b`, separated by spaces (`parseNest` in
`src/plugin/exportCommand.ts`). `--nest` takes it, repeatable; the tool's `nest` takes an array of
`{format, as, order, descending, columns}` objects or of the same strings. The link back is
`linksBack` over `connections.ts`' `edgesOf`, so a `links` column counts and a dangling one does not;
two links to the parent's format are refused naming both as `child.link`. The link back is left out of
each child, and naming it in `columns` is refused. Children take the parent's `--ids`; an `as` the
parent's objects already have is refused; a row with none has `[]`. One level: `nest=`, a `nest` key or
`a.b.c` is refused with a sentence.

**Rejected.** Separate `--nest-as`, `--nest-order`, `--nest-columns` flags — they pair by position
with the `--nest` before them, and a saved export's cell could not hold them; JSON in the flag — not
something a person types; a child filter (`match`) — not asked for, and a second export with its own
match does it.

**Consequences.** U3's nests column is these strings, one per line, read by `parseNest`. The line an
export prints says `2 rows of card, with 3 rows of keyword folded in`.

## D-604 · 2026-11-23 · Saved exports are the exports pack's one format, `export`, named by its unique `file`; a refused row is reported and the others still written, the run exiting 2, and a document with none exits 2 naming the pack <a id="d-604"></a>

**Context.** D-601 made saved exports rows of a format the document declares, written from the
command line, a conversation and the app. M63 U3 builds the pack and `export <document.emd>` without
`--format`; what the format is called, what a row holds and what a run says when some rows fail were
the building session's to pick.

**Decision.** A third pack, `exports` (`src/data/packs/exports/`), of one format, `export`: `file`
(required, unique, its label), `format`, `columns`, `order`, `descending` (yes/no), `match`, `nests`,
`note`. `columns`, `match` and `nests` hold one entry per line; a `match` line is `column: value`, two
lines on one column are either, an empty value matches an empty cell; a `nests` line is D-603's string.
A document keeps the pack when it declares `export` in a shape that does not clash with it, so a
person's own `export` is never read as saved exports. Keeping a pack of declared formats is one
function now, `installDeclared` (`src/data/packs/declared.ts`), which the development pack calls too.
The rows are read into asks in `src/data/packs/exports/saved.ts`, which imports no Node, and
`ExportAsk`, `NestAsk` and `parseNest` move from `src/plugin/exportCommand.ts` to
`src/domain/format/export.ts`, so the app's button (U4) reads a saved export the way the command line
does. A run writes, or checks, every row by file: a file outside the document's folder, a format or
column the document has not got, or a `match` or `nests` line that cannot be read is reported on
stderr naming its file, the others carry on, and the run exits 2; else `--check` exits 1 when any file
is stale or missing; else 0. A document with no saved exports — no `export` format, or no rows — is
told so in a sentence naming the pack, and exits 2, so a build asking for its exports never passes on
nothing. The flags of one export (`--to`, `--match` and the rest) without `--format` are refused.

**Rejected.** A direction enum for the order (`descending` mirrors the flag and the tool); a `search`,
`link` or `ids` column — not asked for, and a column added later is one more optional column the pack
completes; exit 0 when a document has none — a CI `--check` would pass while checking nothing;
skipping a row whose format is gone — D-601 says reported, never skipped.

**Consequences.** `keep_packs` and `create_document` take `exports`, and the Packs screen shows a third
pack. U4 lists `savedExports(db)` on Settings › Export and writes them.

## D-605 · 2026-11-23 · The desktop app writes a document's saved exports from Settings › Export: the page works the bytes out with the command line's own code, moved out of the plugin; the main process holds each file to the open document's folder and compares it on disk without handing its bytes to the page; and Export is offered to a document keeping the ledger or the exports pack <a id="d-605"></a>

**Context.** D-601 put the app's button on Settings › Export, desktop shell only, and M63 U4 builds
it. Three things were the building session's to pick: where the code that turns a saved row into
bytes lives once the renderer needs it, what crosses the bridge, and how a document that keeps saved
exports but no ledger reaches a screen the rail offered only to the ledger.

**Decision.**

- **One piece of code works an export out, in `src/data/export/formatExport.ts`** — `exportRows`,
  `savedExportTexts`, and `format_rows`' `chosenColumns` and filter refusal with them — moved out of
  `src/plugin/exportCommand.ts` and `tools/formats.ts`, never copied. It takes a database and an
  `ExportContext` (the day, and the plugin's own `resolve`, whose refusals tell a model what to
  call); the plugin keeps what needs Node. `ToolInputError` moved to `src/core/inputError.ts`, which
  that code throws from the renderer too; `tools/tool.ts` re-exports it.
- **The bridge carries bytes one way.** `exports.check(path, files)` and `exports.write(path, files)`
  send each file as the row names it with the text the page worked out; the main process
  (`electron/exportFiles.ts`) answers with a word per file — current, differs, missing, written,
  refused — and never hands a file's contents to the page.
- **Held in the main process**: the path must be granted and be the document this window watches,
  and every file goes through `inDocumentFolder`, the plugin's `withinFolder` moved into `bridge.ts`
  with Node's `path` handed in (as `writeAtomically` takes its disk), so the command line, the tool
  and the shell hold a file to one rule and the shell still reaches into `src/` only for its words
  (D-588).
- **Export stays the engine's place and is offered to a document keeping either pack** (`anyOf` on
  its rail entry): no ledger guard in front of it, the months' and transactions' CSV drawn only where
  a ledger is kept, the saved exports only in the shell. A document with changes not saved yet is
  exported from what is open and the section says so; one never saved says to save it first.

**Rejected.** A bridge call that reads a file into the page (it would learn what else is on disk); a
second copy of the folder check in `electron/`, or the shell importing it from `src/` (D-588); Export offered to every document (a document keeping
neither pack would get a place holding only Save as, not asked for); the plugin's `resolve` moved to
`data/` (its sentences are a model's instructions).

**Consequences.** The term `Export` is the app's. A shell older than M63 U4 has no `exports` on its
bridge, and the page draws no section, as in a browser tab.

## D-606 · 2026-11-25 · The UI is redesigned, not reviewed again: three working directions for the maintainer to pick one, screens built for a newcomer, density measured and budgeted, what leaves a screen kept one click behind, the ledger first and then the engine <a id="d-606"></a>

**Context.** The maintainer, 2026-11-25: every screen is dense and hard to follow, the ledger is
really hard to use, the engine needs the same treatment though it is in better shape, and he has
little time to give input. Budgets alone are not enough; he wants the look and feel improved in a
major way. Checked the same day: the build has 73 `ui` rule rows, `design-review` and
`probe:screens`, and every one of them is about how a screen *looks*. Nothing checks how much a
screen holds or whether a newcomer can tell what it is for. M54 reviewed every surface against
those rules, fixed what broke them, and recorded the ledger's findings without acting on them.
Meanwhile every unit added the block it was asked for (Home's code cites a request for nearly
every one of its twelve blocks), and nothing ever took one away.

**Decision.** M64, a redesign.

- **What each screen is for comes first** (U2): an inventory of every route, with the one
  question it answers, the jobs someone comes to it to do and the blocks it shows, and density
  measures added to `probe:screens`.
- **Three directions, built to click through** (U3): Impeccable's redesign path, where the old
  look is evidence and not the rule. They differ in feel as well as look. **The maintainer picks
  one (STOP)**; his input is that pick and judging finished screens, never a brief and no
  sign-off between units.
- **The pick becomes the design language** (U4): DESIGN.md, the tokens, the shared components,
  `ui` rule rows that replace the ones it overrides, and a density budget per route that
  `probe:screens --budget` fails on. The list of routes exempt from it only shrinks.
- **Home first, and the skill from it** (U5): `redesign-screen` is written from the first rebuilt
  screen. Then one screen or group per unit, ledger first (U6-U12), then the engine (U13-U14),
  then the tour and the page (U15).
- **For a newcomer** (the second person of M59). **A block leaving a screen moves one click behind
  what it explains**, and the conversation still reaches it. The figures stay the domain's, except
  the month (U1): card spending, saved and the month Home opens on, asked of the maintainer first.

**Rejected.** A skill alone: nothing walks the screens, and density comes back. Another review
against the current rules: M54 did that. Budgets alone: he asked for a major change of look and
feel.

**Consequences.** Rule rows retired by U4 point at its decision. `design-review` stays as the
compliance pass after a screen is rebuilt.

## D-607 · 2026-11-25 · A month counts a card purchase in the month it was bought, saved is what was put aside from that month's money, and Home opens on the last finished month <a id="d-607"></a>

**Context.** M64 U1. The arithmetic was right, but three rules made a month read wrong. A card row
counted in the month its bill was charged (D-006), so a month showed the previous month's card
purchases beside its own rent and payslip. Saved held money that never came in that month: the
slip's saving lines (Came in is net pay), and transfers larger than the month's left over. And
Home opened on the month still running, with nothing in yet.

**Decision.** The maintainer, 2026-11-25, the recommendation each time.

- **Spending counts a card purchase in the month it was bought**, which reverses D-006 for
  spending. A month is partial until the card statement covering it has been read, so a finished
  month is one the calendar has left *and* whose card statements are read. Installments were not
  asked: by default each payment counts in its own month, one a month from the purchase, named in
  U1's report for him to overrule.
- **Saved is what was put aside from this month's money**: net money moved into savings and
  goals that nothing else counts. The slip's saving lines are a line of their own beside it, never
  part of it. When what moved is more than the month's left over, saved is the left over and the
  rest is said to come from earlier savings. The savings rate is saved over came in.
- **Home opens on the last finished month**; the running month is one step forward.

One basis in one place, so Home, Year, the comparisons, `month_summary` and `year_summary` change
together. Nothing is stored, so a document made before reads with the new rule.

**Rejected.** Keeping the charge date with a label; keeping saved whole with its parts explained;
opening on the running month.

## D-608 · 2026-11-25 · No session reads the maintainer's own documents any more: a synthetic year stands in, the session picks the design direction, his one look is the real Home in the app, and an Impeccable finish review checks taste in his place <a id="d-608"></a>

**Context.** The maintainer, after M64 was planned: the screens must look impressive, minimal
but nice to the eye, with well-thought ways to show data and nothing confusing. The tools for
that come before the units. His personal data is shared nowhere, and his file is not read
again: only demos.

**Decision.**

- **No session opens, reads, copies or queries his own statements, payslips, reports or `.emd`
  files**, through the MCP tools or as a scratch copy. This reverses the standing offer of
  2026-08-28. He may try something on his own document himself. What a real document taught
  becomes a synthetic case (the rule *Real documents find the bugs* now says so).
- **Tools first.**
  - A synthetic year, `year.emd` (U16): fourteen months with every case a real ledger shows.
  - A specimen page (U16 builds the route, U4 fills it).
  - A contact sheet of every route as pictures, in a folder git ignores (U2).
  - The dataviz skill for how each shape of data is shown, with charts kept as hand-drawn SVG.
  - Impeccable's finish-reviewer as the taste check in each unit, with `design-review` still the
    rules pass.
- **His one look** (he chose it over picking from three, amending D-606): the session picks the
  direction in U3 after exploring three, and he judges the real Home in the app at U5 (STOP). If
  he likes it, the rest runs without him. If not, his words decide what is redone.

**Rejected.** Figma: a sign-in, and another place he would have to look. A chart library: a
dependency, and against offline.

## D-609 · 2026-11-25 · How D-607 is built: one basis file every month's figure reads, a card holds a month open until its next statement is read, saved never above a positive left over, and what stays on the charge date <a id="d-609"></a>

**Context.** M64 U1 builds D-607, which left the mechanics to the unit: where the basis lives,
how a month knows its card statement is read, what saved is when nothing was left over, and which
readers of the old basis are about a month and which about an account.

**Decision.**

- **The basis is one file**, `src/data/repositories/monthBasis.ts`: `spentOn` (the purchase's day,
  an installment's slice *k* shifted *k − 1* months, clamped to the month's last day) for every
  figure about a month — statistics, the category totals, the ledger's month totals and its date
  range and order, the rail; and `chargedOn` / `billedIn` for what is about the account — a
  statement's months (missing statements), a debt's paid slices, the bill detector's cadence, the
  rule re-apply order. Every `COALESCE(charge_date, transaction_date)` in the repositories is one of
  them now. **The Transactions list ranges and sorts on `spentOn`**, so a month opened from Home
  lists what Home counted; an installment's later slice sorts in the month it counts in.
- **A card blocks a month** when it is a `CREDIT_CARD` account, not archived, its first statement
  month (`billing_period`, else the charge month) is at or before the month, and its statement of
  the month after is missing — inside its run, or past its last while that last is no more than
  `RECENT` (two) months before the month the report is read in. Older than that is a card put away,
  `statementGaps`' own rule, so a closed card does not hold every month open for ever.
- **Saved is `min(moved, max(left over, 0))`** when moved is positive: a month that left nothing saved
  nothing of its own and all it moved came from earlier savings; a negative moved (money taken back
  out) stays a negative saved (D-309). `MonthSummary` and `YearOverview` carry `moved`,
  `fromEarlierSavings` and `offPaycheck` for U5 to show.
- **The ledger's declared `spending` rollup is reworded to `by month of transaction_date`**; the
  pack's rewording reaches an existing document on open (M36 U04). A rollup cannot shift a slice,
  so there an installment's slices sit in the purchase's month — the one place they differ.
- **`month_summary` opens on the last finished month** too, as Home does; `year_summary` stays on
  the current year.

**Rejected.** A setting for the basis (docs/05 promised one; nobody asked, and two bases are two
answers).
Reading the card's billing cycle off the account to know which statement covers a month: the rows
already say which months a card was billed in. Counting an installment's whole price in the
purchase month: D-607's default is one a month, and it is one line in `monthBasis.ts` to change.

## D-611 · 2026-11-25 · The synthetic year is made at build time, ending in the build's own month, its statements written per month from one JSON source and read through the ledger's own import; the specimen page opens in the dev and demo builds only, its panes themed by a class <a id="d-611"></a>

**Context.** M64 U16, the tools D-608 put before the redesign. The year has to stand in for a real
ledger: a running month, a missing statement, a card billed the month after, and the rest of the
brief's list, every figure made up. A year of committed files would stop having a running month on
the first of the next one, and the tours' documents must not change under their tours.

**Decision.**

- **`year.emd` is made by `make-demo-document.mjs` at build time, beside the others**, by
  `scripts/demo-year.mjs`, from `fixtures/synthetic/demo/year/year.json`. Its fourteen months end
  in the month the build runs in, still running: bank rows stop at today and no card statement
  covers it. Figures are drawn by month index with a seeded generator, so every build draws the
  same ones on its own calendar.
- **Intake makes it.** Each card's and bank account's month is written as the file its issuer
  would send (an English xlsx, a Hebrew xlsx, two csv) and read through `import_statement`;
  slips, fund readings, goals, the debt and the plan go in through the tools a conversation uses,
  since none of them has a reader there.
- **A statement holding a refund is read past its printed total**, and only such a file: the
  import's check adds every row's magnitude, so it refuses a true statement with a refund (found
  here, handed on; the fix is in `src/plugin/tools/ingest.ts` and `statementBatch.ts`).
- **`#/specimen` opens where `specimenOpens()` is true**, the dev server and the demo build, and
  is lazily imported, so the desktop release has neither the route nor the chunk. Each state is
  drawn in a `.fc-theme-light` and a `.fc-theme-dark` pane: the dark class shares the dark token
  blocks, the light one restates the light values `@theme` cannot attach to a class, and a test
  fails when the copy drifts.

**Rejected.** Committed statement files (stale in a month, and a frozen running month); growing
`showcase.emd` (the page's pictures are taken from it); a specimen route in every build behind a
setting (the release would ship a page nobody there asked for); theming a pane by redefining the
root's theme while the page is open (it fights the person's own theme).

## D-612 · 2026-11-25 · Density is read off one snapshot of `main` by tested arithmetic: a block is a heading-led section, a table, a chart, a list of three rows or a `data-block`, a figure is the secondary-number step or a `data-figure`, a budget is a maximum per route; `--shots` paints each screen at its whole length into `.probe/shots/` beside one contact sheet, and the inventory is `docs/redesign/screens.md` <a id="d-612"></a>

**Context.** M64 U2. D-606 asks for density measured and budgeted, D-608 for a contact sheet of
the whole app. `probe:screens` measured only how a screen looks, and the test environment is node,
so nothing that needs a browser's layout can be tested.

**Decision.**

- **The page is read once and measured by arithmetic.** `snapshot(main)` turns what is drawn into a
  tree of plain nodes (tag, role, own text, box, font size, colours, `data-figure`, `data-block`, a
  primary button); `density(tree, fold)` is pure and `probe.test.ts` runs it on a fixed page. The
  screen is `main`, not the title bar or the rail (`--screen` changes it).
- **What counts.** Words: tokens with a letter or digit in drawn text, and those whose box starts
  above the fold (the window's height, 800 at 1280x800). A block: each `h2`-`h6`; outside another
  block, each table or grid, each SVG of at least 80x40, each list with three or more items, each
  `data-block`. A figure: a `data-figure`, or digit-only text at the ramp's `--text-secondary-number`
  step or larger, never a heading; a figure drawn in parts (the magnitude large, its symbol and
  decimals a step down) is one. Actions: buttons, links, tabs, menu items; primary is
  `fc-btn-primary`. Type sizes and colours: the distinct ones spent on text, backgrounds and a
  chart's marks. Screens: the last box's bottom over the fold.
- **A budget is JSON keyed by route hash, `*` for every route, each limit a maximum named as the
  measures are**; the route's own limits win over `*`, an unknown name is itself a breach, and
  `--budget` exits 1 naming every breach. U4 writes the limits.
- **`--shots` measures each route and theme on its own (`stay` leaves it on screen), stretches the
  window to the screen's whole length (8000 px at most), and keeps a frame painted on request** —
  an offscreen window's `capturePage` handed back its first frame. Pictures go only to
  `.probe/shots/`, which git ignores. Each run writes `<document>.json` beside its pictures and
  makes `index.html` again from every such list: grouped by document and section, light and dark
  side by side, the fold marked, density under each.
- **The inventory, `docs/redesign/screens.md`, is measured on the demo documents only**: `year.emd`
  for the ledger, `custom.emd` and `project.emd` for the engine.

**Rejected.** A browser DOM in the test environment (a dependency, and its layout is zeros anyway);
viewport-only pictures (the fold is a line on a whole picture, and a contact sheet of folds hides
what a screen holds); counting every `div` of rows as a list (the markup cannot say which are rows;
`data-block` lets the redesign say so); a budget with minimums (nothing yet asks for one).

## D-613 · 2026-11-25 · A card statement's printed total is compared with its rows' signed sum, charges less refunds, and every row's magnitude stays only as the second reading <a id="d-613"></a>

**Context.** M64 U17. The import's printed-total check added every row's magnitude, in the
conversation (`import_statement`) and on the screen (`statementBatch.ts`) alike, so a card
statement whose total is net of a refund was refused as not reconciling: M64 U16's synthetic year
had both cards' refund months refused, a refund counted twice, and read them past the check.
Magnitudes were summed because the sign is the app's convention and not the file's (D-004); that
is a reason to compare one total on magnitude, not to add the rows on it.

**Decision.** `reconcileRows` in `printedTotal.ts`, which both callers use: per currency, the rows'
signed sum — charges less refunds, what a card will charge — compared on magnitude with the printed
figure; and where that disagrees, the sum of every row's magnitude, so a file that prints its
charges and refunds as one gross figure still agrees and nothing that reconciled before stops
reconciling. The figure shown beside the printed one is whichever agreed, else the net one. The
synthetic year reads every statement through the check again. Bank statements print no total and
are untouched.

**Rejected.** Net only (a gross-printing file nobody has seen would start being refused, for no
gain); reading a refunds section's own total apart (no file at hand prints one); keeping the year's
exemption (it hid exactly the bug it found).

## D-614 · 2026-11-25 · Home and the rail take direction A, the report: the month said as one sentence with left over its one figure, a typographic rail, detail in a side panel; with B's month strip as the pager and C's waiting list and palette; the flows leave Home's figures and Plex gains a light weight for the hero <a id="d-614"></a>

**Context.** M64 U3, under D-606 as D-608 amended it: the session explores three directions for
Home and the rail and picks one itself; the maintainer's one look is the real Home at U5. Impeccable's
redesign path ran in Operate mode with its shape questions answered from D-606, D-608 and U2's
inventory rather than by interview; its direction roll (`concept-seed`, seed reference
`3f9df0c5e87345aa`) assigned the fourth of seven grounded candidates. Three working prototypes were
built on U16's synthetic year, in light, dark and Hebrew, and kept with the answers, the roll, the
critique and this pick in [`docs/mockups/m64-u3/`](./mockups/m64-u3/index.html):

- **A, the report** (the assigned candidate, an annual report's highlights page): the month as a
  sentence, left over as one figure at 88px in Plex 300, the rest in columns on a 12-column grid; a
  typographic rail; detail in a side panel.
- **B, the statement** (the session's own top candidate, with a utility bill's history strip): one
  sheet on a tinted desk read as a reconciliation, every line opening in place; a fourteen-month
  strip as the pager; tabs across the top and no rail.
- **C, the signpost** (a challenger, airport wayfinding, fused): the next step on a yellow band
  used for nothing else, left over at 128px, every figure a sign with an arrow to its own page;
  command-led (Ctrl+K) with a black icon rail.

Each was judged by an isolated reviewer with Impeccable's critique (Assessment A): A 23/40, B 25,
C 26 on Nielsen's heuristics; against the brief's five tests of "impressive", A 31/50, B 30, C 30.
The detector (Assessment B, run in this session without the browser overlay) found only the
uncategorized bar's hatch, a false positive.

**Decision.** **A, with parts of B and C.** Scores close; the pick goes to what each did that the
others could not be raised to. A owns the frame: the sentence and one monumental figure are the
three-second answer and the one part every reviewer called a point of view; a rail of words is
recognised where C's icons had to be recalled and where B's tabs could not hold the engine's places,
which are the document's and many; and a side panel opens a figure's breakdown or a category's rows
while the month stays beside it, which C's pages lost. Taken in: from **B**, the fourteen-month
strip as the pager in place of A's flat lines (columns at 3:1, values in a tooltip and on the open
month, months reachable from the keyboard) and opening in place where a list is the breakdown, what
is open kept as months page; from **C**, every waiting item on Home as one quiet list with a verb
each (never a carousel, never an alarm colour, never above the answer), the palette *Go to, or
ask…* on Ctrl+K as the second way around, and a figure's affordance visible at rest. Below 1360px
the panel floats over the page instead of squeezing it (the critique's first issue on A).

**What it overrides among the `ui` rule rows** — U4 rewrites each, with its test:

- *The four flows colour Home's figures*: overridden. Figures are ink; a flow's colour is a mark (a
  line, a dot) beside its word in a chart or a key. Two reviewers read red "went out" as an error,
  and red goes back to meaning a problem (*Colour carries meaning*).
- *One family, two scripts, bundled*: amended. A fourth weight, 300, for the hero figure alone.
- *Tabular figures everywhere*: amended. A standalone hero figure takes proportional figures;
  columns, axes and figures in rows stay tabular.
- *Every value is a token*: amended in its ramp. The type ramp gains a display step (88px, 300) and
  a lede (28px, 400), and U4 rebuilds the ramp around them; sizes off it still move onto a step.
- *Charts are ink, labelled directly*: amended to the dataviz marks. Lines 2px, columns 24px at most
  with 4px rounded data-ends, every mark 3:1 against its plane, and a tooltip and keyboard reach on
  every chart (*Contrast 4.5:1 for text* gains its 3:1 for marks).
- *The sidebar is a tree, and chrome is one plane*: amended in its first half. The rail is a flat
  index of words in two groups, the document's places and the engine's; a section's pages are its
  one level of tabs (*One level of tabs*), not children in the rail. Chrome stays one plane.

Kept as they are: *Accent is for acting*, *No gradients, no shadows* (the floating panel is a room
that floats), square cards and controls, chips, *One primary action per screen* (Read files is
Home's), *A data table*, the motion rows (the panel grows its room), *Category colours are dots*,
*Keyboard first*, *Hebrew needs bidi isolation*. Home's eyebrow goes: Impeccable bans a label above
a heading, and the month is the heading.

**Fonts and icons.** IBM Plex Sans, Plex Sans Hebrew and Plex Mono, self-hosted as woff2 from the
`@fontsource` packages already in the dependencies; the only addition is the 300 face per script
(about 24 KB Latin, 5 KB Hebrew). No new runtime dependency. Icons stay authored SVG on a 24 grid
at a 1.75 stroke, `ActionGlyph`'s set extended; no icon library.

**What the other two taught.** B: a statement opened by default buries the answer (left over fell
to 911px on a 768px screen); opening in place is the right way to compare a category month to month;
a tinted desk with a sheet reads as official but adds a plane. C: the next step belongs on Home but
below the answer; a pager of waiting items hides two of three; an icon-only rail fails recognition;
a page per figure loses the month. All three: saved beside left over as a peer confused every
reviewer. The prototypes drew `month_summary`'s saved, which counts the slip's pension and study
fund; Home's saved (D-607, D-609) does not and is never above a positive left over, so U5 shows the
slip's part beside saved, as D-607 decided. All three also lacked a visible place to drop a file.

**Rejected.** B whole (the answer below the fold; tabs that cannot hold the engine's places). C
whole (an alarm before the answer; icons to recall). A unchanged (its lines decorated, its waiting
list hid two of three, its flows coloured figures). A fourth direction (the faults the critique
found were shared and fixable, not one direction's). Serving the roll's decision page (the unit
ran unattended, and the pick is the session's by D-608).


## D-615 · 2026-11-25 · The report becomes the design language: A's tokens and two type steps, Plex in four weights, a rail of words whose sections' views are their tab strip, a kit of eight displays chosen by the shape of the data, a side panel and a waiting list, six ui rules rewritten and four added, and a density budget whose exempt list only shrinks <a id="d-615"></a>

**Context.** M64 U4: D-614 picked direction A, *the report*, with parts of B and C, and named the
six `ui` rule rows it overrides. Every later unit of the redesign builds a screen without asking
the maintainer (D-608), so the pick has to be the code they build with and the rules they are held
to, and how much a screen holds has to be a check that fails (D-606, D-612).

**Decision.**

- **Tokens** (`tokens.css`): A's greys in both themes (ink `#121212`, ink-secondary `#5f5f5c`, which
  reads 6.4:1, ink-tertiary `#8a8a86`, hairlines `#e4e4e0`/`#cfcfca`, surface `#fafaf8`; dark
  `#0c0c0d` and `#121214`), the kit's three mark colours (`bar`, `bar-quiet` at 3:1 on both planes,
  `track`), `--radius-mark` (4px), and two steps on the ramp: `display` 88px in the 300 face and
  `lede` 28px. Plex Sans and Plex Sans Hebrew gain their 300 and 600 faces from the `@fontsource`
  packages already installed; no dependency.
- **The rail** is words in two groups — *Money* (the ledger's places) and *Document* (the
  engine's) — 200px as before (216 overflowed the development tour's board), the place you are on semibold ink with a 6px `accent` square at the row's end,
  glyphs only when collapsed. **A section's views are its tab strip, never rows in the rail**:
  Home's month and year, Paychecks' deduction types and Categories' rules moved to `ViewTabs`,
  which now draws whatever the rail's width, labels in `ink-secondary`, and carries the tour's
  `nav-…` anchors. **Sections of places keep their places beneath them** — Wealth, Settings,
  Formats and a pack's formats — because D-475's format folders and a pack's unbounded formats have
  no tab form that keeps them; this is the one part of D-614's flat rail not taken.
- **The data display kit** (`src/ui/charts/`): one display per shape U2 found — `HeadlineFigure`
  (with `Sparkline`), `RankedBars`, `PartOfWhole`, `PlanAgainst`, `MonthTrend`, `MonthStrip` (B's
  pager), `MonthFlow` — each saying in `DISPLAYS` when it is right and when not, each taking the
  caller's empty sentence, keeping a negative's true minus and saying *over* in words. Figures are
  ink; a flow's colour is a mark beside its word. The general `Chart` takes 2px lines, 24px bars,
  and the keyboard.
- **Shared pieces**: `SidePanel` (detail beside the page; floats over it below 1360px),
  `WaitingList` (what is waiting, below the answer, a verb each), `EmptyState`, `.fc-text-action`.
- **The specimen page** draws every display and piece in every state, light and dark, in two
  halves (`?part=kit`, `?part=pieces`) so each fits one picture of the contact sheet.
- **Rules**: the six D-614 names are retired and rewritten (*Figures are ink, a flow is a mark*;
  *One family, four weights*; *Tabular figures, but the display figure*; *Every value is a token*
  with the two steps; *Charts: thin marks, named, reachable*; *The rail is an index of words*),
  and four are added: *Density is budgeted*, *The answer comes first, in words*, *Detail opens
  beside the page*, *A display is chosen by the shape of the data*.
- **The budget** (`docs/redesign/budget.json`): every route's limits are its U2 measures, a
  ceiling; every route takes one primary and seven type sizes; every route is `exempt` until its
  unit redesigns it, reported and not failing; the specimen page is a tool and never budgeted.
  `probe:screens --budget` fails on a breach of a route not exempt, and `src/ui/budget.test.ts`
  holds `exempt` to U4's list, so it only shrinks.

**Taste check.** Impeccable's finish-reviewer judged the specimen page and the contact sheet
against `DESIGN.md` and comp A. Made: MonthFlow's over figure back to ink, its whole drawn as a 3:1
rule, one minus sign (U+2212) across the kit, the strip's open month saying its note in words and
its labels thinned when they would touch, the panel's month under its title rather than above it,
a Hebrew button kept at its own width. Not made, as decisions the maintainer has not listed: the
filled primary button (the comp drew a hairline box; *The button is a split tile* and *One primary
action per screen* stand) and the notice bar's filled *Open Home* (Home's waiting list replaces it
in U5) — both are review entries.

**Rejected.** A fully flat rail (loses the format folders); limits invented below U2's measures
before a screen is redesigned (a ceiling each unit tightens is a decision it makes with the screen
in hand); the comp's 36px symbol (off the ramp; the hero step is 40); a chart library.

## D-616 · 2026-11-25 · Home is rebuilt as the report: the month in one sentence, left over its one figure, what waits one strip below it, four tiles that open their breakdowns beside the page, the fourteen months as the pager, and where it went beside the plan; All months and the by-month chart are the Year screen's, and a redesign-screen skill every later screen follows <a id="d-616"></a>

**Context.** M64 U5: Home, the first screen a newcomer meets and the densest (U2 measured 622
words, 10 blocks, 70 actions, 4 primaries, 8 type sizes, 4 windows tall on the synthetic year),
rebuilt in D-614's direction with D-615's kit, and the maintainer's one look (D-608).

**Decision.** Home answers one question, *what happened to my money this month?*

| Block before | Now | Why |
|---|---|---|
| The drop band (Read files, Add a paycheck) | **kept** Read files as the one primary in the header; **cut** Add a paycheck | a file dropped anywhere is still read; Paychecks adds a paycheck, and the palette reaches it |
| Getting started line | **moved** into the waiting strip | it asks something of the person |
| Waiting for an answer, answered in its rows | **moved**: one line and one verb each, in a strip below the answer; *Answer* opens the kind's answers in the side panel, *Choose categories* goes to By merchant | the answer comes first; a category per merchant needs its screen (and the ledger tour walks it) |
| Five flow tiles | **kept**: left over as the display figure after the sentence; came in, went out, saved, taxes as tiles with a trend, each opening its breakdown | the answer, then what made it |
| Came in and went out by month (a chart) | **cut**; the fourteen months are a `MonthStrip` of left over that pages them | Year draws the by-month chart |
| Where it went | **kept** as `RankedBars`, six and the rest folded; a category opens its rows in the panel | the month's main detail |
| Bills and everything else | **moved** behind Went out | it explains went out |
| What came in | **moved** behind Came in | it explains came in |
| Against the plan | **kept** as `PlanAgainst`, beside Where it went | the plan is half the month's story |
| Saved | **moved** behind Saved, as `PartOfWhole` (each part opens its rows or its goal) with what came off the paycheck beside it | it explains saved |
| Biggest single charges | **moved** behind Went out | it explains went out |
| All months | **cut** | Year's *The months*; the strip pages months, and a missing statement is in the strip's note and the waiting strip |

Every figure is ink. The probe after: 164 words, 8 blocks, 7 figures, 36 actions, one primary,
7 type sizes, 10 colours (11 dark), 1.7 windows, nothing under AA, in light, dark and Hebrew. `#/`
leaves the budget's exempt list with limits of 180 words, 8 blocks, 7 figures, 40 actions, 11
colours and 1.8 windows. The kit gains what Home needed and nothing else: a row's tour anchor
(`RankedBars`, `WaitingList`), a part that opens (`PartOfWhole`), the display figure's name and
change beside it rather than above, and a `MonthStrip` scaled by finished months, 80px tall, its
labels at the caption step. A signed percentage is isolated left to right, so Hebrew keeps the sign
before the number. `.claude/skills/redesign-screen/SKILL.md` is how every later screen unit works,
and design-review points at it.

**Taste check.** Impeccable's finish-reviewer on the contact sheet against `DESIGN.md` and comp A.
Made: the display figure named beside it, the sentence's amounts weighted and unbroken, the Hebrew
sign, the budget, the strip's scale and hollow (only the running month), a figure and what it counts
at the head of each panel. Not made: a filled Read files (the comp's hairline box; *One primary
action per screen* says filled, as D-615 found), *Choose categories* opening a panel (answering it
needs By merchant, and the tour clicks through), and a tax breakdown by deduction (the domain gives
Home a month's taxes as one figure; Paychecks has the lines).

**Rejected.** Keeping All months under a fold (it is Year's, and a second table of months is the
density U2 measured); a two-line chart beside the strip (two displays of one trend); category dots
on Where it went (six colours against an 11-colour budget, for names the rows already say).

## D-617 · 2026-11-25 · Where a screen's interactions open: reading more in the side panel, one value in place, a form of several fields in the same panel, a job of several steps on a page of its own with one way back, a choice in a popover, and a dialog only to confirm what cannot be undone <a id="d-617"></a>

**Context.** The maintainer approved M64 U5's Home (D-608's one look) and asked whether the redesign
also settles which interactions are side panels, dialogs or pages. D-614 and D-615 said only that
detail opens beside the page; editing, making, picking and confirming were left to each screen,
and they are most of what U6-U14 redesign.

**Decision.** Every redesigned screen lists each interaction and where it opens, from five places:
reading more about something, the `SidePanel`; changing one value of one thing, in place on its
line; making or editing a thing of several fields, a form in the `SidePanel` with the page behind
it; a job of several steps that takes over until done (the mapper, a new document's start), a page
of its own with one way back; choosing from a list or a menu, a popover anchored to what opened
it. A dialog is only for confirming what cannot be undone, and an undo beats it where one can be
offered. An interaction that fits none stops the unit and asks.

**And it behaves as ordinary desktop apps have taught people to expect** (the maintainer, the same
day): deleting deletes at once with an undo near where it happened, and where no undo is possible
the confirmation is anchored to the button that asked and names the thing, never a bar at the
bottom of the screen (his example: a row selected inside a filter, deleted from its entry, asked
at the bottom of the screen). Selected rows act in the list's own header; Esc, Enter, Delete,
Ctrl+Z, the arrows and Tab do what they do everywhere; nothing moves under the pointer; every
panel has one visible way out. The taste check asks of each interaction whether someone who uses
ordinary apps would be surprised, and a surprise is wrong even where it fits a rule.

**Two more, the maintainer, 2026-11-26**, after trying U5-U9: a list cut short (*the rest*, *+ 6 more*)
expands in place and never opens the side panel, which is for detail about a thing; and an action
finishes where it was started (a rule made from a transaction is made there, and its note offers
*Open in Rules* as a link rather than going there).

**Why.** One place per kind of act is what makes a screen learnable once and the rest predictable;
left to each unit, ten screens would make ten choices. It extends *Detail opens beside the page*
rather than adding a pattern.

**Where.** `.claude/skills/redesign-screen/SKILL.md` (Where each thing opens), `DESIGN.md`.

## D-618 · 2026-11-25 · Transactions is rebuilt as the report: each tab answers first in one sentence, its views are one tab strip, a row, a rule from a fix and what is left out open beside the rows, a selection acts from the table's own header row, and what was just done keeps its place with its Undo <a id="d-618"></a>

**Context.** M64 U6 redesigned Transactions (All rows) and By merchant after Home (D-616), with
D-617's five places and the maintainer's addition to it: interactions behave as ordinary desktop
apps taught people — nothing moves under the pointer, selected rows act from the list's header,
Esc, Enter and Ctrl+Z do what they do everywhere, every panel has one way out.

**Decision.** *All rows* answers *what did I spend money on* in one sentence (what went out and
came in, for the month, every month or the rows that match), the open month is its heading, and
under it one line keeps its place: the count and *n left out of the totals* (which opens those
rows beside the page), or — after a fix — *Always file X as Y? Make a rule*, or what the rule just
filed and its Undo. The four tiles are cut (their figures are the sentence); the uncategorized
count is cut as a repeat (By merchant's whole job, Home's first waiting line); card bills nobody
answered are the waiting strip. A row's detail, the rule form (formerly a strip above the rows)
and the left-out rows open in the `SidePanel`. Ticked rows' actions take the table's own header
row, Esc lets go of them, and Charged and Provider said are drawn only when a row on screen has
them. *By merchant* answers *which shops still need a category* in one sentence, the sitting's
meter beside it once something is filed; the newest filing and its Undo stand in the list's own
header row (Ctrl+Z undoes it too) instead of a growing list above the merchants; recognised
merchants are the waiting strip; a merchant's charges, its bill-or-debt form and the skipped
names open in the `SidePanel`. The two views are Transactions' tab strip (`nav.ts`), not a switch
drawn in each header.

**Why.** The answer first and the detail beside the page is Home's approved pattern (D-616); a
line that swaps its words instead of strips that grow above the rows is what keeps the row a
person just touched under their pointer.

**Rejected.** A display figure on All rows: the table is the screen, and a second monumental
number would push it under the fold. Keeping the waiting count on the tab: `ViewTabs` draws words.

**Where.** `src/ui/screens/Transactions.tsx`, `src/ui/screens/ByMerchant.tsx`,
`src/ui/transactions/`, `src/ui/categorize/PromotionPanel.tsx`, `src/ui/nav.ts`,
`docs/redesign/budget.json`.

## D-619 · 2026-11-25 · Reading files is the report: the batch said first in one sentence, Write in the list's own header row, a statement's gap beside the list rather than on a page, a removal undone where it was, a reader's delete asked at its button, the mapper's one way back at its head, and Readers one translated list <a id="d-619"></a>

**Context.** M64 U7 redesigns the first thing a newcomer does — `#/read`, `#/paychecks/read`,
`#/read/readers`, the file gap and the mapper — after D-616 (Home) and D-617 (where interactions
open), with the maintainer's addition to D-617 arriving mid-unit: deleting is at once with an
undo near where it happened, a confirmation where there is no undo is anchored to its button and
names the thing, a selection's actions are in the list's own header row, and nothing is ever a
bar at the foot of the screen.

**Decision.** Read files and Read paychecks **answer first**: one sentence at the lede step says
what the batch came to (*3 files read: 2 ready to write, 1 waits for you*), two lines high so a
tick never moves the list. The files are one list in the order dropped; its header row holds the
ticked count and **Write**, the screen's one primary (filled only when it writes); Add is filled
only on the empty screen. **A statement that does not add up opens its gap beside the list**
(`GapPanel`, the `SidePanel`): the three figures from the kit's `HeadlineFigure`, each unread row
with its raw cells and a field per cell corrected in place, *Write anyway* and *Leave it out*;
`#/read/<id>`, its page since M28 U5, opens the same panel. **Removing a file or a slip is at once**,
with *<file> removed · Undo* in the row's place and Ctrl+Z; *Leave it out* is that removal. On
Readers a delete has no undo (a statement reader's delete is a hard one), so **it asks at the
button that asked** (`ConfirmAtButton`, a popover naming the reader) instead of the bar at the foot
it was; a name is renamed in place by double-click, F2 or its row menu, which also holds Duplicate;
the account a statement reader files into is a popover on its line. Readers is **one list**, its two
halves (`Mappings.tsx`, `Formats.tsx`) folded into `Readers.tsx`, and with Read paychecks, the gap and
the payslip foot bar, its words are the catalogue's. The **mapper keeps its page** — the one job of
several steps here — with one way back, *← Read files*, at its head instead of Close at the end of
its toolbar. The foot bars that name a batch read elsewhere stay (they are background work's
status, not a selection's actions), but **never filled**: the screen above them has its own primary.

**Why.** The person's question is *did my files get in, and what needs me?*; a sentence answers it
before a list does. Every move is an ordinary app's: a mail client's selection header, a file
manager's rename, an undo where something was removed, a question asked where it was asked.

**Alternatives rejected.** The waiting files as Home's `WaitingList` above the list — a file would
jump between two places as its state changed, and the strip's `say` is plain text where a file's
name needs `Bidi`. A select-all box in the header — a judgement left for the review.

**Where.** `src/ui/screens/ReadStatements.tsx`, `src/ui/import/GapPanel.tsx`, `src/ui/screens/Readers.tsx`,
`src/ui/paychecks/ReadSlips.tsx`, `src/ui/components/ConfirmAtButton.tsx`, `src/ui/import/MapperScreen.tsx`,
the two foot bars, `docs/redesign/budget.json`.

## D-620 · 2026-11-25 · Paychecks is rebuilt as the report: the month's paycheck in one sentence, net pay its one figure, the gross divided into taxes, funds, the rest and the net, each opening its lines beside the page (taxes by deduction type, month and year so far), what waits one strip below, net by month as the pager and every paycheck in a table; Deduction types reads as a table whose rows open their form beside it; a delete deletes at once with Undo where it happened, and the slip's form stays a page of its own <a id="d-620"></a>

**Context.** M64 U8 redesigns Paychecks and Deduction types (D-614, D-615, D-617), with the jobs from
U2's inventory: read a month's slip from gross to net, follow the net, see what went to the funds,
check every month has a slip; and say what each line of a payslip is. Home's Taxes tile shows one
figure a month (D-616), and Paychecks is where taxes are read in full by deduction type. The
maintainer added to D-617 while the unit ran: a delete deletes at once with Undo near where it
happened, the keys do what they do everywhere, and nothing moves under the pointer.

**Decision.** Paychecks answers *what did my paycheck pay, and where did it go?* first, in words —
one sentence, its amounts plain text so the screen keeps one display figure (net pay, against the
three paychecks before) — then the gross divided by `MonthFlow` into taxes, funds, other deductions
and the net. Each part opens its lines in the side panel: taxes by deduction type for the month and
the year so far, the fund lines with the employer's side and where they pay into, the rest, where
the net went; the gross opens the slip in full (lines, employer's side, totals, Edit and Delete), as
does a row of *All paychecks*. What waits — a slip that does not add up, a saving line that pays into
nothing, the bank disagreeing, a month with no slip — is one `WaitingList` below the answer. Net pay
by month is the `MonthStrip` and pages the month; the bespoke net line, waterfall, drop box and full-page
detail are gone. A visit can land on a month and a panel (`{ month, panel: 'tax' }`), which is
how Home's Taxes tile can open toward it. Deduction types is a sentence and a table that reads; a row
opens its form in the side panel (name, what the paycheck prints, kind as a `ChoiceField`, counts as,
pays into, order, delete), and the likeliest link stays one click on the line. A paycheck or a type
deletes at once, the note and its Undo in the panel and in the table where the row was, Ctrl+Z too;
Delete on a focused row deletes it, Up and Down walk the rows, Enter opens. `MonthFlow` gains an
optional `onOpen`; the domain gains `slipParts` and `totalsByType` so the screen sums nothing. Both
routes leave the budget's `exempt` list, their words the catalogue's (`paychecks`, English and Hebrew).

**Why.** The slip's form stays a page of its own rather than a panel form: a payslip is a dozen
fields copied off paper with the reconciliation watched while they are typed, and it is the same form
the reading flow confirms a read slip in — a job that takes over until it adds up, D-617's fourth
place. An undo beats a confirmation wherever a paycheck can be written back, which it can.

**Where.** `src/ui/screens/Paychecks.tsx`, `src/ui/paychecks/PaychecksPanel.tsx`,
`src/ui/paychecks/WhereItWent.tsx`, `src/ui/screens/DeductionTypes.tsx`, `src/ui/charts/MonthFlow.tsx`,
`src/domain/paycheck.ts`, `src/i18n/*/paychecks.ts`, `docs/redesign/budget.json`.

## D-621 · 2026-11-25 · Plan is rebuilt as the report: net pay and what the bills take first said as one sentence with whether every shekel has a job, to split its one figure, what waits one strip below it, the split's bar with each bucket held against a month, and the bills one row each with its one choice in place; a bucket, a bill, net pay, the cushion and the plan's months open beside the page <a id="d-621"></a>

**Context.** M64 U9: Plan, the densest ledger screen U2 measured (779 words, 117 actions, 5
primaries, 10 type sizes, 3.5 windows on the synthetic year), rebuilt in D-614's direction with
D-615's kit, D-616's Home as the pattern and D-617's places for each interaction, with the
maintainer's addition that interactions behave as ordinary desktop apps have taught people.

**Decision.** Plan answers one question, *where should next month's money go?*

| Block before | Now | Why |
|---|---|---|
| The plan's name and month | **kept**: the name as `h1`, *Default* beside it, the month pager | the plan is what the page is about |
| Months on this plan (twelve boxes) | **moved** behind *Choose its months* by the name, in the side panel | it says which months the plan covers, not where the money goes |
| What the month records (deposit, payment) | **moved** into the waiting strip, one verb (*Record it*); the *recorded* confirmation **cut** | it asks something of the person; Goals and Debts show what was recorded |
| The cushion | **moved** behind its tile, which says what it holds against its target | it explains the cushion figure |
| Four tiles (net pay, bills out of net, to split, not given a job) | **kept** to split as the display figure after the sentence; net pay and the cushion as tiles that open; bills out of net and *not given a job* **cut** | the sentence says both, and the bills' totals line says what is out of net |
| Net pay's basis (Change) | **moved** behind the Net pay tile | it explains net pay |
| Bills (seven columns, a three-way switch on each row) | **kept** as a data table of name, a month, the month held against and what it does; the choice one popover in place; how often, each charge, how it is recognised, *It ended* and *Stop tracking* **moved** into the bill's form, opened by its name | the row says what the bill does to the plan; the rest edits it |
| *4 charges look like bills* | **moved** into the waiting strip, their cards behind *Look at them* | it asks something of the person |
| The split's bar | **kept**, its dividers, Bar or Ring; the bills-in-split hatch and the band's hatch **cut** (no gradients); a segment's label whole units, what it got said in the list | the split is a part of a whole |
| Planned, got, over the plan (three figures) | **cut** into one sentence under *The split*, with the gap in words | a sentence carries it |
| *Every shekel has a job* box, *Give it to …* | **moved**: the state into the answer, *Give it* into the waiting strip | the answer comes first |
| The buckets table | **kept** as `PlanAgainst`, each bucket's planned against what it got, in two columns; its name, what it is for, how much, keep this size, counts as, up and down, split and remove **moved** into the bucket's panel | the bar and the planned and got figures stay; the editor explains a bucket |
| New bucket, add one this plan does not use, suggest goal amounts | **moved** behind *Add a bucket* | making a thing is a form beside the page |
| The plan's menu | **kept** as a popover; delete asks in a popover at the same button, naming the plan | a choice is a popover; a confirmation sits where it was asked |

Where each interaction opens: a bucket's line, a bill's name, net pay, the cushion, the charges
that look like bills and the plan's months open in the `SidePanel`; a bill's role and the month
held against are popovers in place; the plan's name is renamed in place from the menu; a bucket's
and a bill's fields are a form in the panel (Enter saves, Esc puts back); removing a bucket, stopping
tracking a bill and deleting the plan ask at the button that asked, naming the thing, *Keep*
focused, and Esc takes back the question and never the panel; Esc while a divider is held puts it
back and writes nothing. No delete here has an undo, so each asks.

Every figure is ink. The probe after: 272 words, 7 blocks, 5 figures, 31 actions, no primary, 7
type sizes, 15 colours (16 dark), 2.4 windows, nothing under AA, in light, dark and Hebrew. `#/plan`
leaves the budget's exempt list with limits of 300 words, 8 blocks, 6 figures, 36 actions, 16
colours and 2.7 windows. The kit gains two optional fields on `PlanAgainst`'s line and nothing else:
a `mark` before the name (the bucket's colour on the bar, *A bucket wears what it points at*) and an
`unknown` sentence said instead of left or over when what happened is not known, or is a deposit
over its plan, which is not bad news.

**Taste check.** Impeccable's finish-reviewer on the light, dark and Hebrew shots. Made: *Keep*
focused in a removal's question and Esc scoped to it, Esc cancelling a drag, the last gradient on the
bar, the bar's labels in whole units, the midpoint axis label, the gap said in words, the role choice
as text at rest, the merchant line hidden where it repeats the name, *Choose its months* as a verb,
the menu's glyph. Not made: mirroring the bar in Hebrew (it was left to right before this unit and
its drag reads the pointer's x; a follow-up), the band from net pay into the split (the inventory's
*flow from net pay* shape), naming each unmeasured bucket (a follow-up).

**Found, not changed.** The shell's waiting notice draws its buttons at 13px, off the ramp, on every
screen but Home, and spends one of a route's seven type sizes; `Button size="sm"` is 13px too.

**Where.** `src/ui/screens/Plan.tsx`, `src/ui/plan/BucketEditor.tsx`, `src/ui/plan/FixedSection.tsx`,
`src/ui/plan/PlanBar.tsx`, `src/ui/charts/PlanAgainst.tsx`, `src/i18n/{en,he}/plan.ts`,
`docs/redesign/budget.json`.

## D-622 · 2026-11-26 · Wealth is rebuilt as the report: net worth, funds, goals and debts each answer in one sentence with one display figure and the kit's display for their shape, what waits one list below, then one table whose rows open beside the page; fee impact, the deposit check, a net worth row and the goals' projection move into the side panel, and a removal asks in the row's own menu where no undo is honest <a id="d-622"></a>

**Context.** M64 U10: Wealth's four routes, rebuilt in D-614's direction with D-615's kit, D-616's
Home as the pattern and D-617's places for each interaction. U2 measured them on the synthetic year:
`#/wealth` 122 words, 1 block, 1 figure; `#/wealth/funds` 530 words, 5 blocks, 9 figures, 8 type
sizes; `#/wealth/goals` 236 words, 4 figures, 13 actions; `#/wealth/debts` 74 words, no figure.

**Decision.** Each screen answers its inventory question first.

| Block before | Now | Why |
|---|---|---|
| Net worth hero and its four parts (in the bank, in accounts with holdings, locked, owed) | **kept** as the sentence (*you own X all together, and owe Y: you are worth Z*), net worth the display figure, and one `PartOfWhole` by reach (*Reachable*, *Locked*, the table's own column) | the parts are a part of a whole; *in the bank* also covered cash at home, so the words now name the reach |
| Net worth table, a row expanding in place | **kept** as the table; a row **moved** into the side panel (its statement, opening balance, goals' parts, holdings); a fund or debt row opens its own pane, as before | detail opens beside the page |
| A stale statement, goals an account cannot cover (red inside a row) | **moved** to one waiting list below the answer, *Open* each | what waits sits below the answer, never inside a row in red |
| Add an account, add a place (forms under the table) | **moved** into the side panel as forms | a form with several fields opens beside the page |
| Funds' three hero cells (in funds, fees a year, needs a call) | **kept** as the sentence (*your funds hold X, and their fees take about Y a year*) and in funds the display figure; *needs a call* **moved** into the waiting list, a line per fund (a short month, missing deposits, dormant and still charging, no reading, a fee agreement that ended, deposits nothing can check yet) | the count said nothing about which fund or why |
| The funds table with chips | **kept**; chips are text and a dot, red only for a missing deposit | a chip is text and a dot |
| *What the fee costs over the years* and *Did every deposit arrive* (two folded sections) | **moved** into the side panel, opened by a fund's fee a year, a fund's deposits, a waiting line or the two text actions; `#/wealth/fees` and `#/wealth/deposits` still open Funds with the panel open | they explain a fund's fee and deposits |
| Goals' four hero cells | **kept** as the sentence (what the goals hold and what goes toward them each month) and in goals now the display figure; *Plan's Everything else* **moved** into the waiting list when it is over | the answer comes first |
| *Decide this month*: seven columns, a where-it-stands bar and its legend | **kept** as *This month*: each month typed in place (it is Plan's bucket, D-323), moved in the last three months, in N months, and the rate column, headed *If the plan holds*; where it stands and the target **moved** to a `PlanAgainst` meter per goal under the answer, a reached goal full and never red; the origin bar and legend **cut** (the goal's drawer shows them) | the meter is the shape the inventory named; the projection assumes the plan, and the column now says so |
| *What you will have* (a stacked bar chart) | **moved** behind *What you will have* into the side panel, as one `MonthTrend` line of all goals | a projection explains the *In N months* column |
| All movements | **kept** as a view with one way back; its filters `ChoiceField`; Delete deletes at once with *Deleted · Undo* where the movement was, and Ctrl+Z | a movement can be written again, so an undo is honest |
| Debts' table and its *More* menu (review, split purchases) | **kept**, with the sentence (*you owe X on N debts and pay Y a month; at this rate the last is paid off in M*), left to pay the display figure and a meter per debt, paid of what was borrowed; payments found and purchases split into payments **moved** into the waiting list, their views one verb away | the review queue and split purchases ask something of the person |

Where each interaction opens: a net worth row, a fund's fee, a fund's deposits and the goals'
projection open in the `SidePanel`; a fund, goal or debt opens its own pane beside its list (D-130);
an amount a month is typed in place; add an account or a place is a form in the panel; a fund, goal
or debt's own fields stay the full-page editors they were (as Paychecks' slip form did, D-620); a row's
actions are one menu from its *More*. **Deleting a fund, a goal or a debt asks in that same menu at
the same point**, naming the thing and what it costs, *Delete* and *Keep it*: the delete also unaims
Plan's buckets and unlinks deduction types, so no undo is honest. The confirmation bar under each
table is gone.

The probe after, on the synthetic year (light and dark; Hebrew within a few words): `#/wealth` 156
words, 4 blocks, 1 figure, 3 actions, 7 colours, 1.6 windows; `#/wealth/funds` 98, 3, 1, 11, 5, 1.0;
`#/wealth/goals` 173, 4, 1, 13, 8, 1.3; `#/wealth/debts` 107, 4, 1, 8, 8, 1.0; seven type sizes and
nothing under AA on each. All four leave the budget's exempt list. **Two ceilings rise**: `#/wealth`
and `#/wealth/debts` were sparse before (one block and no figure on Debts), and the answer the
inventory asks for — a sentence, a figure, the shape's display and what waits — is more than they
had; their limits are the measures after with a little room, as Plan's blocks rose (D-621). Funds and
Goals fall. The kit gains one optional field, `PlanAgainst`'s `note`, said instead of left or over
when going past the plan is no problem (a goal that reached its target), with a full meter that is
never red. Words are the new `wealth` catalogue area, English and Hebrew.

**Taste check.** Impeccable's finish-reviewer on the light, dark and Hebrew shots and the panels.
Made: the rate column headed *If the plan holds*, since it is the plan's arithmetic while the table
beside it shows what actually moved; the stale-statement and short-goals lines into a waiting list;
net worth's figures on one edge with their header and total; a fund's fee a year in ink, never
accent; Locked and the projection in ink marks rather than saved's green, which reads as the accent
in dark; the row panel's own inset; room between the 12-month and rate columns; one hairline between
the meters and the waiting list; Funds' deposits that cannot be checked as a waiting line. Not made:
the net worth panel's words into the catalogue (`NetWorthOpened` is a detail, with the other
details, a follow-up); the goals' sentence from what actually moved rather than the plan (the domain
has the moved figure per goal but no on-track verdict from it; a question).

**Where.** `src/ui/screens/{Overview,Funds,Goals,Debts,FeeImpact}.tsx`, `src/ui/savings/Movements.tsx`,
`src/ui/wealth/{words.ts,rowMenu.tsx,parts.tsx,NetWorthOpened.tsx}`, `src/ui/charts/PlanAgainst.tsx`,
`src/i18n/{en,he}/wealth.ts`, `docs/redesign/budget.json`.

## D-623 · 2026-11-26 · Categories, Rules and the Year are rebuilt as the report: each answers its question in a sentence first; the Year is where every month is read and opened (a month opens on Home); a category, a rule, a total and the built-in rules open beside the page; a rename is in place; merging and a delete that moves rows ask at their button; deleting an unused category or a rule and archiving happen at once with Undo where it happened <a id="d-623"></a>

**Context.** M64 U11: the last three ledger screens of the first wave, rebuilt in D-614's direction
with D-615's kit, D-616's Home as the pattern and D-617's places and ordinary desktop behaviour.
Home had moved *All months* and its by-month chart here (D-616). Before, on the synthetic year:
Year 357 words, 16 actions; Categories 228 words, 170 actions, 2.9 windows; Rules 2,575 words, 682
actions, 17.6 windows, the densest screen in the app.

**Decision.**

| Screen · block before | Now | Why |
|---|---|---|
| Year · the eyebrow, the year and *Read files* | **kept** the year as `h1` with its pager; *Read files* **moved** into the waiting line a month missing a statement draws | Read files is Home's; here it answers what the year is missing |
| Year · five totals | **kept** as the answer: a sentence (*So far in 2026, more has come in than gone out*), left over the one display figure, then came in, went out, saved and taxes as tiles, each against last year when the two years hold as many months, each with its months as a sparkline | the answer comes first; the tiles carry the amounts |
| Year · the payslips' sentence | **moved** behind the Taxes tile | it explains taxes |
| Year · came in, went out and saved by month (a chart) | **cut** to the tiles' sparklines and the months table; a `MonthTrend` or `MonthStrip` here broke the budget (an eighth type size, twelve more actions) | every chart has its numbers, and the table is them |
| Year · *The months* | **kept** as the one table of every month, a row opening that month on Home (Enter too, arrows walk), a month missing a statement marked *part*, the running one *so far* | Home's All months moved here (D-616) |
| Year · *The same month, a year apart* | **cut** into the table's last column, what went out in the same month a year before, drawn when last year holds any | the comparison sits on the month it compares |
| Year · *Where it went, and how it moved* | **kept** as `RankedBars`, each category with its months as a sparkline (an optional `trend` on a ranked row), six then the rest behind one line; a category **opens** its months and its shops beside the page | a ranked part of a whole |
| Year · *by shop* | **moved** behind the Went out tile | it explains went out |
| Categories · eyebrow, tabs of kind | **cut** the eyebrow into the answer (*You have 42 categories of spending; 13 held something in October 2026*); the three kinds are three parts of one list, since the section's own tabs (Categories, Rules) are its one level | one level of tabs |
| Categories · *Rules* button | **cut** | it is the section's other tab |
| Categories · the starter-set offer | **moved** into the waiting strip, *Archive them*, at once with Undo | it asks something of the person |
| Categories · groups and rows | **kept**: a group's heading its total, a row a dot (the colour popover), its name, the month's bar in its own colour and its figure; a parent's figure is everything under it; the unused **moved** behind *n unused* in each group; the pencil **cut** (F2, a double click, the menu) | the tree is the subject; the eleven hues are its one place |
| Categories · the detail pane, always open | **moved** into the `SidePanel`, opened by a row: the month against its year (a tile and sparkline), where it sits (in place), where it goes, its bucket, its rules, its colour, and its actions | detail opens beside the page |
| Categories · Move, Merge and Delete bars at the foot | **cut**: where it sits changes in place; Merge into… and a delete that moves rows ask in a popover at their button in the panel, with the category the rows go to; an unused category deletes at once | D-617 |
| Categories · New category inline | **moved** to a form in the panel | a thing with several fields |
| Rules · counts and the long lead | **kept** as the answer: *23 rules of yours file shops into categories*, how they are read, and *180 more come with the app* | the answer comes first |
| Rules · *Built in* (180 rows on the page) | **moved** behind its count, in the panel; each opens its copy's form or its menu | the app's rules, rarely edited |
| Rules · the test box beside the list | **moved**: its first field is the list's search, answered in a sentence (*Harbor Foods goes to Living → Groceries, by Harbor Foods*) while the list narrows; the whole box behind *Test with an amount…* | the search that opens the list |
| Rules · five buttons a row | **cut** to one menu (⋯, right-click, Shift+F10): Edit, Move up, Move down, Turn off, Delete; the grip and ⋯ show on hover | a row's menu is one menu |
| Rules · the editor and re-apply bars | **moved** into the `SidePanel` (the editor's fields one under another) | forms beside the page |
| Rules · the delete bar | **cut**: a rule deletes at once, Undo where it was in the order (Ctrl+Z too) | D-617 |

The probe after, light, dark and Hebrew: Year 195 words, 6 blocks, 5 figures, 14 actions, 7 type
sizes; Categories 106 words, 7 blocks, 67 actions, 16 colours (17 dark), 2.2 windows; Rules 301
words, 2 blocks, 28 actions, 1.8 windows; nothing under AA. All three leave the budget's exempt
list. Undo puts a rule back at its place in the order with its count starting over, and a category
back with its name, kind, parent and colour but at the end of its siblings — `createRule` and
`createCategory`, so no new engine write. Categories opens on the last finished month, as Home does
(D-607).

**Taste check.** Made: a parent's figure is everything under it and is never *unused* when its
children held rows; the running month marked *so far*; arrows walk the months; the rule's grip is
drawn, and it and ⋯ show on hover; rule names at body weight; one header treatment for the tables.
Not made: the bars in ink (the inventory makes Categories the one place the hues are the subject);
a sticky header (*a sticky header belongs to a table that is its own scroll region*, and these
scroll with the page); dropping *When* where it repeats the rule's name (a question).

**Consequences.** Year, Categories and Rules are in `docs/redesign/budget.json` with limits.
`AskAtButton` (src/ui/categories/) is `ConfirmAtButton` with a choice in it.

## D-624 · 2026-11-26 · The way in and around is the report: every Settings page and Assistants answer first in one sentence on a shared frame, Accounts reads as rows that open their form beside the page with a delete asked at its button, Assistants' tools open by group beside it, the front door and a document with no ledger say what to do in words with Open… added, the guide's first step names Read files and leaves its note where it stood, the waiting notice speaks only of what changes the month, and the palette says what it can do offline <a id="d-624"></a>

**Context.** M64 U12: a newcomer's first minute — the front door (`EmptyDocument` in `src/App.tsx`),
a document that keeps no ledger, the guide, the notices, every Settings page and Assistants, and
the command palette — after D-616 (Home), D-617 (where interactions open, and the maintainer's
ordinary-desktop addition) and the four screens rebuilt since (D-618 to D-621). U5's open review
entry asked for the guide's first step, which still said *Drop statements… here* though Home's drop
band was gone; D-614 asked for Ctrl+K as *Go to, or ask…*.

**Decision.** Every page under Settings, and Assistants beside them, is drawn by one frame,
`SettingsPage` (`src/ui/settings/SettingsPage.tsx`): the name as the `h1`, **the page's question
answered in one sentence at the lede step** (*2 cards and 2 bank accounts.* · *Weeks start on Monday:
this week is Mon 23 Nov to Sun 29 Nov.* · *This document keeps the ledger.* · *The app's words on this
computer are in English.* · *14 months and 545 transactions, ready to go out as spreadsheets.* · *No
model in use.* · *An assistant … reads and writes this document through 86 tools.*), then one
column of rows, each a label, a line of what it means and its control. No eyebrow; the title row is
as tall as a button, so the title does not move from page to page.

| Block before | Now | Why |
|---|---|---|
| Accounts: a toolbar of four fields to add an account | **moved** to *Add an account*, the page's one primary, a form in the side panel that opens the new account's own | a form of several fields opens beside the page (D-617) |
| Accounts: every account a row of four fields and two platform selects at rest | **kept** as rows that read — name, card number, institution, what it holds — one table, grouped by kind under a heading; the row opens its form beside the page (Enter too; arrows walk) | an account's several fields are a form; a row is read |
| Accounts: what a card's payment does in the bank, a select under the row | **kept** in place, a quiet menu on the row under one column heading | one value of one thing changes in place |
| Accounts: Merge…, Archive, Remove, shown on hover | **moved** to the foot of the account's form; Merge a form of its own in the panel, its preview the confirmation; Archive undone by the same button, which stays; **Delete asks at its button** (`ConfirmAtButton`), since a delete unbinds readers and frees plan buckets and has no undo, and is not offered on an account that holds transactions | ordinary-app delete; nothing hidden until hover |
| Accounts: the merge panel, a bar at the foot of the screen | **moved** into the side panel | never a bar at the foot (D-617) |
| Accounts: the settlement and transfer queues above the list | **cut**: Home's waiting list answers both (`SettlementLine`, `TransferLine`), one click away; `answer_transfers` and `set_card_payers` in a conversation | the same queue in two places |
| Accounts: a card with no number, a red chip only | **kept** the chip, and the card is one line of a `WaitingList` under the answer, *Add its number* opening its form at the field | what waits on the person is one strip below the answer |
| Assistants: ten tool groups as lists, 1,081 words over five windows | **moved**: one row a group with its count, **each opening its tools beside the page**; the snippets stay, the desktop one folded to its first lines behind *Show it* | a reference list one click behind its heading (U2's inventory) |
| Language, Calendar, Export, Local model: an eyebrow, a title and a paragraph | **cut** the eyebrow; the paragraph is the answer sentence or the row's hint | D-614 dropped eyebrows; the answer first |
| Packs: the first pack offered filled, whatever the document keeps | **kept** filled only for a pack to bring up to date, or while the document keeps none; each pack a row with its button at the row's end; *its 1 formats* counted properly | a document keeping the ledger is not told keeping another is its next step |
| The front door: a centred title, two boxed cards | **kept** as a page of its own: *Make or open a document*, the answer in one sentence, then three rows — *New document* (the one primary), *New ledger*, and **Open…**, which the front door never offered — and Recent as rows that open, with each one's folder | the three ways in, said by what each is for |
| A document with no ledger: centred English | **kept**, set as every screen's title and answer, its words the catalogue's (it was English in Hebrew) | answer first; a translated screen |
| The guide's first step: *Drop statements, paychecks and fund reports here*, on Home's band | **kept**, as *Read statements, paychecks and fund reports* at *Home › Read files*: press Read files, or drop the files anywhere in the window | the band left Home (D-616) |
| The guide's *Put away* note: an inverted bar at the foot of the window | **moved** to where the guide stood, a small note that fades | near where it happened, never at the foot |
| The guide's forward button, filled on its last step | **never filled**: secondary when the step is done, quiet when it is a skip | the screen under it has its own one primary |
| The notice *13 answers wait on Home*, on every screen but Home | **kept only for answers that change the month's totals**, said as that (*2 answers on Home change this month's totals until they are given*) | Home's waiting list says the rest a strip below its answer; the bar is for the thing it was made for (D-367) |
| The palette: *Search every entry, or go to a screen…*; *Import a statement…* | *Go to a place, find an entry, or do something…*; *Read files…* | what it does; one name for reading |

**Ctrl+K's "or ask" is not built, and the palette does not pretend to it.** Answering a question
needs a model; offline, the app's only one is the local model, which is off by default, desktop-only
and answers nothing in the palette. An assistant answers through Assistants' tools, in its own
conversation. So the placeholder names what the palette does — go to, find, do — and asking from
it is left as a question.

**Why.** The person's first minute asks three things: what do I make, where do I put a file, and
where is everything. Each page now answers its own question before it offers anything, and every
interaction does what an ordinary app does: a row opens beside the list, one value changes where it
is, a form takes the panel, a delete that cannot be undone asks at its button, and nothing is a bar
at the foot of the window.

**Alternatives rejected.** Delete with Undo on Accounts — a delete unbinds the readers bound to the
account and frees the plan buckets pointed at it, and putting those back is a new write with no
conversation half (`deleteAccount`); a confirmation at the button is the honest one. A chevron on
every read-only `ChoiceField` (the taste check's) — it changes a kit default, M64 F2's to decide.
*Go to, or ask…* with a row that copies the question for an assistant — it would answer nothing.

**Where.** `src/ui/settings/SettingsPage.tsx`, `src/ui/screens/Accounts.tsx`, `Mcp.tsx`, `Packs.tsx`,
`Language.tsx`, `Calendar.tsx`, `Export.tsx`, `LocalModel.tsx`, `NoLedger.tsx`, `EmptyDocument` in
`src/App.tsx`, `src/ui/guide/Guide.tsx`, `src/data/packs/ledger/guide.ts`, `src/ui/Notices.tsx`,
`src/ui/commands.ts`, the catalogue's `settings`, `chrome`, `guide` and `palette` (en, he),
`.fc-guide-toast` in `tokens.css`, `docs/redesign/budget.json` (seven routes off `exempt`).

## D-625 · 2026-11-26 · The engine's formats are the report: the formats list and a format's table each answer first in one sentence (how many kinds of things, how many rows and whether they are right), what waits is one strip below, the shape, a rule set's preview and a new view or chart open beside the rows, and a row deletes at once with Undo near it (the next entry opening after a delete from its entry) while a format's delete, which cannot be undone, asks at its button <a id="d-625"></a>

**Context.** M64 U13 redesigned the engine's formats list, a format's table, its entry and its
input view after Home (D-616) and Transactions (D-618), on `custom.emd` and `project.emd`. The
maintainer named one thing himself (2026-11-25): deleting a row from its entry, the row chosen
inside a filter, opened a confirmation in a bar at the foot of the screen. D-617 says a delete
deletes at once with an Undo near where it happened, and asks only where no undo exists — at the
button, naming the thing.

**Decision.** *Formats* says *This document keeps N kinds of things* in one sentence, with the rows
in all and whether their claims hold under it, and lists the formats as a data table (rows and
columns right-aligned; *Last changed* and *Claims* drawn only when some format has one); a change
waiting for an answer, a format this build cannot read and a table nothing declares are the
waiting strip, each opening beside the list. Edit is cut (it went where the title goes). *A
format's table* says how many rows, how many match a filter, how many things look wrong and
whether the claims hold, in one sentence under its title; one line under it keeps its place and
says the columns and readers, or *Deleted X · Undo*. With no claim yet, the empty *Claims* band
is one *Add a claim* action in that line. The shape editor (a column, the claims, the order), a
rule set's preview and the view and chart forms from the + open in the side panel, never as a
band at the foot. **A row's Delete deletes at once** — from the table (its icon, or Delete on the
cursor's row) and from its entry — and *Deleted X · Undo* (Ctrl+Z too) stands in the table's line
or in the entry's bar; from an entry, the next entry the list holds opens (its filter and order
kept), else the one before, else the view it came from. The deleted rows are a stack, so a second
delete never makes the first permanent, and Undo writes the row back whole, its id included,
through the `insertRows` a row is added by. A row another entry links to is refused at its own
Delete, naming what links to it; a format's Delete asks at its button (`ConfirmAtButton`), since
its table cannot come back.

**Why.** The answer first and the detail beside the page is the approved pattern (D-616, D-618);
an Undo where the delete happened is what a desktop app has taught people, and a bar at the foot
of the screen is what the maintainer found strange.

**Rejected.** A confirmation before every row delete (an undo exists, so it asks for nothing); a
new engine write to restore a row (re-inserting with its id is the write the screen and the tools
already share, so parity holds); turning the table's cursor Delete off (the sheet's stored rows are
not edited in their cells, so Delete on a row means the row, as in a mail list).

## D-626 · 2026-11-26 · The engine's views are the report: the board, the list, the roadmap, ready, the agenda, the dashboards and the connections each answer their question first in one sentence at the lede step under the title; a card moves at once with Undo in the bar above the lanes, a dashboard's block is removed at once with Undo, and a connection opens as a form in the side panel beside the graph instead of a band across its foot <a id="d-626"></a>

**Context.** M64 U14 redesigned every view of a format beyond its table (board, list, roadmap, ready
to start, its dashboard) and the document's dashboard, agenda and connections, on `project.emd` and
`custom.emd`, after the formats and the table (D-625). The maintainer's words for this unit
(2026-11-25): every view's delete, move and bulk action behaves as ordinary apps do — at once with an
undo, a question only where no undo is possible and then at the button, never a bar at the foot of the
screen. The connection window was exactly that bar.

**Decision.** Each view says its answer first, at the lede step under the title, in the catalogue's
words (`views.*`, `src/ui/formats/viewAnswers.ts`): the board how many cards in each lane (*3 planned
and 4 built.*), the list how many are open and done, the roadmap its rows by state and each fold's rows
done, ready how many can start and how many are held (what *ready* means on the answer's hover), the
agenda what is overdue and how many rows lie ahead, a dashboard how many blocks it holds, connections
how many formats and connections. On a board, a list and a dashboard the table's claim verdict leaves
the sentence (a failing claim still shows in the table's own answer, one tab away); what looks wrong
stays on the board and the list. Roadmap and ready carry the table's header (title, answer, one caption
line), so a format's tab strip stays put between tabs; their in-view counts, kicker and the board's
explanatory sentence are cut. **A card moves at once** and *Moved X to Y · Undo* (Ctrl+Z too) stands in
the bar above the lanes, where a refused move says why instead of a band that pushed the lanes down. **A
dashboard block is removed at once** with *Removed X · Undo* above the blocks. **A connection opens in the
side panel** beside the graph, its delete asking inside that panel where its Delete was pressed; each
connection in words is one line, its column on hover. The nine routes leave the budget's exempt list.

**Why.** The answer first and the detail beside the page is the approved pattern (D-616, D-625); a move
or a removal that can be put back needs no question, and a band across the foot of the screen is what
the maintainer found strange.

**Rejected.** Keeping the table's claim verdict in every view's sentence (it answers the table's
question, not the board's); showing ready's rule as a caption (over the route's word budget, and the
answer's hover says it); a confirmation before removing a dashboard block (nothing stored is lost).
## D-627 · 2026-11-26 · An entry and an input view read as a form: every writable field wears a hairline under it at rest, Add sits under the fields, the list's + is the one way into a new entry, an input view's Fields is a form in the side panel, the table's filter is a funnel beside a boxed search, and the formats screens say every word through the catalogue, in English and Hebrew <a id="d-627"></a>

**Context.** U13's taste check (D-625) found the entry and the input view hard to read as forms:
their fields had no edge until pointed at (D-294), a date's placeholder was cut off, an amount sat
at the far end of a wide box away from its name, Add and Cancel were a band at the window's foot
about 580px below the last field, a new entry could be begun four ways on one page (the list's +,
its *Add a card charge* line, the draft line, Add), the input view's Fields was a column of the page
rather than the side-panel form D-617 names, the table's *Filter by* and *Search* were two identical
boxes side by side, and every empty foot row of the sheet printed its currency. And U13 translated
only its own new words: the table, the entry, the input view, the sheet, the filter band and the
shape panel still said English inline.

**Decision.** A writable field on an entry or an input view has **a hairline under it at rest**
(the amount input's look), the box when pointed at and the accent when typed in; a read-only one
has none. A figure's field is as wide as what is in it, so it sits by its name; a date's field is
wide enough for its placeholder. **Add (and Cancel, or Save for a new input view) sits under the
fields**, with what it refused beside it. **The list's + is the one way into a new entry** on an
entry's page, and it is not drawn while a new one is open; the entry's list draws no quick-add
line (the List view keeps its own). **An input view's Fields opens in the `SidePanel`** — Esc
closes it before it discards a new view. On a format's table **the filter is a funnel with no edge
at rest and the search the boxed field with the glass**, as the entry list's search is. An empty
foot row's currency shows once a figure is typed or the cell has focus. And every word of the
formats screens — `FormatRows`, `DeclaredFormats`, `EntryView`, `EntryList`, `RowSheet`,
`FilterBand`, `InputView`, `ShapePanel`, `WhatLooksWrong` — is the catalogue's (`formats` area,
English and Hebrew), with document values in `Bidi` inside one sentence each; the files are on
`src/i18n/words.test.ts`'s list.

**Why.** The redesign's forms answer *what is this one row* and *how do I add rows quickly*: a
form a person cannot see the fields of, whose button is out of sight, with four doors to the same
room, fails both, and an ordinary desktop app has taught everyone the opposite. The hairline is the
rule row's amount input applied to every field, so the entry keeps one look and a filled entry
still reads as text.

**Rejected.** A full box on every field at rest (it turns a filled entry back into a form of
boxes, which D-294 removed for good reason); keeping the quick-add line and dropping the + (the
quick add writes a row without opening it, which is the List view's job, not the entry's); a
dialog for Fields (a form never floats in a dialog, D-617).
## D-628 · 2026-11-26 · Undo of a delete on Rules and Categories brings the thing back whole — its id, its place, its count, its colour, the built-in rules that went with it and the rows that named it — through the create that makes one, handed what the delete took, over an engine pair that reads a row before it goes and puts it back; the rule editor, the test box, re-applying and New category choose with ChoiceField and still take a paste <a id="d-628"></a>

**Context.** M64 U11 rebuilt Rules and Categories (D-623) with a delete that happens at once and an
Undo where it happened, the maintainer's convention (D-617). The Undo made the thing again with
`createRule` and `createCategory`: a rule came back at its place in the order but with a new id and
its hit count at nought, and the rows it had filed named no rule; a category came back with its
name, kind, parent and colour but at the end of its siblings, and a built-in rule that pointed at it
stayed gone, recorded removed so no later build brought it back. M64 F5 asked whether a restore
that keeps all of it is worth a repository write and its plugin half (D-234). M64 F6: the side
panel's forms still drew the platform's select (a rule's kind, account and currency; the test box's
currency and account; re-apply's account and month; New category's kind).

**Decision.** **Undo brings it back whole.** The engine gains a pair beside `deleteRows`:
`takeRows` reads what a delete will take — each row as the table has it under its own id, which of
them the pack had seeded, and every link another row has to one of them — and `restoreRows` puts
that back: the rows by `insertRows` with their ids, the pack's record to seeded again, and each link
where its row is still there and still empty. `deleteRule` and an unused category's
`deleteCategory` read first and hand back what they took (`DeletedRule`, `DeletedCategory`; a
delete that moved what used the category hands back nothing, and has no Undo); **`createRule` and
`createCategory`, handed that, make it again** — the same id, priority, hit count and last match;
the same sort order, colour and icon, and the built-in rules with their seed records. A second Undo
finds it there and changes nothing. The forms choose with `ChoiceField` through one small field
(`PickField`) that shows the chosen label, stays a text field, and picks the choice a pasted or
typed label or stored value names; a list longer than eight is an autocomplete.

**Why.** An Undo that brings back something slightly different is a second, quieter loss — a rule
whose count starts over and whose rows say *a rule since deleted* is not the rule that was deleted.
**No new ledger write**: the Undo of a delete is a create of what was there, so it goes through the
write that makes a rule or a category, which the screen and `create_rule` / `create_category`
already share — the parity ratchet holds at 65 — and `restoreRows` is the inside of those two,
listed in `THROUGH_ANOTHER`. `insertRows` alone, which D-625's row Undo uses, does not give back
the seed record or the links a caller cleared before the delete, which is what *whole* needed here.

**Rejected.** Separate `restoreRule` / `restoreCategory` writes (one more screen-only write each,
against a ratchet that only falls, and a conversation has no Undo to reach them with: its way back
is the `.bak` every committed write copies first); keeping the snapshot in the document (a delete is
a removal, D-266); bringing back an unused category's past corrections into it and its re-apply
undo rows, which `forgetCategory` deletes rather than clears (history nobody can see, M64 Q36);
`ChoiceMenu` for the forms (read-only, so a paste would not land).
## D-629 · 2026-11-26 · Wealth's forms open beside the page and ask the few fields a person types first: the balance and its date for a fund's reading, said back in words against the last reading as it is typed, with the rest of the report one verb further and grown in place; the fund, goal, movement, debt and payment forms take the same shape (`PanelForm`), and the details take the report's ink and ramp <a id="d-629"></a>

**Context.** M64 F3. U10 rebuilt Wealth's four screens and left their forms as they were: six
full-page editors (a fund, a reading, a goal, a movement, a debt, a payment), each taking the page
and asking every field it has at once, in a grid sized by the viewport. The maintainer, 2026-11-26:
*"adding readings to funds and such, looks like the old, same as the paychecks by hand."* A fund's
reading was the worst of them: a dozen boxes, three to a row, for a report whose one figure everyone
has is its balance.

**Decision.**

1. **A form with several fields is a `PanelForm` in the `SidePanel`** (D-617), the page behind it.
   Enter saves, Esc or Cancel leaves, and saving closes the panel on the screen it was opened from;
   one panel at a time (a form opening puts the fee or deposit panel and a fund's pane away). Its Save
   is a secondary button: the page keeps its one primary, as Accounts' forms do (D-624).
2. **Three pieces, in this order**: the few fields everybody fills; **`Said`**, one sentence of what
   the figures typed so far mean; and **`MoreFields`**, the rest, folded under one verb with what is in
   it said beside it, grown in place by grid rows. A reading asks its balance (the amount as the hero
   of its input) and its date, and says *₪193,400.00 on 26 Nov 2026: up ₪3,800.00 since 30 Sep 2026*
   against the fund's last reading before that date; deposits, fees, return, the three parts and a
   note are *More from the report*, with *empty is not zero* said there. A fund asks its name, kind,
   manager (made in place) and two fees, and says each fee against the shipped ceiling as it is typed;
   a movement asks its kind, amount, goal and holding; a debt its name, kind, what was borrowed and
   what is paid a month, said back as a count of payments *not counting interest*; a payment its
   amount and debt; a goal its name, where the money is, and a target said as a sum a month.
3. **Grids follow the form, not the window** (`@container`): one column in the panel, two or three
   where the same fields stand on a page of their own — a report read from a stack keeps its page
   (`SnapshotEditor` in `FlowFrame`, D-163/D-164), with the same fields.
4. **Choices are the app's** (`ChoiceMenu`, `ChoiceField` with *+ New…*), and a day is a text field
   that takes `2026-11-26` or `26/11/2026` and opens the platform's calendar under it on a click
   (`DateInput`), never the platform's date box drawn in the page.
5. **The details take the report's ink and ramp**: no `ink-tertiary` text, nothing off the type ramp
   or between the spacing steps, in the fund, goal and debt panes, fee impact, the deposit check, the
   net worth row's panel and `wealth/parts.tsx`; all of them are now on the surface sweep. The forms'
   words are the catalogue's, English and Hebrew, and they are on the translated list.

**The shape is for M64 F14 to follow**: a paycheck typed by hand is the same three pieces —
`src/ui/components/PanelForm.tsx` is a new file of the kit's, named for F2, which rewrites the kit
next. One change to the kit itself: `SidePanel` isolates its kicker (`Bidi`), since the forms put a
fund's, goal's or debt's name there.

**Rejected.** Keeping the full-page editors and restyling them (the maintainer's complaint is that
they take the page and ask everything at once). A wizard of steps (a reading is one screen of
figures, and steps hide the ones a report does state). Saying the balance against a *computed*
expectation (last reading plus deposits less fees plus return): reports print return net or gross of
fees differently, and a sentence that is sometimes wrong is worse than none.

**Left.** The details' own words (fund, goal and debt panes, fee impact, the deposit check, the net
worth row, the goal form's where-picker and cost basis) are still English: M64 F26. Focus after a
form opened from a row's menu falls to the page, since the menu item that opened it is gone.

## D-630 · 2026-11-26 · The kit catches up with the screens: a small button is the 32px chrome row on the body step, a choice wears a chevron and is never the platform's select, a value-shaped `ValueChoice` replaces Rules' `PickField`, the side panel's first Esc leaves a field and focus returns to the latest opener, a figure keeps its sign in Hebrew, the waiting notice is never filled; and a paycheck by hand is a `PanelForm` in Paychecks' side panel — month, employer, gross and net first, whether it adds up said in words, the slip's lines only if wanted <a id="d-630"></a>

**Context.** M64 F2, F14 and F23, built together because they share the kit. The screen units
U4 to U9 each found something in a shared piece and left it, since the kit was not theirs to change:
`Button size="sm"` and the waiting notice drew 13px, off the ramp, costing every non-Home route one of
its seven type sizes; the side panel's Esc closed it from inside a field and handed focus back to the
first thing that opened it; `SELECT` had no chevron, so a `ChoiceMenu` at rest read as a text field;
`SelectOrNew` and four other places still drew the platform's select; `Amount` lost its sign's side
in a Hebrew window and a selected row's marker stayed on the left; text in `ink-tertiary` was still in
the kit; PromotionPanel and the paycheck form carried inline English. F6 (D-628) had added
`PickField` beside the kit rather than touch it. And the maintainer, 2026-11-26: *"adding paychecks by
hand is still the old ui? could it be maybe easier?"* — the form was still a page of its own (D-620).

**Decision.**

1. **A small button is the chrome row** (`.fc-btn-sm`): 32px high, its tile 32px, its label on the
   body step like `md`'s. Nothing between the steps, and no type size of its own. `Button` forwards
   its ref.
2. **U4's two review entries, settled by DESIGN.md and the rows.** The waiting notice's *Open Home*
   is never filled: it points away from the screen under it, which keeps its one primary. The
   primary stays the filled split tile (*The button is a split tile*, *One primary action per
   screen*: accent-filled with accent-ink); comp A's hairline box is declined, since where the comp
   and a row disagree the row wins.
3. **A choice is the kit's, and looks like one.** `SELECT` carries `.fc-select`: a chevron at the
   end edge in `ink-secondary`, drawn by two hard-edged halves so it takes the theme's ink, and a
   platform select that is left loses its own arrow for it. **`ValueChoice`** — `PickField` made the
   kit's, with `MENU_MOST` — is a `ChoiceField` over a stored value: it shows the chosen label, picks
   what a typed or pasted label or value names, and takes `make` for *+ New "…"*. Rules, the test box,
   re-applying and New category point at it; `PickField` is deleted. `SelectOrNew` takes `choices`
   (with `group` headings) and draws `ValueChoice`; CategoryPicker's kind, PromotionPanel's cadence and
   debt, and the deduction picker are the kit's too.
4. **The side panel behaves as a desktop app's does**: the first Esc inside a field leaves the field
   (the focus goes to the panel, what was typed stays) and the next closes it; focus returns to the
   last thing outside the panel that had it, so a panel whose content was replaced gives the focus
   back to what opened the content shown. `WaitingList`'s `say` is a node, so a document's name can be
   wrapped in `Bidi` inside the sentence.
5. **Hebrew**: `Amount` and `CountingAmount` are isolated left-to-right, so the minus stays before the
   figure; `.fc-row-on`'s marker is at the start edge in a right-to-left window.
6. **Contrast**: the kit's text leaves `ink-tertiary` (CategoryPicker's empty value and its notes,
   `Field`'s label and hint, ChoiceField's group headings, ContextMenu's shortcuts) for `ink-secondary`.
7. **Words**: PromotionPanel's are `merchants.promotion`, the paycheck form's `paychecks.entry`, both
   English and Hebrew, a name or pattern from the document isolated in its sentence; the bill and
   debt forms save on Enter. Home's Taxes panel opens Paychecks on that month with its taxes beside it.
8. **A paycheck by hand is a `PanelForm` in Paychecks' side panel** (F14, replacing D-620's page):
   the salary month (`MonthInput`, `2026-06` or `06/2026`, the platform's month picker on a click),
   the employer (an autocomplete of the employers already on a slip), gross and net (the amount the
   hero of its input); then **whether it adds up, said in words as they are typed** (`ReconciliationSaid`
   replaces the pinned strip: idle, adds up, not itemized yet, or over, a gap never blocking a save, the
   difference one text action away as Other deduction); then the slip's lines **only if wanted**, a
   line at a time (the deduction an autocomplete grouped by kind with *+ New "…"* made in place, You,
   Employer and Base, a note on asking), a removed line gone at once with Undo; and *More about this
   paycheck* (the day it was paid, a bonus, a note) folded under one verb. Saving closes it on the
   screen, back to the panel it was opened from. **A read slip is confirmed in the same fields** on the
   reading flow's page (`PaycheckEditor` in `FlowFrame`, U7).

**Rejected.** A sixth place for the paycheck form (a dialog, or keeping the page): it is a form with
several fields, and D-617 puts those in the panel. A chevron image per theme (two copies of
`ink-secondary` to drift). Moving `sm` onto the caption step (12px is the label's neighbour, and a
button's word is read). A deduction line as a table row of five fields (it does not fit a 420px panel;
the line is a block of its own instead).

**Left.** Platform selects outside the kit's paths remain (PlaceEditor's kind and cash, and others
the screen units own); with `.fc-select` they wear the same chevron until each is moved.
## D-631 · 2026-11-26 · Plan has a Year beside its month, as Home has: each bucket's year is the sum of its months — what each month's plan gave it against what it got, January through the last month that is over, on the plan each month is on and Home's month basis — said first in words with the categories apart from the goals and debts, each bucket a meter whose months open beside the page, a month nobody could measure left out of both sums, and `plan_month` with a `year` answering the same; Plan's bar runs from the inline start, so in Hebrew it mirrors with its drag and arrow keys while the ring stays a clock <a id="d-631"></a>

**Context.** M64 F12 and F1, built together because both are Plan's. The maintainer, 2026-11-26:
*"in the plan i'd like a view that sums up the buckets of the year (meaning if i had a monthly bucket
id like to see how much total in the year went to the bucket out of planned)."* Plan answered one
month at a time; the year was nowhere. And Plan's bar forced `dir="ltr"`, so in Hebrew the split ran
left to right while every column beside it mirrored (F1).

**Decision.**

1. **Plan's views are a tab strip, Month and Year** (`#/plan`, `#/plan/year`), drawn from `nav.ts`
   like Home's — the same plan over a longer window, so a view, not a place.
2. **A bucket's year is the sum of its months** (`planYear` in `src/domain/planYear.ts`, pure): each
   month from January through the last month that is over (never past December) is worked out on
   the plan *that month is on* (`planOnMonth`) and measured the way one month is
   (`planAgainstActual`, on Home's month basis, D-607); the year adds them bucket by bucket. A month
   a bucket cannot be measured in — a free bucket, a category's month with no statement — **stays
   out of both its sums**, the rule `planVersusActual` keeps for one month, and is counted; a bucket
   no month could measure says so instead of a meter. A month in another currency is left out.
3. **The screen answers first, the categories apart from the goals and debts** (`planYearByKind`):
   spending past a category's plan is a problem, and more into a goal or onto a debt than planned is
   not, so one sum of both would call a paid-down loan overspending. *From January to October 2026,
   the categories went ₪3,885 over what their months planned. Goals and debts got ₪12,400 more than
   planned.* — then the categories' gap as the one display figure, then each bucket as a
   `PlanAgainst` meter in the month's two columns. Only a category over its plan is red; under or on
   it is said in words (a year that is over has nothing *left*), and a goal or debt says *more* or
   *less*. A bucket opens its months beside the page (D-617): each month's plan, what it got, how far
   over or under, and a total row that adds up to the meter. The year pages back; it pages forward
   only to the newest year with a month that is over.
4. **A conversation asks the same** (D-227): `plan_month` with a `year` reads it and writes nothing
   — the sentence, then a row per bucket with the months it went over and under. Both read
   `planYearAgainstActual`, so they cannot disagree.
5. **Plan's bar reads the way the page does** (F1): its segments run from the inline start, a drag
   is measured from the right edge in Hebrew, ← grows the bucket there (`arrowStep`) and ↑/↓ stay
   grow/shrink; the connector under the header band mirrors with it. **The ring is a clock face and
   keeps `dir="ltr"`**, and so does the morph between them, which therefore starts from the
   unmirrored bar in Hebrew.

**Rejected.** *The year on the plan on screen only*: a month on another plan would have been held
against a split it never had. *The current month in the sum*: a month half over reads as under its
plan by the half not yet spent. *A month with no statement counted as nothing got*: it would report
the bucket under its plan by exactly the months nobody could check.
## D-632 · 2026-11-26 · The engine's other views keep the format's one Add and one strip of controls, and say every word through the catalogue: Roadmap and Ready to start carry the table's Add behind the same refusal; the board's Lanes by, the roadmap's fold filters, In the order of, Columns and Fold all, and the ready list's Columns sit in one strip of the same classes under the tabs; a line or card left at its view's columns drops a state its group already says and a link its name already says; and a sentence the engine builds for a screen is a key and its parts, said by the screen <a id="d-632"></a>

**Context.** M64 F17-F20, after U14 (D-626) and F9 (D-627). Switching from Table or Board to
Roadmap or Ready to start lost the format's one primary Add; the roadmap's title row held three
fields and cut the fold's filter to *Filter unit b*; the board, the roadmap and the ready list each
drew their controls their own way. The taste check found the ready list's rows each saying PLANNED
under *Ready to start* and a unit's milestone `M2` beside its ref `M2 U3`, on the board too. And
probe:screens in Hebrew still found English on the board (47), the roadmap (24), ready (18), the
agenda (19) and the connections (73), and in sentences `src/domain/format` builds for a screen.

**Decision.**

1. **Roadmap and Ready to start carry the table's Add** (`FormatLinkViews`' frame): hidden behind
   the same refusal (`rowWriteRefusalOnScreen`, a read-only copy), and opening what the table's opens
   — the default input view, or a new entry. One primary on every view of a format.
2. **The views' controls are one strip under the tabs** (`VIEW_STRIP` in `BoardView.tsx`): the
   board's *Lanes by* and *Columns*; the roadmap's filters for what it folds (moved off the title row
   and wide enough to say whose rows), *In the order of*, *Columns* and *Fold all*; the ready list's
   *Columns*. *Columns* is a text action like *Fold all* beside it. A roadmap row's dot still folds it
   for the pointer, but the chevron is its one keyboard stop.
3. **A line or a card at its view's own columns says nothing its group or its name says**
   (`lineColumns.ts`): no state chip on the ready list when its ready state is one member
   (`chosenLines(…, grouped)`), and no link whose words are whole words of the row's name
   (`namedByRow`: `M2` in `M2 U3`, never in `M20 U1`). A column chosen under *Columns* is drawn
   regardless.
4. **The words are the catalogue's, in English and Hebrew**: `views` (board, list, roadmap, ready,
   agenda, day words, *Columns*), two new areas `connections` (the graph, *Every connection, in
   words*, the connection form) and `dashboards` (blocks, making one, a rollup), and `formats` (making
   a format, a column's questions, Show as, a range, the input view's kept and lacking sentences).
   Every file is on `words.test.ts`' translated list.
5. **A sentence the engine builds for a screen returns a key and its parts** (`Said<K>` in
   `view.ts`: `showAsKey`, `tickSaid`, `relativeDaySaid`, `dueSaidOf`, `figureRangeSaying`), and the
   screen says it with `t()`. `src/domain/format` imports nothing from `src/i18n`, not even a type
   (`boundary.test.ts`), so the keys are literal types `t()` checks where it is called. The English
   functions stay for the plugin, which answers a model in English; a function the screen also calls
   takes an optional `t` that defaults to English (`cellText`, `keptSentence`, `lackingSentence`,
   `creationOf`).

**The budget** for `#/formats/milestone/roadmap` and `#/formats/unit/ready` rises by what the Add
costs (an action, a word, the filled colour) — the brief asked for the Add, and the table's route
already pays it.

**Still English** (follow-ups M64 F35-F37): the connections' sentences built in
`src/domain/format/connections.ts` (`edgeWords`, the panel's headline, a column's endpoint hover),
the dashboard's helpers in `src/ui/formats/dashboard.ts` and the refusals of `madeInPlace.ts` and
`inputBlock.ts`, and quick add's placeholder in `listView.ts`; and type tiles (`TYPE_WORDS`).

**Rejected.** Keeping the Add on the table alone (switching views lost the one action the format
asks for). A per-view toolbar of its own (three looks for one job). Importing `MessageKey` into the
domain (the boundary forbids it, and a literal key type checks the same at the call).

## D-633 · 2026-11-26 · A figure that sums a period up carries its sign's colour — Home's left over and its sentence's two amounts, the Year's left over, Plan's to split, net worth, and a statement's gap in `negative` unless it is nothing — while every other figure stays ink; a list cut short grows in place and never opens the side panel; a plan's meter past its plan draws the plan as a tick and says the share in words; and the probe lays every line out afresh after stretching a page for its picture <a id="d-633"></a>

**Context.** M64 F11, F13, F32 and F33. The maintainer, 2026-11-26: *"some numbers could use their
colors (the negative/positive), not everywhere but for example the line that sums up the month"*,
and *"like the home clicking on the 'more' of what went out opening a side bar for the rest."* U4
(D-615) had made every figure ink (*Figures are ink, a flow is a mark*), Home included; D-617 already
said a list cut short expands in place, but Home's and the Year's *Where it went* still opened their
rest in the side panel. M64 F12's taste check found `PlanAgainst` capping its fill at the plan, so a
category at 105% and one at 213% drew the same full red bar. And probe:screens' long Hebrew pictures
of `#/plan` twice drew Hebrew with its letters in reverse order.

**Decision.**

1. **A figure that sums a period up is drawn in `positive` or `negative` by its sign** — an
   amendment of *Figures are ink*, not a reversal. The list, and nothing else: Home's left over (the
   display figure), and the two amounts of the sentence above it, came in `positive` and went out
   `negative`, the sign each gives the month; the Year's left over; Plan's *to split*; Wealth's net
   worth; and a statement's gap (the reading panel's *apart*), `negative` whenever it is not nothing,
   since a gap either way is the problem. Nothing is ink. `HeadlineFigure` takes it as `tone: 'sign'
   | 'gap'` (`figureTone`); the sentence's `SaidAmount` takes its tone. The tiles, the panels, the
   tables and every other figure stay ink, and the minus sign or the word stays beside the colour.
   The tokens' `positive` and `negative` hold AA on `background` in both themes (the probe measured
   no low contrast on `#/`, `#/year`, `#/plan`, `#/plan/year` and `#/wealth`, light, dark and Hebrew),
   and the colour each spends raises `#/`, `#/plan` and `#/wealth`'s colour ceiling by one.
2. **A list cut short grows in place** (`RankedBars`): its folded line (*8 more*, with what they
   come to) grows the rest where it stands, under a *Fewer* that folds them again; focus moves to
   the first grown row and back to the line. Home's and the Year's *rest* panels are gone, and with
   them `home.month.theRest`. The audit of every redesigned screen found no other *more* that opens
   the side panel: the waiting list's *Show n more* already grew in place; a dashboard block's *n
   more* opens the format's own view (a page, not the panel); the agenda's, the filter's, the
   reading verdict's and the gap panel's *more* are sentences, not actions.
3. **A plan's meter past its plan says how far** (`PlanAgainst`): under its plan a line draws as
   before; past it, the track is what happened and the plan a 2px ink tick across it, the part
   within the plan the usual fill and the part past it `negative` when it is over (the usual fill
   when going past is no problem, a goal reached); and the caption says the share,
   *₪271 over · 177% of the plan*. The kit's specimen draws 105%, 213% and a debt paid twice.
4. **The probe lays every line out afresh after a stretch** (`relaid` in
   `scripts/probe-screens-window.cjs`): once the window has grown to the page's length, it waits for
   the fonts and turns the document's direction over and back with a layout between, before the
   picture. The reversal was seen twice in about a dozen stretched pictures and never at the
   window's own height, never in the browser, and never in a small page stretched the same way; the
   probe is the one place the language changes on a page already drawn in English, so what the fix
   removes is any line ordered before that. Nine stretched Hebrew pictures after it read correctly.

**Rejected.** Colouring every figure by its sign (the maintainer: *not everywhere*). The flows'
colours on the sentence (a flow is a mark, D-615; the sentence's colour is the sign). A gap coloured
by its sign (a gap above the statement would look like good news). The rest in the panel with a
better title (the panel is for detail about a thing, not more of the same list). A meter drawn on a
fixed 200% scale (it would shrink every line under its plan). Stitching the long picture from
window-high slices (the rail and sticky headers repeat in every slice).
## D-634 · 2026-11-26 · A rule made outside Rules is made where it was asked for — Transactions and By merchant open Rules' whole editor in their side panel, save it there, and the note says it was made with Undo and *Open in Rules*, which opens that rule in its editor; the platform selects left outside the kit become `ValueChoice`; and a new paycheck opens on the month after the newest slip when last month already has one <a id="d-634"></a>

**Context.** M64 F15, F29 and F30. The maintainer, 2026-11-26: *"when creating a rule can we stay
at the screen where we wanted to create it? e.g im at transactions creating a rule for a
transaction. i dont wanna go to rules."* D-617 already said an action finishes where it was
started. Transactions made a merchant rule in place (the learning offer, a row's menu, the detail
panel's Make a rule), but its note appeared only when past rows were filed, its Undo took back the
rows and left the rule, and a provider heading's rule — from a row's menu or the detail panel — still
went to Rules; By merchant's *Write a rule for…* and a heading's rule from the editor did too. After
F2 (D-630) ten files still drew the platform's select. And Paychecks' Add by hand opened on last
month, which on the synthetic year already had a slip, so the form opened saying so.

**Decision.**

1. **A rule asked for outside Rules is made there** (`src/ui/rules/RuleFromHere.tsx`): the paths
   that went to Rules open Rules' own `RuleEditor` in the screen's side panel with the draft in it
   (`RuleFormPanel`), and save it there as Rules' save does (`makeRule`, origin USER, nothing
   re-applied). The whole editor, so a provider's broad rule still has its pattern, category and
   conditions on screen before it is saved (D-042) — the reason it used to go to Rules.
2. **The note that says it was made offers Undo and *Open in Rules***: on Transactions after every
   rule made there, the learning offer's included, whether or not it filed past rows; on By merchant
   on every filing that made a rule. Undo takes the rule away and the rows it filed with it.
   *Open in Rules* is offered, never done, and opens that rule in Rules' editor (router state
   `{ rule: id }`, checked by `arrivedRuleId`).
3. **The platform selects left outside the kit are `ValueChoice`** — PlaceEditor (kind, its cash),
   HoldingEditor, FixedExpenseEditor (4), CandidateCard, SplitPurchases, WorkedOut (2),
   FormatPicker, PointsAt (6), FeeImpact and DetailPanel (2): a filter past `MENU_MOST`, a paste
   landing kept, a select's empty first option a choice or a placeholder. None made a thing in
   place, so none gained *+ New*. The files are on `surfaceRules.test.ts`' `REVIEWED` list.
4. **A new paycheck opens on the month that has none** (`blankDraft` in `paycheckEntry.ts` takes
   the slips' months): last month, as F04 says, unless it already has a slip — then the month after
   the newest slip. The note about a second slip in a month stays for one typed on purpose.

**Rejected.** Asking first whether to go to Rules (the maintainer's *"maybe a popup"*): D-617 says a
dialog is only for what cannot be undone, and going elsewhere is offered as a link. Re-applying a
rule made from the editor to past rows (Rules' own save does not; the learning offer keeps its
ticked box). Opening a new slip on the month after the newest slip always (a gap before it would
then be skipped; last month stays the default).

## Related

07 Roadmap · [conventions](./conventions.md) · review · `docs/memory.emd` (the `decision` rows)

## D-636 · 2026-11-26 · A file is read through a door named for its kind and drawn with its glyph: Home's header carries *Read bank and card statements* (filled) with *Read paychecks* beside it — one button per kind, not one *Read files* that asks the kind; a fund report is read from its fund as *Read a fund report*; the palette names all three; a waiting line opens its own kind's reader; and a file picked or dropped anywhere is still read as what it is <a id="d-636"></a>

**Context.** M64 F16. The maintainer, 2026-11-26: *"i think there should be distinguishable
buttons between reading paychecks, transactions and such cause it can confuse users."* Home's
*Read files* and Paychecks' *Read paychecks* wore the same glyph; a fund's *Read a report* said
nothing of what kind; the palette had one *Read files…*; and Home's *No paycheck for {month}*
offered *Read files*, which sent a paycheck through the statements' batch first. The brief asked
for a decision: one *Read files* door that asks the kind, or one button per kind.

**Decision.**

1. **One button per kind, not one door that asks.** Asking adds a click to the commonest path
   (a statement, every month), puts a menu in front of the ledger tour's first click, and leaves
   the header saying *files* — the word that confused. Home's month is made of both kinds, so its
   header carries both: *Read bank and card statements*, the one filled button (*One primary action
   per screen*), and *Read paychecks* secondary beside it, which sends its files straight to
   `#/paychecks/read`. `Ctrl+Shift+O` and the tour's `read-files` stay on the statements' door.
2. **A kind's glyph wherever it is read** (`READ_GLYPH` in `ActionGlyph.tsx`): a statement is a
   sheet of rows with its amounts' column, a paycheck the note it pays, a fund report a page with
   its return climbing — no two alike, and none the old generic *read* arrow. They mark the doors
   (Home, Paychecks, a fund), *Add paychecks* on Read paychecks, a batch row's *A paycheck*, and
   the waiting lines' buttons.
3. **A fund report is read from its fund** (*Read a fund report*): it is read into one fund, and
   Home has no fund to name, so Home gets no third button.
4. **The palette names all three**: *Read bank and card statements…* opens the picker,
   *Read paychecks…* opens Read paychecks, and *Read a fund report…* opens the same picker, whose
   batch hands a report to the fund it names.
5. **A waiting line opens its own kind's reader**: *Read its statement…* for a missing statement,
   *Read paychecks* for a missing paycheck, straight to Read paychecks.
6. **What a door says is a promise about the kind, never a filter.** A file of another kind, picked
   through any door or dropped anywhere in the window, is still read as what it is — the
   statements' door says so in its title — and `#/read` keeps the name *Read files*, because it is
   where every dropped file lands, whatever its kind.

The guide's first step (`LEDGER_GUIDE`, so `guide_status` too) names both doors.

**The budget** for `#/` rises from 11 to 13 colours, which is what the second door's split tile
costs (its `hairline` tile and `hairline-strong` edge; measured 10 → 12 light, 11 → 13 dark): the
brief asked for a button per kind with its glyph, and *The button is a split tile* draws it so.

## D-637 · 2026-11-26 · A sentence the engine builds whose parts are sentences of their own is a `Spoken` — a key and parts that may be `Spoken` too — whose English the engine renders from a table the catalogue's English must equal; a helper in `src/ui/formats/` takes a `t` that defaults to English instead; and a sentence says a format by its title in Hebrew, never by an English plural <a id="d-637"></a>

**Context.** M64 F35-F37. After D-632 three places still built English for a screen: the
connections' sentences in `src/domain/format/connections.ts` (about 42 on `#/connections` in
Hebrew), a dashboard's own lines in `dashboard.ts`, `madeInPlace.ts` and `inputBlock.ts`, and the
list's quick add and date cell, with the type tiles. D-632's `Said` is a key and flat parts; the
connections' sentences nest — *Each {one} {adds}*, where *adds* is *counts {rows}* or *shows the
{kind} {name} of {rows}*, and the panel's headline wraps a link's sentence in *{head}, through
{column}*.

**Decision.**

1. **A nested sentence is a `Spoken`** (`connections.ts`): `Said`'s key and parts, where a part may
   be a `Spoken` itself. The key is a literal type (`ConnectionKey`), so the engine still imports
   nothing from `src/i18n/` (`boundary.test.ts`); the screen says it with `spoken(t, …)`
   (`src/ui/formats/spoken.ts`), which says each part first.
2. **One English, rendered twice.** `english(spoken)` renders the plugin's English from
   `SAID_ENGLISH` in the engine, and `headlineOf`, `edgeHeadline`, `edgeWords`, `linkSaid` and
   `graphOf`'s `says` and `detail` are that rendering, unchanged word for word.
   `src/i18n/connectionsSaid.test.ts` fails when `connections.said` in the English catalogue and
   `SAID_ENGLISH` differ, so the conversation and the English screen cannot drift. A refusal
   (`NOTHING`) carries its `said` beside its `reason`.
3. **A helper outside the domain takes a `t`** (`dashboard.ts`, `madeInPlace.ts`,
   `inputBlock.ts`), defaulting to English, as `linkedRowOf` and `keptSentence` already did — the
   plugin's `show_format view:dashboard` calls them without one and reads what it read.
   `filterWords` says a filter as `filterText` does, its own words the catalogue's and the columns
   and values the document's.
4. **A format is named by its title, never inflected in Hebrew.** English says *each work day* and
   *its work days* from `nounOf` and `pluralOf`; those endings are English, so every sentence gets
   the title in four shapes (`{Many}`, `{many}`, `{manyRows}`, `{ManyRows}`) and Hebrew says
   *כל שורה ב־{Many}* around the title as written.
5. **The list's date cell carries a `Said`** (`dueSaid`) beside `dueText`'s English, and quick add's
   placeholder its `words`, so `dueSaidOf` — which read `dueText`'s English back into a key — is
   gone. The type tiles, their headings and the units' kinds are `formats.type`,
   `formats.typeGroup` and `formats.dimension`; `TYPE_WORDS` stays the plugin's.
## D-639 · 2026-11-26 · Wealth's details spend only the list's seven type steps — a label is a caption, a figure that does not answer its section is the heading step, the one that does is the kit's tile step — and one primary: the fund detail's Add reading is secondary beside the list's; a detail route is budgeted by `:id`, whichever row it opens; a wealth tag is text and a dot; and a holding reading's refusal is a code and its parts, said by the screen <a id="d-639"></a>

**Context.** M64 F46 and F48. M64 F39's probe of year.emd with the budget found `#/wealth/funds/<id>`
drawing two primary actions (the list's and the detail's Add reading) and nine type sizes, and the goal
and debt details, `#/wealth/fees` and `#/wealth/deposits` nine sizes against seven. The detail routes had
no budget entries at all, and could not have: a row's id differs in every document made, so a key
written with one id budgets nothing anywhere else. And M64 F38 left a holding reading's refusals as
English sentences made in the data layer, the screen deciding a clash by
`message.startsWith('There is already a reading')`.

**Decision.**

1. **The detail spends the list's steps.** The list beside each detail already draws 12, 14, 16, 24,
   28, 40 and 88; the details added the label step (11) and the secondary-number step (20). A label
   is a caption, medium and uppercase, as the Funds list's column heads are. A figure that answers
   its section (a fund's balance, the deposit check's difference) keeps its size; the rest — a
   fund's paid in, earned, return and fee figures, the deposit check's two sides — are the heading
   step, so seven figures no longer stand at one size under the hero; a goal's name and the fee
   panel's figures are the kit's tile step (title, medium). The debt line's axis words, 10px
   ink-tertiary inside a scaled drawing, are caption words outside it.
2. **One primary.** The fund detail's Add reading is secondary: the list beside it holds the
   screen's one filled button (*One primary action per screen*).
3. **A detail route is budgeted by `:id`.** In `docs/redesign/budget.json` a segment written `:id`
   stands for any one segment (`limitsFor` in `src/ui/probe.ts`); a route's own key still wins.
   `#/wealth/funds/:id`, `#/wealth/goals/:id`, `#/wealth/debts/:id`, `#/wealth/fees` and
   `#/wealth/deposits` have limits at their measures with a little room, and pass light, dark and
   `--lang he`.
4. **A wealth tag is text and a dot** (*A chip is text and a dot*): `Tag` in `src/ui/wealth/parts.tsx`
   lost its border and its coloured words; the tone is the dot's, and only a problem colours the words.
5. **A holding reading's refusal is a code and its parts** (`ReadingRefusal`, D-632's rule): the
   repository hands back `NO_HOLDING`, `VALUE_NOT_KEPT`, `TWO_CURRENCIES` (cost, value),
   `QUANTITY_NOT_KEPT`, `BAD_PRICE`, `CASH_VALUE_ONLY` (holding), `NO_STATEMENT` and `CLASH` (day,
   held); `HoldingReadingError` carries it, the screen says it from `wealth.holdingReadings.refused`
   in English and Hebrew and offers Replace on the code `CLASH`, and the plugin and the statement
   reader keep their English through `readingRefusalText`.

**Left for later** (from the taste check): the payoff month the debt detail says and the one the
list says disagree (M64 F58); the fund detail's month and period tables and the readings table are
wider than the detail's column (M64 F59); the fund and goal details do not yet say their answer
first in words (M64 F60).

## D-640 · 2026-11-26 · A debt's payoff month is one calculation, `payoffMonth` in `src/domain/debt.ts`, which the debt's detail and the Debts list both read: the payments still to make start in the month after the newest one already recorded, or this month while this month's has not landed <a id="d-640"></a>

**Context.** M64 F58, found in M64 F46's taste check on year.emd: the Car loan's detail said *Clear by
February 2027* while the Debts list beside it said *Paid off Mar 2027*, both at ₪2,000 a month. Each
counted the month itself. `projectPayoff` (the detail, the `debts` and `debt_projection` tools) took
`from + months − 1`, its comment saying a debt with one month to go finishes this month; `debtStatus`
(the list) took `from + months`.

**Which was right.** On year.emd, built on 25 November, the loan is ₪36,000 and has been paid ₪2,000 a
month for fourteen months — the standing ₪1,000 on the 12th and Plan's ₪1,000 extra on the 1st — so
₪8,000 is left: four more payments. The balance already has November's two in it, so the four are
December, January, February and March. The list was right; the detail named November as a payment
month though November's payment was already subtracted. Neither rule is right always: on 5 November,
with October's payment the newest, the four are November to February, and the list would be a month
late.

**Decision.**

1. **One calculation.** `paymentsToClear(left, each)` counts the payments (ceiling division on minor
   units; 0 when nothing is left, nothing when nothing goes in or past the 600-month horizon), and
   `payoffMonth(from, payments, lastPaid)` names the month the last lands in. `projectPayoff` and
   `debtStatus` both call them; `DebtLine` carries `lastPaid`, from `lastPaymentMonth`.
2. **The count starts after what is already in the balance**: the month after the newest payment in
   the debt's currency when that month is this one (or later), otherwise this month. A debt with no
   payments, on its expected figure, starts this month.
3. **Pinned twice**: the domain cases in `src/domain/debt.test.ts` and
   `src/data/repositories/debtPlanRepository.test.ts`, and `src/demo/year.test.ts`, which builds the
   synthetic year and checks the detail's month and the list's month are both March 2027.

**Left as it is.** The two screens still choose their monthly figure apart: the detail prefers what
was paid lately and falls back to the debt's expected payment; the list prefers the standing order
and adds Plan's extra. On year.emd they agree (₪2,000 each way); where the observed rate and standing
order plus extra differ, the months still can (Q75).

## D-642 · 2026-11-26 · Every route is inside its density budget and none is exempt: the last, reading files onto a format, is redesigned with its question as its title and choosing files as its action, and its ceiling counts the two pickers the old measure missed; a question asked where its button was behaves as a popover (`useAskHere`); the page's pictures of the ledger are retaken on the redesigned screens <a id="d-642"></a>

**Context.** M64 U15, the milestone's last unit: the tours replayed on the redesigned screens, the
page's pictures of the app retaken, `probe:screens --budget` passing on every route with nothing
exempt, and — the maintainer, 2026-11-25 — every screen's interactions walked once against D-617's
conventions. `docs/redesign/budget.json` still exempted one route, `#/formats/:name/read`.

**Decision.**

1. **Reading files onto a format is redesigned, and `exempt` is empty.** Its question — *how do I get
   a file into this format?* — is its title, *Read onto Card charge* (an `h1`, the format a link back
   to its table), with its readers under it. Choosing files is the header's action, filled while
   nothing is read (*One primary action per screen*), with *Choose a folder* beside it; the dashed
   drop zone and its three-line explanation became one empty sentence, the kinds of file moved to
   the pickers' title, and the whole page takes a drop (a dropped folder is still walked). Its words
   are the catalogue's (`formats.intake.*`, English and Hebrew); the rest of the screen is not yet.
2. **Its ceiling rises, and only its own.** The route was measured at 1 action and 3 colours because
   its two pickers were `<label>`s, which the probe does not count as actions; drawn as real buttons
   it measures 3 actions and 5 colours (the filled button's two). The limits are set to that, words
   are cut from 65 to 45, and no other route's ceiling moves. Hiding the pickers back in labels to
   pass would have been passing the probe, not the budget.
3. **A question asked where its button was behaves as a popover** (`useAskHere` in
   `src/ui/components/useDismiss.ts`): the confirming button has the focus, so Enter answers; Esc
   takes back the question and nothing else, so the side panel it was asked in stays open; a press
   outside takes it back too; and focus returns to the button that asked. The walk found five such
   questions that ignored every key — deleting a saved view (its tab), a dashboard's chart, a rail
   folder, a reader on the intake page, and a holding or a place in Net worth's panel, where Esc
   closed the whole panel under the question.
4. **The page's pictures are the redesigned screens.** `make-demo-shots.cjs` finds each region by
   the new screens' words: the split from *The split* to its sentence under the bar (September, the
   month a statement covers), Wealth and the Year from their answer sentences, and **the paycheck in
   place of *Where it went*** — the redesign cut that Sankey, so the reel's second picture is the
   paycheck's sentence, its net pay and the gross divided into its parts (`ledger-paycheck.png`).
   The posters are retaken too. The development recording is the maintainer's to record again.

5. **Every route passes on the document its ceiling was measured on**, light, dark and Hebrew: the
   ledger's and Settings' on year.emd, the card charge's on custom.emd, the project's views
   on project.emd. Agenda in Hebrew was one word over (48 of 47); its *Open formats* is *פתיחת
   הפורמטים* now, as the catalogue's other actions are said.

**Left as it is.** Connections deletes by replacing its panel with the question rather than asking
at the icon (Q32, already asked). The rest of the intake page is still English (F67). Two routes go over a ceiling
measured on year.emd when another document fills them: Packs on custom.emd, which keeps no ledger
(209 words, 3 actions, 5 colours against 200, 2 and 4), and a fund's detail on showcase.emd (22
actions against 20) — F68.

## D-645 · 2026-11-26 · Closing a goal that still holds money asks, at its Close, whether the money was spent: spent, `closeGoal` records the withdrawal of what it holds in each holding (a typed money-out row whose why is *spent on the goal*) and closes it in one write, undoable; not spent, it closes and the money stays held; a goal's panel takes money out beside money in; `close_goals` is the conversation's half <a id="d-645"></a>

**Context.** M64 F72. The maintainer, 2026-11-26, of a goal saved in the bank, reached and spent: *"i
saved up for x, and bought it. what am i meant to do with that goal, how can i free that money"*, and
then *"i dont see add a movement or record withdrawal when im on the goal side bar"*. The goal's
panel offered only Set aside and Already there; money out was two menus away, behind a row menu item
called *Add a deposit*; and Close left the goal's deposits held in the bank's split (`goalParts`
counts closed goals), so the cushion stayed short by money that was gone.

**Decision.**

1. **Close asks, where Close was pressed.** A goal that still holds money (typed or fed, never one
   that follows its holding) asks *Was the ₪X in {goal} spent?* — the row menu's Close turns into that
   question at the same point, as Delete's does (D-622); the panel's new *Close goal* asks in a
   popover at its button (`useAskHere`, D-642). Never a bar at the bottom. A goal holding nothing,
   or one that follows its holding, closes at once.
2. **Spent is one write**, `closeGoal` in `savingsRepository`: for each holding where the goal's
   movements net above zero, a typed negative deposit (`MANUAL`, dated today, its note *Spent on
   {goal}* in the person's language), then the close, all or nothing. No table changes: the deposit
   rows carry the withdrawal, which is what a person typing *Money out* writes. A goal that follows
   its holding (D-357) is refused a spent close while it holds money: its sale is its money out.
   Not spent, it only closes and the note says the money stays held.
3. **Undo is the note's, where it was done**: *{goal} closed, and ₪X taken out as spent · Undo*
   (Ctrl+Z too, eight seconds), deleting exactly the withdrawals written and opening the goal again.
4. **The panel takes money out beside money in** — *Money out*, its amount labelled *Took out* and a
   required *Why*, saying when it is more than the goal holds and recording it anyway. Its rows wear a
   *Money out* tag, and *How the balance is made* shows it as *Taken out* rather than a negative
   *Set aside*. A followed goal keeps its sentence that its holding's rows are its movements.
5. **The row menu's *Add a deposit* is *Record a movement*, "Money in or out of it"** — what the form
   it opens records.
6. **`close_goals` is the conversation's half**: several goals a call, `spent` required when a goal
   holds money, `reopen` to open one again, dry-run first. `setGoalClosed`, screen-only until now,
   has its tool, so the ledger's ratchet falls to 64.
7. **The panel's action ceiling rises from 20 to 22** (`docs/redesign/budget.json`), and only its own:
   *Close goal* and *Money out* are the two the maintainer asked for, and nothing else on it could go.

**Checked** on the synthetic year: a goal saved in the checking account's Cash, ₪4,000, spent and
closed — the cushion's left grows by ₪4,000, its split still adds up, and the account's own Cash is
its whole statement again.
