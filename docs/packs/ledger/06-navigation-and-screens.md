---
type: spec
project: Emerald
---

# 06 — Navigation and Screens

## Shell

**As built: a document row across the top, a sidebar down the left, content beside it.**

```
┌───────────────────────────────────────────────────────────────────────┐
│ finances-2026-08 ○ saved 14:32        Save  Open…              — □ ×  │
├──────────────┬────────────────────────────────────────────────────────┤
│ ◆ Emerald    │                                                        │
│ ◇ Home       │                                                        │
│ ▤ Transactions                            content                     │
│ ⑂ Wealth     │                                                        │
│   Savings    │                                                        │
│   Debts      │                                                        │
│ ☀ ◐ ☾     ⟨  │                                                        │
└──────────────┴────────────────────────────────────────────────────────┘
```

The top row shows the **open data file and what has happened to it** — the app is document-based
([02 Architecture](../../02-architecture.md)), so which file you have open is permanent context, not
a setting. Since D-155 that indicator reports rather than warns: the app writes the file itself
wherever there is a path to write to, so the row reads *saving… / saved 14:32*, and keeps the
`Ctrl+S` nudge only where pressing it is the only way out. In the shell that row *is* the window's title bar, drawn by the app in a frameless
window; in a browser tab it is the same row without the drag region (D-130).

`Ctrl/Cmd+K` opens the command palette over both — every screen and every operation in one
search box, which is how you reach a child screen of a section you are not standing in. Past
two characters it finds **entries** too, after the places and commands (M37 U2c, D-475 3B): the
rows `search_document` finds, names first, four a format and *n more in X* opening that format's
list holding the search; choosing one lands on the one entry view.

The sidebar is 200px, collapses to its icons on `Ctrl/Cmd+B` or the View menu, and remembers
which across launches. **Sections expand in place and by route**: you are in a section or you
are not, so a drill-through that lands on a fund detail opens Wealth exactly as a click would.
A declared format is the one exception (M37 U2, D-475): a folder of its entries with an arrow of
its own, opened by hand and remembered the same way.
The list is hidden entirely while the import flow or onboarding is running — navigating
mid-review would strand staged rows behind a screen with no way back, and onboarding is a flow
with its own way out. The *bar* stays, narrowed to its icons, because the theme control lives in
it now.

**This departed from the left sidebar this note originally specified, and the departure has been
reversed** (D-044, settled by **D-054**, reversed by **D-130**). The top header is gone rather
than moved: the wordmark and the theme control are sidebar furniture, the document is the title
bar, and the four section shells below keep their routing while their sub-navs became the
sidebar's nested items.

D-054's deciding argument was width, and it was right about a browser tab. Every primary screen
here is a table: the ledger at 500 rows, the mapper's preview grid (which this note specifies as
full-bleed), the gross→net waterfall with eight Hebrew deduction names — and a permanent 200px
column is a permanent tax on all of them **when the app does not control the viewport**. Since
D-126 it controls the window: it sets the minimum size and takes back the entire header row, so
the column costs less horizontally than the row it replaces costs vertically. That is a changed
premise, and D-130 is where it is argued.

And the count goes *down*. Adding fixed expenses turned Transactions · Paychecks · Categories ·
Settings into Transactions · **Plan** · Categories · Settings — four items before and four after,
with a screen gained. M5's savings, funds and debts become **Wealth**; M6's reports became
**Insights** and then, in D-157, three periods of Home. Each stays one item wide however many
screens it holds.

Flat paths that have no sibling to sit beside stay flat: `#/`, `#/categories`, `#/transactions/merchants` (was `#/categorize`, M28 U6). A
section arrives when a section has two screens, which is what just happened to Plan.

## Sections

| Section | Question it answers | Contains |
|---|---|---|
| **Home** | "How am I doing?" | The month itself — summary, income vs expenses, category breakdown, comparisons — with **what wants you** above it, and the year and trends behind a period control. |
| **Money** | "Where did it go?" | Transactions table with filters, import entry point, mapper, import review, transaction detail, bulk categorize. |
| **Paychecks** | "What did I actually get paid?" | The payslip list, the entry form, the reader, the net trend. Intake, so it is top level (D-157). |
| **Plan** | "Where should it go?" | The splitter, fixed monthly expenses. |
| **Wealth** | "What do I own and owe?" | *Savings & debts* (with the money map), *Funds* (with fee impact and the deposit check), *Investments* (with what to buy), *Net worth*. |

Settings is a nav item, not a gear: categories, rules, import mappings, accounts,
institutions, deduction types, places and holdings, data (open/save/export), AI, appearance.

**The order is the order intake happens in** (D-157): Home · Transactions · Paychecks · Plan ·
Wealth · Categories · Settings. Seven items before the rearrangement and seven after. **Insights is
not a section** — it was three screens under a genre, and its first one and Home drew the same
`monthlyReport`; the month is Home and the other two are periods of it.

**Three levels, and only two of them are in the rail.** A section and its children are *places*; a
child's **tabs** are views of one place, drawn as a strip above the screen (`ViewTabs`, from
`nav.ts` like everything else). That is what let Wealth go from seven children to three without
anything becoming unreachable: the command palette lists all three levels, so *Fee impact* is still
found by its own name.

**Routing is hash-based** (D-133). The paths as built are `#/` (Home · Month), `#/year`, `#/read` and `#/read/<id>` (reading files, M28 U5),
`#/transactions`, `#/paychecks`, `#/paychecks/deductions`, `#/categories`,
`#/transactions/merchants` (was `#/categorize`, M28 U6),
`#/plan/{fixed,splitter}`, `#/wealth/{savings,debts,places,funds,fees,deposits,worth}` and
`#/settings/{accounts,mappings,formats,rules,model}` — section-scoped where a section
exists and flat where one does not (D-054).

**Every hash that ever worked still lands somewhere sensible** (D-031), which was M13's condition
rather than a nicety: `#/insights` and `#/insights/month` → `#/`, `#/insights/year` → `#/year`,
`#/insights/trends` and `#/trends` → `#/year` (D-313), `#/plan/paychecks` → `#/paychecks` (which is where it was before
D-054 moved it), `#/settings/deductions` → `#/paychecks/deductions` (D-170), `#/wealth/<id>` → the
fund. An unknown hash redirects to **Home** rather than
showing an error page; it is a typo or a stale bookmark, not a failure.

## Screen inventory

### Home
- **Home** — *built*, at `#/` (D-108, D-157). **The month itself**, not a summary of it: the
  monthly report is the body of this screen, and above it is **what wants you** — a list ordered by
  *consequence* rather than by count, so unfiled transactions come first however few there are,
  because until they are filed every total on every other screen is wrong. Nothing with a count of
  zero appears; the empty case gets a sentence instead. `homeSummary` is the one `netWorth` (M36 U07) and five
  counts, and the month is the body's own `monthlyReport` — **one call where the dashboard and the
  month screen used to make two** (D-157). Getting started is one line here — the guide's, and where it resumes (D-330) — and a
  month with nothing recorded gets a sentence rather than a row of zeros.
- **The period control** — *built*, `#/` and `#/year`: **Month · Year** since M28 U5 (D-313), in the
  approved mockup `docs/mockups/m28-u5/home.html`. Trends is not a third view: its category lines,
  merchants and year-apart comparison are Year's, and the months' CSV moved to Settings › Export.
  Empty state guides a first import.
- **The ledger moved to `#/transactions`** so this could be the root, which is what this note has
  specified since it was written. The five drill-throughs that used to navigate to `/` name the
  ledger explicitly now — a screen that ignored their `state` would have looked like it worked.

### Money
- **Transactions** — a dense table with a sticky header, sortable columns, and a filter bar:
  date range, account, category, uncategorized-only, amount range, text search. Multi-select
  with shift-click for bulk actions. Right-aligned amounts, and the running total of the current
  filter as the screen's hero number at the top rather than in a footer — it is the answer to
  what the filter bar asks, and a total you have to scroll to is one nobody reads. A second
  currency is shown beside it, never folded into it.
  **Built**, sorting and multi-select included — both were deferred to M2 with bulk categorize
  (D-032) and landed with it (D-047). The filters *and the sort* resolve in SQL, so the hero number
  totals the whole filter rather than the capped page and "the largest charge" is not "the largest
  of the 500 most recent". Multi-select extends over the rows as sorted, "select all" means the
  filter rather than the page, and assigning the selection offers a rule when it turns out to be
  one merchant. A correction made here offers a rule, above the table (D-042, D-043).
- **Transaction detail** — a right-hand side panel rather than a separate page, so the table
  stays visible. Full record, provenance ("row 47 of cal-2026-07.xlsx"), edit category / note /
  tags, exclude from stats, create a rule from this merchant. **Built except tags**, which have
  a column and no UI and no milestone asking for one. The panel also names the rule that
  assigned the category and what it beat (D-041).
- **Import — pick file** — then either "using your Cal mapping" or straight to the mapper.
- **Import — mapper** — the file as a full-width scrollable preview grid; click a row to mark it
  as the header; click a column header to assign its role; unmapped columns greyed; raw cells in
  mono so stray characters are visible; a live strip showing three fully parsed transactions;
  the parsed-total-versus-printed-total check; save and name.
  See [F01 Card Statement Import](./f01-card-statement-import.md). **This screen is the reason the app is desktop-first** — a
  15-column grid with a preamble is not a phone experience.
- **Import — review** — the most important screen in the app. Virtualized table with status
  chips (new / duplicate / updated / error), suggested categories inline, shift-click
  multi-select, bulk actions (accept all new, categorize all from merchant X), summary bar,
  commit button. Keyboard-first: `J`/`K` to move, `C` to categorize, `Enter` to accept.
  Must handle 400 rows without lag.
- **Import — result** — counts, link to what was created, undo option. **Built without the
  undo**: there is no undo mechanism anywhere in the app, and the honest substitute is that
  nothing is written to the user's file until they save, which the result screen says.
- **Bulk categorize** — grouped by merchant, assign once, offers to create a rule. **Built**
  (D-047) at `#/transactions/merchants` (was `#/categorize`, M28 U6), and deliberately **not in the nav**: it is an operation rather than a
  place, reached from the ledger's uncategorized count and from the guide's By merchant step —
  which is where the user is standing when they want it. It only ever touches rows with no
  category; the two tools that can change a category you already picked are both beside it and
  both show you the rows first. It also carries the queue's other two answers — *Bill or debt?*
  opens the panel that makes a name a fixed expense, or points a debt at it (D-191).

### Paychecks
- **Paychecks** — list by period, net trend sparkline, add/edit.
- **Paycheck entry** — gross, net, payment date, employer, then deduction lines with a
  built-in picker and inline add-new; live reconciliation delta.
- **Built: `#/paychecks`** — top level since D-157, and `#/plan/paychecks` redirects here. The
  list with its **net trend**, the entry form, and the **paycheck
  detail with the gross→net waterfall**, as three views behind one route. The list is month, what
  it paid, and whether the itemization adds up; the month opens the detail. The trend spans up to
  twelve salary months, breaks where a month has no slip and names those months (D-051).
  Entry **replaces** the list rather than sitting beside it (D-050): a payslip is a dozen fields
  and the thing being copied from is on paper. The reconciliation strip is pinned to the foot and
  never blocks saving. "Copy from last month" is offered while the form is still empty and fills
  every line from the newest slip. The deduction picker is a native `<select>` with recents first
  and kinds below, and "+ New deduction type…" adds one without leaving the half-typed slip.
- **Built: *Where it went*** — M17's view (D-193), half of the month on `#/paychecks` since M28 U4
  (D-312; `#/paychecks/trace` lands there). One month followed from the slip through the split to
  where it sits: what the plan did with the net and what payroll sent out of the gross. It
  **writes nothing** — every row is a join over records that already exist — and where a chain
  cannot be followed it names the missing link rather than dropping the row.

### Plan
- **Splitter** — the playground. Basis selector, fixed-expense toggle, bucket list with
  percentage/amount inputs and sliders, live remainder indicator, visual bar of the split,
  save as named plan, "apply to this month".
- **Built: `#/plan/splitter`** — all of the above except "apply to this month", which is the next
  unit. **No Save button**: every edit is written as it is made, and getting it to disk is the
  document row's job, not this screen's (D-057, and D-155 made it the app's). The plan picker, duplicate, make-default and delete are
  a select and three buttons in the toolbar rather than a plans screen — plans are a handful, not
  a place. The bucket editor is a popover and offers three target kinds, not five. The stacked bar
  draws the unallocated remainder as an empty slot, which answers "am I done" faster than the
  number does. The balance strip is pinned to the foot, the way the reconciliation strip is, and
  over-allocation reads as a **drawdown** rather than an error.
- **Fixed expenses** — confirmed list plus a "detected candidates" section with
  confirm/dismiss, projected monthly total.
- **Built: `#/plan/fixed`** — all of it in one place, plus two things this note filed elsewhere
  (D-055). The **variance view is a column** rather than a fourth screen: "this month versus
  expected, with deltas" is one number per row and belongs beside the amount it is a delta from.
  The **candidate review** is on the card rather than behind it — occurrences, the month-by-month
  bars, the usual day, how far the amount moves — because the user is agreeing with an inference
  and cannot do that from a badge; amount and cadence are editable before confirming, not after.
  The whole screen is about **the last complete month**, said in words on the screen: ending at
  today would report every monthly bill as missing for the first days of each month. The hero is
  the monthly total with its share of average net beside it, and a payroll deduction gets its own
  figure that is never in the total. Dismissed merchants are listed at the foot with a way back.

### Wealth

**Built: Savings, Goal detail, Debts, Debt detail, Net worth, Money map, Funds, Fund detail, Add
snapshot, Fee impact and Deposit check** (D-068, D-071, D-072, D-076, D-085, D-107). **A shell —
three sidebar children over seven screens since D-157**: *Savings & debts* (savings, debts, the
money map), *Funds* (the funds list, fee impact, the deposit check) and *Net worth*, with the four
that left the rail reached by a tab strip and by their own names in the palette. **Every route is
unchanged** — `#/wealth/{savings,debts,worth,places,funds,fees,deposits}` — and `#/wealth` now
redirects to savings, which is what the rail has said leads the section since D-086. The promotion waited for a second *sibling*: funds
arrived alone (D-068) and a fund's own screen is a screen *of* a fund — a **pane beside the list**
since D-130, at the same hash it always had — rather than a destination
(D-071), so it was fee impact and the deposit check that made the section do work; F07 then cost
two rows in a list, which is the property the shell was promoted for. Those rows are nested items
in the sidebar since D-130; the routes are unchanged. **Savings leads** — goals are
what someone opens this section to see and can act on this month, and **debts follow them**: what
you are putting aside and what you owe are the two halves of the section's question, where a
pension is a thing you check twice a year. F08 then cost one row in the same list (D-085). `#/wealth/<id>`, the fund-detail
path for one commit, forwards to `#/wealth/funds/<id>`. **Net worth follows savings and debts**
rather than leading: it is the section's answer, and the two halves are where the work happens
(D-107).

- **Savings** — *built* (D-076), at `#/wealth/goals` (it was `#/wealth/savings` until M28 U8). Goal cards with a progress ring, balance,
  target and required monthly figure; the liquid total beside the saved total on the hero. An
  emergency goal's ring is measured against **reachable** money, the same figure its panel uses.
- **Goal detail** — *built*, at `#/wealth/goals/:goalId`. The emergency panel (both bases at one
  multiplier), where the money sits, the compounding projection, deposits by month, and the
  movements the balance is a sum of. A **child** of the savings tab, as the fund detail is of funds.
- **Deposits** — *built*, as a **view** of the savings tab rather than a screen of its own: a flat
  chronological list with monthly net subtotals, filterable by goal and place. As a destination it
  would be read by whoever navigated to it, which is nobody (D-055's argument).
- **Add deposit** — *built*, as one form with three modes: money in, money out, and moved between
  places. The sign is a mode rather than a minus the user types, and a move writes two legs that
  net to zero.
- **Money map** — *built* (D-076), **rebuilt by M15** (D-175 to D-177); **since M36 U08 (D-385) it is Net worth's table at `#/wealth`**, one row per account or place, and `#/wealth/places` redirects there. Before that, the
  goal × holding place matrix with liquid and locked subtotals; the places with their **holdings**
  beneath them; and every fund as a row of its own. The third column is **how each balance is known
  and when it was last checked**, not a rate — the rate moved onto the holding that earns it, which
  is what stopped the map from talking about interest.
- **Funds** — *built.* Pension and hishtalmut accounts: balance, as-of staleness, fee, and a
  warning chip when deposits look missing. Dormant funds in their own section with their annual fee
  cost. **A card is a way in**: the name opens the fund's own screen, and what stays on the card is
  what you compare *across* funds. The readings moved to the detail screen when it landed (D-071).
- **Fund detail** — *built*, at `#/wealth/funds/:fundId` (D-071). Balance over time with
  contributions and returns separated, fee panel, expected-versus-actual deposits by period, and the
  readings the lot is derived from. A **child** of the funds tab, not a sibling of it.
- **Add snapshot** — *built.* Field order matching how fund reports are laid out, and the
  components' remainder shown while they are typed, so a transposed digit is caught at the moment
  it is made.
- **Fee impact** — *built* (D-072). Current fee versus a target fee across three assumed returns,
  with every assumption a slider and every starting figure naming where it was read from. The answer
  is a range, printed signed, and a zero always says which of its three meanings it has.
- **Deposit check** — *built* (D-072). Cross-fund reconciliation: the gap as the headline, the
  acknowledgement where the gap is found, and the funds that cannot be checked listed with what each
  one needs. It computes nothing — the same `fundDepositChecks` call the funds card's chip reads.
- **Debts** — *built*, at `#/wealth/debts` (D-085). Outstanding and progress per debt, the monthly
  obligation with what it left out named, and the review queue as a **view** of the same screen
  with its count in the toggle — D-055's call about the variance view, arriving a third time.
- **Debt detail** — *built*, at `#/wealth/debts/:debtId`. Payment history naming where each payment
  came from and how much of it came off the balance, the balance-over-time step chart, and the
  projection with the figure it divided by.
- **Debt editor**, **payment review queue** and **add payment** — *built* with them.
- **Investments** — *built* (M16, D-185), at `#/wealth/investments`. What the portfolio is worth,
  what it cost, what it has made, and what it is made of — a composition ring with every wedge
  named beside it, positions grouped by the place they are held at with that account's cash in the
  same table, and the printed total typed in at the foot to reconcile against. **Everything the app
  could not value is named above the fold** rather than counted as zero: a security nobody has
  priced, a position in a currency with no rate. **The row's name is a link and nothing else on it
  is** — every verb that acts on one position moved to its own screen (D-197).
- **A position** — *built* (M16 U3, D-197), at `#/wealth/investments/:holdingId`. What is behind the
  figure: the identities the security carries, the **walk** that produced the cost basis one trade
  at a time, and every price with the one being used marked. *Price it*, *Record a trade*, *Edit*
  and *Close position* live here, and a trade or a price can be removed — the only way to undo a
  statement read wrongly. **A screen and not a pane beside its list**, unlike the fund, goal and
  debt details: the walk is eight columns.
- **What to buy** — *built*, a **tab** of investments at `#/wealth/investments/plan` (D-055's rule
  again). An amount and a cadence per security, restated as one monthly figure. It writes nothing:
  it feeds the projection and it is what an investment bucket on the splitter is a plan for.
- **What paid for it** — *built* (M16 U5, D-200), a **tab** of investments at
  `#/wealth/investments/funding`. The bank's side of the same account: each transaction that paid
  for something with the purchases under it, and the difference said in a sentence — money left as
  cash, or cash that was already there. Underneath, the purchases nobody has said paid for, each
  with a ranked list of the money that left an account within a fortnight of it. **Nothing is
  linked until somebody picks a row.** A tab rather than a panel on a position, because one
  transfer buys three securities.
- **Net worth** — built at `#/wealth/worth` (D-107) and since folded into Wealth's Overview: **one
  figure** since M36 U07, the bank's statements, holdings and funds less what is owed, which Home and
  the `savings` tool read too, with a list of everything it could not count. The 24-month line went
  with the screen, and its history in U07.

### Home's periods
- **The month** — *built*, and it **is Home**, at `#/` (D-088, D-157; it was `#/insights/month`). Month picker; income, expenses,
  balance, of-which-saved; category breakdown (donut + ranked list, rolled up with a flat toggle);
  day-of-month cumulative spend line with last month ghosted; largest charges. Every figure drills
  into the ledger, and a rolled-up row drills into a rolled-up ledger. **Income detail** and
  **fixed versus variable** complete it (D-091): what came in, one line per payslip and one per
  paying merchant, with a deposit a payslip already counts named as such and linked to the queue
  that settles it; and the month's spending split into what was already committed to and what was
  not, with a payroll deduction shown beside the bar and never on it.
- **Yearly overview** — *built*, at `#/year` (D-089; it was `#/insights/year`, and it is what made
  Insights a shell before D-157 dissolved the section).
  12-month bar chart of income/expenses/balance, month-over-month table, category totals for the
  year, and the payslip figures as their own block. A month nobody imported draws **nothing** and
  its row says so; a month still running is dimmed, counted in the totals, and out of the averages.
- **Trends** — *folded into Year* by D-313 (M28 U5); `#/trends` lands there. Built at `#/trends` (D-090; it was `#/insights/trends`). One metric over twelve or twenty-four
  months with a dashed trend line and a rolling twelve-month total, one category over time, the
  same month year on year, and the merchant leaderboard. The window is filled in, so its gaps show.
- **Comparisons** — *built* as the month's chips (D-088): this month vs last, vs the
  3-month average, vs the same month last year, each naming what it could not answer.

### Outside the tabs

The shape below is a **rule now rather than a property of two screens** (D-163). Onboarding and the
import flow had it because `App` renders them instead of the router; `FlowFrame` is how a routed
screen says the same thing. It claims the window, the sidebar stops being navigable, the tab strip
draws nothing, `ListDetail` stops drawing the list, and the flow carries **one** way out — the
frame's, top-right, plus Escape from anywhere that is not a field. The four that use it are the
ones that transcribe a document: *Add a reading*, *Read a report*, the payslip reader and the
paycheck form.

### Onboarding (first run, outside the tabs)
- **Welcome** → **Institution picker** → **Institution details** (nicknames, card last-4) →
  **Category selection** → **First import** → **Documents** (a payslip, each fund's reports, and
  which deduction feeds which fund) → **Checklist**, which persists onto Home. Every step
  skippable. See [F12 Onboarding](./f12-onboarding.md).
- **Built**, all seven since D-166 — the documents step is where the payslip one landed. It replaces the routed views entirely
  while it runs and the sidebar's list is hidden — this is the "outside the tabs" above, and it is why
  the flow carries its own Back, Skip and "set this up later". Leaving lands on **Home**, where the
checklist it just wrote is waiting (D-108).
- The checklist persists as a **section of Home** (D-108), which is where docs/f12 always put it.
  It was a card above every route until M6 built the screen — a banner on top of the mapper and
  the import review is one people dismiss to clear it rather than because they are done. Same
  list, only the outstanding items, and the same dismissal setting.

### Settings
- Categories & groups · Rules (with a test box: paste a merchant name, see which rule fires) ·
  **Import mappings** (list, rename, edit, duplicate, delete, last used) · Accounts ·
  Institutions · Deduction types · Holding places · Data (export/import/backup) · AI ·
  Appearance.
- **Built: five sections — Accounts, Mappings, Formats, Rules and Local model**, nested under Settings
  in the sidebar since D-130 and a sub-nav of their own before it. D-031
  deferred the shell while mappings were the only section — an index of one is a click through
  nothing — F12's accounts screen was the second, the rules screen (D-040) the third, and
  deduction types (D-052) the fourth — and **deduction types left again in M14**: the payroll
  vocabulary is a view of payroll, so it is a tab of `#/paychecks` (D-170), and four screens that
  had to point at it in prose now point one level up.
  `#/settings/mappings` is unchanged and `#/settings` still lands on it, so nothing that pointed
  at the old path broke. **M28 U3 moved the readers out** (D-310): a statement's to
  `#/transactions/readers` and a payslip's to `#/paychecks/readers`, and M28 F1 a fund report's to `#/wealth/readers` (D-311);
  **M36 U10 made them one list** at `#/read/readers`, beside Read files, and Rules a tab of Categories (D-387); the old paths redirect, and
  `#/settings` lands on Accounts. Categories keeps its own top-level nav item; it was there before the
  shell and moving it would be churn for symmetry's sake.
- **Rules** is the third section: the list in evaluation order, an editor over all six kinds,
  enable/disable, delete, drag-and-keyboard reorder, and the **test box** — which calls the
  engine rather than describing it, so what it reports is what an import does (D-040).
- **Deduction types** is the fourth: the payroll vocabulary with `reducesNet` and
  `countsAsSaving` said in words on every row (guessed from the kind, *Change* to correct — D-388),
  because comparing them across the whole list is how a wrong one gets spotted. Name, Hebrew name, kind and order are editable on built-ins too;
  a built-in cannot be deleted and a type in use is refused with the reason (D-052). **Pays into**
  — which fund the type's lines are contributions to — landed with D-073 and is what makes F13's
  deposit check work at all; it is offered on types marked as saving, and a type already linked
  keeps showing its link whatever its flags say. Linking a type to a **goal or a debt** still waits
  for something to link to (F07, M6).
- **Accounts** carries the operations of [04 Data Model](./04-data-model.md): rename, the card's
  last 4, which institution it is with, archive, remove, and merge — with the number of duplicate
  rows a merge would drop stated before it runs.

## Cross-cutting UI components

**Built** — `src/ui/components/`, plus two at the top of `src/ui/`:

- `Bidi` — wraps any user-derived string with `dir="auto"` and bidi isolation. Used on every
  merchant name. Not optional; see [11 UI Design Language](../../11-ui-design-language.md).
- `Amount` — sign, colour, currency, tabular figures. (The `Money` of the original list; renamed
  because `Money` is the type in `core/`, and two meanings of one word is how a component gets
  imported for the wrong reason.)
- `Button` — one button in three weights and two sizes (D-030).
- `CategoryPicker` — the searchable category list, used by the ledger row, the detail panel and
  the import review screen, so a category is chosen the same way everywhere.
- `Chip` — metadata beside a name: text with a small dot, no pill. Colour only for a problem.
- `Kbd`, `ThemeToggle`, and `fieldLook.ts` — shared field and select classes,
  which is a constant rather than a component because the three screens using it need to add
  their own width and nothing else.

**Not built, each waiting on the screen that needs it:**

- `AmountInput` — the amount boxes parse with the importer's own `parseAmountText` today, so
  `₪1,234.56` pasted off a statement already works. A component when a third screen wants it.
- `DataTable` — sticky header, sortable columns, virtualized rows, shift-click multi-select.
  The tables are hand-written and share a header style; sorting and multi-select are the M2 line
  that would justify extracting it (D-032).
- `MonthPicker` — waits on the financial-month setting, which is not built.
- `EmptyState` — every list has one, written inline. A component when the copy stops being
  screen-specific, which so far it has not.
- `ReviewRow` — import review has its own row; so, now, does the debt-payment queue (D-085), and
  the fixed-expense candidates make three. Extracting it is a real candidate at this point, and the
  thing to check first is whether the three rows actually want the same affordances or only look
  alike.
- `StatCard`, `DonutChart`, `BarChart`, `LineChart` — M6, with
  [F10 Statistics and Reports](./f10-statistics-and-reports.md). `ProgressRing` is **built**, in
  `ui/savings/`, and the debts screens read it from there (D-076, D-085); it moves somewhere shared
  when a third feature outside those two wants it.
- `CategoryChip` with colour, icon and long-press-to-create-a-rule — colour and icon have no
  editor until M6. Creating a rule from a row is built, as a button in the detail panel and as
  the offer after a correction (D-041, D-042), rather than as a long-press.

## Interaction principles

- **Confirmation queues, not silent automation.** Anything the app inferred — a category, a
  fixed expense, a debt payment — appears in a review queue with the same accept/edit/dismiss
  pattern. Consistency here is what makes the automation trustworthy.
- **Every number is drillable.** Tapping a total shows the transactions behind it. No dead-end
  aggregates.
- **Skippable labeling.** The user can always defer categorization; the app keeps a visible
  backlog count rather than nagging.
- **Undo over confirm-dialogs.** Prefer an undo for reversible actions; reserve dialogs for
  genuinely destructive ones. **True in exactly one place**: re-apply, which records what it
  changed and offers to put it back (D-045). Everything else uses an inline confirmation panel
  stating what will happen and what will not — which is the right trade for actions that change
  one row the user is looking at. Undo earns its cost on the bulk operation nobody can inspect
  row by row beforehand.
- **Offline, instant.** No spinners for local queries. Charts render from pre-aggregated
  SQL, not from loading the full ledger.

## Accessibility and formatting notes

- English UI, LTR layout, but merchant names are Hebrew and must render RTL correctly inside
  LTR rows — use the `Bidi` component or Hebrew names will visibly scramble around punctuation
  and numbers. This is a real bug source; test with names containing digits.
- Charts always have an accompanying data table or list.
- Everything reachable by keyboard with a visible focus ring.

## Screen-size behavior

Desktop-first, but the app shouldn't be broken on a laptop or tablet:

- **≥1280px** — the design target. Sidebar plus content, side panels open beside tables.
- **≥900px** — the sidebar collapses to icons; side panels become overlays.
- **<900px** — wide tables scroll horizontally; the mapper shows a "this works better on a larger
  screen" notice rather than pretending.

**In the shell these are window minimums, not responsive rules** (D-130). The app sets its own
minimum size, so the smallest of them is a size the window does not have; the icon collapse becomes
a **`View` preference** someone chooses to get the width back on the mapper, remembered across
launches, rather than a breakpoint that has to be right unattended. The rows above still describe
the static site, which has no such control.

No phone layout is designed. That is a deliberate scope decision, not an oversight.

## Related

[00 Index](../../00-index.md) · [F01 Card Statement Import](./f01-card-statement-import.md) · [F05 Paycheck Splitter](./f05-paycheck-splitter.md) · [F10 Statistics and Reports](./f10-statistics-and-reports.md)
