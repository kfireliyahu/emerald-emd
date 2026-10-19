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
file in the same commit, and its index rows and every link to them become the plain D-ref;
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
| D-449 | 2026-10-09 | The installers say AGPL and carry every bundled package's licence: a build writes THIRD_PARTY_NOTICES.txt beside what it built, the app's id is `com.kfireliyahu.emerald`, and SheetJS comes vendored from its own CDN at 0.20.3, because npm's 0.18.5 is unpatched | [M43](#d-449) |
| D-450 | 2026-10-09 | Before the repository is public: another product is described by its category, never named, except a host Emerald runs inside, a runtime it speaks to and the maintainer's own story; outside code is not taken for now — issues and discussion are welcome, and a contributor agreement comes first if code ever is; there is no code of conduct; and security reports go to the address LICENSING.md gives | [M43](#d-450) |
| D-451 | 2026-10-09 | The chosen names land everywhere at once: a paycheck is never a payslip or a slip on a screen or in a tool, to categorize is never to file, a bill's form says bill, a link is made under *Links to*, a computed column under *Computed*, the table view is *Table*, a pack's list is *Ready to start*, the rail says *Assistants*, a backup is *Back up now*, a goal is a goal, a reader is never a mapping, and a source read is a file — a document is only the .emd | [M43](#d-451) |
| D-452 | 2026-10-09 | What a downloader is owed: Help opens the license and the third-party notices from the app's own files and an About that names the version, AGPL-3.0-only with no warranty, the source and the not-advice line; Source Code hands the repository — one address, read from package.json — to the system browser on a click; a tag builds the unsigned installers in CI with SHA-256 checksums and attestations; the privacy policy is PRIVACY.md | [M43](#d-452) |
| D-453 | 2026-10-09 | A fresh clone builds the same on every machine: every text file checks out with LF whatever core.autocrlf says, the notices are read from package-lock.json rather than from what npm ls prints, and the three dependencies with install scripts are declined in package.json, because nothing Emerald needs runs at install | [M43](#d-453) |
| D-454 | 2026-10-09 | No known advisory ships: the MCP SDK goes to 1.32 and React Router to 7, because no 6.x release carries the fix; a navigation is drawn as a transition, so the tour runner waits for the routed view to say it drew the address; the dev-only advisories left are major upgrades of build tools that never ship | [M43](#d-454) |
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
| D-481 | 2026-10-16 | The npm package is `emerald-mcp`, because it is the MCP server and nothing else; the repository stays `emerald-emd`, the file format's name, and the plugin and the desktop app ship under the project's name, so the three need no one slug | [M43](#d-481) |
| D-482 | 2026-10-17 | `format_sheet` is `show_format`, with no alias, because a host that defers tools shows a model only the name and the name has to say *show*; and the head of the server's instructions is a budget: both blocks say what Emerald is and when to draw within the first 2,000 characters | [M43](#d-482) |
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
| D-494 | 2026-10-18 | What only Claude reads lives in `hosts/claude/` — the hooks and the status line, the skills a stranger gets, and the plugin's manifest — built beside the server as `hooks.mjs` and `status-line.mjs`; nothing in `src/` or `electron/` imports from `hosts/`, and a host reaches the server only through `src/plugin/host.ts` | [M42](#d-494) |
| D-495 | 2026-10-18 | The repository goes public before the showcase, as one fresh commit with its history kept privately; what a visitor or a new session reads first says what holds, not who decided it; `docs/archive/` leaves the repository; and M33 U4 then deploys with GitHub Pages and a getemerald.dev record at Cloudflare | [below](#d-495) |
| D-496 | 2026-10-18 | A tour plays only while its frame is seen, and the frame decides it: the player holds the first step and pauses every hold while an `IntersectionObserver` on the frame's own document says less than a third of it is in view or the tab is hidden, so `?autoplay=1` means play when seen on any page that embeds it | [below](#d-496) |
| D-497 | 2026-10-18 | The MCP server is published as one npm package, `emerald-mcp`, that is `dist-plugin/` as built: every package bundled and no dependencies, a manifest generated from the root one, and a bin each for the server (`emerald-mcp`, full or `--engine-only` by flag), the hooks (`emerald-hooks`) and the status line (`emerald-status-line`) | [below](#d-497) |
| D-498 | 2026-10-18 | The Claude plugin is `hosts/claude/`, listed by a marketplace at the public repository's root and built by nothing: it pins the published `emerald-mcp` at the manifest's `version`, runs the server through `npx --prefer-offline`, and runs the hooks through `emerald.mjs`, a hand-written launcher that keeps a copy of the package in `${CLAUDE_PLUGIN_DATA}` and starts it with plain `node`; no `.mcpb`, because the directory no longer takes one | [below](#d-498) |
| D-499 | 2026-10-18 | The Claude plugin runs everything through npm: the hooks are `npx -y --prefer-offline -p emerald-mcp@<version> emerald-hooks …` and the status line `npx … emerald-status-line`, like the server, and `emerald.mjs` is gone; the cost is accepted — ~1.95 s before every prompt for the inbox hook on Windows, against ~0.35 s for `node` | [below](#d-499) |
| D-500 | 2026-10-18 | The server is listed in the official MCP Registry as `io.github.kfireliyahu/emerald`, from a `server.json` at the repository's root that a workflow publishes, signed in with GitHub OIDC, whenever npm has a version the registry lacks; a version is cut in `package.json`, `server.json` and `PLUGIN_VERSION` and pushed first, and the plugin's pins follow once npm has it, so they may trail the package and never lead it | [below](#d-500) |
| D-501 | 2026-10-18 | A unit left `in_progress` by a session that stopped is taken over with `claim_units take_over:<its taker>`, refused unless that taker holds it, with `started` reset and the taker replaced kept on `taken_over_from`; `start_here` lists a unit `in_progress` for more than a day as stalled; `land_units` refuses a landing with no `commit` unless it says `same_commit: true`, and keeps the builder's `report` on the unit | M51 |
| D-502 | 2026-10-18 | The desktop app makes no network call unless the person turned updates on, or pressed Check for Updates Now — then one request, to `api.github.com/repos/kfireliyahu/emerald-emd/releases/latest`, from a session of its own that the page never runs in, open only while that check asks; the setting is off by default and the app's, a newer version is a quiet notice in the window whose Download opens the release page, and M42 U9's download will reach `github.com/kfireliyahu/emerald-emd/releases/download/` and the asset hosts it redirects to (`release-assets.githubusercontent.com`, `objects.githubusercontent.com`) only on the same terms; amends D-124 and D-452 | [below](#d-502) |
| D-503 | 2026-10-18 | On Windows, with updates on, the app downloads the release its check found — `releases/download/v<version>/latest.yml` and `Emerald-Setup.exe` through electron-updater, in its own session, gated to that release while it downloads — checks the installer against the release's sha512, and installs only on Install and restart, after the window closes the ordinary way, reopening the document; macOS stays a notice; the installers lose the version from their names and the page links `releases/latest/download/` | [below](#d-503) |
| D-504 | 2026-10-18 | The Claude plugin ships the development pack's run-milestone, closing-pass and review-phase as generic skills beside this repo's own; its `version` is how an installed copy learns of an update, so a change to what it ships cuts one — `<pin>+<n>` for a plugin release with no package behind it, by `node scripts/pin-plugin.mjs --plugin`, the bare package version when the pins move — and `plugin.test.ts` fails when the shipped files' digest moves under an unchanged version; amends D-500 | [below](#d-504) |
| D-505 | 2026-10-19 | The Mac app is signed ad hoc after packing — `codesign --force --deep --sign -` from an `afterPack` hook, with `mac.identity: null` kept — so a download is an app Apple could not verify, which Open Anyway opens, rather than a "damaged" one, which nothing does; the release workflow fails a Mac build whose signature does not verify; no certificate, account or notarization, so D-124's unsigned stands; amends D-124 | [below](#d-505) |
| D-506 | 2026-10-19 | The MCP server says what Emerald is before it says what a pack is: both instruction blocks open on a format for any kind of thing and on what it reads (a spreadsheet, a `.json` of rows, a folder of Markdown notes read where it is), with `development` and `ledger` as optional packs; no tool or instruction measures work against money; the engine's tools are listed first in both modes; `create_document` keeps no pack unless asked, in both modes; reverses D-405's default | [below](#d-506) |
| D-507 | 2026-10-19 | The server says first what a model gains from a document — it asks for the matching rows instead of re-reading files, a typed field filters exactly, a link is followed, every session sees the same rows — and checks are one benefit among them, never the reason; whether something belongs is answered by its shape, never by whether it has numbers; amends D-506 | [below](#d-507) |
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

## D-449 · 2026-10-09 · The installers say AGPL and carry every bundled package's licence: a build writes THIRD_PARTY_NOTICES.txt beside what it built, the app's id is `com.kfireliyahu.emerald`, and SheetJS comes vendored from its own CDN at 0.20.3, because npm's 0.18.5 is unpatched <a id="d-449"></a>

**M43 U6, from a legal, privacy and security read of the repository before it is public.** Four
things a stranger's download would have got wrong, none of them visible in a test.

- **The copyright line.** `electron-builder.yml` still said *MIT licensed*, which D-430 replaced;
  the line lands in every installer's metadata. It now names the publisher and AGPL-3.0-only.
- **Third-party notices.** The bundles carry Apache-2.0 (pdf.js, tesseract.js, SheetJS, the Hebrew
  OCR data), MIT (sql.js, React, the MCP SDK) and OFL-1.1 (IBM Plex) code, and each of those
  licences asks that its text travel with the copy; electron-builder adds only Electron's and
  Chromium's. `scripts/third-party-notices.mjs` writes `THIRD_PARTY_NOTICES.txt` from the
  production dependency tree into `dist/`, `dist-plugin/` and `dist-demo/` at the end of each
  build, and **stops the build when a package declares no licence**. It lists the whole production
  tree, not what the bundler kept: a few lines too many is cheap, one too few is the breach.
- **The app's id.** `com.emerald.desktop` named a domain the project does not own, and D-129 had it
  as a placeholder that becomes permanent once anything ships: macOS knows an app by it and the
  Windows installer derives its uninstall key from it. Nothing has shipped, so it is
  `com.kfireliyahu.emerald` now, with `app.setAppUserModelId` beside it. A build already installed
  on a development machine under the old id is a separate app to Windows: uninstall it first.
- **SheetJS.** npm's `xlsx` stopped at 0.18.5, which carries CVE-2023-30533 (prototype pollution)
  and CVE-2024-22363 (ReDoS), and Emerald parses strangers' spreadsheets with it. The fixed
  releases are published only on SheetJS's own CDN. npm 12 refuses a remote tarball dependency by
  default (`EALLOWREMOTE`), so the 0.20.3 tarball is **vendored** at `vendor/xlsx-0.20.3.tgz` (2.4
  MB, SHA-256 `8dc73fc3…9fe8`) and `package.json` names it by path — the route SheetJS's own
  install notes give, and one `npm ci` takes offline. Upgrading is replacing the file.
- Rejected: `--allow-remote` on every install (CI's `npm ci` and every session would need it); a
  notices file kept by hand (it drifts the first time a dependency changes); generating notices
  from what the bundler kept (a plugin per build, for a saving of a few kilobytes).
- Left for M43 U7: the About that names the licence and the source, the not-advice line, releases
  built and checksummed in CI, and the privacy policy at its own address.

## D-450 · 2026-10-09 · Before the repository is public: another product is described by its category, never named, except a host Emerald runs inside, a runtime it speaks to and the maintainer's own story; outside code is not taken for now — issues and discussion are welcome, and a contributor agreement comes first if code ever is; there is no code of conduct; and security reports go to the address LICENSING.md gives <a id="d-450"></a>

**M43 U4, the rulings of 2026-10-08 ('all recommended').** A sweep of everything a
stranger reads, beyond the README (U1) and the on-screen terms (U2-U3), found four things only the
maintainer could settle.

- **Names.** The standing wish (*no competitor names: describe by category, keep the points as our
  own questions*) was a habit, not a rule, and `engine.md`, `product.md`, the ledger's market note,
  two code comments and the server's own instructions still named products. Now a `rule` row: a
  competitor is its category — *a spreadsheet*, *an all-in-one notes-and-database workspace*, *a
  notes app over plain Markdown files*, *typed, relational spreadsheet-databases*, *a
  bank-connected budgeting subscription*, *a licensed account aggregator*, *a design tool*, *a
  sync folder*, *another app or service that shares the name*. **Three kinds stay named**: a host
  Emerald runs inside (Claude, Claude Code, ChatGPT, VS Code, Goose), named as where it works; a
  runtime or protocol it speaks to (Ollama, LM Studio, llama.cpp, OpenAI-compatible), and a tool
  whose behaviour the code works around (a spreadsheet program's CSV encoding); and **the project's
  own story** (the notes-app prototype, the Notion trial, the pitch's *Excel*), in the maintainer's
  voice by design. `docs/archive/` and the decision rows are dated record, never edited, and keep the names
  they were written with. A mockup draws made-up institutions (*Everyday Bank*, *Second Bank*);
  the ledger pack's seeded institutions stay, because the readers match them.
- **Contributions.** The commercial licence of D-430 needs the maintainer to hold every line's
  copyright. A DCO only certifies where code came from, so DCO-merged code could never be
  relicensed without each contributor's consent; a CLA keeps the commercial licence at the cost of
  an agreement per contributor. So: **no outside code for now, issues and discussion welcome, a
  CLA before code is ever taken.** `LICENSING.md` and the README's *Contributing* already say it.
- **No code of conduct** while there are no outside contributions.
- **Security reports** go to the address `LICENSING.md` already gives (`SECURITY.md`); there is
  no server, so there is no response time and no bounty.
- Rejected: scrubbing the names from `docs/archive/` (a past entry is never edited, and one
  name-only pass would make every archived argument read as if it had been written that way);
  a DCO (it forecloses the commercial licence); a code of conduct with no one yet to hold to it.
- Left to the maintainer: the history rewrite (D-430's gate on M33 U4), and the README's wording (M43 U1).

## D-451 · 2026-10-09 · The chosen names land everywhere at once: a paycheck is never a payslip or a slip on a screen or in a tool, to categorize is never to file, a bill's form says bill, a link is made under *Links to*, a computed column under *Computed*, the table view is *Table*, a pack's list is *Ready to start*, the rail says *Assistants*, a backup is *Back up now*, a goal is a goal, a reader is never a mapping, and a source read is a file — a document is only the .emd <a id="d-451"></a>

**M43 U3, the marks of U2 (2026-10-08, all as proposed).** Thirty-one terms were flagged;
seventeen are renamed and fourteen kept. Each `term` row now carries the name it became, and the
old one under `rejected`.

- **Renamed, on every screen, in every tool's text, in the tours and in the notes that describe
  them:** *payslip* and *slip* → **paycheck** (Read paychecks, a paycheck's review, every figure
  that was off the payslip); *file* (to categorize) → **categorize** (*Categorized this sitting*,
  and the tour's line); the bill form's *New/Edit/Add fixed expense* → **New/Edit/Add bill**; the
  accessible name *Card bills* → **Card payments**; a debt that *claims* charges → **covers**
  them, so *claim* is the engine's alone; the column form's *Works out* → **Computed**; a link's
  *Points at* → **Links to** (the far entry keeps *Links here*, the tour says link); the view
  picker's *Entries* and `arrange_views`' *sheet* → **Table** (a spreadsheet's tab on Read files
  stays *Sheet*); *Ready* → **Ready to start** (the rail, the picker, `start_here`, the frame);
  the rail's *MCP* → **Assistants**; *Keep a copy as it is now* → **Back up now**; *saving goal*
  and *savings goal* → **goal**; tool text's *mapping* → **reader**; a source read onto a format
  is a **file** (*Read a file*), so a **document** is only the .emd; the import column role
  *balance* → **running balance**. *Monthly debt obligation* and *Snapshot* become the words the
  screens already said, **Paid each month** and **Reading**; no screen changed for them.
- **Kept as they are:** Balance (the engine's two pans), Decision number, Declaration, Declared
  table prefix, Entry and Row (both, on purpose), Format, Reading, Rollup, Rule, Rule set,
  Unchecked, Unit, What looks wrong.
- **Names of tools.** One changed: `create_saving_goals` is `create_goals`, with no alias,
  because nothing outside the repository calls it (the demo's script was its one caller). The read
  `savings` keeps its name: it answers net worth, places and holdings as well as goals.
  `keep_copy`, `format_sheet` and the `fixed_expenses` family keep theirs (none of them was
  asked for), as does `import_statement`'s `save_mapping_as` parameter. A model that still
  says `view: sheet` to `arrange_views` or `format_sheet` is understood; both list `table`.
- **A pack's format titles follow** (*Goal*, *Bill*, *Bill in a plan*, *Card payment*, *Reader
  (spreadsheet)*, *Reader (PDF or text)*), in a document that keeps the ledger from now on. A
  document that already keeps it holds the title it was given, as it holds its column names:
  they are its own.
- Rejected: renaming every tool whose name carries an old word (`keep_copy`, `format_sheet`,
  the `fixed_expense` family) — a name a model has learned is cheap to keep and the
  description says the word; rewriting *payslip* in the ledger's parked notes, where it names the
  printed page in the domain's own argument rather than a screen.

## D-452 · 2026-10-09 · What a downloader is owed: Help opens the license and the third-party notices from the app's own files and an About that names the version, AGPL-3.0-only with no warranty, the source and the not-advice line; Source Code hands the repository — one address, read from package.json — to the system browser on a click; a tag builds the unsigned installers in CI with SHA-256 checksums and attestations; the privacy policy is PRIVACY.md <a id="d-452"></a>

**M43 U7, the rest of the 2026-10-09 legal and security read after D-449.** AGPL section 6 says
whoever gets an installer can get its Corresponding Source, and an unsigned download says nothing
about where it came from. Six things, each the smallest that meets it:

- **The About** (`electron/about.ts`). `app.setAboutPanelOptions` fills the native panel — macOS
  shows it from the app menu, Windows and Linux from **Help → About Emerald** — with the version,
  *Free software under the GNU AGPL-3.0-only, with no warranty*, the not-advice line, the
  repository and the tree of this exact version (`/tree/v<version>`, the tag the release workflow
  builds from). Help also gains **License** and **Third-Party Notices**, each a plain window over a
  file in `dist/` served by `app://` (`.txt` is served as text now), so reading them asks nothing
  of the network; `scripts/third-party-notices.mjs` copies `LICENSE` in as `LICENSE.txt` beside the
  notices, in every build. Text windows are not the document's window: they receive no command,
  ask no unsaved-work question, do not reset the page's listening flag, and close with it.
- **Source Code opens the repository in the system browser**, the first address the shell has ever
  handed outward. D-124 is about the *page* reaching the network, and it is unchanged: the session
  guard is untouched, the renderer cannot name a URL, and `openExternal` is called once, from a menu
  click, with `SOURCE_URL` — a constant read from `package.json`'s `repository`, refused unless it is
  a plain https address. `electron/network.test.ts` fails on a second call or a different argument.
  The address is the planned public repository, `github.com/kfireliyahu/emerald-emd`, which does
  not exist yet (the history rewrite is the maintainer's act); another slug is a one-line change there.
- **The not-advice line**, in the About, the README and each release's notes: *Emerald computes; it
  does not advise. Check every figure it read from a paycheck, a pension report or a statement
  against the document it came from* (D-308 kept the ledger computing, never recommending).
- **Releases are built in CI** (`.github/workflows/release.yml`). A `v*` tag that matches
  `package.json`'s version builds on `windows-latest` and `macos-latest` with `--publish never`,
  attests every installer with `actions/attest-build-provenance`, then a Linux job writes
  `SHA256SUMS`, attests it too, and publishes the release with notes that link the tagged source.
  Run by hand it is a rehearsal: the same builds as run artifacts, and no release. Unsigned stays
  (D-124): `gh attestation verify <file> --repo …` is the check that needs no certificate. The Mac
  build makes **two disk images, arm64 and x64** (`Emerald-<version>-<arch>.dmg`), rather than one
  for Apple silicon only or one universal image twice the size.
- **The README** (drafts for M43 U1) says the macOS path past Gatekeeper that still exists —
  System Settings, Privacy & Security, Open Anyway — since recent macOS dropped Control-click →
  Open, how to check a download, and the source-and-licence line. **The privacy policy moved,
  unreworded, to `PRIVACY.md`**: a stable address for registry and directory listings. If M33 U8's
  page ever takes a form post or a count, that file says so first.
- **`SECURITY.md`**: text a model read out of a document is untrusted input, and prompt injection
  is in scope where it makes a tool do more than the tool says. GitHub's private vulnerability
  reporting is named, behind a comment saying it is true once it is switched on.
- Rejected: an About screen in the renderer (a route the browser build would have to explain, for
  information the native panel already shows); opening the license on GitHub instead of from
  `dist/` (a request for a file the app already holds); a universal macOS image; publishing from
  electron-builder itself (it would need the token in the build job and checksums it does not
  write); running the workflow or pushing a tag here — macOS minutes are the maintainer's to spend.

## D-453 · 2026-10-09 · A fresh clone builds the same on every machine: every text file checks out with LF whatever core.autocrlf says, the notices are read from package-lock.json rather than from what npm ls prints, and the three dependencies with install scripts are declined in package.json, because nothing Emerald needs runs at install <a id="d-453"></a>

**M43 U9, a stranger's first ten minutes.** The whole sequence — `npm ci` against an empty npm
cache and an empty Electron cache, typecheck, the suite, every build, `check:tours`, `docs:check`
and the plugin answering `initialize` and `tools/list` over stdio — was run on fresh clones with
`core.autocrlf` true (git's Windows default) and false. Two things failed that only a fresh clone
shows, and one more asked a stranger to act:

- **Line endings.** On a CRLF checkout four tour tests failed: they take `.format.md` files apart
  by `
`. The readers already accept CRLF; what does not is everything that reads this
  repository's text as bytes — tests over fixtures, migrations and pack notes embedded raw by the
  builds, and the Windows installer built on a runner whose checkout is CRLF. So `.gitattributes`
  says `* text=auto eol=lf`: every text file checks out with LF on every machine, git still
  decides what is binary, `*.emd -text` stands. A narrower list (`*.format.md`, fixtures, `*.sql`,
  pack notes) was rejected: it is already four groups and the next `?raw` import would be the same
  trap again. The index was LF throughout, so renormalizing changed no file. The history-rewrite
  runbook no longer needs `-c core.autocrlf=false`, and its preflight no longer asks for it.
- **The notices read the lockfile.** `scripts/third-party-notices.mjs` took the production tree
  from `npm ls --parseable`, and npm redacts anything shaped like a UUID in what it prints (its old
  token format) — a clone under such a directory read `***` for its own root, and `build`,
  `build:plugin` and `build:demo` all failed. It now takes the packages the lockfile does not mark
  dev-only, skipping a platform's optional package that is not installed: the same 138 entries,
  byte for byte, and no npm spawned.
- **Install scripts are declined, and said so.** npm 12 blocks dependency install scripts unless
  `allowScripts` in package.json allows them, and ended every install by inviting an approval for
  `electron-winstaller` (picks a 7-Zip for the Squirrel target, which Emerald does not build),
  `esbuild` (checks a binary its optional dependency already installed) and `tesseract.js` (a
  donation banner). Every build and the tours pass without them, and Electron 44 fetches its binary
  on first run rather than at install, so each is declined with a `false` entry: the warning goes,
  and nothing a dependency ships runs on install. An older npm ignores the field and runs them, as
  it always did.

Not fixed here: `npm audit` reports advisories on install; the production ones are in the MCP SDK and the
packages it brings, and in React Router. An upgrade is its own unit.

## D-454 · 2026-10-09 · No known advisory ships: the MCP SDK goes to 1.32 and React Router to 7, because no 6.x release carries the fix; a navigation is drawn as a transition, so the tour runner waits for the routed view to say it drew the address; the dev-only advisories left are major upgrades of build tools that never ship <a id="d-454"></a>

**M43 U10.** `npm audit --omit=dev` printed 8 advisories on a fresh clone, and now prints none.
Each was upgraded whether or not Emerald reaches it, because "not reachable" is an argument a
stranger will not read — but for the record, none was reached:

- `@modelcontextprotocol/sdk` < 1.31 (an OAuth *client* sending credentials where a server says):
  Emerald is an MCP server over stdio, never an OAuth client. Now `^1.32.1`.
- `hono`, `express`'s `proxy-addr` and `qs`, `express-rate-limit`'s `ip-address`: the SDK's HTTP
  transports, which the stdio server never imports. `fast-uri` (through `ajv`): URI host parsing,
  reached by no schema Emerald validates. All moved by `npm audit fix` inside their ranges.
- `react-router` 6.0–7.17 (an open redirect through a backslash in `<Link>` and `useNavigate`; a
  constructor injection in SSR hydration): the app navigates to its own literal paths in a
  `HashRouter` and renders nothing on a server. **No 6.x release is fixed** — 6.30.6 is still in
  range — so it is `^7.18.4`, through `react-router-dom`, which v7 keeps as a re-export.

**What 7 changed here.** `navigate()` is typed `void | Promise<void>`, so five handlers that
returned it say `void navigate(...)`. And a navigation is rendered as a React transition: for a
frame or more after a click the leaving screen is still in the tree. The suite did not notice;
`check:tours` did — the timesheet tour's first outline was found on Home's *September 2026* row,
which was gone a frame later. The routed view now carries `data-route` (`App.tsx`), and the tour
runner waits until it names the address before it looks for an anchor or an outline
(`routeDrawn`, `src/demo/tour/runner.ts`). 6.30.5 and 6.30.6 fail the same tour the same way.

**The dev-only advisories left are majors, and none ships.** `vite` ≤ 6.4.2 and its `esbuild`
(dev-server path traversal and request forgery) need Vite 8; `vitest`, `tinypool`,
`@vitest/mocker` and `vite-node` need Vitest 5; `electron-builder`'s chain down to `sprintf-js`
(through `@electron/get` → `global-agent` → `roarr`) has no fixed release, and npm's offered "fix"
is a downgrade to 26.5.0. The dev server is a session's, on loopback; the tests run on a
development machine; electron-builder runs at packaging. What `npm audit fix` could move inside its
ranges it moved (electron-builder 26.15 → 26.17 among them). The Vite and Vitest majors are a unit
of their own if they are wanted before launch: every build mode and ~4,400 tests ride on them.

Rejected: staying on React Router 6 and recording the advisory as unreachable — the brief's own
argument against it; and `npm audit fix --force`, which would have taken Vite and Vitest across
two majors and downgraded electron-builder in one unreviewed step.

## D-481 · 2026-10-16 · The npm package is `emerald-mcp`, because it is the MCP server and nothing else; the repository stays `emerald-emd`, the file format's name, and the plugin and the desktop app ship under the project's name, so the three need no one slug <a id="d-481"></a>

**Context.** The release sequence (the release sequence of 2026-10-15) named the package `emerald-emd` after the
repository. Writing the README's install line made the mismatch visible: the package is one build output, the
server, and `npx emerald-emd` says nothing about what it does. Chosen 2026-10-16; `emerald-mcp`,
`emerald-emd` and `emd-mcp` were all still free on npm that day.

**Decision.** The package is `emerald-mcp` and the line in an assistant's configuration is `npx emerald-mcp`
(`claude mcp add emerald -- npx emerald-mcp`); the MCP registry entry matches it. The repository is
`kfireliyahu/emerald-emd`. Nothing is published before beat two (D-480).

## D-482 · 2026-10-17 · `format_sheet` is `show_format`, with no alias, because a host that defers tools shows a model only the name and the name has to say *show*; and the head of the server's instructions is a budget: both blocks say what Emerald is and when to draw within the first 2,000 characters <a id="d-482"></a>

**Context.** On 2026-10-09 a Claude Code session in the desktop Code tab was asked to "show me the
roadmap" and gave a hand-written list. Two causes, both measured that day. The Code tab cut the engine-only
instructions (9,376 characters) after the first 2,038, and the paragraph saying when to draw began at
character 4,324, so it never reached the model. And Claude Code defers MCP tools: until a session searches
for one it sees the tool's name and not its description, and `format_sheet` says nothing about showing —
besides carrying *sheet*, the word D-451 retired on screen for *table*.

**Decision.** The tool is `show_format`, everywhere, and `format_sheet` is not kept as an alias: nothing
public has called it yet, and a name is an API from the first stranger's conversation (D-092), which has
not happened. Its `view` already takes `table` (D-451), as `arrange_views` does. Both instruction blocks now
open with what Emerald is, in one paragraph, then **When they ask to see**: call `show_format` or
`start_here` when a person asks to see the roadmap, the board, what is ready or a format's rows;
`format_rows` is for rows the model will count or reason over. The disambiguation became a clause, and
how a file is stored moved into *How to work*. `server.test.ts` pins both blocks naming both tools as the
way to show within the first 2,000 characters, and cites the 2,038.

- Rejected: keeping `format_sheet` beside the new name. Two names for one tool is the drift the rename is
  for, and the only callers were this project's own sessions.
- Rejected: renaming `start_here`. It already reads as the place to begin, and the instructions now name it
  as a way to show.
- Whether a fresh Code-tab session draws the roadmap unprompted is the maintainer's try, after restarting the
  emerald server.

## D-494 · 2026-10-18 · What only Claude reads lives in `hosts/claude/` — the hooks and the status line, the skills a stranger gets, and the plugin's manifest — built beside the server as `hooks.mjs` and `status-line.mjs`; nothing in `src/` or `electron/` imports from `hosts/`, and a host reaches the server only through `src/plugin/host.ts` <a id="d-494"></a>

**Context.** 2026-10-17: what is specific to Claude belongs in one folder and ships in the
Claude plugin. Measured that day, the MCP server was already host-neutral in what it says; what was
not were the hook commands, which `server.mjs` ran as subcommands beside `watch` (M47 U1, M51 U6),
the status line's entry in `src/plugin/`, the `.claude/emerald.json` they read, and the skills. MCP
has no hooks, so no other client ever runs one, yet every client loaded the code that answers them.

**Decision.** `hosts/claude/` is the one home for what only Claude reads. `hosts/claude/hooks/` holds
what `src/plugin/hooks/` held, the status line's entry and a new `main.ts` that is the hooks' own entry:
`vite build --mode claude-hooks` writes `dist-plugin/hooks.mjs` and `--mode claude-status-line` writes
`status-line.mjs`, both beside `server.mjs`, so the plugin M42 U4 builds ships one folder and its
`hooks.json` names `${CLAUDE_PLUGIN_ROOT}/hooks.mjs`. `server.mjs` answers MCP and `watch`, nothing
else. `hosts/claude/skills/` holds the skills a stranger gets — `declare-a-format` now, M42 U7's later —
each the same file as this repository's `.claude/skills/` copy (`skills.test.ts`); this repository's
own skills stay out, since they name its paths. `src/plugin/host.ts` is what the server exports for a
host: the tools a hook answers with, `formatWatch`'s readers, `FOR_THE_MODEL`, `NO_CLIENT` and
`Result`. `src/plugin/hostBoundary.test.ts` holds the line both ways: nothing in `src/` or `electron/`
imports from `hosts/`; a host's code imports from `src/` only `host.ts` (a test may add `src/testing/`)
and from `electron/` only `bridge.ts`. The frame stays in the server: MCP Apps is an open extension.
A second host later is `hosts/<name>/`. This repository's `.claude/` stays the configuration for
developing Emerald, and its hooks run `dist-plugin/hooks.mjs`.

- Rejected: keeping the hooks a subcommand of `server.mjs`, built from `hosts/claude/`. The server's
  entry would have to import the host to dispatch to it, which is the one import the line forbids.
- Rejected: `plugin/` for the folder. `src/plugin` is already the MCP server's name (`docs/plugin.md`).
- Rejected: moving `declare-a-format` out of `.claude/skills/`. Sessions here use it; a test that the
  two copies are one file costs less than a session without it.

## D-495 · 2026-10-18 · The repository goes public before the showcase, as one fresh commit with its history kept privately; what a visitor or a new session reads first says what holds, not who decided it; `docs/archive/` leaves the repository; and M33 U4 then deploys with GitHub Pages and a getemerald.dev record at Cloudflare <a id="d-495"></a>

**Context.** The release sequence of 2026-10-15 put the showcase first, deployed and answering at
getemerald.dev while the repository was still private, and only then the repository, npm, the registry
and the plugin on one day. GitHub Pages serves a private repository only on a paid plan, so M33 U4 was
to move to Cloudflare Pages or a direct upload. Once going public was approved (2026-10-16), the
order was decided again, and an audit before publishing (2026-10-18) found that the repository read
as one person's notebook: real document names and paths of other projects, the publisher's
employment, personal finances, and "the author" narrating 307 of 1,335 rows and about 1,500 lines.

**Decision.**
- **The repository goes public first, and the showcase deploys after it.** M33 U4 deploys with the
  GitHub Pages workflow the repository already holds, free once it is public, and getemerald.dev
  answers through one DNS record at Cloudflare, where the domain lives. No Cloudflare Pages, no
  direct upload. The frame's contract (D-418), the no-request rule and the poster hand-off are
  unchanged. Nothing in the project competes with the publisher's employer or relies on its code or
  material, and nothing new may.
- **Published as one commit.** A single orphan commit of the cleaned tree goes to a fresh, empty
  repository, with a message saying it is the first public release and that the history is kept
  privately. The full history stays in a private bare mirror. A unit's `commit` names a commit of
  that private history, and the format's notes say so.
- **Personal content goes everywhere.** No employer, no real document or project names of the
  publisher's own (the stand-ins of M47: notes.emd, planner.emd, homepage/site.emd), no personal
  finances or figures, no machine paths but this repository's own.
- **What a visitor or a new session reads first says what holds.** CLAUDE.md, the skills, README,
  PRIVACY and SECURITY, `docs/*.md`, code comments, and the rows still acted on (planned units, open
  milestones, live rules and terms, open questions and review entries): a statement with its D-ref or
  date, "the maintainer" where a role is needed, a quote turned into the decision it carried.
- **`docs/archive/` leaves the repository.** It is ignored and kept in the maintainer's checkout;
  `scripts/archive-decisions.mjs` still moves a closed milestone's entries there, and the index and
  every link name the plain D-ref. `npm run docs:check` fails on a link into it.
- **The inbox is emptied.** Its rows were hand-offs from the publisher's own projects; what each
  carried already landed as a unit or a decision. The two of 2026-10-15 and 2026-10-18 became this.
- **Past rows and entries were reworded for voice only, on 2026-10-18.** Decision rows, built units,
  closed milestones, findings and the log's open entries say who said, felt or approved something
  differently, and nothing about what was decided, built, rejected or measured; refs, dates and
  figures are as they were. This is the one exception to "a past entry is never edited", and the
  wording before it is in the private history.
- **Amends D-450**, whose consequence kept `docs/archive/` and the rows "dated record, never edited",
  and **supersedes the order** of the 2026-10-15 release sequence. A private copy of the document
  before this was made outside the repository.

- Rejected: leaving the history. Scrubbing the current files leaves every earlier version readable
  in history, including the commits that carried the employment rows.
- Rejected: a second `filter-repo` rewrite. It swaps tokens, so the names would go and the voice in
  745 commits would stay, and every hash would change again anyway.
- Rejected: flipping the existing private repository public. A known hash can still reach a commit
  that a force-push left behind.

## D-496 · 2026-10-18 · A tour plays only while its frame is seen, and the frame decides it: the player holds the first step and pauses every hold while an `IntersectionObserver` on the frame's own document says less than a third of it is in view or the tab is hidden, so `?autoplay=1` means play when seen on any page that embeds it <a id="d-496"></a>

**Context.** Emerald's page embeds the four tours and loads each within half a window of the view
with `?autoplay=1`, and a loaded frame played at once, so a visitor scrolling down found a tour at
a late step. A site that embeds a frame below its fold had the same problem and no way to fix it
from outside. The rule could live in the page, which would hold `autoplay` back or post the frame a
start, or in the frame.

**Decision.**
- **The frame decides, not the page.** `src/demo/tour/seen.ts` watches the frame's own root with an
  `IntersectionObserver` and no root, which measures against the top page's viewport even from a
  frame on another origin, and counts it seen at a third in view (the page's recording plays at the
  same share) with its tab showing. Every embedding site gets it without a line of its own, and the
  embed contract (D-418) is unchanged in shape: `?autoplay=1` still means play, now *play when
  seen*, and a frame without it still holds the poster under *Watch the tour*.
- **The player pauses rather than restarts.** `TourPlayer.setSeen` gates every row before it moves
  and counts every hold only while seen, keeping what was left of it; the caption's reading starts
  again from when it was seen. A seen frame therefore starts from step one, a frame that leaves
  stops where it is, and one that comes back goes on.
- **It starts nothing.** A frame waiting for Watch, or one the visitor took over, stays as it was
  left; the check (`?check`) plays unwatched, as before.
- **The page keeps loading and letting go of frames by distance**, for memory: a frame scrolled
  more than half a window away is unloaded and starts again at its first step when it returns.

**Consequences.** Where there is no `IntersectionObserver` the frame counts as seen and plays as it
did. A frame posts its first `step` message when it is loaded, before it is seen, since that step
is the one on screen.

## D-497 · 2026-10-18 · The MCP server is published as one npm package, `emerald-mcp`, that is `dist-plugin/` as built: every package bundled and no dependencies, a manifest generated from the root one, and a bin each for the server (`emerald-mcp`, full or `--engine-only` by flag), the hooks (`emerald-hooks`) and the status line (`emerald-status-line`) <a id="d-497"></a>

**Context.** The README's install line has said `npx emerald-mcp` since D-481, and the maintainer
decided on 2026-10-18 that the Claude plugin (M42 U4) runs everything from this package rather than a
committed build or a release asset. Until now `dist-plugin/server.mjs` kept `sql.js`, `xlsx` and the
MCP SDK external, so it ran only beside a checkout's `node_modules`; the root `package.json` is the
app's and private.

**Decision.**
- **One package, and it is `dist-plugin/`.** `npm run build:plugin` ends with
  `scripts/npm-package.mjs`, which writes `package.json` and `README.md` into the folder: name
  `emerald-mcp`, the root's version, licence (AGPL-3.0-only, D-430), author, homepage and
  repository, `files` naming the three bins with `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`, and
  `engines.node >=24`, what CI runs. Generated, not kept, so the two manifests cannot drift.
- **No dependencies.** The three passes bundle every package (`ssr.noExternal`), `sql.js` as its
  browser build since its Node build's export is lost to the CommonJS transform; the wasm is the
  same bytes, handed over as before. The server's public folder (the OCR's language data, which no
  tool reads) is no longer copied in. An `npx` downloads a 2.9 MB tarball and installs nothing else.
- **Both servers in the one package, chosen by `--engine-only`.** Two packages would ship the same
  7.5 MB twice for a choice `tools/list` makes at run time.
- **A bin each for the hooks and the status line**, rather than subcommands of one bin: each is
  already its own entry (D-494), the inbox hook runs on every prompt and the status line has 200 ms,
  and a dispatcher would load the server's bundle to reach them or be a fourth file. A plugin calls
  them with `npx -y -p emerald-mcp@<version> emerald-hooks …`.
- **Publishing is the maintainer's** (`npm publish --access public` from `dist-plugin/`); a session
  prepares and proves the tarball.

**Consequences.** Measured once cached, the inbox hook costs ~0.35 s run by `node`, ~2.1 s through
`npx` with the package installed, ~2.7 s from the npx cache — npm's start-up, on every prompt — and
for a registry spec npx revalidates the manifest each call unless `--prefer-offline` is passed, which
a pinned version makes safe. How the plugin's hooks pay that is M42 U4's. This checkout's
`.mcp.json` and hooks run the same self-contained files.

**Rejected.** Two packages, full and engine-only (twice the bytes for one flag). One bin with
subcommands (the cost above, paid at the front of every hook). Dependencies resolved at install
(an `npx` that installs the MCP SDK's tree on first run, for files that bundle in seconds). A
manifest kept by hand beside the root one.

## D-498 · 2026-10-18 · The Claude plugin is `hosts/claude/`, listed by a marketplace at the public repository's root and built by nothing: it pins the published `emerald-mcp` at the manifest's `version`, runs the server through `npx --prefer-offline`, and runs the hooks through `emerald.mjs`, a hand-written launcher that keeps a copy of the package in `${CLAUDE_PLUGIN_DATA}` and starts it with plain `node`; no `.mcpb`, because the directory no longer takes one <a id="d-498"></a>

**Context.** M42 U4 packages Emerald for one-click install in Claude. Its first attempt committed a
bundle of the server and hooks into the plugin (parked on the unpushed `m42-u4-wip`); the
maintainer ordered npm first, and `emerald-mcp@0.1.0` is published (D-497). An `npx` call costs
~2 s on the maintainer's Windows machine against ~0.35 s for `node`, and the inbox hook runs before
every prompt. Anthropic's publish page, read on the day, says the directory no longer accepts local
servers packaged as desktop extensions (MCPB): a local server goes inside a plugin.

**Decision.**
- **The plugin folder is `hosts/claude/`** (D-494's home for what only Claude reads), and
  `.claude-plugin/marketplace.json` at the repository's root lists it, so `/plugin marketplace add
  kfireliyahu/emerald-emd` then `/plugin install emerald@emerald-emd` installs it with no review.
  Nothing builds it: no committed bundle, no build script, no release asset.
- **The server is `npx -y --prefer-offline emerald-mcp@<version> --engine-only`.** Once per
  session, so npx's two seconds are paid once; `--prefer-offline` keeps a pinned version off the
  network after the first fetch. Measured on Windows: Claude Code starts it as written and it
  connects.
- **The hooks run through `emerald.mjs`**, ~85 lines of plain JavaScript with no imports but
  Node's. It reads the version from `.claude-plugin/plugin.json`, keeps `emerald-mcp` at that
  version in `${CLAUDE_PLUGIN_DATA}/node_modules/` (installed with npm, `--prefer-offline`, at the
  first `start-here` after an install or update — ~10 s once), and imports the bin there in its own
  process. The per-prompt `rows` never installs: until the copy is there it is silent. Measured:
  `rows` through the launcher ~0.35 s, the same as `node` on the file.
- **The version is written once**, as `plugin.json`'s `version`; the server's pin must equal it and
  it must equal the root `package.json`'s, which `npm run build:plugin` stamps on the package
  (`hosts/claude/plugin.test.ts`). So a release is: bump, build, publish, then push — the
  marketplace serves `main`, and a pin pushed before its publish installs nothing. A change to the
  plugin alone ships with the next package version.
- **No `.mcpb`.** The directory has deprecated desktop-extension listings, and a plugin answers
  M41 U4's *does a person need Node* no better: Claude Code's plugin runs on the person's `node`.
- **The status line stays the person's setting** (a plugin's `settings` take only `agent` and
  `subagentStatusLine`); since the data folder does not move between versions, it can name
  `.../plugins/data/emerald-emerald-emd/node_modules/emerald-mcp/status-line.mjs`.

**Consequences.** The plugin needs Node on the `PATH` and the network once per version. The
directory, if Emerald is submitted to it later, would hold this version for a reviewer (a pinned
npx package and a launcher that installs are always held) and would block the hooks' `"$CLAUDE_PROJECT_DIR"`
argument in a plugin that is a subfolder of its repository; the launcher could take the folder from
the environment instead. A person who also wired the hooks by hand (`.claude/settings.json`) gets
them twice and should drop their own.

**Rejected.** `npx` in `hooks.json` (two seconds before every prompt). The committed bundle (the
maintainer's *why a workaround*: the package is the build). Finding the npx cache's copy (its folder
is a hash of npm's choosing, and moves with npm). Running the server through the launcher too (two seconds saved once
a session, for a plugin that no longer runs the command every other client runs).
A `.mcpb` beside the plugin (the directory no longer takes one).

## D-499 · 2026-10-18 · The Claude plugin runs everything through npm: the hooks are `npx -y --prefer-offline -p emerald-mcp@<version> emerald-hooks …` and the status line `npx … emerald-status-line`, like the server, and `emerald.mjs` is gone; the cost is accepted — ~1.95 s before every prompt for the inbox hook on Windows, against ~0.35 s for `node` <a id="d-499"></a>

**Amends [D-498](#d-498)**: its launcher and the status-line path, nothing else — the marketplace,
the server's command, the single version and no `.mcpb` stand.

**Context.** D-498 ran the hooks through `emerald.mjs`, which kept a copy of the package in
`${CLAUDE_PLUGIN_DATA}` and started it with plain `node`, to keep npx's start-up off every prompt.
The maintainer, the same day: *use npm for it* — the server, the hooks and the status line all
through the published package, nothing on a cached path and nothing bundled, and the cost accepted.

**Decision.**
- **Hooks**: `npx -y --prefer-offline -p emerald-mcp@<version> emerald-hooks start-here
  "$CLAUDE_PROJECT_DIR"` at `SessionStart` (timeout 60 s, for a first download), and `… rows
  "$CLAUDE_PROJECT_DIR" inbox --match state=new --once-per-session` at `UserPromptSubmit` — the
  arguments this repo's own hooks pass. **Status line**: `npx -y --prefer-offline -p
  emerald-mcp@<version> emerald-status-line`, still the person's setting.
- **`emerald.mjs` is removed**, and with it the data-folder copy and its install.
- **Every pin equals the manifest's `version`**, the server's and each hook's
  (`hosts/claude/plugin.test.ts`).

**Consequences — the cost, measured** on the maintainer's Windows machine with npm's cache warm:
the inbox hook **~1.95 s before every prompt** (five runs, 1.93–1.97 s; ~0.35 s as `node` on the file),
`start-here` ~2 s once a session, the server ~2.2–2.6 s once a session, the status line ~1.7 s
against its 200 ms. The first run of a version downloads the 2.9 MB tarball; `--prefer-offline`
keeps every later one off the network. npm's `npm notice` lines go to stderr, which a hook exiting 0
keeps out of context. The upside: one way to run Emerald everywhere — the command another client
runs — with no file of the plugin's own between Claude Code and the package.

**Rejected.** Keeping the launcher (the maintainer's call). `npm i -g emerald-mcp` and bare bins (a
global install the plugin cannot make, and one more step for a person).

## D-500 · 2026-10-18 · The server is listed in the official MCP Registry as `io.github.kfireliyahu/emerald`, from a `server.json` at the repository's root that a workflow publishes, signed in with GitHub OIDC, whenever npm has a version the registry lacks; a version is cut in `package.json`, `server.json` and `PLUGIN_VERSION` and pushed first, and the plugin's pins follow once npm has it, so they may trail the package and never lead it <a id="d-500"></a>

**Amends [D-498](#d-498) and [D-499](#d-499)** on one point: the pins equal the manifest's `version`
still, but that version may trail the root `package.json`'s instead of equalling it.

**Context.** M42 U3: be found where MCP clients look. The registry
(`registry.modelcontextprotocol.io`, in preview) keeps metadata only — a `server.json` naming the
server and the npm package and version it runs — and accepts a version only when npm already has
it and the *published* `package.json` carries the server's name as `mcpName`. `emerald-mcp@0.1.0`
carries none, so it cannot be listed: a new version has to be published, and publishing to npm is
the maintainer's, with a browser sign-in (D-497). And the old order — bump, build, publish, *then*
push — cannot hold when every session pushes to `main`: a pin pushed before its publish starts
nothing for anyone whose plugin updates in between.

**Decision.**
- **The name is `io.github.kfireliyahu/emerald`**: the GitHub namespace, which needs no domain, and
  `emerald` after the server (`SERVER_NAME`) and the plugin's server, not the npm package, whose
  `-mcp` was only because `emerald` was taken there. `title` Emerald, `websiteUrl` getemerald.dev.
- **`server.json` at the root is the listing**, written by hand against the
  `2025-12-11` schema: one npm package, `emerald-mcp`, `registryBaseUrl` npm's, `runtimeHint` npx,
  transport stdio, no arguments — the full server, as the README's `npx -y emerald-mcp` runs it.
  `scripts/npm-package.mjs` stamps its `name` on the package as `mcpName`, so it is written once.
- **A version is cut in three places and pushed first**: the root `package.json` (and its lock),
  `server.json` (its `version` and the package's) and `PLUGIN_VERSION`, the version the server
  reports; `src/plugin/registry.test.ts` fails when they differ. **The plugin's pins follow once npm
  has it**: `node scripts/pin-plugin.mjs` asks npm, refuses while the version is not there, and
  moves every `emerald-mcp@<version>` and the manifest's `version`. `hosts/claude/plugin.test.ts`
  now requires the pins never to lead the package, rather than to equal it.
- **`.github/workflows/registry.yml` lists whatever npm has**: on a push to `main` that touches
  `server.json` or the plugin's manifest, once a day, and by hand (`gh workflow run registry.yml`). It
  asks npm (no such version → a notice, green; a different `mcpName` → red) and the registry (listed
  already → nothing), then runs `mcp-publisher` — pinned at 1.8.1 and checked against its release's
  sha256 — to `validate`, `login github-oidc` and `publish`, and asks the search API for the name
  at that version. **No stored secret**: the job's OIDC token proves the repository is
  `kfireliyahu`'s, which is the namespace. **No tag**: the registry follows npm, and npm is
  published by hand, so a tag would be one more thing to push in the right order.
- **0.1.1 is the first listed version**, and it carries the npm README rewritten after 0.1.0. The
  app's version moves with it, because it is the one version; **the desktop release does not**:
  installers are cut only by a `v<version>` tag (release.yml), none is pushed for this, and the
  page's `RELEASE` stays 0.1.0, the installers that exist.

**Consequences.** Between the cut and the publish, `main` says 0.1.1 while the plugin still runs
0.1.0, which is the point; the workflow's notice says so. The registry's schema is checked where it
lives, by `mcp-publisher validate` before every publish; the tests check only what must agree here.
A desktop release now takes whatever version the package is at, not a version of its own.

**Rejected.** Publishing npm and the registry from one workflow on a tag (the npm publish would need
a stored token or trusted publishing set up on the account, and the publish is the maintainer's by
D-497). A name after the npm package (`io.github.kfireliyahu/emerald-mcp`: one more name for one
thing). A domain namespace (`dev.getemerald/…`: a DNS key to keep, for a listing the GitHub one
already proves). Keeping the pins equal to the package (every cut would break the plugin until the
publish, or wait unpushed on `main`). A personal access token for the registry (a secret to rotate,
where OIDC needs none).

## D-502 · 2026-10-18 · The desktop app makes no network call unless the person turned updates on, or pressed Check for Updates Now — then one request, to `api.github.com/repos/kfireliyahu/emerald-emd/releases/latest`, from a session of its own that the page never runs in, open only while that check asks; the setting is off by default and the app's, a newer version is a quiet notice in the window whose Download opens the release page, and M42 U9's download will reach `github.com/kfireliyahu/emerald-emd/releases/download/` and the asset hosts it redirects to (`release-assets.githubusercontent.com`, `objects.githubusercontent.com`) only on the same terms; amends D-124 and D-452 <a id="d-502"></a>

**Context.** M42 U8. D-124 said nothing inside the app reaches the network, and `electron/network.ts`
enforced it: the README's "Updates are download the new one; there is no update check". Once the
app is public, a person who installed v0.1.0 has no way to learn there is a v0.1.1 short of
revisiting the page. The maintainer decided on 2026-10-18 that the desktop app gets updates as an
opt-in, off by default and never intrusive — no modal, no dialog that takes focus, nothing installed
unasked — the way the Claude desktop app shows one.

**Decision.**

- **The rule, amended.** The desktop app makes no network call unless the person turned updates on
  — and then only to GitHub's release addresses for this repository. A press of Help → Check for
  Updates Now is consent for that one check, with the setting off. The check asks exactly
  `https://api.github.com/repos/kfireliyahu/emerald-emd/releases/latest`; M42 U9's download will
  reach `https://github.com/kfireliyahu/emerald-emd/releases/download/…` and the asset hosts GitHub
  redirects a release download to (`release-assets.githubusercontent.com`,
  `objects.githubusercontent.com`), on the same terms, and widens the predicate then — not before.
- **A session of its own, not a loosening of the page's.** The check runs in
  `session.fromPartition('emerald-updates')`, held in memory, which nothing the page loads runs in.
  `isAllowedRequest` — the page's — is unchanged and refuses the address with the setting on or off;
  `isAllowedUpdateRequest` allows that one URL, exactly, and only while `Updates.gateOpen()` — which
  is narrower than the brief asked: open while a check is in flight, not for as long as the setting
  is on. A redirect is an error. It sends `User-Agent: Emerald/<version>` and `Accept-Language: en`,
  so GitHub sees the IP address, the version and the time, and not the system's language or OS.
- **The release API, not `latest.yml`.** One request answers both platforms, from the host that
  answers it (no redirect to an asset host), it exists today, and `releases/latest` skips drafts and
  pre-releases itself. `latest.yml` is published only once U9's build ships it, and macOS would read a
  second file. Only `tag_name` is read from the answer; nothing else in it reaches the window or the
  browser.
- **One setting, the app's.** `settings.json` beside `recents.json` in the app's own folder,
  `{"automaticUpdates": true}` or off — anything else is off. It is switched in About (the page's,
  M45 F3), where the version is, under words that say what it does on this platform; until U9 that is
  the same on both: check at start and once a day, and say so.
- **The schedule.** At start, then a tick every hour that checks only when on and a day has passed
  since the last check — so a laptop that slept still checks. A scheduled check that finds nothing,
  or fails, says nothing; the next day's tries again.
- **The notice.** The lowest row of the notice region (it is about the app, not anything open in
  it): *Emerald <version> is out. You have <version>.* with **Download** — `shell.openExternal` of
  `<repository>/releases/latest`, a constant, never an address from the answer — and **Later**, which
  hides it until the next start or the next day's check. Check for Updates Now answers in the same
  row: *Checking…*, *You have the latest — Emerald <version>.*, or *Could not check for updates.* with
  the reason. No dialog, and nothing takes focus. It is in Help on both platforms and in the palette.

**Consequences.** `electron/network.test.ts` proves the update predicate closed with no check
asking, open for that URL alone while one does, and the page's predicate refusing it either way;
`electron/updates.test.ts` proves the schedule asks nothing while off over ten days, and every answer
against a stubbed release. A verify-in-shell run with Chromium's net log showed no HTTP request at
all with the setting off. The rule rows for the offline law and for `openExternal` say the same. An
unpackaged shell reads a release answer from the file `EMERALD_UPDATE_ANSWER` names instead of
asking, for verifying the notice; a packaged app ignores it.

**Rejected.** Widening the page's session for the address (a renderer that ever loaded something
foreign could then ask it). `electron-updater` for the check (U9's to choose for the download; for a
version number it is a dependency and a second file). Opening the `html_url` from the answer (an
address the network chose, handed to the browser). A dialog for Check for Updates Now (the maintainer
ruled out anything that takes focus). The gate open for as long as the setting is on (the narrower
gate costs nothing).

## D-503 · 2026-10-18 · On Windows, with updates on, the app downloads the release its check found — `releases/download/v<version>/latest.yml` and `Emerald-Setup.exe` through electron-updater, in its own session, gated to that release while it downloads — checks the installer against the release's sha512, and installs only on Install and restart, after the window closes the ordinary way, reopening the document; macOS stays a notice; the installers lose the version from their names and the page links `releases/latest/download/` <a id="d-503"></a>

**Context.** M42 U9. D-502 gave the desktop app an opt-in update check and a quiet notice, and named
the addresses a Windows download would reach. The maintainer's brief: Windows downloads by itself with
the setting on and installs only on a press; macOS stays a notice until the installers are signed
(electron-updater needs a signed app there); never intrusive; and getemerald.dev must always link the
newest installers, which their versioned names stopped it doing.

**Decision.**

- **One check, then the release it found.** M42 U8's check (the release API) still decides. A newer
  version is handed to `electron/windowsUpdater.ts`, which points electron-updater's *generic* feed at
  `github.com/kfireliyahu/emerald-emd/releases/download/v<that version>/` and reads that release's
  `latest.yml` — not `releases/latest/download/`, which could be a newer release a second later, and not
  the GitHub provider, which reads the releases feed and a second endpoint to find what the check
  already found. `latest.yml` naming another version, or one not newer, is a refusal.
- **Its own session, gated.** electron-updater asks from its partition (`electron-updater`), which
  nothing the page loads runs in. `isAllowedDownloadRequest` allows exactly that release's `latest.yml`
  (with electron-updater's `noCache` query) and `Emerald-Setup.exe`, and the two file-store hosts D-502
  named, over https on the default port — only while `Updates.downloading()` names that version, which
  happens only with the setting on. With the setting off nothing is downloaded, a press of Check for
  Updates Now included: it says so, as on macOS. The headers are D-502's (`Emerald/<version>`, `en`);
  electron-updater's staging id is never made (`QuietNsisUpdater`) and its header is dropped at the session.
- **The checksum is the guarantee.** electron-updater checks the file against `latest.yml`'s sha512 and
  deletes it on a mismatch. `verifyUpdateCodeSignature` would compare the installer's signature with a
  publisher name; the installers are unsigned (D-124) and `app-update.yml` names none, so it is skipped:
  what stands behind the file is that both came from this repository's release, built and attested by its
  workflow (D-452). The GitHub account is the real guard, as it is for a download from the page.
- **Installed only on a press.** `autoDownload` and `autoInstallOnAppQuit` are off. The notice says
  *Emerald <version> is ready. Installing it restarts Emerald; your documents are not touched.* with
  **Install and restart** and **Later**. The press closes the window the ordinary way — the unsaved-work
  question included, and Cancel cancels the install — and the installer runs (`/S`, per-user,
  `--force-run`) only once the app is quitting because of it. The document open then is written to
  `reopen.json` in the app's folder, and opened again at the next start if the recents still grant it.
- **Quiet otherwise.** A scheduled download says nothing until it is ready. A pressed one says
  *Downloading Emerald <version>…*. A failed one is never silent, because there is a newer version: it
  falls back to the macOS notice (Download opens the release page) with the reason, a checksum
  mismatch said in words. Turning the setting off stops a download in flight. Differential download is
  off — one request to one file; the blockmap is published so turning it on is a later decision.
- **Version-free installer names.** `Emerald-Setup.exe`, `Emerald-arm64.dmg`, `Emerald-x64.dmg`. The
  release workflow uploads, sums and attests `latest.yml` and the blockmap with them. The page links
  `releases/latest/download/<name>` — but only once a release carries those names
  (`NAMED_INSTALLERS_RELEASED` in `src/demo/page/page.ts`); until then the cards link the newest release's
  page, which is never broken and never stale. `RELEASE` is gone.
- **From which version.** The first release built from this is 0.1.2; a copy older than that downloads
  the new one once by hand, as the README says.

**Consequences.** electron-updater is a dependency of the shell, bundled into `main.cjs` (the
packaged app ships no `node_modules`). `electron/windowsUpdater.test.ts` drives the real
electron-updater against a local feed laid out as a release: newer downloaded and checked, the same and
an older version refused, a wrong sha512 refused with nothing kept, a `latest.yml` naming another
version refused, no staging id. `updates.test.ts` covers the schedule with a stubbed downloader;
`network.test.ts` the gate. An unpackaged shell downloads from the feed `EMERALD_UPDATE_FEED` names, for
verifying itself; a packaged one ignores it. The real update — a tagged release installed, then a second
tag — is the maintainer's, in a review entry.

**Rejected.** The GitHub provider (more requests and endpoints than the check it would repeat). Reading
`releases/latest/download/latest.yml` (a race between the check and the download). Installing on quit
(the brief: nothing installed unasked). Running the installer straight from the press (the
unsaved-work question would come after the installer had started). Keeping v0.1.0's files on the page
until the next release (stale the moment a newer one is out).

## D-504 · 2026-10-18 · The Claude plugin ships the development pack's run-milestone, closing-pass and review-phase as generic skills beside this repo's own; its `version` is how an installed copy learns of an update, so a change to what it ships cuts one — `<pin>+<n>` for a plugin release with no package behind it, by `node scripts/pin-plugin.mjs --plugin`, the bare package version when the pins move — and `plugin.test.ts` fails when the shipped files' digest moves under an unchanged version; amends D-500 <a id="d-504"></a>

**Context.** M42 U7. A project that keeps only the development pack had none of the workflows this
repo drives its milestones with: `run-milestone`, `closing-pass` and `review-phase` live in
`.claude/skills/` and name this repo's paths, its decision log and its npm scripts. And the
maintainer asked whether shipping them reaches people who already installed the plugin. Claude Code's
plugin docs (*Plugin loading reference*, *Versions and updates*, read 2026-10-18) answer it: it
computes a version for an installed plugin — the manifest's `version` first, then the marketplace
entry's, else the source's commit — and `claude plugin update` and auto-update **replace the cached
copy only when that differs** from the one it installed; auto-update is **off by default for every
marketplace but Anthropic's own**; an update loads in the next session or after `/reload-plugins`.
Since D-500 the manifest's `version` equalled the npm pin, so a skills-only change under 0.1.2 would
have reached a new install and no existing one, until the next npm publish.

**Decision.**

- **Three generic skills in `hosts/claude/skills/`**, written from this repo's (as they are after M51
  F4 and F5): take-over of a stalled unit, the `report` column, one closing order (checks, commit the
  work, `land_units` with its hash and report, commit the landing), one writer per checkout, nearby
  tests while building and the full suite once, effort by the unit, the parallel mode with worktree
  children proposing through the inbox, the host's sessions and next-step box *if the host offers
  them*. They find the document as the hooks do: the path the session-start hook printed, else
  `.claude/emerald.json`, else the one `.emd` in the folder, and the main checkout's copy in a
  worktree. They name the project's checks as its `CLAUDE.md` or README says, never an npm script.
  This repo's copies stay in `.claude/skills/`; `skills.test.ts` holds `declare-a-format` byte for
  byte and fails when a generic one cites a decision or unit, a `docs/` note, a script, `npm run`,
  the memory document or a decision log.
- **The manifest's `version` is the plugin's release, its part before `+` the pin.** A pin move
  (`node scripts/pin-plugin.mjs`, after a publish) makes it the bare package version; a change to the
  plugin's own files makes it `<pin>+<n>`, the n-th plugin release on that pin
  (`node scripts/pin-plugin.mjs --plugin`, which asks npm nothing). `claude plugin validate` accepts
  it; Claude Code compares versions as strings, so `+1` is an update to anyone at the bare version, and
  the next pin move is one to anyone at `+n`. The pins stay where D-500 put them: never ahead of the
  package, moved only once npm has the version.
- **A digest makes it mechanical.** `hosts/claude/release.ts` hashes what a person's Claude reads
  from the plugin — the manifest without its version, the hook set, the skills, the README; not the
  TypeScript, which runs from the package — with line endings as LF; both modes of the script record it
  with the version in `hosts/claude-plugin-release.json`, and `plugin.test.ts` fails when the folder's
  digest differs from the record's, saying to run `--plugin`.
- **The README says how to update**: turn on auto-update for `emerald-emd` under `/plugin` →
  Marketplaces, or `claude plugin marketplace update emerald-emd` then `claude plugin update
  emerald@emerald-emd`.

**Consequences.** This unit cuts 0.1.2+1 with the three skills. Everyone at 0.1.2 gets it on their next
manual update, or within ten minutes of a session's first message with auto-update on. Proved on a clean
`CLAUDE_CONFIG_DIR`: 0.1.2 installed from the GitHub marketplace before the push, then updated after it
(the unit's report). A synthetic project keeping the pack ran two units at once through
`dispatch_plan`, two worktrees, a merge and one `land_units inbox` dry run — which found that a
proposal names its worktree's branch while the claim names the driver's, so the driver lands them with
`{id, other_branch: true}`; both `run-milestone` skills say so now.

**Rejected.** Leaving `version` out of the manifest so the commit is the version: every push to `main`
would be an update, and a notice in every session with auto-update on. A prerelease (`0.1.2-1`), which
semver orders below 0.1.2. A plugin version unrelated to the package's, which would hide which server a
plugin runs. Shipping this repo's own copies, which name paths a stranger has none of (M42 U4's brief).

## D-505 · 2026-10-19 · The Mac app is signed ad hoc after packing — `codesign --force --deep --sign -` from an `afterPack` hook, with `mac.identity: null` kept — so a download is an app Apple could not verify, which Open Anyway opens, rather than a "damaged" one, which nothing does; the release workflow fails a Mac build whose signature does not verify; no certificate, account or notarization, so D-124's unsigned stands; amends D-124 <a id="d-505"></a>

**Context.** M42 F4. The maintainer downloaded `Emerald-arm64.dmg` on a work Mac, dragged the app to
Applications, and macOS refused it: *Emerald is damaged and can't be opened*, offering only Move to
Trash. `mac.identity: null` makes electron-builder skip signing altogether, not even ad hoc, and packing
renames Electron's app and rewrites its `Info.plist`, which breaks the signature Electron shipped with.
A downloaded bundle whose signature does not match it is "damaged" to Gatekeeper, and that verdict has
no Open Anyway — so the README's way past the warning, written in M43 U1, could never have worked on
any release so far. electron-builder 26.17 has no ad-hoc setting: `identity: "-"` is looked up in the
keychain as a certificate's name.

**Decision.**

- **`scripts/sign-mac.mjs`, electron-builder's `afterPack` hook**, runs `codesign --force --deep --sign
  -` on the packed `.app` when the build is for macOS, before the disk image is made, for both arches;
  it fails the build when codesign fails, and does nothing on Windows. `mac.identity: null` stays, so
  no certificate in a keychain is ever picked up. No hardened runtime and no entitlements: neither
  means anything without notarization.
- **The release workflow verifies what it built**: on the Mac runner, `codesign --verify --deep
  --strict` on both apps, and their `Signature=adhoc` in the log, so a broken signature fails the build
  rather than reaching a person.
- **The README says what a Mac shows** — Apple could not verify Emerald; Done, then System Settings →
  Privacy & Security → Open Anyway — and, for a copy of 0.1.2 or earlier, `xattr -cr
  /Applications/Emerald.app` once in Terminal.

**Consequences.** D-124's *unsigned* means no certificate, no developer account and no notarization,
and all three still hold: an ad-hoc signature says only that the bundle is what was built. The Mac
updater still needs a real identity, so a Mac still gets a notice and a link (D-502). It reaches people
with the next release; `electron/macSigning.test.ts` holds the hook to signing with `-` and only on a
Mac build.

**Rejected.** `identity: "-"`, which electron-builder 26 does not read as ad hoc. An Apple Developer
account, which D-124 declined and nothing here changes. Telling people to run `xattr` as the way in:
it is the workaround for copies already out, not the path a stranger should meet.

## D-506 · 2026-10-19 · The MCP server says what Emerald is before it says what a pack is: both instruction blocks open on a format for any kind of thing and on what it reads (a spreadsheet, a `.json` of rows, a folder of Markdown notes read where it is), with `development` and `ledger` as optional packs; no tool or instruction measures work against money; the engine's tools are listed first in both modes; `create_document` keeps no pack unless asked, in both modes; reverses D-405's default <a id="d-506"></a>

**Context.** M42 F5. The maintainer started moving their work notes into Emerald with the assistant
at work, which had this server. It argued against it: *Emerald is built for money first. Its tools
describe everything outside finances as an add-on*, and Obsidian needs the files. It had read that
from us. The `formats` tool said it lists *what this document can hold besides its finances*; the
full server opened on the ledger as *a complete personal-finance application that a new document
keeps unless told otherwise*; *Not everything here is money*, *they know nothing about money* and
`start_here`'s *where work that is not money begins* each measured the engine against the ledger;
the full server listed 57 finance tools before the first engine one, and `document_info`, the first,
said *Call this first*; `create_document` gave a new document the ledger on the full server (D-405);
and the one sentence that answers the Obsidian objection — a folder of Markdown notes is read where it
is (M34 U7) — sat past the 2,000 characters a host may keep. An audit of every engine tool's text
found more of the same: finance examples in every advanced part of `declare_format`, the packs enum
reading `ledger (the ledger)`, `record_units` titled *Add or correct a unit* beside the development
pack's `unit` format, the development tools never saying they need that pack, and two places that
sent removing a connection to the app though `extend_format` removes one.

**Decision.**

- **Both instruction blocks open on what Emerald is**: what a person and a model worked out, about
  anything they keep — notes, tasks, books, a project's decisions, money; each kind a format; and
  what it reads — a `.csv`, `.xlsx` or `.json` of rows, or a folder of Markdown notes such as an
  Obsidian vault, read where it is and never changed. **Packs** are formats somebody already worked
  out, each optional: `development` and `ledger`. All of it inside the first 2,000 characters, with
  M43 U11's *how to show* still whole there.
- **When a person asks whether something belongs here, the model answers about the thing**: whatever
  they keep more than one of belongs; prose stays prose in a column shown as Markdown; a folder of
  notes is read where it is, so the editor that keeps the files keeps working.
- **No model-facing text measures the work against money.** `server.test.ts` fails, in both modes,
  on each phrase that did: *besides its finances*, *Not everything here is money*, *not money
  begins*, *know(s) nothing about money*, *a complete personal-finance application that a new*,
  *Formats come first*.
- **The engine's tools are listed first** in both modes; `document_info` is called *when a tool
  refuses a document*, and `start_here` is the one that is called first.
- **`create_document` keeps no pack unless `packs` names one**, in both modes. A model names the
  ledger when the work is the person's finances.
- **The audit's fixes**: neutral examples for constraints, rollups, rule sets and aggregate filters;
  the packs enum says what each pack is for, development first; `record_units` is *a unit of
  measure*; `claim_units`, `land_units`, `dispatch_plan` and `guide_status` say which pack they need;
  connections are removed with `extend_format` and only re-pointed in the app; one paragraph names
  what else a document does — rule sets and `apply_rules`, `format_problems`, `search_document`, the
  agenda, and a PDF or photograph read by the model.
- **The READMEs lead with `--engine-only`**: the npm package's, the repository's, and the plugin's,
  which also name the notes folder. The plugin is 0.1.2+2.

**Consequences.** The fix reaches a model only through a published `emerald-mcp`: the plugin and
`npx -y emerald-mcp` both run the package on npm, which is still 0.1.2 and says all of the above.
Publishing stays the maintainer's (D-497). The ledger stays exactly as capable on the full server;
it is named when it is wanted. The engine-only tool list grew by about 1k characters of prose.

**Rejected.** Making `--engine-only` the binary's default, with a flag for the ledger: an installed
configuration that runs `emerald-mcp` for the ledger would silently lose 57 tools. The READMEs lead
with the flag instead, which reaches every new install. Keeping D-405's default for the full server:
a new document that arrives holding a finance pack is the plainest way to say what Emerald is for,
and it said the wrong thing.

## D-507 · 2026-10-19 · The server says first what a model gains from a document — it asks for the matching rows instead of re-reading files, a typed field filters exactly, a link is followed, every session sees the same rows — and checks are one benefit among them, never the reason; whether something belongs is answered by its shape, never by whether it has numbers; amends D-506 <a id="d-507"></a>

**Context.** M42 F6. After D-506 reached the maintainer's work session it stopped calling Emerald
money-first and started calling its *main strength* checking that numbers add up — and advised
against moving notes because they hold no numbers. Only when pressed did it find the real case on
its own: `start_here` instead of grepping 139 daily notes, exact filters on typed fields and links,
writes that cannot break a task's syntax, the same rows for the person and every session. Our text
taught the first answer: the formats section called a claim *the reason to keep this here rather
than in a spreadsheet*, the registry listing said *a model reads and checks*, and the plugin's and
the package's descriptions said *real types and real checks*. Nothing said what a model gains.

**Decision.**

- **Both heads open on what a model gains**: what a person keeps is rows of formats, so a session
  *asks instead of reading* — the matching rows in one call, not forty files re-read; a field
  filters exactly, a link is followed, a write is checked, every session sees the same rows. Inside
  the 2,000 characters, before *how to show*.
- **A claim is one more thing a document does**, beside being asked for its rows — not the reason.
- **Whether something belongs is answered by its shape**: tasks, meetings, people, projects,
  decisions, bugs belong because a session asks for them; figures that must agree are one more
  reason, never the only one; free prose gains least and stays files, a body column or a link.
- **The listings lead with asking**: `server.json`, the plugin's manifest and the npm README.
- `server.test.ts` fails on *the reason to keep this here* and *a model reads and checks*, and when
  the head mentions checking before asking.

**Consequences.** Another `emerald-mcp`, 0.1.5, and a plugin pin move once npm serves it. Both of
D-506's gaps and this one were found by a session outside this repository reading the server cold,
not by this project: the follow-up is a check that does that on purpose.

**Rejected.** Keeping checks first because the pitch says *won't let you be wrong quietly*: the
pitch is the maintainer's to change; the server's job is to say what a model can do with it.

## Related

07 Roadmap · [conventions](./conventions.md) · review · `docs/memory.emd` (the `decision` rows)
