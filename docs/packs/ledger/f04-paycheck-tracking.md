---
type: feature
project: Emerald
milestone: M3
status: built — entry, list, detail and deduction types; not yet tried against a real payslip
---

# F04 — Paycheck Tracking

Record each paycheck with gross, net, and an itemized breakdown of where the difference went.
Feeds the splitter ([F05 Paycheck Splitter](./f05-paycheck-splitter.md)), savings balances ([F07 Savings and Deposits](./f07-savings-and-deposits.md)),
payroll-deducted debts ([F08 Debts](./f08-debts.md)), and every income statistic.

**Built so far:** migration `012` — `paycheck`, `paycheck_line`, `deduction_type` and the ten
built-in types, seeded as rows (D-049) — their two repositories, and `src/domain/paycheck.ts`:
the reconciliation delta and every derived figure below as pure functions, tested against a slip
that reconciles to the agora. One line carries both sides of a deduction, so pension is one type
rather than an `– employee` / `– employer` pair (D-048).

**And the screens below**, at `#/paychecks`: the list with its net trend, the entry form with the
pinned reconciliation strip — the one-tap "add the difference", "copy from last month", and a
deduction picker that leads with recents and can add a type inline (D-050) — and the paycheck
detail with the **gross→net waterfall**, the employer's side in its own block, and the derived
figures beside them (D-051). The form's own logic is `src/domain/paycheckEntry.ts` and the two
charts' arithmetic is `grossToNetSteps` and `netTrend`; all of it is tested there rather than
through the screens.

And the **deduction types screen** at `#/paychecks/deductions` — a **tab of Paychecks** since D-170, not a setting — where the two flags are said in words on every row
— guessed from the kind, *Change* to correct (D-388) — a built-in is editable but never deletable, and a type a paycheck still names is
refused with the reason (D-052). Since D-073 it also carries **Pays into** — which fund a type's
lines are contributions to, which is what turns them into F13's expected contributions. The column
is offered on types marked as saving, since those are the ones whose money can reach a fund, and a
type that is already linked shows its link whatever its flags say.

Since D-077 the same column also offers a **saving goal**, and a slip whose line names one
generates a deposit against it — one per payslip, updated in place when the slip is edited. A line
goes to a fund *or* a goal and never both, since money counted in two places is money counted
twice.

**Not built, and each for a stated reason:** linking a type to a **debt** (the column exists;
`debt` arrives with M6); attaching the slip file (`attachmentRef` is a column with no writer); the
debt payments a saved paycheck should generate, which are F08's half of this feature and arrive
with it.
And **no real payslip has been through any of it** (M3).

## User stories

- As a user, I enter this month's paycheck in under a minute.
- As a user, the deductions I care about (pension, study fund, tax) are already in the list.
- As a user, I can add a deduction my employer has that the app doesn't know about.
- As a user, I see how much of my pension is employer money versus mine.
- As a user, I see whether my itemization actually adds up to my net, without being blocked
  when it doesn't.
- As a user, I see my net income trend over the last year.

## Israeli paycheck shape

The slip has three sides that the model must keep distinct:

1. **Employee deductions** that reduce net: income tax (מס הכנסה), national insurance
   (ביטוח לאומי), health tax (מס בריאות), pension employee share (פנסיה עובד), study fund
   employee share (קרן השתלמות עובד), union dues, loan repayments.
2. **Employer contributions** that never touch net but are real money the user owns or accrues:
   pension employer share, study fund employer share, severance (פיצויים).
3. **Notional additions** that inflate gross for tax purposes without being cash: company car
   value (שווי רכב), meal card, phone value.

Getting this wrong makes savings rate and total compensation nonsense — hence
`reducesNet` and `countsAsSaving` flags on `DeductionType` in [04 Data Model](./04-data-model.md).

## Entry flow

1. Pick period (defaults to the previous month) and payment date.
2. Enter gross and net. These are the two numbers the user can always read off the slip.
3. Add deduction lines: type picker (recents first, grouped by kind), employee amount,
   optional employer amount.
4. Live **reconciliation strip** shows `gross − Σ(net-reducing lines) − net`. Green at zero,
   amber otherwise, with a one-tap "add the difference as Other deduction".
5. Optionally attach the slip file for reference.
6. Save. Any lines with a `linkedSavingGoalId` create savings deposits; any with a
   `linkedDebtId` create debt payments — both idempotent on the source ref.

**Deliberate choice:** net is entered, not computed. The app must never argue with the slip.

**Or read the slips** (D-140, [F17](../../mapping-templates.md)). *Read paychecks* (`#/paychecks/read`,
M28 U3, D-310) takes any number of them, ticks each that reconciles and writes the ticked ones as
paychecks on Write; *Open alone* takes one slip to the single slip's confirm surface, below. That
surface takes the
**PDF** — `pdfText.ts` rebuilds its lines out of glyph positions, right to left where the page is
(D-141) — runs F17's ladder over it — a stored template first, a local model only if one is switched
on — and shows one review surface: the figures the slip's own arithmetic vouches for, apart from
the deduction table, which nothing checks. One accept fills in the form above. It **does not save a
paycheck**: the slip lands where a typed one lands, and step 6 is unchanged.

## Templates and repetition

Most paychecks are near-identical month to month. On creating a new paycheck, offer
**"Copy from last month"** — pre-fills all lines with last month's amounts, leaving them
editable. This turns a 12-field task into a 2-field task in the common case, and is the single
biggest usability win in this feature.

Optionally support multiple employers; the template is per employer.

## Derived figures

Per [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md):

- Total compensation = gross + Σ employer amounts.
- Effective tax rate = Σ(TAX + SOCIAL_INSURANCE + HEALTH) ÷ gross.
- Savings from payroll = Σ lines where `countsAsSaving`, employee + employer.
- Average net over N months, with bonus months detectable and excludable.
- Year-to-date gross, net, tax, and payroll savings.

## Screens

- **Paychecks list** — by period descending, net amount, sparkline of net over 12 months,
  badges for months with no paycheck recorded (a gap is information).
- **Paycheck entry/edit** — as above; reconciliation strip pinned.
- **Read paychecks** — a stack of PDFs, each ticked when it reconciles, written on Write (D-310); its
  readers are the *Readers* tab.
- **Read a payslip** — the confirm surface (D-140), reached by *Open alone*. A PDF in, one accept out, into the form above.
  Since M13 both it and the form are a `FlowFrame` (D-163): the sidebar and the tabs go while they
  run, Accept and Discard are pinned rather than drawn at both ends of a scroll, and **Escape no
  longer discards a half-entered slip from inside a field** — which it did, from any field, for
  three milestones.
- **Paycheck detail** — waterfall from gross to net showing each deduction as a step, plus the
  employer-side block shown separately. The waterfall is the clearest possible presentation of
  this data and worth the implementation effort.
- **Deduction types** (Settings) — manage built-ins and custom types, set flags, and point a type
  at a fund or a saving goal. *Built; a debt is the third destination and waits for M6.*

## Data touched

Creates/updates: `Paycheck`, `PaycheckLine`, `DeductionType` (custom).
May create: `SavingDeposit`, `DebtPayment` (idempotent, linked by source ref).

## Edge cases

| Case | Behavior |
|---|---|
| Two jobs in one month | Two paychecks, same period, different employer. Statistics sum them. |
| 13th salary / bonus | Same period as a regular paycheck → allowed; flagged as irregular so averages can exclude it. This is why the schema does **not** enforce docs/04's "unique per period and employer" — entry warns instead (D-048). The flag is suggested by the >1.5× median test and set only by the user agreeing. |
| Retroactive correction (הפרשים) | Recorded as an additional line or a separate paycheck; user's choice. |
| Negative net | Rejected with a clear message; almost certainly a typo. |
| Missing months | Never fabricated. Statistics show a gap, averages note the sample size. |
| Employer share entered as employee share | Common mistake; the entry screen labels the two columns unambiguously and the waterfall makes the error visible. |
| Editing a saved paycheck | Linked deposits and debt payments are recomputed, not duplicated. |
| Deleting a paycheck | Cascades to its generated deposits and debt payments, with a warning listing what will be removed. |

## Acceptance criteria

- Entering a real slip reproduces its net exactly with a zero reconciliation delta.
- "Copy from last month" produces a valid paycheck with only the date changed.
- Linked deposits/debt payments are created once and only once, even after editing the
  paycheck three times.
- The waterfall's steps sum to net.

## Open questions

- PDF parsing of the slip belongs to **M11** and lands as a pre-filled paycheck form the
  reconciliation strip immediately checks. It was F11's third capability; that note is retired
  and the remote route with it (D-124). **What a model produces is the mapping template, not the
  values** — [F17](../../mapping-templates.md), D-132 — so the second slip from an employer is
  read by executing a stored template with no model at all, and `reconciliationDelta` is what says
  the template still fits. The structured-text extraction for common payroll vendors this note
  used to want a spike for is the same thing under another name: a **seeded template**.
- **Deduction types are not a model's to invent** (D-132). The template says a deduction line lives
  at a label and which side of the slip it falls on; naming it, setting its kind and pointing
  "Pays into" at a fund stay the user's.
- Pension and study-fund *balances* are handled by [F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md). This feature's
  job is to produce the **expected contributions** that F13 reconciles against what the funds
  actually report receiving — which is the mechanism that catches an employer not depositing.
  Linking a `DeductionType` to a `FundAccount` is what makes that work, and it is offered during
  [F12 Onboarding](./f12-onboarding.md).

## Reachable from a conversation too

**Built (D-112).** The plugin has `paychecks` and `record_paychecks`, both wrappers:
`listPaychecksWithLines` and every figure in `domain/paycheck.ts` on the read side,
`createPaycheck` with its lines on the write, then `syncPayroll` — the goal deposits and debt
payments a slip sets off, as a screen runs them (D-377). The reconciliation delta a conversation is shown is
the same `reconciliationDelta` the entry screen's strip shows, rather than a second opinion about
the one number the user is checking against the paper in their hand.

**Before this the surface asked for the document and had nowhere to put it.** The server's
instructions named payslips as a thing to ask the user for by name, told Claude to read the PDF and
say what it contained, and then handed the user back to the app to type the numbers in. That is the
D-109/D-111 tell in its loudest form — not a write missing beside a read, but neither.

**The vocabulary comes back with every read, always.** A line cannot be written without the id of
the deduction type it names, and the app has that as a picker beside the form; ten rows on every
call is cheaper than the round trip it saves (D-110). It is also what makes the *empty* answer
useful, which is where it matters most: a document with no payslips still hands over everything
needed to write the first one.

**What the conversation had to be told, and the screen did not: `Pays into`.** A pension line
becomes an expected contribution only because its type points at a fund (D-073), and a document
where nobody made that link has every fund reporting "no payslip data" forever, however many slips
are recorded. Setting it is app-only. So the read prints the column for every type and the write
names the saving deductions in a batch that point at nothing.

**A non-zero delta is still never a refusal**, because the app does not argue with the slip: the
difference is named, *over-itemized* names its likely cause, and the write goes ahead. What is
refused is `validatePaycheck`'s list, a deduction type the document does not have — which points at
`ded:other` with a note, or at `set_deduction_types` to make the type first — and nothing else. A second slip for
a salary month is allowed and flagged, because a 13th salary is exactly that and nothing
deduplicates.

Editing a slip, deleting one and marking a month as a bonus month are app-only, at `#/paychecks`.
Everything the deduction types screen does, `set_deduction_types` does too (D-391, D-392).

## Related

[04 Data Model](./04-data-model.md) · [F05 Paycheck Splitter](./f05-paycheck-splitter.md) · [F07 Savings and Deposits](./f07-savings-and-deposits.md) · [F08 Debts](./f08-debts.md)
