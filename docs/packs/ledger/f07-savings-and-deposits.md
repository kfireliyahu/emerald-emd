---
type: feature
project: Emerald
milestone: M5
status: built — domain, schema and screens
---

# F07 — Savings and Deposits

Two related tabs: **savings goals** (what I'm saving for, and how much) and **deposits**
(the individual contributions, and where the money physically sits).

## User stories

- As a user, I define a goal with a name and a target amount.
- As a user, I record each deposit I make and say where it went — investment account, checking,
  a fixed deposit.
- As a user, I see progress toward each goal and how much per month I need to hit my date.
- As a user, my pension and study-fund payroll deductions count toward savings without me
  entering them twice.
- As a user, I see how much of my money is liquid versus locked away.

## Goals

A `SavingGoal` has a name, an optional target amount, an optional target date, a kind
(emergency / short-term / long-term / retirement / earmarked), a default **holding**, and a
priority used by [F05 Paycheck Splitter](./f05-paycheck-splitter.md).

**Balance is always derived** — the sum of deposits minus withdrawals. Never stored. A stored
balance would drift the first time a deposit is edited, and drift in a savings number destroys
trust faster than any other bug in this app.

*That is now a signature rather than a rule to remember (D-074): no function in
`domain/savings.ts` takes a balance, every one of them takes deposits and sums them, and the
summation itself is private — so there is no version of this arithmetic that can carry a stale
figure.*

Derived figures per goal:

- Current balance, and percentage of target.
- Required monthly contribution = (target − balance) ÷ months remaining to target date.
- Projected completion date at the current 3-month average contribution rate.
- Contribution streak / months with no deposit.

## Deposits

A `SavingDeposit` is an amount on a date into a goal, in a **holding**, with a source:

| Source kind | Created by |
|---|---|
| `MANUAL` | User entry. |
| `FROM_TRANSACTION` | User marks a transaction as a savings transfer. |
| `FROM_PAYCHECK_DEDUCTION` | A `DeductionType` linked to a goal ([F04 Paycheck Tracking](./f04-paycheck-tracking.md)). |
| `FROM_PLAN` | Confirmed suggestion from the splitter — never into a goal a category already feeds (D-341). |
| `OPENING_BALANCE` | What was already there on the day tracking started. Migration `019`, D-081. |
| `GROWTH` | Interest, dividends or a change in market value. May be negative. |

**The last two are in the balance and are not contributions.** The money is genuinely in the
goal, so it is in the sum — a balance is Σ its deposits with no exceptions and that rule does not
bend. But neither is money the user set aside, so `isContribution` excludes them from every
figure that measures effort: the savings rate, the required-monthly amount, the projected
completion date, the contribution streak and the paid-in-by-month chart. A note could not have
carried this, because every consumer is an aggregate and an aggregate cannot read prose (D-081).

Withdrawals are negative deposits, with a required reason note. Modeling them as negatives
rather than a separate entity keeps the balance a single sum and avoids a whole class of bugs.
**A `GROWTH` row is exempt from the reason**, and it has to be: demanding "what the money went
on" for a market fall leaves the user one way to record it — as a withdrawal — which every
spending figure downstream would then believe.

**Idempotency:** deposits generated from a source ref are unique per source ref. Re-importing a
statement or re-editing a paycheck updates the existing deposit rather than adding another.

## Places, and what is held in them

**Two records, split by M15** (D-175, D-176). A **place** is where money physically is — the bank,
the broker, the drawer — with a name, a kind (checking עו"ש, fixed deposit פק"מ, investment
account, provident fund קופת גמל, study fund קרן השתלמות, cash, other) and an institution. A
**holding** is what form the money takes there: cash, a deposit at a stated rate until a stated
date, a fund, a pension track, and from M16 a position in one security.

**The rate, the liquidity and the term are on the holding**, because Bank Hapoalim has no return
and the deposit you hold there does — and because a brokerage account's cash is reachable this week
while its index fund may not be, which one flag on the whole place could not say. **Money always
lands in a holding**; cash is an ordinary one, which is what keeps a transfer into a brokerage and
the securities it later buys reconcilable without either nesting inside the other.

Each holding also declares **how its balance is known** (D-176) — `RECORDED`, `TRANSCRIBED` or
`VALUED` — with a *last confirmed* date beside it. Declared, never inferred: a fixed deposit with no
statement transcribed against it yet must still say that a statement is what would confirm it, or
the app can never say *"you have not checked this since March"*.

This dimension is orthogonal to goals: one goal can be spread across several places, and one
place holds money for several goals. That crossing is exactly what the "where is my money"
view shows — a matrix of goal × holding **place**, with liquid and locked subtotals. The matrix
stays at the place grain: a goal with cash and a deposit at one bank does not need two columns to
say where its money is.

Distinguishing liquid from locked matters more than any other number here: an emergency fund
sitting in a locked deposit is not an emergency fund.

## How much should be in the bank

*Requested by the author, 2026-08-14. Not built.*

**A target, in months of expenses, with the multiplier adjustable.** The received answer is three
to six months; the honest answer is that it depends on how stable the income is and how fast the
job market moves, which is a judgement the user makes and the app does not. So the app supplies the
arithmetic and the slider, and states plainly what the number is a multiple of.

What it is a multiple of is the decision worth making carefully:

- **Fixed expenses only** is the *floor* — the rent, the insurance, the standing orders. It is what
  cannot be cut, and `fixedExpenseBasis` already computes it as one monthly figure (D-053), with
  non-monthly bills amortized and payroll deductions excluded.
- **Total spending** is the *comfortable* figure — everything that actually leaves, discretionary
  included.

Both, side by side, and the user picks which the multiplier applies to. One number with an
unexplained basis would be a number nobody can check, and the two differ by enough that showing
only one is a choice made on the user's behalf.

**What counts towards it is a `HoldingPlace` question, not a goal question.** The target is about
money reachable this week, so the figure it is compared against is the balance in places where
`isLiquid` is true — which is precisely the distinction above. A pension balance must never count
towards an emergency fund, and neither must a fixed deposit that has six months to run.

Naturally a `SavingGoal` of kind `EMERGENCY`: the goal holds the target, the multiplier and which
basis it applies to, so it appears in the splitter's priorities like any other and does not need a
screen of its own.

**Superseded** (D-360, D-386): the months went to the cushion, and an Emergency goal is an ordinary
goal aiming at an amount; `emergencyFund` and the goal's multiplier are gone. What follows is how it
was built. **Built at the domain level** (D-074). `emergencyFund` took the deposits and the places and works
out the liquid figure itself — there is no parameter a total could be passed into — and it returns
the target against **both** bases at the same multiplier, so a screen cannot show one by accident.
The multiplier is integer basis points of a month (45,000 is 4.5 months), because a decimal
multiplier against an amount is a float in the money path. And the liquid rule reaches further than
this section: an emergency goal's ordinary progress ring is measured against liquid money too, or
the goals screen and this panel would disagree.

## What savings become, and when

*Requested by the author, 2026-08-14. The domain half was built as `projectSavings` and never put
on a screen; M45 U2 removed it as dead code. `projectBalance` stays, for the funds.*

A projection: given what is held now, what is being added each month, and an assumed rate of
return, what is this worth in five, ten and twenty-five years.

**The arithmetic already exists, and it has already moved here.** `projectBalance` is
`@/domain/projection.ts` (D-072): it compounds year by year in integer minor units, taking a
contribution net of a contribution fee and applying a return net of a balance fee, with the
mid-period convention `periodReturn` uses (D-066). It takes those two fees as **plain basis
points** rather than a `FundFees` precisely so this feature does not have to construct a pension to
project a bank deposit — for a savings place both are usually zero and only the rate matters.

**What was missing was a rate to project at, and it is now `HoldingPlace.expectedReturn`**
(D-074). A place is the thing that *has* a return, where a goal is a purpose and can be spread
across several places at different rates — so the projection compounds each place at its own rate
rather than at an average of them, and a place with money and no rate recorded is projected
**flat** and named, so the screen can ask for the figure instead of inventing one.

**It is an illustration and must be labelled one**, which is D-066's rule for the fee projection
and applies with more force here: a range across conservative / moderate / optimistic assumptions,
never a single number, never presented as a forecast, and the assumptions always on screen and
adjustable. A savings rate on a deposit is contractual and knowable; a return on an investment
account is not, and an app that draws one confident line has made a prediction it has no business
making.

*Which is why the scenario adjustment applies to **assumed rates only**: a פק"מ at a stated 4%
earns 4% in the pessimistic column, because the bank agreed to it, while an index fund's assumed 5%
is what the columns exist to admit. `isEntirelyContractual` comes back with the projection, so a
screen showing only agreed rates can say "as agreed" rather than hedging about an assumption
nobody made.*

## Reachable from a conversation too

**Built (D-113).** The plugin has `create_goals` and `record_deposits` beside the `savings`
read it already had. Both are wrappers over `savingsRepository`, judged by `validateGoal` and
`validateDeposit`, so a preview refuses exactly what the app's forms refuse.

**A goal is one of the two things no file contains.** Every other write in that surface transcribes
a document — a statement, a payslip, a fund report. What someone is saving for is not written down
anywhere until they say it, which makes it the item on the plugin's list that a conversation is
best placed to collect rather than worst.

**The six modes are the tool's shape too**, and they had to move to get there:
`MODE_SOURCE`, the sign table and `modeOf` were living in `ui/savings/DepositEditor.tsx` and are now
`domain/depositEntry.ts`, which both front ends import. The rule that a loss is `GROWTH` with a
negative sign is one rule, and a second copy of it is one that can disagree. So `record_deposits`
takes a **positive amount and a mode**, never a minus the caller types; a withdrawal must give a
reason and a `LOSS` must not; and an opening balance and a gain are named in the answer as being in
the balance without being contributions.

**A holding is an object, not a string** — `{ id }` for one that exists, or
`{ name, kind, is_liquid, provenance, place }` to create it, refused without any of the last four
(M15; it took a *place* the same way until D-175). Liquidity is the user's answer rather than an
inference from the kind, and it is the field the emergency fund is measured against; a tool that
guessed it would put money in an emergency fund that cannot be reached. Provenance is refused for
the matching reason: inferred from whether anything has been transcribed yet, a holding would
change its own kind by being neglected.

**A deposit never creates a goal.** A name that matches nothing is refused and points at
`create_goals`, because a typo would split a balance across two goals — the opposite call
from F13's fund readings, where the report names its fund and there is no other tool to make one.

Editing and deleting a goal or a movement, closing and reopening a goal, and managing places and
holdings on their own are app-only, at `#/wealth/goals` and `#/wealth`.

## Interaction with other features

- **Payroll savings** — pension and study fund do **not** live here. They are `FundAccount`s in
  [F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md), which has fees, employer components, and a deposit
  reconciliation problem that ordinary savings don't ([09 Decision Log](../../09-decision-log.md) D-015). This screen
  shows their combined balance in the total and always marks it locked, so the savings rate
  reflects reality without duplicating the records.
- **Splitter** — goal priority orders the bucket suggestions; applying a plan proposes deposits.
- **Statistics** — savings are reported as "of which saved" alongside income and expenses, never
  as an expense.
- **Bank import** — a transfer to an investment account, once labeled, becomes a deposit.

## Screens

**Built as two tabs, not five screens** (D-076): `#/wealth/savings` with the goal detail beneath
it, and `#/wealth/places`. The deposits list is a *view* of the first — as a destination it would
be read by whoever navigated to it, which is nobody — and add-deposit is a form.

- **Goals** — cards with a progress ring, balance, target, required monthly amount; sorted by
  priority; total saved across all goals at the top. *Built. The liquid total sits beside the saved
  total, and an emergency goal's ring is measured against reachable money.*
- **Goal detail** — deposit history, balance split by holding, contribution chart by
  month, projection line to the target date. *Built, plus the emergency panel and — since D-081 — **"how it got here"**: what was already there, what you paid in,
  what you took out and what the market did, four figures that sum to the balance exactly. Absent
  when the whole balance is contributions, because a panel restating the number above it is
  furniture.*
- **Add deposit** — goal, amount, date, holding, note; defaults to the goal's default
  holding and today's date. *Built as one form with **six** modes — money in, money out, moved
  between holdings, already there, it grew, it fell — so the sign is never a minus the user types,
  a move cannot read as a contribution, and neither can an opening balance or a market gain. The
  mode picks the `sourceKind` the same way it picks the sign; a gain and a loss are two modes
  rather than one field where a minus decides which (D-081).*
- **Deposits** — flat chronological list across all goals, filterable by goal, place, and date;
  monthly totals. *Built as a view of the goals tab; the subtotal is the month's **net**, because
  "what did I actually put away in June" is the question.*
- **The money map** — places with their holdings beneath them; the "where is my money"
  breakdown with liquid vs locked; and every fund as a row of its own. *Built, and rebuilt by M15:
  the third column is **provenance and last-checked** rather than a rate (D-176), the rate moved
  down onto the holding that earns it, and a fund is a row leading to F13's screen rather than an
  anonymous share of the locked subtotal (D-177). A holding also takes a one-click* Checked today.

## Data touched

Creates/updates: `SavingGoal`, `SavingDeposit`, `HoldingPlace`, `Holding`.
Reads: `PaycheckLine`, `Transaction`, `SplitPlan`, `FundAccount` (the map's fund rows, D-177).

## Edge cases

| Case | Behavior |
|---|---|
| Deposit into a closed goal | Blocked; offer to reopen. |
| Withdrawal exceeding balance | Allowed with a warning — the user's records may be incomplete. |
| Goal with no target amount | Progress ring replaced by a running total; no required-monthly figure. |
| Target date in the past, goal unmet | Required-monthly shows "overdue" rather than dividing by zero or going negative. |
| Deleting a goal with deposits | Blocked; offer archive, or move deposits to another goal. |
| Editing a paycheck that generated a deposit | Deposit amount updates in place, no duplicate. |
| Transferring between holdings | Two deposits (negative from, positive to) linked by a transfer group, netting to zero. Since D-175 this can happen inside one place — cash into the deposit at the same bank. |
| A place with no holdings | Listed, holding nothing, with *Add a holding* on the row. A deposit cannot land in it: money lands in a holding. |
| Deleting a place whose holdings are empty | Allowed, and takes them with it — leaving one behind would leave money pointing at a holding the document does not have. |
| A holding nobody has confirmed in five months | Home's attention list says so, last of its items: the figure is in every total already and the claim is only that it may have drifted (D-176). |

## Acceptance criteria

- Goal balance always equals the sum of its deposits (property test). **Met at the domain level**,
  and by construction rather than by test alone — no function takes a balance (D-074).
- Payroll-linked deposits are created exactly once regardless of how often the paycheck is
  edited. **Met** (D-075), by an upsert rather than by care — and it needed a correction to get
  there: a `PaycheckLine.id` does not survive an edit, so the deposit is keyed on
  `paycheckId:goalId`, which does. Tested as the sequence: sync, edit the slip, sync again, two
  deposits throughout.
- Liquid and locked subtotals sum to total savings. **Met at the domain level**, funds included,
  with an unrecognized holding counted as locked so the two sides cannot fail to add up. Since M15
  it is `moneyMap` that holds this, over places, holdings and funds in one pass (D-177).
- No divide-by-zero anywhere in the projection math. **Met**: every quotient in
  `domain/savings.ts` is guarded by a variant rather than by a check a caller must remember —
  months remaining include the current month, a contribution rate of zero has its own answer, and
  a target of zero yields no ratio at all.

## Open questions

- ~~Should the app track investment **returns**, so a goal's balance reflects market value rather
  than contributions?~~ **Answered** (D-081), and *not* as recommended. The recommendation was a
  manual balance-adjustment deposit with source `MANUAL` and an explanatory note; what shipped is
  two source kinds, `OPENING_BALANCE` and `GROWTH`, because the note was the part that could not
  work. Everything that has to exclude these is an aggregate, and no aggregate can read a note —
  a ₪200,000 opening balance filed as `MANUAL` would report as the best savings month of
  someone's life. Still no price feed and still no market data: the user types what their
  statement says, which is the same bargain `FundBalanceSnapshot` already makes.
- ~~**Where does the expected return live, and is it one number or two?**~~ **Answered** (D-074)
  as recommended: `HoldingPlace.expectedReturn` — a rate in basis points bound to a `ReturnBasis`
  of `CONTRACTUAL` or `ASSUMED`. Two nullable columns in the schema and **one nullable field in the
  domain**, so a rate cannot be held without saying whose it is, the way a `FeeReference` carries
  its `asOf` and `source`. The basis is a two-value union rather than a boolean because each side
  is a different sentence on screen, and it earns its place by changing the arithmetic: only an
  assumed rate moves between the projection's scenarios.

## Related

[04 Data Model](./04-data-model.md) · [F04 Paycheck Tracking](./f04-paycheck-tracking.md) · [F05 Paycheck Splitter](./f05-paycheck-splitter.md) · [F10 Statistics and Reports](./f10-statistics-and-reports.md)
