---
type: feature
project: Emerald
milestone: M4
status: built
---

# F05 — Paycheck Splitter

A playground for deciding where the next net paycheck goes. Percentages or amounts, into
buckets the user defines: monthly expenses, short-term savings, long-term savings, debt
payments, or anything else.

This is the app's forward-looking half. Everything else describes the past.

## User stories

- As a user, I drag a slider and instantly see how much that is in shekels.
- As a user, I mix percentages and fixed amounts in the same plan.
- As a user, I choose whether my known fixed expenses come off the top before I split.
- As a user, I lock the buckets I've decided on and redistribute only the rest.
- As a user, I save "Default" and "Bonus month" as separate plans.
- As a user, I compare my plan to what actually happened last month.

## The basis

The amount being split. Selectable:

| Basis | Meaning |
|---|---|
| `LAST_PAYCHECK` | Net of the most recent paycheck. |
| `AVERAGE_LAST_N` | Mean net of the last N months, bonus months excludable. |
| `SPECIFIC_PAYCHECK` | Pick one. |
| `CUSTOM_AMOUNT` | Type a number — for "what if I earned X". |

Then, optionally, subtract fixed monthly expenses ([F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md)) with mode
`NONE` / `ESTIMATED` (confirmed + detected) / `CONFIRMED_ONLY`. The screen shows both the
gross basis and the post-subtraction **splittable amount**, with the subtraction itemized on tap.

## Buckets

A bucket is a destination. Its `targetKind` determines what happens when a plan is applied:

| Target kind | Example | On apply |
|---|---|---|
| `CATEGORY` | "Groceries" | Sets/updates the category's monthly target. |
| `SAVING_GOAL` | "Emergency fund" | Suggests a deposit of that amount. |
| `DEBT` | "Car loan" | Suggests a payment of that amount. |
| `FIXED_EXPENSES` | the aggregate | Auto-sized from F09; read-only amount. |
| `FREE` | "Fun money" | Pure plan, no side effect. |

Buckets have colors and an order; exactly one may be the buffer that absorbs rounding.

**Buckets are shared across plans**, not owned by one (D-056). "Default" and "Bonus month" are
the same destinations at different percentages, which is what makes them comparable — and what
plan-vs-actual will need. A plan owns its allocations, not its buckets.

**All five target kinds are in the schema, and since M6 the screen offers all five.**
`SAVING_GOAL` joined when F07 gave it a table (D-077) and `DEBT` when F08 did (D-106). The
vocabulary shipped whole because a `CHECK` constraint cannot be altered in SQLite without
rebuilding the table and migrations are immutable, while a control that should not be offered yet
is one screen edit — which is exactly how it played out.

**A `DEBT` bucket writes since schema 27** (D-190). `debt_payment.source_kind` gained `FROM_PLAN`
and the payment is upserted per plan, per month, per bucket — `applyPlanPayment`, the same shape and
the same key as the deposit on the savings side. The apply panel's "buckets I am not writing"
paragraph is gone with the last kind that needed it.

## Allocation modes

- **`PERCENTAGE`** — of the splittable amount.
- **`FIXED_AMOUNT`** — an absolute figure.
- **`REMAINDER`** — takes whatever is left; at most one per plan, enforced by a partial unique
  index. **Not the same thing as the buffer bucket**: a `REMAINDER` absorbs the *balance*, which
  can be thousands; the buffer absorbs the *rounding*, which is never more than an agora per
  bucket. A plan can have one, both, or neither.

Percentages are computed against the splittable amount, **not** against what remains after
fixed-amount buckets. This keeps a percentage stable when an unrelated fixed amount changes.
The UI states this in one line so it never surprises anyone. See
[05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md) for the exact allocation and rounding algorithm.

## Locking and redistribution

Each allocation can be locked. When the user drags an unlocked slider, the change is
redistributed proportionally among the other **unlocked percentage** allocations. Locked
allocations and fixed amounts never move. ~~If everything else is locked, the drag is clamped
and the UI says why.~~

**Corrected in M4 (D-059):** the others give way *while they have anything left to give*, and once
they are at zero the drag keeps moving and the plan over-allocates. Clamping to the pool made a
plan's current total a ceiling nobody could raise — three buckets summing to 49% left every one of
them stuck below 49, for ever, and the way in was ordinary. It also contradicted this note's
stronger rule below: the app never normalizes a plan to 100%, and a conserved sum is a
normalization with a different number. The only clamp is 0 and 100% of the basis, which is what a
slider can express; the balance indicator says the rest.

## The balance indicator

Always visible, always honest:

- **Unallocated** — positive remainder, shown in neutral color with "assign to…" shortcut.
- **Over-allocated** — negative, shown in warning color with the exact overage.
- **Exact** — green.

The app never silently normalizes percentages to 100%. Users deliberately plan to under- or
over-allocate while they think.

## Applying a plan

**Built** (D-058), with one thing this section could not know when it was written: in M4 the only
target a plan could write was a category's monthly target. Since F07, a `SAVING_GOAL` bucket
**proposes a deposit** and accepting it records one — upserted per plan, per month, per bucket, so
applying twice moves the figure rather than doubling it (D-077). Since schema 27 a `DEBT` bucket
**proposes a payment** and accepting it records one, keyed the same way (D-190) — so all three
target kinds that name something now write, and the panel's "not yet written" list is gone.

**What a debt bucket says that a goal bucket cannot need.** If the document already discovers
payments for that debt — a merchant pattern, a category, an installment group, or a payroll link on
a deduction type — then accepting writes a *second* row for one movement of money, and a debt
balance is the sum of its rows. The row says so and still accepts: an extra payment off a tracked
mortgage is a real thing, and nothing in the document distinguishes it from the mistake. The same
trade the savings side already makes appears in **How it went**: a plan payment is a payment, so the
bucket it came from reads as on-plan whether or not the money moved.

**Which plan a month is on is a `plan_month` row** (M31 U4, D-370): *Months on this plan* on Plan
is twelve checkboxes, and a month nobody gave a plan is on the default. A month keeps its plan when
the plan is edited. What "Apply to <month>" used to do besides is **the record line**: while the
month on screen is on the plan and a bucket points at a goal or a debt, one line says what it
would record, and nothing is recorded until the person says so — consistent with the
confirmation-queue principle in [06 Navigation and Screens](./06-navigation-and-screens.md). A
plan whose buckets point at categories records nothing and shows no line: a category's budget is
its bucket (D-327).

## Plan vs actual

**Built in M6** (D-106), and **always on Plan since M31 U4** (D-370): *Against* picks the month,
the last whole month until one is chosen, and the bar fills each bucket in its top line's colour up
to what it got, with a *Got in <month>* column in the table. Planned versus actual per bucket, over
any of the last thirteen months. `CATEGORY` reads the month's rolled category line out of
`monthlyReport`, the same call the insights screen makes, so the two screens cannot disagree;
`SAVING_GOAL` reads contributions (`isContribution` — an opening balance and a market gain are not
saving); `DEBT` reads the payments recorded that month; `FIXED_EXPENSES` reads `split.fixed`.

Three rules the screen holds to, all of them the same rule seen from different sides:

- **A `FREE` bucket, or one whose target is gone, is not compared and is not scored at zero.** It
  appears in the table saying nothing records it, and it is left out of both headline figures —
  which is what lets one be subtracted from the other.
- **A measured zero is kept.** A category nothing was filed under really did cost nothing, and that
  is the most interesting line on the screen.
- **A month with no imported statement leaves the ledger-backed rows out entirely**, and the panel
  says so. Deposits and debt payments need no statement and still count.

There is **no verdict in colour and no tolerance band**: over on groceries and over on the
emergency fund are opposite news and this screen does not know which is which, so it draws a
number, a bar and a word.

## Screens

> **Superseded by D-319 (M28 U7):** the splitter and the fixed expenses are one page, `#/plan`; what a fixed expense does to a plan is a role per plan, the `FIXED_EXPENSES` bucket kind is gone, a divider trades between neighbours. What follows is the history.

**Built as `#/plan/splitter`** (D-057), with three of the four merged into one place:

- **Splitter** — basis selector at top, splittable-amount card, **a line saying what the fixed
  expenses come to and where they go**, the bucket list with per-row percentage input, amount
  input, slider, lock toggle; the stacked bar; balance indicator pinned; save / save-as / apply.
- **The bar is a control** (D-174). A handle on the trailing edge of every movable segment resizes
  that bucket — the difference goes to the balance, because this screen never normalizes — and the
  handles are sliders, so the arrows move them (1% a press, 10% with Shift). A `REMAINDER` has no
  handle: it is *defined* as what is left. A right-click splits a slice in two, through the app's
  one context menu (D-173), and the plan's total is unchanged by the split.
- **Where the fixed expenses go is a property of the plan** (`fixedInSplit`, D-174): off the top
  before the percentages, or **into the split as a share** of the whole net. The same money, and a
  different meaning for every percentage — which is why it is stored rather than remembered per
  browser. Drawn as a striped segment rather than a coloured one, because it is not a bucket.
- **Bucket editor** — name, target kind and target, color, buffer flag. *A popover on the
  splitter, not a route. Offers four target kinds, not five — `DEBT` has nothing to point at until
  M6, and a select with no options is a dead control.*
- **Plans list** — saved plans, default marker, duplicate, delete. *A select in the toolbar with
  the actions beside it. Plans are a handful, not a place.*
- **Plan vs actual** — per-month comparison table with variance bars. *A panel on the splitter with
  its own month picker (D-106), not a route: it is a second view of the plan already on screen.*

**There is no Save button, and that is deliberate.** Every edit is written to the document as it
is made. A plan is a thing you fiddle with — drag a slider, look at the number, drag it back —
and there is no moment where a half-edited one is invalid. Getting it to disk is the document's
job and not this screen's, as everywhere else in the app — and since D-155 that job is the app's
too: the dirty dot reports *saving… / saved* rather than asking, wherever there is a file to write
to. `Ctrl+S` still works and still means the same thing.

**The slider and the percentage field are one control with two faces.** Both go through
`redistribute`, so dragging and typing cannot disagree about what happens to the other buckets.

**50/30/20 is offered on the empty state.** An empty splitter is the hardest screen in this app to
begin: it asks how you want to divide your money and offers no picture of an answer. The copy
calls it a starting point rather than advice, and every number is a slider once it lands. **It lands
on the person's top-level categories** (D-369): each share divided by what went out under each, so
the first plan is already a budget; a heading of their own is asked about once.

## Data touched

Creates/updates: `SplitPlan`, `SplitBucket`, `Allocation`.
Reads: `Paycheck`, `FixedExpense`, `Category`, `SavingGoal`, `Debt`, monthly statistics.
On apply (after confirmation): `SavingDeposit`, `DebtPayment`, `Category.monthlyTargetAmount`.

## Edge cases

| Case | Behavior |
|---|---|
| No paycheck recorded yet | Basis is the salary that came in, and says so (D-369); with no salary deposit either, a prompt to type an amount. |
| Fixed expenses exceed the basis | Splittable amount is negative; shown explicitly, not clamped to zero. |
| Percentages sum over 100% | Allowed; balance shows the overage. |
| Rounding leftovers | Largest-remainder distribution, or all to the buffer bucket if one exists. |
| Bucket target archived/deleted | Bucket becomes `FREE` with a warning badge; the plan still works. |
| Applying the same plan twice to one month | Second apply diffs against what already exists and only suggests the delta. |
| Editing a plan after applying it | Allowed; the months it is on keep it (M31 U4). |

## Acceptance criteria

- [x] Allocations always sum exactly to the splittable amount when a remainder or buffer exists.
  *`distribute` is largest-remainder and the percentage group is rounded **once** rather than once
  per bucket, which is what makes a plan at 100% land on the splittable amount to the agora.*
- [x] Dragging a slider with three locked buckets never changes a locked value. *`redistribute`
  trades only among the unlocked percentage allocations; when there are none the drag is clamped
  and says so, rather than the slider snapping back silently.*
- [x] Plan-vs-actual figures match the numbers shown in [F10 Statistics and Reports](./f10-statistics-and-reports.md) for the same
  month and category. *By construction rather than by agreement: `bucketActuals` reads
  `monthlyReport`, the same call the insights screen makes, instead of a query of its own (D-106).*
- [ ] The screen stays responsive with 20 buckets. *Built and not measured. Every edit is one
  `updateSplitPlan` and one re-read of a plan whose allocations are a handful of rows; the
  performance pass that would claim this ran in M6.5 (D-118) and did not cover this screen —
  `src/data/scale.test.ts` measures the ledger and the reports, not a plan with 20 buckets.*

## Open questions

- ~~Should a plan be able to allocate more than the paycheck (planning to use savings)?~~
  **Settled as recommended** (D-056): allowed, never corrected, and reported as `OVER_ALLOCATED`
  for the screen to label a drawdown.
- ~~Should percentages be of net or of gross?~~ **Settled: net**, and by construction rather than
  by choice — every `basisKind` resolves to a net figure, and `averageNet` is the only thing that
  answers `AVERAGE_LAST_N`. Gross as a display-only secondary figure is not built and has no
  consumer asking for it.
- ~~Templates like 50/30/20 as a starting point~~ **Built** (D-057), on the empty state, beside a
  "start empty" for anyone who already knows what they want.

## Related

[F04 Paycheck Tracking](./f04-paycheck-tracking.md) · [F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md) · [F07 Savings and Deposits](./f07-savings-and-deposits.md) · [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md)
