---
type: plan
project: Emerald
pack: ledger
---

# Roadmap — the ledger pack

**Parked on 2026-09-16, and parked is not abandoned.** M0 to M15 built and closed a
personal-finance app that works: it imports card and bank statements, categorizes them, reads
payslips and pension reports and broker statements out of real PDFs, and plans where a net
paycheck goes. Then M16 was **held** by its own review and M17's review was **deferred**, and
the reason both stalled turned out to be the same one: what the app kept needing was a more
general thing underneath it. That thing is [the engine](../../engine.md), and it is what is
being built now.

**Nothing here is scheduled and nothing here is dead.** Since M25 the pack is declared formats and
its code, kept per document (D-282), and every screen in it still works. It comes back when the engine is good enough to eat it — when a
declared format, its identities and its links can express what these thirty tables express, the
work below is re-read against that rather than resumed as written.

**What is still worth testing**, if you want to spend an afternoon on it: the open `review_entry`
rows for M16 and M17, and M16's actual fault — the missing `cost` role — which **M19 U0 already fixed** and which has never
been re-driven against a real `דוח תקופתי`. See [README](./README.md).

The decisions are indexed in [decisions.md](./decisions.md).

---

## Completed — M0 through M11, the two interface passes, and M15

Full text and decision entries are kept in the private record. **M13, M14 and M15 all closed on 2026-08-29** — the
first two when the author looked at what only an eye could accept (D-154), M15 when he put a real
document through its migration and every figure held. **M16 and M17 opened the same day and are
both built**, below, each waiting on the author rather than on a session; more interface work is
expected and goes to
[08](./08-suggestions-and-open-questions.md) until there is a milestone for it.

| Milestone | Delivered | Decisions |
|---|---|---|
| **M0** — skeleton and the import spike | Vite/React/TS, both build outputs from day one, SheetJS reading real Cal and Max files, header guessing. Both files reconciled to the agora. | D-001–D-026 |
| **M1** — import, mapping, categories, onboarding | `core/` (Money, dates, text), sql.js with migrations and the save flow, the column mapper and saved mappings, the staging area and review screen, the ledger, categories, accounts, six-step onboarding, the visual system. Tagged `m1`. | D-027–D-035 |
| **M2** — the rules engine | `category_rule` and a pure comparator, rules applied at staging and filed at commit, the rules screen with its test box, rules written from a merchant / a provider category / a correction, re-apply with the app's only undo, 125 built-in rules as a rule pack, bulk categorize. | D-036–D-047 |
| **M3** — paychecks | `paycheck`, `paycheck_line`, `deduction_type` (ten seeded), `domain/paycheck.ts`, the entry form with its live reconciliation strip, the net trend, the gross→net waterfall, deduction types in Settings. | D-048–D-052 |
| **M4** — fixed expenses and the splitter | Recurring-charge detection, the fixed-expense register, the splitter with buckets and largest-remainder allocation, variance, apply-plan. | D-053–D-059 |
| **M5** — bank import, savings, pension | The bank parse with its running-balance check, row classification, last-4 settlement matching and salary reconciliation, `fund_account`/`fund_balance_snapshot` and F13's four screens, F07's savings domain, goals, holding places and the money map, onboarding groups. | D-060–D-082 |
| **M6** — debts, statistics, and the loop closing | `debt`/`debt_payment` and F08’s screens, F10’s monthly summary, yearly overview and trends, the category appearance picker, plan-vs-actual on the splitter, net worth, and the home dashboard that ranks what wants doing by consequence. | D-083–D-091, D-105–D-108 |
| **M7** — the Claude plugin (F14) | A bundled stdio MCP server over the app’s own repositories: 32 shaped tools, a schema gate, dry-run-plus-backup on every write, onboarding and ingestion from a conversation, payslips and funds, savings and debts — and the app’s mtime check. Zero network calls, tested. | D-092–D-104, D-109–D-113 |
| **M6.5** — hardening (taken after M7) | The migration walk over a populated document and the 60k measurement that answered the Web Worker question, CSV export, the rulepack grown to 180 rules, and the two plugin items D-114 opened. | D-118–D-121 |
| **M9** — the desktop shell | Electron main and preload as their own build output, the renderer served from `app://` unchanged, a filesystem adapter whose save is a rename and whose watcher watches the directory, a document arriving by double-click, the two icons, the NSIS installer that registers the document extension, the empty/loading/error audit over all 21 routes, and `dist-single/` retired. **The dmg still needs a Mac.** | D-114–D-133 |
| **M9.5** — the desktop interface | A frameless window whose title bar the app draws, the sidebar from one `nav.ts`, one ranked notice region, the `Ctrl/Cmd+K` command palette, a table cursor that is state rather than focus, detail panes beside their lists, and docs/11's *The window* section. | D-130 |
| **M10** — the local model runtime | `EmeraldRuntimes` on the bridge, detection for Ollama and LM Studio, a machine preference that is off by default and never in the document, per-task declarations with the answer shape given as a grammar, and every ceiling — token cap, deadline, cancel — enforced against a real model. The only sockets in the app until M16's price fetch, and like it, in the main process. **A short tail is still open; see below.** | D-134–D-137 |
| **M11** — AI surfaces in the app | The `document_template` store at schema 21, one review surface built once, *Read a payslip* and *Read a report* through one ladder, *Work out the columns* on the mapper, `/settings/formats` with a *Read with* picker, merchant suggestion with no model in it, and the per-deposit table at schema 22. Seven real payslips and one real pension report, at eleven corrections between them. | D-138–D-153 |
| **M13** — the interface pass | The nav in the order a person gets ready in and Insights dissolved into Home, a category created from the picker that files a row, the categories screen with a colour resolved against **the level** it is drawn in, `FlowFrame`, a folder of old fund reports read in one sitting, onboarding that intakes documents instead of setting homework, the primary button, figures that animate only when they change, auto-save where a path already exists, and `.emd` everywhere and alone. **D-125 held through the repaint.** | D-154–D-167 |
| **M14** — the second interface pass | The document drawn beside the reading, its text made out of the placed lines; the fund's salary against the payslip's **base**, `AGREES`/`DIFFERS`/`UNKNOWN`; deduction types as a tab of Paychecks; a read that says what it is doing and outlives its screen; *July 2026* with `2026-07` unmoved; one context menu on the ledger row, opened by `Shift+F10`; and the splitter's bar as the control, with the fixed-expense total a line of its own (schema 23). | D-168–D-174 |
| **M15** — savings, places, and what the money is held in | The `holding` at schema 24 (migration `024`), taking the rate, the liquidity, the term and a fee off the place that never had them; **provenance** and *last confirmed* declared rather than inferred; the money map rebuilt as places with their holdings beneath and every fund a row of its own; the projection and the emergency fund per holding; `record_deposits` writing into a holding; and a balance nobody has counted on Home's list. **No figure moved**, proved on a populated document and then on the author's own. | D-175–D-177, D-180 |

**Still owed from M5**, recorded rather than forgotten:

- [x] The labeling queue's promotion to a **fixed expense** and to a **debt payment** — both, as one
      panel, in M17 (D-191).
- [ ] The **first-paycheck onboarding step**, unblocked since M3.

**Still owed from M2**, one thing:

- [ ] The rules screen's **"shadowed by" link**.

**Still open from M10**, and none of it blocks anything — the chain M11 needed (detect, choose,
ask, execute, verify) is built:

- [ ] A bundled `llama.cpp` sidecar as the no-install path, with weights fetched on first use
      rather than shipped in the installer.
- [ ] Naming a runtime that is not on its default port.
- [ ] Downloading a model with the disk budget shown *before* it lands, and unloading one.
- [ ] What model selection should measure and tell a person about **fit** (D-137 moved this: context
      turns out to be per-*task* rather than per-model, so selection decides the fit and the task
      decides the priming).

**And one discipline that is nobody's rule yet.** D-110 treats a plugin round trip as a cost;
**nothing treats a read's output volume as one**. D-114's two disclosure findings are closed
(D-120), but the general case is still a habit rather than a rule anywhere.

F03's *"over 80% categorized without manual input"* is measurable now and is **not** claimed: it
is a fact about a real 12-month history, not about a fixture.

---

## M16 — Investments (F18) — **held 2026-09-07: the author is redrawing the structure**

> **Held, and nothing inside it is a unit right now** ([D-208](../../09-decision-log.md)). The second
> review re-drove U1 on 2026-09-07: D-203's two new checks fire on the real statement, and its third
> fault survives — a bare `סה"כ 76,000.00 100.00` under the last row still goes unfound. The cause is
> not the reader. `HOLDING_COLUMN_ROLES` has eight roles and **no `cost`**, so `עלות הרכישה` has
> nowhere to go but `ignore` and a model put it in `value`. **The author declined to widen the
> vocabulary and is redrawing the investments structure himself.** M16's twelve review entries stay
> unspent in review; **do not take a unit from this milestone**, and do not write it a
> third tail. What follows is [M18](#m18--clean-up).
>
> **M19's first unit is this milestone's fix, and it has landed**
> ([D-212](../../09-decision-log.md), [D-213](../../09-decision-log.md)). `עלות הרכישה` now has somewhere
> legal to go: the holdings vocabulary is rows in the document, and `cost` can be added from the
> mapper. **It is deliberately not seeded** — adding it is the author's act and the proof. So the
> reframe began by paying M16's debt rather than walking away from it, **but that is still the only
> claim it has on this milestone**: M16 stays held until the author re-drives it and says
> otherwise. His entry is in review.


The milestone landed on 2026-08-29 at schema 26 and **the real broker statement arrived on
2026-09-03**, which is where it stopped being finished: the reader returned zero rows from every
heading line the mapper allowed, on all six of them. That is the third time a real document has
corrected this app through a green suite (D-142, D-152, D-194), and the first time the *fallback*
rung failed with the automatic one — a manual rung that shares the reader's model of the document
is not a floor. The reading is fixed and **the seven units below it are built**; what is left is the
review, which is the author's (review carries the queue).

**An investment account before this milestone was a number you typed in**, indistinguishable from a savings envelope:
no security, no ISIN, no quantity, no cost basis, no composition (docs/08 F1). This milestone gives
it all of them, on the two shapes this project has already built twice — **F13's transcribe-then-
reconcile**, and **F17's ladder** for reading a document, whose tabular half is exactly a holdings
table (rows with no labels, a count that changes every statement, found by shape against a heading
anchor — D-153).

**It rests on M15**: a position is a holding, cash in the account is a holding, and the transfer in
stays a `SavingDeposit` landing in the cash one. They reconcile rather than nest.

### What landed

- **The securities and the positions.** `security` keyed on ISIN — and, since U1, on its security
  number too (D-195) — with ticker, name, currency and kind as labels; a position as a holding of a security; `security_trade` for the purchase history
  when the user has it. Cost basis, realised and unrealised gain follow from those and are derived.
- **Reading an investment statement**, through the same ladder and the same confirm surface as a
  fund report — the label-value half for the account and its total, the tabular half for the
  holdings — with the format stored and reused (D-139, D-149, D-164).
- **The Investments tab**, per account and across all of them: composition, what each position is
  worth, and what the account's cash and its positions add up to against the statement's own total.
- **What you plan to buy, and what you assume it earns.** A purchase plan per security — amount and
  period — and an assumed return that feeds the projection as an `ASSUMED` rate in the scenario
  columns, never as a forecast (D-066's rule, and F07's). **The splitter is where this connects**: an
  investment bucket is a plan to buy, and plan-vs-actual already exists to say whether you did.
- **A price, and where it came from.** Transcribed off the statement (D-159), typed by hand, or —
  last, and only after the other two work — **fetched**: `electron/prices.ts`, main process, one
  allowlisted host, off by default, on an explicit refresh (D-178). Every figure correct without it;
  a security with no quote says so rather than showing a stale number as a fresh one.
- **Currency is the trap.** A USD holding inside an ILS document is `Money` in two currencies plus a
  rate belonging to a date. `ForeignAmount` already carries that shape for a transaction and is the
  thing to copy rather than reinvent.

**Done when:** an investment account's composition comes off the statement the user already has;
what it is worth is a figure with a date and a source on it; a plan to buy monthly appears in the
projection and in the splitter; and turning the price fetch **off** changes no number, only how
fresh it is.

**Landed**, one line each with the decision that carries the reasoning:

- [x] The schema, the model and the arithmetic — six tables at migration `025`, `Quantity` and
      `ExchangeRate` in `core/`, and `domain/investments.ts` valuing, costing and reconciling a
      portfolio before a screen exists ([D-181 to D-184](../../09-decision-log.md), [F18](./f18-investments.md)).
- [x] `investmentRepository` — a position written as a holding and never half of one, prices and
      rates upserted per source per day, and the cash beside a portfolio read from `savings.ts`
      rather than summed a second time (D-181).
- [x] The Investments screen and its purchase-plan tab, at `#/wealth/investments` (D-185).
- [x] **A valued holding's balance is its valuation**, so the money map, the liquidity split, net
      worth, Home's list and the projection all report a portfolio — found by driving the screen,
      which had it at ₪0.00 one click away from the right figure (D-186).
- [x] The plan in the projection and on the splitter — `investmentFunding` says whether the split
      covers what you said you would buy, from the live bar on one screen and the saved plan on the
      other, and no `TARGET_KIND` had to grow (D-185).
- [x] The price fetch — `electron/prices.ts`, one allowlisted host, off by default and enabled by a
      prompt that says what leaves the machine; every failure writes nothing (D-178, D-187).
- [x] Reading a statement through F17's ladder at schema 26 — a holdings table is a deposit table's
      shape, all three rungs exist, and the third one is a screen where you point at the table
      (D-188).
- [x] **A real statement read, and four assumptions retired** (D-194). The table's shape comes off
      its rows rather than its heading; one column may be blank, so a cash line inside the table
      stops ending it; the price scale is settled by the statement's own `units × price = value`,
      so a Tel Aviv quote in agorot is divided at the reading edge and the confirm surface says so;
      and a summary line's figure is taken from the value column rather than as the last number on
      it. `מספר נייר` is no longer guessed to be an ISIN, which `isValidIsin` rejected on every row.

### The tail — seven units, in order (D-194)

Found in one afternoon with the built milestone driven against a real account — the
review phase before it had a name or a file (review is both now). They
are ordered by dependency, not by size. **All seven have landed** — U1 was the one three of the
others waited on, U2 is the one U5 waited on, U3 is the screen U4 edits from, and U7 could only be
written once U1 gave it an identifier to say it with. **The milestone is built and waiting for the
author**; closing it is the review phase's, not a session's. **The review ran on 2026-09-04 and
stopped at U1** — what it found is the second tail below, and U2 to U7 are still unspent.

- [x] **U1 · The security number gets a column** at schema 28 — a second key beside the ISIN with
      its own unique index, a `securityNumber` role that `guessRole` points at before the name,
      `matchedBy` saying which of the three a row matched on, and `upsertSecurityByKey` where the
      accept used to insert. The migration backfills an all-digit ticker, which is where D-194 had
      to leave it ([D-195](../../09-decision-log.md)).
- [x] **U2 · The trades table**, read as **a sequence of dated events** rather than as a holdings
      table with different roles — which is what rejoins the rows `PANEL_GAP` splits, with nothing in
      `pdfText.ts` retuned: a line starting with a date starts a row, and the line after it that does
      not is the rest of it. The shape is the widest row, the blank column is placed by kind, the
      price scale votes on `units × price = amount ∓ fee`, and `upsertTrade` keeps two overlapping
      statements from counting one purchase twice. **A broker's own tax bookkeeping is in that table
      as a perfectly reconciling purchase**, and what declines it is the position test rather than
      any arithmetic ([D-196](../../09-decision-log.md)).
- [x] **U3 · The holding detail view** at `#/wealth/investments/:holdingId`, reached by the row's
      name — the trades as the **walk** that produced the cost basis (`costBasis` folds
      `costBasisSteps`, so the summary is the last row rather than a second computation), the price
      history with the one `latestPrice` is using marked, and the first callers `deleteTrade` and
      `deletePrice` have ever had. The four ghost buttons moved off the row; it is a **screen rather
      than a pane** because the walk is eight columns and because a flow claiming the window inside
      `ListDetail` unmounts the list rendering it ([D-197](../../09-decision-log.md)).
- [x] **U4 · Add-position, cut to what a statement prints** — `מספר נייר` is a field and sits with
      the name, Ticker/ISIN/Exchange go behind a disclosure, and the form's own copy of the security
      checks becomes `validateSecurity` plus a `normalizeSecurityNumber` the unique index shares, so
      a number typed by hand stops opening a twin of one read off a file. Units are **offered** from
      the trades rather than derived from them, `quantityDisagreement` being the reason. And editing
      loses the identity block and **saves the six fields it shows**, which it did not
      ([D-199](../../09-decision-log.md)).
- [x] **U5 · A bank transaction funds a trade** at schema 29 — one nullable
      `funding_transaction_id` on the trade rather than a link table, because nothing but a person
      writes it and a transfer pays for several purchases. The difference between the ₪11,000 that
      left the bank and the ₪11,000.00 of buys is **reported in a sentence rather than flagged**
      (`EXACT` / `LEFT_AS_CASH` / `FROM_CASH`), candidates are ranked and never chosen, and the
      third tab at `#/wealth/investments/funding` is a view across positions because one transfer
      buys three securities ([D-200](../../09-decision-log.md)).
- [x] **U6 · The investments onboarding** — an eighth step between `documents` and `checklist`,
      a hub handing to the components the real screens use, and a plan that may name a security
      nobody holds, which `PurchasePlans` refused until now. The app **records an intention and
      never offers one**, said on the step and in the plugin's guidance for it
      ([D-201](../../09-decision-log.md)).
- [x] **U7 · Say why a security cannot be priced** — `providerMapping` replaces `providerSymbol` and
      returns the refusal with its reason, so the sentence a screen prints and the request the
      refresh makes are one decision. `securitiesToQuote` stops filtering on the ticker,
      which made a Tel Aviv holding invisible to the answer without making the request any smaller;
      what leaves the machine is unchanged. Three surfaces, one remedy: **transcription is the floor
      and the fetch is the convenience on top of it** ([D-202](../../09-decision-log.md)).

### The second tail — five units, in order (the review of 2026-09-04) — **all five landed**

The review ran against a real `דוח תקופתי` and stopped at the first entry it opened. **One statement
produced three faults that each hid the next.** The column read as the value is the *cost* column, so
`priceScaleOf` cannot vote on either row, returns `unknown`, and every price stays as printed —
**₪245,900.00 for one unit**, and **₪157.35 for a money-market fund, which is the one that does not
scream**. And the printed total the reconciliation needed — `סה"כ  76,000.00  100.00`, the line this
file already quotes as D-194's trap — was reported as *not a row*, so the check that would have
caught the wrong column declined to run. The app read ₪72,000.00 against the statement's ₪76,000.00.
review carries the arithmetic that proves which column is which.

**What the author decided is larger than the bug.** The reader is a *proposer* — the local model
picked those roles (`deriveInvestmentStatementLines`) and got one wrong, which is what proposers do
— and it cannot be made right by being made better. So it stops being the last word, in two ways.
**A check is what generalises, not a better reader**: `units × price = value` and
`rows + cash = total` hold on every broker statement in every language and currency, and would have
caught this three separate ways. **And every figure a reader produces becomes an editable field on
the confirm surface**, so a reading that is wrong anywhere costs a correction rather than a silent
number — which is also the answer to "what about other countries".

- [x] **U8 · The statement's own arithmetic checks the reading** — `holdingReconciles` per row and
      `pricePossible`, the check that needs no value column at all, with a zero factor `unchecked`
      rather than failed because an Israeli cash line prints inside the table. `unknown` is said out
      loud, the mapper reports whether its rows multiply out while the columns are still being
      chosen, and a bare `סה"כ` under the last row is read through the table's own value column when
      nothing pointed at a total ([D-203](../../09-decision-log.md)).
- [x] **U9 · A price finer than an agora** — `UnitPrice` in millionths of a minor unit at schema 30,
      because a price is not an amount; `valueOf` moves to `core/price.ts` and is the one place a
      value is rounded. The trade key compares to the agora, since the migration could widen a stored
      price and not recover digits it never had ([D-204](../../09-decision-log.md)).
- [x] **U10 · Every figure a reader produces is a field, and what is edited is what is written** —
      per row the name, the three keys, the units, the price and the value; above them the as-of
      date, the cash and the printed total; the movements table on the same terms with its kind
      column a control; and the mapping reachable from the confirm surface, which is the one
      remedy for a whole column read wrongly. The edit goes into the reading rather than beside it,
      and `restateStatement` recomputes the sum and the verdict on every keystroke
      ([D-205](../../09-decision-log.md)).
- [x] **U11 · The same for the payslip, the fund report and the bank statement** — `restateSlip`
      and `restateReport` beside `restateStatement`, a figure the reader did not find drawn as a
      blank field rather than a missing row, and the import review screen as the fourth confirm
      surface, where the reading is rows in the staging table and an edit leaves the natural key
      alone ([D-206](../../09-decision-log.md)).
- [x] **U12 · The plugin gets investments** — one read and four writes, the first tools over any of
      F18's six tables, and **the write carries the confirm surface's checks**: the statement's own
      value column and printed total go in beside the units and the price, so a conversation that
      left a price in agorot is told so before anything is written
      ([D-207](../../09-decision-log.md)).

---

## M17 — The flow (D-179) — **built; review deferred 2026-09-07**

> **Built and never driven.** All five units landed on 2026-09-03. The review needs **one real
> salary month** — a slip recorded, a plan applied, and that month's card and bank statements
> imported — and the real document had **no payslips and no debts**, so three of the four
> entries could not run at all. **Deferred rather than reviewed**, and
> deferred rather than closed: the four claims below are **untested**, not accepted.
>
> **The one to drive first when it resumes** is the plan→debt edge: when the card statement carrying
> that same real payment imports later, does discovery raise a *second*, unconfirmed payment for
> money the plan already wrote? That is a **silent double-count in a real money file**, and it is the
> only entry here worth doing before the restructure rather than after it.
>
> **U2 is blocked on something only real documents can supply** — a second month of statements. Both
> promotions are claims about the *next* import, and `the real-documents folder` holds one month.


**The app has the edges and not the graph.** A paycheck line feeds a fund, a goal and a debt; a bank
row finds its card settlement; a plan proposes a deposit. What is missing is every promotion out of
the labeling queue, the plan's own edge to a debt, and any screen at all that shows the chain end to
end. **Four connections and one view** — D-179 named five and the first was already built (D-189);
the milestone does not grow to replace it, and anything else goes to
[08](./08-suggestions-and-open-questions.md).

All four have been carried as "small, none blocking" since M2 and M5. They are not small because
they are easy; they are small because nothing ever made them anybody's milestone.

- [x] **A paycheck line pays a debt** — **already built**, by M6 rather than here: the deduction
      type's third destination, `payrollPaymentRef` keyed `paycheckId:debtId`, and `savePaycheckDraft`
      running the sync. D-179 called it missing and it was not (D-189).
- [x] **A plan writes a debt payment on apply** (D-106) at schema 27 — `FROM_PLAN` keyed
      `planId:period:bucketId`, confirmed on write, and the row says when the app would have found
      that payment on its own. `notYetSupported` retired rather than emptied (D-190).
- [x] **The labeling queue promotes a transaction to a fixed expense** — a `FixedExpense` matched on
      the merchant, seeded by `proposeFixedExpense` and `USER_DEFINED`, because the detector's
      thresholds are what the user just answered past (D-191).
- [x] **The labeling queue promotes a transaction to a debt payment** — the debt is pointed at the
      name and discovery runs; no payment is written here, and what it finds waits unconfirmed in
      the review queue (D-191).
- [x] **The import review screen offers the rule**, owed from M2 — the same bar, and the scoped
      re-run over the import's blank rows that was the part D-047 said was never free (D-192).
- [x] **The trace view** at `#/paychecks/trace` — three sections of arrows and a list of
      destinations, four ways to arrive and one to stop, and no column added to draw any of it,
      which is the evidence the four edges were the right four (D-193).

**Done:** every destination a paycheck line or a plan can name writes something; a transaction can
become the two things it could already become in prose; and one screen follows a month's money from
the slip to where it sits, naming what it could not follow. **Every unit is built as of 2026-09-03;
closing it is the review phase's**, against a real document — the same thing M13, M14 and
M15 waited for. Its four entries are queued in review.

---

## M18 — Clean up

**The milestone's job is the cleanup; the three features are secondary.** The name came from the
author on 2026-09-07 asking to *"drop the old milestone and start with the current state as a clean
state"* — the three items he listed next were what he happened to say afterwards, and the cleanup
itself went unwritten until 2026-09-15. **The list is still unfinished** (*"i have more"*), so the
feature half is **not scoped** and must not be started as though it were. Smaller iterations than
M16's, at his request: see [conventions](../../conventions.md).

### The cleanup, which is the point of it

**Six files are over budget, and those budgets exist because a document carrying too much history
stops guiding.** There is a structural reason and it is worth naming: **the archive rule fires when a
milestone closes.** M16 is held and M17 is deferred, so neither triggers it — the docs are over
budget *precisely because milestones stopped closing*, and the system has no gesture for **parked**.

- [x] **The review queues are archived** (2026-09-15) — M16's twelve entries and M17's four were
      already marked *a record, not a queue*, so they moved to
      the private record, with the two claims still worth testing named at its head. review: **462 → 82 lines**, and nothing
      was closed to achieve it.
- [ ] **Decide what "parked" does to the archive rule.** D-181 to D-207 belong to two milestones that
      will not close on their current terms, so they cannot archive and the decision log stays
      **2,669 against 1,400** — and D-209 to D-215 added to it without a milestone to carry them off. Either the rule grows a parked case or the budget is fiction.
- [ ] **The roadmap condenses** — **604 against 420**, one line per finished unit and the rest to
      the private record.
- [x] **[08](./08-suggestions-and-open-questions.md) is back under budget** (2026-09-15) — **1,021 →
      800**, by lifting section H whole into [`engine.md`](../../engine.md) rather than by deleting
      anything. The engine had outgrown being a section of a suggestions file: three decision entries,
      ten open questions and a counted feature surface is a subject, not a row.
- [ ] **[04](./04-data-model.md) is over** — 1,338/1,300. It needs no work of its own and comes
      right when the two above do. **`status.md` is back under** (200/200, 2026-09-15).

### The three features

- [ ] **Record a movement shows that goal's last five.** On the deposit form, so what is already
      recorded is visible before another is added. **Untouched by everything since** — it is exactly
      as valid as when he asked for it.
- [ ] **Remove the investments "Read a statement" feature** — his words, *"useless feature"*.
      **NEEDS RESCOPING against [D-210](../../09-decision-log.md) before it is taken.** This entry was
      written against a restructure that no longer has that shape: it names U8, U9, U10 and the
      stored-format table as things that hang off the reader, and those are now **the engine** —
      `restateStatement`, the identities, the confirm surface and the mapper are layers 2 and 3 of
      [D-209](../../09-decision-log.md), not investments code. What should go is the investments-specific
      **vocabulary and screens**; what must stay is the generic ladder, mapper, confirm surface and
      proof, because that is the machinery the engine is made of.
- [ ] **A "using MCP" screen**, so a user discovers the plugin exists. **NEEDS RESCOPING, and it is
      worth more than when he asked.** D-210 concluded that **a format is usable by Claude the minute
      it exists, with no screen at all**, which makes the conversational surface the primary
      interface for anything new rather than a hidden bonus. But it cannot be a static list of 37
      hand-written tools if tools are generated from declarations — it becomes *what this document
      can do right now*, derived from what is installed and declared. Two things it must still never
      overclaim: **nothing is a general query**, and every tool takes one document path.

---

## M12 — The locale pack (D-122)

Making true the sentence the README already prints: *"the architecture is not Israel-specific —
adding another country is a locale pack, not a rewrite."* An audit says that holds for the five
things it names (currency, categories, deduction types, institutions, column-name hints) and misses
four others. **Unscheduled, and the only milestone with anything left to build** — nothing here blocks anything, and it is
worth doing only when a second market actually exists or the claim is about to be read by someone
who will test it. It keeps its number and its place at the end.

> **D-132 changes what this milestone is for, and shrinks it.** The Israeli data below is a **seed**
> now, not the mechanism: a model derives a mapping template for any market, so a second country
> works with an empty pack and gets faster with a full one. Seeds are welcome and may be written
> for other markets — that is the author's call and it costs nothing to be wrong about, because a
> seed only ever saves a derivation. What this milestone is *not* is a prerequisite for crossing a
> border.

- **Israeli data living in code**, which is the whole of the work:
  - `domain/bankImport.ts` — card-settlement description patterns (`כרטיס אשראי`, `ויזה`), in the
    **domain layer**, which docs/03 says imports nothing environmental.
  - `data/importer/mappingName.ts` — the issuer list, Cal through Mercantile, with Hebrew aliases.
  - `data/importer/printedTotal.ts` — the Hebrew vocabulary for a statement's printed total.
  - `data/importer/normalize.ts` — `ש"ח` → ILS and the `X מתוך Y` installment pattern.
  - `core/text.ts` — stripping a `סניף` branch suffix, in the deepest layer there is.
- **Israeli concepts in the schema**, the part that cannot be a data file: `fund_type` is a `CHECK`
  list of `PENSION, STUDY_FUND, PROVIDENT, MANAGERS_INSURANCE, PROVIDENT_FOR_INVESTMENT`, and
  `deduction_type.kind` carries `STUDY_FUND` and `SEVERANCE`. Either a migration widens them, or
  F13 is an Israeli feature and the docs say so outright. **The second is the honest default** until
  somebody outside this market asks.
- **Bilingual UI copy stays.** The Hebrew glosses in `FeeImpact`, `SnapshotEditor`, `FundDetail`,
  `funds/labels.ts` and the plugin's fund descriptions exist because the user reads a Hebrew fund
  report and the app must name the same line. They are a feature until there is a second locale to
  switch them for.

**Done when:** a second locale pack can be added without touching `core/` or `domain/`, and
whatever remains Israeli is Israeli **on purpose and in writing**.

---

## Later, explicitly deferred

- Any native mobile build. The web app is the product; moving would be a rewrite ([09 Decision Log](../../09-decision-log.md) D-019).
- A phone layout. Deliberately undesigned; see [06 Navigation and Screens](./06-navigation-and-screens.md).
- Additional card issuers and banks — no longer a milestone item at all, since the user maps
  any format themselves. Only the alias tables grow.
- Importing from the Pension Clearing House (המסלקה הפנסיונית) or standardized fund reports —
  a spike after M5; if tractable it becomes the primary entry path for [F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md).
- Transaction splitting across categories.
- Amortization schedules for mortgages.
- Widgets, notifications, quick-add shortcuts.
- Backup to the user's own cloud storage.

## Sequencing notes

- **M1 before everything** because every other feature reads transactions.
- **Onboarding is built with M1, not at the end.** It creates the accounts M1 needs anyway, and
  building it last means designing it against an app whose shape has already hardened.
- **F13 depends on M3** — expected pension contributions come from payslips, so paychecks must
  exist before the reconciliation that makes the feature worth having.
- **M4 depends on M3** — the splitter needs a paycheck to split.
- **M6 statistics late** because they are the easiest thing to build and the most dependent on
  everything else being correct. Building charts over wrong data wastes the effort twice.
- **M6.5 before everything that follows.** Migrations matter more than AI or a shell. If time
  runs out, stopping after M6.5 leaves a complete, trustworthy app — which is the whole reason it
  keeps its "do not skip".
- **M9 before M10 before M11**, and the order is not negotiable in the way the others are. A
  bundled model needs a host process, so M10 has nowhere to live until M9 exists; and every fix
  M10 applies — subsetting the tool list, preloading context, enforcing the gate — is something
  only a host can do (D-114). Asking for the surfaces first would mean building M11 against a
  provider that cannot yet be made to behave.
- **M6.5 was re-scoped against D-115 and mostly survived it**, which is the opposite of what was
  feared when D-115 was written. Its lines are domain- and data-level — export, soft delete,
  migration tests, the performance pass — and none of them harden the storage adapter that M9
  replaces. **Two changes only:** the empty/loading/error audit waits for M9, because the shell
  adds states that do not exist yet; and the on-device merchant suggestion split in two, with the
  rulepack growth staying here and the suggestion surface moving to M11. **So M6.5 still runs
  first**, and the property it was built for holds: stopping after it leaves a complete,
  trustworthy app.
- **The rename waits for M9 and then goes first inside it** (D-117). It serves none of M6.5's four
  lines, so it does not belong there; and it cannot come after the file association, because an
  extension registered with the OS turns a find-and-replace into a migration. M9's first commit is
  also where the bundle identifier, the app id and the installer name get chosen — deciding the
  name anywhere else means deciding it by default.
- **M13 and M14 came before M12, and both closed on 2026-08-29.** They are written above M12 in the
  archive and numbered after it, which is the one place in this plan where file order and number
  order disagree — deliberately, because renumbering a milestone every other note already cites is
  churn for the sake of a table of contents. Neither needed anything that was not already built:
  every figure they touched was computed today, which is what made it safe to take two milestones
  that are mostly about how the app feels. **Their risk was never technical** — a repaint is where
  D-125's rule and D-115's document model get lost, and both survived, which was the acceptance no
  session could run and the reason the two sat open until the author looked.
- **M15 came before M16 and M17, and that order was not negotiable.** It added the record a
  position has to live in and the one a trace view has to end at, and **closed on 2026-08-29** at
  schema 24. It was the only one of the three that is mostly a **migration**, which is why its
  acceptance was that no figure moves rather than that something new appears — proved in
  `database.test.ts` over a populated document, one deposit of which names a place the document
  never had, and then against a real file. **M16 before M17** still holds: M17's
  view ends at a holding. **M16 carries the one network decision in the product** (D-178) and takes
  it last inside its own milestone, behind the transcription path that works without it.
- **M17 absorbed the M2 and M5 tail rather than leaving it** (D-179), and built all of it. Four of
  its units had been listed as "small, none blocking" since those milestones; a line that survives
  four milestones in a status file is not small, it is unowned.
- **M12 is last and unscheduled** (D-122). It corrects a claim rather than adding a capability, it
  blocks nothing, and its cost is honest only once a second market exists. The one thing in that
  audit that was **not** waiting for it was the six-screen currency bug, and that is now fixed:
  Debts, GoalDetail, Home, MoneyMap, NetWorth and Savings read `documentCurrency(db)` like the
  three screens that always did.
- **There is nothing between M6.5 and M9.** M8 was deleted by D-116 rather than left on hold: a
  milestone nobody will schedule is worse than a deferral with a trigger, because it sits in the
  plan looking like work.
- **M7 is deliberately out of numeric order**, taken while M6 still has four lines open (D-092).
  Three things make that safe rather than restless: it wraps the repository layer, which M6's
  remaining work does not touch — those are screens over queries that already exist; it shares no
  file with them; and its own risk is a *runtime and packaging* risk, which M0's principle says to
  prove before building around it. The one thing it must not do is drift ahead of the schema, and
  the schema gate is its first unit for exactly that reason.

## Related

[README](./README.md) · [decisions](./decisions.md)
