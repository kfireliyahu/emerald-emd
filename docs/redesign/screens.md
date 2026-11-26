---
type: inventory
project: Emerald
milestone: M64
---

# What each screen is for

M64 U2 ([D-612](../09-decision-log.md#d-612)), for the redesign [D-606](../09-decision-log.md#d-606)
starts. Every screen of the app as it is **before** M64 changes any of them: the one question it
answers, in a newcomer's words; what someone comes to it to do; every block it shows; the shape of
each piece of data and the way the `dataviz` skill would show that shape; its measures; what it
repeats from another screen; and what could move one click behind the thing it explains.

**Demo documents only** (D-390, D-608): the ledger on `year.emd`, U16's synthetic year (fourteen
months, the last still running); the engine on `custom.emd` (one `card_charge` format, no pack) and
`project.emd` (the development pack). Nothing here came from a real document.

## How it was measured

```
npm run probe:screens -- --document year.emd --shots --routes '#/,#/year,…'
```

`probe:screens` reads `main` — the screen, not the title bar or the rail — at 1280x800, in light
and dark. The **contact sheet** is `.probe/shots/index.html` after a `--shots` run (git ignores the
folder; never commit a picture). The measures, as D-612 defines them:

| Measure | What counts |
|---|---|
| words | words drawn in the screen; *above* is those starting above the fold (800 px) |
| blocks | each `h2`-`h6`, and outside another block each table, chart (SVG 80x40 or larger), list of 3+ items, `data-block` |
| figures | digits at the secondary-number step (20 px) or larger, or a `data-figure` |
| actions | buttons, links, tabs, menu items; *p* is filled primary buttons |
| sizes | distinct font sizes text is drawn in |
| colours | distinct colours painted for text, backgrounds and chart marks (light; dark in brackets when different) |
| screens | how many windows tall the screen is |
| low AA | texts under 4.5:1 (light / dark), from the probe's contrast check |

Two limits of the count: rows drawn as `div`s (By merchant, the Plan's tiles) are words and actions
but not blocks, until the redesign marks them `data-block`; and a table that draws only the rows in
view counts only those.

## Every screen, measured

| Route | Screen | words (above) | blocks (above) | figures | actions (p) | sizes | colours | screens | low AA |
|---|---|---|---|---|---|---|---|---|---|
| `#/` | Home, the month | 622 (188) | 10 (1) | 8 | 70 (4) | 8 | 14 (15) | 4.0 | 9 / 9 |
| `#/year` | Year | 355 (130) | 8 (2) | 5 | 14 (0) | 7 | 12 | 2.8 | 16 / 16 |
| `#/transactions` | Transactions | 133 (133) | 1 (1) | 4 | 37 (0) | 5 | 10 (11) | 1.0 | 13 / 13 |
| `#/transactions/merchants` | By merchant | 204 (191) | 0 | 1 | 48 (0) | 6 | 13 | 1.1 | 3 / 3 |
| `#/paychecks` | Paychecks | 272 (118) | 5 (2) | 1 | 39 (1) | 7 | 11 (12) | 2.2 | 10 / 10 |
| `#/paychecks/deductions` | Deduction types | 321 (321) | 1 (1) | 0 | 37 (0) | 4 | 6 | 1.1 | 31 / 31 |
| `#/plan` | Plan | 779 (196) | 4 (2) | 8 | 117 (5) | 10 | 15 (17) | 3.5 | 32 / 32 |
| `#/wealth` | Wealth overview | 122 (113) | 1 (1) | 1 | 3 (0) | 6 | 6 | 1.2 | 0 / 0 |
| `#/wealth/funds` | Funds | 530 (198) | 5 (3) | 9 | 12 (1) | 8 | 7 (9) | 2.1 | 61 / 60 |
| `#/wealth/goals` | Goals | 236 (212) | 4 (4) | 4 | 13 (1) | 7 | 12 (13) | 1.5 | 7 / 7 |
| `#/wealth/debts` | Debts | 74 (74) | 2 (2) | 0 | 7 (0) | 6 | 7 | 1.0 | 6 / 6 |
| `#/categories` | Categories | 226 (89) | 15 (3) | 1 | 168 (0) | 7 | 19 (20) | 2.8 | 65 / 65 |
| `#/categories/rules` | Rules | 2573 (247) | 5 (3) | 0 | 680 (1) | 4 | 6 (7) | 17.6 | 233 / 233 |
| `#/read` | Read statements | 75 (75) | 0 | 0 | 3 (0) | 3 | 6 | 1.0 | 0 / 0 |
| `#/paychecks/read` | Read payslips | 46 (46) | 0 | 0 | 1 (0) | 2 | 4 | 1.0 | 1 / 1 |
| `#/read/readers` | Readers | 100 (100) | 1 (1) | 0 | 10 (0) | 2 | 5 | 1.0 | 0 / 0 |
| `#/settings/accounts` | Settings › Accounts | 54 (54) | 2 (2) | 0 | 14 (0) | 4 | 5 | 1.0 | 8 / 8 |
| `#/settings/packs` | Settings › Packs | 185 (185) | 3 (3) | 0 | 2 (1) | 4 | 5 | 1.0 | 0 / 0 |
| `#/settings/model` | Settings › Local model | 25 (25) | 0 | 0 | 1 (0) | 2 | 3 | 1.0 | 0 / 0 |
| `#/settings/calendar` | Settings › Calendar | 48 (48) | 0 | 0 | 0 | 3 | 3 | 1.0 | 0 / 0 |
| `#/settings/language` | Settings › Language | 55 (55) | 0 | 0 | 0 | 3 | 3 | 1.0 | 0 / 0 |
| `#/settings/export` | Settings › Export | 77 (77) | 0 | 0 | 3 (0) | 2 | 3 | 1.0 | 0 / 0 |
| `#/mcp` | Assistants | 1081 (151) | 21 (2) | 0 | 2 (0) | 4 | 4 | 5.1 | 0 / 0 |
| `#/formats` | Formats (custom · project) | 42 · 76 | 0 · 2 | 0 | 5 (1) · 25 (1) | 3 | 5 (6) | 1.0 | 0 |
| `#/formats/:name` | A format's table (card_charge · unit) | 63 · 240 | 1 · 1 | 0 | 30 (1) · 99 (1) | 4 | 7 (9) · 8 (10) | 1.0 | 0 |
| `#/formats/:name/entry/new` | Entry | 46 | 0 | 0 | 13 (1) | 3 | 8 (10) | 1.0 | 0 |
| `#/formats/:name/input` | Input | 72 | 0 | 0 | 10 (1) | 3 | 7 (9) | 1.0 | 0 |
| `#/formats/unit/board` | Board | 183 (180) | 1 (1) | 0 | 34 (1) | 4 | 8 (9) | 1.1 | 0 |
| `#/formats/:name/list` | List (card_charge · unit) | 64 · 82 | 0 | 0 | 15 (1) · 23 (1) | 4 | 7 (8) · 8 (9) | 1.0 | 0 |
| `#/formats/milestone/roadmap` | Roadmap | 183 | 1 (1) | 0 | 27 (0) | 5 | 7 (8) | 1.1 | 0 |
| `#/formats/unit/ready` | Ready | 81 | 2 (2) | 0 | 13 (0) | 4 | 5 | 1.0 | 0 |
| `#/formats/:name/dashboard` | A format's dashboard | 24 | 0 | 0 | 8 (1) | 3 | 6 | 1.0 | 0 |
| `#/dashboard` | The document's dashboard | 17 | 0 | 0 | 2 (0) | 3 | 3 | 1.0 | 0 |
| `#/agenda` | Agenda (custom · project) | 26 · 47 | 0 · 1 | 0 | 5 (0) | 4 | 5 | 1.0 | 0 |
| `#/connections` | Connections (custom · project) | 71 · 290 | 2 · 3 | 0 | 13 · 94 (0) | 3 · 4 | 5 (6) · 6 (7) | 1.0 | 0 |
| `#/formats/:name/read` | Intake, reading files onto a format | 65 | 0 | 0 | 1 (0) | 2 | 3 | 1.0 | 0 |
| — | The new-document start | not measured: the demo always opens a document | | | | | | | |

**The three densest screens by words** are Rules (2,573 words, 680 actions, 17.6 screens tall),
Assistants (1,081 words over 5.1 screens) and Plan (779 words, 117 actions, 5 primaries, 10 type
sizes). Home is fourth (622 words, 4 screens, one block above the fold). **By actions** it is Rules,
Categories (168) and Plan.

## What the measures say across the app

- **One primary per screen is broken on Home (4) and Plan (5)**: a filled *Track it* on every
  bill candidate, beside *Read files* and *Add a bill*.
- **The fold holds the chrome of a screen, not its answer**: Home has 1 of its 10 blocks above the
  fold (the waiting list); its flows, chart and categories start below it. Plan has 196 of 779
  words above it, most of them the months strip and the cushion.
- **The type ramp is not what is drawn**: Plan draws ten sizes (10, 11, 12, 13, 14, 15, 16, 17, 20,
  24 px), Home eight with 13 px and 22.6 px off the ramp, Paychecks a 32 px figure the ramp has no
  step for. 13 px is the most common size off the ramp (buttons, tabs, filters).
- **Low contrast is concentrated where secondary rows are drawn in `ink-tertiary`**: Rules 233
  (every built-in rule's merchant and actions), Categories 65 (*unused*), Funds 61, Plan 32,
  Deduction types 31. **Transactions measures 13 here and 53 on U16's view** — the bank's
  card-payment rows, struck through and left out of totals, are `ink-tertiary`: a redesign has to
  give a row that is *left out* a look that is still readable.
- **Eight screens have no `h1`**: Readers, Deduction types, Read payslips, Rules, Settings ›
  Accounts, and the engine's entry, input and intake. **Plan's `h1` is the plan's name** (*Everyday
  · default*), not what the screen is, and Read statements' `h1` holds its tab strip's labels.
- **Three engine views land on the sheet when the format has no shape for them**: a board for a
  format with no enum (`card_charge`), a roadmap where none is declared (`unit` on `project.emd`).
  Measured identical to the table; that is the fallback, not a fault, but the tab is offered.
- **The empty states are one line, as the rule asks**: the document's dashboard (17 words), a
  format's dashboard (24) and the agenda with nothing dated (26) draw almost nothing — the first
  thing a newcomer meets on a new document is one of these.

## The ledger

### Home — `#/`

- **Asks:** *How did last month go, and is anything waiting for me?*
- **Jobs:** see what came in, went out, was saved and is left over; answer what is waiting (85
  transactions with no category, 4 charges that look like bills, 2 holdings nobody counted); drop in
  the month's files.
- **Blocks now (10):** the drop zone with *Add a paycheck* and *Read files*; *Waiting for an answer*
  (each bill candidate with three months of bars and *Track it*, *Change…*, *Not a bill*; each
  holding with *Still right* and *New figure*); five flow tiles (came in, went out, saved, taxes,
  left over, each against its 3-month average); came in and went out by month, a line chart whose
  column opens a month; *Where it went* (14 categories with bars, then bills and everything else);
  *What came in*; *Against the plan* (3 buckets); *Saved* (into goals; pension and study fund beside
  it); *Biggest single charges* (5 rows); *All months* (14 rows, a missing statement shown in its
  month).
- **Shapes and their form:**
  - the five flows — *a total against its usual* → a KPI row of stat tiles, value, delta to the
    3-month average and a sparkline; *left over* is the hero figure.
  - came in and went out by month — *a trend*, two series → two thin lines, labelled directly, the
    open month marked; one axis.
  - where it went — *a part of a whole* read as *a ranked list* → ranked horizontal bars, one hue,
    largest first, *Other* folding the tail.
  - against the plan — *a plan against what happened* → a meter list: name, a bar against its own
    limit, figure; over is a word and a sign, not red alone.
  - saved — *a part of a whole* (where the saving went) → a thin segmented bar above the list that
    already names each part.
  - biggest single charges, waiting for an answer — *a list of rows to act on* → a table, one action
    per row.
  - all months — *a list of rows* with *a trend* in it → a table, the open month selected; its trend
    is the chart's.
- **Repeats:** the bill candidates are Plan's *4 charges look like bills*, block for block; *All
  months* is Year's *The months*; *Where it went* is one month of Year's categories; the
  uncategorized count is Transactions' *No category* and By merchant's list.
- **One click behind:** the bill candidates (behind *4 charges look like bills*, on Plan); the
  holdings check (behind its line, on Wealth); *Biggest single charges* (behind *went out*, as
  Transactions sorted by amount); *All months* (behind the chart, on Year); *Saved* and *Against the
  plan* (behind their tiles).

### Year — `#/year`

- **Asks:** *How did this year go, month by month?*
- **Jobs:** compare months; see which categories and shops grew; compare a month with the same
  month a year ago.
- **Blocks now (8):** the year's five totals; came in, went out and saved by month (a chart);
  *Where it went, and how it moved* (categories over the months); *Where it actually goes, by shop*
  (merchant, usually, months, all of it); *The same month, a year apart* (a table); *The months*
  (a table).
- **Shapes and their form:** the totals — *a total against its usual* → stat tiles against last
  year; by month — *a trend*, three series → lines (or columns for went out), direct labels;
  categories over time — *a trend* per part → small multiples of sparklines in a ranked list, one
  hue, the one that moved most emphasised; by shop — *a ranked list* → ranked bars; a year apart —
  *before → after per item* → a dumbbell per row, or the table with a change column; the months —
  *a list of rows* → a table.
- **Measures:** 355 words, 8 blocks (2 above), 5 figures, 14 actions, 7 sizes, 2.8 screens, low
  AA 16.
- **Repeats:** *The months* is Home's *All months*; the by-month chart is Home's with saved added.
- **One click behind:** *The same month, a year apart* (behind a month); the shop table (behind a
  category).

### Transactions — `#/transactions`

- **Asks:** *What exactly did I spend money on?*
- **Jobs:** find a charge; give a row its category; see what is left out of the totals and why.
- **Blocks now (1 table, 4 tiles):** went out, came in, left out of totals, no category (each a
  24 px figure); the count and *moved to what you own*; search and *Filter*; the table (date,
  charged, merchant, category, provider said, amount), card payments marked *left out*.
- **Shapes and their form:** the tiles — *a total* each → a KPI row, or a single line of figures
  above the table, since the table is the screen; the rows — *a list of rows to act on* → a data
  table, sticky header, numbers right.
- **Measures:** 133 words, 1 block, 4 figures, 37 actions, 1 screen, low AA 13 (53 on U16's view:
  the card-payment rows in `ink-tertiary`).
- **Repeats:** *No category* is By merchant's whole job and Home's first waiting line.
- **One click behind:** *left out of totals* and its explanation (behind the figure).

### By merchant — `#/transactions/merchants`

- **Asks:** *Which shops still need a category?*
- **Jobs:** give each merchant a category once for all its rows; see how much is done.
- **Blocks now:** a progress figure (*0 %*), the merchants in rows (name, rows, amount, a category
  chooser) — rows of `div`s, so no block is counted.
- **Shapes:** progress — *a ratio against a whole* → a meter; the merchants — *a list of rows to
  act on* → a table, largest first.
- **Measures:** 204 words, 48 actions, 6 sizes, 1.1 screens.
- **Repeats:** Home's *85 transactions at 7 merchants need a category*.

### Paychecks — `#/paychecks`

- **Asks:** *What did my paycheck pay, and where did it go?*
- **Jobs:** read a month's slip from gross to net; follow net pay to where it went (spent, bills,
  saved); see what went to pension and study fund; check every month has a slip.
- **Blocks now (5):** the month's net pay (32 px); net pay by month (a chart); where the net went (a
  list: spent, bills, to the bank, saved); what went to funds (pension, study fund); *All paychecks*
  (month, paid, gross, net, itemization).
- **Shapes and their form:** net pay by month — *a trend* → one line, no legend; gross to net to
  where it went — *a flow from one place to others* → a waterfall or a thin segmented bar from gross
  (taxes, funds, net) and net (bills, spent, saved), each part labelled; funds — *a part of a whole*
  → listed with a swatch; all paychecks — *a list of rows* → a table.
- **Measures:** 272 words, 5 blocks (2 above), 1 figure, 39 actions (1 primary), 7 sizes (32 px off
  the ramp), 2.2 screens, low AA 10.
- **Repeats:** net pay is Home's *came in* and Plan's *net pay*; taxes are Home's *taxes* tile.
- **One click behind:** the itemization (behind a month's row).

### Deduction types — `#/paychecks/deductions`

- **Asks:** *What does each line on my payslip mean?*
- **Jobs:** say what each deduction is (tax, insurance, a fund) and what it counts as.
- **Blocks now:** one table (name, on the paycheck, kind, counts as, the fund it pays).
- **Shapes:** *a list of rows to act on* → a table.
- **Measures:** 321 words, 37 actions, 4 sizes, low AA 31, no `h1`.

### Plan — `#/plan`

- **Asks:** *Where should next month's money go?*
- **Jobs:** say what each bill does to the plan; split what is left into buckets (goals, a debt,
  categories, spending); check last month against the split; keep a cushion.
- **Blocks now:** the plan's name and month; *Months on this plan* (twelve months to tick); what
  was recorded this month; *The cushion* (its target in months of bills, what counts, which
  accounts); four tiles (net pay, bills out of net, to split, not given a job); *Bills* (9 rows, each
  with how often, each charge, a month, this month, and three-way *Out of net / Part of the split /
  Ignore*); *4 charges look like bills* (with *Track it*); *The split* (planned, got, over the plan; a
  bar of buckets with dividers to drag; *Every shekel has a job*); the buckets table (bucket, for,
  how much as percent / fixed / what's left, planned, got); *New bucket*, *Suggest goal amounts*.
- **Shapes and their form:** the tiles — *a flow from one place to others* (net pay → bills → to
  split → buckets) → a waterfall, or one segmented bar from net pay that the split then divides;
  bills — *a list of rows to act on* → a table, the three-way choice one control; the split — *a
  part of a whole* → the tall segmented bar it is, each block named in a legend, dividers kept; got
  against planned per bucket — *a plan against what happened* → a meter list; the cushion — *a ratio
  against a limit* → a meter (months of bills held).
- **Measures:** 779 words (196 above), 4 blocks, 8 figures, 117 actions (5 primary), 10 sizes
  (10, 11, 12, 13, 14, 15, 16, 17, 20, 24), 15 colours (17 dark), 3.5 screens, low AA 32, 41 texts
  off the ramp, and a platform `<select>` (*Looking at the last 3 months*).
- **Repeats:** the bill candidates are Home's; net pay is Paychecks'; got against planned is Home's
  *Against the plan*.
- **One click behind:** *Months on this plan* (behind the plan's name); the cushion (behind its
  figure); the bill candidates (behind their count); the bucket editor (behind each bucket — the
  bar and the planned/got figures stay).
- **Year** (`#/plan/year`, M64 F12, D-631): the plan's second tab — *how did the year go against the
  plan?* in one sentence, each bucket a meter of the year's actual against the sum of its months'
  plan, and a bucket's months beside the page.

### Wealth overview — `#/wealth`

- **Asks:** *What do I own, all together?*
- **Jobs:** see net worth; see where it sits and how reachable it is.
- **Blocks now:** the net worth hero (40 px); one table (account or place, in it, reach, worth).
- **Shapes:** net worth — *a single headline* → a hero figure with its change since a month ago;
  where it sits — *a part of a whole* → ranked horizontal bars or a thin segmented bar by reach
  (now, soon, retirement) above the table.
- **Measures:** 122 words, 1 block, 1 figure, 3 actions, 1.2 screens.

### Funds — `#/wealth/funds`

- **Asks:** *Are my pension and study funds doing what they should, and what do their fees cost me?*
- **Jobs:** read each fund's balance and fee; see what the fee costs over time; check deposits
  arrived; know what cannot be checked yet.
- **Blocks now (5):** the funds table (fund, balance, fee, fee cost, deposits); *The two fees*; *What
  it is projected against*; *What the difference is worth*; *Not checkable yet*; nine figures, the
  total balance a 40 px hero.
- **Shapes:** the funds — *a list of rows* with *a part of a whole* → a table with a thin segmented
  bar of balances; fee cost over time — *a trend*, two series (this fee, a cheaper one) → two lines,
  the gap labelled; deposits — *a plan against what happened* (expected against arrived) → a meter
  list by month.
- **Measures:** 530 words (198 above), 5 blocks, 9 figures, 12 actions (1 primary), 8 sizes, 2.1
  screens, low AA 61.
- **Repeats:** pension and study fund amounts are Home's *Saved* side lines and Paychecks' funds.
- **One click behind:** the projection and *What the difference is worth* (behind a fund's fee);
  *Not checkable yet* (behind its count).

### Goals — `#/wealth/goals`

- **Asks:** *Am I on track for what I am saving for?*
- **Jobs:** decide this month's amounts; see each goal against its target; see when each lands.
- **Blocks now (4):** *Decide this month*; the goals table (where it stands, target, each month);
  *What you will have*; a stacked balance of the goals over 12 months.
- **Shapes:** each goal — *a ratio against a limit* → a meter list (saved of target, when it lands);
  over 12 months — *a part of a whole over time* → a stacked bar chart, or a line per goal with direct
  labels when there are three or fewer.
- **Measures:** 236 words, 4 blocks (all above), 4 figures, 13 actions (1 primary), 1.5 screens,
  low AA 7.
- **Repeats:** each goal is a bucket on Plan and a line of Home's *Saved*.

### Debts — `#/wealth/debts`

- **Asks:** *How much do I still owe, and when is it paid off?*
- **Jobs:** see what is left, what is paid each month, what an extra payment changes.
- **Blocks now (2):** *Debts* and its table (left, paid each month, extra each month).
- **Shapes:** what is left — *a ratio against a whole* (paid of borrowed) → a meter; when it ends —
  *a trend* → a line falling to zero, with the extra payment's line beside it.
- **Measures:** 74 words, 7 actions, low AA 6.

### Categories — `#/categories`

- **Asks:** *What kinds of spending do I have, and what is in each?*
- **Jobs:** arrange the tree; rename, add, merge; see a category's month.
- **Blocks now (15):** eight groups, each a heading with its count, *unused* count and total, and a
  list of its categories; a detail pane for the open category (*Housing & Rent*).
- **Shapes:** the tree — *a part of a whole* in levels → a list with a thin bar per row in the
  category's own colour (the one place the eleven hues are the subject); the open category — *a
  trend* → a sparkline of its months.
- **Measures:** 226 words (89 above), 15 blocks, 168 actions, 19 colours, 2.8 screens, low AA 65
  (*unused* in `ink-tertiary`).
- **One click behind:** the unused categories (behind *n unused* in each group).

### Rules — `#/categories/rules`

- **Asks:** *Which shop goes to which category, automatically?*
- **Jobs:** see, edit, order and disable rules; test a merchant against them.
- **Blocks now (5):** *From a conversation with Claude* (each rule with drag, up, down, *Edit*,
  *Disable*, *Delete*); *Built in* (the shipped rules, each with *Edit a copy*, *Disable*); *Test box*.
- **Shapes:** the rules — *a list of rows to act on* → a table with one row menu (the rule *A row's
  menu is one menu*), not five buttons a row.
- **Measures:** 2,573 words (247 above), 680 actions, 17.6 screens tall, low AA 233 — the densest
  screen in the app by every count but blocks.
- **One click behind:** *Built in* (behind its count: they are the app's, rarely edited); the test
  box (as the search that opens the list).

### Reading statements and payslips — `#/read`, `#/paychecks/read`

- **Asks:** *How do I get my statements and payslips in?*
- **Jobs:** drop files; see what each was read as and whether it adds up; write it.
- **Blocks now:** a drop zone and the files read so far, with the tab strip *Read files · Readers*
  (inside the `h1`, whose text reads *Read filesReaders*).
- **Shapes:** each file — *a total against its printed total* → a row with the gap as a word and a
  sign; the batch — *a list of rows to act on* → a list with *Write*.
- **Measures:** 75 and 46 words, 0 blocks, 1 screen.
- **Repeats:** Home's drop zone does the same.

### Readers — `#/read/readers`

- **Asks:** *How does Emerald know how to read each file?*
- **Jobs:** see each saved reader and the columns it maps; remove one.
- **Blocks now (1):** a list of readers (name, file kind, column → role).
- **Measures:** 100 words, 10 actions.

### Settings — `#/settings/*`

- **Accounts** — *Which cards and accounts are mine?* Cards and bank accounts, each named; 54 words,
  14 actions, low AA 8.
- **Packs** — *What can this document keep?* The ledger, development and exports packs, each with a
  paragraph and one button; 185 words, 1 primary.
- **Local model** — *Can a model on this machine help?* 25 words, one switch.
- **Calendar** — *Which day does my week start?* 48 words.
- **Language** — *Which language are the app's words in?* 55 words.
- **Export** — *How do I get my rows out?* 77 words, 3 actions.
- **Shapes:** none of them hold data to show; each is *a few choices* → a form, one column.

### Assistants — `#/mcp`

- **Asks:** *What can a model do with this document, and how do I connect one?*
- **Jobs:** connect an assistant (the snippet); read what each tool does.
- **Blocks now (21):** the connect snippet, then ten groups of tools (formats, rows, reading files,
  the document, statements, transactions, months, bills, plan, paychecks, savings), each a heading
  and a list of one-line descriptions.
- **Shapes:** *a reference list* → a short list of the groups, each opening its tools.
- **Measures:** 1,081 words over 5.1 screens, 2 actions.
- **One click behind:** every tool group (behind its heading); the snippet stays.

## The engine

### Formats — `#/formats`

- **Asks:** *What kinds of things does this document keep?*
- **Jobs:** open a format; declare a new one; see what each holds.
- **Blocks now:** the count as the `h1` (*1 format*, *6 formats*); on `project.emd` the
  *Development* group as a list of cards (columns, rows, claims).
- **Shapes:** *a list of rows* → cards or a table with rows and claims; nothing to chart.
- **Measures:** 42 / 76 words, 5 / 25 actions, 1 primary.

### A format's table — `#/formats/:name`

- **Asks:** *What are all my rows, and are they right?*
- **Jobs:** read and edit rows; sort and filter; add a row; see a failed claim.
- **Blocks now:** the view tabs (table, board, list, roadmap, ready, dashboard as the format has
  them), the sheet with its column headers.
- **Shapes:** *a list of rows to act on* → a data table, sticky header, numbers right.
- **Measures:** 63 words, 30 actions on `card_charge`; 240 words, 99 actions on `unit`.

### Entry and input — `#/formats/:name/entry/:id`, `…/input`

- **Asks:** *What is this one row?* / *How do I add rows quickly?*
- **Jobs:** read and edit one row; add one after another.
- **Blocks now:** the fields, the list of the format's entries beside them, *Add*.
- **Shapes:** *one record* → a form; an amount is the hero of its input.
- **Measures:** 46 and 72 words, 13 and 10 actions.

### Board — `#/formats/:name/board`

- **Asks:** *Where does each thing stand?*
- **Jobs:** move a card to another state; see what is in each lane.
- **Blocks now:** lanes, one per member of the enum, with cards (`unit` on `project.emd`); a format
  with no enum (`card_charge`) lands on the sheet.
- **Shapes:** lanes — *a part of a whole by state* → the lanes, with a thin segmented bar of counts
  above them; cards — *rows to act on*.
- **Measures:** 183 words, 34 actions.

### List — `#/formats/:name/list`

- **Asks:** *What is on my list, and what is done?*
- **Jobs:** tick rows off; add one quickly; group by a column.
- **Blocks now:** grouped lines with a tick each, quick add.
- **Measures:** 64 / 82 words, 15 / 23 actions.

### Roadmap and ready — `#/formats/:name/roadmap`, `…/ready`

- **Asks:** *What comes next, and what can start now?*
- **Jobs:** see the order and state of milestones; pick what is ready.
- **Blocks now:** the roadmap's timeline (*solid to the live row, dashed after*); *Ready to start ·
  2* and *Held · 1* with what holds each. `unit` has no roadmap on `project.emd` and lands on the
  sheet.
- **Shapes:** roadmap — *a plan against what happened* in order → a timeline, a segmented bar of
  states per row; ready — *a list of rows to act on* → a list, the holding row named.
- **Measures:** 183 and 81 words.

### Dashboards — `#/formats/:name/dashboard`, `#/dashboard`

- **Asks:** *What do my numbers add up to?*
- **Jobs:** add blocks from any format; read them.
- **Blocks now:** on both demo documents nothing yet: one sentence and an action (24 and 17 words).
- **Shapes:** whatever the blocks hold — totals → a KPI row; a breakdown → ranked bars; over time
  → a line. This is where the dataviz forms are offered to a person, not chosen for them.

### Agenda — `#/agenda`

- **Asks:** *What is coming up, and what is late?*
- **Jobs:** see every dated row from today, grouped by day; what is overdue above it.
- **Blocks now:** a list by day (`project.emd`: decisions by date, inbox by sent on, units); empty
  on `custom.emd`.
- **Shapes:** *rows by date* → a day-grouped list; overdue as a count and a word.
- **Measures:** 26 / 47 words.

### Calendar — `#/settings/calendar`

- **Asks:** *Which day does my week start?* One choice; 48 words.

### Connections — `#/connections`

- **Asks:** *How do my kinds of things relate?*
- **Jobs:** see the links between formats; add one.
- **Blocks now:** the graph (bubbles and edges marked one/many) and *Every connection, in words*.
- **Shapes:** *a flow from one place to others* → a node-link diagram with the same links as a list
  of sentences beside it (every chart has its numbers).
- **Measures:** 71 / 290 words, 13 / 94 actions.

### Intake — `#/formats/:name/read`

- **Asks:** *How do I get a file into this format?*
- **Jobs:** drop a file; map its columns; write.
- **Blocks now:** a drop zone; after a file, the mapper's grid.
- **Measures:** 65 words, 1 action.

### Packs — `#/settings/packs`

As in Settings: 198 words on `custom.emd`, one primary.

### The new-document start

- **Asks:** *What do I make: a document for anything, or one that keeps my money?*
- **Jobs:** make a new document; make a new ledger; open a recent one.
- **Blocks now (from `EmptyDocument` in `src/App.tsx`):** the title and lead; two cards, *New
  document* (primary) and *New ledger*, each with a line saying what it keeps; recent documents.
- **Not measured**: the demo always opens a document, so `probe:screens` never reaches it.
