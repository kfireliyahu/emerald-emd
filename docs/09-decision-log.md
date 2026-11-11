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
| D-580 | 2026-11-11 | 50 / 30 / 20 is shown before it is made: every top-level category with its share, its part, what it comes to a month and why, each share changeable in place, the months named once; Make plan writes exactly that and Cancel nothing, and `start_plan` is the same proposal for a conversation | M59 |
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

## D-569 · 2026-11-10 · M58's answers: when two emerald servers are registered the plugin's stays and says once how to remove the other; recording, updating, claiming and landing rows commit on the first call while deleting and changing a format's columns still dry-run first; a decision row may name the files it affects, anywhere on the machine, and the closing pass checks each; the fixes ship as emerald-mcp 0.3.1; M57 is parked on its branch <a id="d-569"></a>

**Context.** A six-week usage report from a session outside this repository (2026-11-09, an inbox
row, triaged) found Emerald delivering what it promises at a cost every session pays: two copies of
every tool, every write made twice, long instructions and hook text, a hook a security plugin
blocked, and a decision that left a CLAUDE.md outside any repository wrong for days. On 2026-11-10
the maintainer parked M57 (the Google Drive connector) until he is ready to publish a hosted
service and turned to these. Numbered after the branch's D-563 to D-568 so the two never collide.

**Decision.**

- **Two servers: the plugin's stays.** It brings the hooks, the skills and the pane; at its start,
  when another emerald server is registered, it says once how to remove the other. It never edits
  the person's configuration.
- **Rows commit on the first call:** `record_format_rows`, `update_format_rows`, `claim_units` and
  `land_units` apply at once, judged as before, so a wrong value is still refused with its reason.
  `delete_format_rows`, `delete_format` and a change to a format's columns still dry-run until
  `commit: true`. This answers the dry-run half of *Dry runs and concurrency*; the concurrency half
  stays open.
- **A decision names the files it affects.** The development pack's `decision` format gains an
  optional `affects` list of paths, anywhere on the machine, and the closing pass greps each for
  the claim the decision made false. This answers *Decisions and the files they make wrong*.
- **They ship as emerald-mcp 0.3.1**, the maintainer running the npm publish.
- **M57 is parked:** U1 is on main; U2 to U5 are built and landed on `m57-drive-connector`, pushed
  and not merged; U6 waits for the maintainer.

**Rejected.** The standalone server staying (it brings no hooks or skills); every write committing
at once (a delete or a column change is the write worth previewing); narrowing the pitch instead of
naming files (the report's case was a real file a decision made wrong).

**Consequences.** The instructions, the tool descriptions, `docs/plugin.md` and the skills stop
telling sessions to dry-run rows first (M58 U3). A pack change means the pack's past and its test
follow (M58 U4).

## D-572 · 2026-11-10 · The server's instructions say only what a session needs before its first call — what moved went to the answer that needs it, and how to speak of a view is the drawing tool's first line alone; the SessionStart hook opens with one sentence <a id="d-572"></a>

**Context.** The six-week usage report D-569 answered found the instructions long enough that hosts
cut them off — this repository's own sessions see the ledger's block end in *[truncated]* near
2,000 characters — and the `SessionStart` hook's text mostly rules about how to speak of a view.
Every session paid for both before its first call. Measured on the built text: the full block
24,249 characters, `--engine-only` 14,677, the plugin's `--skills` 12,310; the hook's first line
534 bytes, and on a small document most of what the hook prints.

**Decision.**

- **The instructions keep what a session needs before its first call**: what Emerald is, when to
  draw, development planning, what it is for, where to start, how to work, the formats half's core,
  the ledger's files to ask for, and what is app-only. Measured after: 12,412, 9,222 and 8,275.
- **What moved went to the answer that needs it.** How to work a format out with the user is
  `declare_format`'s dry run (`DECLARE_ASK`); the units and converting across them were already
  `formats`' answer; how to claim and land a unit is `claim_units`' and `land_units`' descriptions;
  each ledger tool's detail is its own description, and the ledger keeps the rules no description
  says (a security is never recommended; `savings` before a broker statement; oldest first).
- **How to speak of a view is the drawing tool's first line alone** (`drawnLine`, D-489, D-493),
  which now also names hooks among what the person is never told. The instructions say to call
  `show_format` or `start_here`, that a hook's text drew nothing, and to follow the answer's first
  line, which is the model's.
- **The hook's first line is one sentence** (220 bytes): it is text, nothing was drawn, and to show
  any of it call `start_here` or `show_format` and follow its answer's first line.

**Rejected.** Moving the rest into tool descriptions (those are in context every turn too); a
hard 2,000-character block (development planning and how to work are answers a model gives before
any call); dropping a rule outright — each one moved or stayed.

**Consequences.** `server.test.ts` holds a budget for each block and pins `DECLARE_ASK` to the dry
run only. The hook's line reaches other projects when `emerald-mcp` is next published and pinned;
the plugin's own copy (`mod/inboxText.ts`) is cut as plugin 0.3.0+1.

## D-573 · 2026-11-10 · Recording, updating, claiming and landing rows write on the first call; `commit: false` asks for a preview; deleting and changing a format's columns keep the dry run <a id="d-573"></a>

**Context.** D-569 settled it: a six-week usage report counted about 360 updates against 175 new
rows, each sent twice — once to see the diff, once with `commit: true` — and the second call never
caught anything the first did not, because the judging is the engine's: types, bounds, members,
links, `expect`, all checked again inside the write and the whole batch refused with its reason.
The open question *Dry runs and concurrency* (D-549) asked when a write may skip its dry run.

**Decision.**

- **`record_format_rows`, `update_format_rows`, `claim_units` and `land_units` write on the
  first call** and answer with what they wrote. The judging is unchanged: a refused batch writes
  nothing and says why, and the copy before a write is taken as before.
- **A caller asks for a preview with `commit: false`, explicitly** (or the string `"false"`); the
  answer is the dry run it always was. One switch, `writesNow` / `WRITES_NOW_PROP` in
  `src/plugin/tools/tool.ts`, used by those four tools and nothing else.
- **Every other write keeps the dry run until `commit: true`**: `delete_format_rows`,
  `delete_format`, `declare_format`, `extend_format`, `connect_formats`, `read_onto_format`, and
  the ledger's own tools, which share no switch with these four and are left as they are.
- The instructions say so in two lines, `start_here`'s write line too, and the skills that said
  "dry run, then `commit: true`" for these tools now say one call.

**Consequences.** A session writes what the person said or agreed to in one round trip; a batch it
inferred it still puts to the person first, in the conversation rather than as a second call. The
open question's concurrency half — parallel writers, ids a text document renews — stays open.

## D-574 · 2026-11-10 · What stopped the SessionStart hook in the usage report is not known, so the hook is unchanged; what it does that a security tool notices is written down, and the plugin and its message are an open question <a id="d-574"></a>

**Context.** The 2026-11-09 usage report said a security plugin in the host blocked emerald's
SessionStart hook (M58 U5). It names no plugin and quotes no message; nothing here reproduces it.

**Decision.**

- **No change to the hook until the cause is known.** Neither security plugin in the official
  marketplace (`security-guidance`, `claude-security`) hooks anything that could stop another
  plugin's SessionStart hook, and a SessionStart command hook cannot stop another. What can is a
  hooks module answering `classic.SessionStart` without `next` (proved in M56 U2), or something
  outside Claude Code: endpoint security or a package firewall refusing `npx` or `node`.
- **What the hooks do that such a tool notices is in `docs/plugin.md`**: `npx -y` fetching and
  running a pinned package at every start (skipped where the hooks module runs); `node` starting a
  child, through `cmd.exe` only where npm's `npx-cli.js` is missing; `no-server.mjs` reading
  `~/.claude.json` and the desktop app's configuration (D-571); and text telling the model what not
  to say to the person (D-493). Each was decided for its own reason, and none is reversed on a guess.
- **The open question *Which security tool stopped the SessionStart hook*** asks the maintainer for
  the plugin and its message.

**Consequences.** A person whose security tool stops the hook loses `start_here` at the start and
can still call it. Once the tool is known, the fix is chosen against what it actually refuses.

## D-575 · 2026-11-11 · The ledger is unparked: M59 fixes what a second person hit on first use — a file with two cards made one account per card, the provider's category and leaving a row out working on By merchant, 50 / 30 / 20 shown before it is made, a page that never scrolls into blank, Guide me never opening by itself, and a shape unit that decides what a new document shows; Hebrew is M60, after it <a id="d-575"></a>

**Context.** On 2026-11-11 the maintainer tried the ledger with a friend — the first person other
than him to use it on her own finances. The screens were too much for her and for him; the main
workflows were not clear; Guide me got in the way; she asked for Hebrew. Six things went wrong, each
traced to code: an Excel holding two cards gave every row to one account (one header and one account
per sheet: `guess.ts`, `statementBatch.ts`, `commit.ts`); the provider's category could start a rule
on Transactions but not on By merchant, where she was; a card payment she left out of totals stayed
on By merchant (its query never reads the flag); the page scrolled into blank (`html` and `body` can
still scroll); and 50 / 30 / 20 filled the buckets from a hard-coded map it never showed. M54 U5's
35 open findings on the ledger's screens were already recorded and waiting.

**Decision.** Maintainer, 2026-11-11, taking every recommendation:

- **The ledger is unparked**, and M59 takes it from what she hit. M54 U5's open findings come in only
  where a M59 unit is already reworking that screen. Hebrew is its own milestone, M60, after M59.
- **A file with two cards** is split by card — a repeated header, a card-number line or a card column —
  into one account per card, and the preview says how many cards it found, with their last digits,
  before anything is written.
- **By merchant** shows each merchant's provider category as an action that writes a rule from it, and
  can group its list by provider category, so one rule covers many merchants.
- **A row left out of totals leaves By merchant**, as it leaves the Year screen; so does a merchant
  left out from By merchant itself.
- **50 / 30 / 20 shows its proposal before it makes anything**: every category with its share and why
  (a default for that category, or what went out under it a month over three months), each editable.
- **Guide me never opens by itself.** Its steps are the Getting started list on Home, ticking
  themselves as now, and the list can be dismissed.
- **The page never scrolls** past the app's frame.
- **A shape unit decides what a new document shows**: it names the main workflows (reading a
  statement, categorizing, seeing where the money went) and what a new document leaves out until it
  holds something (Paychecks, Wealth and Plan in the rail, for instance). It picks, marks its picks
  for the maintainer to judge after (as D-535 did), and a later unit builds them.
- **Her file is read where it is**, with her consent, to prove the two-card split; nothing from it
  enters the repository (D-390), and the test's file is made up in its shape.

**Consequences.** CLAUDE.md, `conventions.md` and the ledger's README stop saying it is parked.
Whether her document must keep opening across schema changes — so far the maintainer is the only
user, and old documents are never converted — is an open question, asked before M59 changes a
table.

## D-576 · 2026-11-11 · A ledger document made before a change keeps opening with its rows: from M59 on, a change to a ledger format or an engine table reaches an existing document as a kept pack already does (D-443) or by a migration, with a test on a document made before it; amends D-276 for documents from here on. Her statement file will not be available, so M59 U2 proves the two-card split on made-up files only <a id="d-576"></a>

**Context.** D-276 let old documents' data go: the maintainer was the only user, and carrying a
document across a change was effort spent on nobody (said again 2026-10-05: compatibility with an
existing `.emd` was never a risk, a unit or a test). D-575 brings a second person to the ledger with
a real document of her own, and M59 changes the ledger.

**Decision.** Maintainer, 2026-11-11:

- **Her document must keep opening.** From M59 on, a change to a ledger format or an engine table
  reaches a document made before it, with its rows: a declared format the way a kept pack is brought
  up to date (D-443: keeping it again adds what it grew and renames in place), an engine table by a
  migration.
- **The unit that makes the change carries the test**: a document made by the build before the change
  opens in the new one with its rows and figures intact.
- **Not retroactive.** Documents from before M59 are not converted; this protects documents from here
  on. A change that cannot carry a document forward stops and asks.
- **Her statement file will not be available.** D-575's reading of it where it is falls away: M59 U2
  proves the split on made-up files in both shapes (two card sections on one sheet; two sheets), and
  what her file looked like is known only from what she and the maintainer saw.

**Consequences.** The rule row *A document made before a change keeps opening* says it where a session
reads before touching a table (CLAUDE.md's rules block). The open question *A second person's
document* is answered. M59 U2's brief drops the step that asked for her file.

## D-580 · 2026-11-11 · 50 / 30 / 20 is shown before it is made: every top-level category with its share, its part, what it comes to a month and why, each share changeable in place, the months named once; Make plan writes exactly that and Cancel nothing, and `start_plan` is the same proposal for a conversation <a id="d-580"></a>

**Context.** D-575: a second person's first use of *Start with 50 / 30 / 20* made a plan whose
placements she never saw. The starter put seven seeded headings in a fixed share, saving and
debt-payment kinds by kind, asked only about the rest, sized each share by what went out over the last
three months with transactions, and reused a bucket already on a category — all of it invisible until
the buckets were there.

**Decision.**

- **The button opens a proposal and writes nothing** (`src/ui/plan/StarterProposal.tsx`): every
  top-level category with the share it counts as (Needs, Wants, Saving, Left out), its part, what that
  comes to a month of the last paycheck (else the salary that came in), and why in a few words —
  *Needs by default*, *A saving category*, *Debt payments are needs*, *You chose*; then *₪1,200.00 a
  month went out*, *Nothing went out, so no bucket*, *The only one in saving, so all of it* — and
  *keeps its bucket …* where a bucket already points at it. The months are named once, above the
  table. *Make plan* writes it; *Cancel* (and Esc) writes nothing.
- **Any share is changeable in place, not only the ones the starter could not place.** An answer
  overrides the starter's own placing; choosing what it would have chosen takes the answer back out.
  Income, transfers and the app's own headings stay out and say why. A heading of the person's own
  still has to be answered before anything is made.
- **One arithmetic, three readers.** `starterProposal` (domain) is the lines and the buckets of the
  same answers; `starterPlanProposal` adds the months, the basis, each bucket's amount and the buckets
  kept; `makeStarterPlan` writes it and is the one write both halves call. The words are the domain's
  (`starterWhy`, `starterWindow`), so the screen and the tool say the same.
- **Parity: `start_plan`** shows the same table and dry-runs; `shares` changes any category by id or
  name; `commit: true` makes the plan; refused once a plan exists.
- **M54 U5's rows on #/plan where this touched them**: the no-plan state is an h1, one sentence and
  the two ways in; the starter's rounded choices are square; Plan.tsx's five `<select>`s are
  `ChoiceMenu`s.

**Rejected.** A modal for the proposal (it is the screen's own task, with nothing behind it to
protect); defaulting an unplaced heading to wants (a guess the person cannot see is the bug D-575
names); sorting the rows by share (a row would jump under the pointer that moved it).

**Consequences.** The tool count is 86 with the ledger. `docs/packs/ledger/f05-paycheck-splitter.md`
and `docs/plugin.md` say it.

## Related

07 Roadmap · [conventions](./conventions.md) · review · `docs/memory.emd` (the `decision` rows)
