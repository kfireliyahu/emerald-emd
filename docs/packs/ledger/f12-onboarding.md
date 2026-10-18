---
type: feature
project: Emerald
milestone: M1 (core) · extended through M5
status: built, eight steps · the documents step settled in M13 (D-166), investments in M16 (D-201)
---

# F12 — Onboarding

> **Gone since M28 U9 (D-330).** The flow below was replaced by *Guide me*: a small dialog that
> walks the real screens, declared by the pack as seven steps (`data/packs/ledger/guide.ts`; Categories joined in M28 F13), whose
> done-tests are this checklist's questions. Kept as the account of what it was.

First-run flow. The user picks the institutions they actually use — card issuers, banks,
investment platforms, pension funds — and the app creates the corresponding accounts and
holding places, then walks them through their first import.

## The problem onboarding solves

Opening this app for the first time means facing empty tabs for transactions, paychecks,
savings, debts, and statistics, with no obvious first move. Meanwhile the app needs several
records to exist before anything works: an account to import into, categories to assign, and a
place with a holding in it for deposits to land in — a brokerage tick makes both, because money
always lands in a holding (D-175).

Picking institutions solves both at once. It's a familiar interaction, it produces the records
the app needs, and it teaches the structure of the app while doing it.

## What is built

The core flow: **Welcome → Institutions → Details → Categories → First import → Documents →
Investments → Checklist**, at eight steps. It replaces the routed screens while it runs, and the sidebar's list is
hidden — docs/06 puts onboarding outside the tabs, so the flow carries its own way out.

Where the build departs from the note above, in each case because the record it would create does
not exist yet:

- ~~**The picker offers two groups, cards and banks**, not four.~~ **All four since D-079**, now
  that both tables exist: an investment platform creates a `HoldingPlace` and a fund manager
  creates a `FundAccount` — a pension, which is the type to correct on the funds screen rather than
  a guess the app hides. Neither is an `Account`, because nothing imports a statement into one, so
  the step's own words changed with it and the footer counts records rather than accounts. What a
  bank still does not create is its checking `HoldingPlace`; a place is where savings sit, and
  inventing one for every bank ticked would fill the money map with empty rows.
- ~~**Step 4, the first paycheck, is not here.**~~ **It is, since D-166**, and it arrived as half of
  something larger: the **documents** step, which asks for the payslips and fund reports the user
  already has and reads them through M11's ladder. Three milestones after M3 unblocked it.
- **No sample data**, per the recommendation in Open Questions below. The empty states carry it.
- **The checklist lists the six items whose flow exists** — add your cards, import a card
  statement, import a bank statement, add your savings goals, set up your paycheck split, enter
  your pension balances. The last three joined when M4 and M5 built the screens they link to; an
  item linking to nothing is worse than no item. **"Categorize what came in" left** (D-166): it was
  the one item that set the user a task about their own money rather than something to set up, and
  Home's backlog count already says the work is waiting without asking for it. **A seventh is
  conditional** (D-201): *say what you hold, and what you plan to buy* is listed only for a document
  with a brokerage in it. Every other item is something nearly everybody has, and a row a person can
  never tick is how a whole list stops being read.

> **The documents step, and what left with it** (D-166). It is a hub over the two intakes the real
> screens use — `PayslipIntake` and `ReportIntake`, one of each in the app, because the accept
> rules are what must not exist twice — and it carries a third offer nothing else in the app makes
> at the right moment: **which payroll deduction feeds which fund**. That link is what turns a
> payslip line into an expected contribution, it is app-only, and a fund nothing points at reports
> having no payslip data forever (F13). Onboarding is the one minute when both sides were made
> minutes apart.

> **The investments step** (D-201). The same hub, over the components `#/wealth/investments` uses:
> `StatementIntake` for the broker's holdings table, `PositionEditor` for one typed by hand, and
> `PlanForm` for what you intend to buy — **which may name a security you do not hold yet**, a thing
> the purchase-plan tab refused until this step needed it. **The app records an intention and never
> offers one**; the step says so in its own words, and the plugin's guidance for it says so in the
> imperative, because this is the screen where a model would most reasonably start recommending.

Two things that are not in the note and are here anyway, both because this unit created the need:

- **An accounts screen** under Settings, since onboarding creates accounts and they need somewhere
  to live afterwards. It is Settings' second section, so the `/settings` shell and its sub-nav are
  built here too (docs/06).
- **Account merge**, which is the "duplicate account created later" row in the table below —
  and, more to the point, the only repair for a document written before D-033 split one card into
  two. See D-034.

**Resumability is the document's.** Progress is a JSON value in `app_setting`
([04 Data Model](./04-data-model.md)), so killing the tab resumes rather than restarts, and the
progress travels with the file. What is *not* persisted is a half-filled step: every step writes
what it produced as it produced it — ticking an institution creates the account there and then —
so there is nothing half-filled to keep. The one batched step is the category list, where a tick is
an archive of a row that already exists, and the batch is applied on every way out of the step,
including "set this up later".

## Onboarding from a conversation (M7)

**Built** (D-096 for the shape, D-097 for what building it found). [F14 Claude Plugin](../../plugin.md) gains the ability to *create* a
`.emd` and walk the same eight steps in chat. Asked for directly, and it is the one part of
the app whose absence from the plugin is most obvious: everything else the plugin does assumes a
document that somebody already made in the browser.

**It cost one extraction, and the extraction is the interesting part.** What a ticked institution
*produces* lived in `ui/onboarding/Onboarding.tsx` as three private functions — which is the wrong
layer by this note's own test, since it is a rule and not layout, and it was invisible for as long
as a screen was the only caller. It now lives in `onboardingRepository` and both front ends share
it. The rule about `domain/` and the repositories being free of React had been an article of faith
backed by tests; this is the first thing that actually depended on it.

**It drives this machine rather than a second one.** `domain/model/onboarding.ts` is already pure —
the order of the steps, what "skipped" means, and the checklist are rules, not layout, and that was
the stated reason for putting them there. So the conversational flow is the same `advance`,
`skip`, `goTo` and `checklistItems`, over the same `app_setting` progress, which is what makes a
document half-onboarded in chat resume correctly in the browser and the other way round.

**Three rules of this note apply unchanged, and one gets sharper:**

- *Skippable at every step* is what makes the flow possible at all before ingestion exists — step 5
  is the first import, which is M7's last tier, so until then it is genuinely skipped and stays on
  the checklist rather than being faked.
- *Every step produces something real* is unchanged: ticking institutions creates the accounts and
  places there and then, through the same repositories.
- *Resumability is the document's* is what lets the two front ends share a flow at all.
- **A document that already holds work must not be onboarded** — `NO_ONBOARDING` — matters more
  here than in the app, because in the app you cannot open a stranger's document by typing a path.

**Claude Code renders a form.** It advertises `elicitation: { form: {} }` (verified against the
running client, D-096), so the institutions step can be an actual multi-select and the details step
an actual form rather than a list read out and a name typed back. **The UI is an enhancement and
never a requirement**: every tool takes the same answers as ordinary arguments, and a cancel, a
decline, or a client with no elicitation falls back to the conversation with nothing lost.

**What it does not do.** It does not reimplement the welcome copy, and it does not try to be the
browser flow in text. The interesting steps are the ones that *produce records* — institutions,
details, categories — and the conversation is better at those than a wizard is, because the user
can say "the two Leumi accounts and my Cal card" in one sentence instead of hunting a list.

## Principles

- **Skippable at every step.** Someone who wants to explore first must be able to. Skipped
  steps become dismissible cards on the Home dashboard, not lost.
- **Nothing is mandatory except the first account**, and even that can be created later from
  the import flow itself.
- **Every step produces something real.** No screens that only explain. The user finishes with
  actual accounts, actual categories, and ideally actual transactions.
- **Under three minutes** to the first imported statement, for someone with a file ready.
- **Resumable.** Progress is persisted; killing the app mid-onboarding doesn't restart it.

## Flow

### Step 1 — Institutions

A searchable, multi-select list, grouped:

| Group | Examples | Creates |
|---|---|---|
| Credit cards | Cal, Max, Isracard, Amex, "other" | `Account` (kind `CREDIT_CARD`) |
| Banks | Hapoalim, Leumi, Discount, Mizrahi-Tefahot, Beinleumi, Yahav, "other" | `Account` (kind `BANK`) + `HoldingPlace` (checking) |
| Investment platforms | brokerage and trading platforms, provident-for-investment providers, "other" | `HoldingPlace` (investment) |
| Pension / hishtalmut | the managing companies, "other" | `FundAccount` stubs ([F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md)) |

**"Other" is always present and always works** — free-text name plus a type. The institution
list is convenience data, not a constraint, and a user with an unlisted provider must never be
blocked. The list ships as editable reference data so it can grow without a code change.

For each selected institution, a light detail step: a nickname and, for cards, the **last 4
digits** — which is what makes card-settlement matching work in
[F06 Bank Statement Import](./f06-bank-statement-import.md). Ask for it here, once, rather than mid-import later. Skippable,
but explain in one line why it's worth entering.

The last-4 turned out to matter more than settlement matching: it is what makes a statement file
resolve to the card the user already named, rather than to a second account for the same card
(D-033). The details step also offers "another card here" per issuer, because two cards from one
issuer is ordinary, and a nickname is very often Hebrew — every one of them renders through `Bidi`
and every field carrying one is `dir="auto"`.

### Step 2 — Categories

Show the seed set from [F02 Category System](./f02-category-system.md) grouped, with everything pre-selected.
The user deselects what they don't want and can add their own. One screen, no wizard.

**Deselecting archives; it does not delete.** Nothing is auto-deleted in this app, archiving is
already "hidden from the pickers, kept in history", and a category the user changes their mind
about is one tick away on the Categories screen. Unticking a parent takes its subcategories with
it — an "Electricity" left behind when "Utilities" is gone is stranded in every picker with no
parent to sit under. The system categories are not offered: Uncategorized and Internal Transfer are
what the app itself uses, and turning them off is a fault rather than a choice.

Deliberately after institutions: it's the least interesting step and the easiest to skip, so it
shouldn't stand between the user and their first import.

### Step 3 — First import

Straight into the flow from [F01 Card Statement Import](./f01-card-statement-import.md), with the account pre-selected from
step 1. This is where onboarding either succeeds or fails — a user who gets their real
transactions on screen in the first session will come back.

The import flow is not reimplemented inside the step, and the account is not so much pre-selected
as *already there*: dropping a file anywhere in the window is the import (docs/f01), it takes the
whole window when it starts, and the file's own stated card number lands it in the card the user
named a moment ago. The step's own content is therefore a file picker, the sentence naming where it
will go, and a way out; the step is finished by an import committing, not by a button — which is
also why it has no Continue.

If the user has no file to hand, offer **"I'll do this later"** and, optionally, **sample data**
so the app can be explored with something in it. Sample data must be obviously fake, clearly
labeled, and removable in one action that leaves nothing behind.

### Step 4 — The documents you already have

**Built** (D-166), and it is the payslip step this section used to describe plus the half M13 added.
A payslip and a fund report are the two documents that make the file worth opening again, and the
two nobody thinks to offer, so the step asks for them by name. Each row hands over to the same
intake the real screen uses, so a document read here teaches the document exactly what it would
have taught it later.

- **A payslip** — the reader, not a form: gross, net and every deduction line read off the PDF and
  shown before anything is written ([F04 Paycheck Tracking](./f04-paycheck-tracking.md)).
- **Fund reports, per fund** — the D-164 stack, several at once, and the old ones from previous
  jobs especially ([F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md)).
- **Which deduction feeds which fund** — offered here because it is the one moment where the
  connection is obvious, exactly as this note has said since M1. It is what produces the expected
  contributions the deposit check runs on, it is app-only, and without it every fund reports having
  no payslip data forever.

### Step 5 — What you hold, and what you plan to buy

**Built** (D-201), between the documents step and the checklist. Two questions and three answers: a
broker statement read through M16's ladder, a position typed by hand, or an amount and a cadence
naming what you intend to buy — and that last one **may name a security you do not hold yet**, which
is what `PurchasePlan.holdingId` being nullable has meant since migration `025` and what the
purchase-plan tab refused until this step needed it.

A brokerage is not a pension: nearly everybody has one of those and most people have neither
position nor plan, so this step is one sentence and a skip for them, and the checklist item it
leaves behind is the only conditional one on the list.

**The app records an intention and never offers one.** No screen here ranks a security, suggests
one, or has an opinion about one — said on the step, and said again in the plugin's guidance for it
because a tool description is an instruction the caller follows.

### Step 6 — What's next

A short checklist that persists on the Home dashboard rather than a "you're done" screen.
**Built there in M6** (D-108); it was a card above every route in the meantime, which is not the
same thing — a banner in the way gets dismissed to clear it, and this list is supposed to run
quietly for weeks:

- Import your other cards
- Import a bank statement
- Add your savings goals
- Set up your paycheck split
- Enter your pension balances

All five exist and are on it. **Filing is not**, and that is deliberate (D-166).

Each item links to the relevant flow and disappears when done. This is onboarding continuing
quietly across the following weeks, which is more realistic than trying to configure everything
on day one.

## Institution reference data

Shipped as data, not code: name, type, aliases (Hebrew and English, including former names —
Leumi Card / Max is exactly the kind of rename that breaks matching), logo or color, and any
known statement-file hints that pre-fill the mapper in [F01 Card Statement Import](./f01-card-statement-import.md).

Being data means the list can be corrected, extended by the user, and shipped forward without
touching the import pipeline.

**Built** as seed rows in migration 006 rather than as a TypeScript module: "editable by the user"
means it has to be in the document, which is the same argument that puts the category seeds in 002.
Six card issuers, nine banks, six investment platforms and eight fund managers, each with Hebrew
and English aliases including former names — searching `לאומי` finds Max, which is the case the
aliases exist for. No colours or logos: the design language has nowhere to put them
([11 UI Design Language](../../11-ui-design-language.md)). Statement-file hints are not there yet; the
header-signature match already does that job (D-027).

## Progressive setup after onboarding

Things that cannot sensibly be set up on day one, because they need data first:

- **Fixed expenses** — needs 3 months of history ([F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md)). Offered when
  enough history exists.
- **Rules** — grow from corrections during real use ([F03 Auto Categorization Engine](./f03-auto-categorization-engine.md)).
- **Split plan** — needs at least one paycheck ([F05 Paycheck Splitter](./f05-paycheck-splitter.md)).
- **Debts** — offered when an installment group or a recurring loan payment is detected.
- **Pension snapshots** — prompted when the user next has a fund report in hand.

Each of these appears as a Home dashboard card when its precondition is met. Setup is a
sequence spread over months, not a wizard.

## Screens

- **Welcome** — one screen, what the app does, local-and-private stated plainly, one button.
- **Institution picker** — search, grouped list, multi-select, "other" entry.
- **Institution details** — nickname and last-4 per selected item, in one scrollable list rather
  than one screen each.
- **Category selection** — grouped checkboxes, add-your-own.
- **First import** — the existing flow, entered with context.
- **Documents** — a payslip, the fund reports per fund, and the deduction-to-fund links.
- **Checklist** — persists into Home.

## Data touched

Creates: `Account`, `HoldingPlace`, `FundAccount` (stubs), `Category`,
`DeductionType` (seeds), onboarding progress state.

## Edge cases

| Case | Behavior | Built |
|---|---|---|
| User skips everything | App is fully usable; Home shows a "get started" card. Accounts can be created from the import flow. | Yes — the card sits above the ledger until Home exists. |
| Institution not in the list | "Other" with free text. Never a blocker. | Yes, in both groups. Typing a name that is already there returns that row rather than making a second one. |
| User selects 8 cards and 3 banks | All created; the list stays manageable because accounts are grouped by kind. | Yes; the accounts screen groups by kind. |
| Duplicate account created later | Offer to merge accounts, moving transactions across. | Yes — see D-034; the duplicate rows a merge would drop are counted before it runs. |
| Reinstall with a backup | Restore path bypasses onboarding entirely; offer it on the welcome screen. | Yes. Opening a document that already holds anything is read as "not onboarding", so it bypasses the flow whether it is opened from the welcome screen or the header. |
| Sample data left in place | Persistent, dismissible banner; one-tap removal that also removes derived records. | No sample data, per Open Questions. |
| Last-4 entered wrong | Editable on the account screen; settlement matching re-runs on demand. | Editable, on the accounts screen and in onboarding's detail step. Re-running settlement matching waits on F06. |
| User picks a pension fund but never enters a balance | Fund shows as "no data yet" with a prompt, not as ₪0. | Waits on M5, with the rest of the pension picker. |
| A card is archived and a statement for it arrives | The card comes back rather than a second account being created for it. The last-4 is the card's identity, and forking it would break the idempotence the natural key gives (D-033). | Yes. |
| An institution is unticked after an import landed in its account | Refused, with the reason and the two alternatives — archive, or merge. An untick is not a delete order for a card with history. | Yes. |

## Acceptance criteria

- A user with a statement file reaches imported transactions in under three minutes.
- Every step is skippable and the app remains fully functional with all steps skipped.
- Onboarding is resumable after the app is killed.
- Sample data removal leaves no residue in any table.
- Records created during onboarding are indistinguishable from ones created manually later.

All met except the sample-data one, which is moot. The last is met by construction: onboarding
calls the same repository functions the accounts screen does, and a card it created is matched by
an incoming statement exactly as one created by an earlier import would be — checked end to end,
one statement into an onboarded card, no second account.

## Open questions

All three are settled, each in the direction its recommendation pointed.

- **Household composition:** not asked. Personal data the app does not otherwise need, and it can
  infer plenty from actual spending.
- **A remotely updated institution list:** no. It would break the zero-network-requests property
  of [09 Decision Log](../../09-decision-log.md) D-012. The list ships in migration 006 and the user
  can extend it.
- **Sample data:** not built. The empty states each name a concrete next action, which is what it
  would have been for. Worth revisiting only if the first-import step turns out to be where people
  stop.

Still open, and not this unit's:

- The institution list is **editable only by adding**. There is no screen for renaming or removing
  one, and docs/06 lists Institutions as a settings section. Nothing needs it yet: a seed row that
  is wrong is a bug to fix in a migration, and a user-created one is only reachable through an
  account that can be renamed.
- **Re-running settlement matching** after a last-4 is corrected needs F06 to exist first.

## Related

[F01 Card Statement Import](./f01-card-statement-import.md) · [F02 Category System](./f02-category-system.md) · [F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md) · [F06 Bank Statement Import](./f06-bank-statement-import.md) · [06 Navigation and Screens](./06-navigation-and-screens.md)
