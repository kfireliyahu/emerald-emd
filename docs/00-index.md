---
type: index
project: Emerald
---

# The map

**Emerald is Excel that reads your documents and won't let you be wrong quietly** — and,
underneath, the domain layer between a person, a model, and their own data. A person and a
model work something out — what a kind of thing is, which fields it has, what has to add up — and
this is where that goes to stay true. Local-first, document-based, no network call.

**You do not read this folder.** Two things orient a session: [conventions](./conventions.md) and
the `start_here` call on `memory.emd`, which answers where the build is from the rows (D-434). This
page exists so you can find a note when a task needs one.

## Start here

| | |
|---|---|
| [product](./product.md) | What Emerald is, who it is for, and the finish line. Short, and plain on purpose |
| [conventions](./conventions.md) | The contract between sessions: before you start, the closing pass, done. The rules, laws and traps are `rule` rows in `memory.emd` (D-435) |
| [engine](./engine.md) | What Emerald *is*, the four layers, the line, and the questions it opened — their states are `open_question` rows |
| `milestone` rows in `memory.emd` | The plan of record, milestone by milestone: `format_rows milestone order:position` (D-286, D-438) |

## The core notes

| | |
|---|---|
| [02 Architecture](./02-architecture.md) | Stack, layering, storage, the desktop shell, and what each build makes. The folder layout is the code; how it is written is the `rule` rows with `kind: style` |
| [04 Data Model](./04-data-model.md) | The engine's tables — declarations and reading vocabularies |
| `term` rows in `memory.emd` | The glossary, as rows (D-436): one name per thing, what it means, what it is not, the names turned down — `format_rows term search:"<word>"` |
| [11 UI Design Language](./11-ui-design-language.md) | Visual style: where the values (`tokens.css`) and the rules (`rule` rows, `scope: ui`) are |
| [plugin](./plugin.md) | The MCP server: what it exposes and the rules it keeps |
| [mapping-templates](./mapping-templates.md) | Reading a document onto a table, and the stored template that remembers how |
| [parity](./parity.md) | What a screen can do and no tool can, and the reverse — written by `src/parity.test.ts`, never by hand |
| [09 Decision Log](./09-decision-log.md) | Every core decision indexed; the open milestones in full |

## The ledger pack

A personal-finance application — about eighty thousand lines and thirty tables — **enabled by
default and parked**. It is also the on-ramp and the entire evidence base.

| | |
|---|---|
| [packs/ledger/README](./packs/ledger/README.md) | What it is, where it actually stands, and its own list of traps |
| [packs/ledger/roadmap](./packs/ledger/roadmap.md) | M0 to M18 |
| [packs/ledger/05](./packs/ledger/05-domain-rules-and-calculations.md) | Its math: money, signs, the three dates, paychecks, the splitter, funds, savings, statistics |
| [packs/ledger/decisions](./packs/ledger/decisions.md) | The ledger half of the decision index |

Its feature notes are in that folder. **Do not take a unit from it** — M25's own units are the exception (D-265).

## History

The full record of earlier milestones is kept privately; every decision is a `decision` row in
`docs/memory.emd` (`format_rows decision search:"…"`), and what is still open from the old review
queue is `review_entry` rows (D-238, D-438).

## How this folder is organised

- **Numbers are sort order, not a sequence.** They are gappy because notes have moved; a number
  never means "read these in order".
- **Every note here is current.** A note in `packs/ledger/` is accurate and
  parked — it describes something that works and is not being worked on.
- **The decision log is two indexes over one set of entries.** Nothing was split, copied or rewritten
  when the ledger became a pack, so every D-number resolves from either side. Numbering continues
  across both.
