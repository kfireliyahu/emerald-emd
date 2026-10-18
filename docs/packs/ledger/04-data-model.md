---
type: spec
project: Emerald
---

# 04 — Data Model

Every entity, its fields, and the invariants that must hold. Field types are described in
domain terms; the storage type is noted where it differs. All entities carry `id` (UUID,
generated in domain), `createdAt`, `updatedAt` (epoch millis UTC) unless stated otherwise;
those are omitted from the tables below to save room.

Money fields are always the `Money` type — minor units (agorot) as a signed integer plus a
currency code. Never a floating-point number. See [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md).

## Map of aggregates

```
Institution ──> Account ──< Transaction >── Category ──< CategoryRule
                  │           │  │             │
                  │           │  └── Installment (0..1)
                  │           │  └── ForeignAmount (0..1)
                  │           │
ImportMapping ──> ImportSession ──< StagedRow ──> Transaction (after commit)
DocumentTemplate (label-value documents: payslips, fund reports)

Paycheck ──< PaycheckLine ──> DeductionType ──> (SavingGoal | Debt | FundAccount)

SplitPlan ──< Allocation ──> SplitBucket ──> (Category | SavingGoal | Debt | free-form)

SavingGoal ──< SavingDeposit ──> Holding ──> HoldingPlace

Debt ──< DebtPayment ──> (Transaction | PaycheckLine | manual)

FixedExpense ──> Category (and optionally a merchant pattern)

FundAccount ──< FundBalanceSnapshot ──< FundDeposit

Security ──< SecurityPosition ──> Holding   (1:1 — the position *is* the holding, D-181)
   │     └──< SecurityPrice
   │     └──< SecurityTrade
   └──< PurchasePlan
FxRate (a rate belonging to a date — the only crossing between two currencies)
```

---

## Ledger

### Institution

Reference data for onboarding and display: card issuers, banks, investment platforms, fund
managers. Shipped with the app as editable data, user-extensible ([F12 Onboarding](./f12-onboarding.md)).

| Field | Type | Notes |
|---|---|---|
| `name` | text | Display name. |
| `kind` | enum | `CARD_ISSUER`, `BANK`, `INVESTMENT_PLATFORM`, `FUND_MANAGER`, `OTHER`. |
| `aliases` | list<text> | Hebrew and English, including former names (Leumi Card → Max). Used for statement detection and last-4 matching. |
| `color` / `logoRef` | text? | Both null in the shipped seed: the design language has no brand colour to put them in ([11 UI Design Language](../../11-ui-design-language.md)). |
| `isUserCreated` | bool | True for anything entered as "other". |

Never a constraint: any account can exist without an institution.

**Built** (migration `006_institutions_and_onboarding.sql`). Seed rows carry stable readable ids
(`inst:cal`), exactly as the categories in 002 do; a row the user adds through "other" gets a
generated id and `isUserCreated = 1`, and sorts after the seeds of its kind. `aliases` is a JSON
array, decoded defensively — a value the user has broken by hand leaves a usable institution with
no aliases rather than throwing. Search matches the name or any alias, case-insensitively, in
either script.

### Account

A source of money movement. One per credit card, one per bank account, plus a `CASH` account
for manual entries.

| Field | Type | Notes |
|---|---|---|
| `name` | text | User-facing, e.g. "Cal – Visa 1234". |
| `kind` | enum | `CREDIT_CARD`, `BANK`, `CASH`, `HOLDINGS` — an account with holdings (a broker, a savings account; M30 U1, D-354), a kind of its own since M36 U09 (D-386). |
| `institutionId` | Institution id? | Optional; display and matching only. Added by migration 006; every account created by an import before it has none. |
| `last4` | text? | Matches statement files to accounts, and matches bank settlement rows to cards ([F06 Bank Statement Import](./f06-bank-statement-import.md)). Collected during onboarding. |
| `bankBranch` / `bankAccountNo` | text? | For bank accounts. |
| `defaultBillingDay` | int? | Card charge day; helps derive billing periods. |
| `linkedBankAccountId` | Account id? | Which bank account this card is charged to. |
| `excludeSettlementsFromStats` | bool? | The remembered answer to "should I ignore this card's monthly charge in the bank statement?". **Null = not yet asked**, which is a third state and the reason the column is nullable: "keep them" must never prompt again and "not yet asked" must. Migration `015`, D-061. |
| `isArchived` | bool | Hidden from pickers, retained in history. |
| `in_cushion` | bool? | Whether a bank account's latest statement counts toward what is in the bank, split between the goals saved there and the cushion (M30 U7, D-360). Empty counts; only `0` leaves it out (M31 U5, D-371). The cushion's months are the ledger setting `cushion`, not a goal. |

**Invariants:** `last4` is unique per institution. A card may link to at most one bank account.

**Uniqueness is the repository's, not the file's** (D-034). The natural bucket for the `last4`
invariant is the institution, and most accounts have none — SQLite treats NULLs in a unique index
as distinct, so an index on `(institution_id, last4)` would be silent exactly where it is needed,
and one on `COALESCE(institution_id, '')` would refuse a real pair of unrelated cards that happen
to end in the same four digits. What holds instead is that both writers go through
`findAccountByLast4`, which matches **archived accounts too** — otherwise archiving a card and
re-importing it would fork one card into two, which is the split D-033 fixed arriving by another
door.

**Operations** (F12's accounts screen): rename, set or correct `last4`, set the institution,
archive and unarchive, remove, and **merge**. Remove is refused once the account holds
transactions and names archive and merge instead, as `deleteCategory` does. Merge repoints
transactions, import sessions and mapping bindings, soft-deletes the rows the target already holds
under the same natural key — the same charge, filed twice by a split card — and soft-deletes the
source. The survivor adopts a `last4` or institution it did not have, and nothing else.

### Transaction

The core row. One per charge, refund, transfer, or income event.

| Field | Type | Notes |
|---|---|---|
| `accountId` | Account id | Where it happened. |
| `transactionDate` | LocalDate | When the purchase happened. |
| `chargeDate` | LocalDate? | When the money actually left (card billing date, or bank value date). Null for cash. |
| `billingPeriod` | YearMonth? | Which statement this belonged to. Not derivable from dates. |
| `amount` | Money | **Signed.** Negative = money out, positive = money in. Refunds are positive. |
| `direction` | enum | `OUTFLOW`, `INFLOW`, `TRANSFER`. Redundant with sign, but explicit for queries and prevents sign bugs. |
| `merchantRaw` | text | Exactly as it appeared in the file. Never modified. |
| `merchantNormalized` | text | Cleaned: trimmed, RTL marks removed, collapsed whitespace, branch numbers stripped. Used for matching. |
| `providerCategory` | text? | The category the card/bank supplied, verbatim. An input to rules, never authoritative. |
| `categoryId` | Category id? | The user's category. Null = uncategorized. |
| `categorySource` | enum | `MANUAL`, `RULE`, `AI`, `INHERITED`, `NONE`. |
| `matchedRuleId` | CategoryRule id? | Which rule assigned it. Required when `categorySource = RULE`. |
| `note` | text? | Free user note. |
| `tags` | list<text> | Optional secondary labels, orthogonal to category. |
| `isExcludedFromStats` | bool | Internal transfers, reimbursed items, corrections — **the person's answer and nothing else's** (M36 U04, D-380). |
| `countedOnCard` | bool? | A bank line paying a card's bill, answered as already counted in the card's own rows: the settlement's answer (M36 U04). Left out of every total as the person's flag is, and taken back with the settlement. |
| `holding` / `quantity` | Holding id? / decimal(6)? | What the row's cash turned into inside its account — a buy (quantity positive) or a sale (negative). Such a row is in no flow: not spent, earned or moved (M30 U2, D-355). Also on `staged_row`, carried to the commit. |
| `naturalKey` | text | Deterministic dedupe key. See below. |
| `importSessionId` | ImportSession id? | Provenance. Null for manual entries. |
| `sourceRowRef` | text? | Sheet name + row number, for "show me where this came from". |

**Dedupe / natural key.** Composed of: account id · transaction date · absolute amount ·
normalized merchant · installment sequence (if any) · a collision counter for genuinely
identical same-day repeat purchases. The collision counter is what makes "two identical
coffees on the same day" work: on import, the Nth occurrence within a file gets counter N,
so re-importing the same file reproduces the same keys.

**Invariants:**
- Sign of `amount` agrees with `direction`.
- `categorySource = RULE` implies `matchedRuleId` is set and the rule still exists (or is
  soft-deleted but retained).
- `naturalKey` is unique per account among non-deleted transactions.
- Manual edits set `categorySource = MANUAL` and are immune to re-categorization. Made from the
  ledger, they also write a `category_override` row — see "Audit of overrides" below.

### Installment

Present when one purchase is split into payments (`תשלומים`).

**Built** as columns on `transaction` — `installment_sequence`, `installment_total` (migration
001) and `installment_group_key`, `original_total_minor` (migration `007`). Not a table: a slice
belongs to exactly one charge, so a child table would be a row-per-row join for nothing.

| Field | Type | Notes |
|---|---|---|
| `transactionId` | Transaction id | Owning charge (this month's slice). |
| `groupKey` | text | Shared by all slices of the same purchase. Derived from merchant + original date + original total, by `installmentGroupKey` in `src/domain/installments.ts`. Never read from a file — no Israeli provider ships a purchase identifier. When the file states no original total, the payment count stands in for it in the key. |
| `sequence` / `total` | int / int | "3 of 12". Parsed from the `installmentText` column (`תשלום 3 מתוך 12`), or from the `installmentSequence` + `installmentTotal` columns when a format states them separately; the numeric pair wins when both are mapped. |
| `originalTotal` | Money? | The full purchase price, as a **magnitude in the transaction's own currency** — hence `original_total_minor` with no currency column of its own. Absent when the file states only the slice. |
| `originalDate` | LocalDate | When the purchase was made. **Stored as the transaction's own `transactionDate`, not as a column of its own.** Both real providers repeat the purchase date on every slice and vary only the charge date, so a separate column would hold a copy of a value already on the row. A format stating a *third* date — a purchase date separate from the row's own transaction date — is not supported; the "original date" column role that used to wait for it was retired in D-036, unread. |

**Invariants:** `sequence` ≤ `total`. Slices of one `groupKey` sum (approximately, by magnitude)
to `originalTotal`; rounding differences land on the final slice.

**Reporting choice:** statistics count the **slice charged in the period**, not the original
purchase — the money left the account that month. A "purchase-basis" toggle is a future
option; see [08 Suggestions and Open Questions](./08-suggestions-and-open-questions.md).

### ForeignAmount

| Field | Type | Notes |
|---|---|---|
| `transactionId` | Transaction id | |
| `originalAmount` | Money | In the foreign currency. Denominated by the `originalCurrency` column role when the format has one (Max's `מטבע עסקה מקורי`), and by the charge currency otherwise. |
| `exchangeRate` | decimal | As supplied, informational. |
| `feeAmount` | Money? | **Deferred, deliberately.** Neither real export itemizes a foreign-transaction fee: Max spends sixteen columns on a foreign row without one, and Cal's seven have no room for it. There is nothing to parse it out of and no column role that would fill it, so migration 007 does not add one. It arrives with the first real file that states a fee, alongside the role that reads it. |

**A foreign amount and an installment total are the same column.** Both are "the original
amount", and telling them apart is what the `originalCurrency` role is for: a stated currency
different from the charge currency is a conversion; anything else is not. See D-035 for what
this cost before it was separated.

---

## Categories

### Category

**Three levels maximum** (D-348): Living → Utilities → Electricity. A top-level category is a heading —
the Categories screen and Plan list what is under it — and a budget on any category counts everything
under it. The groups that sat above a two-level tree were top-level categories by another name, and
became them; `category_group` is retired. Deeper trees make every UI worse.

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `parentId` | Category id? | Null = top-level. The same kind as its parent; never a system category. |
| `kind` | enum | `EXPENSE`, `INCOME`, `TRANSFER`, `SAVING`, `DEBT_PAYMENT`. Drives which screens show it. |
| `color` / `icon` | text | For charts and chips. `color` holds a **palette token name** (`category-3`), never a hex: the app has two themes and a colour picked against the white page is wrong on the black one, so the token carries a lifted variant for each (D-088). Read since the donut needed one; a picker to set it is not built, and an unset colour is a stable slot hashed from the id. `icon` is decoded and still unread. |
| `isSystem` | bool | Built-in categories (`Uncategorized`, `Internal Transfer`) that cannot be deleted. |
| `monthlyTargetAmount` | — | **Gone** (M36 U09, D-386): a category's monthly figure is its Plan bucket (D-327). |
| `sortOrder` | int | Per parent: siblings are the categories under the same parent, and each parent's order starts over at 10. |
| `isArchived` | bool | Hidden from pickers; historical transactions keep it. |

**Invariants:** max depth 3, counting what a moved category carries. Deleting a category with transactions is blocked; the user must
merge into another category or archive. Merging rewrites `categoryId` on affected transactions
and is recorded so it can be explained later.

Depth is enforced by triggers, not by the repository, so it holds against any writer — including
someone editing the document in a SQLite browser. 002 guarded `INSERT`, which was enough while
the table only ever received seed rows; **005 adds the `UPDATE` guards**, because reparenting is
an UPDATE and a third level was one statement away. Three rules, and the second is the one that
is easy to miss:

1. A category may not be given a parent that itself has one.
2. A category that already has children may not be given a parent.
3. A category may not be its own parent.

An **ungrouped** category sorts last, not first. SQLite puts NULLs first in an ascending sort,
which would park every category the user creates without a group above the whole seed set.

### CategoryRule

**Built** as the `category_rule` table in migration `008` — the table
`transaction.matched_rule_id` has pointed at since migration 002. The engine that reads it is
`src/domain/categorization.ts`, a pure function over rows loaded into memory; see D-037.

| Field | Type | Notes |
|---|---|---|
| `name` | text | What the rules screen lists it as. |
| `kind` | enum | `EXACT_MERCHANT`, `CONTAINS`, `REGEX`, `PROVIDER_CATEGORY`, `AMOUNT_RANGE`, `ACCOUNT`. |
| `pattern` | text | Meaning depends on `kind`; empty for the two condition-only kinds. |
| `targetCategoryId` | Category id | What it assigns. |
| `priority` | int | Lower number wins, within an origin tier. Integers underneath a drag-order UI, re-normalized in steps of ten on reorder (D-037). See the resolution order in [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md). |
| `scopeAccountId` | Account id? | Restrict to one account. |
| `amountMin` / `amountMax` | Money? | For `AMOUNT_RANGE` or as an extra condition on any kind. Stored as **magnitudes** (`amount_min_minor`, `amount_max_minor`) with one shared `amount_currency`: the sign of an amount is the importer's convention (D-004), so a signed bound would not mean what the user typed. |
| `isEnabled` | bool | |
| `origin` | enum | `USER`, `LEARNED_FROM_CORRECTION`, `AI_SUGGESTED`, `BUILT_IN` — in resolution order, most trusted first. |
| `hitCount` / `lastMatchedAt` | int / instant | For the "unused rules" cleanup view. Written by an import or a re-apply, never by the test box. |

Three fields listed here before the table was built did not become columns, each because
something else already carries the fact (D-037):

- **`COMPOSITE`** as a seventh kind. Every rule carries conditions and ANDs them, so a
  `CONTAINS` rule with an amount band and an account scope *is* the composite.
- **`isCaseSensitive`**. Merchant rules match `merchantNormalized`, which has exactly one casing
  by construction; regexes compile case-insensitively for the same reason.
- **`isBuiltIn`**. It is `origin = 'BUILT_IN'`, and two spellings of one fact can disagree.

**A `BUILT_IN` rule is never a row in this table** (D-046). The built-in set ships with the app as
JSON rule packs under `src/data/reference/rulepacks/` and is merged into the rule set at read time
by `loadRules`, because a set that grows every release would otherwise need a migration every
release to reach documents that already exist — and migrations are immutable after release
(D-020). `origin` still carries all four values: it is the resolution tier, and a built-in has one
whether or not it was stored.

What the document keeps is the user's opinions about them, and it needed **no schema change**:

| Kept | Where |
|---|---|
| Which built-ins are switched off | `app_setting` key `rules.builtIn`, as `{"disabled":[…]}` (D-034's key/value table) |
| Which were forked | An ordinary `USER` row, plus the original's id on the disabled list |

**Since M25 U2 the built-ins are rows** of the pack's `category_rule` under the same `builtin:` ids
(D-268): switched off is the row's `is_enabled`, a fork is a `USER` row plus the original switched
off, and the `rules.builtIn` setting is folded into the rows on the first open and removed.

Ids are `builtin:` plus a namespaced pack id (`builtin:il.fuel.paz-yellow`), stable across
releases because the disabled list points at them, and impossible to collide with a `newId()`.
They reach `transaction.matched_rule_id`, `staged_row.suggested_rule_id` and
`reapply_change.previous_rule_id` like any other rule id — none of the three is a foreign key,
which is what makes that work. The join those columns get for a rule *name* finds nothing for a
built-in, so the UI resolves the name from the loaded rule set instead.

---

## Import

### ImportMapping

How one file format maps to the ledger. **Created and owned by the user**, not shipped as code
([F01 Card Statement Import](./f01-card-statement-import.md)). Reused automatically on later imports of the same format.

| Field | Type | Notes |
|---|---|---|
| `name` | text | User-named, e.g. "Cal – Visa 1234". |
| `accountId` | Account id? | Binding, or null for "ask each time". |
| `headerSignature` | text | Normalized set of header cell values; used to match a file to this mapping. |
| `sheetSelector` | text? | Which sheet, when a file has several. |
| `headerRowIndex` | int | Which row holds the column names. |
| `dataStartRowIndex` / `dataEndMarker` | int / text? | Where data begins and how it ends. |
| `columnRoles` | map<int, role> | Column index → role. Unmapped columns are ignored but retained in raw cells. |
| `amountConvention` | enum | `SIGNED_SINGLE`, `POSITIVE_IS_CHARGE`, `SEPARATE_DEBIT_CREDIT`. All three live as of D-060. The column carries **no CHECK constraint** (001), so the third value needed no migration; the guard against an unknown value is `VALID_CONVENTIONS` in the repository, and a mapping naming one is skipped rather than read as something else. |
| `defaultCurrency` | text | ISO code an amount is read as when no `currency` column states one for the row. Guessed from the file and overridden in the mapper (D-039); never empty. |
| `dateFormats` | map<role, text> | Per date column. |
| `decimalSeparator` / `thousandsSeparator` | char | Guessed, overridable. |
| `rowFilterPatterns` | list<text> | Subtotal and junk rows to skip. |
| `lastUsedAt` / `useCount` | instant / int | Sorts the mappings screen, and breaks the tie when two mappings claim one format. Counted on commit, not on opening the mapper: a mapping that was looked at and abandoned was not used. |

**What is stored, as of the saved-mappings work.** `name`, `headerSignature`, `sheetSelector`
(as `sheet_name`), `headerRowIndex`, `dataStartRowIndex`, `columnRoles`, `amountConvention`,
`dateOrders`, `defaultCurrency`, `lastUsedAt` and `useCount` are written and read back.
`dataEndMarker`, `rowFilterPatterns` and the separator overrides are not in the schema; see the
deferred list in [F01 Card Statement Import](./f01-card-statement-import.md).

**`accountId` is set from the mappings screen** (F12), where each row carries a select whose null
option is **"ask each time"** — which is what the field means rather than a placeholder for a
missing feature. The binding is a *fallback*, not an override: the card number a file states about
itself still decides which account it lands in (D-033), because that is a fact about the file while
the binding is a fact about the format. What it fixes is the hole that leaves — a statement naming
no card anywhere, which was otherwise identified by the mapping's name. Where the binding names an
account with no `last4` and the file states one, the account adopts it (`resolveAccountForImport`).
**Since M28 F11 (D-337) an unbound mapping also learns its account on first use**, when that
account has no `last4` (a bank): the commit binds it, and a merge binds a mapping that only ever
read into the merged-away account to the survivor. Otherwise a reader named after one export would
find no account by that name the next month and make a new bank.

A save from the mapper that says nothing about the account **keeps the binding**. The mapper only
knows an account once the file has resolved to one, and re-saving columns is not a statement about
which card they belong to; `setMappingAccount` is the one way a binding is cleared.

**Two rows may share a `headerSignature`.** `duplicateMapping` is the only thing that makes that
happen, and it is the user asking for a copy. Nothing enforces uniqueness, because the matcher
already has a total order to break the tie with — `listMappings` returns most-recently-used
first, and the first exact match wins — and because a UNIQUE constraint would turn a duplicate
into a failed write rather than a visible choice. The screen marks both rows instead (D-031).
Saving from the mapper still upserts on the signature, so the ordinary path does not create one.

`headerSignature` is `fc1` plus the column count plus the normalized header cells, joined on
U+001F. It is versioned so a signature written by an older normalization is recognised as
unreadable rather than silently mis-matched, and it round-trips back to its cells, which is what
the close-match comparison needs.

`columnRoles` and `dateOrders` are JSON objects (`{"0":"date",…}` and `{"date":"DMY",…}`). Both
decode defensively: the document is a real SQLite file the user can open in any tool, so a
mangled row is skipped and an unrecognised role is dropped rather than failing the import.
A mapping that cannot be read falls back to guessing, exactly as a deleted one does.

**Column roles:** required — `date`, `merchant`, and then either `amount` or the pair `debit` +
`credit`, depending on the amount convention (`requiredRolesFor`). Optional — `chargeDate`, `currency`,
`originalAmount`, `originalCurrency`, `exchangeRate`, `providerCategory`, `installmentText`,
`installmentSequence`, `installmentTotal`, `cardLast4`, `reference`, `balance`, `note`. A saved
mapping written by an older build may name a role this list no longer has — `transactionDate`,
retired in D-036 — and that role is dropped on read while the rest of the mapping survives.

**Invariant:** a mapping must assign the three required roles before it can be saved.

Alias tables (Hebrew and English header names → roles) and value-shape inference are **hint
sources** used to pre-fill a new mapping. They are code-level data and may be wrong without
breaking anything, because the user confirms the preview before committing.

### ColumnRole — moved

The four reading vocabularies became the engine's on 2026-09-16; they are in
[`../../04-data-model.md`](../../04-data-model.md). `ImportMapping`, `DocumentTemplate`,
`ImportSession` and `StagedRow` below are the intake ladder's and **stay here for now** — the
machinery under them is domain-independent (D-013, D-149, D-206), but what they actually read is
a statement until M19 U5 retargets them at a declared format.

### DocumentTemplate

How one **label-value** document format is read — payslips and fund reports, which have no header
row for `ImportMapping` to sign. Schema 21, [D-139](../../09-decision-log.md), design in
[F17 Mapping Templates](../../mapping-templates.md). Derived once, confirmed by the user, then
executed with no model involved.

| Field | Type | Notes |
|---|---|---|
| `kind` | enum | `PAYSLIP`, `FUND_REPORT`, both decoded (D-149). The **kind and the `anchors.shape` have to agree** — a row where they disagree is skipped, because nothing can execute it safely. |
| `name` | text | What the user calls this format — an employer, a provider. |
| `labelSignature` | text | `lv1`, the label count, and the document's normalized **static labels**, sorted, joined on U+001F. Stored as its labels rather than hashed, for `headerSignature`'s reason: the useful answer is *how close*. |
| `anchors` | JSON | The field map, shaped by `kind`. Decoded defensively. |
| `derivedBy` | enum | `LOCAL_MODEL`, `PLUGIN`, `SEED`, `MANUAL` — which rung of F17's ladder produced it. |
| `confirmedAt` | instant? | **Null until a human agreed.** `readableTemplates` returns only stamped rows, which is where "nothing is written without a human action" is enforced rather than remembered. |
| `pinnedFields` | list<text> | Fields the user corrected. Re-derivation carries these over rather than writing across them. |
| `version` / `supersededAt` | int / instant? | The version chain. Re-deriving supersedes and inserts; old versions keep their anchors, because last year's slips still need the map that read them. |
| `lastUsedAt` / `useCount` | instant? / int | Counted when a document was actually read, not when one was previewed. |

**An anchor is a label, an occurrence ordinal and the line it was found on.** The line is a
*hint* — what the deriver saw — and never how the field is found again: a document's line numbers
change when anything above them does, and its words do not. The ordinal is what tells the `מס הכנסה`
in the deductions table from the `מס הכנסה` under the year-to-date totals. A payslip's map is
`{shape, fields, deductions}`, where a deduction also carries `hasEmployerColumn` and
`hasBasisColumn` — the row's columns — and, once a person has said so, `deductionTypeId`
(D-145). **No deriver ever writes that last one**: D-132 keeps naming with the user, and what
D-145 adds is that the user's answer is kept against the format instead of re-asked every month.
It is a JSON field on an already-defensively-decoded column, so it needed no migration: a template
written before it reads back without one, which is the same "ask" an unnamed row gets.

**One current template per format**, enforced by a partial UNIQUE index over
`(kind, label_signature)` where the row is neither superseded nor deleted. This is where the table
parts from `ImportMapping`, which deliberately allows two rows to share a signature: nothing
duplicates a template on purpose, and two current rows would make "this template stopped
verifying" ambiguous about which one did.

**Nothing here holds a figure.** A template says where a number is; reading it happens every time
the document is opened.

### ImportSession

| Field | Type | Notes |
|---|---|---|
| `accountId` | Account id | Chosen or detected. |
| `mappingId` | ImportMapping id | Which mapping parsed this file. |
| `fileName` / `fileHash` | text | Hash detects "you already imported this exact file". |
| `billingPeriod` | YearMonth? | Parsed from the file preamble where available. |
| `rowCountTotal` / `New` / `Duplicate` / `Failed` | int | Summary counters. |
| `status` | enum | `PARSING`, `AWAITING_REVIEW`, `COMMITTED`, `CANCELLED`, `FAILED`. |
| `committedAt` | instant? | |
| `printedTotal` | Money? | The total the file states for itself, scanned once at stage time (migration 004). Null when the file states none — which is a different fact from stating zero. |
| `printedTotalText` / `printedTotalSource` | text? | The string it was read out of and the cell it came from, kept verbatim: the comparison is a claim about the file, and the user has to be able to check it. |
| `balanceCheck` | JSON? | What the file's running balance said about the parse (F06, migration `016`). **One JSON column, not eight** — there is one per session, nothing queries it, and its shape is a union whose cases share no fields. Decoded defensively; a mangled value reads as no check, which is the state every card import already has. D-063. |

The total is stored rather than recomputed because by review time the sheet is gone — a resumed
import has staged rows and no file in memory. See [F01 Card Statement Import](./f01-card-statement-import.md), "Verification".

**Invariant:** an `ImportSession` can be rolled back while it is the most recent session for
that account; rollback deletes only the transactions it created and restores any it updated.

### StagedRow

The pre-commit staging area. Persisted so an interrupted import survives an app kill.

| Field | Type | Notes |
|---|---|---|
| `sessionId` | ImportSession id | |
| `rowIndex` | int | Original sheet row, for error messages. |
| `rawCells` | text (JSON) | The untouched row. Keeps errors debuggable. |
| `parsed` | Transaction-shaped draft | Nullable when parsing failed. |
| `status` | enum | `NEW`, `DUPLICATE_EXACT`, `DUPLICATE_SIMILAR`, `UPDATED`, `PARSE_ERROR`, `SKIPPED`. |
| `errorMessage` | text? | Human-readable, row-scoped. |
| `suggestedCategoryId` | Category id? | From the rules engine, written when the row is staged. |
| `suggestedRuleId` | CategoryRule id? | Which rule suggested it (migration `009`). Carried to the commit rather than recomputed, so the rule set changing mid-review cannot change what lands (D-038). |
| `chosenCategoryId` | Category id? | What the user picked in the review. Separate from `suggested` on purpose — see below. |
| `userDecision` | enum | `PENDING`, `ACCEPT`, `SKIP`, `EDIT`. Defaults to `PENDING` for every row, including the ones the app is confident about. |

**The parsed draft is columns, not a blob** (migration `003_staged_row.sql`). "Transaction-shaped"
taken literally: the review screen counts and filters by status in SQL rather than walking every
row in JavaScript, and the commit's copy into `transaction` stays obvious. Every draft column is
nullable, because a `PARSE_ERROR` row has no date, no amount and no merchant and still has to
appear in the review with its raw cells and its error. The staged row also carries the same
sign/direction CHECK the ledger enforces, so a sign bug is caught a hop before the copy that
would propagate it.

**Two category columns, not one.** `suggestedCategoryId` is the rules engine's answer ([F03 Auto Categorization Engine](./f03-auto-categorization-engine.md));
`chosenCategoryId` is the user's pick in the review screen. Collapsing them would put a manual
choice in a column named "suggested" and make it indistinguishable from a guess — which is
exactly what D-009 rests on being able to tell apart. On commit they become different things: a
chosen category is a `MANUAL` assignment that nothing may ever overwrite, and a suggestion is a
`RULE` assignment carrying `matched_rule_id`, which a later re-apply may revisit. A row with both
commits as `MANUAL`; the user looked at it and said otherwise.

`rawCells` is a JSON array of the cells' displayed text. Cell *types* are deliberately not kept:
they are re-derivable by re-importing the file, the staging area is transient, and a 5,000-row
statement should not carry a second typed copy of itself inside the document.

`billingPeriod` is derived when the row is staged and carried to the commit rather than
recomputed, so the figure the user reviewed is the figure that lands.

### CardSettlementLink

Connects a bank-statement row to the card account whose monthly charge it represents, so the
same money is never counted twice ([F06 Bank Statement Import](./f06-bank-statement-import.md)).

| Field | Type | Notes |
|---|---|---|
| `bankTransactionId` | Transaction id | The settlement row in the bank account. |
| `cardAccountId` | Account id | Matched via the last-4 digits found in the row's description. |
| `billingPeriod` | YearMonth? | Which card statement it settles. |
| `matchConfidence` | enum | `HIGH` (last-4 plus amount agreement), `MEDIUM` (last-4 only), `LOW` (amount and date only). |
| `userDecision` | enum | `EXCLUDED`, `KEPT`, `PENDING`. |

**Invariant:** when `userDecision = EXCLUDED`, the bank transaction has
`countedOnCard = true` — never `isExcludedFromStats`, which is the person's (M36 U04, D-380). The
link is retained either way so the row stays drillable; a link dropped as stale takes its answer
with it.

**A table rather than columns on `transaction`, and the deciding field is `userDecision`** (D-060).
The card, the period and the confidence are all re-derivable from the last-4 and the ledger; the
user's answer is not, and neither is the confidence they were shown when they gave it. As columns
this would be four, null on every card row in the ledger. The rows this links are matched **per
card per month** — one card charged twice in a month is one settlement, summed before it is
compared against the statement.

**There is no `rowClass` column anywhere.** What a bank row is read as is derived on demand and
changes when a card statement arrives, which is what makes order of import irrelevant. See D-060
and [F06 Bank Statement Import](./f06-bank-statement-import.md).

### TransferPair

A transfer between two of the person's own accounts that are not cards — the row that left one and the
row that arrived in the other (M30 U3, D-356). `transfer_pair`, suggested by every commit
(`suggestTransfers`) and answered once.

| Field | Type | Notes |
|---|---|---|
| `out_transaction` | Transaction id | The row that left. Unique: a row is an end of one pair at most. |
| `in_transaction` | Transaction id | The row that arrived — the same amount, the other sign, another account, within four days. Unique. |
| `user_decision` | enum | `PAIRED`, `NOT_PAIRED`, `PENDING`. |

**Matched by amount and date alone**, because a broker's deposit line carries no reference; closest date wins, and a
row with nothing leaving another account (a referral bonus) is never paired. **`PAIRED` moves no money twice**: the
end on an ordinary account is *moved* (into *saved*), the end on an account with holdings is in no flow
(`heldCondition`). `NOT_PAIRED` is kept so neither row is suggested again.

**Since M30 U5 (D-358) every row of an account with holdings is in no flow**, not only a paired end: interest, a
bonus or a fee rebate there is growth of its cash, and a fee a loss of it — never income or spending.

### HoldingReading

What a statement printed one holding was worth on a day (M30 U5, D-358). `holding_reading`, one a holding a day;
transcribed by `record_holding_readings` or typed on a goal's page, never fetched (D-308).

| Field | Type | Notes |
|---|---|---|
| `holding` | Holding id | |
| `as_of` | date | Unique with `holding`. The same figures again change nothing; other figures are refused unless they say they correct it. |
| `value` | money | What it was worth, as printed. **The figure.** |
| `quantity`, `cost_basis`, `price` | decimal, money, decimal | As printed, each optional and each **a check only**: the rows' quantity and what they put in by that day, and quantity × price against the value — the format's `price` identity, `value = quantity * price * 100 ± 0.1%` (D-379). An account's own cash takes a value only, checked against the account's running balance. |
| `statement` / `source` | Statement id? / text? | Where it came from. |

**Growth is derived and keyed by the reading**: for a goal fed by its holding (D-357), each reading brings a `GROWTH`
deposit (`source_key` `reading:<id>`) of what changed since the one before, so the goal's balance is its latest reading
— and can go down. Worked out on read by `fedDeposits` and never stored (M36 U05, D-381); a reading removed takes its
deposit with it because there is nothing to take. **A holding's own worth** is declared: `reading`, its latest by
`as_of`, and `put_in`, what its rows bought less sold and what a person put in by hand; what moved after the reading's
day is added in code, and growth is that worth less `put_in` (D-381).

**Built** — migration `015`, `cardSettlementRepository.ts`, D-061.

**What is stored is what cannot be derived.** The card, the period and the confidence are a cache
of D-060's derivation and `syncSettlementLinks` overwrites them on every import — that is what
makes a `MEDIUM` match become `HIGH` when the card statement arrives a week later. `userDecision`
is never written by a sync, and `matchConfidence` is kept rather than recomputed at decision time
because the user answered about what they were shown (the reasoning of D-038).

**`PENDING` is a row, not a missing row.** A link exists from the moment a settlement is
committed, so the pending count is answerable without re-running the importer.

**One live link per bank transaction**, enforced by a unique index that is partial on
`deleted_at IS NULL`. The invariant above is held by `setSettlementDecision` and
`decideAllForCard`, which are the only two ways a decision is written and both go through one
function that writes `counted_on_card` with it (M36 U04).

---

## Income

### Paycheck

| Field | Type | Notes |
|---|---|---|
| `period` | YearMonth | The salary month, not the payment date. |
| `paymentDate` | LocalDate | When it landed. |
| `employerName` | text? | Supports more than one job. |
| `grossAmount` | Money | |
| `netAmount` | Money | Entered, not computed — it must match the slip exactly. |
| `depositedToAccountId` | Account id? | Enables matching against the bank statement. |
| `note` | text? | |
| `sourceKind` | enum | `MANUAL`, `PDF_PARSED`, `AI_PARSED`. |
| `attachmentRef` | text? | Optional stored copy of the slip. |
| `isIrregular` | bool | A bonus or 13th-salary month, which averages exclude. Suggested by the >1.5× median test in [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md), stored only once the user confirms it — the confirmation is the part that cannot be re-derived. |

**Invariants:** `grossAmount` ≥ `netAmount`, and a negative net is refused — both checked by
`validatePaycheck` in `src/domain/paycheck.ts`, not by the schema, because a constraint that
aborts the save cannot say which of the two fields was the typo.
`gross − Σ(net-reducing lines) − net` is surfaced as a **reconciliation delta**; a non-zero delta
is a warning, never a blocker, because slips contain items users won't itemize.

**Not unique per (`period`, `employerName`)**, which this note asked for until D-048. The edge
cases in [F04 Paycheck Tracking](./f04-paycheck-tracking.md) allow a 13th salary in the same period as the regular slip from
the same employer, and the two statements cannot both hold. Migration `012` indexes the pair
without enforcing it, and entry warns that a slip already exists for the month.

### PaycheckLine

One row per deduction or addition on the slip.

| Field | Type | Notes |
|---|---|---|
| `paycheckId` | Paycheck id | |
| `deductionTypeId` | DeductionType id | |
| `employeeAmount` | Money | Deducted from the employee. |
| `employerAmount` | Money? | Employer's side — not deducted from net, but part of total compensation and of pension/study-fund balances. Absent means the type has no employer side at all, which is not the same fact as an employer share of zero. |
| `basisAmount` | Money? | The salary base the percentage applied to — **not the gross**, and the only figure on a slip that can be set against the salary column a fund's deposit table prints (D-169). Written by the app's editor since M14; the plugin always has. |
| `note` | text? | |
| `sortOrder` | int | The order the lines were entered in, which is the order the slip prints them. |

**Both amounts are magnitudes, not signed** (D-048). "How much was taken" is what the slip
prints and what the user types; which direction it moves take-home pay is the type's
`reducesNet`. The sign convention of D-004 is about a transaction's direction and does not reach
this table.

**One line carries both sides of one deduction.** Pension is a single line with an employee
amount and an employer amount, not two lines against two types — see D-048 and the seed list
below.

**No currency of its own:** a payslip is denominated in one currency, held on the `Paycheck`,
and a copy per line is a copy that can drift from the total it has to add up to. Migration `012`
has no currency column here, and the repository decodes lines in the paycheck's currency.

Lines are **not soft-deleted**: nothing outside a paycheck addresses one, and editing a slip
replaces its lines wholesale.

### DeductionType

Built-in set, user-extensible. **Rows in the document**, seeded by migration `012` exactly as
`002` seeds categories and `006` seeds institutions — deliberately unlike the built-in *rules* of
D-046, which ship with the app and leave only the user's disagreements in the document. A
`PaycheckLine` holds a real foreign key here, and every link and flag below is per-document state
that has to be stored regardless. See D-049.

| Field | Type | Notes |
|---|---|---|
| `name` | text | English display name. |
| `hebrewName` | text? | For matching against the slip. |
| `kind` | enum | `TAX`, `SOCIAL_INSURANCE`, `HEALTH`, `PENSION`, `STUDY_FUND`, `SEVERANCE`, `LOAN_REPAYMENT`, `UNION`, `BENEFIT_IN_KIND`, `OTHER_DEDUCTION`, `ADDITION`. |
| `reducesNet` | bool | False for employer-side and for notional items. |
| `countsAsSaving` | bool | True for pension, study fund, severance — these are wealth, not spending. |
| `linkedSavingGoalId` | SavingGoal id? | Route the deduction into a savings balance automatically. |
| `linkedDebtId` | Debt id? | Payroll-deducted loans reduce a debt. See [F08 Debts](./f08-debts.md). |
| `linkedFundAccountId` | FundAccount id? | Which pension / hishtalmut fund this line feeds. Produces the expected contributions reconciled in [F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md). |
| `isBuiltIn` | bool | Shipped with the app. Editable — an employer's own wording, or a link to a fund, is a fact about this document — but never deletable. |
| `sortOrder` | int | Picker order, renumbered in tens on a reorder. |

**Built-in seeds:** Income tax (מס הכנסה), National insurance (ביטוח לאומי), Health tax
(מס בריאות), Pension (פנסיה), Study fund (קרן השתלמות), Severance (פיצויים), Union dues
(דמי ועד), Meal card (כרטיס הסעדה), Company car value (שווי רכב), Other deduction (ניכוי אחר).

**No `– employee` / `– employer` pairs.** This list named four of them until D-048; pension,
study fund and severance are one type each, and the employer's share is the second amount on the
line. "Other deduction" is new to the list and is what the reconciliation strip's one-tap "add
the difference" writes ([F04 Paycheck Tracking](./f04-paycheck-tracking.md), entry flow step 4).

A user's own type can be deleted only while no paycheck names it — refused rather than cascaded,
for the reason `deleteCategory` refuses: removing a type a year of slips names would rewrite what
those slips said.

---

## Planning

**Built**, as `split_plan`, `split_bucket` and `allocation` (migration `014`).

### SplitPlan

| Field | Type | Notes |
|---|---|---|
| `name` | text | e.g. "Default", "Bonus month". |
| `basisKind` | enum | `LAST_PAYCHECK`, `AVERAGE_LAST_N`, `SPECIFIC_PAYCHECK`, `CUSTOM_AMOUNT`. |
| `basisPaycheckId` / `basisMonths` / `customAmount` | — | Whichever the basis needs. |
| `currency` | text | One per plan, as a paycheck holds one for its lines. Allocations take theirs from here. |
| `isDefault` | bool | Exactly one; setting it clears the others. |

What a fixed expense does to a plan is a `plan_fixed_expense` row per plan and expense (NET, SPLIT,
IGNORE; D-319), and which plan a month is on a `plan_month` row (M31 U4, D-370). The plan-wide
`fixedExpenseMode`, `fixedInSplit` and `appliedToPeriod` they replaced went in M36 U09 (D-386).

### SplitBucket

**Shared across plans**, which is what the `SplitPlan ──< Allocation ──> SplitBucket` diagram at
the top of this note says, and what makes "Default" and "Bonus month" comparable: the same
destinations, different percentages. There is no `planId`.

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `targetKind` | enum | `CATEGORY`, `SAVING_GOAL`, `DEBT`, `FUND`, `ACCOUNT`, `FREE` — each kind's link required with it (D-319). `FUND` and `ACCOUNT` are kinds of their own and `FIXED_EXPENSES` is gone since M36 U09: the pack rebuilds an older document's list (D-386). |
| `targetId` | id? | Which category/goal/debt. No foreign key: it points at four tables, so one could only be right a quarter of the time. |
| `color` / `sortOrder` | — | |
| `isBuffer` | bool | Absorbs the **rounding** leftover — the agorot floor division threw away. **Not** the balance; see below. |

### Allocation

| Field | Type | Notes |
|---|---|---|
| `planId` / `bucketId` | ids | |
| `mode` | enum | `PERCENTAGE`, `FIXED_AMOUNT`, `REMAINDER`. |
| `basisPoints` | int? | Of the splittable amount. **Integer basis points, not a decimal**: 2350 is 23.5%. A decimal here would put a float in the money path's vicinity, which docs/05 has forbidden since D-003 (D-056). |
| `amount` | Money? | |
| `isLocked` | bool | Locked allocations don't move when the user drags other sliders. |

**`isBuffer` and `REMAINDER` are different things**, and this note described both without saying
so. A buffer bucket absorbs the **rounding** leftover, which is never more than one agora per
other bucket. A `REMAINDER` allocation absorbs the **balance** — everything the plan did not
assign, which can be thousands. A plan can have one, both, or neither.

**Invariants**, both enforced by partial unique indexes rather than by hoping every caller checks:
at most one `REMAINDER` allocation per plan, and at most one allocation per bucket per plan.
Percentages need not sum to 100 — the shortfall or overflow is shown explicitly rather than being
silently corrected. Rounding uses largest-remainder so the buckets sum exactly to the basis.

---

## Savings

**The domain landed first**, as `src/domain/model/savings.ts` and `src/domain/savings.ts` — pure
and tested before any table existed, the way F13's did (D-074). **Migration `018` and
`savingsRepository` followed** (D-075).

**Migration `024` split a place from what it holds** (D-175, D-176, M15). A `HoldingPlace` is a
location and nothing else; a **`Holding`** is what form the money takes there, and it carries the
rate, the liquidity, the term and — new — how the balance is *known*. Money always lands in a
holding, never in a bare place.

**No query in the repository sums a balance**, which is this section's shape as much as its code's:
neither table carries a total, and there is no `SELECT SUM(amount_minor)` in the file. The rows go
to the domain and the domain adds them up.

### SavingGoal

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `targetAmount` | Money? | Optional — some goals are open-ended. An `EMERGENCY` goal aims at one like any other (M36 U09, D-386). |
| `targetDate` | LocalDate? | Drives "required monthly contribution". |
| `kind` | enum | `EMERGENCY`, `SHORT_TERM`, `LONG_TERM`, `RETIREMENT`, `EARMARKED`. |
| `defaultHoldingId` | Holding id? | Where this goal's deposits land by default, and where a projection assumes new money goes. A **holding** since `024`: money has to land in one, and a default naming a place would leave the app to pick which of its holdings, silently. **The goal form's one question, *Where is the money?*** (M30 F3, D-363): `saveGoalAnswer` writes it with the goal, any place *+ New…* made, the *Was already there* deposit and the feed, in one write. |
| `deposit_category` / `fed_by_holding` / `fed_by_transfers` | Category id? / bool? / bool? | **What feeds it, one source only** (M30 U4, D-357): a Money moved category whose rows are its deposits (D-324), *or* the rows that name its default holding — bought or sold inside an account that holds things, *or* (M30 F4, D-364) the confirmed transfer pairs with an end on the bank or cash account whose own Cash is its default holding — arriving is a deposit, leaving a withdrawal, after its latest *Was already there*. Never two, and one goal per category, holding or account; a pair a transfer feed reads is read by no category. The `FROM_TRANSACTION` deposits each way are worked out on read (`fedDeposits`, M36 U05, D-381), never stored. Since M30 F3 the answer sets it: a holding bought by rows is followed, a bank account's answer counts its transfers when ticked, anything else is not fed, and a category chosen in the form's fold replaces any of them. |
| `isClosed` | bool | Goal reached or abandoned; retains history, takes no new deposits. |
| `priority` | int | Order for the splitter. |
| `note` | text? | |

**Derived, never stored:** current balance = Σ deposits − Σ withdrawals. Storing a balance
invites drift. The two `emergency*` columns are one nullable field in the domain
(`EmergencyFundTarget`), so a multiplier can never travel without saying what it is a multiple of.

**An emergency goal's target is derived too**, from the multiplier and the month's expenses, and
it is measured against **liquid** money only — everywhere, not only on the emergency panel. A
₪60,000 emergency fund with ₪40,000 of it in a locked deposit reads as short, because it is
(D-074).

### SavingDeposit

| Field | Type | Notes |
|---|---|---|
| `goalId` | SavingGoal id | |
| `date` | LocalDate | |
| `amount` | Money | Negative for a withdrawal, or for a loss. Never zero. |
| `holdingId` | Holding id | What the money is held **in**. A place since `018`, a holding since `024` (D-175). |
| `sourceKind` | enum | `MANUAL`, `FROM_TRANSACTION`, `FROM_PAYCHECK_DEDUCTION`, `FROM_PLAN`, and — since migration `019` — `OPENING_BALANCE` and `GROWTH` (D-081). **Stored only for what a person typed** — `MANUAL`, `FROM_PLAN`, `OPENING_BALANCE`, a typed `GROWTH` — since M36 U05 (D-381): a feed's `FROM_TRANSACTION`, a payslip's `FROM_PAYCHECK_DEDUCTION` and a reading's `GROWTH` are worked out on read by `fedDeposits` and handed out by `listDeposits` beside them, and a document opened from before has its stored copies removed. |
| `sourceRefId` | id? | Transaction or PaycheckLine that generated it. Never set on the two hand-entered kinds. |
| `transferGroupKey` | text? | Ties the two legs of a move between holdings together. They net to zero and are not contributions. Since `024` a move can happen **inside one place** — cash into the deposit at the same bank. |
| `note` | text? | **Required on a withdrawal** — the price of modelling one as a negative deposit. Not required on a `GROWTH` row, where the kind is the reason. |

**`OPENING_BALANCE` and `GROWTH` are in the balance and are not contributions.** The money is
really there, so it is in the sum; it is not money the user set aside, so `isContribution` in
`src/domain/savings.ts` keeps it out of the savings rate, the required-monthly figure, the
completion estimate, the streak and the paid-in-by-month chart. Widening the `CHECK` cost a table
rebuild, which is what migration `019` is (D-081).

**Invariant:** a deposit created from a plan is unique per source ref, so applying it again
cannot double-count it. One worked out from a transaction or a paycheck line is never stored, so
there is nothing to count twice (D-381).

### HoldingPlace

Where money physically is — the bank, the broker, the drawer. **A location and nothing else**
since migration `024` (D-175): Bank Hapoalim has no expected return, the fixed deposit you hold
there does, and the current account beside it does not.

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `kind` | enum | `CHECKING`, `DEPOSIT`, `INVESTMENT`, `PROVIDENT`, `STUDY_FUND`, `CASH`, `OTHER`. |
| `institution` | text? | Bank or broker name. Deliberately not `institutionId`: this names where money sits rather than an entity the importer maps files to. |
| `note` / `isArchived` | — | |
| *its account* | derived | **A place is an account's because the account's own cash is in it** (M36 U08, D-384) — the column `account` (M30 U1, D-354) went: the place's cash holding names the account, which said the same thing. A deposit or cash at home has none. A place is not re-pointed from one account to another in one step (D-362). A bank account's own cash is in no place, so no place is made for one; the ones an older build made (D-362) stay, and are the account's because its cash is in them. |

A place has no liquidity and no rate of its own. It reports the liquid and locked parts of what
its holdings hold, which `placeBalances` in `src/domain/savings.ts` assembles.

### Holding

**What form the money takes**, which is the thing that earns a return and the thing that is or is
not reachable (D-175). Cash in a current account, a fixed deposit at a stated rate, an index fund,
a pension's investment track — and, from M16, a position in one security.

| Field | Type | Notes |
|---|---|---|
| `holdingPlaceId` | HoldingPlace id? | Where it sits — the broker, the drawer, a deposit. **Optional since M36 U08** (D-384): a bank account's own cash is in no place, and the model reads it as `account:<id>`, the account's own row. |
| `account` | Account id? | Set on the one holding that is an account's own cash — a bank account's or cash's, made with the account (D-362), or an account with holdings', in the place with its holdings (D-354). Unique. |
| `quantity` *(aggregate)* | decimal | The sum of the `quantity` of every transaction that names it — bought less sold; `unchecked` when one names it with none (M30 U2, D-355). |
| `name` | text | A place can hold several, so each says which it is. |
| `kind` | enum | `CASH`, `DEPOSIT`, `FUND`, `TRACK`, `SECURITY`, `OTHER`. |
| `provenance` | enum | **How the balance is known** (D-176): `RECORDED` (Σ the movements entered, and nothing will ever confirm it), `TRANSCRIBED` (a statement says what it is), `VALUED` (positions × a price, M16). Declared, never inferred. |
| `lastConfirmedAt` | LocalDate? | When anybody last checked. Absent means never, which is a sentence rather than a blank. |
| `isLiquid` | bool | "Money I can reach this week." The user's answer, not an inference from `kind`: a פק"מ with six months to run is not liquid and one maturing next week arguably is. **Per holding since `024`**, so a brokerage account's cash counts towards an emergency fund and its index fund need not. |
| `expectedReturnBasisPoints` | int? | What it is expected to earn a year, before charges: 400 is 4%. |
| `expectedReturnBasis` | enum? | `CONTRACTUAL` or `ASSUMED`. A פק"מ's stated interest is a fact; an index fund's return is a guess, and showing the second as the first is the failure mode (D-074). |
| `termEndDate` | LocalDate? | When a term ends, for the holdings that have one. |
| `feeBasisPoints` | int? | What it charges a year. A `FundAccount`'s two fee bases stay in F13. |
| `note` / `isArchived` | — | |

**The two `expectedReturn*` columns are one nullable field in the domain** (`ExpectedReturn`), so
a rate can never be held without its provenance — the same reason `FeeReference` carries its
`asOf` and `source`. A projection moves an `ASSUMED` rate between its scenarios and leaves a
`CONTRACTUAL` one alone, now **per holding** rather than per place: a portfolio of one index fund
and one פק"מ stops being averaged into a single rate that describes neither.

**A holding has no stored balance either.** It is Σ the deposits that name it, exactly as a place's
was — **except a valued one**, whose balance is its units times a price (D-186). `provenance` says
which of the two it is: a `VALUED` holding is a position and its balance comes from
`positionValuations`, and every other holding is the sum it always was. Neither is stored, and the
valuation *replaces* the sum rather than joining it — the deposits that bought the units are the
same money in an earlier form.

**Migration `024`'s acceptance is that no figure moves** (D-175): every per-place total, both
liquidity subtotals and every goal balance read the same after it as before. Each existing place
gets one holding at `'h-' || place.id` carrying what the place used to carry, and every
`saving_deposit.holding_place_id` and `saving_goal.default_holding_place_id` is rewritten to it by
string rather than by join — a join would drop a deposit naming a place the document never had, and
a dropped deposit is a moved figure.

---

## Long-term funds

Pension, study fund, provident fund, managers' insurance. Structurally different enough from
`SavingGoal` to warrant their own aggregate — they have fees, employer components, and a
reconciliation problem that ordinary savings don't. See [F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md).

**Since M36 U12 a fund is a holding** (D-389): a `holding` row
whose `fund_type` is set, its reports `holding_reading` rows carrying the parts (employee,
employer, severance) under the `parts` identity, and their deposit tables `reading_deposit`
rows. A payslip line feeds it through `deduction_type.linked_holding`, a bucket through
`split_bucket.target_holding`. `fund_account`, `fund_balance_snapshot` and `fund_deposit`
are retired; what follows is how they were built, kept for the argument.

**Built**, as `fund_account` and `fund_balance_snapshot` (migration `017`), joined by
`fund_deposit` (migration `022`, D-153), with the domain that
reads them landing first — `src/domain/model/funds.ts` and `src/domain/funds.ts`, pure and tested
ahead of any screen (D-066, D-067). All four screens are built too (D-068, D-071, D-072), and
`deduction_type.linked_fund_account_id` finally has a control that writes it (D-073).

**`deduction_type.linked_fund_account_id` still has no foreign key**, and that is now a decision
rather than a wait (D-067). SQLite cannot add a constraint to an existing column, so writing one
would mean rebuilding a table `paycheck_line` holds ids into, on every existing document — to gain
nothing enforced, since this app never sets `PRAGMA foreign_keys = ON` and every REFERENCES clause
here is documentation. What keeps the link honest is `deleteFund`, which clears the links that
named the fund.

### FundAccount

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `fundType` | enum | `PENSION`, `STUDY_FUND`, `PROVIDENT`, `MANAGERS_INSURANCE`, `PROVIDENT_FOR_INVESTMENT`. |
| `institutionId` | Institution id? | The managing company. |
| `policyNumber` | text? | |
| `investmentTrack` | text? | Free text plus an optional risk band. |
| `status` | enum | `ACTIVE`, `DORMANT`, `CLOSED`. Dormant = old employer, still charging fees. |
| `employerName` | text? | Which job it belongs to. |
| `openedDate` | LocalDate? | |
| `firstDepositDate` | LocalDate? | Drives the study-fund liquidity date. Never guessed from `openedDate`. |
| `feeOnAccumulationBasisPoints` | int? | דמי ניהול מהצבירה, annual, in basis points of the balance. **50 is 0.5%.** |
| `feeOnDepositBasisPoints` | int? | דמי ניהול מהפקדה, in basis points of each contribution. 600 is 6%. |
| `feeNegotiatedUntil` | LocalDate? | Fee agreements expire and silently revert. |
| `beneficiaries` | text? | Rarely updated; a nudge field. |
| `notes` | text? | |
| `isArchived` | bool | |

**Both fees are integer basis points, not decimals** (D-066). A decimal fee multiplied against a
balance puts a float in the money path, which D-003 forbids and which D-056 already decided the
same way for allocation percentages. `applyBasisPoints` in `domain/funds.ts` is the one place a
proportion of an amount is taken, and it is integer arithmetic with half-up rounding.

**There is no `linkedDeductionTypeIds`.** [F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md) lists one; the fact it
names is already stored from the other side, on `DeductionType.linkedFundAccountId` since migration
`012`. A second name for one fact is the shape D-037 removed from `CategoryRule`, so the expected
contributions read the link from the deduction type (D-066).

**Derived, never stored:** current balance (latest snapshot), effective fee, returns, expected
versus actual deposits.

### FundBalanceSnapshot

A point-in-time reading transcribed from a fund report or website. Two snapshots are the
minimum for any derived metric.

| Field | Type | Notes |
|---|---|---|
| `fundAccountId` | FundAccount id | |
| `asOfDate` | LocalDate | |
| `totalBalance` | Money | |
| `employeeComponent` / `employerComponent` / `severanceComponent` | Money? | Different tax and withdrawal rules; reports usually break these out. |
| `depositsSincePrevious` | Money? | What the fund says it received. Compared against payslip-derived expected contributions. |
| `feesChargedSincePrevious` | Money? | What the fund says it charged. Reveals the effective fee. |
| `returnSincePrevious` | Money? | The amount the report prints. Never what the app computes. |
| `source` | enum | `MANUAL`, `REPORT_ENTRY`, `IMPORTED`. |
| `depositGapAcknowledged` | bool | The user chased the deposit gap ending here and found it explained. |
| `note` | text? | |

**Invariants:** one snapshot per (fund, date). `totalBalance` is never negative. Component
amounts, when all present, sum to the total within a small tolerance (₪1 in
`validateSnapshot`). **`depositsSincePrevious` may be negative** — a severance withdrawal is
recorded as exactly that, a negative movement with a note.

**`depositGapAcknowledged` is the one stored fact in an otherwise derived feature** (D-066).
Expected contributions, the reconciliation and every fee and return figure are recomputed from
payslips and snapshots every time. What cannot be recomputed is the user having phoned the employer
and learned the gap was a timing offset — the same argument `CardSettlementLink.userDecision` won
(D-061). It is a column rather than a table because a reconciliation window is identified by the
snapshot that closes it, which is a row that already exists.

**Fee reference data** (regulatory caps and typical negotiated fees) **ships with the app and is
overridable in the document** — D-046's answer, reached by D-046's two tests: nothing holds a
foreign key to a benchmark, and a cap changes by regulation rather than per document. It is
`src/data/reference/fundFeeReference.ts` plus an `app_setting` for overrides, not a table. Every
row carries `asOf` and `source`, because a stale cap presented as current is worse than none.

### FundDeposit

One row of the deposit table a fund report prints — the other side of an expected contribution, and
the only place this app learns what a fund received **per month** rather than per period (D-153,
migration `022`).

| Field | Type | Notes |
|---|---|---|
| `fundAccountId` | FundAccount id | |
| `snapshotId` | FundBalanceSnapshot id | The reading this row was transcribed from. A deposit is what a report *said*. |
| `employerName` | text? | Free text, as `FundAccount.employerName` is: an employer on a report is a name, not an entity. |
| `depositDate` | LocalDate? | When the money reached the fund. |
| `salaryMonth` | YearMonth? | **The month this deposit is _for_** — the column this table exists for. |
| `employee` / `employer` / `severance` | Money? | As the row breaks it down. |
| `total` | Money? | The row's own total column, where it has one. **Never a computed sum.** |
| `salary` | Money? | The salary it was computed on, where the table prints it. |
| `source` | enum | `MANUAL`, `REPORT_ENTRY`. |
| `note` | text? | |

**`salaryMonth` is the whole point.** Everything else here a report's totals already imply; the
salary month does not, and without it a payroll month has to be matched to a deposit date through a
guessed lag — which is what `reconcileDeposits` does, and why its answer is a running total over a
window rather than a verdict about January. A row saying *this ₪1,750 is for 11/2025, and it arrived
on 04/01/2026* answers both questions outright, and `depositsByMonth` is what reads it.

**Invariants and the two that are deliberately absent.** Every amount is optional and **absent means
the report did not print it**, which is `FundBalanceSnapshot`'s rule for its components; a row with
no amount at all is not a row and is never built. There is **no unique index**: the obvious one —
fund, salary month, employer, date — would reject the second of two overlapping quarterlies, which
is every consecutive Israeli pair, and a genuine correction deposit made twice in one month. And
**duplicates across readings are expected and kept**: an Israeli quarterly is year-to-date (D-152),
so Q2's table restates Q1's, each reading transcribes its own document faithfully, and
`distinctDeposits` dedupes by natural key wherever anything aggregates. Transcribe faithfully,
reconcile afterwards. **The survivor is chosen by an ordering as well as a key** (D-164):
`listFundDeposits` breaks the salary-month tie by the transcribing reading's `asOfDate`, so a
backfill opened newest-first still credits each deposit to the earliest report that stated it.

**A row belongs to its reading**, so `snapshotId` is not null and deleting the reading takes its rows
with it — what is left otherwise is a figure with no document behind it. Saving a reading writes its
table **whole** rather than merging into it, because re-reading a report with a corrected format has
to be able to remove a row that was never there.

## Investments

> Removed with investments (D-283, D-308): migration `048` drops these tables, and `core/price.ts`
> (`UnitPrice`, `valueOf`) went in M45 U2. Kept as the record of migrations `025` and `030`.

Securities, positions, prices, trades and what you plan to buy. Migration `025`, M16. See
[F18 Investments](./f18-investments.md).

**A position is a `Holding`** (D-181) — `kind = 'SECURITY'`, `provenance = 'VALUED'` — and
`SecurityPosition` is a 1:1 extension of it keyed on the holding id. There is no `place`, no
`balance` and no liquidity flag in this section, because the holding already has all three, and
every figure M15 built reads a position without being told it exists.

### Security

The instrument. **A label, not an amount**: no price, no quantity, no value, so two accounts holding
the same ETF share one record of what it is.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `isin` | string? | A key, and a partial unique index. NULL is not a key. |
| `securityNumber` | string? | **The other key** (D-195), and the only identity a TASE statement prints — `מספר נייר`, seven digits. Its own partial unique index; stored without separators. |
| `ticker` | string? | What a person says. Deliberately not unique: `VOO` is two things on two exchanges. |
| `name` | string | |
| `currency` | string | **What the price is quoted in.** ILS for a TASE security even though the exchange prints agorot — see the trap below. |
| `kind` | enum | `EQUITY` / `ETF` / `MUTUAL_FUND` / `BOND` / `CRYPTO` / `OTHER`. A label; no arithmetic branches on it. |
| `exchange` | string? | Free text off a statement, like `HoldingPlace.institution`. |

**Two keys, and the order matters.** `isin` first, because it is the identity two countries agree
on; `securityNumber` second, because it is the one an Israeli broker actually prints. `ticker` is
never a key — it was carrying the TASE number for a milestone for want of anywhere else (D-194),
which is what put an identity in the one field the schema promises nothing about. Matching is
`upsertSecurityByKey`; a row with neither key creates rather than pooling two instruments into one.

**The TASE trap** (D-184): a Tel Aviv price is printed in **agorot** while the security is
denominated in shekels. The stored price is always in units of `currency`, so 12,345 agorot is
₪123.45, and **the division is exact** since D-204 — 250.50 agorot is ₪2.5050, not the ₪2.51 it was
until schema 30. The ÷100 belongs to the edge that read the quote and never to a total. **Whether the
edge can tell is a separate question from whether it converts correctly** — F18 and U8.

### SecurityPosition

| Field | Type | Notes |
|---|---|---|
| `holdingId` | string | **Primary key.** 1:1 with the `SECURITY` holding. |
| `securityId` | string | |
| `quantity` | Quantity | Millionths of a unit, integer (D-182). Never a float. |
| `quantityAsOf` | date? | **Not the price's date.** March says how many units you had; today says what one is worth. |

### SecurityPrice

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `securityId` | string | |
| `asOf` | date | Date-only (D-023). A price belongs to a day. |
| `unitPrice` | UnitPrice | Per **one** unit, so the multiplication has no lot convention in it. **`price_micro`: millionths of a minor unit** (D-204, migration `030`) — ₪2.5050 is `250500000`. A price is not an amount; what rounds to the agora is the value `valueOf` makes from one, never the price. |
| `source` | enum | `TRANSCRIBED` / `TYPED` / `FETCHED`, stored identically (D-178). |
| `sourceDetail` | string? | Which statement, or which provider. |

Unique on `(security_id, as_of, source)`: a refresh replaces, and a transcribed price beside a
fetched one from the same day is kept — two claims about one day, and the user may see them
disagree. `latestPrice` prefers the latest, then transcribed over typed over fetched.

### SecurityTrade

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `holdingId` | string | |
| `securityId` | string | Denormalised on purpose: a realised gain must survive the position that made it. |
| `date` | date | |
| `side` | enum | `BUY` / `SELL`. **Carries the sign**; the quantity is always positive. |
| `quantity` | Quantity | |
| `unitPrice` | UnitPrice | `unit_price_micro`, `SecurityPrice`'s unit exactly (D-204). **`upsertTrade`'s key compares it to the agora**, because migration `030` could widen a stored price and not recover digits it never had. |
| `fee` | Money | Zero is a real answer; there is no "unknown". **An amount, and it stays one** — money the broker took is money that moved. |
| `consideration` | Money? | **What actually moved, as printed.** Absent means derive it — quantity × price, plus the fee on a buy and minus it on a sell. |
| `fundingTransactionId` | Transaction id? | **Which money paid for it** (D-200, migration `029`). At most one, and on the trade rather than in a link table: a transfer pays for several purchases, so the relation is many-to-one and a column states it exactly. Absent is ordinary and stays legal — a purchase made before the bank statement was imported, or one paid out of cash already at the broker. Never part of the trade's natural key, so re-importing the statement that prints the purchase cannot clear it. |

### PurchasePlan

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `securityId` | string | |
| `holdingId` | string? | Absent while the account does not exist yet. |
| `amount` | Money | |
| `cadence` | enum | `MONTHLY` / `QUARTERLY` / `YEARLY`. |
| `startDate`, `endDate` | date? | |
| `isActive` | boolean | |

**The assumed return is not here.** It is `Holding.expectedReturn` with basis `ASSUMED` — a rate
belongs to the thing that earns it (D-175), and a second copy is a second answer.

### FxRate

| Field | Type | Notes |
|---|---|---|
| `base`, `quote` | string | |
| `asOf` | date | **Part of the rate, not metadata about it.** |
| `micro` | integer | One unit of base in millionths of a unit of quote. 3.72 is `3_720_000`. |
| `source` | enum | The same three a price has. |

D-003 says there is no rate in this document, and that is still right about a card charge — the
money already arrived in shekels. A position is the case it did not cover, and D-184 is the answer:
an explicit dated record, applied once by `convert`, with an unreachable pair reported in its own
currency by name rather than converted at a guess.

### DebtPayment gains FROM_PLAN

Migration `027` rebuilds `debt_payment` so `source_kind` admits `FROM_PLAN` — one `CHECK`, and
SQLite cannot alter one in place, which is `026`'s situation exactly. Nothing else about the table
changes and no figure moves; the `INSERT ... SELECT` is column for column, which matters here
because a debt balance is Σ the principal of these rows.

The ref is `planId:period:bucketId`, `saving_deposit`'s under the same name — **the bucket rather
than the debt**, because two buckets of one plan may point at the same debt on purpose and keying on
the debt would make the second overwrite the first. The unique index needs no change: it excludes
`MANUAL` and nothing else, so a plan payment is keyed the moment the kind exists (D-190).

A `FROM_PLAN` payment is **confirmed on write**, unlike everything else the user did not type: it is
not an inference, it is a button pressed on a printed figure, and `addPayment` confirms that same
act. It is also **not a discovered payment**, which is what `orphanedPayments` had to learn — its
ref names a plan bucket, and a "not `MANUAL`" test called every one of them orphaned.

### Security gains its number

Migration `028` adds `security.security_number` and a partial unique index on it — an `ALTER TABLE`
rather than a rebuild, since nothing here widens a `CHECK` (D-195).

It **backfills from an all-digit `ticker`**, which is where D-194 had to put the number: an exchange
symbol carries letters and a TASE number does not, so the test is a fact about the two vocabularies
rather than a guess. A copy rather than a move — nothing auto-deletes what the user may have typed
— and a number already naming **two** securities is backfilled on neither, because the unique index
would then refuse to build and the document would stop opening.

A template confirmed before `028` still calls that column a ticker; it is re-pointed on the mapper,
one column, and the migration does not touch it — a confirmed format is a statement of fact the user
made.

### A trade gains the money that paid for it

Migration `029` adds `security_trade.funding_transaction_id` and an index on it — an `ALTER TABLE`
rather than a rebuild, `028`'s situation again (D-200).

**A column rather than a link table**, which is the choice worth stating. `card_settlement_link` is
a table because it holds the app's *own guess* and a guess needs somewhere to record that it was
refused; nothing writes this column except a person naming the transaction, so there is no
confidence to store and no suggestion to accept. A link table would also allow two rows claiming one
trade, which is two records of one fact (D-036).

**Partial funding is deliberately not modelled.** A transfer's amount and Σ what its trades moved
rarely agree to the agora, and the difference is a fact rather than an error: money left over sits
as cash, money short came from cash already there. `tradeFunding` reports which of the two it is;
splitting one transfer across trades by amount would be the app inventing an allocation no document
printed.

### A price gets six digits past the agora

Migration `030` rebuilds `security_price` and `security_trade` so `price_minor` and
`unit_price_minor` become `price_micro` and `unit_price_micro` — **millionths of a minor unit**, the
same integer with six more digits, so the copy is `× 1000000` and no figure moves (D-204 carries why
the minor unit and not the major one). A rebuild because it *replaces* a column, and the fee and the
consideration stay `Money` because money that moved is money that moved. **It cannot recover digits
that were never there**: a trade recorded at ₪1.57 stays ₪1.57, so `upsertTrade` matches a price
**to the agora** — a key demanding the new digits would re-insert every migrated trade on the next
read of its statement.

### DocumentTemplate gains a third kind

Migration `026` rebuilds `document_template` so `kind` admits `INVESTMENT` beside `PAYSLIP` and
`FUND_REPORT` — one `CHECK`, and SQLite cannot alter one in place. Nothing else about the table
changes, and no figure moves.

An investment template's anchors are `{ shape: 'investment', fields, holdingsTable? }`, where
`holdingsTable` is a heading anchor plus a column order — `DepositTableAnchor`'s shape against the
document's **`HOLDING`** vocabulary in place of its `DEPOSIT` one (D-188, and `ColumnRole` above
since D-213: the roles are rows, so a stored template may name one somebody added). It is the **one** shape that decodes
with no `fields`: a broker that prints a holdings block and no account total is an ordinary
statement.

### What has no table, and will not get one

**Dividends and lots.** A dividend arriving as cash is an ordinary deposit into the cash holding;
attributing it to the security that paid it waits for a real statement that prints one. Lot tracking
waits for nothing — cost basis is a moving average and that is the only method (D-183).

## Debts

### Debt

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `kind` | enum | `MORTGAGE`, `BANK_LOAN`, `CARD_INSTALLMENTS`, `PAYROLL_LOAN`, `PERSONAL`, `OTHER`. |
| `principalAmount` | Money | Original amount borrowed. |
| `openedDate` | LocalDate | |
| `expectedEndDate` | LocalDate? | |
| `monthlyPaymentAmount` | Money? | Expected payment, used for projections. |
| `linkedAccountId` | Account id? | Where payments come from. |
| `autoTrackKind` | enum | `NONE`, `MERCHANT_PATTERN`, `CATEGORY`, `CARD_INSTALLMENT_GROUP`. |
| `autoTrackRef` | text? | The pattern, category, or installment group key. |
| `isClosed` | bool | |

**`PAYROLL_DEDUCTION` is not among the tracking kinds**, and `interestRatePct` is not a field.
Both are D-083, and each was removed for a reason the model already contained. The payroll link
is `deduction_type.linked_debt_id`, which has been on that table since migration `012`: a debt
naming a type while the type names the debt is two edges for one relationship that can point at
different things, the second name D-037 removed from `CategoryRule` and D-066 refused to add to
`FundAccount`. So the **Pays into** select gains a third destination beside a fund and a goal
(D-077) rather than the debt editor gaining a fourth tracking kind. The rate went because v1 has
no amortization engine to read it: a number no code consumes is one a screen will eventually
compute with. It returns with the schedule generator.

The two tracking columns are **one field in the domain** — a discriminated union, so a kind
cannot travel without its ref or with the ref of the kind it used to be. **Built** as the `debt`
table (migration `020`), where the union is also a CHECK constraint: `NONE` has no ref and every
other kind has one (D-084). The principal and the monthly payment share one `currency` column, so
the mixed-currency state `validateDebt` reports is one the document cannot hold.

**Derived:** outstanding balance = `principalAmount` − Σ the principal of its payments.
Because v1 has no amortization engine, the default is to treat the whole payment as principal
and let the user correct it. Flagged in [08 Suggestions and Open Questions](./08-suggestions-and-open-questions.md).

### DebtPayment

| Field | Type | Notes |
|---|---|---|
| `debtId` | Debt id | |
| `date` | LocalDate | |
| `amount` | Money | Total paid. |
| `interestPortion` | Money | The part that did not reduce what is owed. Zero by default. |
| `sourceKind` | enum | `MANUAL`, `TRANSACTION`, `PAYCHECK`, `INSTALLMENT_SLICE`, `FROM_PLAN`. |
| `sourceRefId` | id? | |
| `isConfirmed` | bool | Auto-detected payments start unconfirmed and appear in a review queue. |

**There is no `principalPortion` column** (D-083). Three money fields with an arithmetic relation
between them are two ways for one payment to disagree with itself, and the one subtraction that
matters — outstanding counts down by principal, never by amount — is then performed by whichever
caller remembers to. Principal is `amount − interest`, the format's worked-out `principal_part`
(D-379), and a debt's balance is the totals `debt` declares over it — nothing in the app re-adds them.

`PAYCHECK`, not `PAYCHECK_LINE`: a `PaycheckLine.id` does not survive an edit, because
`updatePaycheck` deletes a slip's lines and writes them again. A payment keyed on one would be
orphaned and recreated by every correction — the exact duplication the invariant below forbids,
produced by the mechanism meant to prevent it. D-075 found this in F07 first; the ref here is
`paycheckId:debtId`.

**Invariant:** one payment per `(debtId, sourceKind, sourceRefId)`. Auto-detection is idempotent
across re-imports, and `paymentSourceKey` is the single definition the review queue, the
repository's upsert and the unique index all read.

**Built** as `debt_payment` (migration `020`), with that invariant as a partial unique index —
`MANUAL` rows excluded, because two identical payments entered by hand on one day are two payments.
The amount and the interest share one `currency` column. A **dismissal** is not a row here: "this
charge is not a repayment on that debt" lives in the `debt.dismissedPayments` `app_setting` keyed by
`paymentSourceKey`, and is read *inside* discovery rather than filtered afterwards, so it removes a
claimant rather than a payment (D-084).

---

## Fixed expenses

### FixedExpense

**Built**, as the `fixed_expense` table (migration `013`).

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `categoryId` | Category id? | |
| `matchKind` | enum | `MERCHANT_PATTERN`, `CATEGORY`, `PAYCHECK_DEDUCTION`, `MANUAL_ONLY`. |
| `matchRef` | text? | No foreign key: three of the four kinds point at different tables and the fourth at none. |
| `expectedAmount` | Money | **The whole charge, not the monthly share.** A yearly premium stores the year's figure; `monthlyShare` amortizes it. |
| `amountVariability` | enum | `FIXED`, `VARIABLE` — utilities vary, rent doesn't. |
| `cadence` | enum | `MONTHLY`, `BIMONTHLY`, `QUARTERLY`, `YEARLY`, `IRREGULAR`. |
| `dayOfMonthHint` | int? | |
| `isDiscretionary` | bool | Fixed and necessary are different axes ([08 Suggestions and Open Questions](./08-suggestions-and-open-questions.md) B1, landed with this table). |
| `source` | enum | `USER_DEFINED`, `DETECTED_CONFIRMED`. A detected bill not yet answered is worked out on read (`billCandidates`), never stored. |
| `isActive` | bool | |
| `startedAt` / `endedAt` | LocalDate? | So a cancelled subscription stops polluting projections. `startedAt` is **also the cadence anchor** — which months a non-monthly charge lands in is counted in whole cycles from it, and one without a start date reports no charge month rather than guessing. |

`matchKind = PAYCHECK_DEDUCTION` is the one value that carries arithmetic rather than
description: that money is already out of net, so subtracting it from net again makes every plan
wrong by its amount. The rule lives in exactly one function, `fixedExpenseBasis`, which is handed
to the splitter as a total rather than as a list to filter (D-053).

**No "also tracked as a debt" flag**, which [F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md)'s
edge-case table might have implied. A `Debt` already carries `autoTrackKind` and `autoTrackRef`,
and a debt tracked by merchant pattern names the same string this row's `matchRef` does — M6
computes the overlap by comparing the two rather than asking the user to maintain a third copy.

### FixedExpenseCandidate

Detector output awaiting confirmation. **Not a table**, and deliberately: it is regenerated from
the ledger every time the screen asks, so storing it would be storing a derived answer that goes
stale the moment a statement is imported. It has no `id` for the same reason. `src/domain/model/fixed.ts`.

| Field | Type | Notes |
|---|---|---|
| `merchantNormalized` | text | Grouped with the **currency**: there is no rate, so a merchant billing in two is two candidates (D-003). |
| `occurrences` | int | Months seen in the lookback window — months, never charges. |
| `months` | list<CandidateMonth> | Period, monthly total, and how many charges made it up. `amounts` in the original sketch; a month with two charges is one month's worth of that bill. |
| `medianAmount` | Money | What gets proposed. |
| `confidence` | enum | `HIGH`, `MEDIUM`, `LOW` — from regularity of date and amount. |
| `suggestedCadence` | enum | |
| `amountSpreadBasisPoints` / `dayOfMonthSpread` | int | The two signals the confidence is made of, kept so the screen can show its working. |

---

## Formats — moved

The declaration tables are the engine's and are in
[`../../04-data-model.md`](../../04-data-model.md). Nothing in this pack references them and they
reference nothing in it — the `fmt_` prefix is what makes that checkable (D-214, D-216).

## Cross-cutting

- **Soft delete.** `deletedAt` on Transaction, Category, CategoryRule, SavingGoal, Debt,
  FixedExpense, Account, FundAccount, ImportMapping, DocumentTemplate. Queries filter it by
  default; a "recently
  deleted" view can restore.
- **Onboarding state** (single-row): which steps are complete, which checklist items are
  dismissed, whether sample data is present. **Built**, as a JSON value under the key
  `onboarding` in `app_setting` (migration 006): `{ step, skipped[], checklistDismissed }`. See
  D-034 for why a key/value table rather than a column per setting, and
  [F12 Onboarding](./f12-onboarding.md) for the flow it records. A document with no such row is
  read as **not onboarding** when it already holds accounts or transactions, and as a fresh first
  run when it is empty — so opening a document written before this existed does not restart
  anybody's setup, and reading never writes.
- **Dismissed fixed-expense candidates.** **Built**, as a JSON value under the key
  `fixedExpenses.dismissed` in `app_setting`: `{ merchants: { "<merchantNormalized>": <when> } }`.
  A candidate is never a row, so "the user said no to this merchant" needed somewhere to live, and
  it went the opposite way from D-049's deduction types for reasons that do not transfer — nothing
  holds a foreign key to a dismissal, it is keyed on a string rather than on anything with an id,
  and it carries no state beyond membership and when. Respected permanently until cleared
  ([F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md)). See D-053.
- **What was already suggested about a merchant.** **Built**, as a JSON value under the key
  `assistant.merchantSuggestions` in `app_setting`:
  `{ merchants: { "<merchantNormalized>": { c, s, n, at } } }` — the category suggested, the
  status (`SUGGESTED`, `DECLINED`, `NO_SUGGESTION`), an optional one-line note, and when. It is
  what the retired F11 AI Assist called the merchant→suggestion
  cache, reached from the plugin instead: without it the backlog hands the same forty names back to the next conversation.
  A setting rather than a table for D-053's reasons, keyed on the normalized merchant like every
  other answer of this shape, capped at 500 notes and cleared by the assignment that answers it.
  See D-104.
- **Audit of overrides.** **Built** as the `category_override` table (migration `010`), one row
  per time the user changes a category by hand from the ledger. It is what powers "learn a rule
  from my correction" in [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md),
  and specifically the only question a transaction cannot answer about itself: how many times
  this merchant has been put in this category.

  | Field | Type | Notes |
  |---|---|---|
  | `transactionId` | Transaction id | The row that was corrected. |
  | `previousCategoryId` | Category id? | Null when the row was uncategorized, which is the common case. |
  | `previousSource` | enum | The `categorySource` it had. Overruling a rule is a different act from filling in a blank. |
  | `newCategoryId` | Category id? | Null when the user cleared the category rather than changing it. |
  | `at` | instant | |

  Three things this table deliberately does **not** hold (D-042):

  - **The merchant.** It is on the transaction, in the normalized form a rule matches, and the
    repeat count joins to it. A copy taken at override time is a second spelling of one fact.
  - **The reason kind.** docs listed it as a field; it is derived by `overrideReason` from
    `previousSource` and the two categories, which are what decide it — `FILLED_BLANK`,
    `REPLACED_RULE`, `CHANGED_MANUAL`, `REPLACED_SUGGESTION`, `CLEARED`. Same reasoning as the
    three `CategoryRule` fields that did not become columns (D-037).
  - **`deletedAt`.** Every user-owned record in the soft-delete list above has one; an audit
    record is not user-owned content, and a record of the past that can be rewritten is not a
    record. Nothing in the app deletes from this table.

  Re-picking the category a row already has writes no row: the assignment still happens (the
  source becomes `MANUAL`), but there is no previous value to audit. The count is of **distinct
  transactions**, so one row talked into a category and back out of it twice is one correction,
  not three.
- **Re-apply runs.** **Built** as `reapply_run` and `reapply_change` (migration `011`), and the
  app's only undo. A run records the scope in the words the panel showed, how many rows moved,
  and when — plus, per row, the category, source and rule it held **before**. See
  [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md) and D-045.

  | Field | Type | Notes |
  |---|---|---|
  | `scope` | text | What the user chose, as displayed. Stored rather than rebuilt: the account it names can be renamed afterwards. |
  | `changedCount` | int | |
  | `undoneAt` | instant? | Null while the run can still be taken back. Set once; there is no redo. |
  | *per change* | | `transactionId`, `previousCategoryId`, `previousSource`, `previousRuleId`. |

  Only the newest un-undone run is offered, and an undo skips any row that has become `MANUAL`
  since — D-009 outranks it. There is deliberately **no general undo**: this is a record of what
  one bulk operation did, not a journal of every mutation.

- **Settings** (single-row): default currency, first day of the financial month, statistics
  basis (charge date vs transaction date), whether to auto-apply rules on import, theme. **"AI
  enabled and key reference" was on this list and is struck** — D-124 removed the remote path and
  the key with it, and D-135 put what replaced them outside the document entirely.
  Not built; when it is, it goes in `app_setting` beside the onboarding
  state rather than in a table of its own. The theme is deliberately *not* document state — it
  belongs to the machine you are reading on, and lives in `localStorage` (D-030). **The chosen
  local model is not document state either, and for a sharper version of the same reason**
  (D-135): a document carried to another machine would arrive naming a runtime and a port that are
  not there. `fc-provider` in `localStorage`, beside the theme and the sidebar collapse.

  **Keys in use.** `debt.dismissedPayments` (D-084), `debt.installmentPromotion` (D-086 — the
  threshold, the switch and the declined groups), `onboarding` (migration `006`, above) and `rules.builtIn` (until M25 U2 folded it into the rule rows, D-268) —
  `{"disabled": ["builtin:…"]}`, which built-in rules this document has switched off (D-046). The
  second is what the key/value shape was for: per-document state about data that lives in the app,
  added without a migration and readable by a build that has never heard of it.

## Open questions

- Should a `Transaction` be allowed to split across several categories (e.g. a supermarket
  receipt that is half groceries, half household)? Discussed in
  [08 Suggestions and Open Questions](./08-suggestions-and-open-questions.md) — recommendation is a `TransactionSplit` child table
  added in M6, designed for now but not built.
- Do internal transfers get one transaction or two (one per side)? Recommendation: two rows
  linked by a `transferGroupId`, both excluded from expense statistics.

## Related

[02 Architecture](../../02-architecture.md) · [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md) · [F01 Card Statement Import](./f01-card-statement-import.md) · [F08 Debts](./f08-debts.md)
