---
type: feature
project: Emerald
milestone: M5
status: domain, schema and all four screens built
---

# F13 — Pension and Hishtalmut Tracking

> **Since M36 U12 a fund is a holding** (D-389): its reports
> are its readings, their deposit tables `reading_deposit` rows, and its payslip lines its
> deposits, worked out on read. The tables this note names are retired; the rules are not.

Track long-term savings vehicles: pension funds (קרן פנסיה), study funds (קרן השתלמות),
provident funds (קופת גמל), and managers' insurance (ביטוח מנהלים).

## Why this feature exists

For most Israeli employees this is the largest financial asset they own, and almost nobody
looks at it. The specific failures are well known:

1. **Nobody knows their management fees.** The gap between a negotiated fee and a default one
   compounds into a very large number over a career, and the fee is a single phone call away
   from being lower. It is invisible because nobody computes what it costs.
2. **Employers deposit late, partially, or not at all.** The payslip says a deduction was made;
   whether it reached the fund is a separate fact that only the fund's report shows. People
   discover multi-year gaps far too late to fix easily.
3. **Money sits in a default investment track** that may not match the person's age or risk
   tolerance, because changing it requires knowing it exists.
4. **Multiple dormant accounts** from previous employers, quietly paying fees on small balances.

The app already knows what the payslip says was deducted ([F04 Paycheck Tracking](./f04-paycheck-tracking.md)). Pairing
that against what the fund actually received turns problem 2 from invisible into a red row on a
screen. That is the highest-value thing this feature does.

## What it tracks

### Fund accounts

One record per fund account the user holds. Related to `HoldingPlace` in
[F07 Savings and Deposits](./f07-savings-and-deposits.md), but with far more structure.

**Every fund is a row on the money map, and nothing here changed to make that true** (D-177, M15).
The question was whether funds should keep their own tables at all; the answer is yes — the three
components, the two fee bases and the payslip reconciliation exist nowhere else — and what changed
is that the map stopped folding them into an anonymous locked subtotal. **The map is a read over
both**: `fundRows` in `savingsRepository` assembles a fund's name, institution, balance and as-of
date, `moneyMap` gives each `TRANSCRIBED` and locked, and the row leads back to this screen rather
than to a holding editor. Nothing in this note writes a `HoldingPlace` and nothing ever should — a
place kept in step with a fund is two records for one fact, and the copy drifts the first time a
fund is renamed.

| Field | Notes |
|---|---|
| `name` | User-facing, e.g. "Menora pension – current job". |
| `fundType` | `PENSION`, `STUDY_FUND`, `PROVIDENT`, `MANAGERS_INSURANCE`, `PROVIDENT_FOR_INVESTMENT`. |
| `institution` | The managing company. |
| `policyNumber` | For reference and for matching statements. |
| `investmentTrack` | Free text plus an optional risk band (e.g. "up to 50 / general / stocks"). |
| `status` | `ACTIVE`, `DORMANT` (paid-up, no new deposits), `CLOSED`. |
| `openedDate` | |
| `employerName` | Which job it belongs to; dormant funds from old jobs are the common case. |
| ~~`linkedDeductionTypeIds`~~ | **Not a field.** The link is `DeductionType.linkedFundAccountId`, which has existed since migration `012`; a list here would be a second name for one fact (D-066, and D-037's argument). |
| `feeOnAccumulationBasisPoints` | דמי ניהול מהצבירה — annual, in basis points of the balance. 50 is 0.5%. Integer, not a decimal (D-066). **Read off the report** and written on accept (D-152) — no equation checks it, so it is typed over on the surface rather than merely shown. |
| `feeOnDepositBasisPoints` | דמי ניהול מהפקדה — basis points of each contribution. |
| `feeNegotiatedUntil` | Fee agreements often expire and silently revert to default. A date field with a reminder is worth more than it costs. |
| `beneficiaries` | Free text. Almost never updated after marriage or children; a nudge field. |
| `notes` | |

**Dormant funds matter.** A ₪40,000 balance from a job three years ago is still paying fees.
The app should make dormant accounts visible rather than letting them be forgotten — that is
half of why this feature is useful.

### Balance snapshots

The user cannot get a live balance without an API the app doesn't have, so balances are
**snapshots** entered periodically — from the quarterly or annual report, or from the fund's
website.

| Field | Notes |
|---|---|
| `fundAccountId` | |
| `asOfDate` | |
| `totalBalance` | |
| `employeeComponent` / `employerComponent` / `severanceComponent` | Optional; the three components have different tax and withdrawal rules and reports usually break them out. |
| `depositsSincePrevious` | What the fund says it received in the period. This is the number that gets compared against the payslips. |
| `feesChargedSincePrevious` | What the fund says it charged. |
| `returnSincePrevious` | The amount the report prints. Never what the app computes. |
| `source` | `MANUAL`, `REPORT_ENTRY`, `IMPORTED`. |
| `depositGapAcknowledged` | The user chased the gap ending here and found it explained. The one stored fact in an otherwise derived feature (D-066). |

Snapshots are a time series. Two snapshots are enough to compute everything below; a handful
per year is realistic and enough.

`depositsSincePrevious` **may be negative** — a severance withdrawal is recorded as exactly that.

### The deposit table a report prints

**Built** as `fund_deposit` (migration `022`, D-153). Many reports print, under the movements, a
table with **one row per deposit**: who paid it, the date it arrived, the **salary month it is for**,
and the employee/employer/severance split. Each row is a `FundDeposit` hanging off the reading that
transcribed it.

**The salary month is why this table is worth having.** Everything else on it the totals already
imply. Without it, a payroll month has to be matched to a deposit date through a guessed lag, and
the honest answer is a running total over a window; with it, the comparison is exact and the lag is
*measured* rather than assumed. It is what turns "the quarter is ₪2,000 short" into "February never
arrived, and January turned up three months late".

Reports overlap — an Israeli quarterly is year-to-date — so two readings will state the same deposit.
Both rows are kept, each reading being a faithful transcription of its own document, and
`distinctDeposits` dedupes by salary month, employer, date and amount wherever anything adds them
up.

### Contribution records

Derived, not entered. Each payslip with a linked deduction type produces an **expected
contribution** for the relevant fund: employee amount, employer amount, and severance amount,
with the payslip period as the date. These are what get reconciled against
`depositsSincePrevious`.

## What it computes

### Expected versus actual deposits

The core check:

- Sum the expected contributions from payslips between two snapshots.
- Compare against the `depositsSincePrevious` the fund reported.
- Classify the gap: within tolerance · **deposits missing** · deposits exceed payslips
  (usually a timing offset, since employers deposit in the following month) · no payslip data
  for the period.

Timing offsets are normal and must not produce false alarms: apply a configurable lag (default
one month) before flagging, and prefer comparing cumulative totals over a longer window than
month-to-month. A persistent, growing gap is the real signal.

Output is one clear sentence: *"Your payslips show ₪18,400 deposited to this fund since
January. The fund reports receiving ₪16,100. ₪2,300 is unaccounted for."* Followed by what to
do about it, because that is the point.

**And the working underneath it** (D-071). `depositPeriods` gives one row per window — the dates,
the salary months compared, what the payslips say, what the fund says, and the difference — so the
sentence is checkable rather than merely believable. The rows sum to the sentence, and a single row
is *not* a verdict: one window is exactly the month-by-month comparison the lag makes unreliable.

**And the sharper working, where the reports printed a deposit table** (D-153). `depositsByMonth`
compares **one salary month against the deposit that names it**, so there is no lag to apply and no
window to smear a late month across: a contribution for 11/2025 that arrived on 04/01/2026 is two
months late, and the row says so. Five outcomes rather than a number and a boolean — matched, money
missing, more than the payslips say, no payslip for this month, no report covering it — because a
month with a deposit and no slip and a month with a slip and no deposit are different sentences.

It **replaces nothing**: a fund whose reports print only totals still has the window answer, which is
the one that always works. Where both run they appear together, the month table above the windows,
and the two agreeing is itself worth something.

**And the base the deposit was worked out on** (D-169). Where the report prints a salary column and
the payslip prints a base on the line feeding this fund, the two are compared — the *Computed on*
column. It is **not** the gross on either side: a pensionable base routinely excludes overtime, a
car allowance and a one-off bonus, so comparing against the gross would report a difference on every
correct slip in the country. The state is `AGREES`, `DIFFERS` or **`UNKNOWN`**, and the third is not
collapsed into the first for the reason a reading's proof has three states (D-149): most reports
print no salary column, and "the two agree" and "there is nothing to compare" are what this check
exists to tell apart. A fund computing on **less** than the employer printed costs a pension without
any amount looking wrong, because the contribution is a percentage of exactly that figure — and no
equation on either document runs through it (D-138, the fifth time).

### Fee analysis

- **Effective fee paid** = fees charged over the period ÷ average balance, annualized. Compare
  against the stated `feeOnAccumulationPct` — a discrepancy means the stated fee is wrong or an
  agreement expired.
- **Fee drag projection.** Given the current balance, expected annual contributions, an assumed
  gross return, and the current fees, project the balance at retirement age, then project it
  again at a lower fee. The compounding itself is `@/domain/projection.ts`, shared with F07's
  savings projection and taking plain basis points rather than a fund's fees (D-072). The difference is the number that makes people pick up the phone.
  Present it as a range across return assumptions, clearly labeled as an illustration and not a
  prediction.
- **Fee benchmark.** Store the regulatory maximum fees and typical negotiated fees as
  **editable reference data**, not as hardcoded constants — the caps and the market both change,
  and stale numbers here would be worse than none. Show where the user's fee sits relative to
  those reference points.

### Returns

- Period return from consecutive snapshots, contribution-adjusted so that new deposits are not
  mistaken for investment gains. A simple approximation (subtract net contributions from the
  balance change) is honest enough at snapshot granularity; label it as approximate.
- Cumulative return over the tracked history.
  > **"Tracked history" is doing a lot of work in that line**, and D-164 made it say so. The figure
  > names the window its readings actually span, and under two years it says the fund is probably
  > older than its transcription and offers the way in — *Read a report* now takes a **stack**, and
  > the format stored by the first accept reads the rest without asking anything. `distinctDeposits`
  > has met its volume: three years of year-to-date quarterlies restate a 36-month history 90 times
  > over and dedupe to 36 deposits. What that unit **also** found is that the dedupe was an ordering
  > as well as a key — see the edge cases below.
- Comparison across the user's own funds — with an explicit note that funds in different
  investment tracks are not comparable on return alone.

**Deliberate limit:** the app does not fetch official fund performance data, does not rank
funds, and does not recommend switching. It reports the user's own numbers and shows what fees
cost. Anything beyond that is investment advice the app has no business giving.

### Household totals

- Total long-term savings across all funds, separated from liquid savings in
  [F07 Savings and Deposits](./f07-savings-and-deposits.md).
- Split by component: employee, employer, severance — because severance has different
  withdrawal and tax treatment.
- **Hishtalmut liquidity dates.** A study fund becomes withdrawable six years after its first
  deposit (or three years in some circumstances). Tracking the first-deposit date and showing
  the liquidity date is a small feature people genuinely want and rarely know.
- Contribution rate as a percentage of gross, per fund and in total.

## Screens

- **Funds** — **built** at `#/wealth` (D-068). Cards per fund: institution, type, balance, as-of
  date with a staleness indicator, fee, and a status chip if deposits look missing. Active funds
  first, dormant funds in their own section with their annual fee cost shown. Each card expands to
  its readings, with Edit and Delete, so a transcribed digit is fixable without waiting for the
  detail screen.
- **Fund detail** — **built** at `#/wealth/:fundId` (D-071). Balance-over-time chart with
  contributions and returns separated; fee panel with effective versus stated fee; the
  expected-versus-actual deposit table by period as the **working behind** the one-sentence verdict;
  investment track, beneficiaries and the readings themselves. A period with no payslips behind it
  shows an em dash, never a zero. *Where the reports printed a deposit table, a **month-by-month**
  table sits above the windows (D-153): one salary month per row, what the payslip said, what
  arrived, when it arrived, and how late it was — measured, not assumed.*
- **Add snapshot** — **built**, and since M13 it **takes the whole window** rather than the fund's
  30rem pane (D-163): a dozen figures copied off paper is not a thing to do in a third of a screen
  beside eleven other funds, and *Read a report* is the same. One way out, top-right. Date, total
  balance, optional components, deposits, fees, return, in the order a report prints them. The components' remainder is shown while they are typed, and
  an empty box means "the report did not say" rather than zero — which is what the reconciliation
  and the fee panel both branch on. *A reading read off a report brings its deposit table with it,
  shown in full above the save button: one action writes the reading and its rows, or neither.*
  *Inside a stack (D-164) the save says it is reading the next one and the exit goes back to the
  stack — one document opened on its own is unchanged, because a batch of one is not a batch.*
- **Read a report, in bulk** — **built** (D-164). The picker takes as many reports as you have and
  they are worked through without leaving the flow: a queue owned by the fund screen, a **fresh
  reader per document** so nothing carries over, and the stack named file by file with what became
  of each. Three verbs — **Discard** drops the reading and keeps the text, **Skip** drops the
  document, **leaving** ends the sitting and says how many it drops. The batch gets cheaper as it
  goes: accepting the first report stores its format and the rest are read by it with no model
  asked anything. Anchored at **one fund**, because a report names none and filing one to the wrong
  fund makes both halves of the deposit check look wrong.
- **Fee impact** — **built** at `#/wealth/fees` (D-072). Current fee versus a target fee across
  three assumed returns, with every assumption a slider: balance, yearly contribution, horizon, and
  all four fees. Each starting figure is read off the document and names its source — the fund's
  latest reading, a year of payslips annualized, the fee as transcribed. A fund with no fee recorded
  starts from the *typical* fee and says so. The answer is a range and it is printed signed, so
  asking "what if my agreement lapses?" gets a negative number rather than a comforting one.

  *Each projected balance is now broken into its three parts (D-082): **what you pay in, what it
  earns, and what the fee takes**, which reconstruct the figure exactly. The fee's share is measured
  against the same projection with the fees set to zero rather than inferred from the rate — a
  charge on the balance is taken out of money that would itself have compounded, so what it costs
  over a career is a multiple of what any one statement shows. The screen was answering "what is the
  fee worth" without ever answering "what am I projected to have", which is the question a reader
  has first.*
- **Deposit check** — **built** at `#/wealth/deposits` (D-072). Every fund's payslips against every
  fund's report in one list, with the gap as the headline and the acknowledgement offered where the
  gap is found. It computes nothing of its own: `fundDepositChecks` is the same call the funds
  screen's chip reads. Funds that **cannot** be checked are listed under their own heading with the
  specific thing each one is missing, because on this screen silence would read as "fine".

These two are the siblings that turned `/wealth` into a section shell, which D-068 deferred and
D-071 deferred again (D-054's rule: a sub-nav of one is furniture). The fund detail moved under the
funds tab at `#/wealth/funds/:fundId`.

## Reachable from a conversation too

**Built (D-112).** The plugin has `funds` and `record_fund_readings`, both wrappers over
`fundRepository` — `listFundsWithLatest`, `fundDepositChecks` and `fundAnalysis` on the read side,
`createFund` and `addSnapshot` on the write. Nothing was added to the domain: the reconciliation,
the returns and the effective fee each come back whole from one call, so a total and the rows under
it cannot disagree with the screen's.

**It shipped with F04's half in the same unit, and that was the point.** Neither a payslip nor a
fund report answers "did my employer actually deposit"; only the two set beside each other do. A
unit that made fund readings writable and left payslips app-only would have shipped the smaller
half of the reason either exists. What the plugin can now say in one answer is this feature's
headline sentence — what the slips say was owed, what the fund says arrived, the difference, and
the employer's payroll department as the next step.

**Naming a fund with `fund_id` gets the working**, which is the funds-screen/fund-detail split said
in words: the list carries the balance, the measured-versus-stated fee and the one-cell verdict,
and the named fund adds its readings, its return window by window, and the expected-versus-actual
table. A single row of that table is still **not a verdict** — the deposit lag makes any one window
unreliable — and the answer says so where the screen relies on layout to. *Where the reports carried
a deposit table, the month-by-month rows come back above the windows, with the lag measured rather
than assumed (D-153).*

**And the write takes the deposit table too** (D-153). `record_fund_readings` accepts a `deposits`
list per reading — the rows as the report prints them — and it **refuses a row with no
`salary_month`** rather than storing it, which is the one place the plugin is stricter than the app.
The app reads a table off a page and a page can print a row it cannot parse; here a person is
transcribing, and a month left out is a month that could have been read. The dry run names the months
it would write rather than only counting the rows, because the value of the table is per month and a
count would be asking for agreement to something it had not shown.

**The write groups its entries by fund**, so four quarterly reports are four readings and one fund.
A `name` attaches to an existing fund or creates it once for the batch, the way a merchant
identifies a candidate in D-111 — because a duplicate fund splits the deposit check in two and
makes **both halves look wrong**, which is worse than recording nothing. The preview says loudly
which of the two it is about to do.

**Every field but the balance and its date is optional, and that is load-bearing.** An absent
component, an absent `depositsSincePrevious`, an absent fee figure each mean "the report did not
say"; a zero would be a claim, and the reconciliation and the fee panel both branch on the
difference. Readings written this way are `REPORT_ENTRY`, which is what they are. Fees are taken as
**basis points** and a non-integer is refused by name — `0.5` meant as half a percent would have
been stored as five hundredths of a basis point.

**And the link is the one it keeps naming.** A deduction type's link to a fund (D-073, `linked_holding`
since D-389) is what produces the expected contributions at all, and a fund nothing points at reports
having no payslip data forever. So `funds` names the funds nothing feeds, `paychecks` prints the column
for every type, and since M36 F1 `set_deduction_types` sets it (D-391).

Editing a fund, correcting a reading, acknowledging a deposit gap and the fee-impact projection are
all app-only, at `#/wealth`. An entry that names an existing fund and also describes it is refused
rather than having those fields ignored — silently dropping a corrected fee would leave the user
believing it had been written.

## Interaction with other features

- **[F04 Paycheck Tracking](./f04-paycheck-tracking.md)** — deduction types link to fund accounts, producing expected
  contributions. This is the dependency; F13 needs M3 to exist first. The link is made on the
  deduction-types screen's **Pays into** column (D-073), which is the only way into it and without
  which every fund reports having no payslips behind it.
- **[F07 Savings and Deposits](./f07-savings-and-deposits.md)** — funds appear in total savings but are always shown as
  locked, never as liquid. The existing recommendation to model pension as a savings goal is
  superseded: pension lives here, and F07 links to it rather than duplicating it.
- **[F10 Statistics and Reports](./f10-statistics-and-reports.md)** — savings rate includes employer contributions; net worth
  includes fund balances, flagged as illiquid. **Held** (D-107): the net-worth screen names the
  funds' share of locked money as its own line, and the history reads the latest snapshot **on or
  before** each month rather than back-dating the current one — a transcribed balance is a reading
  taken on a day, not a series. A fund with no reading at all is counted as a gap in the figure,
  not as zero.
- **[F05 Paycheck Splitter](./f05-paycheck-splitter.md)** — payroll contributions are already out of net and must not be
  allocated again.

## Data touched

Creates/updates: `FundAccount`, `FundBalanceSnapshot` (migration `017`), `FundDeposit`
(migration `022`), fee reference data.
Reads: `Paycheck`, `PaycheckLine`, `DeductionType`.
Derives: expected contributions, deposit reconciliation, fee and return figures.

**Nothing derived is stored.** There is no `contribution` table — the expected contributions are
recomputed from the payslips every time (D-067). The single exception is
`FundBalanceSnapshot.depositGapAcknowledged`, which nothing can recompute.

## Edge cases

| Case | Behavior |
|---|---|
| No snapshots yet | Show contributions from payslips only; prompt for a first balance entry. |
| One snapshot only | Balance shown; no return or fee analysis (needs two points). Say so, don't show zeros. |
| Employer deposits with a one-month lag | Configurable lag; cumulative comparison over a window rather than month-by-month. Where the report prints a deposit table, the lag is read off the row instead (D-153). |
| Job change mid-year | Old fund goes dormant, new fund active; expected contributions follow the employer on each payslip. |
| Fund merged or transferred to another institution | Model as closing one account and opening another with an opening balance, linked so history remains continuous. |
| Severance component withdrawn or left in place | Tracked as its own component; withdrawal recorded as a negative snapshot movement with a note. |
| Fee agreement expires | `feeNegotiatedUntil` passes → surface it, because reverting to default fees is silent and common. |
| Self-employed contributions | No payslip; contributions entered manually and reconciled the same way. |
| Multiple funds of the same type | Fully supported; the dormant-fund view exists precisely for this. |
| Two reports whose deposit tables overlap | Both readings keep their own rows; `distinctDeposits` counts each deposit once (D-153). |
| Twelve of them, read newest-first out of a folder | Same answer, and the survivor cites the **earliest report** rather than the first one opened: `listFundDeposits` breaks the salary-month tie by the transcribing reading's date (D-164). The figures never moved; the provenance did. |
| A deposit row whose salary month will not read | Counts towards the fund and towards no month, and the surface says how many did that. |
| Negative return period | Displayed as negative. Never smoothed, never hidden. |

## Acceptance criteria

- [x] Expected contributions derived from a year of payslips match a hand computation.
- [x] Deposit reconciliation produces no false alarm on a normal one-month employer lag. *Tested as
  a pair: the same figures reconcile at a one-month lag and disagree at zero.*
- [x] Return calculation separates contributions from gains — adding a deposit never shows as a
  gain. *Held by `periodReturn`'s signature, not by care (D-066).*
- [x] Fee projection states its assumptions on screen and changes visibly when they change. *Both
  halves now: every assumption comes back with the answer (D-066), and the screen is that answer
  under a set of sliders (D-072). Checked in the running app — the horizon, the returns and each of
  the four fees each move the three figures.*
- [x] With one snapshot, no derived metric shows a misleading zero. *`NEEDS_TWO_POINTS` is a
  variant of every entry point's return type.*

**Two real reports have now been read** — a pension quarterly (D-152) and a hishtalmut half-year
(D-165), both real, both in the shell against a local model. What they answer of the
questions this paragraph used to ask: the period is **year-to-date**, not since the last reading,
on both; deposits and fees are stated for that whole period; **neither breaks the three components
out**, so `unattributed` is the ordinary case rather than the exception; and both print their
movements as a block that has to be read exhaustively — which is the rule D-152 wrote and D-165
bounded. Still unclaimed: a report from any institution but these two, and any report whose
"return" says whether it is before or after fees.

## Open questions

- **A deposit table can be a *separate document*, and D-153 assumes it is not.** The real
  pension quarterly prints no `פירוט ההפקדות` at all; the table arrives as its own PDF —
  *נספח א' – דוח פירוט הפקדות*. `anchorFundReport` looks for the table's heading under the
  movements of the report it is reading, so that annex read as a report with no movements block and
  a derivation that pointed every field at one figure. **It failed safely** — `does not add up`,
  and a failed reading stores no format — but the salary-month table, which is the one fact on a
  fund report no total implies, is unreachable for this user. The shape needed is a reading that is
  *only* a deposit table, attached to the reading the report proper produced. See
  [08](./08-suggestions-and-open-questions.md).
- **Importing from the Pension Clearing House (המסלקה הפנסיונית) or the standardized annual
  report.** These are structured files and would remove nearly all manual entry, which is the
  main friction in this feature. Format and access need investigation. Recommendation: treat it
  as a spike after M5; if the format is tractable, it becomes the primary entry path and manual
  snapshots become the fallback. Note that the standardized report structure would also suit
  the column-mapper approach from [F01 Card Statement Import](./f01-card-statement-import.md).
  **A standardized report is exactly the case a seeded template covers** — one template read by
  every user of that market, derived once ([F17](../../mapping-templates.md), D-132). The reading
  path it would plug into is built: *Read a report* on the fund detail screen (D-149).
- ~~**A fund report's arithmetic is the weakest verifier of the three**~~ **Answered** (D-149, and
  corrected by the first real report in D-152: the movements block is **exhaustive**, a charge is a
  **magnitude** whatever sign the page gives it, and a report that rounds to the shekel gets half a
  unit of slack per term) by a third state rather than by a rule. A report carries three possible
  equations — opening + deposits + yield − fees = closing, the three components summing to the
  balance, and (D-153) the deposit table's rows summing to what was paid in — and often prints none
  of their terms, so a reading is `proved`, `failed` or **`unchecked`**. A closing balance alone is
  therefore *not* enough of a check, and the surface says so in its strip instead of implying one.
  A missing **fee** is a doubt above the accept, because it is the expensive case: silently wrong,
  compounding for years, and this feature reports on fees specifically. **The second real report
  narrowed it once more** (D-165): a block of five lines and no separate costs, where applying
  *exhaustive* faithfully counted the fee and the yield twice and failed a document that balances
  exactly. A charge anchored to a line an equation term already reads is that term restated.
- ~~**Return assumptions for the fee projection.**~~ **Answered** (D-066): a range, never a number.
  `feeDragIllustration` takes a list of assumed gross returns, defaults to 3% / 5% / 7%, and hands
  every assumption back with the result so the screen cannot show a figure without the assumption
  that produced it.
- Should the app remind the user annually to check fees and update beneficiaries? A yearly
  prompt is probably the single highest-value notification the app could send. Recommendation:
  yes, once the app has any notification surface at all. *Half of it needs no surface:
  `feeAgreementStatus` already reports `EXPIRING_SOON` three months out from
  `feeNegotiatedUntil`, which the funds screen can show as a chip.*
- ~~Should severance (פיצויים) be shown inside the pension balance or separately?~~ **Answered**
  (D-066): separately, and as a **modelling** rule rather than a presentation one. The three
  components were already columns; what changed is that no function hands out a balance without the
  split beside it, and what the stated components fail to account for is named `unattributed`
  rather than folded into one of them.
- **Are the shipped fee caps right?** `src/data/reference/fundFeeReference.ts` ships the regulatory
  ceilings and typical negotiated fees per fund type. They are dated and editable by design, but
  they have **not been checked against the regulator's current publication**. Do that before anyone
  but the author uses the app. See [08 Suggestions and Open Questions](./08-suggestions-and-open-questions.md).
- **Self-employed contributions** have no payslip, and docs above says they are "entered manually
  and reconciled the same way". Nothing entered manually exists yet: `reconcileDeposits` reads
  `ExpectedContribution`, which only payslips produce. The shape is ready — a manual contribution is
  the same record with no `paycheckId` — but the decision about where the user types it belongs with
  the screens.

## Related

[F04 Paycheck Tracking](./f04-paycheck-tracking.md) · [F07 Savings and Deposits](./f07-savings-and-deposits.md) · [F12 Onboarding](./f12-onboarding.md) · [04 Data Model](./04-data-model.md)
