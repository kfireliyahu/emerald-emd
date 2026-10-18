---
type: pack
project: Emerald
pack: ledger
updated: 2026-09-16
---

# The ledger pack

**A personal-finance application, parked, and since M25 nothing but declared formats and pack code
(D-282).** It
imports credit-card and bank statements, categorizes spending, tracks paychecks and their deductions, plans how a net
paycheck is allocated, and tracks savings, debts and pension funds — investments left it in M28 (D-283, D-308), and a person declares their own. Israeli domain:
ILS, Cal and Max statements, Israeli payroll structure, pension and hishtalmut.

It is about eighty thousand lines and roughly thirty tables, it works, and **every screen in it
still works today** — nothing has been disabled or removed. What changed on 2026-09-16 is what it
*is*: the first pack of [an engine](../../engine.md) rather than the whole product.

## Three things to know before you touch it

1. **It is parked. Do not take a unit from it** — M25 is bringing it back (D-265), through M25's units only. Parked is not abandoned — it comes back when a
   declared format, its identities and its links can express what these thirty tables express, and
   the work in [the roadmap](./roadmap.md) is re-read against that rather than resumed as written.
2. **It is also the on-ramp.** *"Declare a kind of thing and connect it to other kinds of thing"*
   is a foreign idea; *"here is a working money tool, and here is how you declare your own"* is
   not. The pack is the demo that makes the engine legible, which is why it stays in the build
   rather than tucked behind a setting.
3. **It is the entire evidence base.** Four real documents rewrote the design, and every
   non-obvious rule in the core came out of one of them.

## Where it actually stands

**M0 to M15 closed.** M13, M14 and M15 closed on 2026-08-29 when the author reviewed them.

**M16 (investments) ended by leaving the pack** (D-283, D-308) rather than being re-driven.

**M17 (the flow) is built and its review was deferred** on 2026-09-07: it needs one real salary
month, and the document has no payslips and no debts, so its four claims stand **untested rather
than accepted**.

**M18 (clean up) dissolved.** Its cleanup half was the docs being over budget because milestones
had stopped closing — done on 2026-09-16 by the restructure that made this folder. Its three
feature requests are listed in [the roadmap](./roadmap.md) and two of the three were already
marked as needing rescoping against the engine.

Both review queues are kept in the private record of earlier milestones; what is still open from
them is `review_entry` rows in `docs/memory.emd`.

## The notes

| Note | What it covers |
|---|---|
| [04 Data Model](./04-data-model.md) | Every ledger table and field |
| [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md) | Its math: money, signs, the three dates, dedup, paychecks, the splitter, fixed expenses, funds, savings, statistics |
| [06 Navigation and Screens](./06-navigation-and-screens.md) | The finance screens and their routes |
| [08 Suggestions and Open Questions](./08-suggestions-and-open-questions.md) | What is unresolved |
| [12 Market Reality](./12-market-reality.md) | Who else is in this space |
| [f01](./f01-card-statement-import.md) · [f06](./f06-bank-statement-import.md) | Statement import |
| [f02](./f02-category-system.md) · [f03](./f03-auto-categorization-engine.md) | Categories and the rule engine |
| [f04](./f04-paycheck-tracking.md) · [f05](./f05-paycheck-splitter.md) | Paychecks and the splitter |
| [f07](./f07-savings-and-deposits.md) · [f08](./f08-debts.md) · [f09](./f09-fixed-monthly-expenses.md) | Savings, debts, standing commitments |
| [f10](./f10-statistics-and-reports.md) | Statistics |
| [f12](./f12-onboarding.md) | First run |
| [f13](./f13-pension-and-hishtalmut.md) · [f18](./f18-investments.md) | Funds and investments |
| [roadmap](./roadmap.md) · [decisions](./decisions.md) | M0–M18, and the ledger's half of the decision index |

## Things that will bite you in here

The core's list is in [conventions](../../conventions.md); these are the pack's own, and every one
cost a session.

- **The user maps the columns; the app only guesses.** There are no per-provider parsers (D-013).
- Cal and Max ship **XLS**, **XLSX**, and sometimes **CSV**, with a preamble of merged cells before
  the real header row. **Never assume the header is row 1.**
- Hebrew text in these files is RTL; string trimming must handle RTL/LTR marks and NBSP.
- Amounts appear as `1,234.56`, `₪1,234.56`, `-1,234.56` and sometimes with a trailing minus.
- **Installments** (`תשלומים`) mean one purchase produces N charges across N months. Charge date
  and purchase date differ and both matter.
- Foreign-currency rows carry both the original currency amount and the ILS charge.
- **The "billing month" of a statement is not the calendar month of its transactions.**
- **The bank statement's card-charge row is the same money as the card statement's transactions.**
  Match it by the last-4 in the description and ask before excluding it.
- **Payroll deductions are already out of net.** Never subtract them again as a fixed expense.
- **Fund balances are transcribed snapshots**, not derived from a deposit stream — the deliberate
  exception to "balances are always derived".
- **A price is not an amount** (D-204): it carries six digits past the minor unit, and the value is
  where the rounding happens. A money-market quote shown as ₪2.51 is not the ₪2.5050 stored.
- **A quantity is an integer of millionths** (D-182), for the reason money is an integer of agorot.

## Two things nobody should "fix" without a real file

- **No real installment row has ever been seen.** `installments.xlsx` is built to the real column
  layout, which is a test, not a sighting.
- **No real deposit table has been read.** The real pension quarterly prints none, and the
  per-deposit annex is **a separate PDF** that D-153's heading anchor cannot reach. It failed
  safely and stored nothing — and D-169's salary check waits on the same document.

## Related

[roadmap](./roadmap.md) · [decisions](./decisions.md) · [the engine](../../engine.md)
