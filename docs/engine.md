---
type: spec
project: Emerald
updated: 2026-09-16
---

# The engine

**Everything about what Emerald is, in one place** — its thesis, its four layers, the line it
draws, and the questions it has not answered yet. It began as a proposal
([D-209](./09-decision-log.md) to [D-211](./09-decision-log.md)) and is now **what is being
built**: where it stands is `start_here` on `memory.emd`, and what is next is the `milestone` rows.

**Section H's questions are `open_question` rows** (`format_rows open_question search:"section H"`, and H10 by its `ref`; D-438):
each one's state, the decision that opened it and the one that answered it. The argument stays here.
Read the open questions in section H as open. **Several have been answered by building rather
than by reasoning, and that is the pattern** — H2, H3 and H6 are settled; H11's answer arrived
when the screen that was supposed to answer it was looked at and rejected
([D-218](./09-decision-log.md)).

This file is unnumbered on purpose. The numbered notes specify parts; this one says what the
whole thing is for.

> **The domain layer between a person and a model** — a typed local store with a proof engine, where
> what you and a model worked out goes to stay true.

**That is the architecture, and since [D-238](./09-decision-log.md) it is no longer the sentence
said first.** The pitch is *Excel that reads your documents and won't let you be wrong quietly*;
[`product.md`](./product.md) carries it, and who this is for. This note is the argument underneath,
and it stays as it is.

## What it is

**The model is the interface. The person is the intent. Emerald is the typed middle both operate
on** ([D-215](./09-decision-log.md)).

**The repo has been proving this property for a year in the wrong place.** `src/domain/` imports
nothing from React, sql.js or the DOM — interface-independent and storage-independent by rule. The
product is that same property one level up, and naming it that way hands a session a test the words
*engine* and *bridge* never gave it:

> **If it is about presentation or storage, it is not the domain layer.**

That is why a declarative UI layer and a formula DSL are out — one property, rather than two bans
that have to be remembered separately. *Engine* survives as the informal word and as this file's
name; it is not the positioning.

## What it is for

**The spec is three arrows**, and it is a sentence rather than a layer diagram
([D-214](./09-decision-log.md), 2026-09-15):

> **read a document / talk with user on Claude → format (which is the data) → make connections to
> other formats**

**Intake · Format · Links.** That is tighter than the four layers below it and it is what a session
should build against; the layers are how, the arrows are what. **The repo already serves intake and
fights the other two** — thirty hand-written tables are the opposite of *format is the data* — which
is why the format model is built **clean, beside the finance app, in the same document, touching
none of it**, and why intake is imported rather than rebuilt.

**This section is the thesis. Everything below it is mechanism.** It exists because the mechanism was
written first and on its own it does not tell a session what the product is for, which showed up
exactly where you would expect — sessions building correctly against D-209 and D-210 and unable to
make a judgement the spec had not already made for them ([D-211](./09-decision-log.md)).

A model session produces two things: **structure** (the shape you and it worked out) and
**realisations** (what follows from the figures). Both die when the session ends. What survives is a
transcript nobody rereads and, at best, a note with numbers frozen into it. **Emerald is where those
two things go instead** — the structure becomes a typed table, the realisations stay attached to the
figures they rest on, and when a figure moves, what depended on it says so.

> **Emerald is the contractor.** It does not decide what you want built. It takes the shape you
> specify, does the load-bearing work you should not have to do by hand, and tells you when something
> has stopped holding.

### Four things that follow, and they are not obvious

1. **Prior structure is a dial, not two intake adapters** ([D-215](./09-decision-log.md)). A card
   statement arrives with columns and a printed total that must reconcile; a payslip arrives
   label-value with no schema; a product label arrives as a photograph; an intent — *"I want to track
   the products I try"* — arrives with no structure at all. **It is the same job at every setting:
   what changes is how much of arrow 1 runs, and the output is always a format.**

   So the zero-structure end is the ordinary case rather than the exception, which is why
   M19 starts with a format that has no
   document behind it and retargets intake last. The ladder, the mapper, the confirm surface and the
   proof engine do not change; what changes is that **a format is never obliged to have a document
   behind it**, and no screen may assume one. The vault that validated this whole idea (D-210) **had
   no documents in it at all**.

2. **Provenance and staleness are the point, not the last gap.** Filed below as
   [H8](#h8-when-a-figure-changes-what-happens-to-the-prose-about-it), which undersells it. `Daily
   Targets.md` states `1,581 kcal · 97 g protein · 3,033 mg sodium` and concludes *"protein is solved
   and sodium is the problem"* — computed once, by a model, frozen into prose, silently wrong the
   moment a brand changes. **The competitor that actually matters is a folder of markdown and a good
   model.** It is free, it works, it improves on somebody else's release schedule, and this
   project already ran one (D-210). The delta is types, identities, provenance and staleness. That is the product.

3. **Designing a format is public-safe by construction; filling one is private by construction.**
   A schema conversation contains no figures, so it can happen with the best model in the world, in
   the cloud, with nothing at stake. Filling the table happens here, with a local model or a pair of
   hands. **Nothing else occupies this position** — the assistant built into an all-in-one notes-and-database
   workspace sees the data, a spreadsheet copilot sees the data, a plugin for a notes app over plain
   Markdown files may do anything. It is also why D-124 costs this product
   nothing: the network was only ever wanted for the half that carries no personal information, and
   that half already happens somewhere else.

4. **The app never does the thinking the user came to do.** It does the bookkeeping that stops the
   thinking from rotting. This is the tie-breaker for any fork the rest of this note leaves open, and
   it is not new — it already decided **prompted** over automatic in [H3](#h3-may-a-format-carry-no-identities-at-all)
   and **flag** over regenerate in [H8](#h8-when-a-figure-changes-what-happens-to-the-prose-about-it),
   both times before anybody had named it.

### Abstract data, not abstract reasoning

*Organize abstract things* needs a boundary or it becomes *Emerald organizes your thoughts*, which it
cannot do and must not claim ([D-215](./09-decision-log.md)).

- **In scope:** what is enumerable, typed, comparable and linkable. A product you tried, an
  ingredient, a position, a deduction line.
- **Out, permanently:** the argument about what the figures mean. That is yours, by the rule above —
  and it is exactly why [H8](#h8-when-a-figure-changes-what-happens-to-the-prose-about-it) says
  **flag** rather than **regenerate**.

**Typed and proved, or it is a folder.** A domain layer that does not enforce types and does not check
identities is a note-taking app with a thesis.

### Who it is for, which did not widen

**The person who already keeps this by hand and is tired of it.** Not the person who has never used a
spreadsheet — that person does not keep a recipe vault either, and designing for them would trade a
real audience for an imagined one. [12 Market Reality](./packs/ledger/12-market-reality.md) said *build it for
yourself*; this is that conclusion reached a second time from a different direction, and the second
arrival is the reason to trust it.

### The nearest neighbours, named honestly

| | What it has | What it does not |
|---|---|---|
| **A spreadsheet** | Formulas: you author the computation, it produces a number | Cannot tell you it rotted. A formula produces a value; an **identity** produces a verdict |
| **An all-in-one notes-and-database workspace** | Flexible schemas, relations | Untyped storage, no document reading, no proof. **The only version of this that becomes one is the one with a `value TEXT` column, and it is rejected** |
| **A markdown notes app + a model** | Everything, today, free | No enforced types, no identities, no provenance, no staleness. **It was the prototype and it failed inside one week** — `Yogurt` stores `price_ils_per_100g`, the soy milk stores `price_ils` plus `package_ml` |
| **Typed, relational spreadsheet-databases** | Typed, relational, formula language, one of them self-hosts | **The real nearest neighbour.** No document ingestion with proof, no provenance, no staleness. Three things — that is the entire delta, and it is worth knowing so nobody rebuilds one by accident |

## Where it came from, in one paragraph

M16 broke because a vocabulary compiled into the binary could not name a column a real broker
statement printed ([D-208](./09-decision-log.md)). The reading went past the bug: **the
trouble was never that investments are hard, it is that they are *specific*** — and so is payroll,
and so is a pension report. What the app does is take an arbitrary document, map it onto an
expectation of what the data should be, prove the reading, and connect the result to other data.
**That mechanism is domain-independent and the domains are content.**

**The code arrived there before the idea did.** D-013 refuses per-provider parsers. D-149 forced one
ladder across payslips and fund reports. D-206 put four confirm surfaces under one rule. D-137 and
D-132 make a model answer with positions and never values. `il-core.json` is one rulepack in a
directory built for many. And `HOLDING_COLUMN_ROLES`, `TRADE_COLUMN_ROLES` and the payslip and
fund-report roles are **four per-domain vocabularies over one mechanism** — a pack system that had
not been told it was one.

## The four layers

| | What it is | Who authors it | Code or data |
|---|---|---|---|
| **Core** | Money as minor units, the `.emd` document, the ingestion ladder, the mapping machinery, the confirm surface, the proof engine, the model contract. **Knows nothing about money's purpose.** | You | Code |
| **Pack** | A domain: curated formats, reference tables, identities worth checking, readers for its document types, screens where a table will not do. | You, or a developer | ~⅕ code |
| **Format** | A kind of thing — a payslip, an ingredient, a product you tried. Columns, identities, links. Compiles to real DDL. | **The user**, with Claude, using no personal figures | Data |
| **Template** | How *one issuer's actual file* maps onto a format. Already exists as [F17](./mapping-templates.md) and is unchanged by any of this. | The user, per file | Data |

**Format and template are different things and the distinction is the centre of the design**: a
format is what a payslip *is*; a template is how *this employer's* PDF lands on it.

## The line

> **Stateless and relational is declarable. Temporal, iterative or semantic is code.**

**Declarable:** identities (`units × price = value`, `Σ rows = printed total`, `4P + 4C + 9F + 2Fib ≈
kcal`), links between entities, derived columns, **aggregates across a link with unit conversion**,
threshold banding. **Built in U4b** ([D-224](./09-decision-log.md)), and the bound that keeps it on
this side of the line is **one hop**: an expression may read a column of the row it names, and an
aggregate folds the rows that name this one. A second hop is a parse error, so a traversal has no
syntax rather than a rule.

**Code, always:** cost basis as a moving average over time-ordered events (temporal). The trace
view, where *spent is not stopped* and a fund is an arrival (semantic). The splitter, an allocation
with modes. **A declaration language that reaches these is a programming language, and nobody will
write in it.**

D-209 drew this line at "no loops or decision trees" and permitted only simple aggregates; D-210
moved it after a real domain needed sums across a join. **The forbidden set did not change; the
permitted set grew, and the difference is a unit system** ([H7](#h7-is-the-unit-system-the-engines-or-a-packs)).

**Today belongs in questions, never in claims** (D-472). A filter
(`due is within 14 days`, `before today`), a sort and a computed column worked out on read (`days_left
= due - today`) may read the clock; an identity, a total a claim reads, a rule set and the stored view
may not. A proof that held yesterday must not fail tomorrow with nothing changed.

## Why correctness survives user-authored schemas

The obvious objection is that flexible schemas forfeit the constraints. **The app already disproves
it.** `deduction_type` (`012_paychecks.sql:19`) is a real table whose rows *the user creates*,
carrying `linked_debt_id` — a foreign key from a user-made vocabulary row into another entity —
participating in the deduction→fund link (D-169).

**Correctness never came from schemas being fixed. It came from their being real.** A declaration
that compiles to actual DDL is as constrained as `030_price_precision.sql`. What forfeits D-004's
CHECK and D-118's numbers is **untyped storage** — EAV rows, JSON blobs, a `value TEXT` column — not
who authored the declaration. **That is the only version of this that becomes an all-in-one
notes-and-database workspace, and it is rejected.**

## What a pack contains, and why that answers the freedom worry

The concern was that developer-authored packs *"ruin the idea of freedom for the users"*. Enumerated
against the nutrition case, a pack is: curated formats (data), identities worth checking (data),
reference tables — RDAs, banding thresholds, analogues, unit and retention factors (data), links to
other packs (data), **readers** for its document types (part code), and **screens** where a generic
table will not do (code). **Roughly four fifths is declarations.**

**So a pack is a seed, not a dependency** — closer to a template workbook than to a plugin, and
editing a pack's format is the same act as writing one. Developer-dependency survives only for
screens and exotic maths.

**And the plugin is what makes that true.** If the shaped tools are generated from a format's
declaration, **a format is usable by Claude the minute it exists, with no screen at all**. That
demotes screens from capability to polish, and it is exactly how the recipe vault below works today:
no interface, a person and a model as the interface.

## The evidence: a vault that is the engine, built by hand

A recipes vault — twelve ingredient notes, two recipes and a targets note, built in three days
with Claude in a markdown notes app. **It is not evidence for the idea so much as the idea already
implemented by hand** (D-210).

- **The frontmatter is a format declaration.** Twenty-five typed fields per ingredient, consistent
  across every note, with nothing enforcing it — and the gap showed inside one week: `Yogurt` stores
  `price_ils_per_100g` while the soy milk stores `price_ils` plus `package_ml`. **Two shapes for one
  fact.**
- **The house style was reinvented independently.** `micros_basis: analogue | mixed` is a **third
  state**, which is `proved / failed / unchecked` (D-149) arrived at again in another domain.
  `verified: 2026-09-13` is staleness tracking with nowhere to live.
- **The identities were already written, in prose.** `4×6.6 + 4×2 + 9×2.8 + 2×1 = 61.6 against 62
  declared` is `holdingReconciles` with a rounding tolerance. The pasta note cross-checks a cooked
  label against a dry one at a yield of 2.0 and reports *"four for four"*.

**`Ingredients/Pasta.md` is the specification.** If a declaration can hold that note, the engine
exists.

## The layer the app does not have: provenance and freshness

`Daily Targets.md` states that two meals give `1,581 kcal · 97 g protein · 3,033 mg sodium`, then
concludes *"protein is solved and sodium is the problem"*. **Those figures were computed once, by a
model, and frozen into prose.** Change a brand, correct an analogue, adjust a quantity — the table is
silently wrong and every conclusion resting on it with it. Nothing recomputes; nothing flags it.

**That is the disease the confirm surface and `restate*` cure for financial documents**, suffered in
another domain by the person who built the cure. So the engine owes four things:

1. **A source per figure** — off a label, from an analogue, computed, typed by a person, proposed by
   a model.
2. **A verified date per figure**, rather than per file.
3. **Downstream flagging** when an input moves.
4. **Notes that declare their dependencies and go stale visibly**
   ([H8](#h8-when-a-figure-changes-what-happens-to-the-prose-about-it)) — **the only genuinely novel
   thing in the design**, and it exists because this is the rare app holding both the arithmetic and
   the argument about it in one file.

## The surface, counted

**11 features already built · 6 changing shape · 29 new.** The reading half barely moves — intake,
the ladder, the model contract, stored templates and the dry-run write path are built and stay.
Everything new clusters in formats, provenance, views and packs. **That is the answer to "am I
rebuilding what I did": no — a layer is added above it and finance moves sideways into a pack.**

**What retires:** the investments statement reader, the four hand-written column vocabularies, the
hand-written plugin tools, and four separate confirm surfaces becoming one.

**What does not move at all:** money as minor units and a currency code; no network from the page;
`accent` marks what you can act on and never colours a figure; hash routing; bidi isolation; real
statement files never entering the repo; and a session never closing a milestone.

**What stays expensive** used to read *per-document migrations*, and
[D-214](./09-decision-log.md) took most of that away: the declarations live in the document and are
the source of truth, so the tables are **reconciled to match them on open** rather than migrated
along a chain. What is left is genuinely hard and much smaller — **dropping a column that holds data,
and changing a column's type or unit**, which the reconciler must refuse rather than guess.

## The first unit

**Built, 2026-09-15** ([D-216](./09-decision-log.md)): `fixtures/synthetic/ingredient.format.md` is
that note as a declaration and it compiles. The reconciler refused **four** things rather than the two
predicted below. What follows is the unit as it was specified, kept because the reasoning is still the
reasoning.

**Make `Ingredients/Pasta.md` expressible** — twenty-five typed columns, real types, real `CHECK`s,
and a reconciler that makes the document's tables match its declarations. **A format that is not
money, on purpose**: it is the stress test D-211 set, and building against `holding` instead would
make retrofitting finance the path of least resistance on day one.

[D-208](./09-decision-log.md)'s fix is **not** this unit and no longer waits on it — it landed
separately as U0 (D-212, D-213), which is the correction at the foot of this section.

**Then:** generated plugin tools, then identities, then links, then intake retargeted. **Stopping
after any step is allowed**, and **the first two together are the minimum viable engine** — they
reproduce what a vault of markdown already does by hand, with types underneath it.
M19 carries the five in order.

**A declared table needs a reconciler, not a migration chain** ([D-214](./09-decision-log.md)). This
note used to call per-document migrations the genuinely hard part; it was the wrong shape of problem.
The declarations live in the document and are the source of truth, so on open the app makes the
tables match them — idempotent, not a chain. **What has to be version-compatible is the declaration
language, which is one number, rather than the set of tables, which is unbounded.** What survives is
smaller and sharper: **dropping a column that holds data, and changing a column's type or unit, are
the two cases the reconciler must refuse rather than guess.**

**What must not happen is the engine becoming permission to stop finishing things:** M16 is held,
M17's review is deferred, M12 was never scheduled and
M18's feature list is unfinished. A second unfinished layer on top of
an unfinished first one is the real failure mode here, and it is likelier than the idea being wrong.

**A correction worth keeping.** The first session to act on this note took D-209's step-1 list —
unfreeze the four column vocabularies — rather than the restated first unit above. That work landed
(D-212, D-213), it is [D-208](./09-decision-log.md)'s fix, and **it is not the engine**; the roadmap
calls it U0 for that reason. **Build against a format that is not money**, or retrofitting finance
becomes the path of least resistance on day one.

**The ruler for everything:** *does this make the next format cheaper?* If yes, build it. If it only
makes the architecture prettier, do not. That rule permits unfreezing the vocabularies, declarable
identities and generated plugin tools; it forbids a declarative UI layer and a formula DSL for
analysis.

---

## H. The engine, and what is still open (2026-09-07, revised 2026-09-15)

The shape is [D-209](./09-decision-log.md): four layers — **core**, **pack** (code),
**format** (data), **template** (the mapping from one issuer's file). What follows is what those
decisions deliberately did *not* settle. **Nothing here should be built until the answer is written
down**, because each one changes what the first unit looks like.

**Two corrections from [D-210](./09-decision-log.md).** First, **the word is `pack`**, confirmed
on 2026-09-15 and applied throughout this section. The decision entries still say
*extension* and are left as written, because a past entry is never edited — but H5 settled that a
domain package is bundled and **enabled**, never downloaded or installed, so *extension* carries a
plugin connotation the design has rejected. Second, **the line moved**: D-209 said *a format declares what a
document says; code computes what the data means*, and permitted only simple aggregates. A vault of
recipes needed aggregates **across a join, with unit conversion**, and the forbidden set held
unchanged. The line that survived real data:

> **Stateless and relational is declarable. Temporal, iterative or semantic is code.**

**And one from [D-211](./09-decision-log.md):** H1 and H6 are now complete, **H10's question is
answered for a declared key** (D-261) and still open for resemblance, and the
questions were eleven. **[D-215](./09-decision-log.md) took H11 back out** — eliciting a format is
the first arrow at the zero-structure end rather than a question to defer, so it became a clause of
U1, and [D-216](./09-decision-log.md) answered it by building: the artefact is markdown, the
conversation is a skill, and the app's part is the review step — **and both of those two were rejected
on sight, so [D-219](./09-decision-log.md) re-answered it by building the editor.**
**[D-221](./09-decision-log.md) took the dial to its far end**: a label, a receipt or a spreadsheet
and a local model, proposing the columns into that same editor. Eliciting a format now has all
three settings, and none of the three has been driven against real documents yet.
**H9 is answered too** — the reconciler refuses four things and allows all four on a column holding no data. The thesis they hang off is
[What it is for](#what-it-is-for) at the head of this note — **read that first**, because several of
these forks are settled by it rather than by reasoning about the mechanism.

### H1. Is the ledger core, or a pack?

Transactions, categories and rules are near-universal for anything calling itself a finance app,
and today they are simply *in* the app — `transaction`, `category`, the rulepack, the labeling
queue, the import review screen. **If the ledger is core**, Emerald is a finance engine with
domain packs and the core is never empty. **If the ledger is a pack**, Emerald is a
document-and-proof engine that happens to ship a finance pack, and a user could in principle run it
for something that is not money at all.

The second is cleaner and much more expensive: the core would keep only money, documents, reading,
proof and correction, and `month_summary`, the splitter's inputs and Home would all move out. The
first is honest about what this is. **Consequence to weigh:** the answer decides whether a pack
means *a domain within personal finance* or *a domain, full stop*.

**ANSWERED 2026-09-15 — the ledger is a pack, enabled at first run unless the user says otherwise**
([D-211](./09-decision-log.md)). H6 chose *the engine, packs chosen at first run*, and a genuine blank
first run cannot contain a ledger, so the ledger leaned **pack** — but that was not certain
and it was left as an implication to confirm. What completed it is this note's own best argument for
the other side: **H2's beauty-products case is valuable because of one link into the ledger** —
*"a notes-and-database workspace cannot, because it does not have the card statement"* — and so is
the chain from a receipt to an ingredient to a recipe. Without the ledger, a recipe pack is a notes
app over plain Markdown files, with types.

So the second branch, *a user could in principle run it for something that is not money at all*,
describes a configuration in which **the product loses its differentiator**. **The engine is
domain-independent; the product is not obliged to be.** The answer is a third option that was in no
note: the ledger is a pack, `month_summary` and the splitter's inputs move out with it, the core still
knows nothing about money's purpose — **and first run ticks it**. A blank document stays possible and
is not the default.

### H2. May a format declare its own table, or only map onto tables a pack shipped?

This is the fork the whole idea turns on, and D-209 leaves it open deliberately.

- **Map-only.** A format is a mapping onto tables a pack already created with a real
  migration. Every correctness property is untouched, and it is close to what exists — but a user
  cannot introduce a *new kind of thing*, only a new way of reading an existing one. The
  objection stands: *if the schemas are not flexible, what is the gain?*
- **Declare-and-compile.** A format declaration generates real DDL — real columns, real types, real
  CHECK constraints, a real migration. Correctness survives, because the objection was never
  flexibility but **untyped storage**. What it costs was read as **per-document migrations** —
  `schema_version` is one integer today — until [D-214](./09-decision-log.md) found the wrong shape
  of problem in it: a document that **describes itself** needs a reconciler rather than a chain, and
  what has to be version-compatible is the declaration language rather than the set of tables. Being
  self-describing is the gain, not the cost.

**These are not a spectrum; the second contains the first.** The practical question is whether
map-only ships first as a step, or whether shipping it first builds a layer that declare-and-compile
then replaces.

**Deferred, then answered by a use case the same day (2026-09-07).** Asked directly, the question first
had no answer. **Step 1 of D-209 remains neutral to this fork** — unfreezing the
four column vocabularies works identically under either branch, and it is also D-208's fix — so
nothing is blocked on the answer. But the answer arrived anyway, from an apparently
unrelated question.

**The case that settles it: a dataset that is not money.** A log of the beauty products a person
tries — product, brand, date, price, rating, would-repurchase — and **link the price to the
transaction that paid for it**. Walk it through the layers:

- It is a **format**: columns, declared by the user, no code.
- It has **no identities**, and H3's *prompted* answer is what lets it exist — the editor makes the person
  say *nothing here has to add up* out loud and then allows it. **A mandatory answer to H3 would have
  made this use case illegal**, which is the retrospective argument that *prompted* was right.
- Its value is entirely in **one link**: not *"I spent ₪89"* but *"that ₪89 on the card statement on
  the 14th is this product"* — which answers *how much did I spend on skincare, and how much of it on
  things I rated below 3 and never bought again*. **A notes-and-database workspace cannot, because it does not
  have the card statement; a spreadsheet cannot, because the statement would have to be retyped.** The transaction is
  already in the document and imported itself.
- It uses **none of the reading half** — no document, no parsing, no proof. Roughly a third of the
  machine. That is fine, and worth knowing: a format is not obliged to be a document type.

**So: declare-and-compile.** Under map-only there is no product-trial table for the format to land on
and the case is simply impossible. **A requirement picked the branch, which is why this was the right
question to leave open rather than reason about in the abstract.**

**And it is the engine's own stress test.** If the thing cannot hold a dataset that is not money, it
is not an engine — it is a finance app with a plugin folder. Worth re-running that test against any
future design that claims to be the engine.

**Still genuinely open under this branch:** whether map-only ships first as a step. **Per-document
migrations are no longer the answer to the second half** — see [D-214](./09-decision-log.md) and the
reconciler. **Map-only is answered by the same stroke**: a reconciler makes declaring a table cost
about what mapping onto one costs, so shipping map-only first would build a layer the next unit
replaces.

**Confirmed against real data 2026-09-15** ([D-210](./09-decision-log.md)): a vault of recipe and
ingredient notes decomposes entirely into flat typed formats, within-row identities and relational
aggregates. **Nothing in it needs a loop, a traversal or temporal state**, so the branch holds — but
the aggregates are not optional and they need a unit system ([H7](#h7-is-the-unit-system-the-engines-or-a-packs)).

### H3. May a format carry no identities at all?

The identities — `units × price = value`, `Σ rows = printed total` — are the only thing this app has
that a spreadsheet, a notes-and-database workspace, a notes app and a spreadsheet-database do not. A user-authored format with no identities gets
ingestion, mapping and correction, and **no proof**.

- **Mandatory** protects the moat and makes a format harder to write, which is friction exactly where
  the idea needs there to be none.
- **Optional** makes formats easy and lets the differentiator quietly become a feature most
  user-made formats do not have.
- **Prompted** — declaring a format refuses to finish quietly, states what cannot be checked and makes
  the user say so on purpose. This is the `unchecked` verdict (D-149) applied one level up, and it is
  the shape most consistent with the rest of the app.

**ANSWERED 2026-09-07 — prompted. BUILT 2026-09-17 in M19 U3** ([D-222](./09-decision-log.md)).
The editor refuses to finish quietly; a format with nothing that must hold is allowed, but only said
out loud. This is the third time this app has chosen a third
state over a boolean (D-149's `unchecked`, D-203's zero factor, now this), which is worth reading as
a house style rather than three coincidences.

What building it added: **the refusal lives in `declarationProblems` rather than in the surface**, so
`declare_format` cannot dodge the question either — and a conversation is where it is most worth
asking, because the columns have just been worked out with somebody. `nothing_must_hold` is a key,
and `checks: none` in a file (`claims: none` since D-417, which calls
an identity a *claim* wherever a person or a model meets it). **Amended for the screen on 2026-10-04** (D-345):
the editor's *Nothing does* button was a dead end — *"just let the user continue"* — so there,
Create or Save on a format with no identity is the saying. **And everywhere on 2026-10-06**
(D-411): a stranger's list of books spent a refusal learning the word,
so nothing adding up is the default — the question is still asked in the conversation, and no flag
answers it.

### H4. Is the splitter core, or part of a planning pack?

D-209 records it: **the splitter is not a format** — it is an
allocation with modes and its own semantics, and nothing about it is a document reading. What is
*not* settled is which side of the core/pack line it sits on, and the same question covers the
trace view, the cushion, the projections and Net worth. **They are the screens a domain pack
would ship**, which argues pack; they are also most of what the app *is* today, which argues
core. See H1 — the two questions have one answer.

### H5. What happens to the data when a pack is removed?

Unasked so far and it cannot stay unasked, because the answer constrains the schema. A pack
owns tables. Uninstalling it can orphan them, delete them, or refuse while rows exist. **The
document is the user's** (D-115), which argues that nothing is ever deleted and an unknown table is
carried untouched — but then a document accumulates tables no installed code understands, and the
schema gate has to tolerate that rather than refuse the file.

**How a pack arrives is the same question (2026-09-07).** Could packs
work like **a notes app's community plugins**? The *shape* transfers — a manifest, a bundled
module, a minimum schema version, enable and disable per install. **The distribution does not**, on
three separate grounds:

- **D-124.** The community browser and auto-update are outbound calls that fetch **executable code**,
  in the renderer, from a host nobody allowlisted. That is the opposite of the one socket that was
  allowed (one host, off by default, on a press somebody made).
- **The disanalogy that matters.** A notes-app plugin uninstalls and the notes are unchanged, because
  markdown does not care. **An Emerald pack has run migrations against the user's money file**,
  so uninstall is not symmetric — which is precisely this question, and a plugin ecosystem turns it
  from theoretical into urgent, because strangers' code would be doing the migrating.
- **The security asymmetry.** A notes app's users accept *"plugins can do anything"* for notes. This file
  holds salary, pension, bank and broker figures, and the product's strongest claim is that none of
  it leaves the machine. **A runtime plugin system is the cheapest way to destroy that guarantee, and
  it would be the project's promise broken by someone else's code.**

**Three tiers, and the first is the recommendation.** (1) **Bundled, enabled at first run** — every
pack ships in the binary, the first run picks which to turn on, and turning one on runs its
migrations. No dynamic code loading, no network, the CSP untouched, exhaustiveness intact.
(2) **Sideloaded folders** — the notes app's model minus the registry; D-124 survives, discoverability does not.
(3) **A community registry** — needs network, updates and trust, and reverses D-124.

**Do not read H6 as requiring a plugin system.** *The engine, packs chosen at first run* demands
**enablement**, not installation, and tier 1 satisfies it completely. The answer already given
commits to nothing here.

### H6. Is Emerald the engine or the finance product?

A naming and positioning question with a real build consequence: **what does a fresh install
contain?** If Emerald is the engine, the first run asks which packs you want and the empty state is a
genuine blank. If Emerald is the Israeli finance product with an engine underneath, the packs are
pre-installed and the engine is an implementation detail most users never meet. The onboarding
wizard, the getting-started checklist and every empty state depend on the answer.

**ANSWERED 2026-09-07 — the engine, packs chosen at first run**, and **completed 2026-09-15**
([D-211](./09-decision-log.md)): packs are **enabled**, never installed, and the finance pack arrives
already ticked. **F12's onboarding wizard still gains a step before all its others** — which packs —
but it is pre-answered rather than empty. Every empty state in the app now has a second reason to be
empty — *nothing imported yet* and *no pack enabled* — and they do not read the same. See
[H1](#h1-is-the-ledger-core-or-a-pack): a genuine blank is possible, and shipping it as the *default*
would have been the weaker product.

### H7. Is the unit system the engine's, or a pack's?

Opened by [D-210](./09-decision-log.md). One recipe line uses five unit kinds at once — `150g`,
`200ml`, `2tbsps`, `1 clove`, `1 can` — and resolving them needs `density_g_per_ml`,
`unit_weight_g`, spoon-to-millilitre constants and `cooked_yield_factor`. The vault already declared
all four by hand in its ingredient notes.

**Grams and millilitres feel universal; cooking retention factors clearly are not.** Between those
two ends sits everything that matters: piece weights, densities, volumetric spoons, yield on
cooking. Put too much in the engine and every pack inherits a food-shaped unit model it does not
want; put too little and every pack rebuilds conversion, badly, which is the `cost`-role bug one
level up.

**ANSWERED 2026-09-17 by building it** ([D-223](./09-decision-log.md), schema 34). The reading
above held, with one sharpening that only came out of building it — *a factor between any two* is
the half that is **not** the engine's:

> **The engine owns dimension and conversion. A factor that crosses a dimension is a column
> somebody declared.**

Inside a dimension it converts and says nothing; across one it stops and names the missing fact —
*a density is about the thing being measured rather than about the units, so it belongs in a column
of this format*. Six dimensions, seeded as **physics rather than food** so the model is not shaped
by one pack, and the units are **rows in the document** for D-212's reason plus one the roles never
had: a tablespoon is 15 ml here and 20 ml in Australia, so what a build assumed is a row a person
can correct rather than a constant they cannot see.

Conversion is **written, never inferred** — `pack in g = serving * servings` — because the flagship
identity of this milestone adds grams and compares them to an energy and is correct, Atwater's 4
being `kcal/g`. An engine checking dimensions on every sum would report it as a problem.

**The bridge itself arrived one unit later** ([D-225](./09-decision-log.md), schema 36, U4c), and it
did not move this line. An identity writes `amount in g via ingredient.density`, the ratio is a
column declared as **one unit per another**, and the engine does arithmetic on a fact it was handed
and refuses every crossing it was not. The refusal above is what a bare `ml in g` still gets. **A
build that ever puts a density in `unit.ts` has made the mistake this hypothesis was opened to
prevent**, whatever the bridge makes possible.

### H8. When a figure changes, what happens to the prose about it?

Opened by [D-210](./09-decision-log.md), and the app has never faced it. Every sentence the finance
screens print is generated per render from live figures, so it cannot go stale. **In the vault the
valuable text is written once and kept** — *"protein is solved and sodium is the problem"*, *"one
tablespoon less soy sauce fixes most of it"* — and it rests on figures that can move underneath it.

The numbers can recompute. **The reasoning cannot**, and the reasoning is the part worth having.

- **Do nothing** — prose is prose, and the reader takes the risk. Cheapest, and it is the status quo
  that is currently producing silently-wrong conclusions in the recipes vault.
- **A note declares what it depends on**, and is marked when a dependency moves. Not regenerated, not
  deleted — **flagged**, which is `unchecked` applied to English. Consistent with the house style and
  with D-205's rule that a reading is corrected rather than overwritten.
- **Regenerate the note** — attractive and wrong: it discards the person's own judgement along with
  the model's, and there is no way to tell which sentences were which.

**The middle option is the one to design**, and it is the only genuinely novel thing in the whole
engine idea — it exists because this is the rare app holding both the arithmetic and the argument
about it in one file.

### H9. Does editing a format migrate, and what becomes of a dropped column?

Opened by [D-210](./09-decision-log.md). **This will be hit far more often than H5**, because editing
a format is ordinary work and removing a pack is rare.

**ANSWERED 2026-09-15 by building it** ([D-216](./09-decision-log.md)). There is no migration chain
to accumulate: the declarations are the source of truth and a reconciler makes the tables match them
on open. **The reconciler refuses four things** — dropping a column that holds data, changing a
type, changing a **unit**, and re-constraining a column that holds data — plus a fifth SQLite
refuses for it, a required column added to a table with rows. **Each of the four is an ordinary step
when the column holds no data**, which is the half that keeps redrafting a format ordinary. Nothing
is written and a person answers. What the paragraphs below say is still why.

Adding a column is easy — nullable, backfilled or defaulted. **Removing one that holds real data is
H5 at a smaller scale and with no ceremony around it**: the user is mid-thought, not making an
architectural decision. Changing a column's *type* or *unit* is worse again, because the stored
figures may or may not still mean what they meant.

Three things this touches at once: the migration chain (a document accumulating user-authored
migrations), the identities (an identity naming a column that no longer exists), and the derived
values that referenced it. **An answer that only covers the schema and not the identities is not an
answer.**

### H10. How is a link made when the two sides come from different domains?

Opened by [D-211](./09-decision-log.md), and it is the hardest thing in the chain as
described — *receipt tracking, and then financial tracking; everything connects.*

The engine has **the join**: an aggregate across a link, with unit conversion, which is what D-210
moved the line to permit. It has **nothing about how the link gets made.** In finance the problem was
solved and nobody noticed it was a problem: a transaction reaches a category through the rulepack and
the user's own rules, deterministically, at import (D-122), and a merchant string is matched against
patterns a human wrote. **Turning `עגבניות 4.90` on a supermarket receipt into a link to an ingredient
row is not that problem.** A receipt line is a Hebrew abbreviation of a product name, chosen by a
retailer, with no identifier; the ingredient row is a name the user chose. Nothing connects them but
resemblance.

Three shapes to weigh, and none is free:

- **The user links, once, and a rule remembers** — the rulepack pattern lifted one level up, which is
  the house answer and the one that fits [D-211](./09-decision-log.md)'s tie-breaker. Cheap, honest,
  and it needs a surface where linking is one gesture rather than a form.
- **A model proposes the link and a confirm surface checks it** — already the shape of every reader
  (D-205, D-206), and it inherits their whole discipline: the model answers with a **position**, never
  a value (D-137, D-132), and every proposal is editable before it is written.
- **A declared key** — the format names a column that is the identity, and matching is equality.
  Works for an ISIN or a deduction type; useless for groceries.

**What must not happen** is a fourth shape arriving by accident: fuzzy matching buried in the engine
with no confirm surface, which is D-138's law (*a verifier proves what it checks and nothing else*)
waiting to be broken in a new place. **Whatever the answer, a cross-domain link is a proposal until a
person accepts it.**

**Answered for the declared key by M24 U9** (D-261): a column of a
file fills a link when the target's naming column is `unique`, matched exactly, and a cell naming
nothing refuses its line. That is the third shape above and only that; a receipt line that
*resembles* an ingredient is still the first two, still open, and owed by no milestone yet.

**Still open after U5, and that was the right outcome** ([D-226](./09-decision-log.md)). Intake was
the unit this question waited on, and what it did was **refuse** rather than answer: a column of a
file may not fill a `link` at all, by name, with the reason in the refusal — because the fourth shape
above is exactly what a reader guessing four hundred links would be. What U5 has to offer the
question is two findings.

- **A link fixed for the whole file covers more of the real cases than expected.** A person picks the
  recipe once and every line points at it. That is the first shape — *the user links, once* — with
  the cardinality that makes it cheap, and it is enough for a parent whose aggregate then proves the
  rows that arrived. What it does not touch is the supermarket receipt, where each line names
  something different.
- **The third shape now has a second job waiting for it.** A **declared key** — the format naming the
  column that identifies a row — would answer *what makes two rows the same row*, which U5 needed for
  idempotency and did not have: it settled for the same *file*, by hash, because inventing a row
  identity is the density mistake one level up. One primitive, two questions, and it is a declaration
  language change — which is an argument for deciding it deliberately rather than letting an importer
  smuggle it in.

### H11. What does the authoring session actually look like?

Opened by [D-211](./09-decision-log.md). The four layers are an **architecture**; nobody has written
down the **session**, and for a product whose thesis is the bridge between a person, a model and their
own data, the bridge itself being unspecified is the largest hole in this note.

**Promoted by [D-215](./09-decision-log.md), and D-214 was too glib about it.** Filed there as
*answered by building U2*, which mistook it for a question about UI. Under the dial above it is **the
first arrow at the zero-structure end**: for a card statement arrow 1 is how the data gets in, and
for an intent there is no data yet, so the analogue is **eliciting the format**. It is therefore a
clause of U1 rather than a question to defer — a declaration nobody can produce is a table nobody can
have. By the privacy cut this half carries no personal figures, so it may use the best model
available with nothing at stake, which makes it the cheapest thing here to get right.

The loop, as far as it is known: **conversation → declaration → review in the app → compile → fill.**
Every arrow is a question.

- **Where does the conversation happen?** The privacy cut says schema design can happen anywhere, so
  the natural answer is *wherever the user already talks to a model* — which makes the deliverable a
  **declaration the app can import**, not a screen. **This is the bullet the answer overturned**: the
  deliverable is an import, and an import is not a way in on its own.
- **What is the artefact between them?** A format declaration has to be something a model can emit and
  a person can read and diff. It is the `.emd`'s own contents in the end, but in transit it is a file,
  and no note says what shape it has.
- **What does review look like before it compiles?** [H3](#h3-may-a-format-carry-no-identities-at-all)
  already says declaring one refuses to finish quietly, so the review step exists. What it *shows* is
  open: columns and types, certainly; the identities it will check; and — the part with no precedent —
  what this declaration will do to a document that already has rows
  ([H9](#h9-does-editing-a-format-migrate-and-what-becomes-of-a-dropped-column)).
- **Can the loop be re-entered?** Editing a format is ordinary work, so the answer has to be yes, which
  is H9 again and is why these two will be hit together.

**ANSWERED 2026-09-16 — the editor** ([D-219](./09-decision-log.md)). The paragraph that used to
stand here said *if this loop is good, the product works with no format-editing UI at all, because
the plugin generates the tools and Claude is the editor; if it is bad, a beautiful format editor
does not save it.* It was a good argument and it was wrong: driven once, the loop's paste box was
rejected in about ten seconds. A format is authored as **fields**, and the markdown
is an import and an export.

**The conversation did not stop mattering; it stopped being the only way in.** U2b built the
other one ([D-220](./09-decision-log.md)): `declare_format` puts a format into the document from
the conversation the columns were worked out in. The two surfaces divide on what can be lost —
**creating is the conversation’s, changing is the editor’s**, because the plan for a change is
drawn against rows that already exist and reading it is the whole job. U2c is the arrow still
open: a model inferring a declaration from an example.

**What this cost, and it is the note's real lesson:** nine decision entries framed the engine
before a line of it ran, and every part of that framing that was rejected was a part nothing had
been built against.

## Related

[09 Decision Log](./09-decision-log.md) — D-208 to D-210 · [08 Suggestions and Open Questions](./packs/ledger/08-suggestions-and-open-questions.md) · [F17 Mapping Templates](./mapping-templates.md) · [conventions](./conventions.md)
