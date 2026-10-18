---
type: feature
project: Emerald
milestone: M5
status: in progress
---

# F06 — Bank Statement Import

**Built so far:**

- **The domain and the parse** (D-060). `SEPARATE_DEBIT_CREDIT` with its two column roles,
  running-balance verification, row classification, and last-4 settlement matching, all as pure
  functions in `src/domain/bankImport.ts` with the shapes in `src/domain/model/banking.ts`. A
  synthetic bank CSV goes through the existing mapper guesser and comes out with signed amounts, a
  verified balance chain and a matched card settlement.
- **The storage** (migration `015`, D-061). `card_settlement_link` and
  `account.exclude_settlements_from_stats`, with `cardSettlementRepository.ts`.
  `syncSettlementLinks` re-derives what it can on every import and never overwrites an answer, so
  a `MEDIUM` match becomes `HIGH` when the card statement arrives without re-asking anything
  already decided. Excluding writes the link and the bank row's `counted_on_card` together (the
  person's `isExcludedFromStats` is never the settlement's to write, D-380),
  through the one function that can.

- **The rescan** (D-062). `rescanSettlements` runs after **every** commit, card or bank, so the
  edge case below is not a case anyone has to spot. A test asserts the property rather than the
  mechanism: two documents, the two import orders, and link sets that are equal.
- **The balance check on the review screen** (migration `016`, D-063). Run once at stage time and
  recorded on the session, because by review time the sheet — and its row order — is gone. A
  verified chain is one clause in the summary bar; a divergence is a panel naming the row, both
  figures and the gap, and **the commit refuses**.
- **The prompt and the per-card answer** (D-064), on the **Accounts screen** rather than the review
  screen — see the note under "The prompt" below. With them, the unmatched-charge warning and the
  three-state control that reverses an answer.

- **The labeling queue** (D-065) — which turned out to be the bulk categorize screen already built
  in M2 (D-047), plus the first-class **skip** it was missing.

- **The escape hatch when detection misses** (D-069). Matching is keywords plus a last-4 plus an
  amount, and all three can come up empty: a bank that words its card charge unusually, or a row
  naming no card for a period whose statement is not in the ledger. Either way the month is counted
  twice and the user can see the answer at a glance. **"This pays a card"** in the ledger's detail
  panel records it, keyed on the normalized merchant so one answer covers every past and future
  occurrence, and the rescan applies it to history and the next import alike.

- **The account is asked about, not assumed** (D-070). The importer used to create every account as
  a **card**, and settlement matching reads bank accounts and nothing else — so a bank statement
  imported into a document with no pre-bound account was never scanned at all, and none of the
  above ran. The mapper now guesses from the running balance, offers the choice before staging, and
  the accounts screen can correct one created wrong.

- **The salary half of the same problem** (D-078). A card settlement doubles a month's *spending*;
  a salary deposit doubles its **income**, because the payslip entered in F04 already counts as one.
  The deposits of each month are summed and matched against the payslip nets in a one-month window,
  so an employer who pays on the ninth of the following month and one who pays on the last day of
  the month both come out right without being asked which they are. **The paycheck is authoritative
  and the bank row is the duplicate**, so what an answer excludes is the row. The queue is on the
  **paychecks screen** for D-064's reason: the other direction — a slip entered after the statement
  was imported — has no review screen open either.

**Both promotions are built** (D-191): one panel on `#/categorize`, a bill on one side and a debt on
the other.

**An unanswered settlement counts as spending, and the app says how many there are.** Exclusion in
the ledger is `transaction.counted_on_card`, which only an answered `EXCLUDED` sets (D-380).
`bankSpendingBasis` keeps an undecided settlement out of the total it previews *beside the
prompt*; a settlement already committed and still unanswered is in every statistic until someone
answers. That is deliberate — quietly excluding it would be deciding on the user's behalf — and
The ledger's start view on `card_settlement_link` (D-382) is what makes it visible rather than silent.

Import the checking-account statement so that money leaving the account directly — standing
orders (הוראות קבע), direct debits, cheques, transfers, loan repayments — is captured
alongside card spending. Then prompt the user to label the transfer names, skippably.

## Why this is not just F01 with a different profile

Card statements describe purchases. Bank statements describe **cash flow**, which includes:

- The card's own monthly charge — which would double-count everything already imported from
  the card statement if treated as spending.
- Salary deposits — which would double-count paychecks entered in [F04 Paycheck Tracking](./f04-paycheck-tracking.md).
- Transfers between the user's own accounts — not income and not expense.
- Cryptic counterparty names ("העברה 0123456789") that mean nothing until labeled.

So bank import needs a **classification step** that card import does not.

## Pipeline additions over F01

Steps 1–9 of the [F01 Card Statement Import](./f01-card-statement-import.md) pipeline are reused verbatim. Then:

10. **Classify each row** into: `CARD_SETTLEMENT`, `SALARY`, `INTERNAL_TRANSFER`,
    `LOAN_PAYMENT`, `DIRECT_DEBIT`, `CHEQUE`, `FEE`, `INTEREST`, `OTHER_INFLOW`,
    `OTHER_OUTFLOW`.
11. **Match card settlements by last-4** and ask the user whether to exclude them. Detailed
    below — this is the mechanism that prevents double-counting.
12. **Reconcile** `SALARY` rows against `Paycheck.netAmount` for the period; on match, exclude
    the bank row from income statistics (the paycheck is authoritative) and link them. Mismatch
    → surfaced, since it usually means a paycheck was entered wrong. **Built** (D-078): the match
    is re-derived every time from the ledger and the payslips, and the only thing stored is the
    user's answer — an `app_setting` keyed by month, read beside the match and never written onto
    the rows (M36 U04, D-380).
13. **Queue for labeling** — every unrecognized counterparty goes into a labeling queue.

## Card settlement matching — the last-4 mechanism

The bank row for a card charge contains the card's last four digits in its description:
something like `כרטיס אשראי 1234` or `לאומי קארד 5678`. The card statement's file, and the
`Account` created from it, also carry those four digits. That shared identifier is what links
the two, and it is far more reliable than matching on amount and date alone.

**Detection:**

1. Extract any 4-digit group from the bank row's description — from `merchantRaw`, **never** from
   `merchantNormalized`. `normalizeMerchant` strips a trailing run of one to five digits as a
   branch number, so `כרטיס אשראי 1234` normalizes to `כרטיס אשראי` and the four digits this whole
   mechanism turns on are gone before anything can read them (D-060). A group counts only when the
   run of digits is itself four long, so a ten-digit asmachta contributes no candidates.
2. Look for an `Account` with kind `CREDIT_CARD` and a matching `last4`.
3. If found, classify the row as `CARD_SETTLEMENT` and link it to that account.
4. Corroborate by comparing the row's amount against the sum of that card's transactions for
   the corresponding billing period. Agreement raises confidence to high; disagreement still
   matches on last-4 but is flagged.

**Which period, and how the rows are grouped.** Settlements are grouped **per card per month** and
summed before the comparison, which is what makes the split-charge and two-month cases below fall
out rather than needing special cases. The billing period is not guessed from the charge date: it
is whichever of that card's monthly totals the group's amount equals, within a zero-to-one-month
window. The same comparison identifies the period and raises the confidence to `HIGH`.

**Classification is derived, never stored.** A row's `RowClass` is what the app makes of it, and
that changes — a charge to a card whose statement arrives next week reads as `OTHER_OUTFLOW` today
and `CARD_SETTLEMENT` then. Re-deriving is what makes "order of import must not matter" a property
of the code rather than a rescan that has to be remembered (D-060). What persists is what the user
confirmed: `CardSettlementLink.userDecision` and `Account.excludeSettlementsFromStats`.

**The prompt.** Matched settlements are not excluded silently. On the import review screen they
appear as their own group:

> **3 credit-card charges found**
> These look like the monthly charges for cards whose statements you already imported.
> Counting them would double your spending.
>
> · Cal ···1234 — ₪4,210.55 (10/07) — matches 63 transactions totaling ₪4,210.55 ✓
> · Max ···5678 — ₪2,180.00 (02/07) — matches 41 transactions totaling ₪2,180.00 ✓
> · ···9012 — ₪890.20 (15/07) — no statement imported for this card ⚠
>
> **[ Leave them out of totals ]  [ Keep them ]  [ Decide individually ]**

**Built on the Accounts screen, not the review screen** (D-064). Drawn on the review screen the
prompt only appears when the *bank* statement is the file being reviewed; the other direction — a
card statement that turns a bank row imported six weeks ago into a settlement — has no review
screen open at all. A queue reachable from the account it is about covers both, and the
import-finished notice links to it. "Decide individually" is not a mode: the per-group buttons are
always there and the two bulk buttons are a shortcut over them. The bulk answers also set the
per-card memory, because that is what they mean; answering one group does not.

Excluding sets `counted_on_card` and links the bank row to the card account and billing
period, so the settlement is still visible in the bank's cash-flow view and still drillable —
it just doesn't count as spending.

**Remembering the answer.** The decision is stored per card account
(`excludeSettlementsFromStats`). After the first import, later settlements for the same card
are excluded automatically and reported as a one-line summary rather than a prompt. The setting
is reversible from the account screen.

The column is **nullable and that null carries meaning**: not-yet-asked prompts, and an explicit
"keep them" must never prompt again (D-061). On the account screen it is a **select of three**, and
changing it moves that card's settlements as well as the memory — setting it back to "ask me" puts
them into the prompt and un-excludes them, which is what makes this reversible for the money rather
than for one column (D-064). A settlement whose link is created already carrying a
remembered `EXCLUDED` has the bank row's `counted_on_card` set with it, or the second month of
an auto-excluded card counts as spending until someone opens a screen.

**The unmatched case matters more than the matched one.** A settlement whose last-4 has no
imported statement means a month of card spending is missing from the ledger and every
statistic is quietly wrong. It surfaces as an actionable warning — "₪890.20 charged to a card
ending 9012, but no statement imported" — with a shortcut to import that statement or to create
the account. This also becomes the Home dashboard's missing-statement nudge.

If the card's last-4 is absent from the description (some banks omit it), fall back to matching
on amount and date within a tolerance, at lower confidence, and always prompt.

## The labeling queue

The requirement: *"app would prompt to label/put category each name of the transfer by the
user, can be skippable."*

Design:

- Grouped **by counterparty name**, not by row. One decision covers every past and future
  occurrence.
- Each entry shows: the raw name, occurrence count, total amount, date range, and a suggested
  category from the rules engine.
- Actions per entry: assign category · assign category **and create a rule** · mark as internal
  transfer · mark as a fixed expense · mark as a debt payment · **skip**.
- Skipping is a first-class outcome. Skipped names go to a "Skipped" section reachable from
  Money, with a badge count. Never a blocking modal, never a nag.
- The whole queue is skippable in one action; the import still commits.

**This is `#/categorize`** (D-065). Everything above the skip was already built by D-047 — the
grouping, the one-decision-covers-all, the counts and totals, the rules-engine suggestion, and the
"assign and create a rule" offer, which is the same `offerForCorrection` the ledger uses. "Mark as
internal transfer" is not a separate action either: `Internal Transfer` is a seeded system category
and is already in the picker. The skip is stored under the `app_setting` key `labeling.skipped` and
**writes nothing to any transaction** — the rows stay uncategorized and stay in the ledger; only
the queue stops asking. The Skipped count lives in that screen's header rather than as a nav badge,
because a badge on a section that exists to be ignorable is the nag this design rules out.
The two promotions — to a fixed expense (F09) and to a debt payment (F08, M6) — are **built**
(D-191), as one panel opened by *Bill or debt?* on the row. They are what connects
[F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md) and [F08 Debts](./f08-debts.md) to
reality, and each keeps the queue's premise of one decision per counterparty:

- **A bill** writes a `FixedExpense` matched on this merchant, seeded by `proposeFixedExpense` from
  every charge under the name — median month, day, and the cadence the gaps read as, or **nothing
  where they read as nothing**. `USER_DEFINED`, because the detector never offered it: this path
  drops the thresholds that keep one-off purchases out of the detected list, and the user supplying
  the answer is exactly what makes that safe.
- **A debt payment** points the debt's tracking at the name and runs discovery. It **writes no
  payment**: what appears is unconfirmed rows in the debts review queue, counting towards the
  balance until answered, which is what docs/f08 requires a debt told to track something to be told.
  A debt is chosen and never created, a closed one and a split purchase are refused by name, and
  replacing a live pattern says which one goes.

The category is part of the same panel and stays **optional**: a fixed expense is a bill the app
watches for, not a filing decision, and without one the charges stay uncategorized and the name is
still in the queue. Promoting a name to both a bill and a debt double-counts the same money, so the
bill side says so where the debts screen already says it after the fact.

## Bank file mapping

Israeli banks export CSV/XLS with per-bank layouts and, again, preambles. The same
`ImportMapping` mechanism from [F01 Card Statement Import](./f01-card-statement-import.md) applies — the user maps the columns
once per bank — with these extra column roles:

- Value date (תאריך ערך) vs transaction date (תאריך). **This is `chargeDate`**, which docs/04
  defines as "the card billing date, or bank value date" — no new role.
- Debit column (חובה) and credit column (זכות) as **separate columns**. This is the
  `SEPARATE_DEBIT_CREDIT` amount convention, and it is the main reason that convention exists.
  **The column decides the sign, not the digits**: both are magnitudes on paper and banks differ
  about whether a debit is printed with a minus, so the magnitude is taken and the sign comes from
  which column it was in. A row filling both with real numbers is a row error — it is a mapping
  pointed at the wrong pair far more often than a bank saying something clever.
- Running balance (יתרה) — imported for verification, not stored per transaction. It rides beside
  the parsed draft as far as the check and no further.
- Reference/asmachta (אסמכתא) — useful as part of the natural key, since bank rows repeat.
- Description and counterparty as separate fields in some banks. Not offered as two roles: nothing
  reads a counterparty separately yet, and a role the parser drops is worse than one that is not
  there (D-036).

Both required-role sets are picked from the convention, so a bank mapping asks for `debit` and
`credit` where a card mapping asks for `amount`, and the convention rather than the roles is
authoritative when the two could disagree.

**Balance verification:** because bank statements carry a running balance, the importer can
verify its own parse: starting balance + Σ parsed amounts should equal the ending balance.
A mismatch means a wrong mapping or a parsing bug and must be shown before commit. Card
statements offer no equivalent check; use it here.

It is chained row to row rather than summed end to end, so the diagnostic names the **first**
diverging row instead of only the total. Which end of the file the oldest row sits at is decided
by which reading makes the chain add up, not by the dates — Israeli banks export both ways. The
one known limit, pinned by a test: reading from both ends can rescue a sign-flipped parse when
every consecutive pair of amounts is equal, which needs a two-row statement of identical amounts.
Anything with two different amounts in it fails both readings. A chain with a hole in it — a row
whose balance cell was blank or unreadable — reports as unavailable rather than skipping the row,
because a check that skipped a row is not a check.

Start with whichever bank the user actually has. Others need no work — the user maps them.

**Still owed a look:** a real Israeli bank export. `fixtures/synthetic/bank-statement.csv` is built
to the column layout above and its arithmetic is real, but it is a test rather than a sighting —
the same distinction M1 drew about an installment row and M3 about a payslip. The things to check
when one arrives: whether the debit column is printed with a minus, whether the rows are oldest-
or newest-first, and whether the running balance is stated on every row or only on some.

## Data touched

Creates: `ImportSession`, `StagedRow`, `Transaction` (account kind `BANK`), `Account`.
Updates: card `Transaction` links for settlements, `Paycheck` link for salary.
May create: `CategoryRule`, `FixedExpense`, `Debt`/`DebtPayment` from the labeling queue.

## Edge cases

| Case | Behavior |
|---|---|
| Card settlement matches no card statement | Flagged with the last-4 and the amount, plus a shortcut to import that statement or create the account. |
| Bank description has no last-4 | Fall back to amount + date matching at lower confidence; always prompt. |
| Two cards on the same bank with the same last-4 | Impossible in practice, but disambiguate by amount if it happens. |
| Card statement imported *after* the bank statement | On card-statement commit, rescan recent bank rows for now-matchable settlements and prompt then. Order of import must not matter. **Held two ways** (D-060, D-061): the classification is re-derived rather than stored, so there is nothing stale to repair; and `syncSettlementLinks` upgrades an existing link's confidence and period in place while leaving any answer alone. |
| One card, two settlement rows in a month (split charge) | Both matched to the same account; the amount corroboration sums them before comparing. |
| User answers "keep them" | Settlements count as spending and card transactions are what should be excluded instead — offer that inversion explicitly rather than letting both count. |
| Salary split across two deposits | Sum-match within the period against the paycheck net. **Built** — the deposits of a month are one group and are summed before comparing, the same shape settlements are grouped in, so this needs no case of its own. |
| Two months of deposits, one payslip entered | The older month claims the slip and the younger reports having none — which is the honest answer and the one that sends the user to enter the missing slip. |
| Cheque with no payee name | Labeled by cheque number; user names it once. |
| Standing order amount changes | Existing label persists; the amount change surfaces in F09's variance view. |
| Bank statement overlaps a previous import | Row-level dedupe via natural key including asmachta. |
| Foreign transfer | Same `ForeignAmount` handling as F01. |
| Balance check fails | Block commit with a diagnostic showing the first row where the running balance diverges. **Built** (D-063): `commitSession` refuses, and the panel names the row, both figures and the difference. An override is offered behind a deliberate tick, because the check has never met a real bank export and an unoverridable block on a guess this new would be worse than the risk it guards. |

## Acceptance criteria

- Importing a bank statement after the corresponding card statements does not double-count
  a single shekel of spending.
- Monthly expense totals are identical whether or not the bank statement was imported, except
  for genuinely bank-only outflows.
- Running-balance verification passes on real fixture files.
- The labeling queue can be fully skipped and the import still commits cleanly.

## Open questions

- Should bank-only outflows and card spending appear in one merged transaction list or in
  separate views? Recommendation: one list, with a source filter — users think in terms of
  "money out", not "which piece of plastic".
- Should the app detect a *missing* card statement proactively on the Home dashboard?
  Recommendation: yes, it is the highest-value nudge the app can make.
- Standing-order detection could feed F09 automatically rather than via the labeling queue —
  worth doing once F09 exists.

## Related

[F01 Card Statement Import](./f01-card-statement-import.md) · [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md) · [F08 Debts](./f08-debts.md) · [F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md)
