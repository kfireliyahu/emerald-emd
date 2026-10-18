---
type: spec
project: Emerald
---

# 05 — Domain Rules and Calculations

The shared math. If two features disagree about a number, the answer lives here.

**The ledger's, and moved here by M40 U5 (D-438)**: every section is
about transactions, paychecks, the splitter, funds or savings. The engine's own money rule is the
`rule` row *Money is never a number*, and a declared `money` column is two SQL columns
([04 Data Model](../../04-data-model.md)).

## Money

- Represented as **minor units** (agorot) in a signed 64-bit integer, plus an ISO currency code.
- No floating point anywhere in the money path — not in parsing, not in percentages, not in
  charts' underlying values.
- Arithmetic between different currencies throws. Conversion is explicit and requires a rate.
- Display: `₪1,234.56`, thousands separators, currency symbol leading, minus sign leading.
  Negative amounts are also colored; never rely on color alone.
- Rounding for display is half-up at 2 decimals. Rounding for **allocation** uses the
  largest-remainder method so parts sum exactly to the whole.

### Percentage allocation (used by the splitter and by any pro-rata math)

Given a basis amount and a set of percentages: compute each share by integer multiplication
then division by 10,000 (basis points), collect the remainders, and distribute the leftover
agorot one at a time to the largest remainders. Ties break by bucket sort order, so results
are deterministic. If a designated buffer bucket exists, it takes the entire leftover instead.

**Built** as `distribute` and `distributeWithBuffer` in `core/percent.ts`. Plain integers rather
than `Money`, because both callers are integer quantities of different kinds: minor units when
the splitter divides a paycheck, basis points when a dragged slider gives back what it took. Two
edge cases are real and defined: all-zero weights split evenly (a plan whose buckets are all at
0% still has to put the money somewhere), and a negative total splits by magnitude and negates
(the splittable amount goes negative when fixed expenses exceed the basis).

## Sign convention

- `amount` is signed: outflow negative, inflow positive. This one rule prevents the classic
  bug where refunds inflate spending.
- Importers are responsible for normalizing provider conventions to this. Cal and Max both
  present charges as positive numbers in a "debit" column; the importer negates them.
- Statistics that report "spending" use `abs(sum of negative amounts)` and report refunds
  separately rather than netting them silently — but a **net** toggle is available.

## Dates and periods

Three different dates exist and they are not interchangeable:

| Date | Meaning | Used for |
|---|---|---|
| `transactionDate` | when the purchase happened | "when did I buy this" |
| `chargeDate` | when money left the account | cash-flow, bank reconciliation |
| `billingPeriod` | which statement it appeared on | matching the card's monthly charge |

**Default statistics basis: `chargeDate`, falling back to `transactionDate` when null.**
Rationale: the monthly summary should match what left the bank account. A global setting can
switch to `transactionDate`; every stats query takes the basis as a parameter rather than
hardcoding it.

### Financial month

Default = calendar month. A setting allows a custom start day (e.g. the 10th, matching a card
billing cycle). All period math goes through a single `FinancialCalendar` component; no
feature computes month boundaries on its own.

### Billing period derivation

Order of attempts: (1) parsed from the statement preamble; (2) from the account's
`defaultBillingDay` applied to `chargeDate`; (3) the calendar month of `chargeDate`;
(4) null with a warning on the import review screen.

## Text normalization (Hebrew merchant names)

Applied to produce `merchantNormalized`, in this order:

1. Strip Unicode directional marks (RLM, LRM, RLE, PDF) and replace NBSP with a space.
2. Normalize to NFC.
3. Collapse runs of whitespace; trim.
4. Uppercase for Latin text; Hebrew has no case.
5. Strip trailing store/branch numbers and common noise tokens (branch numbers, city suffixes,
   terminal ids) using a maintained token list — kept as data, not code, so it can grow.
6. Strip a leading provider prefix where the provider adds one.

`merchantRaw` is preserved untouched so normalization can be improved and re-run later.

**Fuzzy matching** (for "similar duplicate" detection and merchant grouping) uses normalized
Levenshtein distance with a threshold, plus a same-amount/same-day guard. Fuzzy matching is
never used to auto-assign a category — only to suggest.

## Deduplication

Two levels:

- **Exact duplicate** — same `naturalKey`. Silently marked duplicate, not imported again.
- **Similar duplicate** — same account, same date, same amount, merchant similarity above
  threshold, but a different natural key. Surfaced for user decision; never auto-skipped.

A **file-level hash** short-circuits the whole thing: re-importing a byte-identical file that
was already committed shows "already imported on <date>" with an option to re-run anyway
(useful after improving the parser). *No screen reached that check after M25; its code
(`findPreviousImport`) went in M45 U2, and a re-import is caught row by row, by the natural key.*

### Amended statements

A provider re-issue of the same billing period may correct rows. Handling: rows matching an
existing natural key with a different amount are marked `UPDATED` and shown as a before/after
diff on the review screen. The user's category assignment survives the update.

## Categorization resolution order

Fully specified in [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md). Summary of precedence, first match wins:

1. Manual assignment (never overridden by anything).
2. User rules by `priority` ascending, then by specificity (`EXACT` > `REGEX` > `CONTAINS` >
   `PROVIDER_CATEGORY` > `AMOUNT_RANGE` > `ACCOUNT`), then by creation date, then by id.
3. Rules from past corrections.
4. AI-suggested rules, inert until confirmed.
5. Built-in rules.
6. `Uncategorized`.

**Provider category mapping is not a tier of its own.** It was listed here as one and is not:
those mappings are built-in rules of kind `PROVIDER_CATEGORY`, and the specificity ordering
inside the built-in tier already sorts them below every merchant rule. Identical resolution, one
concept fewer (D-037).

## Paycheck math

- `net` is **entered**, never derived. The slip is authoritative.
- Reconciliation delta = `gross − Σ(lines where reducesNet) − net`. Shown, not enforced.
- **Total compensation** = `gross + Σ(employerAmount)`.
- **Effective savings rate** = (`Σ lines where countsAsSaving` (employee + employer) +
  `Σ saving deposits in period`) ÷ `total compensation`.

  The second term is **contributions only**, and there are two exclusions rather than one, both
  of them the same mistake in different clothes — money in the balance that the user did not put
  there this month. A payslip line linked to a goal is counted by *both* terms, so
  `FROM_PAYCHECK_DEDUCTION` deposits come out of the second (D-077); and an `OPENING_BALANCE` or
  `GROWTH` deposit was never set aside at all, so those come out too (D-081). `isContribution` in
  `src/domain/savings.ts` is the one definition of the second exclusion, and every figure that
  measures effort rather than wealth reads it — the required-monthly rate, the projected
  completion date, the contribution streak and the paid-in-by-month chart.
- **Average net income** over N months: mean of the last N paychecks' net, excluding months
  flagged as irregular (bonus, 13th salary) unless the user opts in. Irregularity is detected
  as >1.5× the median **of the other months** — including the candidate lets a doubled month
  become the median it is being measured against — and confirmed by the user. Only the confirmed
  flag excludes a month; a suspicion the user has not answered still counts, because a figure
  quietly computed over a different set than the one on screen is worse than a skewed one.

All of this is `src/domain/paycheck.ts`, as pure functions. **Rates are integer basis points**,
never floats: 2350 is 23.5%. Money is integer minor units for the reason in D-003, and a rate
computed in floating point and multiplied back against an amount would put the float straight
back into the money path.

## Splitter math

All of this is `src/domain/splitter.ts`, pure over plain values. Given a basis (see
`SplitPlan.basisKind`):

1. Start with the basis amount.
2. Subtract the fixed expenses the plan says come out of net (since D-319 a role per plan and expense: out of net, part of the split, or ignored; this replaced `fixedExpenseMode`) for the period
   (`ESTIMATED` uses detected + confirmed; `CONFIRMED_ONLY` uses confirmed only). The result is
   the **splittable amount**, and it **can be negative** — fixed expenses exceeding the basis is
   shown, never clamped.
3. Apply `FIXED_AMOUNT` allocations first, in sort order.
4. Apply `PERCENTAGE` allocations against **the amount after step 2** — not against the
   original gross, and not against what's left after step 3. This is a deliberate choice;
   it keeps percentages stable when a fixed amount changes. Documented in the UI.
5. The `REMAINDER` allocation, if any, takes what's left — **including when that is negative**.
6. Report the balance: positive = unallocated, negative = over-allocated. Never auto-correct.

**The percentage total is rounded once, not once per bucket.** The group's exact figure
(`splittable × Σ basis points ÷ 10,000`) is rounded half-up, and `distribute` then splits *that*
by largest remainder. This is what makes a plan summing to exactly 100% land on the splittable
amount to the agora rather than two agorot short of it — F05's first acceptance criterion, and
not something per-bucket rounding can deliver.

**A buffer bucket and a `REMAINDER` allocation are different things.** The buffer absorbs the
**rounding** leftover: the agorot floor division threw away, never more than one per other
bucket. A `REMAINDER` absorbs the **balance**: everything the plan did not assign, which can be
thousands. A plan can have one, both, or neither.

**The balance indicator, when a `REMAINDER` exists.** A remainder always drives the balance to
zero, so a plan assigning 130% would otherwise report as perfectly balanced while its remainder
bucket quietly held a negative number. The remainder is therefore judged by **which way it
points**: same sign as the splittable amount means money left to give away, which is what a
remainder is for; the opposite sign means a shortfall no bucket can conjure. That phrasing rather
than "any negative amount", because every share of a negative splittable amount is negative and a
plan that divides it exactly *is* exact — there is nothing over-allocated about having no money.

**Over-allocating is allowed and labelled**, never corrected. Planning to spend savings is a
drawdown and a real thing people do on purpose ([F05 Paycheck Splitter](./f05-paycheck-splitter.md)).

### Locking and redistribution

Dragging one slider gives back what it took, proportionally, among the other **unlocked
percentage** allocations. What is conserved is the sum of that unlocked set — not 100%, because
the app never normalizes a plan to 100%. Locked allocations and fixed amounts never move, and the
consequence is the clamp: when everything else is locked there is nothing to trade with, so the
drag cannot go anywhere and the UI says why rather than the slider snapping back silently.

The redistribution is one `distribute` call — the others must sum to what the pool has left,
proportionally to where they already are, which is exactly what largest-remainder does.

## Fixed-expense detection

Over a lookback window (default 3 months, configurable to 6 or 12). All of this is
`src/domain/fixedExpenses.ts`, pure over rows — the detector never sees a database, and its
fixture is a list of transactions in a test rather than a spreadsheet.

- Group by `merchantNormalized` **and currency**. Two currencies cannot be added without a rate
  (D-003), so a merchant billing in both is two candidates.
- **A month is the unit, not a charge.** Observations are bucketed into months first and the
  median, the spread and the cadence are all computed over monthly totals. Two charges from one
  merchant in one month are one month's worth of that bill, and what a projection plans against
  is what the month costs.
- A candidate requires occurrences in at least `windowMonths − 1` distinct months for `MONTHLY`;
  two for any slower cadence. **One occurrence is never a candidate** — a single charge is
  indistinguishable from a one-off purchase.
- Amount stability: coefficient of variation below 10% → `FIXED`, above → `VARIABLE`
  but still a candidate.
- Date stability: the spread of day-of-month below three days raises confidence, measured with
  wraparound so the 31st and the 1st are one day apart rather than thirty. **The day is the
  purchase's, not the statement's** (M37 F2): the month a row counts in is its charge date (D-006),
  but a card charges every line on one day, so reading the day from it made every shop keep one.
- **The two signals are evidence, not only score** (M37 F2). Every candidate keeps one of them — a
  figure inside the 10% band, or a steady day — so a shop visited every month with neither is never
  offered. **Two months need both, and the figure to the agora**: two statements hold two of every
  shop visited twice, and only the same charge on the same day both times is a bill; anything less
  waits for a third month.
- Non-monthly cadences are read from the **most common** gap (2, 3, 12 months), not from a demand
  that every gap agree: a monthly bill whose March statement was never imported produces gaps of
  1, 1, 2, 1, and calling that irregular would describe the missing file rather than the bill.
  A dominant gap that is not one of the four recognizable cycles is irregular spending, which is
  not a fixed expense.
- Proposed amount = **median**, not mean, so one anomalous month doesn't skew the projection. An
  even count takes the lower middle, so the answer is an amount that actually occurred.
- Confidence is three points — amount stable, date stable, seen every time it was due — with two
  caps: a non-monthly cadence never reaches `HIGH`, and a `YEARLY` reading taken from less than a
  year of data is `LOW`.
- Everything is a *candidate* until the user confirms it. Nothing enters projections unconfirmed
  unless the plan gave it a role (D-319; it was `fixedExpenseMode` `ESTIMATED` before).

**Yearly is effectively undetectable at the windows the app offers**, and that is deliberate
rather than a gap: observing a 12-month gap needs thirteen months of history, and inventing an
annual cadence from a single charge would offer every one-off purchase in the ledger as a fixed
expense. An annual premium is the fixed expense the *user* adds, which is exactly the third user
story in [F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md).

**`proposeFixedExpense` is the same arithmetic with every threshold above dropped, and it is not
detection** (D-191). It answers "the user just pointed at this name and called it a bill — what
should the form say?", so occurrence rules, confidence and the offered list have nothing to do with
it: it returns the median month, the day, the spread and **the cadence only where the gaps read as
one**, `undefined` otherwise. One charge is enough to propose from, because the question the
thresholds protect has already been answered by a person.

### Amortization

`expectedAmount` is the **whole charge**; `monthlyShare` divides it by the cadence's cycle length,
half-up in integers. A ₪1,200 annual premium contributes ₪100 a month, and the month the real
₪1,200 lands in is `isChargeMonth`, counted in whole cycles from `startedAt`.

A single monthly figure cannot also be an exact twelfth — ₪1,000 over twelve months is twelve
times ₪83.33, which is ₪999.96 — so the exact split is `amortizedShares`, largest-remainder with
equal weights, whose parts sum to the whole by construction. The projection uses the single
figure and can sit one agora from a given month's exact share, which is the right trade for a
number whose input is a median.

### The subtraction rule

`fixedExpenseBasis` is the only place that decides what comes off the basis, and the splitter is
handed a total rather than a list to filter. **A `PAYCHECK_DEDUCTION` is never in it**: pension is
already out of net when the payslip is entered, so subtracting it again makes every plan wrong by
its amount. It comes back in its own group so the screen can show it, along with anything
denominated in another currency, because an amount silently dropped from a total is
indistinguishable from one the app forgot.

## Fund math

`domain/funds.ts`, and the whole of it is written against one sentence: **a deposit is never a
gain**. See D-066.

### Expected contributions

Derived from the payslips, never entered. A `PaycheckLine` contributes to a fund when its
`DeductionType.linkedFundAccountId` names one, and lands in one of three components:

- A line whose type is of kind `SEVERANCE` is **severance**, whichever of the two amount columns it
  was typed into.
- Any other linked line contributes its `employeeAmount` to **employee** and its `employerAmount`
  to **employer**.

One record per fund per payslip, so two slips in one month stay two facts. `paycheckCount` travels
with every total: zero payslips and zero shekels are different answers, and everything downstream
branches on which one it is.

### The lag, and why the comparison is cumulative

A deduction on the January slip reaches the fund in February. So a fund's reported deposits for
months `[A..B]` are compared against the salary months `[A−lag..B−lag]`, with `lag` defaulting to
**one month** and configurable. The window is the **longest trailing run** of snapshots that each
state `depositsSincePrevious`, summed — cumulative rather than month-by-month, because at a
one-month lag every individual month looks wrong while the running total stays right. A
reconciliation that cries wolf monthly is one the user stops reading.

A snapshot dated mid-month loses the part-month at the start of the window. That is the price of
comparing a monthly payroll against a quarterly report, and it is not hidden: the months counted
come back in the result and the screen prints them.

`depositPeriods` gives the same arithmetic **one window at a time**, as the working behind the
cumulative verdict rather than as a second verdict — the rows sum to it. A single row is not a
judgement: one window is exactly the month-by-month comparison the lag makes unreliable. A window
with no payslips behind it (`paycheckCount === 0`) has no expected figure and shows nothing, never
a zero.

Tolerance is 2% of what was expected or ₪25, whichever is larger, and the band comes back as an
amount so the screen can say why it stayed quiet.

### Returns

`gain = (closing balance − opening balance) − contributions`, and the contributions are a **required
parameter**, not an optional one. The basis is the fund's own `depositsSincePrevious` where it
exists — it covers exactly the window the two balances bracket, so **no lag applies to it** — and
the lag-shifted payslip total otherwise. A dormant fund's zero is a fact; an active fund with
neither source produces no figure at all rather than a balance delta.

The rate is Modified Dietz with contributions assumed to arrive evenly:
`gain ÷ (opening balance + half the contributions)`. Approximate, and labelled so. `gain` is net of
fees because that is what the balance shows; `gainBeforeFees` appears when the report states what
was charged.

### Fees

- **Effective fee** = `fees charged × 12 ÷ (average balance × months)`, in basis points, measured
  over the most recent window. The average balance is the mean of the two endpoints. A window
  shorter than a month is refused rather than annualized. It is only reported as differing from the
  stated fee at **0.1% a year or more** (`FEE_DISCREPANCY_BASIS_POINTS`): a quarter's fees carry a
  quarter's rounding, and the case worth raising — an agreement that lapsed to a default — moves
  the figure by tenths of a percent, not hundredths.
- **Annual cost** of a balance = `balance × feeOnAccumulationBasisPoints`. This is the dormant-fund
  number.
- **Fee drag** projects year by year in integers: the contribution arrives net of the deposit fee,
  and the year's net return (gross minus the accumulation fee) applies to the opening balance plus
  **half** the contribution — the same mid-period assumption the return uses, so the projection and
  the measurement do not disagree. Always computed across a **range** of assumed gross returns
  (3% / 5% / 7% by default), never one, and every assumption comes back with the answer. The
  compounding itself is `projectBalance` in `domain/projection.ts`, which takes the two fees as
  plain basis points — the balance fee and the contribution fee — because F07's savings projection
  needs the same arithmetic without a pension attached (D-072).
- **The contribution rate** a projection starts from is the last **twelve** salary months of
  expected contributions, scaled by the months that actually carry a payslip. Not the last month
  (which either misses a 13th salary or is entirely one) and not the calendar span (a month with no
  slip is a month the app was not shown, and dividing by it would halve the rate).

### Not enough data

`reconcileDeposits`, `fundReturns` and `effectiveFee` all return a discriminated union whose first
member is `NEEDS_TWO_POINTS`. One snapshot yields a balance and nothing else — never a 0% return
and never a ₪0 fee.

## Savings math

`domain/savings.ts`, written against two sentences: **a balance is never handed in, only
computed**, and **liquid is a property of the place**. See D-074.

### Balances

`balance = Σ deposits`, withdrawals being negative deposits. No function in the module takes a
balance as a parameter, so there is no signature that can carry a stale one — the shape
`fixedExpenseBasis` (D-053) and `periodReturn` (D-066) already have. Deposits in another currency
are listed, never converted (D-003), because a total that silently dropped one would disagree with
the deposit list beside it.

`liquid + locked === total`, always. Every place falls into exactly one side, a place the document
does not have counts as **locked** — the direction that understates rather than overstates
reachability — and F13's fund balances are added to `locked` rather than sitting outside the
total.

### Progress

- **Required monthly** = `shortfall ÷ months remaining`, rounded **up**, with the months counted
  **inclusive of the current month**. A goal due this month therefore asks for the whole shortfall
  rather than dividing by zero, and only a date genuinely in the past reaches zero — which reports
  `OVERDUE` rather than a negative figure.
- **Projected completion** runs at the net contribution rate of the last three months, the current
  month included. A rate of zero or less is its own answer carrying the rate, never a date.
  Anything beyond fifty years is refused as a date and reported as a count.
- **The streak** counts consecutive months with a **positive** deposit and is allowed to end at
  last month, since on the third of the month a user who pays in on the fifteenth has broken
  nothing. A withdrawal never holds a streak open.

### How much should be in the bank

`target = months × one month's expenses`, where the months are integer basis points of a month
(45,000 is 4.5) and the monthly figure is either `fixedExpenseBasis(...).total` — the floor, with
payroll deductions already excluded — or total spending, the comfortable figure. **Both are always
computed at the same multiplier**; which one the multiplier applies to is the user's choice and
the other is shown beside it, because a number with an unexplained basis is one nobody can check.

**The target is compared against liquid money only**, and there is no variant of the result
carrying a total balance. An emergency goal's ordinary progress figures use the same liquid
balance, so the ring and the panel cannot disagree: a pension or a locked deposit must never count
towards an emergency fund.

### What savings become

`projectBalance` (D-072), **per holding** at that holding's own rate — a goal spread across a
פק"מ and an index fund compounds at two rates, not at an average. Per *place* until D-175, which is
the same call over a finer grain: one bank's cash and its fixed deposit stopped being averaged into
a rate that describes neither. Holdings with no rate recorded are projected **flat** and named, so
the screen can ask for the number rather than assume one.

Three scenarios, never one line. The adjustment applies **only to `ASSUMED` rates**: a
contractual rate is what the bank agreed to and does not move between columns, which is the whole
reason the basis is stored beside the number. Rates are clamped to ±20% a year, which is an
arithmetic guard rather than an opinion — a mistyped 500% over twenty-five years leaves the
safe-integer range and `money` throws.

## Statistics definitions

Precise definitions so charts and tables never disagree:

- **Income (month)** = Σ paycheck `net` for the period + Σ transactions with `direction = INFLOW`
  that are not transfers and not excluded.
- **Expenses (month)** = |Σ transactions with `direction = OUTFLOW`|, excluding transfers,
  excluding `isExcludedFromStats`, on the configured date basis. **The rule is declared**, as the
  ledger's `transaction.spending` rollup, and the Statistics screen reads its filters (M36 U04,
  D-380): not left out by the person or a card settlement, not held,
  not Money moved — plus what only code says, a row a person's format links or a paired transfer.
- **Balance (month)** = Income − Expenses. Savings deposits are *not* subtracted here; they are
  shown as a separate "of which saved" figure, because saving is not spending.
- **Category totals** roll subcategories into their parent, with a toggle for the flat view.
- **Year totals** sum monthly figures on the same basis. A partial current month is labeled as
  such and excluded from averages.
- **Uncategorized** always appears as its own visible slice. Never hide it — hidden
  uncategorized spending is how these apps lose trust.

## Invariant checks worth testing

- Importing a file twice produces the same ledger as importing it once.
- Sum of installment slices equals the original purchase total.
- Splitter allocations sum exactly to the basis when a remainder or buffer bucket exists.
- Deleting a category never orphans a transaction.
- Every transaction with `categorySource = RULE` can name its rule.
- Monthly totals for a year sum to the yearly total, on any date basis.
- A fund balance that rose by exactly the contributions paid into it shows a return of zero.

## Related

[04 Data Model](../../04-data-model.md) · [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md) · [F05 Paycheck Splitter](./f05-paycheck-splitter.md) · [F10 Statistics and Reports](./f10-statistics-and-reports.md)
