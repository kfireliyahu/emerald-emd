---
type: product
project: Emerald
updated: 2026-09-20
---

# What Emerald is, and who it is for

*Settled in conversation on 2026-09-20; [D-238](./09-decision-log.md) carries the argument and the
evidence. **This note is deliberately plainer than the rest of `docs/`.** If it needs the house
style to be understood, it has failed, and so has the thing it describes.*

## The sentence

> **Excel that reads your documents and won't let you be wrong quietly.**

That is the pitch, and it replaces *"the domain layer between a person, a model, and their own
data"* as the thing said first. The old sentence describes the architecture. Nobody wants an
architecture, nobody searches for one, and it does not survive being tired.

### What it means, because it is two things and not one

**M22 U1 tested this against a real document and it needed saying** ([D-240](./09-decision-log.md),
[D-242](./09-decision-log.md)). All four memory formats declared `nothing_must_hold: true`, and the
first reading of that was *the pitch did nothing for them*. It is wrong, and the reason matters:

1. **It refuses what contradicts what you said.** Types, `required`, an `enum`'s members, a `link`
   that has to resolve — checked at the moment you write, on **every** format. A list of books with
   no arithmetic in it gets all of this.
2. **It proves what you claim.** Claims — a total against its parts — and the third state. Only where figures relate to
   each other, which is money, recipes, payslips — and not books.

**The pitch is both, and most formats only ever get the first.** That is still something a folder
of markdown and a good model gives you none of, which is the competitor that actually matters.
Saying "won't let you be wrong quietly" and meaning *identities* is the mistake — it writes off
everyone whose data is a list, and that is most people.

A spreadsheet already exists, everyone has one, and it is free — so *"like Excel"* can never be the
reason to use this. The reason is the four things a spreadsheet will not do:

- It will not read your payslip and put the right numbers in the right cells, in Hebrew.
- It will let a money column hold a float and never say a word.
- It has no **`unchecked`** — it shows you a number whether or not that number means anything.
- It cannot be driven by a model, over your real file, without the file leaving the machine.

## Who it is for

**Two crowds, and they are genuinely different people.**

- **The ledger crowd** wants their money correct and private. They do not care what a format is.
- **The engine crowd** uses a model daily and wants its memory *typed* — a real base under the
  notes, so the model stops re-deriving and re-asking, and so the person can read it too.

They are served by one product because **money is the hardest possible instance of the engine's
claim**: it must reconcile or it is worthless. So the ledger is not a second product competing for
attention. It is the proof.

> *The same machinery that keeps your pension fees honest keeps your notes honest.*

**With the caveat above**: notes get the refusals, not the proofs. What would give the notes crowd
its own equivalent of an identity is **provenance and staleness** — *this decision was superseded
and four things still cite it* — which is H8 in [engine](./engine.md), unbuilt and unscheduled, and
which [D-211](./09-decision-log.md) called the reason the product exists.

This shape is not unprecedented — it is a **flagship first-party app on your own platform**, which
is the most common shape there is. The mistake was building the two side by side instead of one on
top of the other. [D-214](./09-decision-log.md) is the correction.

## The second crowd has a name now: a repo's memory

**This is the part that might be bigger than the app, and it was measured here before it was
claimed.** M22 put this project's own notes into a document ([D-240](./09-decision-log.md)) and the
comparison is not close:

| | markdown | the document |
|---|---|---|
| *What is still open?* | spread over **six files**, and one of the four questions **was written down nowhere at all** | one call |
| cost of asking | ~72KB across three files, **~20,000 tokens** | **~450 tokens** |
| *which units did M20 build?* | a 95-line section, read end to end 28 times | a few hundred tokens |

Forty times cheaper, and in one case the difference between an answer and no answer.

**But that number is against *this project's* markdown, which is prose over six files — and it is
not the reason to do this.** Against *well-structured* markdown, `grep '| open |'` closes much of
the gap, and saying "forty times cheaper" would be testing the wrong claim. The two things a table
has that no markdown file has are narrower and truer:

- **A write that is refused.** `state: "pending"` against an enum of `open | answered` is rejected
  by name, at the moment it is written. Markdown accepts anything anyone types.
- **A shape that cannot drift across seventy sessions.** Measured here: `review.md` prescribes
  *Do / Should / Where it breaks / Not tried here* at the top of its own file, and **six of its
  fifteen unit entries are missing at least one of them** — including entries written this month.
  A column cannot do that.

So the pitch to a stranger is **"your ADRs stop rotting"**, not "it is forty times cheaper". A
smaller claim, and one that survives contact.

**Nothing about those four formats is about Emerald.** `decision`, `unit`, `open_question`,
`review_entry` are generic to software work. Every repo with an ADR folder, a decision log, an RFC
directory — and every repo whose `CLAUDE.md` says *"do not read this file end to end"*, which is an
admission that prose does not scale as memory — has the same problem and the same shape of answer.

So the honest statement of the second crowd is: **a typed store a person and a model both read and
write, that lives in the repo and belongs to whoever cloned it.** The competitor is a folder of
markdown and a good model, which is free and works; the delta is types, links, filters and — one
day — staleness.

### The file itself can be the readable thing

**Settled 2026-09-20, [D-246](./09-decision-log.md), and it replaces most of what this section used
to worry about.** A `.emd` may be **text or SQLite bytes, chosen per file.** A repo's memory is
hundreds of rows, where text is five times smaller and opens in milliseconds; a decade of
transactions is sixty thousand, where the binary wins. Same app, same engine.

> **Your data is a text file you can read. The app is what gives it types and proofs.**

That is a better sentence than *"it is a SQLite file"*, and it is [D-115](./09-decision-log.md)'s
document-based stance rather than a new one. **git diffs it because it is a text file, and a person
reads it because it is a text file** — no rendered copy, nothing to keep in sync, no filter to
configure, nothing broken on a fresh clone.

### What has to be true before this is a claim rather than a hope

Three things now that the file itself is readable:

1. **It is only as current as its last write.** As of 2026-09-20 the document holds M20 and the five
   decisions taken since went to markdown alone. **A memory that lags is worse than none**, because
   it is trusted and wrong.
2. **A session has to know to ask it.** `CLAUDE.md` now says so, in one table of four questions.
   That is per-repo hand-wiring today and it is the cheapest possible version of the problem.
3. **One file, one machine.** Fine for one person, a wall for a team — and a team is where the
   diffing problem bites hardest too.

### Who else is here — researched 2026-09-23, and the answer is: a lot

**The development pack, as a product, has been done.** Every slice of it has a serious occupant,
and they are named nowhere in this project on purpose — the ideas here are the project's own:

| Slice | What exists | How close |
|---|---|---|
| planned work for agents (`unit` + `brief`) | issue trackers built for coding agents — MCP, a dependency graph, multi-agent claiming | very close, and far ahead |
| typed decisions (`decision`) | decision records as frontmatter, validated in CI | close; it is the *markdown + a linter* row of D-244's table, built |
| human and model both read and write, local, MCP | markdown notes with a SQLite index and a relation graph | close in shape, untyped |
| git semantics for a SQL store | version-controlled SQL databases | infrastructure rather than a product |

**What none of them does**, as far as a day's search found — which is not the same as nobody:
**the record types are the user's.** Each ships a fixed schema. Here, a `brief` column was added
to this project's own `unit` format in a week without writing code. **The four formats are
declarations on a general engine, not a hardcoded app** — and refusal happens at the write, not in
CI. The nearest things that let you declare your own types are cloud products, not a file in your
repo.

**So the development pack is a second proof, not a product.** Pitched as *"typed tasks and
decisions for coding agents"* it is head-to-head with trackers years ahead. Pitched as *"declare
the records you need and they get types, refusals, links and an MCP surface — here is a repo's
memory as the example"*, it is the engine, which is what D-238 already said the product was.

**And the market is evidence about [D-246](./09-decision-log.md), not only competition.** At least
one agent tracker began with exactly this shape — records as text in git, SQLite as the local
cache — and left it in early 2026 because the text file conflicted on rebase and merge whenever
several branches or agents changed it, moving to a database with cell-level merge. **For one
person a text `.emd` is fine. For a team, which is what the proof of concept is, this is the first
thing to test, not the last.**

### Why this is the proof-of-concept and not a detour

A software team keeping its own notes is the **second real user** of a project whose defining
problem was having none. And it costs almost nothing to find
out: the four formats already exist, a pack of them would be a declaration rather than code, and
the measurement above is repeatable on any repo in an afternoon.

## The finish line

The engine had no definition of done, which is why it felt endless. It has one now:

> **The engine is done when the ledger is nothing but declared formats, identities and links —
> and no non-`fmt_` table is left.**

That is a test that can fail. Every unit either gets a payslip closer to being a declared format
or it does not.

## What this rules out

- **No work justified only by "a stranger would need this."** The quality bar is *does it annoy
  the maintainer* — which is a real bar, not a lower one, and it is what "the app says less" means.
- **Declaring is the escape hatch, not the front door.** The ledger is the front door. A person
  who never declares anything should still get the whole value.
- **"So the user can do whatever" is not a plan.** Whatever has no finish line; the ledger does.

## Related

[engine](./engine.md) · [D-238](./09-decision-log.md)
