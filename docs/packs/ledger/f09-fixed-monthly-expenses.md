---
type: feature
project: Emerald
milestone: M4
status: in progress
---

# F09 — Fixed Monthly Expenses

The recurring bills that leave every month regardless of behavior: rent, utilities, insurance,
subscriptions, municipal tax, standing orders. The user defines them, or the app detects them
from history and asks. They feed [F05 Paycheck Splitter](./f05-paycheck-splitter.md) as the amount that comes off the top.

## User stories

- As a user, the app looks at my last few months and tells me what my fixed expenses are.
- As a user, I confirm or dismiss each suggestion rather than having it assumed.
- As a user, I add a fixed expense the app couldn't see (an annual insurance premium).
- As a user, when I plan my paycheck split, I choose whether fixed expenses come off the top.
- As a user, I see when a fixed expense changed amount — my electricity bill went up.

## Detection

Runs over a lookback window (default 3 months, configurable to 6 or 12), grouping by
`merchantNormalized`. Full algorithm in [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md); the essentials:

- Requires occurrences in at least `windowMonths − 1` distinct months, **and evidence of a bill**
  (M37 F2): a steady figure or a steady day of the month — the purchase's, not the card's charge
  date — and, from only two months, the same figure to the agora on the same day.
- Confidence comes from two independent signals: **amount stability** (coefficient of variation)
  and **date stability** (spread of day-of-month).
- Proposed amount is the **median**, so one anomalous month doesn't distort the projection.
- Variable-amount recurrences (electricity, water) are still candidates, marked `VARIABLE`.
- Non-monthly cadences (bimonthly water bills, quarterly, annual insurance) are detected from
  regular gaps, with fewer occurrences required and lower confidence.

The detector produces `FixedExpenseCandidate` records that are **regenerated on demand**, never
persisted as truth. Only confirmation creates a `FixedExpense`.

**Built**, as `src/domain/fixedExpenses.ts` — pure functions over rows, tested before a screen
exists, with the whole algorithm and the calls it required written up in
[05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md). Three things there are
worth knowing before reading this note's screens: a **month is the unit** rather than a charge, a
**single occurrence is never a candidate**, and a **yearly cadence is therefore undetectable** at
any window the app offers — seeing a 12-month gap needs thirteen months of history. The annual
insurance premium in the user stories above is the *user-defined* path, and always was.

**The user-defined path has a second door since D-191**: a name in the labeling queue can be
promoted to a fixed expense, seeded by `proposeFixedExpense` — the same arithmetic with the
detector's thresholds deliberately dropped, because the user has already answered the question they
protect. It is `USER_DEFINED` for that reason, and where the gaps read as no cadence it proposes
none rather than defaulting to monthly.

**Note on the 3-month default:** the original requirement said "let the app infer from the
latest 3 paychecks". Three months is the minimum that can distinguish recurring from
coincidental, and it will miss anything non-monthly. Default to 3 with a visible control to
widen to 6 or 12, and label annual items as low confidence until a full year of data exists.

## Definition of a fixed expense

| Field | Purpose |
|---|---|
| `matchKind` + `matchRef` | How future occurrences are recognized: merchant pattern, category, or a paycheck deduction. |
| `expectedAmount` | What the projection uses. |
| `amountVariability` | `FIXED` (rent) vs `VARIABLE` (electricity) — drives whether a change is an alert or normal. |
| `cadence` | Monthly / bimonthly / quarterly / yearly / irregular. |
| `startedAt` / `endedAt` | So a cancelled subscription stops appearing in projections. |
| `source` | User-defined, detected-confirmed, or detected-pending. |

Non-monthly cadences are **amortized** for the monthly projection: a ₪1,200 annual premium
contributes ₪100 to the monthly fixed total, and the actual charge month is shown separately so
the user knows when the real hit lands. This is the right default — planning against a monthly
average is the whole point — but the screen shows both figures so it never feels like a lie.

## Variance tracking

Once a fixed expense exists, each new matching transaction is compared against
`expectedAmount`:

- Within tolerance → silently recorded, `expectedAmount` optionally rolls to the new median.
- Outside tolerance (default 15%, higher for `VARIABLE`) → surfaced: "Electricity was ₪612 this
  month, ₪430 average." Informational, not alarming.
- Missing for a period → surfaced: "No rent payment found in July." A missing fixed expense is
  usually a missing import, which is worth knowing — but only for the match kinds the ledger can
  actually answer. See "silence means two different things" under Screens.

## Interaction with the splitter

> **Superseded by D-319 (M28 U7):** `fixedExpenseMode` is gone; each fixed expense has a role per plan (out of net, part of the split, ignored) and there is no `FIXED_EXPENSES` bucket. `#/plan/fixed` redirects to `#/plan`.

The splitter's `fixedExpenseMode` controls what is subtracted:

- `NONE` — split the whole net.
- `CONFIRMED_ONLY` — subtract only user-confirmed fixed expenses. Conservative.
- `ESTIMATED` — subtract confirmed plus detected-pending candidates. Gives a realistic picture
  before the user has done the confirmation work.

The splitter also exposes an automatic `FIXED_EXPENSES` bucket whose amount is read-only and
sourced here — satisfying "app would estimate monthly expenses and show it in the split
automatically as a percentage of the paycheck". Its percentage of net is displayed prominently,
since "my fixed costs are 62% of my take-home" is one of the most useful single numbers the app
can produce.

## Screens

**Built as `#/plan/fixed`** — one screen rather than the four listed here, and the merges are
D-055's:

- **Fixed expenses** — confirmed list with per-item amount and cadence; monthly total and its
  percentage of average net at the top; a "Detected" section with candidate cards showing
  occurrences, amount history sparkline, and confidence. *A payroll deduction gets a figure of its
  own beside the total that is never in it.*
- **Candidate review** — confirm (with editable amount and cadence), or dismiss. Dismissing *is*
  "never suggest this merchant" and is undoable; the two were one action all along (D-053). *On
  the card rather than behind it: the evidence is what the user is being asked to agree with.*
- **Fixed expense editor** — all fields, plus a history list of matched transactions.
- **Variance view** — this month's fixed expenses vs expected, with deltas. ***A column, not a
  screen.*** One number per row belongs beside the amount it is a delta from.

**Everything on the screen is about the last complete month**, and it says so. Ending at today
would mean a partial month dragging every coverage figure down and, worse, every monthly bill
reporting as missing for the first days of each month. docs/05 already excludes a partial month
from averages.

**Silence means two different things**, and the variance status tells them apart. A merchant the
ledger watched and did not see is `MISSING` and wears the problem colour, because that usually
means a statement nobody imported. A `PAYCHECK_DEDUCTION` or a `MANUAL_ONLY` is `NOT_TRACKED`:
nothing in the ledger can ever match it, so its absence is not news. Collapsing those two was a
real bug, and it took looking at the screen to find it.

## Reachable from a conversation too

**Built (D-111).** The plugin has `fixed_expense_candidates`, `track_fixed_expenses` and
`dismiss_fixed_expense_candidates`, all of them wrappers: the same `detectFixedExpenses` over the
same `listExpenseObservations`, with the same two exclusion lists, so the candidates a conversation
reads are the ones the screen shows rather than a second opinion about the same ledger.

**A candidate has no id, and that shaped the surface.** It is regenerated on every call and never
stored, so every one of those tools names a **merchant** — the thing that persists. The batch is
re-detected at commit time for the same reason `mutatingCall` recomputes every plan: a merchant
that stopped being a candidate between the two calls gets an honest answer instead of a confirmation
from a memory of it.

**The two answers are two tools, because they deserve different safeguards.** Confirming writes a
standing commitment that the splitter subtracts from every plan afterwards, so it dry-runs and takes
a `.bak`. Dismissing writes one `app_setting` key, touches no row, and is undone by its own
`restore` argument, so it writes immediately — the weighing `note_merchant_suggestions` made
(D-104). One tool taking both would have to impose one shape on the write that deserves the other.

**What the conversation had to be told, and the screen did not:** a window cannot see a cadence
longer than itself, so a three-month lookback is structurally blind to an annual premium. The screen
has the window as a visible control beside the list; a tool answer has to say it, so both the empty
answer and the short-window answer do.

Confirming a `PAYCHECK_DEDUCTION` or a `CATEGORY` match is still app-only — the plugin writes
`MERCHANT_PATTERN` and `MANUAL_ONLY`, which are the two a conversation has the evidence for.

## Data touched

Creates/updates: `FixedExpense`. Generates: `FixedExpenseCandidate` (transient).
Reads: `Transaction`, `Category`, `PaycheckLine`, `Paycheck` (for the percentage-of-net figure).

## Edge cases

| Case | Behavior |
|---|---|
| Merchant appears twice in one month | Not automatically disqualifying; cadence detection handles "twice monthly". |
| Amount changes permanently (rent increase) | Variance alert, then a one-tap "update expected amount". |
| Subscription cancelled | Missing-occurrence alert, then "mark as ended" which sets `endedAt`. |
| Annual expense, less than a year of data | Detected with `LOW` confidence and clearly labeled as such. |
| Dismissed candidate reappears next month | Respect the dismissal permanently unless the user clears it. Stored under the `app_setting` key `fixedExpenses.dismissed`, not as a table (D-053). This makes "dismiss" and "never suggest this merchant" **one action**, not the two the Screens section lists. |
| Fixed expense also tracked as a debt | Allowed, but excluded from the fixed-expense total to avoid double subtraction in the splitter — flagged in the UI. |
| Paycheck-deduction fixed expenses | Already removed from net; must **not** be subtracted again. Enforced by `matchKind`. |

That last row is the most dangerous bug in this feature: subtracting a payroll deduction from
net twice makes every plan wrong. It deserves an explicit test.

## Acceptance criteria

- [x] Detection over a known 6-month fixture finds the seeded recurring merchants and nothing else.
  *`fixedExpenses.test.ts` — rent, a variable electricity bill and a bimonthly water bill are
  found; a one-off sofa, a coffee habit with a four-month gap, a refund and a subscription that
  ended before the window opened are not.*
- [x] Amortized non-monthly expenses contribute the correct monthly share, and the annual total
  matches the sum of monthly contributions. *`amortizedShares` is largest-remainder with equal
  weights, so the parts sum to the whole by construction; `monthlyShare` is the single projection
  figure and is tested to sit within one agora of every exact share.*
- [x] No expense is ever subtracted twice from the splitter basis. *The explicit test the note
  below asks for, and a real one: the same ₪1,500 pension is followed through `netReducingTotal`
  and through `fixedExpenseBasis` at once, and the assertion names what the wrong answer would
  have been.*
- [x] Confirming a candidate is idempotent. *`confirmCandidate` looks up `(MERCHANT_PATTERN,
  merchant)` and updates rather than inserting — enforced in the repository rather than by a
  unique index, because one merchant legitimately billing for two things must stay possible.*

## Open questions

- Should confirmed fixed expenses auto-update `expectedAmount` as amounts drift, or always ask?
  Recommendation: auto-update within tolerance, ask outside it. **Still open** — `monthVariance`
  computes the tolerance answer the decision needs, and nothing writes back yet.
- ~~Should the app distinguish "fixed" from "necessary"?~~ **Settled.** `isDiscretionary` ships on
  the table (migration `013`), as [08 Suggestions and Open Questions](./08-suggestions-and-open-questions.md)
  B1 recommended. It has no editor until the fixed-expense screen lands.

## Related

[F05 Paycheck Splitter](./f05-paycheck-splitter.md) · [F02 Category System](./f02-category-system.md) · [F06 Bank Statement Import](./f06-bank-statement-import.md) · [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md)
