---
type: notes
project: Emerald
---

# 08 — Suggestions and Open Questions

Things the original requirements didn't settle, gaps worth closing, and recommendations.
Each item states the issue, the recommendation, and where it lands. Nothing here is decided —
when one is decided, move it to [09 Decision Log](../../09-decision-log.md) and delete it from here.

---

## A. Gaps in the requirements that need answers

### A1. Refunds and credits will corrupt statistics if ignored

Not mentioned in the requirements, but every card statement has them. If a ₪300 refund is
treated as a ₪300 expense, category totals are wrong by ₪600.

**Recommendation:** signed amounts plus an explicit `direction` field from day one
([04 Data Model](./04-data-model.md)), refunds reported separately with a net toggle. Cheap now, painful to
retrofit. **Land: M1.**
Answer: I agree with the recommendation
### A2. Installments were mentioned only implicitly

Israeli card statements are full of תשלומים. A ₪12,000 purchase in 12 payments shows as
₪1,000 per month across a year. Deciding late whether statistics count the slice or the
purchase means recomputing everything.

**Recommendation:** count the **slice charged in the period** (the money that actually left),
store the group link so a purchase-basis view can be added later. **Land: M1.**
Answer: Do it.
### A3. The card's monthly charge will double-count against bank import

Once bank statements are imported, the single "Cal — ₪4,210" line in the bank statement is the
same money as 60 card transactions. Without reconciliation, every month doubles.

**Recommendation:** match the settlement row to the card account by the **last four digits** in
its description, corroborate against the card's transaction total for the period, and ask the
user once whether to exclude it — remembering the answer per card
([F06 Bank Statement Import](./f06-bank-statement-import.md), [09 Decision Log](../../09-decision-log.md) D-014). This is the reason bank import is a
separate feature note rather than "F01 with another mapping". **Land: M5.**

The last-4 is collected during [F12 Onboarding](./f12-onboarding.md) so the question never has to be asked
mid-import.

### A4. Salary appears twice for the same reason

Paycheck entry and the bank deposit are the same money.

**Recommendation:** same reconciliation pattern; the paycheck is authoritative for income.
**Land: M5.**

### A5. Payroll deductions must not be subtracted twice in the splitter

Pension is already out of net. If it's also a "fixed monthly expense", the splitter subtracts it
again and every plan is wrong.

**Recommendation:** `matchKind = PAYCHECK_DEDUCTION` fixed expenses are excluded from the
splitter's subtraction, with an explicit test ([F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md)). **Land: M4.**
**Landed** (D-053), and as a function signature rather than a discipline: `fixedExpenseBasis` is
the only thing that decides what comes off the basis and it returns a total, so there is no
version of the arithmetic that can forget. The test follows one pension line through both halves.

### A6. Three different dates exist and were treated as one

Purchase date, charge date, and billing period are all different, and "which month was this
in?" has three different answers.

**Recommendation:** store all three; default statistics to charge date; make the basis a setting
that flows through every query ([05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md)). **Land: M1.**

### A7. "Infer fixed expenses from the latest 3 paychecks"

Three months is the minimum that distinguishes recurring from coincidental, and it structurally
cannot see bimonthly water bills or annual insurance.

**Recommendation:** default 3, configurable to 6 and 12; detect non-monthly cadences separately
and mark them low-confidence until enough history exists; amortize them into the monthly
projection while showing the real charge month. **Land: M4.**

---

## B. Recommended additions

### B1. "Fixed" and "necessary" are different axes

A gym membership is fixed but discretionary. Rent is both. Knowing which fixed costs could be
cut is more useful than knowing the total.

**Recommendation:** add `isDiscretionary` to `FixedExpense`, and surface "committed vs
cuttable" in the splitter. Small change, high value. **Land: M4.** **The column landed** with
migration `013`; the "committed vs cuttable" view is still owed and waits on the screens.

### B2. Net worth

Once savings and debts both exist, liquid savings minus outstanding debt is one query away and
is the number people actually care about.

**Recommendation:** add to the Home dashboard and to trends. **Land: M6.** **Built** (D-107), at
`#/wealth/worth` and with its own 24-month line rather than as a row in the trends screen — it
reads none of the ledger, which is what the rest of that screen is about. It is **two** figures:
this note's "liquid savings minus outstanding debt" is the *settle-up* question, and it differs
from "what am I worth" by the whole of the pension, so both are printed. Also on the home
dashboard, as this note asked.

### B3. Liquid versus locked

Total savings is misleading when most of it is pension. An emergency fund in a locked deposit
isn't an emergency fund.

**Recommendation:** `isLiquid` on `HoldingPlace`, and always show the liquid subtotal next to
the total ([F07 Savings and Deposits](./f07-savings-and-deposits.md)). **Land: M5.** **Done at the
domain level** (D-074), and stronger than "always show": `liquiditySplit` reports both sides of
every total with F13's funds inside the locked one, an unrecognized place is counted as locked
rather than reachable, and the emergency figure has no parameter a total could be passed into. The
subtotals are the screens' to display; they cannot be computed wrongly.

### B4. Local on-device categorization before remote AI

A nearest-neighbor match against the user's own already-labeled merchants would likely handle
most of what remote AI would — with no key, no network, no privacy tradeoff, and no cost.

**Recommendation:** build it *before* any model-backed categorization. It may make that capability
unnecessary outright — and it is now the only route left, since D-124 removed the remote one.
**Built** (D-151), and it did make it unnecessary: bulk categorize proposes the category of the
nearest merchant the user has already filed and **prints that merchant's name beside it**, with the
confident ones as one accept. No model, no network, no key. The measure is containment over
weighted tokens with a credit for a shared first word, and a token before a `*` is discounted,
because a statement writes `PAYPAL *STEAM` precisely to say the first half is not the shop. Growing
the rulepack was split off by D-116 and is done in M6.5 (D-120).

### B5. Export and backup are not optional

An offline app with no export is one phone loss away from total data loss, and the user is
migrating off a spreadsheet they currently own completely.

**Recommendation:** ~~full JSON export/import in M6.5, non-negotiable. Rule-set export too.~~
**Overtaken by D-021 and cut by D-116.** The document *is* the export: a `.emerald` is a
plain SQLite file, `sqlite3` opens it, and copying it is the backup. What was actually missing
was a spreadsheet, and **CSV export shipped in M6.5** (D-119). Rule-set and mapping export were
dropped for having no named reader.

### B6. Transaction splitting across categories

A ₪600 supermarket receipt that is half groceries and half household goods. Genuinely common.

**Recommendation:** design the `TransactionSplit` child table now (a transaction either has a
`categoryId` or a set of splits summing to its amount), build it in a later milestone. Designing
for it now costs nothing; retrofitting it touches every statistics query.

### B7. A "verify my import" affordance

Statement files print their own totals in the preamble. Comparing the parsed total against the
printed total catches parser bugs immediately, and is the single cheapest correctness check
available.

**Recommendation:** show it on the import review screen, and use running-balance verification
for bank files. **Land: M1 / M5.**

### B8. Missing-statement detection

If a bank settlement exists with no matching card statement, a whole month of spending is
invisible and every statistic is silently wrong.

**Recommendation:** surface it on the Home dashboard. Highest-value nudge the app can make.
**Land: M6.**

### B9. Write a rule from the provider category of a row you are looking at — BUILT

**Built as a button** (D-080): *Create a rule from the provider's category*, on the transaction
detail panel beside *Make a rule for this merchant* (the offer since D-373), opening the rules editor pre-filled through
the same router-state hand-off, with the breadth stated under it in words. The reservation below is
why it is a deliberate button in front of the editor rather than a one-click offer — that part
still holds, and is the argument to re-read before making the **Provider said** *value itself*
clickable (docs/08 F3).

**Low priority, and the reason is the data.** A provider category is vague: it is a broad bucket
the card issuer chose, [04 Data Model](./04-data-model.md) and its `term` row both call it "an
input to rules, never authoritative", it is frequently empty ([F03 Auto Categorization
Engine](./f03-auto-categorization-engine.md), Edge cases), and one rule made from it can claim
hundreds of rows at once. That is the opposite of the merchant case, where the rule written from
a row covers the shop in front of you. A rule this broad wants to be written deliberately and
checked in the test box, not produced by one click from a ledger row — so the affordance is
worth having and is not worth hurrying.

Two things to settle when it is picked up, neither incidental:

- **A context menu would be the app's first.** There is no right-click anywhere in the app today,
  so the first one decides the pattern — and needs a keyboard equivalent, since
  [conventions](../../conventions.md) makes keyboard navigation part of done for any screen with a
  table. **The detail panel's button was the cheaper shape and is what D-080 built.** It remains
  the whole answer until F3's merchant-substring gesture needs a menu anyway.
- **The matching is exact and whole-string.** `PROVIDER_CATEGORY` compares the cleaned,
  case-folded provider string in full; there is no contains or regex over it. Fine for Cal and
  Max, whose categories are a small closed vocabulary, and worth re-checking against the first
  provider that ships freeform ones. **Still true and still unchecked.**

*Separately, and not the same idea:* the document already knows which provider categories its
own rows carry, so "your statements use 6 distinct provider categories, 4 of them unmapped" is a
list the app could offer to work through in one pass. That belongs with bulk categorize rather
than with a context menu, and is recorded here only so it is not re-invented from scratch.
**Still open after bulk categorize shipped** (D-047): that screen groups by merchant, which is the
question that actually clears a backlog. Grouping the same rows by *provider category* is a second
pass over the same pile and would have been a second control on a screen whose whole argument is
one decision per shop. Worth revisiting once someone has a real backlog that merchant grouping did
not flatten.

---

## C. Open design questions

### C1. Internal transfers: one row or two?

**Recommendation:** two rows (one per side), linked by a `transferGroupId`, both excluded from
income and expense statistics. Modeling them as one row makes the bank account's balance
verification fail.

### C2. Should percentages in the splitter be of net or gross?

**Recommendation:** net, always. Gross-based percentages are a reliable route to self-deception.
Show the gross percentage as a secondary, display-only figure.

### C3. Should the splitter allow allocating more than the paycheck?

**Recommendation:** yes, clearly labeled as a drawdown from savings. Planning a month where you
knowingly dip into savings is legitimate.

### C4. Learned rules: exact match or contains?

**Recommendation:** exact by default, with a one-tap "loosen to contains" on the confirmation.
Exact is predictable; contains creates surprises the user didn't ask for.

Decided in [09 Decision Log](../../09-decision-log.md) D-042: exact, over the **normalized** merchant
— which by then already had the branch number stripped, so the drift this question was really
about was gone before either kind saw the string. The rule written by hand from a row stays
`CONTAINS` (D-041), and the difference is review rather than matching: only one of the two paths
shows an editor before saving. D-043 then made what to match on a **field**, so the loosening is
usually done by shortening the name rather than by the tap.

### C5. Debt amortization

Proper principal/interest splitting is realistic for a mortgage and overkill for a small loan.

**Recommendation:** v1 treats payments as all-principal with a manual override. Add an optional
amortization generator for `MORTGAGE` and `BANK_LOAN` later.

### C6. Charting library versus hand-rolled — RESOLVED

Decided in [09 Decision Log](../../09-decision-log.md) D-019: hand-rolled SVG components. D-019 kept `d3-scale` / `d3-shape`
for the math; no chart ever imported them, and M45 U2 removed both. Every charting library would fight the design language rather than serve it,
and the six types needed are all simple.

### C7. Manual column mapper — RESOLVED

Decided in [09 Decision Log](../../09-decision-log.md) D-013: the mapper is the primary mechanism, in M1, not a
fallback. The app guesses and pre-fills; the user confirms. Kept here only to record that the
earlier "defer it" recommendation was reversed.

### C8. Pension balances versus contributions — RESOLVED

Decided in [09 Decision Log](../../09-decision-log.md) D-015: funds are their own aggregate with transcribed balance
snapshots, not savings goals with a contribution stream. See [F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md).

### C9. Should import mappings be shareable?

A mapping authored once is useful to anyone with the same card. Exporting them as JSON costs
almost nothing and makes community-maintained mappings possible later.

**Recommendation:** ~~export/import alongside the rule-set export in M6.5.~~ **Cut by D-116**,
with the rule-set export, for want of a named reader — revive it the day somebody actually wants
to hand a mapping to another person. Either way, stop short of any fetching mechanism: that would
break the zero-network property in D-012.

*Half-answered by D-132.* A **seeded template** is the sharing mechanism, minus the sharing: one
mapping authored once and **shipped in the bundle**, which is what the app already does with
`il-core.json`. User-to-user hand-off is still unbuilt and still wants a named reader.

### C10. Should the mapping guesser learn from corrections?

If the user always remaps a given header name to the same role, the local alias table could
learn it.

**Recommendation:** yes. Low cost, and it makes the app better the more it is used. Same
learning pattern as [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md).

*Reframed by D-132.* The unit that learns is the **template**, not the alias table: a confirmed
mapping is stored against the format's signature and never re-derived over, which is the same rule
as "user overrides win". Teaching the alias table as well is now optional polish rather than the
mechanism — and it is the one place the tables would still be allowed to grow, because it grows
from the user's own corrections rather than from a hand-authored market list.

*And the other half arrived* (D-150): where the guesser is wrong, **Work out the columns** asks a
local model for the whole map at once, on the grid, verified by the live parse and the printed
total. That is a proposal rather than a learned alias, so the alias table is still untouched — and
the question of whether it should learn is now one the mapper can answer without it.

### C14. How many real payslips and fund reports have a text layer?

D-132's label-anchored template assumes the words on the page can be *read*. A generated PDF from
a payroll system has a text layer and anchoring is straightforward; a scan or a phone photo needs
OCR before any of it applies, which is a vision model rather than a text one and a different
quality floor entirely — in Hebrew especially.

**Recommendation:** count them before scheduling. The mix in real documents decides
how much of [F17](../../mapping-templates.md) lands in M11 and how much waits. Nothing else in the
design changes either way; the ladder's third rung — the manual mapper — is the floor regardless.

### C16. The deposit table arrives as its own PDF, and D-153 assumes it does not

Found the same afternoon, on the same stack. The real pension quarterly prints **no**
`פירוט ההפקדות` under its movements; the per-deposit table is a separate download —
*נספח א' – דוח פירוט הפקדות*. D-153 anchors the table by its heading **inside the report being
read**, so the annex went through the ladder as a report in its own right: no movements block, a
derivation that pointed all five equation terms at one figure, `does not add up`, and — correctly —
no format stored.

**It failed safely, and that is the only good part.** The salary month is the one fact on a fund
report that no total implies (F13), the whole of D-153 exists to capture it, and for this user it
is in a file the app has no way to read.

**Recommendation:** a second reading *kind* — a document that is only a deposit table, attached to
the fund and, where the dates line up, to the reading the report proper produced. Most of it is
built: `readDepositRows` finds a table by its columns, `replaceSnapshotDeposits` writes one whole,
and `distinctDeposits` already expects overlap. What is missing is a path into the ladder that does
not require a movements block, and a surface that says *this is a table, not a reading* — because a
deposit table with no balance beside it can prove itself with D-153's third equation and nothing
else. Size it in the second interface pass; it is a real gap, not a polish item.

### C15. One line, two rates — an anchor cannot say which

Found on the **second real fund report ever read** (2026-08-28, alongside D-165). An Study Fund Co
hishtalmut statement prints its two management fees on one line —
`דמי ניהול מחיסכון 1.00%  מהפקדה 0%` — and the fund's *market average* on the line under it. A
template anchors a **line** (D-137: no leaf of a task schema holds a figure), and
`readRateBasisPoints` takes the rate it finds there, so the deposit fee came back as **1.00%**,
which is the accumulation fee, and the accumulation fee came back as **0.60%**, which is the
average printed for information. Both wrong, and the report says nothing that could catch it —
no equation runs through a fee *rate*.

**Nothing was harmed**, and that is the point worth recording: D-152 already made these four facts
**typed over** rather than ticked, the surface already warns that a report prints the market
average beside your own rate, and a correction retargets the anchor. The system behaved exactly as
designed. What is *missing* is any way for it to be right on its own.

**Recommendation:** teach `readRateBasisPoints` to prefer the rate whose own label matches the
field — `מהפקדה` for the deposit fee, `מחיסכון`/`מהצבירה` for the accumulation one — and fall back
to the first rate on the line when neither appears. It is a small function and the labels are
already the thing templates are anchored by. It is **Hebrew label matching inside a reader**,
which is M12's territory, so it either goes in with a locale hook or waits for
one. Do not let a model pick between the two rates: that is a figure, and D-137 says no.

### C12. The natural key cannot detect an amended row — the two specs conflict

Found while implementing dedupe in step 3. [04 Data Model](./04-data-model.md) puts the absolute
amount *inside* the natural key. [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md) says a row
"matching an existing natural key with a different amount" is marked `UPDATED`. Both cannot
hold: if the amount is part of the key, a corrected amount produces a different key, and an
amended row reads as a new one. The ledger then carries both the old and the corrected charge.

Exact idempotency — re-importing a file changes nothing — works today and is tested. It is the
amended-statement case that is unimplemented, and it will silently double a corrected row.

**Recommendation:** keep the natural key as specified, and add a second, amount-free
`amendmentKey` (account · transaction date · normalized merchant · installment sequence) used
only to look for candidate amendments. A row whose amendment key matches but whose natural key
does not is a candidate `UPDATED`, shown as a before/after diff and never applied silently.
That preserves exact dedupe while making the amended case detectable. Do it when the import
review screen exists to display the diff — it needs somewhere to be shown, and until then the
right behaviour is not to guess.

### C11. Return assumptions in the pension fee projection

Any single assumed return rate is a guess, and a projection stated as one number reads as a
promise.

**Recommendation:** always show a range (conservative / moderate / optimistic), state the
assumptions on screen, and never call it a forecast.

### C13. Is sample data worth building for onboarding? — RESOLVED

It costs real effort and risks polluting a real database.

**Recommendation:** only if the first-import step proves to be where people drop off. A
well-designed empty state is usually enough and carries no risk.

**Resolved 2026-08-10, as recommended:** not built. F12 ships without it, and every empty state
names a concrete next action instead. Worth revisiting only if the first-import step turns out to
be where people stop. (Renumbered from C12, which this doc had used twice.)

---

**C14. There is nowhere to see the mapping templates, and three things combine to make that
hurt. — RESOLVED** Reported from real use after reading January, July, February and June in that
order: a bad format was saved, and afterwards slips seemed to be read by "a random one of the same
keywords".

It is not random, and each part is a decision working as written:

1. **The matcher prefers the most recently used.** `matchLabelTemplate` takes an exact signature
   outright, otherwise the closest, and ties go to the first candidate — and `readableTemplates`
   orders **most recently used first**. Alternating between two slips of one employer therefore
   alternates the winner.
2. **One employer can produce two signatures.** A natively-read slip and an OCR-read one give
   *slightly different labels* (D-146, D-147), so they sign differently even though a person would
   call them one format. Nothing is wrong with either; they simply are not the same string.
3. **A template is stored whenever the slip reconciled** (D-139), so a wrong-but-reconciling
   template is kept and is indistinguishable from a good one — which is D-138's finding again, in
   the store rather than in a column.

What is missing is a **screen** — list, rename, delete, and which format last read what — and a way
to **pick a format by hand** on the confirm surface, which is what turns a wrong match from a dead
end into a click. **Merging** two templates that are really one format is the harder question and
may not need answering at all if deleting one is easy. Whether the match should prefer *most used*
over *most recently used*, or refuse to choose and ask, is the design question this opens.

**Resolved 2026-08-27, as recommended (D-148):** `/settings/formats` is the screen, and the confirm
surface has a "Read with" picker. **The matcher is unchanged** — the ranking question is answered by
not asking it, because a better guess is still a guess and the reading is judged by arithmetic
either way; what was wrong was that the guess was invisible and final. Merging was not built and is
not expected to be: a chosen format stores a second row under this document's labels, which is a
merge in the only sense that matters, and deleting the other one is a click. Two rows sharing a name
are no longer flagged as reading alike, because that is what a resolved case looks like.

## D. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Statement formats change | The app would break silently | User-owned mappings; close-signature match reopens the mapper with changed columns highlighted |
| **User maps a column wrongly** | Correctness now depends on the user's mapping, which is the cost of the flexibility | Live parse preview, parsed-total-versus-printed-total check, editable mapping and re-importable file |
| Hebrew RTL rendering inside an LTR UI | Merchant names with digits visibly scramble | Bidi isolation in every text component; test fixtures with digits and punctuation |
| **Feature breadth for a solo project** | Thirteen features is a lot; motivation dies in the middle | Milestones each end in something usable; M1 alone replaces part of the spreadsheet; M6.5 is a legitimate stopping point |
| Wrong numbers | One incorrect total destroys trust permanently | Invariant tests, drillable aggregates, verification against statement totals |
| Schema churn | Late realizations force migrations over real data | Design A1–A6 and B6 into the schema now, even where unbuilt |
| Over-automation | Silent inference the user didn't ask for feels like losing control | Everything inferred goes to a confirmation queue; manual always wins |
| **Pension data goes stale** | Snapshots are manual, so a fund's numbers can be a year old and silently wrong | Prominent as-of staleness indicator; no derived metric shown from a single snapshot |

---

## E. Small things worth not forgetting

- **Nothing in the app writes an exchange rate** (found at M16 U12, D-207). `fx_rate` has a
  repository, a `convert` and a whole decision behind it (D-184), and `recordRate` had no caller
  outside its own test — so a position held in dollars has been permanently `UNCONVERTED` since M16
  opened, named on the Investments screen with a remedy that did not exist. `record_exchange_rates`
  in the plugin is now the only way to write one, which makes the plugin load-bearing for an app
  figure and is the wrong shape. The app owes a place to type one: the statement reader's confirm
  surface already knows the currency it just read, which is the cheapest of the three candidates
  (the other two being the Investments screen and a settings row).
- Seed the app with the user's existing mapping spreadsheet — it is the best source for the Cal
  and Max header aliases and probably for the first rule set too. Transcribe it in M1.
- Anonymize real statement files before committing them as test fixtures.
- Test fixtures should cover file *shapes*, not providers: separate debit/credit columns, a
  multi-section file, trailing-minus amounts, two-digit years, a header on row 9.
- Ask for the card's last 4 digits during onboarding. It costs one field and it is what makes
  settlement matching work later.
- Show dormant pension funds prominently with their annual fee cost. A forgotten ₪40,000 account
  quietly paying fees is the kind of thing this app exists to surface.
- A fund with one snapshot has no return and no effective fee. Say "not enough data yet", never
  show 0%. *Done in the domain: `NEEDS_TWO_POINTS` is a variant of every F13 entry point's return
  type, so a screen cannot render the zero by forgetting to check (D-066).*
- **Check the shipped fee caps against the regulator before release.**
  `src/data/reference/fundFeeReference.ts` ships the ceilings and typical negotiated fees per fund
  type. They are dated, sourced and editable by design, but they were written from general knowledge
  and have not been verified against רשות שוק ההון's current publication. A wrong ceiling turns
  "your fee is above the cap" into a false accusation, which is worse than showing no benchmark.
- ~~**Two names in `electron-builder.yml` are placeholders the author has to confirm** (D-129).~~
  *Settled before anything shipped: `author` is `Kfir Raphael Eliyahu` (D-430) and `appId` is
  `com.kfireliyahu.emerald`, a domain he controls (D-449). `app.setAppUserModelId` in
  `electron/main.ts` changes with it, and neither changes again once a release ships.*
- **The installer registers the association but never tells the shell** (D-129). electron-builder's
  `installSection.nsh` inserts `registerFileAssociations` — the `HKCU\Software\Classes` writes —
  and does *not* follow it with `SHChangeNotify(SHCNE_ASSOCCHANGED)`; that call exists in
  `FileAssociation.nsh` as the `UPDATEFILEASSOC` macro and is used only by the *uninstaller*. On a
  first install this is very likely invisible, because a brand-new progid has nothing cached. On a
  **reinstall whose document icon changed**, Explorer can keep drawing the old one until the icon
  cache is cleared or the user logs out. The fix if it ever shows up is one line through
  `nsis.include`. Not built, because it has not been seen to matter. **The first install has now
  been done on this machine and the association worked immediately**, which is exactly what the
  paragraph above predicts — a brand-new progid has nothing cached. The case that would show the
  bug is a *reinstall with a changed document icon*, and that has not happened yet.
- **The README says MIT and there is no `LICENSE` file.** One sentence of the README has been
  making a licensing claim the repository does not back up, and `package.json` now says `"license":
  "MIT"` as well. Writing the file needs a copyright holder and a year, which is the author's to
  state, not a detail to guess.
- A "why is this in this category?" tap target on every transaction is one line of UI and the
  entire trust story for [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md).
- Show the uncategorized count somewhere permanent. A hidden backlog is an abandoned backlog.
- Zero and "no data" are different. Never render a missing month as ₪0.
- Every screen needs an empty state written before the screen is built, not after.
- **`findPrintedTotal` scans the preamble, so a date there can be read as the total.** The scanner
  looks for a total-ish label in the rows above the header as well as the rows below the data,
  which is right — Israeli card statements print `סכום לחיוב` up top. But it takes the first number
  to the right of the label, and a very ordinary preamble line like `עסקאות לחיוב ב-02/08/2026`
  therefore reads as a printed total of **2,026**. The parse then "disagrees with the file" for a
  file that never stated a total at all. Found while building an ingestion fixture (D-100); it
  misfires in the app identically, where it shows as a red figure on the review screen. A four-digit
  number that is a plausible year, with no separator and no decimals, is probably not an amount —
  but "probably" is doing work there, and the fix wants a real statement to test against.

---

## F. The author's second list (2026-08-28)

Handed over mid-M13, and **none of it is in M13** — that milestone is scoped as a first pass on
purpose and the roadmap says in writing that a milestone which absorbs every new request never
closes. Each item below states what is actually built today (checked, not remembered), what is
being asked for, and where it should land. **F1 could not be built as described and now has its
answer** (D-159: transcribe, D-124 stands). **F2 is built** (D-160).

### F1. Investments are barely modelled, and a price feed is a network call

**What exists.** A `HoldingPlace` of kind `INVESTMENT` holding a cash balance, built out of
`SavingDeposit` rows. That is all. There is **no security, no ISIN or ticker, no quantity, no cost
basis, no price and no per-account composition** anywhere in the schema. The author's "not done
well at all" is exact: an investment account today is a number you type in, indistinguishable from
a savings envelope.

**The ask.** A separate *Investments* tab. Multiple investment accounts, each holding a mix of
securities. Enter holdings by security id and quantity, plus a purchase history — or import an
account report. And a transfer into an investment account is **not** one thing: it is cash in,
which then becomes several securities, so the transfer and the holdings must be connected without
being the same record.

**Security ids exist and there are three of them**, which is a modelling decision rather than a
detail: **ISIN** (12 characters, globally unique, what an Israeli broker's report prints),
**ticker + exchange** (short, human, ambiguous on its own — `TEVA` is two listings), and for TASE
a numeric **מספר נייר ערך**. *Written before a real statement was read: an Israeli broker's report
prints the **number** and no ISIN at all, so there are **two** keys with a unique index each — the
ISIN and the security number — and only the ticker is a label (D-194, D-195).*

> **The blocker: "use api of stocks" is the one thing this app has never been allowed to do.**
> D-124 and [conventions](../../conventions.md) are absolute — the renderer cancels every request that
> is not `app://`, `blob:` or `data:`, `localhost` included, and there is a test asserting it. The
> only sockets in the product are `electron/runtimes.ts`, `electron/generate.ts` and — since M16,
> off by default and behind a single-host allowlist (D-178, D-187) — `electron/prices.ts`, in the main
> process, refusing everything that is not loopback. A price feed is a **remote host**, and no
> amount of "only on demand" makes it loopback. Reaching for one means **reversing D-124**, which
> also ends "works with the network off", the offline guarantee in the README, and the sentence
> that nothing about this person's money leaves the machine.
>
> **And it is not needed to build the feature.** The expensive half — quantity, cost basis,
> composition, realised and unrealised gain — is all *transcription*, and this project has already
> solved transcription twice. **An investment account report is the same document problem as a
> pension report**, which F17's ladder reads today: a label-value half (account number, total
> value, period) and a **tabular half whose rows have no labels and whose count changes every
> statement** — which is exactly `fund_deposit` and D-153, heading anchor and column order, rows
> found by shape. A holdings table is that table with different columns.
>
> **What a price feed actually buys is one column**: today's value between two statements. The
> honest alternatives, cheapest first — (a) **the report is the price**, valued as of its own date,
> the way every fund reading in this app already is (D-149, and F13's deliberate exception to
> "balances are always derived"); (b) **type a price** for a security when you want a fresher
> number, timestamped and visibly hand-entered; (c) **paste a quote**, same thing with less typing.
> None of them touch a socket.

**Answered, 2026-08-28: transcribe. D-124 stands — see D-159.** A security's value comes off the
statement the user already has, valued as of that statement's date, with a typed price as the
escape hatch. Build it as **F18 + a milestone of its own**, on F13's shape and F17's ladder, with
**no network**:

- `security` (ISIN as the natural key, ticker, name, currency, kind), `investment_account`
  (an institution and a `HoldingPlace`), `holding_reading` (a transcribed snapshot: account,
  security, quantity, value, as-of date — the `fund_reading` pattern, one row per security), and
  `security_trade` for the purchase history when the user has it.
- **The transfer stays a `SavingDeposit`** into the account's **cash holding** — cash in, and an
  ordinary holding since D-175 — and the
  composition comes from the readings. They **reconcile** rather than nest, which is D-153's
  answer to the same question about deposits versus balances, and F13's shape everywhere:
  transcribe faithfully, reconcile afterwards.
- Currency is the trap. A USD-denominated holding in an ILS document is `Money` in two currencies
  and a rate that belongs to a date; `ForeignAmount` already carries that shape for a transaction
  and is the thing to copy rather than reinvent.

**Landed as M16** on 2026-08-29, on the record M15 gave it: a position is a
`holding` (D-175) and cash in the account is another, which is what lets the transfer in and the
composition reconcile without nesting. **The price question reopened and was answered further**
(D-178): a fetch is allowed, opt-in and from the main process only, *after* the transcription path
works — D-159's answer is the floor, not the ceiling. **The milestone keeps a seven-unit tail**
opened by its first real broker statement (D-194); the roadmap has them in order.

### F2. "This pays a card" is invisible unless you go looking for it

**What exists, and why it gets missed.** The machinery is complete and the *placement* is the bug.
`SettlementPrompt` — "3 credit-card charges found in your bank statement" with exclude-all,
keep-all and per-group answers — is rendered in exactly **one** place: `#/settings/accounts`
(D-064 put it there deliberately, because a card statement imported today can turn a bank row from
six weeks ago into a settlement, and there is no review screen open to hang it on). That reasoning
is right and the conclusion is incomplete: it is now a prompt on a settings screen nobody opens
after an import. The import result screen offers one sentence and a link, and it is dismissed by
pressing the obvious button. `DetailPanel`'s "This pays a card" select is per-row and only found by
someone already suspicious.

**The gap is one line long.** `domain/home.ts`'s `attention` list — the ranked "what wants you" on
Home — has five kinds and **none of them is a pending settlement**, even though a pending
settlement is the highest-consequence item in the app: until it is answered, *the month is double*.
It outranks uncategorized on the list's own logic.

**Built, 2026-08-28 (D-160)** — and the placement was only half of it. **`onSetLast4` did not
rescan**, so the ordinary sequence (import the statements, then type the card's digits in) produced
no link and therefore no prompt, ever. The queue was complete and had never been asked. It rescans
now on a last-4 change and on account creation; `PENDING_SETTLEMENTS` is an `AttentionItem` ranked
first, above unfiled rows; and a `Notices` entry carries the count on every screen with a way to
the one queue.

### F3. The ledger's two rule gestures

- **Provider category → a rule. The rule builder is already built** (D-080): *Create a rule from
  the provider's category* is a button on the transaction detail panel, and it opens the editor
  pre-filled. What is missing is only what the author asked for — **the value in the ledger's
  column being the thing you click**, rather than a button two panels away. That is a gesture over
  an existing path, not a feature. B9's reservation still governs where it lands: a provider
  category is broad and one rule from it can claim hundreds of rows, which is why the click opens
  the editor's test box and never writes a rule.
- **Select part of a merchant name and make a rule from that substring.** New, and better than B9:
  a `MERCHANT_CONTAINS` rule from a selection is *narrow*, which is the property B9 lacks. The
  selection is the draft, and the existing router-state hand-off to the rules editor takes it from
  there.
- **Both want a context menu, and the app has none.** B9 already flags this: the first right-click
  in the app decides the pattern, and [conventions](../../conventions.md) makes a keyboard equivalent
  part of done for any screen with a table. Whatever is built, both gestures should use the same
  menu — building two is how a second pattern arrives.

**Built, 2026-08-28 (D-173)**, together, as one menu — and **on the row rather than on the value**,
which is the one place the build departed from the ask: a clickable provider-category cell would
have been two gestures for two rules on one row, with no home for the other two things a person
wants to do with it.

### F4. A month should read as a month

`toYearMonthString` produces `2026-07`, and it is used as a **display** string in the month picker,
the year table, the paycheck list, Home's headline, the trends axis and the plugin's output. The
ask is *July 2026*.

**The catch is that it is also a stored format**: a paycheck's salary month is persisted in it, the
ledger filters by it, `parseYearMonth` is its only reader, and the plugin's tool arguments use it.
So this is **two functions, not a rename** — the wire format stays exactly as it is, and a new
formatter is what screens call. Mechanical, and worth doing carefully rather than with a
find-and-replace: a display string that leaks into storage is a migration.

**Built, 2026-08-28 (D-172).** The open question is answered with **three** widths, not two: a
heading gets *July 2026*, an axis end gets *Jul 2026* — the year stays, because a trends window
crosses a year boundary as a matter of course — and a table already scoped to one year gets *July*.
The plugin was deliberately left printing keys, because it takes keys.

### F5. Loading indicators, and a read that survives leaving the screen

**What exists.** The statement path already says so — `App.tsx` renders "Reading &lt;file&gt;…"
while a workbook is parsed. **The PDF paths are the gap**: pdf.js is 1.7 MB loaded on demand
(D-141), Tesseract is a second wait (D-147), and a model pass on top of that is the 14-second read
D-152 measured. That is the read with no progress on it.

The second half is the harder one and the author has described the right shape: **a read that keeps
running while you go elsewhere**, with a bar at the foot showing it and turning into a way back to
the review when it lands. Two things to be careful of, both already-decided ground:

- **pdf.js draws through `requestAnimationFrame`, so a page that is not visible never finishes**
  (M11's own trap — it cost an afternoon looking like a code bug). A render that continues in the
  background is *exactly* that failure, so the work has to be structured as parse-and-read rather
  than as an offscreen render, or it will hang instead of finishing.
- **Navigation is currently blocked during an import** (`navigable` in `App.tsx`) precisely so
  staged rows cannot be stranded behind a screen with no way back. Letting the user leave means
  building the way back first — which is what the foot bar is.

**Built, 2026-08-28 (D-171)**, both halves in one unit. The trap above was the reason to expect
two, and **it turned out not to exist**: `requestAnimationFrame` follows the *document's*
visibility, not whether a React component is mounted, so a read continues drawing while you are on
another screen. The half that did bite was smaller and was found in a minute of driving the app —
the flow is a state of a screen and the foot bar is not that screen's child, so the flag saying
"show the reader" has to live where both can reach it.

### F6. The splitter

- **Direct manipulation, bar or pie.** The screen has a `SplitBar` already; the ask is to make it
  the control rather than the readout — drag a slice to resize it, and split a slice into a new
  bucket. This is the screen docs/11 calls the app's signature interaction, and **M13's motion unit
  was its prerequisite and is built** (D-167): `useAnimatedNumber` is what makes a dragged figure
  legible, and the splitter's amounts and balance already count. A pie as an *alternative view* is worth questioning separately — a pie is bad at
  comparing adjacent slices, which is the whole task here.
- **A bucket cannot target an investment account, and that is a real hole.** `TARGET_KINDS` is
  `CATEGORY · SAVING_GOAL · DEBT · FIXED_EXPENSES · FREE`. A monthly transfer to a brokerage is
  none of them, and the author is right that faking a saving goal is wrong — a goal has a target
  amount and a date and this has neither. **This is F1's, not the splitter's**: the target kind
  arrives with the investment account it points at.
- **Fixed expenses: visible, and optionally a bucket.** Today the control is a `<select>` of
  `NONE · ESTIMATED · CONFIRMED_ONLY` and the *amount* appears only as a trailing clause in caption
  text — "less ₪4,200 of fixed expenses" — beside the hero. The ask is a line of its own, above the
  split, saying what was taken off and whether it is confirmed or detected. And a fourth mode: the
  fixed total **as a bucket in the split** rather than off the top, which is the same money shown
  as a share instead of as a subtraction. Both are small; the second is one more `FixedExpenseMode`
  and a synthetic allocation.

**Built, 2026-08-28 (D-174)**, except the investment target, which is F1's. Two corrections to the
reading above: the fourth thing is **not** a fourth `FixedExpenseMode` — *which* expenses count and
*where* their total goes are different questions and cannot disagree, so it is one added column
rather than a rebuilt table — and the pie is not built, for the reason this note already gives
about comparing adjacent slices.

### The question that blocked F1 — answered

**Does the app get to fetch a stock price, or does a price arrive the way every other number in
this document does?** Asked because it was D-124's to answer and D-124 is the author's alone.
**Answered on 2026-08-28: transcribed.** The app stays what the README describes — no backend, no
account, no telemetry, works with the network off, nothing about this person's money leaves the
machine — and F18 loses one column and nothing else. **D-159.**

## G. The author's third list (2026-08-28)

Handed over when M13's ten units were built and he was asked what came next. **All three became
M14 units** — the second interface pass M13 said in writing would follow
it, closed 2026-08-29 —
and each states what is actually there today, checked rather than remembered.

### G1. The document beside the reading

**What exists.** `extractPdfText` rebuilds lines out of glyph positions — panels, baselines,
column gaps, four decisions' worth of it — and then **returns a string**. `PdfExtract` carries
`text`, a page count and two flags; every coordinate it worked from is discarded at the end of the
function that computed it. So `openDocumentText` hands a string on, the ladder anchors fields to
line *numbers*, and the confirm surfaces raise doubts that name them: *"taken from line 34, beside
the line 33 the template names"*. **That sentence is unverifiable inside the app.** The only way to
check it is to open the same PDF in another window and count.

**The ask.** Embed the read PDF and let the person confirm visually if he wants to — *if he wants
to* being part of it: a render is a real cost and somebody accepting his fourth slip under a stored
format should not pay it.

**The shape, and the one thing that must not be got wrong.** A line's box and a line's text cannot
be two arrays kept in step; the moment they drift, a highlight points at the wrong row and is worse
than no highlight at all. So the text is **made out of** the placed lines rather than kept beside
them — one function produces lines with their boxes, and the string every existing caller reads is
`lines.map(text).join('\n')`. Geometry stays in page points with the page's own size beside it, and
scale is the viewer's business.

**Built, 2026-08-28 (D-168).** The shape held: `linesFromItems` is the placing function with the
boxes dropped, so there is no second array to drift. What the build added beyond the ask is that a
*reading* now records which line each field came off — the deduction rows always carried theirs and
the three figures the strip proves never did, which is why the strip could not have been pointed at
the page without it.

### G2. Deduction types is a core screen filed under Settings

**What exists.** `/settings/deductions` — the sixth of six children of the last section in the
rail. The screen's own docstring says the two flags on it "decide what every paycheck figure
means", and it is the **only** way into three things: the deduction→fund link that no fund gets any
payslip data without (D-073), a salary-deducted loan's link to its debt (D-085), and the
`reducesNet` / `countsAsSaving` pair the reconciliation delta, the savings rate and total
compensation all read. Four other screens already send people there in a sentence — F13's two, the
debt editor, and onboarding's document step — which is the tell: a screen that four screens have to
point at is not a setting.

**The ask, in his words:** *"Deduction types are a core feature of the app but it's hidden. If I
didn't know it existed I would've never gone there."*

**Built, 2026-08-28 (D-170)** — a tab of Paychecks, inside D-157's rule rather than around it. The
second half was not in the ask and is the one that explains the screen: a saving line naming no
fund makes every fund surface downstream say *"no payslips cover this"*, which reads as a missing
document and is a missing link, so the Paychecks screen now names those lines.

### G3. The fund's salary against the payslip's

**What exists.** `fund_deposit.salary` is described in the data model as *"the salary the deposit
was computed on, where the table prints it"*, transcribed row by row from a report's deposit table
(D-153) — and **nothing reads it**. `depositsByMonth` compares *amounts* against the salary month
they name; `reconcileDeposits` compares totals over a window; the third equation proves the rows
sum to the movements block. D-138 is written into that screen already: it proves the money and not
the months. **The base is a third thing, and no equation on either document runs through it.**

**Its counterpart is on the payslip and is not the gross.** `DeductionLine.basis` — *"the salary
base a percentage applied to, when the slip prints one"* — is the figure the employer's payroll
computed the same deposit from, and a pensionable base is routinely *not* the gross. So the
comparison is between the fund's `salary` for salary month *M* and the basis on the payslip line
whose deduction type is **linked to that fund**, for the same *M*, with the gross as the fallback
the slip prints no basis and the discrepancy stated rather than assumed away.

**Which makes this the deduction link's payoff rather than a new link** — the same
`linked_fund_account_id` G2 is about, used for the one question it has never been asked. A fund
that computed February on a base the slip does not print is either a fund using a different
definition of pensionable pay or an employer under-reporting one, and today the app cannot tell
those apart because it never looks.

**Built, 2026-08-28 (D-169).** The reading was right that the counterpart is the basis rather than
the gross, and the build turned up the half that was not in the ask: the app's own editor had never
*stored* a base — `draftFromSlip` read it, showed it and dropped it on purpose — so the comparison
had nothing on the payslip side to compare with. The remedy is the column in the form, not the
silence.

## H. The engine — moved

**Section H moved to [`engine.md`](../../engine.md) on 2026-09-15**, with H1 to H9 intact; **H10 and H11
were opened there** ([D-211](../../09-decision-log.md)). The engine is
one subject with seven decision entries, ten open questions and a feature surface, and it had outgrown
being a section of this file. Nothing was dropped in the move.

## Related

[00 Index](../../00-index.md) · [09 Decision Log](../../09-decision-log.md) · [04 Data Model](./04-data-model.md)
