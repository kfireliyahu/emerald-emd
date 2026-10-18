---
type: survey
project: Emerald
updated: 2026-09-23
---

# The ledger onto formats — M24 U1's survey

**Every non-`fmt_` table at schema 37, what declared format would hold it, and what the engine
cannot yet express.** Written by M24 U1 (D-252); the gaps it found
are M24 U2–U12, rows of `unit` in `docs/memory.emd`. This is M25's sizing, and it is here rather
than in the roadmap because it is about the ledger.

The engine's line, which decides every row below: **stateless and relational is declarable;
temporal, iterative or semantic is code** (`src/domain/format/aggregate.ts`, D-209/D-210).

## The thirty-seven tables that are not the engine's

**Easy — holds today, or needs only a type (U6).** Each is a format with enums, money pairs and
links, and nothing a declaration cannot say.

| Table | As a format | Needs |
|---|---|---|
| `institution` | name, kind enum; `aliases` (a JSON list) becomes a child format `institution_alias` → institution | — |
| `account` | links `institution`; `last4` text | — |
| `category_group` (retired, D-348) · `holding_place` · `holding` | plain | U6 for `fee_bp`, `expected_return_bp`. **`holding_place` and `holding` moved in M25 U4** (D-278) |
| `fund_account` | links `institution` | U6 (`fee_*_bp`) |
| `fund_balance_snapshot` · `fund_deposit` | money pairs, link to fund account and snapshot | U6 (`salary_month`); **an identity for the first time** — the parts against the total. **Moved in M25 U6** (D-280): `parts` on the snapshot and on each deposit row, and the funds screen's check is its verdict |
| `paycheck` · `paycheck_line` | line → paycheck, line → `deduction_type` | U6 (`period`), **U8** — net = gross − the lines that reduce it is a *filtered* fold. **Moved in M25 U7** (D-281): `deducted` and `net = gross - deducted` on the paycheck, beside the entry screen's signed delta |
| `debt` · `debt_payment` · `saving_goal` · `saving_deposit` · `purchase_plan` · `fixed_expense` | plain, links | **U7** — `auto_track_kind`/`source_kind` with their `_ref` are the ledger's polymorphic references. **All but `fixed_expense` moved in M25 U5** (D-279): a debt's pattern and category are two columns; a payment found in a transaction links it, and a payslip's or a plan's keeps a key, as a deposit's does. **`fixed_expense` moved in M25 U7** (D-281): matched by a pattern, a category or a deduction type, three columns |
| `split_plan` · `split_bucket` · `allocation` | allocation → plan, → bucket | U6 (`basis_points`), U7 (`mode` decides which of two amounts is required; `target_kind` + `target_id` is polymorphic). **Moved in M25 U7** (D-281): a bucket's target is three links; a plan's basis is not required by its kind |
| `card_settlement_link` | a row between a transaction and an account | — |

**Hard — needs something the engine does not have.**

| Table | Why |
|---|---|
| `transaction` | `natural_key` is how re-import is refused as a duplicate: **U4**. The sign rule — outflow ≤ 0, inflow ≥ 0 — is a constraint across two columns: **U7**. `billing_period` is a month: **U6**. `exchange_rate` is a `REAL` and should not be: **U6**. `import_session_id` became a link to `statement` (M25 U3, D-275). `merchant_normalized` and `category_source` are written by code. It is the one table with 60k rows in a real document, so it is also M22 U6 #4's open question about text storage. |
| `security` · `security_price` · `security_trade` · `security_position` · `fx_rate` | `quantity_micro`, `price_micro`, `rate_micro` are **fixed-point integers**, and the engine's only non-integer is `REAL` — a unit price is not a money minor unit and a fund's unit count is not a `quantity`: **U6**. `security_position`'s key *is* its link to `holding` (1:1): **U4** on a link column. **Moved in M25 U4** (D-278): a trade outlives its position, so `security_trade.holding` is optional; the latest price is still the code's. |
| `category` | **The self-linked tree stores today** — a link may name its own format — and the two-level cap is a trigger (`005`), which becomes **U7**'s kind of constraint or code. *Rolling up* is the hard part: a parent's spend is a fold over its children's folds, per month, which is two hops **and** temporal. Code. `is_system`, `monthly_target` are ordinary columns; the seeded tree is **U12**. |
| `deduction_type` | Built-in rows (**U12**); `linked_saving_goal_id` / `linked_debt_id` / `linked_fund_account_id` are three links of which at most one is set (**U7**). |
| `category_rule` | A rule is **data** — kind, pattern, target → category, priority — and holds as a format with U7 and U12 (`BUILT_IN` rows). *Applying* the text kinds is the engine's since M25 E4 — the `categories` rule set (D-273); the other three kinds, and rules limited to an account or an amount band, are code. |

**The ledger's intake machinery — the engine already has its own.** These do not become formats;
they become the engine's intake tables or go.

| Table | Becomes |
|---|---|
| `import_mapping` | **Moved in M25 U3b to the pack's `import_mapping`** (D-277): a mapping says what `format_intake` has no column for — an amount convention, a date order per column, an account, usage |
| `import_session` | **Moved in M25 U3 to the pack's `statement`** (D-275), a header every line links to; the mappings moved in U3b (D-277). Before: `format_intake`, and **U10**: the statement's header — printed total, period — becomes a row the lines link to, so *reconciliation against a printed total is an aggregate and an identity, declared rather than coded* |
| `staged_row` | **Moved in M25 U3b to the pack's `staged_row`** (D-277) — the author kept a review that survives a close |
| `document_template` | **Moved in M25 U8 to the pack's `document_template`** (D-282); its version chain is a `state`, so one current template per signature is a filtered `one row per` |
| `reapply_run` · `reapply_change` · `category_override` | The undo history of code (re-categorising). They live wherever that code lives |
| `app_setting` | **Moved in M25 U8 to the pack's `setting`** (D-282): a pack's settings are a format it declares |

**Sized honestly:** twenty tables are easy once U6, U7 and U8 land; nine are hard, and all nine are
hard for a *type*, a *constraint* or *seeded rows*, not for a shape the engine refuses; eight are machinery the
engine already replaces. **The tables are not what makes M25 long. The logic is.**

## The logic that is not a table — M25's first question

Each is on the code side of the line. **None of it can become a declaration without moving the
line**, so M25 cannot finish unless a pack may carry code, or the author moves the line. **Answered
by D-265: a pack may carry code**, and its SQL names only the tables it declares. **D-267
moved part of the line**: a rollup by period, the latest by an order and a matching rule become
declarations (E1–E4, before U3) — the statistics, latest-price and categorisation rows below; the
tree rollup, detection, installments, splitting and projections stay code.

| Logic | Where today | Why it is code |
|---|---|---|
| Categorisation — rules, learning from corrections, provider-category mapping, merchant normalisation and groups, model suggestions | `categorization.ts`, `learning.ts`, `provider.ts`, `merchantGroups.ts`, `suggest.ts`, `reapply.ts` | Semantic. Matching a pattern against text is a declared rule set since M25 E4 (D-273); normalising a merchant, the ordering by kind, and learning stay here |
| Statistics, month and year summaries, the home page, category rollups | `statistics.ts`, `home.ts` | Temporal: grouped by a month, and the tree is two hops |
| Fixed-expense detection | `fixedExpenses.ts` | Temporal and iterative: recurrence over months |
| Statement reconciliation against a printed total | `bankImport.ts`, `review.ts` | **Declarable after U10** — a sum over the lines of one statement, and an identity. The running-balance check on a bank statement stays code: it is iterative |
| Duplicate refusal on re-import | `natural_key` | The key is derived by code; refusing the second is **U4** |
| Installments and card settlements | `installments.ts` | Temporal (slices over months), semantic (matching a bank line to a card) |
| Fund fees, net worth, latest prices | `funds.ts`, `netWorth.ts`, `investments.ts` | Fees are over time. "The latest price" and a fund's balance are declared picks since M25 E3 (`security.price`, `fund_account.balance`, D-272) |
| FX | `fx_rate` lookups | A rate chosen by date is a search, not a link |
| Paycheck splitting, projections, debt amortisation | `splitter.ts`, `projection.ts`, `debt.ts` | Iterative, and money × a percentage needs a rounding rule |

## Related

[the data model](./04-data-model.md) · D-252 · [parity](../../parity.md)
