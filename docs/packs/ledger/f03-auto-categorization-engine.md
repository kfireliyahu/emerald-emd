---
type: feature
project: Emerald
milestone: M2
status: in progress
---

# F03 — Auto Categorization Engine

Assign the user's category to each transaction automatically, transparently, and
overridably. This is the feature that decides whether the app saves time or wastes it.

**Built so far:** the `category_rule` table (migration `008`), its repository, and the engine
itself — `src/domain/categorization.ts`, a pure function with no database, no clock and no hidden
state (D-037). It is wired into the import path: staging writes `suggestedCategoryId` and the
`suggestedRuleId` beside it (migration `009`), the review screen shows the suggestion in the same
picker a manual choice goes into and marks it `rule`, and the commit turns an unoverruled
suggestion into a `RULE` assignment naming the rule, counting the hit (D-038).

The **rules screen** is built too, at `#/categories/rules` beside the categories it fills (it was
the third section of the settings shell until M36 U10): the list in evaluation order, create and edit over all six kinds, enable/disable, delete,
drag-and-keyboard reorder writing back re-normalized priorities, and the test box (D-040). That
closes the hole the engine shipped with — until it existed a rule could only be created in code,
so the engine ran over an empty rule set on every real import.

**Learning from corrections** is built too (D-042): correcting a category records the override
(migration `010`) and offers the rule, so the rule set grows for someone who never opens the
screen above. That is this note's fifth design commitment, and the reason the built-in set can
wait — a rule the user's own history taught the app beats one the app guessed at.

**Re-apply is built too** (D-045): the rules run over transactions already in the ledger, scoped,
previewed, and — uniquely in this app — undoable.

**The built-in set is built too** (D-046): rule packs shipped with the app rather than seeded into
the document, merged into the rule set by `loadRules`, with the Israeli pack covering the merchants
below.

**Bulk categorize is built too** (D-047), at `#/categorize`: the uncategorized backlog as one row
per merchant, assigned in one pick, offering the rule afterwards. With it, the ledger gained the
column sorting and shift-click multi-select docs/06 has specified since M1.

**Everything in F03 is built** except two affordances that are recorded as deferred at the end of
this note.

## Design commitments

1. **Deterministic.** Same inputs, same output, every time. No hidden state.
2. **Explainable.** Every assignment names the rule that made it, visible in one tap.
3. **Overridable forever.** A manual assignment is never revisited by any automation.
4. **Testable in isolation.** Rules evaluate against a merchant string, provider category,
   amount, and account — no database needed.
5. **Learnable.** Correcting a category offers to create a rule. This is how the rule set
   grows without the user ever visiting a rules screen.

## Rule kinds

| Kind | Matches on | Typical use |
|---|---|---|
| `EXACT_MERCHANT` | normalized merchant equals pattern | "SHUFERSAL DEAL 344" → Groceries |
| `CONTAINS` | normalized merchant contains pattern | "פז" → Fuel |
| `REGEX` | user-supplied regex against normalized merchant | power users, families of merchants |
| `PROVIDER_CATEGORY` | the provider's own category string | broad fallback coverage |
| `AMOUNT_RANGE` | amount within bounds | usually a *condition*, not a rule on its own |
| `ACCOUNT` | source account | "everything on the business card → Business" |

Any rule may additionally carry account scope and amount bounds as conditions, ANDed with
whatever its kind tests. A seventh kind, `COMPOSITE`, was specified and **not built**: it is what
every kind already is once it carries a condition, and offering both would put two spellings of
one rule in front of the user (D-037).

The two condition-only kinds are refused if they state no condition. An `AMOUNT_RANGE` with no
bounds or an `ACCOUNT` rule with no account would match every transaction in the ledger, which is
never what someone meant to write.

Bounds are **magnitudes**: charges are negative by the importer's convention (D-004), so
"between 100 and 500" has to mean the size of the charge or it matches nothing at all.

## Resolution order

Evaluated top to bottom; **first match wins**, and evaluation stops.

1. **Manual assignment already present** → stop. Nothing below runs. This one is the caller's
   job, not the engine's: a manually categorized transaction never reaches it (D-009).
2. **User rules**, sorted by: `priority` ascending → specificity (`EXACT` > `REGEX` >
   `CONTAINS` > `PROVIDER_CATEGORY` > `AMOUNT_RANGE` > `ACCOUNT`) → creation date ascending →
   id, which is never expected to be reached and is there so "deterministic" means it.
3. **Learned rules** (`origin = LEARNED_FROM_CORRECTION`), same internal ordering.
4. **AI-suggested rules**, which are inert until confirmed; confirming one makes it a user rule.
5. **Built-in rules** shipped with the app — **built** (D-046), and the only tier that is not
   rows in the document.
6. **`Uncategorized`.**

The **provider-category mapping** was a tier of its own here and is not one: it is built-in rules
of kind `PROVIDER_CATEGORY`, and the specificity ordering inside the built-in tier already puts
them below every merchant rule. Same resolution, one concept fewer (D-037).

Rationale for first-match-wins over scoring: a scoring system is impossible for a user to
predict or debug. Predictability beats cleverness here.

`firstMatch` stops at the winner and is what an import calls; `explain` keeps going and reports
what the winner shadowed, and is what the test box and the provenance view call. They share one
comparator and one predicate, which is what makes "the test box always agrees with an import"
true by construction rather than by discipline.

## Built-in rules

**Built** (D-046). A small, high-precision set covering things that are unambiguous in the Israeli
market: fuel chains, supermarket chains, municipal payments, telecom providers, insurance
companies, transit, parking, card fees and interest. Every built-in rule is:

- **Visible** in the rules list, in the `BUILT_IN` tier at the bottom, marked as built-in.
- **Editable** — editing forks it into a user rule, which is a normal `USER` row plus the original
  switched off.
- **Disableable** individually.
- **Never silently updated** in a way that recategorizes history; app updates that change
  built-ins only affect new imports unless the user runs a re-apply. This one is structural rather
  than enforced: the engine runs at import and at re-apply and nowhere else.

### They are not rows in the document

A built-in is data shipped with the build — one JSON **rule pack** per market under
`src/data/reference/rulepacks/`, imported at build time, never fetched. Seeding them as
`category_rule` rows would mean a migration per release to reach documents that already exist, and
migrations are immutable after release (D-020). What the document holds instead is only the user's
opinions about them, in one `app_setting` key: **which are switched off**, and — as ordinary rules
— **which were forked**. This unit needed no migration.

`loadRules(db)` is the one answer to "what is the rule set": the document's rules plus the shipped
built-ins. The import path, re-apply, the test box, the rules screen and the provenance panel all
read it, because the acceptance criterion below is that they agree.

Three consequences of not being a row, each visible on the rules screen:

- **No hit count.** Hits are per-document and live on the row. A built-in shows nothing there
  rather than a zero that would read as "never fired", and the 90-day `neverFires` flag — which
  reads `hitCount` *and* `createdAt` — never applies to one.
- **No reorder and no delete.** There is no priority to write and nothing to delete; switching one
  off is the operation, and it is a line in a setting.
- **A category this document does not have makes it inert**, computed on every load rather than
  stored. `disableOrphanedRules` cannot help — it disables a row. The rule is listed as "no such
  category here", and editing it is the repair. **Since M25 U2** (D-268) built-ins are rows: one
  whose category a document lacks is not seeded, and deleting a category removes the built-ins
  that assign it.

### The pack format

One file per pack plus a line in the manifest; adding a market is adding a file. A pack states an
id, a human name, a market and a version, then its rules — id, kind, pattern, category, and
optionally a name and a priority. Rule ids are **namespaced and stable across releases**
(`il.fuel.paz-yellow`), because the user's "I switched this one off" points at them.

Two kinds are refused: `AMOUNT_RANGE` and `ACCOUNT` are the condition-only kinds, and a pack knows
about merchants, not about *this* document's accounts or this user's spending. Everything else goes
through `validateRule` — the same and only opinion about what a rule is that the editor asks — and
a shipped pack that fails it fails a test rather than an import.

Priorities are **flat**, and that is load-bearing: the comparator reads priority before kind
specificity (D-037), so numbering the rules would take specificity out of the ordering and
`PROVIDER_CATEGORY` would stop sorting below every merchant rule. A pack states a priority only
where two rules of the same kind overlap — `רמי לוי תקשורת` is a phone bill and `רמי לוי` is a
supermarket.

**Precision beats coverage.** A wrong built-in is worse than a missing one, because the user has to
notice it before they can fix it.

## Learning from corrections

**Built** (D-042). When the user changes a category on a transaction from the ledger:

1. The override is recorded — previous category, previous source, new category — in the
   `category_override` table of migration `010`, per [04 Data Model](./04-data-model.md).
2. A bar appears **above the ledger**, under the filters, non-modally: *"Always categorize
   <merchant> as <category>?"* with **No rule** / **Make the rule** (D-373). It says what it
   would write, in the same words the rules list uses. Above the rows rather than below them
   because the correction that prompts it happens near the top of a tall table, and a question at
   the far bottom of the window is one nobody answers (D-043). The row menu's and the detail
   panel's *rule for this merchant* open the same bar; its category is a picker.
3. "Make the rule" creates a `LEARNED_FROM_CORRECTION` rule at the end of its own tier — below
   everything the user wrote by hand. **It matches by `CONTAINS`, and what it contains is a
   field** pre-filled with the normalized merchant, shortened to the part that stays the same
   (D-373 — exact missed every name that changes past a trailing branch number). The sentence
   underneath changes as it is typed, and the button is refused while the draft has a problem.
4. **The rows already here are filed too, by default**: *Also file the N rows already here*,
   ticked whenever N > 0, is a re-apply scoped to the new rule (D-045), counted from the same
   plan, never over a row chosen by hand, and undone by *Undo those*.

If the same merchant has been corrected to the same category three times, the bar says so
before it asks. The count is of distinct transactions, so one row changed repeatedly is one
correction; it is not scoped to an account, because a merchant rule is not either.

The offer is not made at all in three cases, each a question that would be silly to ask: the
category was **cleared** ("always categorize this as nothing"), the rule would be **unsaveable**
(an empty normalized merchant — `validateRule` is asked rather than a second opinion invented),
or **a rule already assigns this category to this row**. That last one is `firstMatch` over the
current rule set, not a search for a similar pattern: a correction that *overrules* a rule still
gets the offer, which is the case worth learning from most.

**Nothing here is automatic.** The correction is `MANUAL` and no automation will revisit it
(D-009); no rule exists until a button is pressed; and ignoring the bar costs nothing.

## Re-apply

**Built** (D-045), on the rules screen behind "Apply to existing…" — the screen where editing a
rule raises the question. An explicit operation, never automatic:

- Scope: all / one account / one month / uncategorized only, expressed with the **same filter
  the ledger uses**, so "which rows do you mean" has one vocabulary in the app.
- **Never touches** `categorySource = MANUAL`. Excluded in the SQL that gathers candidates
  rather than filtered out later, so a manual row is never in the list at all.
- **Never clears a category.** A row whose rule was deleted, and which nothing matches now,
  keeps what it was given. Re-apply assigns; it does not retract — deleting a rule does not
  un-happen what it categorized (D-041), and nothing in this app is auto-deleted.
- The preview is **not a separate step**: "4 transactions, 3 would change" with a sample diff,
  updating as the scope changes. The number is produced by the same `planReapply` call that
  produces the rows that land, so it is a promise rather than an estimate.
- Committed in one database transaction with a single undo entry, and hits counted per changed
  row — the same definition an import uses.

### Undo

Re-apply is **the only thing in the app that can be undone**, and that is the honest size of it.
There is no command stack and no journal of every mutation: `reapply_run` and `reapply_change`
(migration `011`) record the rows one bulk operation changed and what they held before, which is
enough to answer the one sentence a user needs after running rules over four years of history.
Everything else in the app changes one row that is on screen at the time.

Three properties worth stating, because each is a decision:

- **Only the newest run can be undone**, and only until it is. Undoing an older run would
  restore rows a later run has already moved past.
- **A row the user has categorized by hand since is left alone**, so the count that comes back
  can be smaller than the run's. D-009 outranks this undo exactly as it outranks the re-apply.
- **The hits are given back.** A run that moved three hundred rows and was undone must not leave
  three hundred hits behind, or the "never fired" view lies about the busiest rules first.
  `lastMatchedAt` is *not* rolled back: the rule did match, and the user changed their mind
  about the result.

## Bulk categorize

**Built** (D-047), at `#/categorize`. The backlog of uncategorized rows, as **one row per
merchant** rather than one row per charge: `שופרסל · 30 waiting · ₪4,210 · [category]`, and one
pick assigns all thirty. Forty rows of one shop is forty repetitions of one thought, and a backlog
you work through row by row is a backlog you abandon.

- **It can only fill in a blank.** The scope is fixed to rows with no category — not offered as a
  control. This is the tool in the app most able to break D-009: one click over thirty rows, with
  no undo. Changing rows that already have a category is what the ledger's multi-select is for
  (the user picked those out and can see them) and what a rule plus re-apply is for (previewed,
  and takeable back).
- **Grouped by `merchantNormalized`**, which is the string a rule matches — so a group and the rule
  offered about it are claims about the same set of rows by construction. The name shown is the
  spelling most of the group's rows use.
- **The hint is the user's own history.** "14 of 20 already Groceries", from the merchant's
  *already categorized* rows, as a button that assigns the group. No threshold: the count is on
  screen and the user reads it. Deliberately not `firstMatch` — a row the rules could place would
  not be in the backlog, and re-apply owns running rules over history.
- **Assigning offers the rule**, through the same `offerForCorrection` and the same bar the ledger
  uses. Every row is `MANUAL` and gets its own `category_override`; a batch is many events, not one,
  which is why the offer can honestly say "30 times now".
- Scoped by account and month, sorted by most transactions / largest amount / name. A group links
  to the ledger filtered to it, for "what actually *are* these".

## The ledger's own bulk actions

**Built** with the screen above (D-047), and specified in docs/06 since M1:

- **Column sorting**, in SQL. The list is capped at 500, so sorting what came back would order the
  page — "the largest charge" would mean "the largest of the 500 most recent". Each column's first
  click goes in the direction that answers it: dates newest first, names A–Z, and amount
  *ascending*, because charges are negative (D-004) so the largest spend is the smallest number.
- **Shift-click multi-select**, extending over the rows as currently sorted. "Select all" means the
  whole filter rather than the loaded page, and says how many that is.
- A bulk assign from the selection, through the same writer bulk categorize uses. It offers a rule
  only when the selection turned out to be one merchant — forty rows of forty shops is not a
  question a rule can answer.

## Rule authoring UX

Rules are usually created from context, not from the rules screen:

- From a transaction: "Create rule from this merchant" pre-fills everything. **Built** (D-041) —
  the detail panel hands the rules screen a draft through router state and goes there, rather
  than growing a second editor in a 23rem side panel. `CONTAINS` over the **normalized**
  merchant, so the rule matches the row it was made from; the row's own category comes with it.
- From a transaction, the other fact it carries: "Create a rule from the provider's category"
  pre-fills a `PROVIDER_CATEGORY` rule with the issuer's own heading. **Built** (D-080), beside the
  merchant button and only on a row that has one. The pattern is the string **as printed** rather
  than the normalized merchant, because the engine compares provider categories through `foldText` (`core/text.ts`)
  — `normalizeMerchant` strips a trailing run of digits as a branch number, which is right for a
  shop and wrong for a heading that ends in one.
- From a corrected transaction: change a category → offer the rule. **Built** (D-042), and it is
  the path that grows the rule set without anyone deciding to write a rule. It writes a
  merchant `CONTAINS` rule and nothing else (D-373): a provider category covers rows the user has not looked at,
  which is a claim to make in front of the editor rather than on one click (D-080).
- From the import review screen: categorize a row → offer the rule. **Built** (D-192), with the
  scoped re-run D-047 said it was actually waiting for. Suggestions are computed once, at stage
  time, so accepting also runs the new rule over the import's **blank** rows — `NEW`, no chosen
  category, no suggestion — and writes what it finds as a *suggestion*, never a choice. The count
  is shown before either button is pressed and moves as the pattern is typed, which is exact
  because a blank row matched no rule and so has no priority order to lose to. Offered only when
  every row just categorized is one merchant.
- From bulk categorize: **built** (D-047). Assigning a merchant group offers the same rule the
  ledger's correction offers, through the same `offerForCorrection` and the same bar. It is the
  place where the offer is most obviously worth taking, because the user has just done by hand,
  thirty times, exactly what the rule would do.

The rules screen exists for management, and is **built**: the list in evaluation order with hit
counts, drag to reorder priority, enable/disable, delete, an editor covering all six kinds, and a
**test box** — paste a merchant name and an amount, see exactly which rule fires and why, plus
which rules also matched but lost. That test box is the debugging tool that makes the whole system
trustworthy, and it is trustworthy because it calls `explain` rather than reimplementing the
match; it also reports the normalized merchant, which is what an obvious-looking pattern usually
missed on, and how many *disabled* rules would have matched.

The list is sorted by `sortRules` rather than by anything the screen decides, so what is read top
to bottom is the order the engine reads. No priority number appears anywhere: the number is not
what the user is arranging (D-040).

A rule saves without a name — the pattern is what most rules would have been called, and the name
field shows that fallback as its placeholder rather than asking for it twice.

## Regex safety

- Compile on save; show the error inline rather than failing silently at import time.
  **Built** — `validateRule` returns the compiler's own message against the pattern field, and a
  pattern that somehow reached the database uncompilable matches nothing rather than throwing.
- Patterns are capped at 200 characters, and the subject is a normalized merchant name — tens of
  characters, not a document. Catastrophic backtracking needs a long input to bite.
- **No match timeout.** A timeout cannot be implemented without a worker (JavaScript cannot
  interrupt a running regex), and auto-disabling a rule because it was slow *this time* would
  make the engine non-deterministic — the same rules and the same row would stop giving the same
  answer, which is the first design commitment above. If a pathological pattern ever shows up in
  practice, the fix is to evaluate in a worker, not to add a stopwatch to a pure function.
- Offer a live preview: matching merchants from the user's own history, shown as the regex is
  typed. Not built.

## Conflict handling

Two rules matching the same transaction is normal, not an error. The engine reports the winner
and the losers in the transaction's provenance view, and the test box shows both for any row the
user types — **both built**, from `explain`'s `shadowed` list.

The provenance view holds two different facts apart on purpose (D-041). `matchedRuleId` is
**history**: the rule that actually assigned the category, at import time, and the panel names it
even after that rule is deleted. `explain` is **today**: what the current rule set makes of the
same row. They agree until a rule is edited, and when they stop agreeing the panel says so —
"your rules have changed since; today they would assign …, and this row keeps what it was given"
— rather than showing today's losers underneath yesterday's winner as one story.

The rules screen flags rules with zero hits over 90 days ("never fired") — **built**, as
`neverFires`, which is deliberately about age as well as hits: `hitCount` only moves when an
import or a re-apply runs, so a rule written this morning has none for reasons that say nothing
about it.

**The link to the rule that shadows it is deferred**, with re-apply. Which rule shadows another
is not a fact about two rules; it is a fact about two rules *and the transactions in the
document*, which is exactly the scan re-apply already has to do. Doing it here would mean a
second, weaker version of that scan — and until then the test box answers the same question
directly for any row the user can name.

## Data touched

Reads: `CategoryRule`, `Category`, `Transaction`.
Writes: `Transaction.categoryId`, `categorySource`, `matchedRuleId`; creates `CategoryRule`
on learning; writes override audit records.

## Edge cases

- Merchant name changes slightly between statements (branch number, spacing) → normalization
  handles most; `CONTAINS` rules handle the rest; fuzzy matching only ever *suggests*.
- A rule pointing at a deleted category → rule auto-disabled and surfaced for repair. **Built**:
  `disableOrphanedRules` runs in the same mutation as the category delete, so the document is
  never in the state where an import could assign an id that no longer resolves; the rules screen
  then shows the rule as off and flagged, and editing it is the repair (D-040). **Superseded by
  M25 U2** (D-268): a rule is a declared row whose target cannot point at nothing, so deleting a
  category is refused while a person's own rule assigns it, and `disableOrphanedRules` is gone.
- Provider category is empty (common) → those rules simply don't match.
- Refunds inherit the category of the matching original charge when one is confidently
  identifiable (same merchant, opposite amount, within 60 days) — as a **suggestion**, not an
  auto-assignment.
- Installment slices all get the category of the first slice via the installment group key.

## Acceptance criteria

- Rule evaluation is a pure function with full unit-test coverage of the ordering rules. **Met.**
- The test box's answer always matches what an actual import produces. **Met by construction**:
  the box calls `explain` and an import calls `firstMatch`, and those share one comparator and one
  predicate. `categorization.test.ts` locks the two against each other rather than trusting it.
- Re-apply never modifies a manually categorized transaction (property test).
- On a real 12-month history with a mature rule set, over 80% of transactions are categorized
  without manual input. **Not claimed met.** The built-in set is what this is measured against and
  it now exists (D-046) — an empty document imports `שופרסל דיל 344` and `פז ילו` categorized,
  with no rules of the user's own — but a fixture is not a history, and the number is a fact about
  a real year of statements. Measure it before ticking it.

## Open questions

- ~~Should learned rules use `EXACT_MERCHANT` or `CONTAINS` by default?~~ **Settled** by D-042:
  exact — and by D-043, over a pattern the user can shorten in the offer itself, which is the
  loosening this note asked for in a form that also answers "not that whole name, this part of
  it". It differs from the rule written by hand
  from a row, which is `CONTAINS` (D-041), and the difference is review rather than merchant
  drift — normalization already handles drift, and only one of the two paths shows the user an
  editor before saving.
- ~~Should rule priority be explicit numbers or purely drag-order?~~ **Settled** by D-037:
  integers in the schema, drag-order in the UI, re-normalized in steps of ten on reorder.
- AI-suggested rules enter as `AI_SUGGESTED`, below learned rules and above built-ins, and always
  require confirmation before becoming active. The source stays in the schema; what changed is who
  fills it — the plugin today (F14), never a remote API (D-124). **M11 wrote no rules at all**: its
  merchant suggestion assigns categories to one merchant's rows and leaves the existing rule offer
  to ask about a rule, because a similarity is not a rule (D-151).

## Related

[F02 Category System](./f02-category-system.md) · [F01 Card Statement Import](./f01-card-statement-import.md) · [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md)
