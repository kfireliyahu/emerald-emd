---
type: feature
project: Emerald
milestone: M6
status: built — the domain (D-083), the schema and repository (migration `020`, D-084), all five screens (D-085) and installment-group promotion (D-086)
---

# F08 — Debts

Track what is owed and watch it go down. The requirement noted uncertainty about how debts
would update automatically — this note answers that concretely.

## The core design decision

**A debt does not have a stored balance that something updates. A debt has a starting principal
and a stream of payments; the balance is derived.**

This inverts the problem. Instead of asking "how does the balance get updated?", the question
becomes "how do payments get discovered?" — and that has four clean answers, each a
`autoTrackKind` on the `Debt` entity ([04 Data Model](./04-data-model.md)).

## The four tracking mechanisms

| Mechanism                | Its ref                   | Discovers payments from                    | Typical debt                          |
| ------------------------ | ------------------------- | ------------------------------------------ | ------------------------------------- |
| payroll                  | `deduction_type.linked_debt_id` | Each saved payslip carrying such a line | Employer loan, advance                |
| `MERCHANT_PATTERN`       | a merchant pattern        | Imported transactions matching the pattern | Bank loan standing order, mortgage    |
| `CATEGORY`               | a `Category` id           | Any transaction in that category           | A catch-all "Loan payments" category  |
| `CARD_INSTALLMENT_GROUP` | an installment `groupKey` | The installment slices of one purchase     | A big purchase split over 12 payments |
| `NONE`                   | —                         | Nothing; user enters payments manually     | Money owed to a friend                |

**Only four of these are `autoTrackKind` values.** Payroll is the exception, and deliberately: the
link lives on the deduction type, where migration `012` has held it since M3, and the
deduction-types screen's **Pays into** select offers a debt beside a fund and a goal. A debt naming
a type while the type names the debt is two edges for one relationship (D-083). A debt fed by a
payslip can still track a merchant pattern of its own; those are different questions.

Each mechanism runs at a well-defined moment:

- payroll → when a paycheck is saved or edited.
- `MERCHANT_PATTERN` / `CATEGORY` → at import commit, and on demand via "rescan".
- `CARD_INSTALLMENT_GROUP` → at import commit, when a new slice arrives.

In the domain they run as **one pass** (`discoverPayments`), because ambiguity is a fact about the
set: a transaction claimed by a merchant pattern on one debt and a category on another is only
visible to something looking at both.

Every discovered payment is created **unconfirmed** and appears in a review queue with the
familiar accept / edit / dismiss pattern from [06 Navigation and Screens](./06-navigation-and-screens.md). Unconfirmed
payments count toward the balance but are visually marked, so the number is never a surprise.

**A dismissal is remembered, and it removes a claimant rather than a payment** (D-084). "This
charge is not a repayment on that loan" is an answer, and one the app forgets is one it overrules at
the next import — so dismissals are stored, and they are read *inside* `discoverPayments`. That
placement is not tidiness: a row dismissed for one debt that a second debt also matches would
otherwise come back as an ambiguity between the two, one of which the user has already ruled out —
the same question in a shape the same answer cannot resolve.

**Idempotency is the whole game here.** A discovered `DebtPayment` is unique per
`(debtId, sourceKind, sourceRefId)`. Re-importing the same statement, editing the same
paycheck, or rescanning the same history can never create a second payment for the same event.
A payroll payment is keyed `paycheckId:debtId` and never on a line id, which does not survive an
edit (D-075, D-083). A payment the app is not sure about is not created at all — an ambiguous row
comes back as a question with a debt picker, because two marked payments against two balances
would still sum to double the money that moved.

## Card installments as debt

This is the most interesting case and the one most apps get wrong. When a purchase is split
into 12 payments, the user owes 12 slices' worth of money the moment they buy it — but only
one slice appears in each statement.

Design: when the importer detects a new installment group with `total > N` (default 3), it
offers to create a debt from it, with `principalAmount` = the original total and payments
discovered automatically as each slice is charged. The user can decline, and can set the
threshold or disable the prompt.

**Built** (D-086), with one change of place: the offer is on the **debts screen**, and the import
notice carries a count and a link to it — the shape D-064 gave the settlement prompt, and for the
same reason. An offer made once, on a screen someone is passing through, is one that gets dismissed
by accident, and this one creates a debt with a five-figure principal.

Two things the offer does that are worth stating. It **says whose number the principal is** —
"the total the statement printed" or "estimated — no total on the statement" — because slice ×
count is a figure no file ever stated, and an estimate accepted as a fact becomes a balance nobody
can check. And promoting the group **confirms the slices already charged** rather than queuing
them: the user has just answered yes to the whole purchase, and asking again once per slice would
be the app disbelieving an answer it had been given. A slice charged later is a new reading and
goes to the queue like everything else.

The outstanding installment total across all cards is also shown as a single figure on the
debts screen even for groups the user didn't promote to debts — because that money is
committed regardless.

## Balance and projections

- Outstanding = `principalAmount` − Σ the principal of its payments, where a payment's principal is
  `amount − interestPortion` and nothing stores it (D-083).
- v1 has **no amortization engine**. The default split is 100% principal, 0% interest, and the
  user can override per payment or set a flat monthly interest portion on the debt.
  This is a documented simplification; see Open questions.
- Projected payoff date = outstanding ÷ the monthly repayment rate. **Per month, not per payment**:
  three payments inside one month are one month's repayment, and the window spans the gaps, so a
  quarterly debt is not reported as paying monthly. One payment states no rate at all.
- Progress ring = paid ÷ principal, capped. An overpayment is its own figure, not a ring past full.
- Total debt across all debts, and total monthly obligation, on the Wealth tab. **The obligation
  total is not the sum of the monthly payments**: a payroll-deducted loan is already out of net, a
  card installment is already in the spending, and a standing order the user also recorded as a
  fixed expense has already been subtracted. `debtObligationBasis` is the one door, and it names
  all three rather than dropping them (D-083).

## Screens

All five are **built** (D-085), at `#/wealth/debts` — the sixth tab of the Wealth shell, second
after savings. With them, the **Pays into** select's third destination, held back by D-084 only
because its "open" link would have landed on a screen that did not exist.

- **Debts** — *built.* Outstanding, progress ring, payoff sentence and tracking per debt; still
  owed, paid so far, the monthly obligation and the card slices still to come at the top; the
  debts the obligation left out named underneath with the reason for each. A settled debt is
  offered the chance to close rather than closing itself.
- **Debt detail** — *built*, at `#/wealth/debts/:debtId`. The payoff sentence with the basis it
  divided by, the balance-over-time step chart, and the payment history with each row naming where
  it came from and how much of it came off the balance.
- **Debt editor** — *built.* The tracking mechanism is four cards each saying what it will
  actually do, and the ref is a different control per kind rather than one box meaning three
  things; switching kind replaces the ref. The two warnings are computed from the live draft, which
  is the only moment they are useful (D-085). No interest rate: v1 has no schedule generator to
  read one (D-083).
- **Payment review queue** — *built*, as a view of the debts screen rather than a destination of
  its own. Three lists: found payments, ambiguities with a debt picker, and orphans. Dismissing a
  merchant-tracked payment offers to narrow the pattern.
- **Add payment** — *built.* The interest is one field and the principal is shown as it is typed,
  because the model stores the interest and derives the rest (D-083). Overpayment warns rather than
  refuses.

## Reachable from a conversation too

**Built (D-113).** The plugin has `create_debts` and `record_debt_payments` beside the `debts` read,
both wrappers over `debtRepository` and judged by `validateDebt` and `validatePayment`.

**What is written is the principal, never a balance**, which is this feature's core design decision
arriving intact at a second front end. There is no field for "what is left"; outstanding is derived,
and the only thing that moves it is a payment. A payment is **all principal** unless it names an
interest portion, and the preview prints the split as it is typed — the same thing the add-payment
screen does, for the same reason.

**Two refusals carry the reasoning.** `CARD_INSTALLMENT_GROUP` tracking is refused by name: promoting
a group does more than name a ref — it confirms the slices already charged and states whether the
principal is the total the statement printed or slice × count, and an estimate accepted as a fact
becomes a balance nobody can check. And a payment naming a debt that does not exist is refused
rather than creating one.

**A debt that *does* set merchant or category tracking is told what happens next**, which the screen
shows structurally and a tool answer has to say: discovery runs at import, the payments it finds land
**unconfirmed**, they count towards the balance, and answering them is the review queue. Setting up
tracking without saying that would be worse than not offering it.

**The review queue itself is app-only**, and deliberately — with installment promotion, it is the
half of this feature that answers what the *app* found rather than what the user knows, which is a
different act. Both are named in the plugin's "Not here" section rather than left unmentioned.
Editing, closing and deleting a debt are app-only too, at `#/wealth/debts`.

## Data touched

Creates/updates: `Debt`, `DebtPayment`.
Reads: `PaycheckLine`, `Transaction`, `Installment`, `Category`, `DeductionType`.

## Edge cases

| Case | Behavior |
|---|---|
| Payment discovered twice (re-import) | Blocked by the source-ref uniqueness invariant. |
| Payment source deleted (transaction removed) | Payment marked orphaned and surfaced, not silently deleted. |
| Overpayment (balance goes negative) | Allowed; shown as "overpaid by X" and offers to close the debt. |
| Debt fully paid | Prompt to close; closed debts move to a collapsed section, history retained. |
| Merchant pattern matches unrelated transactions | Review queue catches it; dismissing a discovered payment also offers to tighten the pattern. |
| Mortgage with changing monthly amount | Fine — payments are discovered by pattern, amounts vary. |
| Debt paid off early with a lump sum | Manual payment entry. |
| Two debts with the same tracking pattern | Warned at save time; ambiguous matches go to review with a debt picker. |

## Acceptance criteria

All four are **met**: the first, second and fourth at the domain level (D-083), tested in
`src/domain/debt.test.ts`, and the third by `deleteDebt` (D-084), tested in
`src/data/repositories/debtRepository.test.ts` — it refuses while there is history, and when there
is none it touches nothing but `debt` and `deduction_type.linked_debt_id`.

- Re-importing three months of statements twice produces the same debt balances. *`newPayments`
  plus `paymentSourceKey`, tested as the property — scan, record, scan again, nothing new.*
- Every payment can name where it came from. *`PaymentProvenance` carries the merchant, the payslip
  period or the "3 of 12" with the payment, rather than leaving a screen to look it up later, by
  which time the row may have been recategorized or the slip edited.*
- Deleting a debt does not delete the underlying transactions or paycheck lines.
- Installment-derived debts' payment totals equal the original purchase total when complete.
  *`InstallmentDebtCandidate.principal` carries whether the total is the one the file printed or
  slice × count, so the offer can say which — the file's own figure has been on the ledger since
  migration `007`.*

## Open questions

All three are **settled as recommended** (D-083).

- **Amortization.** Proper principal/interest splitting needs the rate, the schedule, and the
  compounding convention — realistic for a mortgage, overkill for a ₪3,000 loan. *Settled: v1 is
  all-principal with a manual override, and `interestRatePct` is not a field until the schedule
  generator that would read it exists. A stored rate no code consumes is one a screen eventually
  computes with.*
- **Where does debt sit in net worth?** *Settled, and **built** at `#/wealth/worth` (D-107) — as
  **two** figures rather than one. "Liquid savings − outstanding debt" is a real question, and it
  is not "what am I worth", where the pension is most of the answer; `liquiditySplit` exists to
  keep those apart (D-074), so the screen prints both. The history reads a debt's balance at each
  month's end and never consults `isClosed`, which has no date on it and would erase a debt from
  every month it was actually being paid.*
- Should the monthly card charge itself be modeled as a rolling debt? *Settled: no. And the
  argument turned out to be load-bearing rather than decorative — it is why a promoted installment
  purchase is excluded from `debtObligationBasis`. The slices are charged to the card and the card
  statement is already in the spending total, so subtracting the obligation as well counts the same
  money twice by a different door.*

## Related

[04 Data Model](./04-data-model.md) · [F01 Card Statement Import](./f01-card-statement-import.md) · [F04 Paycheck Tracking](./f04-paycheck-tracking.md) · [F06 Bank Statement Import](./f06-bank-statement-import.md) · [F07 Savings and Deposits](./f07-savings-and-deposits.md)
